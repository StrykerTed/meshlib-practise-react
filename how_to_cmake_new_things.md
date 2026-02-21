# How We Use CMake for MeshLib Build Targets

Reference doc for building mesh analysis tools as WASM (browser), `.dylib` (macOS), and `.so` (Linux).
Kept here so we can update it freely without touching the meshlib repo README.

---

## Overview

Each mesh tool (e.g. `fill_holes`, `self_intersections`, `noise_shells`) has **one** shared C++ source file and **two** CMake targets:

| Target                  | Compiler                                           | Output            | Used by                   |
| ----------------------- | -------------------------------------------------- | ----------------- | ------------------------- |
| `meshlib_<name>_wasm`   | Emscripten (`emcc`)                                | `.js` + `.wasm`   | Browser (this React app)  |
| `meshlib_<name>_native` | GCC (`g++-15` on macOS, `gcc:14` Docker for Linux) | `.dylib` or `.so` | Python service (`ctypes`) |

The C++ source lives in `meshlib/web/wasm_<name>/<name>_api.cpp` and is referenced by both CMake targets — no code duplication.

### Directory layout in meshlib

```
meshlib/
  web/
    wasm_<name>/                  ← WASM target (Emscripten)
      <name>_api.cpp              ← THE single C source
      CMakeLists.txt              → meshlib_<name>.js + .wasm
    native_<name>/                ← Native target (GCC)
      CMakeLists.txt              → libmeshlib_<name>.dylib / .so
```

### Current tools

| Name               | WASM target                       | Native target                       |
| ------------------ | --------------------------------- | ----------------------------------- |
| Fill Holes         | `meshlib_fill_holes_wasm`         | `meshlib_fill_holes_native`         |
| Self Intersections | `meshlib_self_intersections_wasm` | `meshlib_self_intersections_native` |
| Noise Shells       | `meshlib_noise_shells_wasm`       | `meshlib_noise_shells_native`       |
| Simplification     | `meshlib_simplification_wasm`     | —                                   |
| Smoothing          | `meshlib_smoothing_wasm`          | —                                   |
| Annotations        | `meshlib_annotations_wasm`        | —                                   |

---

## 1 — Building WASM (`.js` + `.wasm`)

WASM files are what this React app consumes. The Emscripten build produces an ES module (`.js` glue) and a compiled binary (`.wasm`).

### Prerequisites

- CMake 3.25+
- Emscripten (`brew install emscripten`) — provides `emcmake`
- Eigen (`brew install eigen`) — header-only math library

### One-time configure

From the `meshlib/` repo root:

```bash
rm -rf build-wasm-fillholes
mkdir -p build-wasm-fillholes

build_env=local \
MESHLIB_LOCAL_BUILD_ENV=1 \
emcmake cmake -S . -B build-wasm-fillholes \
  -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON \
  -DMESHLIB_BUILD_TESTS=OFF \
  -DMESHLIB_BUILD_APP_TARGETS=OFF \
  -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
  -DMESHLIB_BUILD_WASM_DEMO=ON \
  -DCMAKE_BUILD_TYPE=Release \
  -DEigen3_DIR=/opt/homebrew/opt/eigen/share/eigen3/cmake \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER
```

**Why each flag matters:**

| Flag                                            | Reason                                                   |
| ----------------------------------------------- | -------------------------------------------------------- |
| `build_env=local` + `MESHLIB_LOCAL_BUILD_ENV=1` | Bypass CI_COMMIT_SHA requirement                         |
| `MESHLIB_GEOMETRY_AS_SUBMODULE=ON`              | Use the git submodule, no Artifactory credentials needed |
| `MESHLIB_BUILD_WASM_DEMO=ON`                    | Enables the `web/wasm_*` subdirectories                  |
| `DCMAKE_BUILD_TYPE=Release`                     | Critical for performance — without it, ~11× slower       |
| `DEigen3_DIR=...`                               | Tells CMake where Homebrew installed Eigen               |
| `DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER`      | Stops Emscripten from hiding Homebrew packages           |

### Build a target

```bash
cmake --build build-wasm-fillholes -j 8 --target meshlib_noise_shells_wasm
```

Output lands in the source tree:

```
meshlib/web/wasm_noise_shells/meshlib_noise_shells.js     (~50 KB)
meshlib/web/wasm_noise_shells/meshlib_noise_shells.wasm   (~1 MB)
```

