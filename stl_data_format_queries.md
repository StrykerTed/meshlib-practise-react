# STL Data Format Queries & FillHoles Integration Analysis

## Date: 5 February 2026

---

## 1. Syklone STL Pipeline: Complete Data Flow

### 1.1 Import → Parse (original bytes consumed here)

In `pkg-syklone-js/src/graphics/lib/stl_loader.js`, the `load()` method fetches the
file as a raw **`ArrayBuffer`** (binary bytes), then immediately calls `parse(data)`:

- Detects binary vs ASCII STL (`isBinary()`)
- Extracts vertex positions, normals, and optionally per-face colours
- Returns a **`THREE.BufferGeometry`** (flat `Float32Array`s of vertices/normals)

> ⚠️ **The original STL `ArrayBuffer` is not retained** — it is discarded after parsing.

### 1.2 BufferGeometry → SelectableGeometry

The parsed `BufferGeometry` is wrapped in a `SelectableGeometry`
(which extends `THREE.BufferGeometry`). This class adds:

| Feature               | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| **Topological info**  | `faces` (index-based face list with `a, b, c` indices), edges, adjacency |
| **Material indices**  | Per-face `materialIndex` attribute (`Uint8Array`)                        |
| **Area calculations** | Per-face / per-group surface areas                                       |
| **BVH**               | Bounding volume hierarchy for raycasting                                 |

The data at this point consists of:

- `Float32Array` positions (x, y, z interleaved)
- `Array` / `Uint32Array` face indices
- `Float32Array` normals

### 1.3 Serialization — Two Modes

In `selectable_geometry.js` → `toDict(loader)`, there are **two serialization paths**:

#### "local" mode

```js
{
  areas: selectableGeometry.getAreas(settings.areasType),
  data: selectableGeometry.getGeometry(settings.geometryType)
}
```

Where `getGeometryUncompressed()` returns:

```js
{
  type: "uncompressed",
  vertices: [x1, y1, z1, x2, y2, z2, ...],  // flat array of floats
  faces: [a1, b1, c1, a2, b2, c2, ...]       // flat array of face indices
}
```

#### "remote" mode

```js
stlLoader.dump(geometryClone, stlAsBinary = true)
  → SHA-1 hash
  → stored in blob cache as `{hash}.stl`
```

Returns:

```js
{
  areas: ...,
  boundingBox: { min: [x, y, z], max: [x, y, z] },
  data: {
    type: "remote",
    path: "components/{hash}.stl"
  }
}
```

### 1.4 Deserialization (`fromDict`)

In `selectable_geometry.js` → `SelectableGeometry.fromDict(loader, state)`:

- If `state.data.path` exists → fetches the **binary STL** from
  `serviceBlobCache.getComponent(hash)` → re-parses it via `stlLoader.parse(buffer)`
- Otherwise → rebuilds from the vertex/face arrays via
  `SelectableGeometry.fromGeometry(state.data)`

### 1.5 STLLoader.dump() — Re-export to Binary STL

`stl_loader.js` → `dump(originalGeometry, binary = true, includeColors = false)`:

1. Clones the geometry
2. If it's a `SelectableGeometry`, converts to plain `BufferGeometry`
3. De-indexes (`.toNonIndexed()`) if indexed
4. Handles both `positions.length % 9` (triangulated) and `% 12` (quad-to-tri) formats
5. Writes standard binary STL:
   - 80-byte header (`"Binary STL file"`)
   - 4-byte face count
   - Per face: 12-byte normal + 36-byte vertices (3×3 floats) + 2-byte attribute byte count
6. Optionally encodes per-face colours or material indices in the attribute bytes

---

## 2. Data Format Summary

| Stage                     | Format                                                      | Retains original bytes?             |
| ------------------------- | ----------------------------------------------------------- | ----------------------------------- |
| File on disk              | Binary or ASCII STL                                         | ✅ (source of truth)                |
| After `STLLoader.parse()` | `THREE.BufferGeometry` (`Float32Array` positions + normals) | ❌ Original `ArrayBuffer` discarded |
| `SelectableGeometry`      | Indexed `BufferGeometry` + topology + materials + areas     | ❌                                  |
| `toDict("local")`         | `{ vertices: number[], faces: number[] }`                   | ❌                                  |
| `toDict("remote")`        | Binary STL `ArrayBuffer` in blob cache                      | ⚠️ Re-exported, not original        |
| `STLLoader.dump()` output | Standards-compliant binary STL `ArrayBuffer`                | ⚠️ Re-exported (normals recomputed) |

---

