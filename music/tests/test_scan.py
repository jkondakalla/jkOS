"""The scan's contract: absolute paths, deterministic order, hostile names intact.

Runs against a temp tree rather than the real library so it works unmounted and
takes milliseconds instead of a network walk of 15,000 files.
"""
import os
import shutil
import tempfile
import unittest

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
