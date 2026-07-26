# WASM Updates — New Code Progress TODO

Purpose: track migration of mesh checks from native `.so` path to browser WASM path for `meshlib-react-fe`.

## Mesh Checks Checklist

- [x] **Planar Holes (detect-only)**
  - Status: **Done (WASM v2)**
  - WASM module: `meshlib_findholes_v2`
  - Function: `meshlib_find_holes_stl`
  - Notes: aligned with the working native `.so` hole-count routine.

- [x] **Self Intersections (detect)**
  - Status: **Done (WASM implemented)**
  - Native source: `libmeshlib_self_intersections`
  - Target WASM check: detect intersecting triangles count
  - React WASM path: `src/workers/selfIntersections.worker.ts` + `src/lib/selfIntersectionsClient.ts`

- [x] **Overlapping Triangles (detect)**
  - Status: **Done (WASM implemented)**
  - Native source: `libmeshlib_overlapping_triangles`
  - Target WASM check: overlapping triangle count
  - React WASM path: `src/workers/overlappingTriangles.worker.ts` + `src/lib/overlappingTrianglesClient.ts`

- [x] **Bad Edges / Bad Contours (detect)**
  - Status: **Done (WASM implemented)**
  - Native source: `libmeshlib_bad_edges`
  - Target WASM check: bad edge + contour counts
  - React WASM path: `src/workers/badEdges.worker.ts` + `src/lib/badEdgesClient.ts`

- [x] **Noise Shells (detect)**
  - Status: **Done (WASM implemented)**
  - Native source: `libmeshlib_noise_shells`
  - Target WASM check: disconnected/noise shell count
  - React WASM path: `src/workers/noiseShells.worker.ts` + `src/lib/noiseShellsClient.ts`

- [x] **Inverted Normals (detect)**
  - Status: **Done (WASM implemented)**
  - Native source: `libmeshlib_inverted_normals`
  - Target WASM check: local/global inverted orientation counts/flags
  - React WASM path: `src/workers/invertedNormals.worker.ts` + `src/lib/invertedNormalsClient.ts`

## Notes

- Scope here is **checks/diagnostics** first.
- Repair/fix operations are tracked separately from this checklist.
- Goal for each item: same STL input should produce matching check outputs between native `.so` and WASM path.
- WASM implementation status above reflects code-path availability in `meshlib-react-fe`; per-check parity validation against native `.so` can be tracked as a separate verification pass.
