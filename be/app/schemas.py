"""Pydantic models shared across the backend."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field


class Course(BaseModel):
    id: str
    name: str
    description: str
    credits: str | None = None
    rawRequirements: str | None = None
    prereqGroups: List[List[str]] = Field(
        default_factory=list,
        description="Each inner list represents a group of prerequisite course IDs.",
    )


class DepartmentSummary(BaseModel):
    department: str
    slug: str
    url: str | None = None


class CourseCatalog(BaseModel):
    department: str
    slug: str
    url: str | None = None
    generated_at: str | None = Field(
        default=None,
        description="Timestamp when the catalog data was generated.",
    )
    courses: List[Course] = Field(
        default_factory=list,
        description="Ordered list of structured courses for the department.",
    )


class CourseSummary(BaseModel):
    id: str
    name: str


class CourseDetail(BaseModel):
    department: str
    slug: str
    generated_at: str | None = None
    course: Course
    prerequisites: List[Course] = Field(
        default_factory=list,
        description="Courses within the same catalog that feed into the selected course.",
    )
    postrequisites: List[Course] = Field(
        default_factory=list,
        description="Courses within the same catalog that depend on the selected course.",
    )
    missing_prereq_ids: List[str] = Field(
        default_factory=list,
        description="Prerequisite IDs referenced by the course but not found in any catalog.",
    )
    external_prereqs: List["ExternalCourseRef"] = Field(
        default_factory=list,
        description="Prerequisite courses from other departments/catalogs.",
    )
    related_courses: List[Course] = Field(
        default_factory=list,
        description="All courses within the catalog that lie in the prerequisite/postrequisite chain.",
    )


class ExternalCourseRef(BaseModel):
    slug: str
    department: str
    course: Course


