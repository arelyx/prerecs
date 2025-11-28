"""Helpers for loading course data into memory."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict

from .schemas import CourseCatalog

BACKEND_ROOT = Path(__file__).resolve().parents[1]
COURSE_DATA_DIR = BACKEND_ROOT / "courseData"


def load_course_catalogs(courses_dir: Path | None = None) -> Dict[str, CourseCatalog]:
    """Load every course catalog JSON file into memory.

    Args:
        courses_dir: Override path for course JSON files. Defaults to the
            backend `courseData` directory.

    Returns:
        Mapping of catalog slug -> CourseCatalog.
    """

    directory = courses_dir or COURSE_DATA_DIR
    if not directory.exists():
        raise FileNotFoundError(f"Courses directory not found: {directory}")

    catalogs: Dict[str, CourseCatalog] = {}
    for file_path in directory.glob("*.json"):
        catalog = _load_catalog_file(file_path)
        slug = catalog.slug or file_path.stem
        catalogs[slug] = catalog

    if not catalogs:
        raise RuntimeError(f"No course files found in {directory}")

    return catalogs


def _load_catalog_file(path: Path) -> CourseCatalog:
    with path.open("r", encoding="utf-8") as course_file:
        payload = json.load(course_file)

    return CourseCatalog.model_validate(payload)


