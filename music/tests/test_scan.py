"""The scan's contract: absolute paths, deterministic order, hostile names intact.

Runs against a temp tree rather than the real library so it works unmounted and
takes milliseconds instead of a network walk of 15,000 files.
"""
import os
import shutil
import tempfile
import unittest

import config
import scan


class ScanTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='music-scan-')
        self.make('Zed Artist/album/03 last.flac', b'zzz')
        self.make('again&again/Today\'s Lesson [16B-44.1kHz].flac', b'ab')
        self.make('AFI/Black Sails/01 strength.flac', b'abcd')
        self.make('AFI/cover.jpg', b'not audio')
        self.make('AFI/notes.txt', b'not audio')
        self.make('.hidden/secret.flac', b'skipped')

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def make(self, rel, content):
        full = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'wb') as fh:
            fh.write(content)
        return full

    def rels(self):
        return [os.path.relpath(t.path, self.root) for t in scan.scan(self.root)]

    def test_finds_only_audio(self):
        found = self.rels()
        self.assertTrue(all(p.endswith('.flac') for p in found))
        self.assertNotIn(os.path.join('AFI', 'cover.jpg'), found)
        self.assertNotIn(os.path.join('AFI', 'notes.txt'), found)

    def test_skips_hidden_directories(self):
        self.assertFalse(any(p.startswith('.hidden') for p in self.rels()))

    def test_paths_are_absolute(self):
        self.assertTrue(all(os.path.isabs(t.path) for t in scan.scan(self.root)))

    def test_hostile_names_survive_verbatim(self):
        # Trap 20 at the scan layer: the name reaches the index byte-for-byte, so
        # the path stored is the path ffmpeg will later be handed.
        found = self.rels()
        self.assertIn("again&again/Today's Lesson [16B-44.1kHz].flac".replace('/', os.sep),
                      found)

    def test_order_is_deterministic(self):
        # A stable order is what makes `--limit N` in §8.6 examine the same N
        # tracks every run instead of whatever the filesystem felt like reporting.
        self.assertEqual(self.rels(), self.rels())
        self.assertEqual(self.rels(), sorted(self.rels()))

    def test_carries_mtime_and_size(self):
        by_name = {os.path.basename(t.path): t for t in scan.scan(self.root)}
        self.assertEqual(by_name['01 strength.flac'].size, 4)
        self.assertGreater(by_name['01 strength.flac'].mtime, 0)

    def test_track_is_a_plain_tuple(self):
        # It goes straight into sqlite parameter binding, so it must stay a
        # sequence as well as read like a record.
        t = scan.scan(self.root)[0]
        path, mtime, size = t
        self.assertEqual((path, mtime, size), (t.path, t.mtime, t.size))

    def test_missing_root_raises(self):
        with self.assertRaises(NotADirectoryError):
            scan.scan(os.path.join(self.root, 'nope'))

    def test_extension_match_is_case_insensitive(self):
        self.make('AFI/UPPER.FLAC', b'x')
        self.assertTrue(any(p.endswith('UPPER.FLAC') for p in self.rels()))


if __name__ == '__main__':
    unittest.main()


