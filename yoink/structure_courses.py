#!/usr/bin/env python3
"""
structure_courses.py

Gemini-backed prerequisite parsing pipeline with batching and incremental writes.

Flow:
1. Read raw course dumps from `yoink/courses/`
2. Extract deterministic fields (id, name, description, credits, rawRequirements)
3. Skip LLM calls for courses already present in `structuredCourses`
4. Send new courses to Gemini Flash 2.5 in batches of 30 to interpret prereq logic
5. After each batch response, immediately persist the department JSON so no work is lost
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path
from typing import Dict, List

from google import genai

ROOT = Path(__file__).resolve().parent
RAW_DIR = ROOT / "courses"
OUT_DIR = ROOT / "structuredCourses"
OUT_DIR.mkdir(exist_ok=True)

KEY_FILE = ROOT / "key"
MODEL_NAME = "gemini-2.5-flash-lite"
BATCH_SIZE = 30

COURSE_LINE_RE = re.compile(r"^Course:\s*(.+)$", re.IGNORECASE)
CREDITS_RE = re.compile(r"^Credits:\s*(.+)$", re.IGNORECASE)
DESCRIPTION_RE = re.compile(r"^Description:\s*(.+)$", re.IGNORECASE)
REQUIREMENTS_RE = re.compile(r"^Requirements:\s*(.+)$", re.IGNORECASE)


def log(message: str):
    """Print with flush so Cursor terminals show incremental progress."""
    print(message, flush=True)


def load_api_client() -> genai.Client:
    """Return an authenticated Gemini client using the plaintext key file."""
    if not KEY_FILE.exists():
        raise SystemExit("ERROR: yoink/key missing. Place your Gemini API key there.")
    api_key = KEY_FILE.read_text(encoding="utf-8").strip()
    if not api_key:
        raise SystemExit("ERROR: yoink/key is empty. Put only the API key inside.")
    return genai.Client(api_key=api_key)


def parse_raw_course_text(text: str) -> dict:
    """
    Extract deterministic fields out of the raw course blob.
    Returns a dict with id, name, description, credits, rawRequirements.
    """
    identifier = ""
    title = ""
    description = ""
    credits = ""
    requirements = ""

    log("  • Parsing course blob...")
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if match := COURSE_LINE_RE.match(line):
            course_line = match.group(1).strip()
            if "—" in course_line:
                left, _ = course_line.split("—", 1)
            elif " - " in course_line:
                left, _ = course_line.split(" - ", 1)
            else:
                parts = course_line.split()
                left = parts[0] if parts else ""
            identifier = left.replace(" ", "")
            title = course_line
        elif match := DESCRIPTION_RE.match(line):
            description = match.group(1).strip()
        elif match := CREDITS_RE.match(line):
            credits = match.group(1).strip()
        elif match := REQUIREMENTS_RE.match(line):
            requirements = match.group(1).strip()

    log(f"    id={identifier or 'UNKNOWN'} credits={credits or 'NA'} req_len={len(requirements)}")

    return {
        "id": identifier,
        "name": title,
        "description": description,
        "credits": credits,
        "rawRequirements": requirements,
    }


BATCH_PROMPT_TEMPLATE = """
You are parsing prerequisite text for multiple university courses.

Input JSON array:
{course_payload}

Return strictly valid JSON:
{{
  "results": {{
    "COURSEID": [
      ["PREREQ1", "PREREQ2"],
      ["PREREQ3"]
    ]
  }}
}}