## 3. Compatibility with FillHoles WASM

### Current WASM Entrypoint

```c
// fill_holes_api.cpp
int meshlib_fill_holes_stl(
    const uint8_t* input_data,   // raw STL bytes
    uint32_t       input_size,
    uint8_t**      output_data,  // filled STL bytes (caller must free)
    uint32_t*      output_size
);
```

Accepts **raw STL bytes** only. Internally:

1. `MeshReader_C::Read(buffer, size, Provider_TP::STL)` → parses into `Mesh_C`
2. `FillHoles_C::FindHoles(mesh)` → finds boundary loops
3. `FillHole_EarClipping(mesh, hole)` → fills each hole
4. `MeshWriter_C::Write(mesh, Provider_TP::STL_BINARY)` → writes output STL

### Can Each Syklone Data Format Be Sent to FillHoles?

| Data Format                                           | Compatible?            | Notes                                                                                                                                        |
| ----------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Remote-mode blob cache** (`ArrayBuffer` binary STL) | ✅ **Yes — directly**  | `serviceBlobCache.getComponent(hash)` returns an `ArrayBuffer` that is valid binary STL. Can be sent straight to `meshlib_fill_holes_stl()`. |
| **Local-mode** (`{ vertices[], faces[] }`)            | ⚠️ **Needs re-export** | Must reconstruct `BufferGeometry` via `fromGeometry()`, then call `stlLoader.dump(geom, true)` to produce binary STL.                        |
| **`SelectableGeometry` in scene**                     | ⚠️ **Needs re-export** | Call `stlLoader.dump(selectableGeometry, true)` to get binary STL, then send to WASM.                                                        |
| **Original file bytes** (if retained)                 | ✅ **Yes — ideal**     | If the original `ArrayBuffer` from file import were stashed, it could be sent directly.                                                      |
| **Raw vertices + face indices**                       | ❌ **Not currently**   | The WASM entrypoint only accepts STL format. A new entrypoint accepting raw arrays would bypass unnecessary serialization/deserialization.   |

---

## 4. 🏥 Recommendation for Medical Accuracy

Since this application is medical and ensuring the data is 100% accurate is vital,
here are the options ranked by fidelity:

### Option 1: Stash Original STL Bytes at Import ⭐ (Best)

Capture and retain the **original STL `ArrayBuffer`** at import time, before
`parse()` consumes it. Store it alongside the `SelectableGeometry`.

- **Fidelity**: Byte-for-byte identical to the file the user imported
- **Effort**: Small change at the import boundary
- **Risk**: None — no conversion, no rounding, no ambiguity

### Option 2: Use Remote-Mode Blob Cache (Good)

When the session uses `"remote"` mode, `stlLoader.dump()` produces a
standards-compliant binary STL that is stored in the blob cache.

- **Fidelity**: High — valid STL, but re-exported (not original bytes)
- **Effort**: Zero change needed to extract and send to WASM
- **Risk**: Face normals are recomputed from vertex positions; floating-point
  rounding may cause negligible differences vs original file

### Option 3: New WASM Entrypoint for Raw Vertices/Faces (Viable)

Add a new WASM entrypoint that accepts raw `float[]` vertices and `uint32[]`
face indices directly, bypassing STL serialization/deserialization entirely.

- **Fidelity**: Exact vertex/face data from the Three.js scene
- **Effort**: New C wrapper function + updated Emscripten build
- **Risk**: Depends on whether meshlib core library APIs can be accessed to
  build a `Mesh_C` from raw arrays (see Section 5 below)

### Option 4: Re-export from Scene via STLLoader.dump() (Acceptable)

Take the live `SelectableGeometry` from the Three.js scene and call
`stlLoader.dump(geometry, true)` to produce binary STL.

- **Fidelity**: High — same vertex positions, normals recomputed
- **Effort**: Minimal
- **Risk**: Same as Option 2 — slight floating-point rounding on normals

---

## 5. Raw Vertex Entrypoint — Feasibility Notes

The MeshLib C++ library provides `Mesh_C` which can be constructed from raw
vertex and face data — the `MeshReader_C::Read()` is just one way to populate it.

**Key question**: Can we add a new C wrapper function in `fill_holes_api.cpp`
(which lives in the `web/wasm_fill_holes/` build folder, **not** in the core
meshlib library) that:

1. Constructs a `Mesh_C` from raw `float*` vertices + `uint32_t*` faces
2. Calls the same `FillHoles_C` algorithms
3. Returns repaired vertices + faces (or binary STL)

