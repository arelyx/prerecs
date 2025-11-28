#!/usr/bin/env python3
"""Fetch UCSC catalog course data per department as raw text dumps.

This script crawls the general catalog Courses page to discover every
department link. For each department it scrapes all course listings and
stores them as JSON in `yoink/courses/<department-slug>.json`.

Each JSON file contains:
{
  "department": "<display name>",
  "slug": "<url slug>",
  "url": "<source url>",
  "generated_at": "<iso timestamp>",
  "courses": {
      "<CourseCode — Title>": "multi-line text blob"
  }
}

The multi-line blob is a normalized text representation that later scripts
can parse to build structured prerequisite data.
"""

from __future__ import annotations

import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

BASE_URL = "https://catalog.ucsc.edu"
COURSES_ROOT = f"{BASE_URL}/en/current/general-catalog/courses"
REQUEST_TIMEOUT = 30
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    )
}

ROOT_DIR = Path(__file__).resolve().parent
COURSE_DIR = ROOT_DIR / "courses"


@dataclass
class DepartmentLink:
    name: str
    href: str

    @property
    def slug(self) -> str:
        return self.href.rstrip("/").split("/")[-1]

    @property
    def url(self) -> str:
        return f"{BASE_URL}{self.href}"


def fetch_html(url: str) -> BeautifulSoup:
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "html.parser")


def discover_departments() -> List[DepartmentLink]:
    soup = fetch_html(COURSES_ROOT)
    nav = soup.select_one("#navLocal")
    if not nav:
        raise RuntimeError("Unable to locate #navLocal list on catalog page")

    # Departments appear under the Courses node; capture all hrefs in that subtree.
    dept_links: Dict[str, DepartmentLink] = {}
    for anchor in nav.select("li.hasChildren > a[href^='/en/current/general-catalog/courses/']"):
        href = anchor.get("href")
        text = anchor.get_text(strip=True)
        if not href or href.rstrip("/") == "/en/current/general-catalog/courses":
            continue
        dept_links[href] = DepartmentLink(name=text, href=href)
    return sorted(dept_links.values(), key=lambda d: d.name.lower())


def first_text(node: Tag, selector: str) -> str:
    found = node.select_one(selector)
    if not found:
        return ""
    text = found.get_text(" ", strip=True)
    return text.strip()


def normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def extract_course_blocks(soup: BeautifulSoup) -> Iterable[Tag]:
    for course_header in soup.select("h2.course-name"):
        yield course_header


def collect_section_text(course_header: Tag) -> Dict[str, str]:
    """Return normalized parts (description, credits, requirements)."""
    description = ""
    credits = ""
    requirements = ""

    for sibling in course_header.next_siblings:
        if isinstance(sibling, Tag):
            if sibling.name == "h2" and "course-name" in sibling.get("class", []):
                break
            if sibling.name == "div" and "desc" in sibling.get("class", []):
                text = normalize_whitespace(sibling.get_text(" ", strip=True))
                if text:
                    description = description or text
            elif sibling.name == "div" and "sc-credithours" in sibling.get("class", []):
                credits = normalize_whitespace(sibling.get_text(" ", strip=True))
            elif sibling.name == "div" and "extraFields" in sibling.get("class", []):
                text = normalize_whitespace(sibling.get_text(" ", strip=True))
                if text:
                    requirements = text
        elif isinstance(sibling, NavigableString):
            continue
    return {"description": description, "credits": credits, "requirements": requirements}


def build_course_entry(course_header: Tag) -> Dict[str, str]:
    anchor = course_header.find("a")
    if not anchor:
        raise ValueError("Course header missing link")

    code_span = anchor.find("span")
    course_code = normalize_whitespace(code_span.get_text()) if code_span else ""
    full_title = normalize_whitespace(anchor.get_text(" ", strip=True))
    course_title = full_title
    if course_code and full_title.upper().startswith(course_code.upper()):
        course_title = full_title[len(course_code) :].lstrip("—- ").strip()

    pieces = collect_section_text(course_header)
    description = pieces["description"] or "No description provided."
    credits = pieces["credits"].replace("Credits ", "").strip() or "Unspecified"
    requirements = pieces["requirements"] or "No additional requirements listed."

    display_name = f"{course_code} — {course_title}".strip(" —")
    lines = [
        f"Course: {display_name}",
        f"Credits: {credits}",
        f"Description: {description}",
        f"Requirements: {requirements}",
    ]
    return {
        "key": display_name,
        "text": "\n".join(lines),
    }


def scrape_department(dept: DepartmentLink) -> Dict[str, str]:
    soup = fetch_html(dept.url)
    entries = {}
    for header in extract_course_blocks(soup):
        entry = build_course_entry(header)
        entries[entry["key"]] = entry["text"]
    return entries


def write_department_file(dept: DepartmentLink, courses: Dict[str, str]) -> None:
    COURSE_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "department": dept.name,
        "slug": dept.slug,
        "url": dept.url,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "courses": courses,
    }
    out_path = COURSE_DIR / f"{dept.slug}.json"
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(f"Wrote {len(courses):4d} courses → {out_path}")


def main() -> int:
    departments = discover_departments()
    print(f"Discovered {len(departments)} department course pages.")
    for dept in departments:
        try:
            course_map = scrape_department(dept)
        except Exception as exc:  # pragma: no cover - best effort logging
            print(f"[ERROR] Failed to scrape {dept.name}: {exc}", file=sys.stderr)
            continue
        write_department_file(dept, course_map)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

