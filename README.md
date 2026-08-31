# ULPIN Digital Twin

A cadastral parcel explorer: FastAPI + Pandas + Shapely backend, React + Leaflet + Three.js frontend.
Reads the three local CSVs, does live OpenStreetMap/Overpass geometry matching, builds a per-floor
volumetric 3D model from DEM/DSM/floor data, and runs a deterministic 2D/vertical/3D overlap check
between any two parcels. No paid API is required to run the core prototype.

## Project layout

```
data/                        the three source CSVs
backend/                     FastAPI service
  app/
    data_loader.py           CSV normalization, join, validation
    geometry.py               Overpass query + confidence scoring + local cache
    overlap.py                Shapely-based 2D/vertical/3D overlap engine
    main.py                   API routes
  requirements.txt
  .env.example
frontend/                    React (Vite) app
  src/
    App.jsx                  dashboard shell, tabs, demo mode
    components/               Map, 3D viewer, floor controls, overlap panel, etc.
  .env.example
```

## Run it

**Backend**
```bash
cd backend
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt
cp .env.example .env      # optional — works with all blank values
uvicorn app.main:app --reload --port 8000
```
Visit `http://localhost:8000/docs` for interactive API docs.

**Frontend** (separate terminal)
```bash
cd frontend
npm install
cp .env.example .env      # points at http://localhost:8000 by default
npm run dev
```
Visit `http://localhost:5173`.

Both were built and smoke-tested in this environment: `uvicorn` served all endpoints correctly against
the real CSVs, and `npm run build` / `npm run preview` produced a working production bundle.

## What changed from the single-HTML prototype

The old `ulpin_explorer.html` did four things client-side: load the CSVs, render a parcel list, run a
live Overpass geometry match with the same distance/area/containment/validity scoring, and extrude one
volumetric shape in Three.js. All of that logic is preserved — the scoring weights, the match threshold,
the "never call an estimate official" rule, and the Overpass fallback URL are unchanged. What's new:

- **Real backend** (`FastAPI` + `Pandas` + `Shapely`) instead of embedded JS arrays — CSVs are parsed,
  column names are normalized against a small alias table rather than hard-coded, records are joined on
  ULPIN, and missing values / invalid coordinates / duplicate ULPINs are detected and reported via
  `/api/stats`.
- **Height validation** — `DSM − DEM` is calculated and compared against the registered building height,
  shown as `✓ HEIGHT CONSISTENT` or `⚠ HEIGHT DATA MISMATCH`. Source data is never silently edited.
- **Per-floor 3D model** — each floor is its own extruded mesh at its real elevation interval, not one
  solid block. You can show all, hide all, or isolate a single floor, and see that floor's bottom/top
  elevation and height.
- **Nearby parcels** — haversine distance from the selected ULPIN to every other parcel in the dataset,
  clickable to switch selection, also plotted on the map.
- **Deterministic overlap engine** (`overlap.py`) — no model inference involved:
  - *Horizontal*: Shapely polygon intersection, but **only** when both parcels have a `MATCHED` OSM
    footprint; otherwise it reports `2D OVERLAP: UNVERIFIED` rather than guessing.
  - *Vertical*: plain arithmetic on `DEM` → `DEM + height` ranges, broken into floor intervals.
  - *3D*: `🔴 3D OVERLAP DETECTED` only when horizontal intersects **and** vertical ranges intersect;
    `⚠ 2D OVERLAP / 3D OVERLAP: NO` when only horizontal; `⚠ 3D OVERLAP: UNVERIFIED` when geometry
    wasn't verified for one or both parcels.
- **Compare-with-neighbour mode** — pick a second ULPIN, see both buildings' 3D models side by side with
  the overlapping floors tinted red, and the full overlap report underneath.
- **Geometry caching** — Overpass results are cached to `backend/.cache/geometry_cache.json` for 6 hours
  so repeated lookups for the same ULPIN don't repeatedly hit the external API.
- **Data Sources panel** now reflects real status (CSV connected, Overpass tested/untested/unavailable,
  Bhuvan/OpenTopography shown honestly as "token not configured" rather than a fake green light).
- **Demo mode** ("Try demo" button) walks CSV → Map → Property → Geometry → 3D → Floors → Nearby →
  Overlap automatically using the first parcel and its nearest neighbour.

## Fully working (verified in this environment)

- CSV load, normalize, join, validation (`/api/health`, `/api/stats`)
- ULPIN search, single-record lookup, 404 handling for invalid ULPIN
- Multi-provider geometry failover: `NETWORK_ERROR` / `HTTP_5XX` / `TIMEOUT` / `VALID_EMPTY_RESULT` /
  `VALID_CANDIDATE_RESULT` are classified distinctly; failed providers are skipped immediately at the
  same radius rather than retried; radius only escalates after a real answer; provider failure vs.
  "verified no building" are never conflated (`UNAVAILABLE` vs `NO_CANDIDATES`)