### Copy to this React app

```bash
cp meshlib/web/wasm_<name>/meshlib_<name>.js   meshlib-react-fe/src/wasm/
cp meshlib/web/wasm_<name>/meshlib_<name>.wasm  meshlib-react-fe/public/
```

The `.js` goes in `src/wasm/` (imported by the Web Worker). The `.wasm` goes in `public/` (fetched at runtime by Emscripten glue).

### What the WASM CMakeLists.txt looks like

```cmake
cmake_minimum_required(VERSION 3.25)

if(NOT EMSCRIPTEN)
    message(FATAL_ERROR "web/wasm_<name> requires EMSCRIPTEN")
endif()

set(TARGET_NAME meshlib_<name>_wasm)

add_executable(${TARGET_NAME}
    <name>_api.cpp
)

target_link_libraries(${TARGET_NAME}
    PRIVATE
        ${MESHLIB_EXTENDED}
        ${MESHLIB_CORE}
)

set_target_properties(${TARGET_NAME} PROPERTIES
    OUTPUT_NAME "meshlib_<name>"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"
)

target_link_options(${TARGET_NAME}
    PRIVATE
        "SHELL:-sMODULARIZE=1"          # Wraps it in a factory function
        "SHELL:-sEXPORT_ES6=1"          # ES module syntax (import/export)
        "SHELL:-sENVIRONMENT=web"       # No Node.js polyfills
        "SHELL:-sALLOW_MEMORY_GROWTH=1" # Handles variable-size meshes
        "SHELL:-sFILESYSTEM=0"          # Smaller bundle, we pass raw bytes
        "SHELL:-sNO_EXIT_RUNTIME=1"
        "SHELL:-sEXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU32','HEAPF32']"
        "SHELL:-sEXPORTED_FUNCTIONS=['_meshlib_detect_...','_meshlib_free','_malloc','_free']"
)
```

---

## 2 — Building native `.dylib` (macOS)

The `.dylib` is used by the Python service on macOS for local development.

### Prerequisites

- GCC via Homebrew: `brew install gcc`
- Check version: `ls /opt/homebrew/bin/g++-*` (adjust `gcc-15`/`g++-15` below)

### One-time configure

From `meshlib/`:

```bash
rm -rf build-native

MESHLIB_LOCAL_BUILD_ENV=1 build_env=local cmake -B build-native \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=gcc-15 \
    -DCMAKE_CXX_COMPILER=g++-15 \
    -DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON \
    -DMESHLIB_BUILD_TESTS=OFF \
    -DMESHLIB_BUILD_APP_TARGETS=OFF \
    -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
    -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON
```

**Key difference from WASM:** uses `MESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON` instead of `MESHLIB_BUILD_WASM_DEMO=ON`, and uses system GCC instead of `emcmake`.

### Build

```bash
cmake --build build-native --target meshlib_noise_shells_native
```

Output:

```
meshlib/web/native_noise_shells/libmeshlib_noise_shells.dylib   (~1.4 MB)
```

### What the native CMakeLists.txt looks like

```cmake
cmake_minimum_required(VERSION 3.25)

if(EMSCRIPTEN)
    message(FATAL_ERROR "web/native_<name> is for native builds only")
endif()

set(TARGET_NAME meshlib_<name>_native)

add_library(${TARGET_NAME} SHARED                          # ← SHARED library, not executable
    ${CMAKE_CURRENT_LIST_DIR}/../wasm_<name>/<name>_api.cpp  # ← same source as WASM
)

target_link_libraries(${TARGET_NAME}
    PRIVATE
        ${MESHLIB_EXTENDED}
        ${MESHLIB_CORE}
)

set_target_properties(${TARGET_NAME} PROPERTIES
    OUTPUT_NAME "meshlib_<name>"
    LIBRARY_OUTPUT_DIRECTORY "${CMAKE_CURRENT_LIST_DIR}"    # ← writes .dylib/.so here
    C_VISIBILITY_PRESET default
    CXX_VISIBILITY_PRESET default
    VISIBILITY_INLINES_HIDDEN OFF
)
```

The only real differences from the WASM CMakeLists are:

- `add_library(... SHARED ...)` instead of `add_executable(...)`
- No Emscripten link options
- References the `.cpp` via relative path (`../wasm_<name>/`)