If `Mesh_C` has a constructor or setter that accepts raw arrays (rather than
requiring file parsing), this is **entirely achievable** by only modifying the
WASM build layer — no changes to the meshlib library itself.

See the investigation findings below.

---

## 6. WASM Build Layer Investigation — Can We Add a Raw Vertex Entrypoint?

### 6.1 What We Can Change (WASM build layer)

The following files live in `meshlib/web/wasm_fill_holes/` and are **not** part of
the core meshlib library — they are the WASM build wrapper:

| File                 | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| `fill_holes_api.cpp` | C API wrapper — the only source file compiled into the WASM     |
| `CMakeLists.txt`     | Emscripten build config — target, link libs, exported functions |

These are **fully under our control** and can be modified without touching meshlib.

### 6.2 What the MeshLib Core Library Exposes (public API — read-only)

From `mesh/core/mesh.h`, `Mesh_C` provides:

```cpp
// Construct an empty mesh
explicit Mesh_C(const std::string& name = {}, const std::string& description = {});

// Add vertices one at a time (Vertex_C is just XYZ_TC<double> = {x, y, z})
VertexIndex_TP AddVertex(double x, double y, double z);

// Add faces by vertex index triplet
FaceIndex_TP AddFace(VertexIndex_TP a, VertexIndex_TP b, VertexIndex_TP c);

// Efficient bulk move of pre-built attribute arrays
void MoveVertices(Attribute_C&& vertices, Size_TP number_of_invalid_vertices);
void MoveFaces(Attribute_C&& faces, Size_TP number_of_invalid_faces);

// Reserve capacity
void ReserveVertices(Size_TP capacity);
void ReserveFaces(Size_TP capacity);

// Generate half-edges (required by FillHoles)
void GenerateHalfEdges();

// Read vertices/faces back out
const Vertex_C& GetConstVertex(VertexIndex_TP index) const;
const Face_C& GetConstFace(FaceIndex_TP index) const;
Size_TP GetNumberOfVertices() const;
Size_TP GetNumberOfFaces() const;
```

Where:

- `Vertex_C` = `XYZ_TC<double>` = a struct with `double x, y, z`
- `Face_C` = a struct with `VertexIndex_TP a, b, c` (3 vertex indices)

### 6.3 ✅ YES — A Raw Vertex Entrypoint Is Feasible

**We can add a new function to `fill_holes_api.cpp` that:**

1. Accepts raw `float*` vertices + `uint32_t*` face indices from JavaScript
2. Builds a `Mesh_C` using `AddVertex()` / `AddFace()` (public API)
3. Calls the same `FillHoles_C` algorithms
4. Returns repaired vertices + face indices back to JavaScript

**No meshlib library changes required.** The public API (`AddVertex`, `AddFace`,
`GenerateHalfEdges`, `GetConstVertex`, `GetConstFace`) is sufficient.

### 6.4 Proposed New Entrypoint

```c
// New function signature for fill_holes_api.cpp
EMSCRIPTEN_KEEPALIVE int meshlib_fill_holes_raw(
    const float*     vertices,        // [x0,y0,z0, x1,y1,z1, ...] (n_verts * 3 floats)
    uint32_t         num_vertices,
    const uint32_t*  faces,           // [a0,b0,c0, a1,b1,c1, ...] (n_faces * 3 indices)
    uint32_t         num_faces,
    float**          out_vertices,    // malloc'd output vertices
    uint32_t*        out_num_vertices,
    uint32_t**       out_faces,       // malloc'd output faces
    uint32_t*        out_num_faces,
    char**           out_error
);
```

**Implementation sketch** (goes in `fill_holes_api.cpp`):

