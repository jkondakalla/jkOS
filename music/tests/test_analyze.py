"""analyze.py under test — the sequence KourOS reads, and the watcher that reruns it.

The stages themselves are tested where they live (`test_backfill`, `test_descriptors`,
`test_mesh`, `test_query`, `test_ship`). What is tested HERE is what this file
adds, and every one of those additions guards a failure that would be silent:

  · **the scan plan** — a half-written upload is not analysed; a tagging sweep
    cannot quietly discard finished vectors; new files are never held hostage.
  · **the shared baseline pass** — one decode yields a descriptor AND a mesh, and
    the mesh is bit-identical to the one `mesh.py` builds from the same file.
  · **the gate verdict** — it is keyed to the calibration, so a watcher cycle
    cannot ship a geometry a full run already failed.
  · **the hand-off** — snapshots verified from the copy; delivery refuses a
    target or key it cannot pass safely; the lock admits one writer.
  · **the sequence** — end to end on a synthetic shelf, then a watcher cycle that
    finds nothing to do, then one that finds an upload.

⚠️ Real FLACs, real decode, real mel, real SQLite. Only the ONNX forward pass is
stubbed (the `test_backfill` seam) and `query.gate`'s verdict where noted — the
proxies need a real library to mean anything and have their own tests.
"""
import contextlib
import io
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest
from unittest import mock

import numpy as np

import analyze
import config
import encoder
import index
import mapbasis
import mesh
import query
import runlock
import ship

from . import helpers
from .test_backfill import stub_embeddings

OLD = time.time() - 3600          # an mtime that is comfortably settled


def make_track(root, artist, album, title, freq, seconds=2.5):
    """A FLAC at `<root>/<artist>/<album>/<title>.flac`, settled (an hour old)."""
    directory = os.path.join(root, artist, album)
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f'{title}.flac')
    subprocess.run(
        [os.environ.get('FFMPEG_BIN', 'ffmpeg'), '-v', 'error', '-nostdin', '-y',
         '-f', 'lavfi', '-i', f'sine=frequency={freq}:duration={seconds}:sample_rate=44100',
         '-f', 'lavfi', '-i', f'anoisesrc=d={seconds}:c=pink:r=44100:a={0.02 + freq / 40000}',
         '-filter_complex', 'amix=inputs=2:duration=shortest', '-ac', '1', path],
        stdin=subprocess.DEVNULL, capture_output=True, check=True, timeout=60)
    os.utime(path, (OLD, OLD))
    return path


