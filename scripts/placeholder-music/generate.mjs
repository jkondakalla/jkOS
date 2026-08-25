// generate.mjs — write the placeholder library to disk.
//
// The on-disk LAYOUT is not arbitrary: it mirrors the flat re-download the real
// library is being rebuilt into, because that layout is what two pieces of shipped
// code already reason about — the scanner's `MUSIC_EXCLUDE_DIRS`, and
// backend/src/discover/vectors.js, whose `contentKeyFromEmbedderPath` recovers an
// artist and a title from the path SHAPE:
//
//   <root>/<Artist> - <Album> (year) [MP3]/NN. <Artist> - <Title>.mp3
//   <root>/<Artist> - <Album> (year) [MP3]/Disc N/NN. <Artist> - <Title>.mp3
//
// A placeholder library laid out any other way would exercise a path the real one
// never takes. `Old (Needs to be trimmed)/` is written too, holding one album the
// scan must refuse to enter — the exclusion is a real rule with a real cost when it
// breaks (~15,000 duplicate rows), so it gets something to bite on.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import os from 'node:os';
import { buildCatalog } from './catalog.mjs';
import { sleeve } from './sleeves.mjs';
import { hash } from './art.mjs';
import { albumVoice, trackExpression, trackDuration, ffmpegArgs, profileOf } from './audio.mjs';

/** Characters no sane library puts in a filename, plus the separator itself. */
const safe = (s) => String(s).replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

const albumFolder = (a) => safe(`${a.albumartist} - ${a.title} (${a.year}) [MP3]`);

const trackFile = (a, t) =>
  safe(`${String(t.no).padStart(2, '0')}. ${t.artist ?? a.albumartist} - ${t.title}`) + '.mp3';

/** Run ffmpeg, resolving with stderr on failure so one bad track cannot take the
 *  whole generation down silently. */
function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 1 << 22 }, (err, _out, stderr) =>
      err ? reject(new Error(`${bin} failed: ${stderr || err.message}`)) : resolve());
  });
}

/** Await tasks with at most `limit` in flight. ffmpeg is the whole cost here and it
 *  is single-threaded per track, so the pool is what turns ~4 minutes into ~30 seconds. */
async function pool(items, limit, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await worker(next[1], next[0]);
    }
  });
  await Promise.all(runners);
}

/**
 * Build the whole library. Returns the manifest the embedder index and the seeder
 * both read — every track's absolute path, tags and duration, in one place, so
 * neither of them has to re-walk the disk or re-derive what was written.
 */
export async function generate({ root, manifestPath, concurrency = Math.min(12, os.cpus().length), bitrate = '32k', onProgress } = {}) {
  const albums = buildCatalog();
  fs.mkdirSync(root, { recursive: true });

  // The retired rip: one album, inside the folder the scan must refuse to enter.
  const retired = { ...albums[0], title: `${albums[0].title} (2004 rip)` };
  const jobs = [];
  const manifest = [];

  const plan = (album, dir) => {
    fs.mkdirSync(dir, { recursive: true });
    const seed = hash(`${album.albumartist} — ${album.title}`);
    const voice = albumVoice(seed, album.sound);
    const art = sleeve(album).png();

    // A PNG beside the audio for ffmpeg to attach, plus the cover.jpg a real album
    // folder carries — the scanner's ladder tries embedded art FIRST and only falls
    // back to the folder image, and both paths deserve something to find.
    const pngPath = path.join(dir, '.cover-src.png');
    fs.writeFileSync(pngPath, art);

    const discDirs = new Map();
    for (const t of album.tracks) {
      const tDir = t.disc ? path.join(dir, `Disc ${t.disc}`) : dir;
      if (!discDirs.has(tDir)) { fs.mkdirSync(tDir, { recursive: true }); discDirs.set(tDir, true); }
      const tSeed = hash(`${album.albumartist}|${album.title}|${t.disc ?? 0}|${t.no}|${t.title}`);
      const duration = trackDuration(tSeed, album.sound);
      const file = path.join(tDir, trackFile(album, t));
      const total = album.discs[(t.disc ?? 1) - 1].length;
      const tags = {
        title: t.title,
        artist: t.artist ?? album.albumartist,
        album: album.title,
        album_artist: album.albumartist,
        track: `${t.no}/${total}`,
        disc: t.disc ? `${t.disc}/${album.discs.length}` : '',
        date: String(album.year),
        genre: album.genre,
      };
      jobs.push({
        file,
        args: ffmpegArgs({
          expression: trackExpression(voice, tSeed, duration),
          duration,
          lowpass: profileOf(album.sound).lowpass,
          coverPath: pngPath,
          tags, out: file, bitrate,
        }),
      });
      manifest.push({ path: file, duration, album: album.title, albumartist: album.albumartist, sound: album.sound, ...tags });
    }
    return { pngPath, dirs: [dir, ...discDirs.keys()] };
  };

  const cleanup = [];
  for (const album of albums) cleanup.push(plan(album, path.join(root, albumFolder(album))));
  const retiredPlan = plan(
    { ...retired, tracks: retired.tracks.slice(0, 3) },
    path.join(root, 'Old (Needs to be trimmed)', albumFolder(retired)),
  );
  cleanup.push(retiredPlan);
  const retiredPaths = new Set(jobs.slice(jobs.length - 3).map((j) => j.file));

  let done = 0;
  await pool(jobs, concurrency, async (job) => {
    await run('ffmpeg', job.args);
    done++;
    onProgress?.(done, jobs.length, path.basename(job.file));
  });

  // Turn each album's PNG into the cover.jpg a real folder carries, then drop the
  // PNG — it was only ever ffmpeg's input.
  for (const c of cleanup) {
    for (const d of c.dirs) await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', c.pngPath, '-vf', 'scale=600:600', '-q:v', '4', '-y', path.join(d, 'cover.jpg')]);
    fs.rmSync(c.pngPath, { force: true });
  }

  // The manifest is WRITTEN, not just returned: rebuilding the vector space is
  // seconds of arithmetic while re-encoding the audio it describes is four minutes,
  // so `reindex` has to be able to run without `build`.
  const tracks = manifest.filter((m) => !retiredPaths.has(m.path));
  if (manifestPath) {
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ root, albums: albums.length, tracks }, null, 1));
  }

  return {
    root,
    albums: albums.length,
    // The manifest EXCLUDES the retired rip, exactly as the scanner will: everything
    // downstream (the embedder index, the history seed) must describe the library
    // KourOS actually sees, or coverage percentages start lying.
    tracks,
    excluded: manifest.filter((m) => retiredPaths.has(m.path)).length,
  };
}
