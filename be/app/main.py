"""FastAPI application serving course data."""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .data_loader import load_course_catalogs
from .schemas import (
    Course,
    CourseCatalog,
    CourseDetail,
    CourseSummary,
    DepartmentSummary,
    ExternalCourseRef,
)


def create_app() -> FastAPI:
    app = FastAPI(
        title="Prereqs Backend",
        description="Simple API for serving course catalog data.",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.on_event("startup")
    def startup_event() -> None:
        app.state.course_catalogs = load_course_catalogs()

    @app.get("/courses", response_model=List[DepartmentSummary])
    def list_departments() -> List[DepartmentSummary]:
        catalogs = _get_course_catalogs(app)
        return [
            DepartmentSummary(department=catalog.department, slug=catalog.slug, url=catalog.url)
            for catalog in sorted(catalogs.values(), key=lambda catalog: catalog.slug)
        ]

    @app.get("/courses/{slug}", response_model=CourseCatalog)
    def get_course(slug: str) -> CourseCatalog:
        return _get_catalog_or_404(app, slug)

    @app.get("/courses/{slug}/search", response_model=List[CourseSummary])
    def search_courses(
        slug: str,
        q: str = Query(
            "",
            description="Substring to match against course ID or name.",
        ),
    ) -> List[CourseSummary]:
        catalog = _get_catalog_or_404(app, slug)
        query = q.strip().lower()

        matches: List[CourseSummary] = []
        for course in catalog.courses:
            if not query or query in course.id.lower() or query in course.name.lower():
                matches.append(CourseSummary(id=course.id, name=course.name))
            if len(matches) >= 25:
                break
        return matches

    @app.get("/courses/{slug}/classes/{course_id}", response_model=CourseDetail)
    def get_course_detail(slug: str, course_id: str) -> CourseDetail:
        catalog = _get_catalog_or_404(app, slug)
        all_catalogs = _get_course_catalogs(app)
        return _build_course_detail(catalog, course_id, all_catalogs)

    return app


def _get_course_catalogs(app: FastAPI) -> Dict[str, CourseCatalog]:
    catalogs = getattr(app.state, "course_catalogs", None)
    if catalogs is None:
        raise RuntimeError("Course catalogs not loaded; has startup event run?")
    return catalogs


def _get_catalog_or_404(app: FastAPI, slug: str) -> CourseCatalog:
    catalogs = _get_course_catalogs(app)
    catalog = catalogs.get(slug)
    if not catalog:
        raise HTTPException(status_code=404, detail=f"Course catalog '{slug}' not found.")
    return catalog


def _normalize_course_id(course_id: str) -> str:
    return "".join(course_id.split()).lower()


def _prereq_ids(prereq_groups: List[List[str]] | None) -> List[str]:
    ids: List[str] = []
    if not prereq_groups:
        return ids
    for group in prereq_groups:
        for course_id in group:
            if course_id:
                ids.append(course_id)
    return ids


def _build_course_detail(
    catalog: CourseCatalog, course_id: str, all_catalogs: Dict[str, CourseCatalog]
) -> CourseDetail:
    index = {_normalize_course_id(course.id): course for course in catalog.courses}
    children: Dict[str, set[str]] = defaultdict(set)
    for course in catalog.courses:
        course_norm = _normalize_course_id(course.id)
        for prereq_id in _prereq_ids(course.prereqGroups):
            children[_normalize_course_id(prereq_id)].add(course_norm)

    normalized = _normalize_course_id(course_id)
    course = index.get(normalized)
    if not course:
        raise HTTPException(status_code=404, detail=f"Course '{course_id}' not found in '{catalog.slug}'.")

    ancestor_ids, missing_prereq_ids = _collect_ancestor_ids(index, normalized)
    descendant_ids = _collect_descendant_ids(children, normalized)

    prereq_courses = _courses_in_catalog_order(catalog, ancestor_ids)
    postreq_courses = _courses_in_catalog_order(catalog, descendant_ids)

    # Resolve external prereqs from other catalogs
    external_prereqs, still_missing = _resolve_external_prereqs(
        missing_prereq_ids, catalog.slug, all_catalogs
    )

    related_ids = {normalized, *ancestor_ids, *descendant_ids}
    related_courses = [
        _filter_course_prereqs(course, related_ids)
        for course in catalog.courses
        if _normalize_course_id(course.id) in related_ids
    ]

    return CourseDetail(
        department=catalog.department,
        slug=catalog.slug,
        generated_at=catalog.generated_at,
        course=course,
        prerequisites=prereq_courses,
        postrequisites=postreq_courses,
        missing_prereq_ids=still_missing,
        external_prereqs=external_prereqs,
        related_courses=related_courses or [course],
    )


def _collect_ancestor_ids(index: Dict[str, Course], start_id: str) -> tuple[set[str], List[str]]:
    visited: set[str] = set()
    missing: List[str] = []
    missing_seen: set[str] = set()

    def dfs(current_id: str) -> None:
        course = index.get(current_id)
        if not course:
            return
        for prereq_id in _prereq_ids(course.prereqGroups):
            normalized = _normalize_course_id(prereq_id)
            match = index.get(normalized)
            if not match:
                if prereq_id not in missing_seen:
                    missing_seen.add(prereq_id)
                    missing.append(prereq_id)
                continue
            if normalized in visited:
                continue
            visited.add(normalized)
            dfs(normalized)

    dfs(start_id)
    return visited, missing


def _collect_descendant_ids(children: Dict[str, set[str]], start_id: str) -> set[str]:
    visited: set[str] = set()
    stack = list(children.get(start_id, []))
    while stack:
        current = stack.pop()
        if current in visited:
            continue
        visited.add(current)
        stack.extend(children.get(current, []))
    return visited


def _courses_in_catalog_order(catalog: CourseCatalog, id_set: set[str]) -> List[Course]:
    ordered: List[Course] = []
    for course in catalog.courses:
        if _normalize_course_id(course.id) in id_set:
            ordered.append(course)
    return ordered


def _filter_course_prereqs(course: Course, allowed_ids: set[str]) -> Course:
    filtered_groups: List[List[str]] = []
    for group in course.prereqGroups or []:
        filtered = [cid for cid in group if _normalize_course_id(cid) in allowed_ids]
        if filtered:
            filtered_groups.append(filtered)
    return course.model_copy(update={"prereqGroups": filtered_groups})


def _resolve_external_prereqs(
    missing_ids: List[str],
    current_slug: str,
    all_catalogs: Dict[str, CourseCatalog],
) -> tuple[List[ExternalCourseRef], List[str]]:
    """Look up missing prereq IDs in other catalogs.

    Returns:
        A tuple of (found external courses, still missing IDs).
    """
    external: List[ExternalCourseRef] = []
    still_missing: List[str] = []
    seen: set[str] = set()

    for prereq_id in missing_ids:
        normalized = _normalize_course_id(prereq_id)
        if normalized in seen:
            continue
        seen.add(normalized)

        found = False
        for slug, catalog in all_catalogs.items():
            if slug == current_slug:
                continue
            for course in catalog.courses:
                if _normalize_course_id(course.id) == normalized:
                    external.append(
                        ExternalCourseRef(slug=slug, department=catalog.department, course=course)
                    )
                    found = True
                    break
            if found:
                break

        if not found:
            still_missing.append(prereq_id)

    return external, still_missing


app = create_app()


