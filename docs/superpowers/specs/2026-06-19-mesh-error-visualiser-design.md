# Mesh Error Visualiser — Design

**Date:** 2026-06-19
**Status:** Approved by Ted; proceed to implementation
**Builds on:** [2026-06-18-mesh-repair-pipeline-design.md](2026-06-18-mesh-repair-pipeline-design.md)
**Repos:** `meshlib` (C++/WASM), `meshlib-react-fe` (UI)

## 1. Goal

A "Show Errors" action that draws a colored Three.js line at each detected problem on the **original** mesh, each line pointing **radially outward** from the part so defects are easy to spot. Line colors map to error type, and the report table rows carry matching color swatches (the table is the legend).

## 2. Error types & colors (v1)

| Type id | Error | Color | Marker location | Source |
|---|---|---|---|---|
| 1 | Hole | `#ef4444` red | hole-loop centroid (one per loop) | `FillHoles_C::FindHoles` |
| 2 | Non-manifold edge | `#f59e0b` amber | edge midpoint | edge incidence > 2 |
| 3 | Self-intersection | `#ec4899` pink | segment midpoint | `MeshRepair_C::DetectSelfIntersections` |
| 4 | Noise / extra component | `#eab308` yellow | component centroid (non-largest) | `ConnectedComponents_C` |

- **Direction = outward**: `normalize(point − partCentroid)`; line length ≈ 8% of the mesh bounding-box diagonal.
- **Self-intersections are opt-in** (a checkbox) because detection is ~30s on a 131k mesh. Default off → "Show Errors" stays fast (holes/non-manifold/noise are all fast).
- Markers capped at **500 per type** to bound rendering; the table still shows true totals.

## 3. C++ — new entry point

In `web/wasm_repair_pipeline/repair_pipeline_api.cpp`:

```c
// out_markers: malloc'd float32 buffer, 7 floats per marker:
//   [type, x, y, z, dirx, diry, dirz]   (positions in original STL coords)
// include_self_intersections: 0/1 (slow when 1)
int meshlib_locate_errors_stl(
    const uint8_t* stl_data, size_t stl_size,
    uint32_t include_self_intersections,
    uint8_t** out_markers, size_t* out_markers_size,
    char** out_error);
```

- Reuses the topology already computed in `ComputeReport`: hole loops, edge-incidence map (boundary/non-manifold), components (faces map + centroids).
- Part centroid = mean of all vertex positions. Each marker's direction = `normalize(pos − centroid)` (fallback to `+Z` if degenerate).
- Add `_meshlib_locate_errors_stl` to the WASM `EXPORTED_FUNCTIONS` list and rebuild WASM + native.
- `ComputeReport` stays fast (no self-intersection detection). The self-intersection **count** is derived only on the locate-errors path when the toggle is on (count = number of type-3 markers, pre-cap), returned to the client so the table can show a Self-intersections row when that data is present.

## 4. Frontend

- **Worker/client:** add a `locateErrors(input, { includeSelfIntersections })` action to the existing `repairPipeline.worker.ts` / `repairPipelineClient.ts` (same WASM module). Returns `{ markers: Float32Array, counts: Record<type, number> }`.
- **`ErrorMarkers.tsx`** (new): takes the marker array + the selected STL filename; applies the **same center/ground-align transform as `STLViewer`** (reuse the alignment approach in `IntersectionLines.tsx`) so lines register with the rendered original mesh. Renders one colored line per marker (drei `<Line>` or `LineSegments`), color by `type` via a shared color map.
- **`errorColors.ts`** (new, in `src/constants/`): the single source of truth for type→color, imported by `ErrorMarkers` and the report table.
- **RepairPage:** add a **"Show Errors"** button + a **"Include self-intersections (slow)"** checkbox. Clicking runs `locateErrors` on the original input and renders `ErrorMarkers` over the original mesh. Add colored swatches to the matching report-table rows (Holes, Non-manifold edges, Self-intersections, Components) using `errorColors.ts`.

## 5. Data flow

```
[Show Errors] → client.locateErrors(originalStl, {includeSelfIntersections})
  → worker → _meshlib_locate_errors_stl → float32 markers
  → ErrorMarkers applies STLViewer transform → colored lines over original mesh
  → table rows show color swatches (legend) + true counts
```

## 6. Error handling

- Empty/invalid STL → error string via `out_error` (existing pattern), surfaced in the status panel.
- Zero markers → button reports "No errors found"; no lines.
- Marker cap hit → table still shows the true total; a note indicates lines are sampled.

## 7. Testing

- **Native unit test** (`test_repair_pipeline.py`): on `icosphere_with_holes.stl`, `meshlib_locate_errors_stl` returns ≥1 hole-type marker; each marker's direction is unit-length and points away from centroid (dot(dir, pos−centroid) > 0).
- **Browser parity** (Playwright, direct WASM call like `repair-wasm-parity.spec.ts`): on the calibration matrix (self-int off), returns hole + noise markers; count > 0; all `type` values in {1,2,4}.
- FE `npm run build` passes with `ErrorMarkers` + page changes.

## 8. Scope / YAGNI

**In:** the 4 marker types above, radial-out direction, color map shared with table, self-int opt-in, cap + totals.
**Out (v1):** degenerate/duplicate-face markers (too noisy — excluded by choice), surface-normal direction, clickable/hover marker details, markers on the repaired mesh (original only).