class ExcludeDirsTest(unittest.TestCase):
    """`config.EXCLUDE_DIRS` — the re-scoping lever, and the one whose failure mode
    is silence. A walk that fails to exclude produces MORE data, not an error; a
    walk that over-excludes produces less. Neither raises, so both are asserted."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='music-exclude-')
        for rel in ('Keep Me/01 a.flac',
                    'Retired/Artist/02 b.flac',
                    'Nested/Retired/03 c.flac',
                    'Retired Plus/04 d.flac',        # NOT an exact name match
                    'Keep Me/Retired.flac'):         # a FILE, not a directory
            full = os.path.join(self.root, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, 'wb') as fh:
                fh.write(b'xx')
        self.saved = config.EXCLUDE_DIRS

    def tearDown(self):
        config.EXCLUDE_DIRS = self.saved
        shutil.rmtree(self.root, ignore_errors=True)

    def rels(self):
        return sorted(os.path.relpath(t.path, self.root).replace(os.sep, '/')
                      for t in scan.scan(self.root))

    def test_excluded_directory_is_not_walked(self):
        config.EXCLUDE_DIRS = ('Retired',)
        found = self.rels()
        self.assertNotIn('Retired/Artist/02 b.flac', found)
        self.assertNotIn('Nested/Retired/03 c.flac', found,
                         'the name must match at ANY depth, not just at the root')

    def test_exclusion_is_an_exact_name_not_a_prefix(self):
        config.EXCLUDE_DIRS = ('Retired',)
        found = self.rels()
        self.assertIn('Retired Plus/04 d.flac', found)
        self.assertIn('Keep Me/Retired.flac', found,
                      'a FILE named like an excluded folder must survive')

    def test_nothing_else_is_lost(self):
        config.EXCLUDE_DIRS = ('Retired',)
        self.assertIn('Keep Me/01 a.flac', self.rels())

    def test_empty_exclusion_walks_everything(self):
        config.EXCLUDE_DIRS = ()
        self.assertEqual(len(self.rels()), 5)

    def test_is_excluded_matches_the_walk(self):
        """The predicate and the walk are two implementations of one rule, and
        `index.pending` trusts the predicate while the scan trusts the walk. They
        must agree, or a track is scanned into the ledger and never queued."""
        config.EXCLUDE_DIRS = ('Retired',)
        walked = {t.path for t in scan.scan(self.root)}
        for dirpath, _dirs, files in os.walk(self.root):
            for name in files:
                if not name.endswith('.flac'):
                    continue
                full = os.path.join(dirpath, name)
                self.assertEqual(full in walked, not config.is_excluded(full), full)

    def test_the_live_default_names_the_retired_rip(self):
        """A regression guard on the value itself: this is the line that decides
        whether ~15,000 duplicate tracks enter the vector space."""
        self.assertIn('Old (Needs to be trimmed)', self.saved)

    def test_exclusion_is_not_part_of_the_signature(self):
        """EXCLUDE_DIRS changes WHICH files are analysed, never what the numbers
        mean — so re-scoping the shelf must not invalidate a finished backfill."""
        before = config.signature()
        config.EXCLUDE_DIRS = ('Retired', 'Something Else')
        self.assertEqual(config.signature(), before)


class CachedShelfTest(unittest.TestCase):
    """`scan.CachedShelf` — the watcher's cheap re-walk. Two claims, both of which
    fail silently if wrong: a full walk finds exactly what `iter_tracks` finds (or
    the watcher and a person's run disagree about the shelf), and a cheap walk
    still finds every upload (or new music is never analysed and nothing says so)."""

    def setUp(self):
        self.root = tempfile.mkdtemp(prefix='music-shelf-')
        self.saved = config.EXCLUDE_DIRS
        config.EXCLUDE_DIRS = ('Retired',)
        for rel in ('AFI/Black Sails/01 strength.flac', 'AFI/Black Sails/Disc 2/01 x.flac',
                    "again&again/Today's Lesson.flac", 'Zed/album/cover.jpg',
                    '.hidden/secret.flac', 'Retired/Old/01 dup.flac'):
            self.make(rel)
        os.symlink(os.path.join(self.root, 'AFI'), os.path.join(self.root, 'Linked'))
        self.shelf = scan.CachedShelf(self.root)

    def tearDown(self):
        config.EXCLUDE_DIRS = self.saved
        shutil.rmtree(self.root, ignore_errors=True)

    def make(self, rel, content=b'flac'):
        full = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'wb') as handle:
            handle.write(content)
        return full

    def paths(self, **kw):
        return [t.path for t in self.shelf.walk(**kw)]

    def bump(self, directory):
        """Move a directory's mtime explicitly — a test must not depend on the
        filesystem's timestamp granularity to prove a change is seen."""
        st = os.stat(directory)
        os.utime(directory, ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))

    def test_a_full_walk_is_iter_tracks(self):
        self.assertEqual(list(self.shelf.walk(full=True)), list(scan.iter_tracks(self.root)))

    def test_an_unchanged_shelf_lists_nothing(self):
        first = self.paths()
        self.assertGreater(self.shelf.listed, 0)
        self.assertEqual(self.paths(), first)
        self.assertEqual(self.shelf.listed, 0)

    def test_a_track_added_to_an_existing_album_is_found(self):
        self.paths()
        new = self.make('AFI/Black Sails/02 new.flac')
        self.bump(os.path.dirname(new))
        self.assertIn(new, self.paths())
        self.assertEqual(self.shelf.listed, 1)

    def test_a_new_album_is_found_through_its_parent(self):
        self.paths()
        new = self.make('AFI/Sing the Sorrow/01 miseria.flac')
        self.bump(os.path.join(self.root, 'AFI'))
        self.assertIn(new, self.paths())
        self.assertEqual(self.shelf.listed, 2)           # the artist, then the new album

    def test_a_rewrite_in_place_is_invisible_until_rechecked_or_full(self):
        """⚠️ The blind spot, pinned so it is a known property rather than a surprise:
        the Qobuz downloader tags a file after renaming it into place."""
        path = os.path.join(self.root, 'AFI/Black Sails/01 strength.flac')
        self.paths()
        with open(path, 'ab') as handle:
            handle.write(b' tagged')
        size = os.path.getsize(path)
        sizes = lambda tracks: {t.path: t.size for t in tracks}
        self.assertNotEqual(sizes(self.shelf.walk())[path], size)
        self.assertEqual(sizes(self.shelf.walk(recheck={path}))[path], size)
        self.assertEqual(sizes(self.shelf.walk(full=True))[path], size)

    def test_a_rechecked_file_that_vanished_is_dropped_and_stays_dropped(self):
        """The directory's mtime is put BACK, so only the re-`stat` can notice — and
        the walk after that must not trip over what the re-`stat` removed."""
        path = os.path.join(self.root, 'AFI/Black Sails/01 strength.flac')
        album = os.path.dirname(path)
        self.paths()
        st = os.stat(album)
        os.remove(path)
        os.utime(album, ns=(st.st_atime_ns, st.st_mtime_ns))
        self.assertNotIn(path, self.paths(recheck={path}))
        self.assertNotIn(path, self.paths(recheck={path}))

    def test_a_removed_album_leaves_the_walk(self):
        self.paths()
        shutil.rmtree(os.path.join(self.root, 'AFI', 'Black Sails', 'Disc 2'))
        self.bump(os.path.join(self.root, 'AFI', 'Black Sails'))
        self.assertNotIn(os.path.join(self.root, 'AFI/Black Sails/Disc 2/01 x.flac'), self.paths())

    def test_an_unreachable_root_raises_like_iter_tracks(self):
        with self.assertRaises(NotADirectoryError):
            list(scan.CachedShelf(os.path.join(self.root, 'nope')).walk())
