"""Test package for the music vector space.

Run from `music/`:

    python -m unittest discover

stdlib `unittest`, not pytest — pytest is a dependency the budget does not take
(ALGORITHMS.md §4).

The sys.path insert makes `python -m unittest discover -s music` work from the
repo root too, not just `cd music` first. Without it the flat module layout
(`import config`) resolves only when the interpreter's cwd happens to be this
directory, which is a footgun for anyone running the suite from a wrapper.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