---

## 3 — Building native `.so` (Linux, via Docker)

**This is the critical step for deployment.** The `.so` is the Linux equivalent of `.dylib` and is required when the Python service runs on a Linux server (Azure, Docker, etc.).

Since we develop on macOS, we **cannot** build a Linux `.so` natively. We use Docker to cross-compile inside a Linux container.

### How it works

The script `meshlib-python-testing/scripts/build_native_lib.sh` does everything:

1. Starts a throwaway `gcc:14` Docker container (official GCC image from Docker Hub)
2. Mounts the `meshlib/` repo read-write at `/src/meshlib`
3. Mounts the output dir `meshlib-python-testing/app/native/` at `/output`
4. Inside the container:
   - Installs `cmake` and `git` via `apt-get`
   - Clones and installs Eigen 5.0.1 from source (header-only, into `/usr/local`)
   - Runs the same `cmake` configure as the macOS native build (but using the container's Linux GCC)
   - Builds all `*_native` targets
   - Copies the resulting `.so` files to `/output` (which is the mounted `app/native/` dir)
5. The container is removed (`--rm`) when done

### Running it

```bash
cd meshlib-python-testing
bash scripts/build_native_lib.sh
```

**Prerequisites:**

- Docker must be running (`docker info` to check)
- `meshlib/` must be a sibling directory (`../meshlib` relative to `meshlib-python-testing/`)

### What the script produces

```
meshlib/web/native_self_intersections/libmeshlib_self_intersections.so   (~1.3 MB)
meshlib/web/native_fill_holes/libmeshlib_fill_holes.so                  (~1.1 MB)
meshlib/web/native_noise_shells/libmeshlib_noise_shells.so              (~1.3 MB)

meshlib-python-testing/app/native/libmeshlib_self_intersections.so      (copied)
meshlib-python-testing/app/native/libmeshlib_fill_holes.so              (copied)
meshlib-python-testing/app/native/libmeshlib_noise_shells.so            (copied)
```

The `.so` files end up in **two** places:

1. Back in the meshlib source tree (because `LIBRARY_OUTPUT_DIRECTORY` writes there)
2. In `meshlib-python-testing/app/native/` (the explicit `cp` step for deployment)

### The full Docker command (annotated)

```bash
docker run --rm \                                    # throwaway container
    -v "$MESHLIB_ROOT":/src/meshlib \                # mount meshlib read-write
    -v "$PROJECT_ROOT/app/native":/output \          # mount output dir
    gcc:14 \                                         # official GCC 14 image (Debian-based)
    bash -c '
        # Install build tools
        apt-get update -qq && apt-get install -y -qq cmake git > /dev/null

        # Install Eigen (header-only math lib, needed by meshlib)
        cd /tmp
        git clone --depth 1 --branch 5.0.1 https://gitlab.com/libeigen/eigen.git
        cmake -S eigen -B eigen/build \
            -DCMAKE_INSTALL_PREFIX=/usr/local \
            -DBUILD_TESTING=OFF -DEIGEN_BUILD_BLAS=OFF \
            -DEIGEN_BUILD_LAPACK=OFF -DEIGEN_BUILD_DOC=OFF > /dev/null
        cmake --install eigen/build > /dev/null

        # Configure meshlib
        cd /src/meshlib
        MESHLIB_LOCAL_BUILD_ENV=1 build_env=local cmake -B /tmp/build-native \
            -DCMAKE_BUILD_TYPE=Release \
            -DCMAKE_CXX_FLAGS="-include cstdint" \   # Linux GCC needs explicit cstdint
            -DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON \
            -DMESHLIB_BUILD_TESTS=OFF \
            -DMESHLIB_BUILD_APP_TARGETS=OFF \
            -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
            -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON

        # Build all native targets
        cmake --build /tmp/build-native \
            --target meshlib_self_intersections_native \
                     meshlib_fill_holes_native \
                     meshlib_noise_shells_native \
            -j"$(nproc)"

        # Copy .so files to the mounted output directory
        cp /src/meshlib/web/native_self_intersections/libmeshlib_self_intersections.so /output/
        cp /src/meshlib/web/native_fill_holes/libmeshlib_fill_holes.so /output/
        cp /src/meshlib/web/native_noise_shells/libmeshlib_noise_shells.so /output/
    '
```

### Key differences: Docker `.so` build vs macOS `.dylib` build

| Aspect          | macOS `.dylib`                       | Docker `.so`                                              |
| --------------- | ------------------------------------ | --------------------------------------------------------- |
| Compiler        | Homebrew GCC (`g++-15`)              | Docker `gcc:14` (Debian GCC)                              |
| Extra CXX flag  | none                                 | `-include cstdint` (Linux compat)                         |
| Eigen           | `brew install eigen`                 | Cloned + installed from source inside container           |
| Build dir       | `meshlib/build-native/` (persistent) | `/tmp/build-native` (inside container, discarded)         |
| Output ext      | `.dylib`                             | `.so`                                                     |
| Output location | `meshlib/web/native_<name>/`         | Same, plus copied to `meshlib-python-testing/app/native/` |

### Why `-include cstdint`?

The meshlib C++ code uses `uint32_t`, `size_t` etc. On macOS with Homebrew GCC these are implicitly available, but Linux GCC 14 is stricter and needs the include. The `-include cstdint` flag forces it to be included in every translation unit.

---

## 4 — Adding a new tool to all three build targets

When creating a brand new mesh analysis tool (e.g. `wall_thickness`):

### Step 1: C++ source

Create `meshlib/web/wasm_wall_thickness/wall_thickness_api.cpp` with `extern "C"` functions.

### Step 2: WASM CMakeLists

Create `meshlib/web/wasm_wall_thickness/CMakeLists.txt` — copy from an existing one like `wasm_noise_shells/CMakeLists.txt` and update target name, source file, and exported functions.

### Step 3: Native CMakeLists

Create `meshlib/web/native_wall_thickness/CMakeLists.txt` — copy from `native_noise_shells/CMakeLists.txt` and update target name and source path.

### Step 4: Root CMakeLists.txt

Add `add_subdirectory(web/wasm_wall_thickness)` under the `MESHLIB_BUILD_WASM_DEMO` block (~line 467) and `add_subdirectory(web/native_wall_thickness)` under the `MESHLIB_BUILD_NATIVE_PYTHON_LIBS` block (~line 480).

### Step 5: Build

```bash
# WASM
cmake --build build-wasm-fillholes -j 8 --target meshlib_wall_thickness_wasm

# macOS .dylib
cmake --build build-native --target meshlib_wall_thickness_native

# Linux .so (update build_native_lib.sh first, then run it)
bash meshlib-python-testing/scripts/build_native_lib.sh
```

### Step 6: Update build_native_lib.sh

Add `meshlib_wall_thickness_native` to the `--target` list and add a `cp` line for the `.so`.

### Step 7: Deploy to consumers

```bash
# React app (WASM)
cp meshlib/web/wasm_wall_thickness/meshlib_wall_thickness.js   meshlib-react-fe/src/wasm/
cp meshlib/web/wasm_wall_thickness/meshlib_wall_thickness.wasm  meshlib-react-fe/public/

# Python service (native .so is already copied by build_native_lib.sh)
```

---

## Troubleshooting

| Problem                          | Fix                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `Eigen3Config.cmake not found`   | `brew install eigen` and pass `-DEigen3_DIR=/opt/homebrew/opt/eigen/share/eigen3/cmake` |
| `CI_COMMIT_SHA` error            | Prefix with `MESHLIB_LOCAL_BUILD_ENV=1 build_env=local`                                 |
| Emscripten can't find packages   | Add `-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER`                                         |
| `-Werror` on unused variable     | Fix the C++ source — both WASM and native share it                                      |
| Docker build fails to start      | Check `docker info` — Docker Desktop must be running                                    |
| `.dylib` loads but `.so` doesn't | They're built by different compilers; check Docker build output for warnings            |
| CORS / module loading in browser | Serve via `npm run dev` or `python3 -m http.server`, not `file://`                      |

---

## Quick reference: build commands

```bash
# All from meshlib/ root (except Docker script)

# WASM — any target
cmake --build build-wasm-fillholes -j 8 --target meshlib_<name>_wasm

# Native .dylib — any target
cmake --build build-native --target meshlib_<name>_native

# All .so files via Docker
cd meshlib-python-testing && bash scripts/build_native_lib.sh

# List available targets
cmake --build build-wasm-fillholes --target help | grep meshlib
cmake --build build-native --target help | grep meshlib
```
