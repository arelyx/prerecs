#!/usr/bin/env python3
"""Transform raw yoink course dumps into frontend-friendly JSON.

Reads every file in `yoink/courses/` (output from fetch_courses.py) and
produces a parallel file in `yoink/structuredCourses/` whose contents is
an array of course objects compatible with `PrereqVisualizerReactFlow`.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Sequence

RAW_DIR = Path(__file__).resolve().parent / "courses"
OUT_DIR = Path(__file__).resolve().parent / "structuredCourses"

COURSE_LINE_RE = re.compile(r"^Course:\s*(.+)$", re.IGNORECASE)
CREDITS_LINE_RE = re.compile(r"^Credits:\s*(.+)$", re.IGNORECASE)
DESCRIPTION_LINE_RE = re.compile(r"^Description:\s*(.+)$", re.IGNORECASE)
REQUIREMENTS_LINE_RE = re.compile(r"^Requirements:\s*(.+)$", re.IGNORECASE)
PREREQ_PATTERN = re.compile(r"\b([A-Z]{2,6}\s?\d+[A-Z]?)\b")


@dataclass
class CourseRecord:
    identifier: str
    title: str
    description: str
    credits: str
    requirements: str

    @property
    def display_name(self) -> str:
        title = self.title
        if not title and self.identifier:
            title = self.identifier
        if self.identifier and self.identifier not in title:
            return f"{self.identifier} — {title}".strip(" —")
        return title or self.identifier or "Unknown Course"

    @property
    def reactflow_id(self) -> str:
        return re.sub(r"\s+", "", self.identifier)

    @property
    def prereqs(self) -> List[str]:
        matches = PREREQ_PATTERN.findall(self.requirements)
        normalized: List[str] = []
        for match in matches:
            key = re.sub(r"\s+", "", match)
            if key not in normalized:
                normalized.append(key)
        return normalized

    def to_dict(self) -> Dict[str, object]:
        return {
            "id": self.reactflow_id,
            "name": self.display_name,
            "description": self.description or "No description provided.",
            "credits": self.credits or "Unspecified",
            "prereqs": self.prereqs,
            "prereqGroups": [],
            "rawRequirements": self.requirements,
        }


def parse_course_text(text: str) -> CourseRecord:
    identifier = ""
    title = ""
    description = ""
    credits = ""
    requirements = ""

    for line in (l.strip() for l in text.splitlines()):
        if not line:
            continue
        if match := COURSE_LINE_RE.match(line):
            course_line = match.group(1)
            if "—" in course_line:
                left, right = course_line.split("—", 1)
            elif "-" in course_line:
                left, right = course_line.split("-", 1)
            else:
                left, right = course_line, ""
            identifier = left.strip()
            title = right.strip()
        elif match := DESCRIPTION_LINE_RE.match(line):
            description = match.group(1).strip()
        elif match := CREDITS_LINE_RE.match(line):
            credits = match.group(1).strip()
        elif match := REQUIREMENTS_LINE_RE.match(line):
            requirements = match.group(1).strip()
    return CourseRecord(
        identifier=identifier,
        title=title,
        description=description,
        credits=credits,
        requirements=requirements,
    )


def load_raw_courses(path: Path) -> Dict[str, str]:
    return json.loads(path.read_text(encoding="utf-8"))["courses"]


def build_structured_courses(raw_entries: Dict[str, str]) -> Sequence[Dict[str, object]]:
    structured = []
    for text in raw_entries.values():
        record = parse_course_text(text)
        structured.append(record.to_dict())
    return structured


def main() -> int:
    if not RAW_DIR.exists():
        raise SystemExit("No raw course data found. Run fetch_courses.py first.")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for raw_file in sorted(RAW_DIR.glob("*.json")):
        with raw_file.open("r", encoding="utf-8") as fh:
            payload = json.load(fh)
        structured = build_structured_courses(payload["courses"])
        out_path = OUT_DIR / raw_file.name
        out_path.write_text(json.dumps(
            {
                "department": payload.get("department"),
                "slug": payload.get("slug"),
                "url": payload.get("url"),
                "generated_at": payload.get("generated_at"),
                "courses": structured,
            },
            indent=2,
            ensure_ascii=False,
        ))
        print(f"Structured {len(structured):4d} courses → {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

