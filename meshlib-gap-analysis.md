# Gap Analysis: User Mesh Check Requirements vs MeshLib Capabilities

_Date: 6 February 2026_

---

## User Requirements (6 Mesh Checks)

1. Inverted Normals
2. Bad Edges
3. Planar Holes
4. Noise Shells
5. Overlapping Triangles
6. Intersecting Triangles

---

## Detailed Mapping

### 1. Planar Holes — ✅ Fully Supported

| Capability  | MeshLib API                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Detect**  | `FillHoles_C::FindHoles()` returns a list of hole boundaries (edge loops)                                                                |
| **Repair**  | `FillHoles_C::FillHole_EarClipping()` or umbrella method. Also available as part of `MeshRepair_C::RepairMesh()` via `FillHolesConfig_C` |
| **Metrics** | `FillHoles_C::GetPerimeter()` gives hole size; `FillHoles_C::IsValid()` checks hole validity                                             |

This is the capability already proven end-to-end in the WASM demo.

---

### 2. Intersecting Triangles — ✅ Fully Supported

| Capability       | MeshLib API                                                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Detect**       | `MeshRepair_C::DetectSelfIntersections()` returns a face mask of all intersecting faces                                          |
| **Fine-grained** | `MeshMeshIntersect_C::DoesIntersect()` for mesh-level check; `TriangleTriangleIntersect_C` for individual triangle pairs         |
| **Repair**       | `MeshRepair_C::RepairMesh()` with `SelfIntersectionConfig_C` enabled — removes intersecting faces then fills the resulting holes |

---

### 3. Noise Shells — ✅ Fully Supported

| Capability       | MeshLib API                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Detect**       | `MeshRepair_C::DetectComponents()` returns component info; `ConnectedComponents_C` / `ComponentsInfo_C` provides per-component area, face count, vertex count |
| **Repair**       | `MeshRepair_C::RepairMesh()` with `MeshComponentsConfig_C` — removes components below an area ratio threshold relative to the largest component               |
| **Connectivity** | Supports both `VERTEX_CONNECTED` and `EDGE_CONNECTED` modes                                                                                                   |

---

### 4. Inverted Normals — ⚠️ Partially Supported

> Repair is fully supported. Global detection works for closed meshes. Open mesh detection is a minor gap.

| Capability                  | MeshLib API                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Repair**                  | `Mesh_C::RevertFaces(true)` flips all face winding + recomputes normals                                                                                                  |
| **Recompute**               | `Normals_C::ComputeFaceNormals()`, `ComputeVertexNormals()`, `ComputeFaceVertexNormals()`                                                                                |
| **Orientation consistency** | `GenerateHalfEdges()` enforces a consistent winding order across the manifold — so after this call, all faces are consistently oriented                                  |
| **Global flip detection**   | `Core::GetVolume()` returns a **signed** value — if **negative**, the consistent orientation is pointing inward (all normals inverted). This is the detection mechanism. |

#### Gap Detail

There is no single "detect which individual faces have flipped normals" API. MeshLib's approach is:

1. `GenerateHalfEdges()` → makes orientation consistent (fixes mixed orientation)
2. `GetVolume()` → if negative, the whole mesh is inside-out
3. `RevertFaces()` → flips everything

This works perfectly for **closed meshes**. For **open meshes**, `GetVolume()` returns empty, so you'd need a heuristic (e.g. majority-normal-direction voting). This is a minor gap — a simple check could be implemented in the WASM layer using face normals and a reference direction.

---

### 5. Bad Edges — ⚠️ Supported, But Needs Definition Clarification

"Bad edges" isn't a standard mesh term — it likely maps to one or more of the following, all of which MeshLib handles:

| Edge Type                                                         | MeshLib API                                                                                                                                  |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Border/boundary edges** (edges with only one face = hole edges) | `HalfEdge_C::IsBorderHalfEdge()` — also detected implicitly by `FillHoles_C::FindHoles()`                                                    |
| **Non-manifold edges** (edges shared by 3+ faces)                 | `GenerateHalfEdges()` returns `true` if it had to duplicate vertices to fix non-manifold edges. The mappings output tells you exactly which. |
| **Short/degenerate edges**                                        | `MeshRepair_C::DetectShortEdges()` with configurable threshold via `ShortMeshEdgesConfig_C`                                                  |
| **High-angle edges** (near-degenerate dihedral angles)            | `Statistics::EdgeAngles()` computes dihedral angles for all edges                                                                            |
| **Watertightness**                                                | `Core::IsClosed()` checks if any border half-edges exist (no border edges = watertight)                                                      |

#### Action Required

Clarify with the team what "bad edges" means in this context. All the common interpretations are covered by existing MeshLib APIs.

---

