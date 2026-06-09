"""
OCW Preprocessor v2 — converts MIT OpenCourseWare ZIP archives into
structured CourseManifest JSON for SylibOS.

Supported formats:
  Modern (post-2015): JSON tree with data.json + pages/ + resources/
  Legacy (pre-2015):  Plone export — requires ocw-data-parser
  Archive:            Internet Archive stub (not yet implemented)

Supported shapes (modern only):
  scholar      — unit/session two-level hierarchy (e.g. 18.06SC)
  flat_feature — feature folders: lecture-notes/, assignments/, exams/
  project_lab  — project-*/lab-* unit dirs
  seminar      — readings/-based spine
  video_only   — Lecture Videos resources as sessions
"""

from .manifest import CourseManifest, UnitNode, SessionNode, ResourceNode, Instructor
from .pipeline import preprocess

__all__ = [
    "preprocess",
    "CourseManifest", "UnitNode", "SessionNode", "ResourceNode", "Instructor",
]
