# Mesh Repair Pipeline — Design

**Date:** 2026-06-18
**Status:** Approved (design pre-approved by Ted; proceed to implementation)
**Author:** Claude + Ted
**Repos touched:** `meshlib` (C++ engine + WASM/native tools), `meshlib-python-testing` (parity harness), `meshlib-react-fe` (consumption)

---

## 1. Problem & goal

A stakeholder requested a mesh **repair pipeline** that runs these steps, "in order, top to bottom," with step 1 called "the critical one":

1. Detect and flip inverted faces — find faces whose normals point inward, flip vertex winding to correct them
2. Detect and remove degenerate faces — zero-area triangles removed entirely
3. Detect and close boundary edges — open edges patched with new triangles
4. Remove duplicate faces — exact duplicates dropped
5. Merge duplicate vertices — vertices within tolerance unified
6. Re-verify after repair — run validation again to confirm clean

Goal: a single, reproducible repair operation that takes a defective STL and returns a clean one, plus a coherent before/after validation report. The primary consumer is the Syklone app (which already runs meshlib mesh *checks* via WASM); this adds the *repair* counterpart.

## 2. Evidence from the target mesh

Assessed `meshlib-react-fe/public/stl/Michaels_Calibration_Matrix.stl` (131,660 triangles, 6.6 MB) headless via the existing native dylibs:

| Check | Result |
|---|---|
| Inverted normals | `is_closed=False`, `is_inverted=False`, `signed_volume=0`, `local_inverted_count=0` — current tool reports nothing to flip |
| Bad edges | 79 non-manifold edges, 3 boundary edges, 80 bad contours, 197,326 manifold |
| Holes | 60 |
| Noise shells | 192 components: **1 main body = 131,467 faces (99.85%)** + **191 tiny fragments (mostly single triangles)** |
| Overlapping triangles | 0 |
| Self-intersections | 0 |

Key conclusions that shaped this design:

- **It is one near-complete body + 191 junk fragments**, not 192 real blocks. Noise removal is appropriate cleanup here, not destructive.
- **The main body is open** (holes/boundary), so global signed-volume orientation is undefined → the current inverted-normals tool returns `0`/"can't tell." You cannot reliably detect inverted faces until the body is watertight.
- **Therefore the stated order is wrong for robustness.** Orientation (step 1) must run *after* welding + hole-filling, i.e. near the end.
- The per-tool metrics **disagree by definition** (60 holes vs 3 boundary edges; 191 single-tri components vs 3 boundary edges). Re-verify (step 6) needs **one unified validator**, not a pile of inconsistent per-tool counts.
- `vertex_count` is not populated by the noise tool (`-1`); don't rely on it.

## 3. What already exists

`Mesh::Extended::MeshRepair_C::RepairMesh()` (`meshlib/lib/extended/include/mesh/extended/algorithms/mesh_repair.h`) is already a **configurable, iterative** repair pipeline. Built-in order (default 5 iterations, early-terminates when an iteration makes no change):

1. Remove isolated vertices
2. Remove small components
3. Remove self-intersections
4. Fill holes
5. Collapse short edges
6. Collapse degenerated (short-height) faces

It exposes per-stage configs (`RepairConfig_C`) and `Detect*` helpers (`DetectHoles`, `DetectSelfIntersections`, `DetectComponents`, `DetectShortFaces`, `DetectShortEdges`, `DetectIsolatedVertices`).

**It does NOT do:** orientation / flip-inverted-faces, duplicate-face removal, a unified validation report, or tolerance vertex welding. Exact vertex welding already happens on STL read (`UniqueVertexInserter_C`).

## 4. Step mapping (reordered)

| Stakeholder step | New position | Implementation | Status |
|---|---|---|---|
| 5. Merge duplicate vertices | 1 (foundation) | exact weld on STL read; tolerance weld deferred | mostly exists |
| 2. Remove degenerate faces | 2 | `RepairMesh` short-faces + short-edges collapse | exists |
| 4. Remove duplicate faces | 3 | new hash-based pass | **NEW (small)** |
| (noise: 191 stray tris) | 4 | `RepairMesh` small-components | exists |
| 3. Close boundary holes | 5 | `RepairMesh` fill-holes | exists |
| 1. Flip inverted faces ⭐ | 6 (after watertight) | new per-component outward orientation | **NEW (core)** |
| 6. Re-verify | 7 | new unified validator from `Detect*` + orientation | **NEW (assembly)** |

The reorder is the single documented deviation from the stakeholder's "top-to-bottom" request, justified by §2. **Flag this back to the stakeholder.**

## 5. Architecture

One new combined C++ tool, `repair_pipeline`, following the established 4-layer pattern (`meshlib/web/ADDING_NEW_TOOLS.md`):

