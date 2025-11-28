# Course Prerequisite Visualizer

`yoink/` contains the scraping + structuring pipeline that feeds the frontend. Below is the workflow for keeping the data fresh.

## 1. Environment Setup

```bash
cd yoink
python3 -m venv venv
source venv/bin/activate
pip install google-genai requests beautifulsoup4
```

Place your Gemini API key (plaintext) in `yoink/key`.

## 2. Fetch Raw Course Data

```bash
cd yoink
python fetch_courses.py
```

This writes raw department JSON files into `yoink/courses/`.

## 3. Structure Courses with Gemini

```bash
cd yoink
source venv/bin/activate
python structure_courses.py
```

The script:

- Reads every file under `yoink/courses/`
- Parses deterministic fields (id, name, description, credits, rawRequirements)
- Calls Gemini Flash Lite in batches to interpret prerequisite logic
- Writes structured department files to `yoink/structuredCourses/`

### Single-Department Runs

To reprocess just one department (e.g., CSE) without touching the rest:

```bash
cd yoink
python structure_courses.py --file cse-computer-science-and-engineering.json
```

Tip: delete the existing structured file before a rerun if you want the course to be re-sent to the LLM.

## 4. Output

`yoink/structuredCourses/*.json` is the canonical, LLM-structured dataset consumed by the frontend. Each course now includes `prereqGroups`, where each inner array represents an OR group, and AND relationships are captured by separate arrays in sequence.

## Backend (FastAPI)

Minimal API for serving the static course data lives under `be/`. The repository already includes structured catalogs in `be/courseData/`, so you can run the backend immediately. If you refresh data via `yoink/`, copy the resulting files into `be/courseData/` and restart the server.

```bash
cd be
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

On startup the API loads every JSON file under `be/courseData/` into memory and exposes:

- `GET /courses` – returns department summaries (`department`, `slug`, optional `url`).
- `GET /courses/{slug}` – returns the full catalog for the requested department (e.g., `cse-computer-science-and-engineering`).