### 6. Overlapping Triangles — ✅ Implemented (with known parity differences)

| Aspect        | Status                                                               |
| ------------- | -------------------------------------------------------------------- |
| **Detection** | Implemented via custom MeshLib C++ + WASM/native overlap detector    |
| **Repair**    | Not currently implemented (detection-only path for this requirement) |

Self-intersection detection (`DetectSelfIntersections`) handles triangles that **cross through** each other, but **not** coplanar triangles that overlap (share the same plane and partially/fully coincide). To close this gap, we implemented a custom overlap detector and integrated it into the current mesh-check pipeline.

#### Current Behavior / Known Differences

- The detector is production-integrated and classed as done for delivery.
- Known differences vs Magics remain on a small subset of files (policy/semantic deltas rather than proven algorithm failure).
- Strict mode remains the baseline behavior; compatibility behavior exists but is not the default.

---

## Summary Matrix

| #   | Requirement            | Support Level       | Detection API                                                             | Repair API                              | Notes                                  |
| --- | ---------------------- | ------------------- | ------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| 1   | Inverted Normals       | ⚠️ Partial          | `GetVolume()` sign (closed meshes only)                                   | `RevertFaces()` + `GenerateHalfEdges()` | Open mesh detection needs custom logic |
| 2   | Bad Edges              | ⚠️ Needs definition | `IsBorderHalfEdge`, `GenerateHalfEdges`, `DetectShortEdges`, `EdgeAngles` | `RepairMesh()`                          | Clarify what "bad" means               |
| 3   | Planar Holes           | ✅ Full             | `FindHoles()`                                                             | `FillHole_EarClipping()`                | Proven in WASM demo                    |
| 4   | Noise Shells           | ✅ Full             | `DetectComponents()`                                                      | `RepairMesh()` with area ratio          | Configurable threshold                 |
| 5   | Overlapping Triangles  | ✅ Implemented      | Custom overlap detector (native/WASM)                                     | N/A (detection requirement delivered)   | Known parity differences vs Magics     |
| 6   | Intersecting Triangles | ✅ Full             | `DetectSelfIntersections()`                                               | `RepairMesh()`                          | Fine-grained API also available        |

## Simple Status List (Done vs Not Done)

- 🟢 Planar Holes — Done
- 🟢 Noise Shells — Done
- 🟢 Intersecting Triangles — Done
- 🟢 Inverted Normals — Done (closed-mesh global check + repair)
- 🔴 Bad Edges — Not Done
- 🟢 Overlapping Triangles — Done (with known parity differences)
- 🟢 CMake for WASM target(s) — Done
- 🟢 CMake for Python native libraries (`.dylib` / `.so`) — Done
- 🟢 Linux `.so` generation via Docker script — Done

---

## Additional MeshLib Capabilities (Not in Requirements, But Available)

These are "free" capabilities that come with MeshLib and could be exposed in the mesh check pipeline at no extra development cost:

| Capability              | API                                                           |
| ----------------------- | ------------------------------------------------------------- |
| Isolated vertex removal | `DetectIsolatedVertices()` + repair                           |
| Degenerate face removal | `DetectShortFaces()` with `ShortMeshFacesConfig_C`            |
| Manifold enforcement    | `GenerateHalfEdges()` auto-fixes non-manifold topology        |
| Mesh statistics         | `Statistics::FaceAreas()`, `FaceIsotropies()`, `EdgeAngles()` |
| Watertight check        | `Core::IsClosed()`                                            |
| Volume / centroid       | `Core::GetVolume()`, `Core::GetCentroid()`                    |

---

## MeshRepair_C: Full Repair Pipeline

MeshLib provides a single-call comprehensive repair via `MeshRepair_C::RepairMesh()` which runs the following fixes in order (each can be independently enabled/disabled via `RepairConfig_C`):

1. Isolated vertices removal
2. Small component removal (noise shells)
3. Self-intersection removal
4. Hole filling
5. Short edge collapse
6. Degenerate face removal

`GetDefaultRepairConfig()` enables all of the above with 5 iterations. The entire pipeline could be exposed as a single WASM function accepting STL bytes and returning repaired STL bytes (same pattern as the proven `meshlib_fill_holes_stl` demo).

---

## Conclusions

- **3 of 6** requirements are fully met out of the box.
- **1 of 6** (Overlapping Triangles) is now implemented via a custom detector and integrated in the pipeline.
- **2 of 6** still need clarification or thin wrapper logic (`Bad Edges` definition and open-mesh nuance for `Inverted Normals`).
- The STL-in / STL-out WASM pattern (proven with FillHoles) can be reused for the full `MeshRepair_C` pipeline.
- The `MeshRepair_C::RepairMesh()` single-call approach covers most requirements and would be the recommended starting point for the WASM integration.
