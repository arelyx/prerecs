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