```cpp
EMSCRIPTEN_KEEPALIVE int meshlib_fill_holes_raw(
    const float*     vertices,
    uint32_t         num_vertices,
    const uint32_t*  faces,
    uint32_t         num_faces,
    float**          out_vertices,
    uint32_t*        out_num_vertices,
    uint32_t**       out_faces,
    uint32_t*        out_num_faces,
    char**           out_error)
{
    // ... null checks ...

    try {
        Mesh::Core::Mesh_C mesh("fill_holes_input");

        // Build mesh from raw arrays
        mesh.ReserveVertices(num_vertices);
        for (uint32_t i = 0; i < num_vertices; ++i) {
            mesh.AddVertex(
                static_cast<double>(vertices[i * 3 + 0]),
                static_cast<double>(vertices[i * 3 + 1]),
                static_cast<double>(vertices[i * 3 + 2])
            );
        }

        mesh.ReserveFaces(num_faces);
        for (uint32_t i = 0; i < num_faces; ++i) {
            mesh.AddFace(faces[i * 3 + 0], faces[i * 3 + 1], faces[i * 3 + 2]);
        }

        mesh.GenerateHalfEdges();

        // Run FillHoles (same as the STL path)
        const auto holes = Mesh::Extended::FillHoles_C::FindHoles(mesh);
        for (const auto& hole : holes) {
            Mesh::Extended::FillHoles_C::FillHole_EarClipping(mesh, hole, true);
        }

        // Extract repaired mesh back to flat arrays
        const auto nv = mesh.GetNumberOfVertices();
        const auto nf = mesh.GetNumberOfFaces();

        auto* ov = static_cast<float*>(std::malloc(nv * 3 * sizeof(float)));
        auto* of = static_cast<uint32_t*>(std::malloc(nf * 3 * sizeof(uint32_t)));

        for (uint32_t i = 0; i < nv; ++i) {
            const auto& v = mesh.GetConstVertex(i);
            ov[i * 3 + 0] = static_cast<float>(v.x);
            ov[i * 3 + 1] = static_cast<float>(v.y);
            ov[i * 3 + 2] = static_cast<float>(v.z);
        }
        for (uint32_t i = 0; i < nf; ++i) {
            const auto& f = mesh.GetConstFace(i);
            of[i * 3 + 0] = f.a;
            of[i * 3 + 1] = f.b;
            of[i * 3 + 2] = f.c;
        }

        *out_vertices = ov;
        *out_num_vertices = nv;
        *out_faces = of;
        *out_num_faces = nf;
        return 0;

    } catch (const std::exception& ex) {
        *out_error = DuplicateCString(ex.what());
        return 1;
    }
}
```

### 6.5 CMakeLists.txt Changes Required

Add the new function to the exported functions list:

```cmake
"SHELL:-sEXPORTED_FUNCTIONS=['_meshlib_fill_holes_stl','_meshlib_fill_holes_raw','_meshlib_free','_malloc','_free']"
```

Also add `HEAPF32` to the exported runtime methods for passing float arrays:

```cmake
"SHELL:-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU32','HEAPF32']"
```

### 6.6 JavaScript Worker Side (sketch)

```js
// In the worker, after module is loaded:
function fillHolesFromBufferGeometry(positions, indices) {
  const Module = getModule();

  // Allocate WASM heap for vertices (Float32Array)
  const vertBytes = positions.length * 4;
  const vertPtr = Module._malloc(vertBytes);
  Module.HEAPF32.set(positions, vertPtr / 4);

  // Allocate WASM heap for faces (Uint32Array)
  const faceBytes = indices.length * 4;
  const facePtr = Module._malloc(faceBytes);
  Module.HEAPU32.set(indices, facePtr / 4);

  // Allocate output pointers
  const outVertPtr = Module._malloc(4);
  const outVertCountPtr = Module._malloc(4);
  const outFacePtr = Module._malloc(4);
  const outFaceCountPtr = Module._malloc(4);
  const outErrPtr = Module._malloc(4);

  const rc = Module._meshlib_fill_holes_raw(
    vertPtr,
    positions.length / 3,
    facePtr,
    indices.length / 3,
    outVertPtr,
    outVertCountPtr,
    outFacePtr,
    outFaceCountPtr,
    outErrPtr,
  );

  // ... read output, free memory, build new BufferGeometry ...
}
```

### 6.7 Advantages of This Approach for POC

1. **No meshlib library changes** — only `fill_holes_api.cpp` and `CMakeLists.txt`
2. **No STL serialization/deserialization** — vertices/faces go directly in and out
3. **Direct BufferGeometry ↔ WASM** — positions and indices from Three.js map
   directly to the WASM input/output format
4. **Can replace the mesh in-place** — update `geometry.attributes.position` and
   `geometry.setIndex()` with the repaired arrays

### 6.8 Important Notes

- `Mesh_C` stores vertices as `double` but Three.js uses `float` (Float32Array).
  The cast `float → double → float` may introduce negligible rounding, but for
  vertices that were not modified by FillHoles, the values should round-trip
  identically since `float` precision is a subset of `double`.
- `FillHoles` may add new vertices (e.g. when splitting non-manifold edges), so
  the output vertex count may be greater than the input.
- After FillHoles, `mesh.GetNumberOfVertices()` may include invalid (removed)
  vertices. Consider calling `mesh.CollectGarbage()` before extracting results.

---

_This document was generated as part of the FillHoles integration feasibility
study for the Syklone platform._