```
meshlib/lib/extended/...                 RepairPipeline_C (new C++ class) — orchestration + 2 new passes + validator
meshlib/web/wasm_repair_pipeline/        repair_pipeline_api.cpp (C ABI) → meshlib_repair_pipeline.js + .wasm
meshlib/web/native_repair_pipeline/      reuses same .cpp → libmeshlib_repair_pipeline.dylib/.so
meshlib-python-testing/app/native/       ctypes wrapper + harness for headless proof
meshlib-react-fe/                        Repair action on the existing checks surface (before→after report)
```

Parse STL once → `GenerateHalfEdges()` → run stages in-memory on one `Mesh_C` → serialize once. Far cheaper than round-tripping 6.6 MB STL between separate per-tool calls.

### C ABI

```c
// Validate only — unified report, no mutation.
int meshlib_validate_mesh_stl(
    const uint8_t* stl_data, size_t stl_size,
    /* unified report out-params, see §6 */ ,
    char** out_error);

// Full repair — returns repaired STL + before & after reports + per-stage stats.
int meshlib_repair_pipeline_stl(
    const uint8_t* stl_data, size_t stl_size,
    const RepairPipelineConfig* config,   // POD config struct; toggles + thresholds
    uint8_t** out_stl, size_t* out_stl_size,
    /* before-report, after-report, stage-stats out-params */ ,
    char** out_error);

void meshlib_free(void* p);
```

Report payloads serialized in whatever form is simplest to marshal across ctypes + Emscripten (e.g. a packed struct, or a small JSON string via `char**`). Decide concretely in the plan; keep it consistent with how existing tools return structured data (e.g. noise_shells packs component data into a byte buffer).

## 6. The two new algorithms + the validator

### 6a. Per-component outward orientation (critical)

Runs after the body is watertight. Per connected component:

1. **Consistent winding within the component** — half-edge flood-fill from a seed face, flipping neighbors that disagree, so the component is internally consistent. (No-op when `local_inverted_count==0`, but required for generality. Check whether meshlib already has a consistent-orientation primitive before writing one.)
2. **Global sign decision** — for a **closed** component, compute signed volume (divergence theorem `Σ (1/6) v0·(v1×v2)`); if negative, flip the entire component (`Mesh_C::RevertFaces` scoped to the component, or equivalent). For a component **still open** after hole-filling, signed volume is undefined → **report "orientation indeterminate"; do not guess.**

### 6b. Duplicate-face removal

Hash each face by its **unordered** vertex-index triple; keep one, drop repeats. v1 handles exact coincident duplicates only. Opposite-winding coincident pairs (which contribute to the 79 non-manifold edges) are **reported but not auto-resolved** in v1.

### 6c. Unified validator (re-verify)

One function, one set of definitions, computed identically before and after repair:

- `vertex_count`, `face_count`
- `component_count`, `largest_component_face_share`
- `boundary_edge_count`, `hole_loop_count`, `non_manifold_edge_count` (one consistent half-edge definition)
- `degenerate_face_count`, `duplicate_face_count`, `self_intersection_count`
- per-component orientation: `{closed?, signed_volume_sign, indeterminate?}`
- `is_watertight`, `is_manifold`, `all_closed_components_outward`

This makes "confirm clean" mean one coherent thing and removes the cross-tool disagreement from §2.

### Config & defaults

`RepairPipelineConfig` toggles each stage with sane defaults (mirror `RepairMesh` defaults + orientation on + duplicate-face removal on). **Noise/small-component removal is on by default but the result reports exactly what was removed**, so a genuinely multi-body part is never silently gutted. Thresholds exposed: min face height, hole perimeter max, small-component area ratio, (future) weld tolerance.

## 7. Testing

- **Headless proof (primary):** reuse the native/Python harness (`meshlib-python-testing/assess_mesh.py` pattern). Run before→after on `Michaels_Calibration_Matrix.stl` — expect 191 junk tris removed, 60 holes filled, non-manifold count reduced, all closed components outward, re-verify clean. Plus fixtures: `ball_with_missing_faces_inverted_normal.stl` (real inverted case), `icosphere_with_holes.stl`, `test_noise.stl`, `not-watertight-face.stl`.
- **C++ unit tests (GTest black-box):** crafted meshes — known inside-out cube (negative signed volume → flipped to positive), duplicate-face mesh, mixed-winding component.
- **Parity:** native ↔ WASM produce identical reports/outputs (existing parity-harness pattern).

## 8. Scope / YAGNI

**v1 includes:** `RepairPipeline_C` (orchestrating `RepairMesh` + orientation + duplicate-face removal), unified validator, WASM + native builds, Python ctypes wrapper + headless proof, and wiring a Repair action into the existing react-fe checks surface showing before→after.