- **Real matched OSM footprint → 3D model**: when geometry status is `MATCHED`, the actual polygon
  (validated/repaired with Shapely, arbitrary vertex count) is converted to local meters around the
  ULPIN's own coordinate and extruded per floor — verified end-to-end with a 7-vertex non-rectangular
  hexagon mirroring the reported way `#359513743` match (98% confidence, 0.8m, 96% area similarity);
  confirmed the *same* npm `three` package genuinely triangulates it (20 triangles/floor — 8 for the
  hexagonal caps + 12 for the 6 side walls — not a 4-wall rectangle)
- Height priority fixed: `DSM−DEM` → registered height → `floors × floor_height`, each result tagged
  with `heightSource` so it's clear which one is driving the elevations, without touching the raw CSV
  fields
- Height validation (DSM−DEM vs registered height)
- Nearby-parcel distance ranking
- Per-floor volumetric model — GROUND/FLOOR N/**ROOF** cap — with isolate/hide/show controls, real
  OrbitControls (drag-orbit, scroll-zoom, right-drag-pan, Reset view), and a camera that auto-frames
  whatever shape the footprint actually is (bounding-box fit, not a fixed rectangular assumption)
- Visible provenance badge: `VERIFIED BUILDING FOOTPRINT` (source/confidence/distance/area
  similarity/OSM way) or `3D VOLUMETRIC REPRESENTATION` (estimated), always paired with
  `Cadastral boundary: NOT AVAILABLE`
- Deterministic 2D/vertical/3D overlap engine, extended to compute a real Shapely intersection polygon
  and a 3D overlap **volume in m³** (horizontal intersection area × vertical overlap height) when both
  parcels are `MATCHED`; the overlap region is rendered as its own extruded volume in the UI — verified
  the no-false-positive rule explicitly (horizontal miss forces `3D OVERLAP: NO` even when vertical
  ranges are identical)
- Floor-level overlap now checked against the *actual* computed overlap interval (not the other
  building's full range)
- Data quality panel, data-source attribution tags, cost panel, demo mode
- Three.js is lazy-loaded (confirmed via `npm run build`: it and OrbitControls ship as separate chunks,
  main bundle dropped from ~803KB to ~320KB) and only fetched when a 3D viewer actually mounts
- Graceful fallback to `EXACT GEOMETRY UNAVAILABLE` / estimated visualization when Overpass can't be
  reached — confirmed by actually forcing that failure path

## Depends on an external service (works, but needs real internet)

- **OpenStreetMap tiles** and **Overpass geometry matching** — the sandbox this was built in blocks
  outbound requests to `overpass-api.de` / `overpass.kumi.systems` at the network level (its own egress
  allowlist, not an app bug — confirmed with a direct `curl`, which came back `403 host_not_allowed`).
  On your machine, with normal internet access, `geometry.py`'s live Overpass call and the map's OSM
  tiles will both work — the scoring logic itself was verified separately with synthetic Overpass-shaped
  data and passed.
- **Bhuvan** and **OpenTopography** — intentionally left disabled. Both need a secret key, and this app
  keeps that key server-side only (never in frontend JS); if you add `BHUVAN_API_TOKEN` /
  `OPENTOPOGRAPHY_API_KEY` to `backend/.env`, `/api/health` will report them as configured, but the
  routes that would call them still need to be added — see Limitations.
- **Google Open Buildings** — not integrated. It has no simple public per-coordinate REST endpoint (it's
  distributed via Earth Engine / BigQuery), so rather than fake it, it's labeled "not integrated" in the
  Data Sources panel and in the geometry priority list it's simply skipped.

## Remaining limitations

- Bhuvan and OpenTopography have `.env` slots and are reported correctly in `/api/health`, but no route
  actually calls them yet — DEM/DSM come entirely from your CSVs, which the spec allows as the default.
- PostgreSQL/PostGIS was listed as optional in the brief and isn't wired in — the dataset (5 parcels) is
  small enough that Pandas in memory is the honest choice; swapping in PostGIS later would mean adding a
  `db.py` alongside `data_loader.py` without changing the API contract.
- The overlap engine was verified with synthetic Overpass-shaped data in this sandbox, not a live
  Overpass response, because that host is blocked here — worth re-checking against a real match once you
  run it with open internet.
- The estimated (unmatched) footprint is a regular square sized to match the CSV area, rotated to no
  particular real-world orientation — it's for the volumetric view only and is always labeled
  `3D VOLUMETRIC REPRESENTATION`, never treated as a real shape by the overlap engine (unmatched
  parcels can only ever produce `2D OVERLAP: UNVERIFIED`).

## API endpoints

```
GET /api/health
GET /api/stats
GET /api/ulpins?q=
GET /api/ulpin/{ulpin}
GET /api/ulpin/{ulpin}/geometry
GET /api/ulpin/{ulpin}/nearby
GET /api/ulpin/{ulpin}/3d
GET /api/ulpin/{ulpin}/overlap?with={other_ulpin}
```