Rules:
- Each inner array is an OR group of acceptable courses.
- AND relationships must be represented as separate arrays.
- Normalize course codes by removing spaces (e.g., "CSE 12" -> "CSE12").
- Only include courses that explicitly appear in the input text.
- Every prerequisite you return must be a course identifier of the form LETTERS followed by DIGITS (optionally ending with an extra letter). If the text mentions concepts like “permission of instructor,” placement tests, GPA requirements, or anything that is not a course ID, you must NOT include it.
- If you are unsure whether a token is a course ID, exclude it.
- If a course has no prerequisites, map it to an empty list.
- Output only JSON. Do not include commentary.
"""


def parse_prereqs_batch(client: genai.Client, batch: List[dict]) -> Dict[str, List[List[str]]]:
    """Send a batch of courses to Gemini and return mapping id -> prereqGroups."""
    if not batch:
        return {}

    payload = [
        {"id": course["id"], "requirements": course.get("rawRequirements", "")}
        for course in batch
    ]
    prompt = BATCH_PROMPT_TEMPLATE.format(
        course_payload=json.dumps(payload, ensure_ascii=False, indent=2)
    )

    for attempt in range(3):
        try:
            log(f"    ↳ Gemini batch attempt {attempt + 1} for {len(batch)} courses")
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=prompt,
            )
            text = response.text.strip()
            text = text.replace("```json", "").replace("```", "").strip()
            data = json.loads(text)
            results = data.get("results", {})
            cleaned: Dict[str, List[List[str]]] = {}
            for cid, groups in results.items():
                course_groups: List[List[str]] = []
                if isinstance(groups, list):
                    for group in groups:
                        if isinstance(group, list):
                            normalized = [
                                str(item).strip()
                                for item in group
                                if str(item).strip()
                            ]
                            if normalized:
                                course_groups.append(normalized)
                cleaned[cid] = course_groups
            log(f"    ↳ Received batch results for {len(cleaned)} courses")
            return cleaned
        except Exception as exc:
            log(f"[WARN] Gemini batch error (attempt {attempt + 1}): {exc}")
            time.sleep(0.3)
    return {}


def load_existing_courses(path: Path) -> Dict[str, dict]:
    """Return mapping of course id -> existing structured record."""
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        log(f"[WARN] Failed to read existing structured file {path.name}: {exc}")
        return {}
    mapping: Dict[str, dict] = {}
    for course in payload.get("courses", []):
        cid = course.get("id")
        if cid:
            mapping[cid] = course
    return mapping


def write_department_output(meta: dict, records: Dict[str, dict], order: List[str], out_path: Path):
    """Persist department output in the original course order."""
    courses: List[dict] = []
    for cid in order:
        record = records.get(cid)
        if record:
            courses.append(record)
    payload = {
        "department": meta.get("department"),
        "slug": meta.get("slug"),
        "url": meta.get("url"),
        "generated_at": meta.get("generated_at"),
        "courses": courses,
    }
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    log(f" → persisted {len(courses)} courses to {out_path.name}")


def process_batch_and_flush(
    client: genai.Client,
    batch: List[dict],
    records: Dict[str, dict],
    order: List[str],
    meta: dict,
    out_path: Path,
):
    """Call Gemini for the batch, merge results, and flush to disk."""
    if not batch:
        return
    results = parse_prereqs_batch(client, batch)
    for course in batch:
        cid = course["id"]
        course["prereqGroups"] = results.get(cid, [])
        records[cid] = course
    write_department_output(meta, records, order, out_path)


def process_department_file(client: genai.Client, file_path: Path):
    """Process a single raw department JSON file with batching and incremental writes."""
    log(f"\nProcessing {file_path.name}")
    payload = json.loads(file_path.read_text(encoding="utf-8"))
    raw_courses = payload.get("courses", {})
    out_path = OUT_DIR / file_path.name
    existing = load_existing_courses(out_path)

    course_records: Dict[str, dict] = {}
    course_order: List[str] = []
    batch: List[dict] = []
    total_courses = len(raw_courses)

    for idx, (title, raw_blob) in enumerate(raw_courses.items(), start=1):
        log(f" Course {idx}/{total_courses} :: {title}")
        fields = parse_raw_course_text(raw_blob)
        cid = fields.get("id")
        if not cid:
            log("  ! Skipping course with missing id")
            continue
        course_order.append(cid)

        if cid in existing:
            log("    ↳ Already structured. Reusing stored prereqGroups.")
            stored = existing[cid]
            fields["prereqGroups"] = stored.get("prereqGroups", [])
            course_records[cid] = fields
            continue

        if not fields.get("rawRequirements"):
            log("    ↳ No requirements text; prereqGroups stays empty.")
            fields["prereqGroups"] = []
            course_records[cid] = fields
            continue

        log("    ↳ Queued for LLM batch.")
        batch.append(fields)

        if len(batch) == BATCH_SIZE:
            process_batch_and_flush(client, batch, course_records, course_order, payload, out_path)
            batch = []

    if batch:
        process_batch_and_flush(client, batch, course_records, course_order, payload, out_path)

    # Final write ensures departments with zero new LLM calls still get refreshed metadata.
    write_department_output(payload, course_records, course_order, out_path)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Convert raw UCSC course dumps into structured prerequisite JSON."
    )
    parser.add_argument(
        "--file",
        help="Optional single filename inside yoink/courses/ (e.g. cse-computer-science-and-engineering.json)",
    )
    return parser.parse_args()


def main():
    if not RAW_DIR.exists():
        raise SystemExit("ERROR: Raw directory missing. Run fetch_courses.py first.")

    args = parse_args()
    client = load_api_client()
    if args.file:
        target = RAW_DIR / args.file
        if not target.exists():
            raise SystemExit(f"ERROR: Requested file not found in courses/: {args.file}")
        raw_files = [target]
        log(f"Running in single-file mode for {args.file}.")
    else:
        raw_files = sorted(RAW_DIR.glob("*.json"))
        log(f"Found {len(raw_files)} department files.")

    for path in raw_files:
        process_department_file(client, path)
        time.sleep(0.05)

    log("All done.")


if __name__ == "__main__":
    main()