**v1 explicitly excludes:**
- Tolerance-based vertex welding (rely on exact weld at STL read).
- Open-component orientation heuristics (report indeterminate instead of guessing).
- Direct non-manifold-edge surgery beyond what welding + duplicate-face removal resolve (report only).
- A bespoke/polished React page (defer; reuse existing checks surface in v1).

## 9. Open items to confirm during planning

- Exact marshalling format for report/config structs across ctypes + Emscripten.
- Whether a consistent-orientation primitive already exists in meshlib (avoid rewriting flood-fill).
- Whether `RevertFaces` can be scoped to a component or needs a component-masked variant.
- Stakeholder sign-off on the reordering (orientation last, not first).

---

## 10. Implementation results & decisions (2026-06-19)

Implemented as `web/wasm_repair_pipeline/repair_pipeline_api.cpp` (built to native `.dylib` + WASM). C ABI: `meshlib_validate_mesh_stl(...)` and `meshlib_repair_pipeline_stl(..., float component_area_ratio_threshold, uint32 before[16], uint32 after[16], ...)`. Report is a fixed 16×uint32 array (`ReportField` enum) — trivial to marshal across ctypes + Emscripten (resolves the §9 marshalling item).

Resolved §9 items:
- **No consistent-orientation / scoped-flip primitive exists** in meshlib (`RevertFaces` is whole-mesh only). Both per-component orientation and duplicate-face removal are done by **rebuilding the face buffer** in `api.cpp` (`Mesh_C` array builders), no `lib/` changes.
- **Duplicate faces are keyed by vertex POSITION**, not index — `GenerateHalfEdges()` duplicates vertices for manifoldness, which makes index-based keys unreliable. `kPosTol = 1e-5`.

Pipeline as built (per repair call): `ComputeReport(before)` → `RemoveDuplicateFaces` (input dups) → `RepairMesh` (degenerate/short-edges/self-int/isolated/noise; wrapped in try/catch) → `FillHolesSafe` (defensive per-hole ear-clipping, multi-pass) → `OrientOutwardPerComponent` → `ComputeReport(after)`.

### Validated result — `Michaels_Calibration_Matrix.stl` (131,660 tris, native, denoise on, ~29s)

| Metric | Before | After |
|---|---|---|
| Components | 192 | **12** (180 single-triangle junk fragments removed) |
| Boundary edges | 965 | **0** |
| Holes | 60 | **0** |
| Non-manifold edges | 0 | 0 |
| Inverted components | 0 | **0** |
| Indeterminate (open) components | 192 | **0** |
| Watertight | no | **yes** |
| Manifold | yes | yes |
| Degenerate (sliver) faces | 0 | 100 |
| Duplicate (coincident) faces | 0 | 69 |

Unit tests (native, `meshlib-python-testing/tests/test_repair_pipeline.py`): duplicate-face removal, single-of-two inverted-component flip, and hole-repair + idempotent re-verify all pass.

### v1 limitations (deliberate, documented)

1. **`RepairMesh` hole-filling throws on some inputs** ("hole not valid for filling"). Pulled hole-filling out into `FillHolesSafe` (per-hole try/catch, ≤5 passes) so one bad hole never aborts the repair. `RepairMesh` itself is wrapped — a stage failure degrades gracefully instead of failing the whole call.
2. **Forced closure leaves sliver + coincident faces.** `FillHole_EarClipping(..., close_non_manifold=true)` can emit thin (short-height) faces and coincident double-faces that are *load-bearing* for watertightness (each coincident pair caps a region). Collapsing the slivers or deduping these reopens holes (the fill-vs-collapse tension that `RepairMesh`'s bundled iteration normally manages, but it throws here). **v1 prioritises watertight + manifold + correct orientation over removing these artifacts, and reports their counts honestly** (`R_DEGENERATE_FACE_COUNT` / `R_DUPLICATE_FACE_COUNT`) rather than trading away the win. Reducing the residual is a v2 task (e.g. a safe sliver-collapse that re-closes as it goes).
3. **Open components report `indeterminate`** for orientation (no guessing) — unchanged from design.
4. **Denoise (`component_area_ratio_threshold`)**: `0.0` = keep all components, `1.0` = keep largest-ish; result reports component count so a multi-body part is never silently gutted.

### Surfacing
WASM target built and copied to `meshlib-react-fe/src/wasm/`; wired as a **Repair Pipeline** page (`/repair`) with file selector, denoise toggle, side-by-side original/repaired 3D viewers, and a before/after report table. Frontend `npm run build` (tsc + vite) passes with the module bundled.
