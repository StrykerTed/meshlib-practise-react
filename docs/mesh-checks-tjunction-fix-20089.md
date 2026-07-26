# Mesh Checks — T-junction false-positive holes fix (ADO #20089)

**Status:** implemented & verified in `meshlib` (native + WASM); pending circulation to Syklone.
**Scope:** Syklone **mesh checks only** (detection). Syklone has no repair pipeline — repair is future ADO work.

## The bug

The Syklone mesh checks reported false-positive *holes* on parts that are geometrically
watertight but contain **T-junctions** — a vertex lying on the interior of another triangle's
edge, from non-conforming triangulation. The long edge then has no matching twin half-edge and
is flagged as a boundary edge, so a closed, manufacturable surface is mislabelled as having holes.

Reference part: `meshlib-react-fe/stl/bridge-multiunderside.stl` (binary STL, 20 verts, 28 tris,
1 component — a closed bridge solid). **Before the fix:**

| check | field | value |
|---|---|---|
| `findholes_v2` | count | **6** |
| `bad_edges` | bad_contours_count | **8** |
| `bad_edges` | boundary_edges_count | 20 |
| `bad_edges` | bad_edges_count | 20 |

This is the *geometrically*-watertight vs *topologically*-watertight distinction: the boundary
edges genuinely have a single incident triangle (topologically open), but the long edge is exactly
tiled by collinear shorter edges, so there is no real gap.

## Why there were two different "holes" code paths

The two Syklone checks reach "holes" by **completely independent** code — which is also why they
disagreed (6 vs 8) on the bridge:

| Check | Source | How it finds holes |
|---|---|---|
| `findholes_v2` | `web/wasm_findholes_v2/` compiles `web/wasm_fill_holes/fill_holes_api.cpp` → `meshlib_find_holes_stl` | Topological: `GenerateHalfEdges()` → `FillHoles_C::FindHoles` walks half-edge loops |
| `bad_edges` | `web/wasm_bad_edges/bad_edges_api.cpp` → `ComputeBadEdgeStats` → `CountBadEdgeContours` | Self-contained: builds its own edge→incidence map and an undirected vertex-adjacency graph; never generates half-edges |

`findholes_v2` is the topological path and shares code with hole *filling* (detection == fillable).
`bad_edges` is a lightweight edge-health report (boundary / non-manifold / orientation / manifold
counts) that happens to also count "contours". Two graphs over the same boundary edges → disagreement.

**Recommendation (future):** unify on a single topology pass feeding all checks. Not done here to
keep this fix scoped; the new helper below is deliberately *shared* by both paths as the first step.
Tracked for the upcoming mesh-checks code review.

## The fix — Option 1: honest reclassify (geometry untouched)

A new shared helper classifies a boundary loop/contour as a **T-junction artifact** (not a hole)
using a **collinear-coverage** test, computed globally so it is independent of how each check splits
the boundary into loops:

> Group all boundary segments by their carrier line. On each line, project segments to 1-D
> intervals. A segment is a T-junction artifact iff every sub-interval of its span is overlaid by
> **even (≥2) multiplicity** — i.e. the long edge is exactly tiled by collinear shorter edges. A
> real hole edge is covered exactly once (odd) and is kept. A loop/contour is dropped only if **all**
> its edges are T-junction artifacts (so a real hole that merely *touches* a T-junction is preserved).

This was prototyped and validated in Python against the whole fixture library before porting to C++
(every real-hole / watertight fixture showed **0** covered edges; only genuine T-junction meshes
showed coverage).

### Files changed (`meshlib`)

1. **`lib/extended/include/mesh/extended/algorithms/fill_holes.h`**
   New static method `FillHoles_C::ClassifyTJunctionSegments(const std::vector<double>& segments, double eps = 1e-4)`
   → `std::vector<char>` (1 = T-junction artifact). Pure geometry on flat `{ax,ay,az,bx,by,bz}` doubles,
   so both translation units share one routine. Exported via `MESH_EXTENDED_EXPORT`.

2. **`lib/extended/src/algorithms/fill_holes.cpp`**
   - Defines `ClassifyTJunctionSegments` (line grouping → 1-D projection → even-multiplicity sweep).
   - In `FindHoles`, after enumerating loops, drops any loop whose edges are all T-junction artifacts.
     `holes.size()` (what `findholes_v2` returns) naturally drops to 0 for the bridge. This also makes
     the fill path skip those degenerate slits — correct (nothing to fill), and harmless to Syklone
     (Syklone ships no fill/repair).

3. **`web/wasm_bad_edges/bad_edges_api.cpp`**
   - `#include <mesh/extended/algorithms/fill_holes.h>`.
   - Tracks `boundary_edge_keys`; computes the T-junction set over them.
   - `CountBadEdgeContours` takes the T-junction set and **does not count** contours made entirely of
     T-junction edges → `bad_contours_count` drops to 0.
   - `bad_edges_count = (boundary_edges − T-junction edges) + non_manifold + orientation` → drops to 0.
   - **`boundary_edges_count` is left untouched (still 20)** — honest raw topology. The UI does not use
     it for the verdict (see below).

