"""Helpers for loading course data into memory."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable

from .schemas import CourseCatalog

BACKEND_ROOT = Path(__file__).resolve().parents[1]
COURSE_DATA_DIR = BACKEND_ROOT / "courseData"
PROJECT_ROOT = BACKEND_ROOT.parent
STRUCTURED_COURSE_DIR = PROJECT_ROOT / "yoink" / "structuredCourses"


def load_course_catalogs(courses_dir: Path | None = None) -> Dict[str, CourseCatalog]:
    """Load every course catalog JSON file into memory.

    Args:
        courses_dir: Override path for course JSON files. Defaults to searching
            the backend `courseData` directory plus any structured courses
            generated in `yoink/structuredCourses`.

    Returns:
        Mapping of catalog slug -> CourseCatalog.
    """

    directories = _resolve_course_directories(courses_dir)
    catalogs: Dict[str, CourseCatalog] = {}

    for directory in directories:
        if not directory.exists():
            continue

        for file_path in directory.glob("*.json"):
            catalog = _load_catalog_file(file_path)
            slug = catalog.slug or file_path.stem
            catalogs[slug] = catalog

    if not directories:
        raise FileNotFoundError("No course data directories were found.")

    if not catalogs:
        inspected = ", ".join(str(path) for path in directories)
        raise RuntimeError(f"No course files found in: {inspected}")

    return catalogs


def _resolve_course_directories(override_directory: Path | None) -> Iterable[Path]:
    if override_directory is not None:
        if not override_directory.exists():
            raise FileNotFoundError(f"Courses directory not found: {override_directory}")
        return [override_directory]

    directories = [COURSE_DATA_DIR]
    if STRUCTURED_COURSE_DIR.exists():
        directories.append(STRUCTURED_COURSE_DIR)
    return directories


def _load_catalog_file(path: Path) -> CourseCatalog:
    with path.open("r", encoding="utf-8") as course_file:
        payload = json.load(course_file)

    return CourseCatalog.model_validate(payload)


