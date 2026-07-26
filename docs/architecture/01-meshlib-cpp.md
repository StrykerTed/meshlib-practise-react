# meshlib (C++ engine)

Path: `/Users/ted.tedford/Public/MyLocalRepos/meshlib` · Version `1.6.49` · CMake ≥ 3.25

A robust C++ library for managing and processing triangulated surface meshes:
mesh manipulation, I/O (OBJ/PLY/STL/TDOX), and algorithmic processing. It is the
engine behind the React frontend — compiled to WASM and consumed in the browser.

## Modules (`lib/`)

Each is its own CMake target, exported under the `stryker::lib::mesh::*` namespace.

| Module | Path | Responsibility |
|--------|------|----------------|
| **common** | `lib/common` | Object library (not deployed). Shared base classes, exceptions, string/date/file utils, OpenMP helpers, base64. |
| **core** | `lib/core` | Core data structures (`Mesh_C`, vertices, faces, half-edges, normals), AABB trees, I/O readers/writers, transforms. |
| **extended** | `lib/extended` | Algorithms: fill holes, repair, simplification, smoothing, boolean ops, deformation, connectivity, intersections, distances, curvature, remeshing, generators. Plus specialized I/O (landmarks, contours, patches). |
| **grid** | `lib/grid` | Grid/voxel processing: mesh↔volume conversion, distance fields, offsetting, surface extraction (marching-cubes style). |
| **registration** | `lib/registration` | ICP and correspondence finders (closest point, normal shooting, cylinder shooting), stop criteria. |
| **logging** | `lib/logging` | Unified logging interface used across modules. |
| **shape_model** | `lib/shape_model` | Shape model algorithms. |

CMake usage (from `README.md`):
```cmake
find_package(meshlib REQUIRED)
target_link_libraries(your_target
  stryker::lib::mesh::common stryker::lib::mesh::core
  stryker::lib::mesh::extended stryker::lib::mesh::grid
  stryker::lib::mesh::registration stryker::lib::mesh::logging)
```

## Directory layout

```
meshlib/
├── app/              Desktop CLI apps: mesh_compare, mesh_converter,
│                     mesh_iso_surface, mesh_remesher, mesh_to_volume
│                     (exported as stryker::app::mesh::*)
├── lib/              The 7 library modules above
├── geometry/         GIT SUBMODULE (../geometry.git) — Eigen-based math primitives
├── web/              Dual WASM + native tool builds  → see 03-wasm-pipeline.md
│   ├── ADDING_NEW_TOOLS.md
│   ├── wasm_<tool>/    <tool>_api.cpp + CMakeLists.txt → meshlib_<tool>.js/.wasm
│   └── native_<tool>/  reuses the same _api.cpp → .dylib/.so
├── test/             black_box_test/, white_box_test/, test_utils/,
│                     test_data/ (GIT SUBMODULE, ../meshlib-testdata.git)
├── configurations/   Per-platform CMake (macos, ios, visionos, web, shared, static)
├── cmake/            Helper modules (read_version, meshlib-config.cmake.in, …)
├── documentation/    Doxygen (doxygen.conf + doxy_*.dox + images/literature)
├── build-native/         build output (git-ignored)
├── build-wasm-fillholes/ build output (git-ignored)
├── build-wasm-missing/   build output (git-ignored)
├── CMakeLists.txt    Root build (large, ~27K)
├── .gitlab-ci.yml    CI pipeline (OSEP templates)
├── .sdms.yml         Stryker dependency management config
└── VERSION           1.6.49
```

> **Submodules matter.** Clone/refresh with `git submodule update --init --recursive`.
> `geometry/` and `test/test_data/` are both submodules. WASM builds use
> `geometry` as a submodule (no Artifactory needed); see below.

## Build system

The root `CMakeLists.txt` drives everything. Key options:

| Flag | Default | Purpose |
|------|---------|---------|
| `MESHLIB_BUILD_TESTS` | ON | Build black-box + white-box test suites |
| `MESHLIB_BUILD_WB_TESTS` | OFF | White-box (unit) tests; exports private symbols |
| `MESHLIB_GEOMETRY_AS_SUBMODULE` | OFF | Use `geometry/` submodule instead of an SDMS/Artifactory package |
| `MESHLIB_BUILD_WITH_OPEN_MP` | ON | OpenMP parallelization |
| `MESHLIB_BUILD_APP_TARGETS` | ON | Build the desktop CLI apps |
| `MESHLIB_BUILD_WASM_DEMO` | OFF | Build Emscripten WASM targets (`web/wasm_*`) |
| `MESHLIB_BUILD_NATIVE_PYTHON_LIBS` | OFF | Build native `.dylib`/`.so` (`web/native_*`) |

### Build environment variables

- `MESHLIB_LOCAL_BUILD_ENV=1` — local-build mode; skips the otherwise-required `CI_COMMIT_SHA`.
- `build_env=local` — same idea for the `geometry` submodule.
- `CI_COMMIT_SHA` — set by GitLab CI; baked into binaries when not in local-build mode.

