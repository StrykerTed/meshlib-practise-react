# Mesh Repair Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `repair_pipeline` meshlib tool that cleans a defective STL (degenerate/duplicate/hole/noise/orientation defects) and returns a coherent before→after validation report, proven headless on real meshes.

**Architecture:** One new C ABI source `web/wasm_repair_pipeline/repair_pipeline_api.cpp`, built to both WASM and native (shared `.cpp`, two CMakeLists), exactly like every existing tool. All logic lives in `api.cpp` using confirmed public APIs (`MeshReader_C`, `MeshRepair_C::RepairMesh`, `FillHoles_C`, `ConnectedComponents_C`, `GetVolume`, `Mesh_C` array builders) — no changes to `lib/`. Validated via the existing native+ctypes harness in `meshlib-python-testing`, then wired into the React checks surface.

**Tech Stack:** C++17, Emscripten, CMake ≥3.25, Python 3.12 + ctypes, React/TS/Vite.

## Global Constraints

- C ABI rules (from `meshlib/web/ADDING_NEW_TOOLS.md`): `extern "C"`, functions return `int` (0=success, 1=error, 2=null-arg); outputs via `malloc`; always export `meshlib_free`; error text via `char** out_error`; compile clean under `-Werror` for **both** `emcc` and `g++`.
- Function naming: `meshlib_<verb>_<noun>_stl`.
- Build env: prefix configure with `MESHLIB_LOCAL_BUILD_ENV=1 build_env=local`; native uses `-DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON -DMESHLIB_BUILD_TESTS=OFF -DMESHLIB_BUILD_APP_TARGETS=OFF -DMESHLIB_BUILD_WITH_OPEN_MP=OFF`; WASM uses `emcmake` + `-DMESHLIB_BUILD_WASM_DEMO=ON` + `-DEigen3_DIR=/opt/homebrew/opt/eigen/share/eigen3/cmake -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER`.
- Native build dir already exists at `meshlib/build-native`; pick the same Homebrew GCC already used there (`ls /opt/homebrew/bin/g++-*`).
- Link every tool target against `${MESHLIB_EXTENDED}` and `${MESHLIB_CORE}`.
- Reordered pipeline (documented deviation from stakeholder's top-to-bottom; flag to stakeholder): weld(read) → degenerate → duplicate-faces → noise → holes → **orientation last** → re-verify.

## Confirmed APIs (copy these, they are verified)

```cpp
// Build a mesh from arrays (from fill_holes_raw):
Mesh::Core::Mesh_C mesh("repair_pipeline");
mesh.ReserveVertices(n); mesh.AddVertex(double x,double y,double z);
mesh.ReserveFaces(m);    mesh.AddFace(uint32 a,uint32 b,uint32 c);
mesh.GenerateHalfEdges();           // bool; required before topology ops
mesh.CollectGarbage();              // compact after edits
auto nv = mesh.GetNumberOfVertices();  auto nf = mesh.GetNumberOfFaces();
const auto& v = mesh.GetConstVertex(i);  // v.x v.y v.z (doubles)
const auto& f = mesh.GetConstFace(i);    // f[0] f[1] f[2] (uint32 vertex indices)
mesh.RevertFaces(true);             // flips ALL faces (whole-mesh only; no subset)

// Read/write STL (from existing api.cpp):
const char& buf = *reinterpret_cast<const char*>(stl_data);
auto mesh = Mesh::Core::MeshReader_C::Read(buf, stl_size, Mesh::Core::MeshReader_C::Provider_TP::STL);
std::ostringstream os(std::ios::binary);
Mesh::Core::MeshWriter_C::Write(os, mesh, Mesh::Core::MeshWriter_C::FileFormat_TP::STL_BINARY);

// Repair + detect (mesh_repair.h):
Mesh::Extended::MeshRepair_C::RepairConfig_C cfg{};   // all stages default-disabled
cfg.fix_isolated_vertices.is_enabled = true;
cfg.fix_small_components.is_enabled = true; cfg.fix_small_components.component_area_ratio_threshold = ratio;
cfg.fix_self_intersections.is_enabled = true;
cfg.fix_holes.is_enabled = true;
cfg.fix_short_edges.is_enabled = true;
cfg.fix_short_faces.is_enabled = true;
cfg.iterations = 5;
auto res = Mesh::Extended::MeshRepair_C::RepairMesh(mesh, cfg); // res.mesh, res.mesh_repair_statistics
auto degen = Mesh::Extended::MeshRepair_C::DetectShortFaces(mesh); // .size()
auto holes = Mesh::Extended::FillHoles_C::FindHoles(mesh);         // .size()  (#include fill_holes.h)

// Components (connected_components.h):
auto info = Mesh::Extended::ConnectedComponents_C::FindConnectedComponents(
    mesh, Mesh::Extended::ComponentsInfo_C::Connectivity_TP::EDGE_CONNECTED, true);
auto ncomp = info.GetNumberOfComponents();
const std::vector<ComponentID_TP>& fmap = info.GetFacesMap(); // fmap[face_idx] = component id

// Signed volume (traits.h): std::optional<double> Mesh::Core::GetVolume(mesh)  // closed-only
```

> Note: `ConnectedComponents_C` is the class name in `connected_components.h`; if the free/static spelling differs at compile time, fall back to `MeshRepair_C::DetectComponents(mesh)` which returns the same `ComponentsInfo_C`. Confirm the exact qualified name when Task 4 first compiles.

---

### Task 1: Scaffold the tool (dirs, CMake, root registration, buildable stub)

**Files:**
- Create: `meshlib/web/wasm_repair_pipeline/repair_pipeline_api.cpp`
- Create: `meshlib/web/wasm_repair_pipeline/CMakeLists.txt`
- Create: `meshlib/web/native_repair_pipeline/CMakeLists.txt`
- Modify: `meshlib/CMakeLists.txt` (add two `add_subdirectory` lines)

**Interfaces:**
- Produces: `int meshlib_validate_mesh_stl(const uint8_t* stl_data, size_t stl_size, uint32_t* out_report, size_t out_report_len, char** out_error)` and `void meshlib_free(void* p)`. `out_report` is a caller-allocated array of **16 uint32** (see Task 2 for field order); v1 of the report is fixed-width so marshalling is trivial across ctypes + Emscripten.

- [ ] **Step 1: Create the stub `repair_pipeline_api.cpp`** (compiles, returns zeros)

```cpp
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <exception>
#include <sstream>
#include <string>
#include <vector>
#include <unordered_set>
#include <unordered_map>

#include <mesh/core/io/mesh_reader.h>
#include <mesh/core/io/mesh_writer.h>
#include <mesh/core/mesh.h>
#include <mesh/core/traits.h>
#include <mesh/extended/algorithms/mesh_repair.h>
#include <mesh/extended/algorithms/fill_holes.h>
#include <mesh/extended/algorithms/connected_components.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {

char* DuplicateCString(const std::string& message)
{
    auto* buffer = static_cast<char*>(std::malloc(message.size() + 1));
    if (!buffer) return nullptr;
    std::memcpy(buffer, message.c_str(), message.size() + 1);
    return buffer;
}

// Report field indices (uint32 each). REPORT_LEN must match the C ABI contract.
enum ReportField {
    R_VERTEX_COUNT = 0,
    R_FACE_COUNT = 1,
    R_COMPONENT_COUNT = 2,
    R_BOUNDARY_EDGE_COUNT = 3,
    R_NON_MANIFOLD_EDGE_COUNT = 4,
    R_HOLE_COUNT = 5,
    R_DEGENERATE_FACE_COUNT = 6,
    R_DUPLICATE_FACE_COUNT = 7,
    R_INVERTED_COMPONENT_COUNT = 8,   // closed comps with negative signed volume
    R_INDETERMINATE_COMPONENT_COUNT = 9, // open comps (orientation undecidable)
    R_IS_WATERTIGHT = 10,
    R_IS_MANIFOLD = 11,
    R_LEN = 16                         // reserve spare slots 12..15
};

} // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int meshlib_validate_mesh_stl(
    const std::uint8_t* stl_data, std::size_t stl_size,
    std::uint32_t* out_report, std::size_t out_report_len, char** out_error)
{
    if (!out_report || !out_error || out_report_len < R_LEN) return 2;
    for (std::size_t i = 0; i < out_report_len; ++i) out_report[i] = 0;
    *out_error = nullptr;
    if (!stl_data || stl_size == 0) { *out_error = DuplicateCString("Input STL buffer is empty."); return 1; }
    try {
        const char& buf = *reinterpret_cast<const char*>(stl_data);
        auto mesh = Mesh::Core::MeshReader_C::Read(buf, stl_size, Mesh::Core::MeshReader_C::Provider_TP::STL);
        mesh.GenerateHalfEdges();
        out_report[R_VERTEX_COUNT] = static_cast<std::uint32_t>(mesh.GetNumberOfVertices());
        out_report[R_FACE_COUNT]   = static_cast<std::uint32_t>(mesh.GetNumberOfFaces());
        return 0;
    } catch (const std::exception& ex) { *out_error = DuplicateCString(ex.what()); return 1; }
      catch (...) { *out_error = DuplicateCString("Unknown error in meshlib_validate_mesh_stl."); return 1; }
}

EMSCRIPTEN_KEEPALIVE void meshlib_free(void* p) { std::free(p); }

} // extern "C"
```

- [ ] **Step 2: Create `web/wasm_repair_pipeline/CMakeLists.txt`** (copy noise_shells, rename, list the exported functions we will have by Task 5)

```cmake
cmake_minimum_required(VERSION 3.25)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "web/wasm_repair_pipeline requires EMSCRIPTEN")
endif()

set(TARGET_NAME meshlib_repair_pipeline_wasm)

add_executable(${TARGET_NAME} repair_pipeline_api.cpp)

target_link_libraries(${TARGET_NAME} PRIVATE ${MESHLIB_EXTENDED} ${MESHLIB_CORE})

set_target_properties(${TARGET_NAME} PROPERTIES
    OUTPUT_NAME "meshlib_repair_pipeline"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
)

target_link_options(${TARGET_NAME} PRIVATE
    "SHELL:-sMODULARIZE=1"
    "SHELL:-sEXPORT_ES6=1"
    "SHELL:-sENVIRONMENT=web"
    "SHELL:-sALLOW_MEMORY_GROWTH=1"
    "SHELL:-sFILESYSTEM=0"
    "SHELL:-sNO_EXIT_RUNTIME=1"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU32','HEAPF32']"
    "SHELL:-sEXPORTED_FUNCTIONS=['_meshlib_validate_mesh_stl','_meshlib_repair_pipeline_stl','_meshlib_free','_malloc','_free']"
)
```

- [ ] **Step 3: Create `web/native_repair_pipeline/CMakeLists.txt`** (copy native_noise_shells, rename, point at the shared `.cpp`)

```cmake
cmake_minimum_required(VERSION 3.25)

if(EMSCRIPTEN)
    message(FATAL_ERROR "web/native_repair_pipeline is for native builds only, not Emscripten")
endif()

set(TARGET_NAME meshlib_repair_pipeline_native)

add_library(${TARGET_NAME} SHARED
    ${CMAKE_CURRENT_LIST_DIR}/../wasm_repair_pipeline/repair_pipeline_api.cpp
)

target_link_libraries(${TARGET_NAME} PRIVATE ${MESHLIB_EXTENDED} ${MESHLIB_CORE})

set_target_properties(${TARGET_NAME} PROPERTIES
    OUTPUT_NAME "meshlib_repair_pipeline"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
    C_VISIBILITY_PRESET default
    CXX_VISIBILITY_PRESET default
    VISIBILITY_INLINES_HIDDEN OFF
)
```

- [ ] **Step 4: Register both in root `meshlib/CMakeLists.txt`**

Add after line 473 (`add_subdirectory(web/wasm_inverted_normals)` block, inside the `EMSCRIPTEN AND MESHLIB_BUILD_WASM_DEMO` guard):
```cmake
    add_subdirectory(web/wasm_repair_pipeline)
```
Add after line 490 (inside the `NOT EMSCRIPTEN AND MESHLIB_BUILD_NATIVE_PYTHON_LIBS` guard):
```cmake
    add_subdirectory(web/native_repair_pipeline)
```

- [ ] **Step 5: Configure + build the native target to prove it links**

Run (from `meshlib/`):
```bash
GCC=$(ls /opt/homebrew/bin/g++-* | sort -V | tail -1)
MESHLIB_LOCAL_BUILD_ENV=1 build_env=local cmake -B build-native \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_COMPILER=${GCC/g++/gcc} -DCMAKE_CXX_COMPILER=$GCC \
  -DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON -DMESHLIB_BUILD_TESTS=OFF \
  -DMESHLIB_BUILD_APP_TARGETS=OFF -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
  -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON
cmake --build build-native --target meshlib_repair_pipeline_native -j 8
```
Expected: builds `meshlib/web/native_repair_pipeline/libmeshlib_repair_pipeline.dylib`.

- [ ] **Step 6: Smoke-test the stub validator from Python**

Run:
```bash
cd /Users/ted.tedford/Public/MyLocalRepos/meshlib-python-testing
python3.12 - <<'PY'
import ctypes
from pathlib import Path
lib = ctypes.CDLL(str(Path("/Users/ted.tedford/Public/MyLocalRepos/meshlib/web/native_repair_pipeline/libmeshlib_repair_pipeline.dylib")))
lib.meshlib_validate_mesh_stl.argtypes=[ctypes.c_char_p,ctypes.c_size_t,ctypes.POINTER(ctypes.c_uint32),ctypes.c_size_t,ctypes.POINTER(ctypes.c_char_p)]
lib.meshlib_validate_mesh_stl.restype=ctypes.c_int
stl=Path("/Users/ted.tedford/Public/MyLocalRepos/meshlib-react-fe/public/stl/Michaels_Calibration_Matrix.stl").read_bytes()
rep=(ctypes.c_uint32*16)(); err=ctypes.c_char_p()
rc=lib.meshlib_validate_mesh_stl(stl,len(stl),rep,16,ctypes.byref(err))
print("rc",rc,"verts",rep[0],"faces",rep[1])
PY
```
Expected: `rc 0 verts <nonzero> faces 131660` (after read, faces may differ if welding changes counts — nonzero is the pass condition).

- [ ] **Step 7: Commit**
```bash
cd /Users/ted.tedford/Public/MyLocalRepos/meshlib
git add web/wasm_repair_pipeline web/native_repair_pipeline CMakeLists.txt
git commit -m "feat(repair_pipeline): scaffold tool + validate stub"
```

---

### Task 2: Unified validator (re-verify, one consistent definition)

**Files:** Modify `meshlib/web/wasm_repair_pipeline/repair_pipeline_api.cpp`

**Interfaces:**
- Produces: a `namespace` helper `void ComputeReport(const Mesh::Core::Mesh_C& mesh, std::uint32_t* out_report)` filling all `ReportField` slots, called by `meshlib_validate_mesh_stl` and (Task 3) the repair function.
- Consumes: confirmed edge-incidence approach — boundary edge = edge with exactly 1 incident face; non-manifold edge = edge with >2 incident faces. One definition kills the cross-tool count disagreement.

- [ ] **Step 1: Write the helper** (insert in the anonymous namespace, before `extern "C"`)

```cpp
// Canonical unordered key for an edge (two vertex ids) and a face (three).
std::uint64_t EdgeKey(std::uint32_t a, std::uint32_t b) {
    std::uint32_t lo = std::min(a,b), hi = std::max(a,b);
    return (static_cast<std::uint64_t>(lo) << 32) | hi;
}

double ComponentSignedVolume(const Mesh::Core::Mesh_C& mesh,
                             const std::vector<std::uint32_t>& face_ids) {
    double vol = 0.0;
    for (auto fi : face_ids) {
        const auto& f = mesh.GetConstFace(fi);
        const auto& a = mesh.GetConstVertex(f[0]);
        const auto& b = mesh.GetConstVertex(f[1]);
        const auto& c = mesh.GetConstVertex(f[2]);
        vol += (1.0/6.0) * (
            -static_cast<double>(c.x)*static_cast<double>(b.y)*static_cast<double>(a.z)
            +static_cast<double>(b.x)*static_cast<double>(c.y)*static_cast<double>(a.z)
            +static_cast<double>(c.x)*static_cast<double>(a.y)*static_cast<double>(b.z)
            -static_cast<double>(a.x)*static_cast<double>(c.y)*static_cast<double>(b.z)
            -static_cast<double>(b.x)*static_cast<double>(a.y)*static_cast<double>(c.z)
            +static_cast<double>(a.x)*static_cast<double>(b.y)*static_cast<double>(c.z));
    }
    return vol;
}

void ComputeReport(Mesh::Core::Mesh_C& mesh, std::uint32_t* r) {
    mesh.GenerateHalfEdges();
    const auto nf = static_cast<std::uint32_t>(mesh.GetNumberOfFaces());
    r[R_VERTEX_COUNT] = static_cast<std::uint32_t>(mesh.GetNumberOfVertices());
    r[R_FACE_COUNT]   = nf;

    // Edge incidence → boundary / non-manifold counts.
    std::unordered_map<std::uint64_t,std::uint32_t> edge_count;
    edge_count.reserve(static_cast<std::size_t>(nf)*3);
    // Duplicate faces via canonical sorted triple.
    std::unordered_set<std::uint64_t> seen_faces;  // hashed triple key
    std::uint32_t dup = 0;
    for (std::uint32_t fi=0; fi<nf; ++fi) {
        const auto& f = mesh.GetConstFace(fi);
        edge_count[EdgeKey(f[0],f[1])]++;
        edge_count[EdgeKey(f[1],f[2])]++;
        edge_count[EdgeKey(f[2],f[0])]++;
        std::uint32_t v[3]={f[0],f[1],f[2]}; std::sort(v,v+3);
        std::uint64_t k = (static_cast<std::uint64_t>(v[0])*1000003ull + v[1])*1000003ull + v[2];
        if (!seen_faces.insert(k).second) ++dup;
    }
    std::uint32_t boundary=0, nonmanifold=0;
    for (auto& [k,c] : edge_count) { (void)k; if (c==1) ++boundary; else if (c>2) ++nonmanifold; }
    r[R_BOUNDARY_EDGE_COUNT] = boundary;
    r[R_NON_MANIFOLD_EDGE_COUNT] = nonmanifold;
    r[R_DUPLICATE_FACE_COUNT] = dup;
    r[R_HOLE_COUNT] = static_cast<std::uint32_t>(Mesh::Extended::FillHoles_C::FindHoles(mesh).size());
    r[R_DEGENERATE_FACE_COUNT] = static_cast<std::uint32_t>(Mesh::Extended::MeshRepair_C::DetectShortFaces(mesh).size());

    // Components + per-component orientation classification.
    auto info = Mesh::Extended::ConnectedComponents_C::FindConnectedComponents(
        mesh, Mesh::Extended::ComponentsInfo_C::Connectivity_TP::EDGE_CONNECTED, true);
    const auto ncomp = static_cast<std::uint32_t>(info.GetNumberOfComponents());
    r[R_COMPONENT_COUNT] = ncomp;
    const auto& fmap = info.GetFacesMap();
    std::vector<std::vector<std::uint32_t>> comp_faces(ncomp);
    for (std::uint32_t fi=0; fi<nf; ++fi)
        if (fmap[fi] >= 0 && static_cast<std::uint32_t>(fmap[fi]) < ncomp)
            comp_faces[fmap[fi]].push_back(fi);
    // A component is "closed" if none of its edges are boundary edges (incidence 1).
    std::uint32_t inverted=0, indeterminate=0;
    constexpr double kEps = 1e-12;
    for (std::uint32_t ci=0; ci<ncomp; ++ci) {
        std::unordered_map<std::uint64_t,std::uint32_t> ec;
        for (auto fi : comp_faces[ci]) {
            const auto& f = mesh.GetConstFace(fi);
            ec[EdgeKey(f[0],f[1])]++; ec[EdgeKey(f[1],f[2])]++; ec[EdgeKey(f[2],f[0])]++;
        }
        bool closed=true; for (auto& [k,c]:ec){ (void)k; if (c==1){closed=false;break;} }
        if (!closed) { ++indeterminate; continue; }
        if (ComponentSignedVolume(mesh, comp_faces[ci]) < -kEps) ++inverted;
    }
    r[R_INVERTED_COMPONENT_COUNT] = inverted;
    r[R_INDETERMINATE_COMPONENT_COUNT] = indeterminate;
    r[R_IS_WATERTIGHT] = (boundary==0 && nonmanifold==0) ? 1u : 0u;
    r[R_IS_MANIFOLD]   = (nonmanifold==0) ? 1u : 0u;
}
```

- [ ] **Step 2: Replace the stub body of `meshlib_validate_mesh_stl`** so it calls `ComputeReport(mesh, out_report)` instead of only setting vertex/face counts. Add `#include <algorithm>` at the top.

- [ ] **Step 3: Rebuild native**
Run: `cd /Users/ted.tedford/Public/MyLocalRepos/meshlib && cmake --build build-native --target meshlib_repair_pipeline_native -j 8`
Expected: clean build (no `-Werror` warnings).

- [ ] **Step 4: Validate against the real mesh and assert it matches the manual assessment**
Run the Python snippet from Task 1 Step 6 but print all 12 fields. Expected on `Michaels_Calibration_Matrix.stl`: `face_count≈131660`, `component_count≈192`, `hole_count≈60`, `non_manifold_edge_count≈79` (order-of-magnitude match to the manual assessment in the spec §2; exact numbers may differ because this is one consistent definition). PASS = report is internally consistent (`is_watertight=0`, `component_count>1`, `hole_count>0`).

- [ ] **Step 5: Commit**
```bash
git add web/wasm_repair_pipeline/repair_pipeline_api.cpp
git commit -m "feat(repair_pipeline): unified validation report"
```

---

### Task 3: Repair orchestration (RepairMesh + whole-mesh orientation) + before/after report

**Files:** Modify `meshlib/web/wasm_repair_pipeline/repair_pipeline_api.cpp`

**Interfaces:**
- Produces: `int meshlib_repair_pipeline_stl(const uint8_t* stl_data, size_t stl_size, float component_area_ratio_threshold, uint32_t* out_before, uint32_t* out_after, size_t report_len, uint8_t** out_stl, size_t* out_stl_size, char** out_error)`. `out_before`/`out_after` are caller-allocated `uint32[16]` reports (Task 2 layout). `component_area_ratio_threshold` ∈ [0,1] controls noise removal (0 = keep all components, do not denoise).

- [ ] **Step 1: Add the repair function** (in `extern "C"`, before `meshlib_free`)

```cpp
EMSCRIPTEN_KEEPALIVE int meshlib_repair_pipeline_stl(
    const std::uint8_t* stl_data, std::size_t stl_size,
    float component_area_ratio_threshold,
    std::uint32_t* out_before, std::uint32_t* out_after, std::size_t report_len,
    std::uint8_t** out_stl, std::size_t* out_stl_size, char** out_error)
{
    if (!out_before || !out_after || !out_stl || !out_stl_size || !out_error || report_len < R_LEN) return 2;
    for (std::size_t i=0;i<report_len;++i){ out_before[i]=0; out_after[i]=0; }
    *out_stl=nullptr; *out_stl_size=0; *out_error=nullptr;
    if (!stl_data || stl_size==0){ *out_error=DuplicateCString("Input STL buffer is empty."); return 1; }
    try {
        const char& buf = *reinterpret_cast<const char*>(stl_data);
        auto mesh = Mesh::Core::MeshReader_C::Read(buf, stl_size, Mesh::Core::MeshReader_C::Provider_TP::STL);
        ComputeReport(mesh, out_before);

        Mesh::Extended::MeshRepair_C::RepairConfig_C cfg{};
        cfg.fix_isolated_vertices.is_enabled = true;
        cfg.fix_self_intersections.is_enabled = true;
        cfg.fix_short_edges.is_enabled = true;
        cfg.fix_short_faces.is_enabled = true;     // degenerate faces
        cfg.fix_holes.is_enabled = true;           // close boundary edges
        if (component_area_ratio_threshold > 0.0f) {
            cfg.fix_small_components.is_enabled = true;
            cfg.fix_small_components.component_area_ratio_threshold =
                static_cast<double>(component_area_ratio_threshold);
        }
        cfg.iterations = 5;
        mesh.GenerateHalfEdges();
        auto res = Mesh::Extended::MeshRepair_C::RepairMesh(mesh, cfg);
        Mesh::Core::Mesh_C repaired = res.mesh;

        // Whole-mesh orientation (Task 5 upgrades this to per-component).
        repaired.GenerateHalfEdges();
        const auto vol = Mesh::Core::GetVolume(repaired);
        if (vol.has_value() && *vol < 0.0) { repaired.RevertFaces(true); repaired.GenerateHalfEdges(); }

        ComputeReport(repaired, out_after);

        std::ostringstream os(std::ios::binary);
        Mesh::Core::MeshWriter_C::Write(os, repaired, Mesh::Core::MeshWriter_C::FileFormat_TP::STL_BINARY);
        const std::string bytes = os.str();
        auto* b = static_cast<std::uint8_t*>(std::malloc(bytes.size()));
        if (!b){ *out_error=DuplicateCString("Out of memory allocating output STL."); return 1; }
        std::memcpy(b, bytes.data(), bytes.size());
        *out_stl=b; *out_stl_size=bytes.size();
        return 0;
    } catch (const std::exception& ex){ *out_error=DuplicateCString(ex.what()); return 1; }
      catch (...){ *out_error=DuplicateCString("Unknown error in meshlib_repair_pipeline_stl."); return 1; }
}
```

- [ ] **Step 2: Rebuild native** — `cmake --build build-native --target meshlib_repair_pipeline_native -j 8`. Expected: clean.

- [ ] **Step 3: Run before→after on the real mesh.** Extend the Python harness to call `meshlib_repair_pipeline_stl` (argtypes: `c_char_p, c_size_t, c_float, POINTER(c_uint32), POINTER(c_uint32), c_size_t, POINTER(POINTER(c_ubyte)), POINTER(c_size_t), POINTER(c_char_p)`), with `component_area_ratio_threshold=0.0` first (no denoise). Write the repaired STL out. Expected: `after.hole_count == 0`, `after.degenerate_face_count == 0`, `after.duplicate_face_count == 0` (RepairMesh resolves these), `out_stl_size > 0`. Free with `meshlib_free`.

- [ ] **Step 4: Re-validate the written STL** by feeding it back through `meshlib_validate_mesh_stl`; assert it equals `out_after`. PASS = idempotent report.

- [ ] **Step 5: Commit** — `git commit -am "feat(repair_pipeline): repair orchestration + before/after report"`

---

### Task 4: Duplicate-face removal pass

**Files:** Modify `meshlib/web/wasm_repair_pipeline/repair_pipeline_api.cpp`

**Interfaces:**
- Produces: `Mesh::Core::Mesh_C RemoveDuplicateFaces(const Mesh::Core::Mesh_C& in)` (anon namespace) — rebuilds a mesh dropping faces whose unordered vertex-triple was already emitted. Called inside `meshlib_repair_pipeline_stl` after `RepairMesh`, before orientation.

- [ ] **Step 1: Write the failing test** (Python, crafted mesh with a duplicated triangle)

Create `meshlib-python-testing/tests/test_repair_pipeline.py`:
```python
import ctypes, struct
from pathlib import Path
LIB = ctypes.CDLL("/Users/ted.tedford/Public/MyLocalRepos/meshlib/web/native_repair_pipeline/libmeshlib_repair_pipeline.dylib")

def _bind():
    LIB.meshlib_repair_pipeline_stl.argtypes=[ctypes.c_char_p,ctypes.c_size_t,ctypes.c_float,
        ctypes.POINTER(ctypes.c_uint32),ctypes.POINTER(ctypes.c_uint32),ctypes.c_size_t,
        ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)),ctypes.POINTER(ctypes.c_size_t),
        ctypes.POINTER(ctypes.c_char_p)]
    LIB.meshlib_repair_pipeline_stl.restype=ctypes.c_int
    LIB.meshlib_free.argtypes=[ctypes.c_void_p]

def _bin_stl(tris):
    out=b"Binary STL"+b"\0"*(80-10)+struct.pack("<I",len(tris))
    for (a,b,c) in tris:
        out+=struct.pack("<3f",0,0,0)
        for p in (a,b,c): out+=struct.pack("<3f",*p)
        out+=struct.pack("<H",0)
    return out

def test_duplicate_faces_removed():
    _bind()
    t=[((0,0,0),(1,0,0),(0,1,0)), ((0,0,0),(1,0,0),(0,1,0)), ((0,0,0),(0,1,0),(0,0,1))]  # face 0 duplicated
    stl=_bin_stl(t)
    before=(ctypes.c_uint32*16)(); after=(ctypes.c_uint32*16)()
    op=ctypes.POINTER(ctypes.c_ubyte)(); osz=ctypes.c_size_t(); err=ctypes.c_char_p()
    rc=LIB.meshlib_repair_pipeline_stl(stl,len(stl),0.0,before,after,16,ctypes.byref(op),ctypes.byref(osz),ctypes.byref(err))
    assert rc==0, err.value
    assert before[7] >= 1     # R_DUPLICATE_FACE_COUNT before
    assert after[7] == 0      # removed after
    LIB.meshlib_free(op)
```
Run: `cd meshlib-python-testing && python3.12 -m pytest tests/test_repair_pipeline.py::test_duplicate_faces_removed -q`
Expected: FAIL (`after[7]` not 0 yet — RepairMesh doesn't dedupe faces).

- [ ] **Step 2: Implement `RemoveDuplicateFaces`** (anon namespace)
```cpp
Mesh::Core::Mesh_C RemoveDuplicateFaces(const Mesh::Core::Mesh_C& in) {
    Mesh::Core::Mesh_C out("repair_pipeline_dedup");
    const auto nv = static_cast<std::uint32_t>(in.GetNumberOfVertices());
    const auto nf = static_cast<std::uint32_t>(in.GetNumberOfFaces());
    out.ReserveVertices(nv);
    for (std::uint32_t i=0;i<nv;++i){ const auto& v=in.GetConstVertex(i); out.AddVertex(v.x,v.y,v.z); }
    out.ReserveFaces(nf);
    std::unordered_set<std::uint64_t> seen; seen.reserve(nf);
    for (std::uint32_t fi=0; fi<nf; ++fi) {
        const auto& f = in.GetConstFace(fi);
        std::uint32_t v[3]={f[0],f[1],f[2]}; std::sort(v,v+3);
        std::uint64_t k=(static_cast<std::uint64_t>(v[0])*1000003ull+v[1])*1000003ull+v[2];
        if (seen.insert(k).second) out.AddFace(f[0],f[1],f[2]);
    }
    out.GenerateHalfEdges(); out.CollectGarbage();
    return out;
}
```

- [ ] **Step 3: Call it in `meshlib_repair_pipeline_stl`** — replace `Mesh::Core::Mesh_C repaired = res.mesh;` with:
```cpp
        Mesh::Core::Mesh_C repaired = RemoveDuplicateFaces(res.mesh);
```

- [ ] **Step 4: Rebuild + run the test**
Run: `cmake --build build-native --target meshlib_repair_pipeline_native -j 8 && cd /Users/ted.tedford/Public/MyLocalRepos/meshlib-python-testing && python3.12 -m pytest tests/test_repair_pipeline.py::test_duplicate_faces_removed -q`
Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(repair_pipeline): duplicate-face removal pass"`

---

### Task 5: Per-component outward orientation (the critical step)

**Files:** Modify `meshlib/web/wasm_repair_pipeline/repair_pipeline_api.cpp`

**Interfaces:**
- Produces: `Mesh::Core::Mesh_C OrientOutwardPerComponent(const Mesh::Core::Mesh_C& in)` — rebuilds the mesh reversing winding of every face belonging to a **closed** component whose signed volume is negative; leaves open components untouched. Replaces the whole-mesh `RevertFaces` block in Task 3.

- [ ] **Step 1: Write the failing test** (an inside-out closed tetrahedron → must be flipped to positive volume)

Append to `tests/test_repair_pipeline.py`:
```python
def test_inverted_closed_component_flipped():
    _bind()
    # Tetra vertices; faces wound INWARD (negative signed volume).
    p=[(0,0,0),(1,0,0),(0,1,0),(0,0,1)]
    # outward winding would be these reversed; we intentionally invert:
    tris=[(p[0],p[2],p[1]),(p[0],p[1],p[3]),(p[0],p[3],p[2]),(p[1],p[2],p[3])]
    stl=_bin_stl(tris)
    before=(ctypes.c_uint32*16)(); after=(ctypes.c_uint32*16)()
    op=ctypes.POINTER(ctypes.c_ubyte)(); osz=ctypes.c_size_t(); err=ctypes.c_char_p()
    rc=LIB.meshlib_repair_pipeline_stl(stl,len(stl),0.0,before,after,16,ctypes.byref(op),ctypes.byref(osz),ctypes.byref(err))
    assert rc==0, err.value
    assert before[8] >= 1   # R_INVERTED_COMPONENT_COUNT before >= 1
    assert after[8] == 0    # no inverted closed components after
    LIB.meshlib_free(op)
```
Run it. Expected: FAIL (whole-mesh RevertFaces may or may not handle it; for a single closed component it might pass — if it passes, strengthen with a TWO-tetra mesh where only one is inverted, which whole-mesh flip cannot fix. Use that as the real failing case):
```python
def test_only_one_of_two_components_flipped():
    _bind()
    def tet(o, invert):
        p=[(o+0,0,0),(o+1,0,0),(o+0,1,0),(o+0,0,1)]
        f=[(p[0],p[1],p[2]),(p[0],p[3],p[1]),(p[0],p[2],p[3]),(p[1],p[3],p[2])] # outward
        if invert: f=[(a,c,b) for (a,b,c) in f]
        return f
    stl=_bin_stl(tet(0,False)+tet(5,True))   # one correct, one inverted
    before=(ctypes.c_uint32*16)(); after=(ctypes.c_uint32*16)()
    op=ctypes.POINTER(ctypes.c_ubyte)(); osz=ctypes.c_size_t(); err=ctypes.c_char_p()
    rc=LIB.meshlib_repair_pipeline_stl(stl,len(stl),0.0,before,after,16,ctypes.byref(op),ctypes.byref(osz),ctypes.byref(err))
    assert rc==0, err.value
    assert before[8]==1 and after[8]==0
    LIB.meshlib_free(op)
```
Expected: FAIL on `test_only_one_of_two_components_flipped` (whole-mesh flip can't fix exactly one of two).

- [ ] **Step 2: Implement `OrientOutwardPerComponent`** (anon namespace)
```cpp
Mesh::Core::Mesh_C OrientOutwardPerComponent(const Mesh::Core::Mesh_C& in) {
    Mesh::Core::Mesh_C work = in;            // copy we can add half-edges to
    work.GenerateHalfEdges();
    const auto nf = static_cast<std::uint32_t>(work.GetNumberOfFaces());
    auto info = Mesh::Extended::ConnectedComponents_C::FindConnectedComponents(
        work, Mesh::Extended::ComponentsInfo_C::Connectivity_TP::EDGE_CONNECTED, true);
    const auto ncomp = static_cast<std::uint32_t>(info.GetNumberOfComponents());
    const auto& fmap = info.GetFacesMap();
    std::vector<std::vector<std::uint32_t>> cf(ncomp);
    for (std::uint32_t fi=0; fi<nf; ++fi)
        if (fmap[fi]>=0 && static_cast<std::uint32_t>(fmap[fi])<ncomp) cf[fmap[fi]].push_back(fi);

    std::vector<char> flip(ncomp, 0);
    constexpr double kEps = 1e-12;
    for (std::uint32_t ci=0; ci<ncomp; ++ci) {
        std::unordered_map<std::uint64_t,std::uint32_t> ec;
        for (auto fi : cf[ci]) { const auto& f=work.GetConstFace(fi);
            ec[EdgeKey(f[0],f[1])]++; ec[EdgeKey(f[1],f[2])]++; ec[EdgeKey(f[2],f[0])]++; }
        bool closed=true; for (auto& kv:ec){ if (kv.second==1){closed=false;break;} }
        if (closed && ComponentSignedVolume(work, cf[ci]) < -kEps) flip[ci]=1;
    }

    Mesh::Core::Mesh_C out("repair_pipeline_oriented");
    const auto nv = static_cast<std::uint32_t>(work.GetNumberOfVertices());
    out.ReserveVertices(nv);
    for (std::uint32_t i=0;i<nv;++i){ const auto& v=work.GetConstVertex(i); out.AddVertex(v.x,v.y,v.z); }
    out.ReserveFaces(nf);
    for (std::uint32_t fi=0; fi<nf; ++fi) {
        const auto& f = work.GetConstFace(fi);
        const auto c = (fmap[fi]>=0 && static_cast<std::uint32_t>(fmap[fi])<ncomp) ? flip[fmap[fi]] : 0;
        if (c) out.AddFace(f[0],f[2],f[1]);   // reversed winding
        else   out.AddFace(f[0],f[1],f[2]);
    }
    out.GenerateHalfEdges(); out.CollectGarbage();
    return out;
}
```

- [ ] **Step 3: Swap orientation strategy in `meshlib_repair_pipeline_stl`** — replace the whole-mesh `GetVolume`/`RevertFaces` block with:
```cpp
        repaired = OrientOutwardPerComponent(repaired);
```

- [ ] **Step 4: Rebuild + run all pipeline tests**
Run: `cmake --build build-native --target meshlib_repair_pipeline_native -j 8 && cd /Users/ted.tedford/Public/MyLocalRepos/meshlib-python-testing && python3.12 -m pytest tests/test_repair_pipeline.py -q`
Expected: all PASS.

- [ ] **Step 5: Full assessment on the real mesh** — re-run the Task 3 harness on `Michaels_Calibration_Matrix.stl` with `component_area_ratio_threshold=1.0` (denoise on). Expected: `after.component_count` near 1, `after.hole_count==0`, `after.inverted_component_count==0`, repaired STL written. Capture the before/after report into `meshlib-react-fe/docs/architecture/` notes (manual).

- [ ] **Step 6: Commit** — `git commit -am "feat(repair_pipeline): per-component outward orientation"`

---

### Task 6: WASM build + React wiring + parity

**Files:**
- Create: `meshlib-react-fe/src/wasm/meshlib_repair_pipeline.js` + `.wasm` (copied build output)
- Create: `meshlib-react-fe/src/workers/repairPipeline.worker.ts`
- Create: `meshlib-react-fe/src/lib/repairPipelineClient.ts`
- Modify: `meshlib-react-fe/src/types/emscripten-public-wasm.d.ts`
- Modify: the existing checks page to add a "Repair" action (follow `BasicsPage.tsx`/existing client usage pattern)

**Interfaces:**
- Consumes: the WASM exports `_meshlib_repair_pipeline_stl`, `_meshlib_validate_mesh_stl`, `_meshlib_free`.
- Produces: `class RepairPipelineClient { repair(input: ArrayBuffer, opts?): Promise<{ output: ArrayBuffer; before: Uint32Array; after: Uint32Array }> }` mirroring `fillHolesClient.ts` (worker spawn, ready ping, timeout, reset-on-error).

- [ ] **Step 1: Build the WASM target**
Run (from `meshlib/`):
```bash
build_env=local MESHLIB_LOCAL_BUILD_ENV=1 emcmake cmake -S . -B build-wasm-fillholes \
  -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON -DMESHLIB_BUILD_TESTS=OFF -DMESHLIB_BUILD_APP_TARGETS=OFF \
  -DMESHLIB_BUILD_WITH_OPEN_MP=OFF -DMESHLIB_BUILD_WASM_DEMO=ON -DCMAKE_BUILD_TYPE=Release \
  -DEigen3_DIR=/opt/homebrew/opt/eigen/share/eigen3/cmake -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER
cmake --build build-wasm-fillholes -j 8 --target meshlib_repair_pipeline_wasm
```
Expected: `meshlib/web/wasm_repair_pipeline/meshlib_repair_pipeline.js` + `.wasm`.

- [ ] **Step 2: Copy artifacts into the FE** (follow current practice — both files in `src/wasm/`)
```bash
cp /Users/ted.tedford/Public/MyLocalRepos/meshlib/web/wasm_repair_pipeline/meshlib_repair_pipeline.js  /Users/ted.tedford/Public/MyLocalRepos/meshlib-react-fe/src/wasm/
cp /Users/ted.tedford/Public/MyLocalRepos/meshlib/web/wasm_repair_pipeline/meshlib_repair_pipeline.wasm /Users/ted.tedford/Public/MyLocalRepos/meshlib-react-fe/src/wasm/
```

- [ ] **Step 3: Add the TS module declaration** in `src/types/emscripten-public-wasm.d.ts` for `../wasm/meshlib_repair_pipeline.js` and `@wasm/meshlib_repair_pipeline.js` (copy an existing tool's three-declaration block).

- [ ] **Step 4: Write the worker** `src/workers/repairPipeline.worker.ts` — copy `fillHoles.worker.ts`; load `../wasm/meshlib_repair_pipeline.js`; on a request, `_malloc` the input + two `uint32[16]` report buffers + out-ptr/out-size/err pointers; call `_meshlib_repair_pipeline_stl`; read `HEAPU32` for before/after, `HEAPU8` for the output STL; `_meshlib_free`; `postMessage({output, before, after}, [output.buffer])`.

- [ ] **Step 5: Write the client** `src/lib/repairPipelineClient.ts` — copy `fillHolesClient.ts` structure (ready ping, 15s startup + 120s op timeout, reset-on-error); expose `repair(input, opts)`.

- [ ] **Step 6: Wire a "Repair" action** into the existing checks surface — a button that runs `repair()`, shows before→after counts (holes, non-manifold, components, inverted) and renders the repaired mesh via `STLBufferViewer`. Follow how existing clients are used in `BasicsPage.tsx`.

- [ ] **Step 7: Manual verify** — `cd meshlib-react-fe && npm run dev`, open the page, upload `Michaels_Calibration_Matrix.stl`, run Repair; confirm before shows holes/non-manifold, after shows zeros, repaired mesh renders.

- [ ] **Step 8: Parity check** — assert the WASM `after` report equals the native `after` report from Task 5 for `Michaels_Calibration_Matrix.stl` (same definitions → identical integers).

- [ ] **Step 9: Commit** (in both repos)
```bash
cd /Users/ted.tedford/Public/MyLocalRepos/meshlib && git add web/wasm_repair_pipeline && git commit -m "build(repair_pipeline): wasm artifacts"
cd /Users/ted.tedford/Public/MyLocalRepos/meshlib-react-fe && git add src/wasm src/workers src/lib src/types && git commit -m "feat(repair_pipeline): React client + worker + repair action"
```

---

## Self-Review

**Spec coverage:** step 5 weld (read-time + reported), step 2 degenerate (RepairMesh short faces, Task 3), step 3 holes (RepairMesh, Task 3), step 4 duplicate faces (Task 4), step 1 orientation per-component (Task 5), step 6 re-verify (Task 2 validator + before/after Task 3), noise/junk (Task 3 threshold), WASM+React (Task 6), parity (Task 6 Step 8), headless proof (Tasks 2–5). Reorder documented in Global Constraints. ✅

**Placeholder scan:** all code steps contain full code; build/test steps contain exact commands + expected output. The one residual uncertainty (`ConnectedComponents_C` exact qualified name) is called out with a concrete fallback (`MeshRepair_C::DetectComponents`). ✅

**Type consistency:** report layout (`R_*` enum, 16 uint32) is defined once in Task 1 and reused identically in Tasks 2/3/5 and the worker; `meshlib_repair_pipeline_stl` signature defined in Task 3 matches the Python/TS bindings in Tasks 4/6. ✅

## Open verification points (resolve at first compile)
- Exact qualified name/spelling of `ConnectedComponents_C::FindConnectedComponents` and `ComponentsInfo_C::Connectivity_TP::EDGE_CONNECTED`; fallback `MeshRepair_C::DetectComponents`.
- `GetFacesMap()` element type sign (`ComponentID_TP`); the `>=0` guards assume signed. Adjust comparisons if unsigned.
- Confirm `-Werror` cleanliness under both `emcc` and the Homebrew `g++` (shared source).
