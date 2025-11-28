"""FastAPI application serving course data."""

from __future__ import annotations

from typing import Dict, List

from fastapi import FastAPI, HTTPException

from .data_loader import load_course_catalogs
from .schemas import CourseCatalog, DepartmentSummary


def create_app() -> FastAPI:
    app = FastAPI(
        title="Prereqs Backend",
        description="Simple API for serving course catalog data.",
        version="0.1.0",
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
        catalogs = _get_course_catalogs(app)
        catalog = catalogs.get(slug)
        if not catalog:
            raise HTTPException(status_code=404, detail=f"Course catalog '{slug}' not found.")
        return catalog

    return app


def _get_course_catalogs(app: FastAPI) -> Dict[str, CourseCatalog]:
    catalogs = getattr(app.state, "course_catalogs", None)
    if catalogs is None:
        raise RuntimeError("Course catalogs not loaded; has startup event run?")
    return catalogs


app = create_app()