### Native build

```bash
cmake -S . -B build-native \
  -DMESHLIB_BUILD_TESTS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build build-native -j 8
```
Produces the module libs (`.a`/`.so`/`.dylib` per config) and the CLI apps.

### WASM build (Emscripten)

The pattern the team uses (one build dir per tool — e.g. `build-wasm-fillholes`).
From `ted_readme.md`:

```bash
build_env=local MESHLIB_LOCAL_BUILD_ENV=1 \
emcmake cmake -S . -B build-wasm-fillholes \
  -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON \
  -DMESHLIB_BUILD_TESTS=OFF \
  -DMESHLIB_BUILD_APP_TARGETS=OFF \
  -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
  -DMESHLIB_BUILD_WASM_DEMO=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -DEigen3_DIR=/opt/homebrew/opt/eigen/share/eigen3/cmake \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER

cmake --build build-wasm-fillholes -j 8 --target meshlib_fill_holes_wasm
```
Emits `meshlib_<tool>.js` + `.wasm` directly into the tool's `web/wasm_<tool>/` dir.

**macOS prereqs:** `brew install cmake emscripten eigen` + Python 3. Common
gotchas (missing Eigen, Emscripten sysroot shadowing Homebrew, missing
`CI_COMMIT_SHA`, CORS on `file://`) are all documented in `ted_readme.md`.

## Key APIs (consumed via the C ABI in the browser)

The WASM tools wrap these. Public include paths:

- `lib/core/include/mesh/core/mesh.h` — `Mesh::Core::Mesh_C`; `GenerateHalfEdges()`.
- `lib/core/include/mesh/core/io/mesh_reader.h` — `MeshReader_C::Read(buffer, size, Provider_TP::STL)`; `Provider_TP{OBJ,PLY,STL,TDOX}`.
- `lib/core/include/mesh/core/io/mesh_writer.h` — `MeshWriter_C::Write(...)`; `FileFormat_TP{OBJ, PLY_*, STL_ASCII, STL_BINARY, TDOX}`.
- `lib/extended/include/mesh/extended/algorithms/fill_holes.h` — `FillHoles_C::FindHoles`, `FillHole_EarClipping(..., close_non_manifold)`, `FillHole_Umbrella`.
- `lib/extended/include/mesh/extended/algorithms/` — ~28 algorithm headers (boolean, connectivity, simplification, smoothing, intersect/, closest_point, mesh_distance, remeshing, generators…).
- `lib/grid/include/mesh/grid/offsetting.h`, surface extraction, volume conversion.
- `lib/registration/include/mesh/registration/iterative_closest_point.h`.

A typical browser round-trip (from `ted_readme.md`): STL bytes →
`MeshReader_C::Read(...STL)` → `GenerateHalfEdges()` → algorithm (e.g.
`FindHoles` + `FillHole_EarClipping`) → `MeshWriter_C::Write(...STL_BINARY)` →
bytes back to JS.

## CI / CD

`.gitlab-ci.yml` includes the OSEP C++ package pipeline
(`osep-cpp-package.gitlab-ci.yml`). Highlights:

- `GIT_SUBMODULE_STRATEGY: recursive` (pulls geometry + test_data).
- Build matrix across GCC (ubuntu 20.04/22.04) + `emcc` (Emscripten), shared & static.
- Stages: build → analyze (SonarQube) → test (sanitizers, excl. tsan/lsan) → document (Doxygen PDF) → package → deploy.
- BlackDuck SBOM job; GitLab Pages publishes the Doxygen HTML site.
- Packages deploy to Artifactory via SDMS (`.sdms.yml`); consumers import via `find_package(meshlib)`.

## Testing

| Suite | Path | Notes |
|-------|------|-------|
| Black-box (functional/integration) | `test/black_box_test/` | GTest; public-API tests; built with `MESHLIB_BUILD_TESTS=ON`. |
| White-box (unit) | `test/white_box_test/` | GTest; needs `MESHLIB_BUILD_WB_TESTS=ON`. |
| Helpers | `test/test_utils/` | Shared fixtures. |
| Data | `test/test_data/` | **Submodule** (`meshlib-testdata.git`): obj/ply/stl/tdox/vrml, mesh_repair, nrrd volumes, annotation, large, etc. |

## Existing documentation in this repo

- `README.md` — modules, SDMS install, dev workflow, changelog conventions.
- `ted_readme.md` — local WASM FillHoles build + troubleshooting (macOS).
- `web/ADDING_NEW_TOOLS.md` — canonical end-to-end "add a tool" guide.
- `documentation/doxy_*.dox` — Doxygen topics (data structures, IO, algorithms, repair/boolean, intersect/distances, registration, remeshing, normals, grid, logging, guidelines). Hosted at the GitLab Pages docs URL in `README.md`.