### Why `bad_edges_count` also had to change (verdict-layer finding)

The Syklone UI (`pkg-syklone-js/.../tool_part_creator/commands/command_import_components_locally_mesh_checks.js`)
fails the part if **any** check fails, and the bad_edges check fails when
`bad_edges_count + bad_contours_count > 0` (line ~159). It does **not** use `boundary_edges_count`, and
there is **no separate "watertight" verdict**. So fixing only the holes check would have left the bridge
showing overall **FAIL** (20 bad edges). Excluding the T-junction edges from the defect count makes the
watertight part PASS while keeping `boundary_edges_count` honest.

**After the fix** (native + WASM verified): bridge → `holes=0`, `bad_edges_count=0`, `bad_contours=0`,
`boundary_edges=20` ⇒ holes PASS, bad_edges PASS ⇒ **part PASSES**. Real-hole control
`icosphere_with_holes.stl` unchanged (`holes=2`, `bad_edges_count=6`, `bad_contours=2` ⇒ still FAIL, correct).

## Build

From `meshlib/` (build dirs already configured: `build-native`, `build-wasm-fillholes`).

**Native dylibs** (used by the regression test; `native_fill_holes` exports `meshlib_find_holes_stl`,
i.e. the findholes_v2 source — there is no separate `native_findholes_v2`):
```bash
cmake --build build-native --target meshlib_fill_holes_native meshlib_bad_edges_native -j 8
```

**WASM** (the artifacts shipped to Syklone):
```bash
cmake --build build-wasm-fillholes --target meshlib_findholes_v2_wasm meshlib_bad_edges_wasm -j 8
```
Outputs:
- `web/wasm_findholes_v2/meshlib_findholes_v2.{js,wasm}`
- `web/wasm_bad_edges/meshlib_bad_edges.{js,wasm}`

(`fill_holes` and `repair_pipeline` are **not** Syklone artifacts and are out of scope here.)

## Verification

- **Regression test:** `meshlib-python-testing/tests/test_tjunction_holes.py` (7 cases) — bridge → 0
  holes / 0 contours / 0 bad_edges (boundary stays 20); `icosphere_with_holes` real holes preserved
  (2 / 2 / 6). Run: `PYTHONPATH=. ./.venv/bin/python -m pytest tests/test_tjunction_holes.py`.
- **WASM parity:** the rebuilt `.wasm` modules loaded in Node give identical numbers to the native
  dylibs (bridge 0/0/0/20; icosphere 2/2/6/6).
- **No over-suppression:** sweeping the full `public/stl` fixture library, every real-hole and
  watertight mesh is unchanged; only genuine collinear slits (the bridge; a 3-edge slit in
  `Michaels_Calibration_Matrix.stl`) reclassify to 0.
- Scratch/prototype scripts (in `meshlib-python-testing/`): `repro_20089.py`, `measure_holes.py`,
  `analyze_loops.py` (Python prototype + fixture sweep).

## Circulation to Syklone

Syklone consumes the mesh-check WASMs via `pkg-syklone-js`. To ship this fix:

1. Copy the two rebuilt check artifacts (the `.js` glue + `.wasm`; **leave the `*.worker.js`**
   wrappers, which are Syklone's) into:
   - `SykloneAll/Frontend/pkg-syklone-js/src/graphics/lib/mesh_checks/` — **canonical source**
   - `SykloneAll/Frontend/web-platform-creator/assets/` — duplicate committed copies
   Files: `meshlib_findholes_v2.js`, `meshlib_findholes_v2.wasm`, `meshlib_bad_edges.js`, `meshlib_bad_edges.wasm`.
2. **yalc** the updated `pkg-syklone-js` into a consumer (web-platform-creator / prd-web-global-frontend)
   and confirm the bridge now passes the mesh checks in the running app.
3. Raise PR(s) on `pkg-syklone-js` (+ consumers as needed). **The project team bumps the `syklone`
   version and builds the package artefact — not us.**

| Repo | Role | Action |
|---|---|---|
| `Frontend/pkg-syklone-js` | canonical source | drop the 4 rebuilt files; PR |
| `Frontend/web-platform-creator` | consumes via yalc + has its own `assets/` copies | refresh `assets/`; yalc-test; PR |
| `PRD-Frontend/prd-web-global-frontend` | consumes via yalc | yalc-test; PR → team bumps version/artefact |

## Tolerances, limitations, risks

- Tolerance is absolute (`eps = 1e-4`, parallelism `eps`, point-on-line `10·eps`), validated against
  the float32 STL fixtures (parts in mm). Very small-scale meshes may warrant a relative tolerance.
- The reclassify is intentionally conservative: a loop is dropped **only if all** its edges are
  T-junction artifacts, so real holes adjacent to T-junctions are preserved.
- Line grouping is ~O(E²) per loop — fine for typical boundaries; a pathological single huge boundary
  loop could be slow (bucket by quantized line key if it ever matters).
- `findholes_v2` and `bad_edges` still use independent code; unifying them is deferred to the
  mesh-checks code review.
