"""
CourseManifest schema — v2.

Single source of truth for the structured output of the OCW preprocessor.
All adapters and shape builders write into this schema.
"""

from __future__ import annotations
from typing import Optional, Literal
from pydantic import BaseModel, Field


class Instructor(BaseModel):
    first_name: str = ""
    last_name: str = ""
    middle_initial: str = ""
    salutation: str = ""
    title: str = ""


class ResourceNode(BaseModel):
    slug: str
    uid: Optional[str] = None
    parent_uid: Optional[str] = None
    title: str
    description: str = ""
    primary_type: str
    secondary_types: list[str] = Field(default_factory=list)
    file_path: Optional[str] = None
    file_type: str = ""
    youtube_id: Optional[str] = None
    transcript_text: Optional[str] = None
    extracted_text: Optional[str] = None


class SessionNode(BaseModel):
    slug: str
    title: str
    overview: str = ""
    is_assessment: bool = False
    order: int = 0
    page_uid: Optional[str] = None
    resources: list[ResourceNode] = Field(default_factory=list)
    prerequisite_session_slugs: list[str] = Field(default_factory=list)


class UnitNode(BaseModel):
    slug: str
    title: str
    overview: str = ""
    order: int = 0
    sessions: list[SessionNode] = Field(default_factory=list)
    is_synthetic: bool = False


class CourseManifest(BaseModel):
    # Identity
    course_id: str
    extra_course_ids: list[str] = Field(default_factory=list)
    site_uid: str = ""
    legacy_uid: Optional[str] = None
    title: str

    # Provenance
    source_format: Literal["modern", "legacy", "archive"]
    detected_shape: Literal["scholar", "flat_feature", "project_lab", "seminar", "video_only"]
    shape_confidence: float = 0.0
    zip_sha256: str = ""
    manifest_version: str = "2.0"

    # Course metadata (from root data.json)
    description: str = ""
    department_numbers: list[str] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    topics: list[list[str]] = Field(default_factory=list)
    level: list[str] = Field(default_factory=list)
    term: str = ""
    year: str = ""
    instructors: list[Instructor] = Field(default_factory=list)
    learning_resource_types: list[str] = Field(default_factory=list)

    # Syllabus-extracted supplements (not in spec but needed by lesson planner)
    prerequisites: str = ""
    goals: str = ""

    # Structure
    units: list[UnitNode] = Field(default_factory=list)
    unlinked_resources: list[ResourceNode] = Field(default_factory=list)

    # Quality flags
    warnings: list[str] = Field(default_factory=list)
