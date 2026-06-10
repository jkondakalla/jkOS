"""
OCW Preprocessor v2 — converts MIT OpenCourseWare ZIP archives into
structured CourseManifest JSON for SylibOS.

Supported formats:
  Modern:  ocw-studio/Hugo exports, all vintages (data.json + pages/ +
           resources/; videos via video_metadata OR youtube_key fields)
  Legacy:  Plone export (OcwWeb/ trees) — native metadata scrape; structure
           comes from the heuristic HTML path (see ingest.py)
  Unknown: anything else — heuristic HTML path, AI split as opt-in fallback

Supported shapes (modern only):
  scholar      — unit/session two-level hierarchy (e.g. 18.06SC)
  flat_feature — feature folders: lecture-notes/, assignments/, exams/
  project_lab  — project-*/lab-* unit dirs
  seminar      — readings/-based spine
  video_only   — Lecture Videos resources as sessions

Library ingestion (zip → library.db) goes through ingest.ingest_zip(),
which unifies all of the above behind one entry point.
"""

from .manifest import CourseManifest, UnitNode, SessionNode, ResourceNode, Instructor
from .pipeline import preprocess

__all__ = [
    "preprocess",
    "CourseManifest", "UnitNode", "SessionNode", "ResourceNode", "Instructor",
]
