# Noise Shells — Requirements, Analysis & Implementation

_Last updated: 19 February 2026_

---

## 1. Requirements (from Materialise Magics)

### Overview

Noise shells are small, disconnected clusters of triangles within an STL mesh that have no geometrical meaning. They are not connected to the main part geometry and do not enclose a valid volume. Magics treats these as waste artifacts that can typically be safely removed, though it recommends visual inspection before deletion since even a small shell of a few triangles could occasionally be important.

### Display Mode (Diagnostics)

In display/diagnostics mode (section 16.2.2.2.7 in the documentation), Magics identifies and highlights noise shells within the mesh. This allows the user to visually inspect which shells have been flagged before deciding whether to remove them. The recommendation is to always review flagged shells before removal.

### Fix Mode (Removal)

In the fix wizard's advanced options, noise shell removal is controlled by a single **"Remove noise shells"** checkbox. When enabled, Magics automatically detects and removes all shells it classifies as geometrical noise during the fix operation.

The documentation notes that the algorithm is conservative — it prefers to play it safe, and occasionally some noise shells may not be removed automatically.

### Assumptions

Based on the available documentation, the noise shell removal process appears to work as follows:

1. **Shell identification** — Magics analyses the mesh topology to identify discrete, disconnected groups of triangles (shells) that are not part of the main body.
2. **Volume/connectivity test** — Each shell is evaluated for whether it encloses a meaningful volume and whether it connects to the primary geometry. Shells that fail both criteria are classified as noise.
3. **Automatic removal** — When the checkbox is ticked, all identified noise shells are deleted from the mesh in a single pass. There are no user-configurable thresholds specifically for noise shell detection (e.g. minimum triangle count or shell size) — it is a binary on/off operation.
4. **Conservative bias** — The algorithm errs on the side of keeping shells rather than removing legitimate geometry, meaning some noise may survive the automatic pass and require manual cleanup.
5. **Part of broader fix pipeline** — Noise shell removal sits alongside other advanced fix options (sharp triangle filtering, hole closing, triangle reduction) and is typically run as part of a combined STL repair workflow rather than in isolation.

---

## 2. MeshLib API Assessment — ✅ Fully Supported

The MeshLib C++ library already contains all the detection and repair APIs needed. No new library-level code is required — only a thin C API wrapper (the same approach used for fill-holes and self-intersections).

### Detection APIs

| API                                            | Description                                            |
| ---------------------------------------------- | ------------------------------------------------------ |
| `MeshRepair_C::DetectComponents(mesh)`         | Returns `ComponentsInfo_C` with per-component details  |
| `ComponentsInfo_C::GetNumberOfComponents()`    | Total count of disconnected shells                     |
| `ComponentsInfo_C::GetArea(index)`             | Surface area of component at sorted index              |
| `ComponentsInfo_C::GetNumberOfFaces(index)`    | Face count of component                                |
| `ComponentsInfo_C::GetNumberOfVertices(index)` | Vertex count of component                              |
| `ComponentsInfo_C::GetInfoList()`              | Sorted list (descending by size) — index 0 = main body |

Internally, `DetectComponents()` calls `ConnectedComponents_C::FindConnectedComponents()` with vertex connectivity and area computation enabled.

### Repair APIs

| API                                                      | Description                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `MeshRepair_C::RepairMesh(mesh, config)`                 | Full repair pipeline; enable only `fix_small_components`                                 |
| `MeshComponentsConfig_C::is_enabled`                     | Toggle small-component removal on/off                                                    |
| `MeshComponentsConfig_C::component_area_ratio_threshold` | 0.0–1.0; components below this ratio of the largest are removed. 1.0 = keep only largest |

### Key Headers

- `mesh/extended/algorithms/mesh_repair.h` — `MeshRepair_C`, `RepairConfig_C`, `MeshComponentsConfig_C`
- `mesh/extended/algorithms/connected_components.h` — `ComponentsInfo_C`, `ConnectedComponents_C`

---

## 3. Implementation — Completed

The noise shells check follows the identical 4-layer architecture proven with fill-holes and self-intersections:

### 3.1 C++ API (`noise_shells_api.cpp`)

**Location:** `meshlib/web/wasm_noise_shells/noise_shells_api.cpp`

Two extern "C" functions:

#### `meshlib_detect_noise_shells_stl` (Priority 1 — Detect)

| Parameter              | Type             | Description                                                                                                       |
| ---------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| `stl_data`             | `const uint8_t*` | Input binary STL buffer                                                                                           |
| `stl_size`             | `size_t`         | Byte length                                                                                                       |
| `out_total_components` | `uint32_t*`      | Total number of connected components                                                                              |
| `out_noise_count`      | `uint32_t*`      | Components other than the largest (noise candidates)                                                              |
| `out_components_data`  | `uint8_t**`      | malloc'd float32 buffer: 3 values per component `[area, face_count, vertex_count, ...]` sorted descending by size |
| `out_components_size`  | `size_t*`        | Byte length of components buffer                                                                                  |
| `out_error`            | `char**`         | malloc'd error string on failure                                                                                  |
| **Returns**            | `int`            | 0 = success, 1 = error, 2 = bad params                                                                            |

#### `meshlib_remove_noise_shells_stl` (Priority 2 — Repair)