@unittest.skipUnless(helpers.have('ffmpeg'), 'ffmpeg is required to build fixtures')
class AnalyzeTestCase(unittest.TestCase):
    """A synthetic shelf rooted at a directory named `Music`, so KourOS's
    root-relative join (and `ship.check`'s refusal of paths that miss it) is real."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='music-analyze-')
        self.root = os.path.join(self.tmp, 'Music')
        os.makedirs(self.root)
        self.index_path = os.path.join(self.tmp, 'index.db')
        self.store_path = os.path.join(self.tmp, 'meshes.db')
        self.out_dir = os.path.join(self.tmp, 'out')
        self.saved_root = config.LIBRARY_ROOT
        config.LIBRARY_ROOT = self.root
        self.real_embed = encoder.embed_features
        encoder.embed_features = stub_embeddings
        self.lock = mock.patch.object(runlock, 'LOCK_PATH', os.path.join(self.tmp, '.lock'))
        self.lock.start()
        analyze._interrupted.clear()
        # The stages narrate to stderr, which is right for a run and noise here.
        self.quiet = contextlib.redirect_stderr(io.StringIO())
        self.quiet.__enter__()

    def tearDown(self):
        self.quiet.__exit__(None, None, None)
        self.lock.stop()
        encoder.embed_features = self.real_embed
        config.LIBRARY_ROOT = self.saved_root
        analyze._interrupted.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def conns(self):
        conn, store = index.connect(self.index_path), mesh.connect(self.store_path)
        self.addCleanup(store.close)
        self.addCleanup(conn.close)
        return conn, store

    def shelf(self, n=8):
        """`n` tracks over two artists — the fit refuses fewer than 8, or a corpus
        with no stranger pairs."""
        return [make_track(self.root, f'Artist {"AB"[i % 2]}', f'Album {i % 4}',
                           f'0{i}. Title {i}', 180.0 + 97.0 * i)
                for i in range(n)]

    def opts(self, **kw):
        kw.setdefault('index_path', self.index_path)
        kw.setdefault('store_path', self.store_path)
        kw.setdefault('out_dir', self.out_dir)
        kw.setdefault('workers', 2)
        return analyze.Options(**kw)


# ── The scan plan ───────────────────────────────────────────────────────────────
class ScanPlanTest(AnalyzeTestCase):
    def test_the_plan_writes_nothing(self):
        self.shelf(2)
        conn, _ = self.conns()
        plan = analyze.plan_scan(conn)
        self.assertEqual(len(plan.new), 2)
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM tracks').fetchone()[0], 0)

    def test_a_file_still_being_written_is_not_analysed_yet(self):
        """⚠️ The Qobuz downloader renames `.part` → `.flac` and then rewrites it to
        tag it. A file that exists is not a file that is finished."""
        path = make_track(self.root, 'Artist', 'Album', '01. Fresh', 440.0)
        os.utime(path, None)                               # written just now
        conn, _ = self.conns()
        plan = analyze.plan_scan(conn, settle_seconds=120)
        self.assertEqual([t.path for t in plan.unsettled], [path])
        self.assertEqual(plan.new, [])
        analyze.apply_scan(conn, plan)
        self.assertIsNone(index.track_by_path(conn, path))

    def test_an_old_mtime_on_a_growing_file_is_caught_by_the_second_look(self):
        """A copy tool that stamps the SOURCE's mtime passes the age rule while it
        is still writing. Two walks that disagree about the size hold it back."""
        path = make_track(self.root, 'Artist', 'Album', '01. Copying', 440.0)
        conn, _ = self.conns()
        st = os.stat(path)
        previous = {path: (st.st_mtime, st.st_size - 1000)}      # smaller last time
        plan = analyze.plan_scan(conn, settle_seconds=120, previous=previous)
        self.assertEqual([t.path for t in plan.unsettled], [path])
        steady = analyze.plan_scan(conn, settle_seconds=120, previous=plan.observed)
        self.assertEqual([t.path for t in steady.new], [path])

    def test_a_sweep_over_finished_work_is_held_and_new_files_are_not(self):
        """⚠️ `upsert_track` drops a changed file's vectors — right for one album,
        hours of encoder time for a tagging sweep. Over the ceiling the changes
        are held back; the upload beside them still lands."""
        paths = self.shelf(3)
        conn, _ = self.conns()
        for path in paths:
            track = index.upsert_track(conn, path, os.path.getmtime(path),
                                       os.path.getsize(path))
            index.put_vector(conn, track, np.ones(4, dtype=np.float32), 'test')
        conn.commit()
        for path in paths:
            os.utime(path, (OLD + 60, OLD + 60))         # "retagged"
        upload = make_track(self.root, 'Artist C', 'New', '01. Upload', 900.0)

        plan = analyze.plan_scan(conn)
        self.assertEqual(plan.invalidates, 3)
        written, refusal = analyze.apply_scan(conn, plan, max_invalidate=2)
        self.assertIsNotNone(refusal)
        self.assertIn('--allow-invalidate', refusal)
        self.assertEqual(written, 1)
        self.assertIsNotNone(index.track_by_path(conn, upload))
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM local_vectors').fetchone()[0], 3)

        written, refusal = analyze.apply_scan(conn, plan, allow_invalidate=True, max_invalidate=2)
        self.assertIsNone(refusal)
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM local_vectors').fetchone()[0], 0)

    def test_a_dropped_mount_is_a_stop_not_an_empty_library(self):
        conn, _ = self.conns()
        with self.assertRaises(analyze.StageAborted):
            analyze.plan_scan(conn, root=os.path.join(self.tmp, 'not-mounted'))


# ── The shared baseline pass ────────────────────────────────────────────────────
class BaselineTest(AnalyzeTestCase):
    def ingest(self, paths):
        conn, store = self.conns()
        for path in paths:
            index.upsert_track(conn, path, os.path.getmtime(path), os.path.getsize(path))
        conn.commit()
        return conn, store

    def test_one_pass_builds_a_descriptor_and_a_mesh_per_track(self):
        conn, store = self.ingest(self.shelf(3))
        jobs = analyze.baseline_queue(conn, store)
        self.assertEqual(len(jobs), 3)
        progress = analyze.stage_baseline(conn, store, jobs, workers=2, reporter=lambda *a, **k: None)
        self.assertEqual((progress.descriptors, progress.meshes, progress.failed), (3, 3, 0))
        self.assertEqual(analyze.baseline_queue(conn, store), [])

    def test_the_mesh_is_the_one_mesh_py_builds_from_the_same_file(self):
        """The end-to-end form of `test_descriptors`' bit-identity claim: through
        the real decode and the real store, the shared pass and `mesh.from_file`
        produce the same bytes."""
        path = self.shelf(1)[0]
        conn, store = self.ingest([path])
        analyze.stage_baseline(conn, store, analyze.baseline_queue(conn, store), workers=1,
                               reporter=lambda *a, **k: None)
        stored = mesh.get(store, mesh.rel_key(path))
        reference = mesh.from_file(path)
        np.testing.assert_array_equal(stored.rows, reference.rows)
        self.assertEqual(stored.config_sig, reference.config_sig)

    def test_a_track_missing_only_its_mesh_keeps_its_descriptor(self):
        conn, store = self.ingest(self.shelf(1))
        analyze.stage_baseline(conn, store, analyze.baseline_queue(conn, store), workers=1,
                               reporter=lambda *a, **k: None)
        before = conn.execute('SELECT created_at, vector FROM descriptors').fetchone()
        store.execute('DELETE FROM meshes')
        store.commit()
        jobs = analyze.baseline_queue(conn, store)
        self.assertEqual(len(jobs), 1)
        self.assertFalse(jobs[0].need_descriptor)
        self.assertIsNotNone(jobs[0].mesh_key)
        analyze.stage_baseline(conn, store, jobs, workers=1, reporter=lambda *a, **k: None)
        after = conn.execute('SELECT created_at, vector FROM descriptors').fetchone()
        self.assertEqual(tuple(before), tuple(after))
        self.assertEqual(mesh.stats(store)['meshes'], 1)

    def test_one_bad_file_is_data_and_the_batch_continues(self):
        good = self.shelf(2)
        bad = os.path.join(self.root, 'Artist A', 'Album 0', '09. Zero bytes.flac')
        open(bad, 'wb').close()
        conn, store = self.ingest(good + [bad])
        progress = analyze.stage_baseline(conn, store, analyze.baseline_queue(conn, store),
                                          workers=2, reporter=lambda *a, **k: None)
        self.assertEqual((progress.done, progress.failed), (2, 1))
        self.assertEqual(index.track_by_path(conn, bad)['status'], index.FAILED)
        self.assertEqual(mesh.stats(store)['failures'], 1)
        self.assertEqual(analyze.baseline_queue(conn, store), [])

    def test_a_dropped_mount_marks_nothing(self):
        os.makedirs(os.path.join(self.root, 'Artist A', 'Album 0'))
        bad = os.path.join(self.root, 'Artist A', 'Album 0', '09. Gone.flac')
        open(bad, 'wb').close()
        conn, store = self.ingest([bad])
        config.LIBRARY_ROOT = os.path.join(self.tmp, 'not-mounted')
        with self.assertRaises(analyze.StageAborted):
            analyze.stage_baseline(conn, store, analyze.baseline_queue(conn, store), workers=1,
                                   reporter=lambda *a, **k: None)
        self.assertEqual(index.track_by_path(conn, bad)['status'], index.PENDING)
        self.assertEqual(mesh.stats(store)['failures'], 0)

    def test_it_refuses_to_run_under_the_encoder_profile(self):
        conn, store = self.ingest(self.shelf(1))
        jobs = analyze.baseline_queue(conn, store)
        with config.using(config.ENCODER):
            with self.assertRaises(analyze.AnalysisError):
                analyze.stage_baseline(conn, store, jobs, workers=1, reporter=lambda *a, **k: None)


# ── Fit and the gate verdict ────────────────────────────────────────────────────
class GateVerdictTest(AnalyzeTestCase):
    def fitted(self):
        conn, store = self.conns()
        for i in range(10):
            track = index.upsert_track(conn, f'{self.root}/Artist {i % 3}/Album/0{i}.flac', 1.0, 1)
            index.put_vector(conn, track, np.random.default_rng(i).standard_normal(8)
                             .astype(np.float32), 'test')
        conn.commit()
        self.assertTrue(analyze.stage_fit(conn))
        return conn

    def test_a_fit_is_current_until_the_arm_grows(self):
        conn = self.fitted()
        self.assertIsNone(analyze.needs_fit(conn))
        track = index.upsert_track(conn, f'{self.root}/Artist 9/Album/99.flac', 1.0, 1)
        index.put_vector(conn, track, np.ones(8, dtype=np.float32), 'test')
        conn.commit()
        self.assertIn('grown', analyze.needs_fit(conn))

    def test_a_failed_verdict_blocks_without_rerunning_the_proxies(self):
        conn = self.fitted()
        with mock.patch.object(query, 'gate', return_value=False) as gate:
            with self.assertRaises(analyze.GateFailed):
                analyze.stage_gate(conn)
            with self.assertRaises(analyze.GateFailed):
                analyze.stage_gate(conn)                 # a watcher cycle, later
            self.assertEqual(gate.call_count, 1)

    def test_a_new_calibration_needs_a_new_verdict(self):
        conn = self.fitted()
        with mock.patch.object(query, 'gate', return_value=True):
            analyze.stage_gate(conn)
        self.assertTrue(analyze.gate_verdict(conn)['passed'])
        index.set_meta(conn, 'calib_stranger_spread:local_vectors', '0.123')
        conn.commit()
        self.assertIsNone(analyze.gate_verdict(conn))


# ── The hand-off ────────────────────────────────────────────────────────────────
class MeshCheckTest(AnalyzeTestCase):
    def store_with(self, n=2):
        conn, store = self.conns()
        for i in range(n):
            logmel = np.full((config.N_MELS, mesh.frames_per_row() * 2), float(i), np.float32)
            mesh.put(store, f'artist/0{i}.flac', mesh.build(logmel))
        return store

    def test_a_clean_store_passes(self):
        self.assertEqual(mesh.check(self.store_with())['meshes'], 2)

    def test_a_torn_blob_is_refused(self):
        store = self.store_with()
        store.execute("UPDATE meshes SET rows = X'00' WHERE rel_key = 'artist/00.flac'")
        store.commit()
        with self.assertRaises(mesh.MeshError):
            mesh.check(store)

    def test_two_recipes_in_one_store_are_refused(self):
        store = self.store_with()
        store.execute("UPDATE meshes SET reduction = 'max' WHERE rel_key = 'artist/00.flac'")
        store.commit()
        with self.assertRaises(mesh.MeshError):
            mesh.check(store)

    def test_an_empty_store_is_refused(self):
        _conn, store = self.conns()
        with self.assertRaises(mesh.MeshError):
            mesh.check(store)


class DeliveryTest(unittest.TestCase):
    def test_hostile_targets_are_refused(self):
        for target in ('-e sh', 'host:', 'user@host:../kouros-data', 'user@host:/x;rm',
                       'user@ho st:', ''):
            with self.subTest(target=target), self.assertRaises(analyze.DeliveryError):
                analyze.Delivery(target, '/home/x/.ssh/key')

    def test_a_key_path_rsync_would_split_is_refused(self):
        with self.assertRaises(analyze.DeliveryError):
            analyze.Delivery('u@h:', '/media/jag/The Forge/key')

    def test_the_argv_is_a_list_with_the_target_last(self):
        argv = analyze.Delivery('truenas_admin@192.168.1.108:', '/k').argv(['/a b/x.db', '/y.db'])
        self.assertEqual(argv[0], 'rsync')
        self.assertEqual(argv[-3:], ['/a b/x.db', '/y.db', 'truenas_admin@192.168.1.108:'])
        self.assertIn('StrictHostKeyChecking=yes', argv[argv.index('-e') + 1])

    def test_no_target_means_no_delivery_not_a_default_host(self):
        with mock.patch.dict(os.environ, {'MUSIC_ANALYSIS_TARGET': ''}):
            self.assertIsNone(analyze.Delivery.from_env())


class LockTest(unittest.TestCase):
    def test_one_writer_at_a_time(self):
        tmp = tempfile.mkdtemp(prefix='music-lock-')
        self.addCleanup(shutil.rmtree, tmp, True)
        path = os.path.join(tmp, '.lock')
        with runlock.hold('first run', path=path):
            self.assertIn('first run', runlock.holder(path))
            with self.assertRaises(runlock.Busy) as caught:
                with runlock.hold('second run', path=path):
                    pass
            self.assertIn('first run', str(caught.exception))
        self.assertIsNone(runlock.holder(path))


# ── The sequence ────────────────────────────────────────────────────────────────
class SequenceTest(AnalyzeTestCase):
    """End to end on a synthetic shelf: the full run, a watcher cycle with nothing
    to do, and a watcher cycle that finds an upload."""

    def fake_rsync(self, exit_code=0):
        """An `rsync` on PATH that records its argv and copies the files into a
        local 'NAS' directory — the delivery path without a network."""
        bindir = os.path.join(self.tmp, 'bin')
        nas = os.path.join(self.tmp, 'nas')
        os.makedirs(bindir, exist_ok=True)
        os.makedirs(nas, exist_ok=True)
        script = os.path.join(bindir, 'rsync')
        with open(script, 'w') as handle:
            handle.write('#!/bin/sh\n'
                         f'printf "%s\\n" "$@" > "{self.tmp}/rsync-argv"\n'
                         f'[ {exit_code} -eq 0 ] || {{ echo "connection refused" >&2; exit {exit_code}; }}\n'
                         'for f in "$@"; do case "$f" in *.db) cp "$f" '
                         f'"{nas}/";; esac; done\n')
        os.chmod(script, 0o755)
        patch = mock.patch.dict(os.environ, {'PATH': f'{bindir}{os.pathsep}{os.environ["PATH"]}'})
        patch.start()
        self.addCleanup(patch.stop)
        key = os.path.join(self.tmp, 'key')
        open(key, 'w').close()
        return analyze.Delivery('analysis@nas.local:', key), nas

    def test_the_full_run_then_an_idle_cycle_then_an_upload(self):
        self.shelf(8)
        delivery, nas = self.fake_rsync()
        with mock.patch.object(query, 'gate', return_value=True):
            analyze.run_once(self.opts(delivery=delivery))

            conn, store = self.conns()
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM local_vectors').fetchone()[0], 8)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM descriptors').fetchone()[0], 8)
            self.assertEqual(mesh.stats(store)['meshes'], 8)
            self.assertIsNotNone(query.Calibration.load(conn, 'local_vectors'))
            # Eight tracks cannot carry an energy probe: the map basis is HELD as a
            # prerequisite — recorded, not missing — and the rest still ships. The
            # idle cycle below then proves a standing hold does not refit (and so
            # does not re-ship) every five minutes.
            self.assertEqual(mapbasis.held(conn, 'local_vectors')['kind'], 'prerequisite')

            for name in (analyze.INDEX_SNAPSHOT, analyze.MESH_SNAPSHOT):
                self.assertTrue(os.path.exists(os.path.join(nas, name)), name)
            shipped = sqlite3.connect(os.path.join(nas, analyze.INDEX_SNAPSHOT))
            shipped.row_factory = sqlite3.Row
            self.addCleanup(shipped.close)
            ship.check(shipped, stream=open(os.devnull, 'w'))
            manifest = analyze.read_manifest(self.out_dir)
            self.assertEqual(manifest['shipped'], manifest['delivered'])
            conn.close()
            store.close()

            # An idle watcher cycle: nothing new, so nothing is rewritten or re-sent.
            before = os.stat(os.path.join(self.out_dir, analyze.INDEX_SNAPSHOT)).st_mtime_ns
            os.remove(os.path.join(self.tmp, 'rsync-argv'))
            state = analyze.WatchState()
            analyze.run_once(self.opts(delivery=delivery, full=False), state)
            self.assertEqual(before, os.stat(os.path.join(self.out_dir,
                                                          analyze.INDEX_SNAPSHOT)).st_mtime_ns)
            self.assertFalse(os.path.exists(os.path.join(self.tmp, 'rsync-argv')))

            # An upload. The next cycle finds it WITHOUT a full walk — only the root,
            # whose mtime the new artist folder moved, and the two new folders are
            # listed — and holds it for a second look, because a file seen once is
            # not yet a file seen unchanged. The cycle after that analyses it,
            # ships, and delivers.
            upload = make_track(self.root, 'Artist C', 'Fresh', '01. Upload', 1234.0)
            st = os.stat(self.root)
            os.utime(self.root, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
            analyze.run_once(self.opts(delivery=delivery, full=False), state)
            self.assertEqual(state.shelf.listed, 3)
            self.assertIn(upload, state.settling)
            self.assertFalse(os.path.exists(os.path.join(self.tmp, 'rsync-argv')))
            analyze.run_once(self.opts(delivery=delivery, full=False), state)
            self.assertEqual(state.shelf.listed, 0)
            conn, store = self.conns()
            self.assertIsNotNone(index.get_vector(conn, index.track_by_path(conn, upload)['id']))
            self.assertIsNotNone(mesh.get(store, mesh.rel_key(upload)))
            self.assertTrue(os.path.exists(os.path.join(self.tmp, 'rsync-argv')))

    def test_an_upload_still_being_tagged_waits_across_cycles(self):
        """The settle rule through the cached walk: the file's DIRECTORY stops
        changing at the rename, so only the re-`stat` of a settling file sees the
        tag rewrite — and the second look must see it unchanged before it counts."""
        self.shelf(1)
        state = analyze.WatchState()
        scan_only = self.opts(full=False, stages=('scan',), settle=120)
        analyze.run_once(scan_only, state)                        # the full first walk
        path = make_track(self.root, 'Artist C', 'Fresh', '01. Arriving', 700.0)
        os.utime(path, None)                                      # renamed in just now
        st = os.stat(self.root)
        os.utime(self.root, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
        analyze.run_once(scan_only, state)
        self.assertIn(path, state.settling)
        with open(path, 'ab') as handle:                          # …then tagged in place
            handle.write(b'\0' * 512)
        os.utime(path, (OLD, OLD))                                # and long enough ago
        analyze.run_once(scan_only, state)
        self.assertIn(path, state.settling)                       # size moved: look again
        analyze.run_once(scan_only, state)
        self.assertNotIn(path, state.settling)
        conn, _ = self.conns()
        self.assertEqual(index.track_by_path(conn, path)['size'], os.path.getsize(path))

    def test_a_failed_gate_ships_nothing(self):
        self.shelf(8)
        with mock.patch.object(query, 'gate', return_value=False):
            with self.assertRaises(analyze.GateFailed):
                analyze.run_once(self.opts(stages=tuple(s for s in analyze.STAGES
                                                        if s != 'deliver')))
            # …and a later watcher cycle, which does not force the gate, still refuses.
            with self.assertRaises(analyze.GateFailed):
                analyze.run_once(self.opts(full=False, stages=('ship',)))
        self.assertFalse(os.path.exists(os.path.join(self.out_dir, analyze.INDEX_SNAPSHOT)))

    def test_a_failed_delivery_is_retried_by_the_next_cycle(self):
        self.shelf(8)
        failing, _nas = self.fake_rsync(exit_code=12)
        with mock.patch.object(query, 'gate', return_value=True):
            with self.assertRaises(analyze.DeliveryError):
                analyze.run_once(self.opts(delivery=failing))
            working, nas = self.fake_rsync()
            analyze.run_once(self.opts(delivery=working, full=False))
        self.assertTrue(os.path.exists(os.path.join(nas, analyze.MESH_SNAPSHOT)))

    def test_an_interrupt_stops_the_sequence_at_the_next_stage(self):
        """`backfill.run` swallows Ctrl-C and returns; the sequence must not carry
        on into the baseline as though the vectors had finished."""
        self.shelf(8)
        analyze._interrupted.set()
        with self.assertRaises(KeyboardInterrupt):
            analyze.run_once(self.opts(stages=('scan', 'vectors', 'baseline')))
        conn, _store = self.conns()
        self.assertEqual(conn.execute('SELECT COUNT(*) FROM descriptors').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