| Parameter                | Type             | Description                                                                      |
| ------------------------ | ---------------- | -------------------------------------------------------------------------------- |
| `stl_data`               | `const uint8_t*` | Input binary STL buffer                                                          |
| `stl_size`               | `size_t`         | Byte length                                                                      |
| `area_ratio_threshold`   | `float`          | Components below this ratio of the largest are removed (1.0 = keep only largest) |
| `out_data`               | `uint8_t**`      | malloc'd repaired STL buffer                                                     |
| `out_size`               | `size_t*`        | Byte length of repaired STL                                                      |
| `out_removed_components` | `uint32_t*`      | Number of removed components                                                     |
| `out_error`              | `char**`         | malloc'd error string on failure                                                 |
| **Returns**              | `int`            | 0 = success, 1 = error, 2 = bad params                                           |

#### `meshlib_free`

Standard memory deallocation for malloc'd output buffers.

### 3.2 Build Targets

| Target         | Location                                         | Output                                                  |
| -------------- | ------------------------------------------------ | ------------------------------------------------------- |
| **WASM**       | `meshlib/web/wasm_noise_shells/CMakeLists.txt`   | `meshlib_noise_shells.js` + `meshlib_noise_shells.wasm` |
| **Native .so** | `meshlib/web/native_noise_shells/CMakeLists.txt` | `libmeshlib_noise_shells.so` / `.dylib`                 |

Both link against `${MESHLIB_EXTENDED}` and `${MESHLIB_CORE}` — same dependencies as existing modules.

**Root CMakeLists.txt** updated:

- Added `option(MESHLIB_BUILD_NATIVE_PYTHON_LIBS ...)`
- Added `add_subdirectory(web/wasm_noise_shells)` in WASM section
- Added `add_subdirectory(web/native_noise_shells)` in native Python section

### 3.3 Python ctypes Wrapper

**Location:** `meshlib-python-testing/app/native/noise_shells.py`

Classes:

- `ComponentInfo` — dataclass with `index`, `area`, `face_count`, `vertex_count`, `is_main_body`
- `DetectResult` — dataclass with `total_components`, `noise_count`, `components` list
- `RemoveResult` — dataclass with `removed_components`, `stl_bytes`
- `NoiseShells` — wrapper class with `detect(stl_bytes)` and `remove(stl_bytes, area_ratio_threshold)` methods

### 3.4 Build Instructions

#### WASM (for JavaScript/browser):

```bash
cd meshlib
emcmake cmake -B build-wasm \
    -DCMAKE_BUILD_TYPE=Release \
    -DMESHLIB_BUILD_WASM_DEMO=ON \
    -DMESHLIB_BUILD_TESTS=OFF \
    -DMESHLIB_BUILD_APP_TARGETS=OFF \
    -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON
cmake --build build-wasm --target meshlib_noise_shells_wasm
```

#### Native .so (for Python):

```bash
cd meshlib
MESHLIB_LOCAL_BUILD_ENV=1 build_env=local cmake -B build-native \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=gcc-15 -DCMAKE_CXX_COMPILER=g++-15 \
    -DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON \
    -DMESHLIB_BUILD_TESTS=OFF -DMESHLIB_BUILD_APP_TARGETS=OFF \
    -DMESHLIB_BUILD_WITH_OPEN_MP=OFF -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON
cmake --build build-native --target meshlib_noise_shells_native
```

---

## 4. Threshold Considerations

| Threshold | Behaviour                              | Use Case                                         |
| --------- | -------------------------------------- | ------------------------------------------------ |
| `1.0`     | Keep only the single largest component | Aggressive — removes everything except main body |
| `0.1`     | Keep components ≥ 10% of largest area  | Moderate                                         |
| `0.01`    | Keep components ≥ 1% of largest area   | Conservative (closer to Magics behaviour)        |
| `0.0`     | No removal (no-op)                     | Detection only                                   |

**Recommendation:** Use `1.0` as the default for automated pipelines (simple, predictable), but expose the threshold to the UI so users can tune it. The **detect** function always returns all components regardless of threshold, allowing the UI to present the full picture.

---

## 5. Remaining Work (JS/React Integration)

The following items are needed to complete the browser-side integration in `meshlib-react-fe`:

| Item                                | Pattern to Follow                                | Status              |
| ----------------------------------- | ------------------------------------------------ | ------------------- |
| `src/workers/noiseShells.worker.ts` | `selfIntersections.worker.ts`                    | Not started         |
| `src/lib/noiseShellsClient.ts`      | `selfIntersectionsClient.ts`                     | Not started         |
| WASM files in `src/wasm/`           | Copy built `meshlib_noise_shells.js` + `.wasm`   | Requires WASM build |
| `MeshChecksPage.tsx` integration    | Add noise shells check alongside existing checks | Not started         |

These follow the established worker + client pattern (Style A) and can be implemented once the WASM build produces the `.js` and `.wasm` artifacts.

---

## 6. Files Created/Modified

| File                                         | Repo                   | Action                                                |
| -------------------------------------------- | ---------------------- | ----------------------------------------------------- |
| `web/wasm_noise_shells/noise_shells_api.cpp` | meshlib                | Created — C API for detect + remove                   |
| `web/wasm_noise_shells/CMakeLists.txt`       | meshlib                | Created — WASM build target                           |
| `web/native_noise_shells/CMakeLists.txt`     | meshlib                | Created — Native .so build target                     |
| `CMakeLists.txt` (root)                      | meshlib                | Modified — added option, WASM + native subdirectories |
| `app/native/noise_shells.py`                 | meshlib-python-testing | Created — Python ctypes wrapper                       |
