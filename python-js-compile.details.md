# MeshLib: Native Python vs Browser WASM — Compilation Strategy

> **Date:** 26 Feb 2026
> **Repos:** `meshlib`, `meshlib-python-testing`, `meshlib-react-fe`

---

## The Problem

We had a `meshlib-python-testing` service that tried to load an **Emscripten-compiled `.wasm`** file using `wasmtime` (a Python WASM runtime). This didn't work because:

1. The WASM binary was built with Emscripten flags (`-sMODULARIZE`, `-sEXPORT_ES6`, `-sENVIRONMENT=web`) that produce a JS+WASM bundle expecting **browser APIs** and Emscripten JS glue.
2. `wasmtime` runs standalone WASM/WASI — it cannot satisfy Emscripten-specific imports like `emscripten_memcpy_js`, `abort`, etc.
3. Even recompiling with `-sSTANDALONE_WASM` would only get partway there; it's still running C++ through a WASM interpreter in Python, which is ~2-5× slower than native for no real benefit.

**WASM's portability advantage only matters in the browser.** On a server (macOS/Linux), native compilation is simpler, faster, and easier to debug.

---

## The Solution: Two Build Targets, Same C++ Source

The key insight: **`self_intersections_api.cpp` is already portable.** It has this guard:

```cpp
#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#if defined(_WIN32)
#define EMSCRIPTEN_KEEPALIVE __declspec(dllexport)
#else
#define EMSCRIPTEN_KEEPALIVE __attribute__((visibility("default"), used))
#endif
#endif
```

All the `extern "C"` functions (`meshlib_detect_self_intersections_stl`, `meshlib_repair_self_intersections_stl`, `meshlib_free`) are plain C-callable symbols either way. So we just added a **second CMake target** that builds the same source as a native shared library.

### Before (browser only)

```
self_intersections_api.cpp  →  Emscripten  →  .wasm + .js  →  Browser (JS)
```

### After (browser + Python)

```
self_intersections_api.cpp  →  Emscripten  →  .wasm + .js   →  Browser (JS)
                            →  clang/gcc   →  .dylib / .so  →  Python (ctypes)
```

### Side-by-Side Comparison

|                        | Browser (JS)                                                                                                               | Server (Python)                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Binaries**           | `meshlib_self_intersections.wasm`, `meshlib_fill_holes.wasm`, `meshlib_overlapping_triangles.wasm`, `meshlib_bad_edges.wasm`, `meshlib_noise_shells.wasm`, `meshlib_inverted_normals.wasm` | `libmeshlib_self_intersections.dylib`, `libmeshlib_fill_holes.dylib`, `libmeshlib_bad_edges.dylib`, `libmeshlib_noise_shells.dylib`, `libmeshlib_inverted_normals.dylib` (`.so` on Linux) |
| **Loader**             | Emscripten JS glue (`.js`)                                                                                                 | Python `ctypes.CDLL()`                                                                                                                                                                    |
| **Same C++ source?**   | ✅ `self_intersections_api.cpp`, `fill_holes_api.cpp`                                                                      | ✅ same files                                                                                                                                                                             |
| **Same exported fns?** | ✅ `meshlib_detect_self_intersections_stl` etc.                                                                            | ✅ identical symbols                                                                                                                                                                      |
| **Compiler**           | Emscripten → WASM bytecode                                                                                                 | GCC `-O3` → native ARM64 machine code                                                                                                                                                     |

---

## What Changed

### `meshlib` repo (C++ side)

| File                                           | Change                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/wasm_overlapping_triangles/CMakeLists.txt` | WASM target for overlapping-triangle **detection** (`meshlib_overlapping_triangles.{js,wasm}`).                                                                                  |
| `web/wasm_bad_edges/CMakeLists.txt`             | WASM target for bad-edges/bad-contours **detection** (`meshlib_bad_edges.{js,wasm}`).                                                                                           |
| `web/native_self_intersections/CMakeLists.txt` | **New.** Builds `self_intersections_api.cpp` as a `SHARED` library. Outputs `libmeshlib_self_intersections.dylib` (macOS) or `.so` (Linux) into `web/native_self_intersections/`. |
| `web/native_fill_holes/CMakeLists.txt`         | **New.** Builds `fill_holes_api.cpp` as a `SHARED` library. Outputs `libmeshlib_fill_holes.dylib` / `.so`. Adds `-Wno-sign-compare` for a GCC warning in the raw-mesh helper.     |
| `web/native_bad_edges/CMakeLists.txt`          | **New.** Builds `bad_edges_api.cpp` as a `SHARED` library. Outputs `libmeshlib_bad_edges.dylib` / `.so`.                                                                          |
| `web/native_noise_shells/CMakeLists.txt`       | **New.** Builds `noise_shells_api.cpp` as a `SHARED` library. Outputs `libmeshlib_noise_shells.dylib` / `.so`.                                                                    |
| `web/native_inverted_normals/CMakeLists.txt`   | **New.** Builds `inverted_normals_api.cpp` as a `SHARED` library. Outputs `libmeshlib_inverted_normals.dylib` / `.so`.                                                            |
| `CMakeLists.txt` (root, line ~41)              | Added option `MESHLIB_BUILD_NATIVE_PYTHON_LIBS` (default `OFF`). When `ON` and not Emscripten, runs `add_subdirectory` for native targets; WASM demo block includes overlapping + bad-edges targets. |

The existing WASM pipeline remains browser-oriented and uses Emscripten JS glue + `.wasm` assets.

## Browser WASM Details (meshlib-react-fe)

`meshlib-react-fe` loads MeshLib WebAssembly through worker-backed clients in `src/lib/*Client.ts` and `src/workers/*.worker.ts`.

Detection coverage expected in browser WASM:

- `meshlib_self_intersections.{js,wasm}`
- `meshlib_fill_holes.{js,wasm}`
- `meshlib_overlapping_triangles.{js,wasm}`
- `meshlib_bad_edges.{js,wasm}`
- `meshlib_noise_shells.{js,wasm}`
- `meshlib_inverted_normals.{js,wasm}`

### Detection-only constraint for new WASMs

For the newly added browser checks (`overlapping_triangles`, `bad_edges`), WASM exports are **detect-only**.

- ✅ Allowed: detection/statistics APIs (`meshlib_detect_*`)
- ❌ Not allowed: any mesh-fix/repair mutation API in these new WASM modules

This keeps UI checks non-destructive and aligned with case-manager reporting.

### JavaScript module extension policy

Use Emscripten glue files as `.js` only.

- ✅ `meshlib_<tool>.js`
- ❌ `meshlib_<tool>.mjs`

`meshlib-react-fe` imports these modules directly from `src/wasm/` in workers, so `.js` is the required convention.

### `meshlib-python-testing` repo (Python side)

| File                               | Change                                                                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/wasm/` (entire directory)     | **Deleted.** Removed the `wasmtime` loader, `.wasm` binary, and all WASI code.                                                                  |
| `app/native/self_intersections.py` | **New.** `ctypes` wrapper class `SelfIntersections` with `.detect()` and `.repair()` methods matching the C signatures exactly.                 |
| `app/native/fill_holes.py`         | **New.** `ctypes` wrapper class `FillHoles` with `.find_holes()` method. Wraps `meshlib_find_holes_stl` (detect-only, no repair).               |
| `app/native/bad_edges.py`          | **New.** `ctypes` wrapper class `BadEdges` with deterministic Phase A diagnostics (`bad_edges`, `bad_contours`, boundary/non-manifold details). |
| `app/main.py`                      | Rewritten (v0.3.0). Loads both native libs at startup, exposes SI + holes + mesh-report endpoints.                                              |
| `requirements.txt`                 | Removed `wasmtime`, `pydantic`. Added `python-multipart` (for file uploads).                                                                    |
| `README.md`                        | Full rewrite with architecture diagram and build/run instructions.                                                                              |

---

## The macOS Compiler Problem

The WASM build works effortlessly because the `geometry` submodule's `CMakeLists.txt` has a compiler allowlist:

```cmake
# geometry/CMakeLists.txt line ~63
if(NOT MSVC AND NOT CMAKE_COMPILER_IS_GNUCXX AND NOT EMSCRIPTEN)
    message(FATAL_ERROR "compiler not allowed, used compiler = [${CMAKE_CXX_COMPILER_ID}]")
endif()
```

Allowed: **MSVC** (Windows CI), **GCC** (Linux CI), **Emscripten** (WASM). **Not** allowed: **AppleClang** (your Mac).

This is why the Emscripten WASM build "just works" — it passes the check — while a naïve native build on macOS fails immediately with `compiler not allowed, used compiler = [AppleClang]`.

We can't change the `meshlib` repo, so we need a workaround.

### Solution: Install Real GCC via Homebrew

macOS ships "gcc" but it's actually AppleClang in disguise. Homebrew can install **real GNU GCC**, which CMake identifies as `GNU` — passing the geometry check.

```bash
# 1. Install real GCC (one-time, ~5 min)
brew install gcc

# 2. Check which version was installed
ls /opt/homebrew/bin/g++-*
# → e.g. /opt/homebrew/bin/g++-14

# 3. Eigen3 is also needed (geometry dependency)
brew install eigen
```

### Verify the install

```bash
# Apple's fake gcc (reports clang):
/usr/bin/g++ --version
# → Apple clang version 17.0.0 ...

# Homebrew's real GCC:
/opt/homebrew/bin/g++-14 --version
# → g++-14 (Homebrew GCC 14.x.x) ...
```

---

## How to Build & Run

### Build the native shared library (from `meshlib/`)

You **must** use the Homebrew GCC compilers (not the default AppleClang), plus two env vars to bypass CI-only checks in both the meshlib and geometry submodule CMakeLists.

> ⚠️ **Important:** If you've run cmake before with a different compiler, you **must** delete `build-native/` first (`rm -rf build-native`) — CMake caches the compiler and cannot switch in-place.

```bash
cd meshlib
rm -rf build-native   # always start clean when changing compilers

# Adjust gcc-15 / g++-15 to match: ls /opt/homebrew/bin/g++-*
MESHLIB_LOCAL_BUILD_ENV=1 build_env=local cmake -B build-native \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER=gcc-15 \
    -DCMAKE_CXX_COMPILER=g++-15 \
    -DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON \
    -DMESHLIB_BUILD_TESTS=OFF \
    -DMESHLIB_BUILD_APP_TARGETS=OFF \
    -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
    -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON

cmake --build build-native --target meshlib_self_intersections_native meshlib_fill_holes_native meshlib_bad_edges_native meshlib_noise_shells_native meshlib_inverted_normals_native
```

This produces:

- `web/native_self_intersections/libmeshlib_self_intersections.dylib` (~1.4 MB)
- `web/native_fill_holes/libmeshlib_fill_holes.dylib` (~1.2 MB)
- `web/native_bad_edges/libmeshlib_bad_edges.dylib` (~0.8 MB)
- `web/native_noise_shells/libmeshlib_noise_shells.dylib` (~1.4 MB)
- `web/native_inverted_normals/libmeshlib_inverted_normals.dylib` (~1.0 MB)

For Linux `.so` files (needed for Docker / Azure), use the Docker build script:

```bash
cd meshlib-python-testing
bash scripts/build_native_lib.sh
# → app/native/libmeshlib_self_intersections.so (~1.3 MB)
# → app/native/libmeshlib_fill_holes.so (~1.1 MB)
# → app/native/libmeshlib_bad_edges.so (~0.8 MB)
# → app/native/libmeshlib_noise_shells.so (~1.3 MB)
# → app/native/libmeshlib_inverted_normals.so (~1.1 MB)
```

Verify that inverted normals exports both required detect APIs:

```bash
nm -D app/native/libmeshlib_inverted_normals.so | grep meshlib_detect_inverted_normals
# expected:
# meshlib_detect_inverted_normals_stl
# meshlib_detect_inverted_normals_local_stl
```

If the local symbol is missing, `/meshchecks/inverted-normals` in case-manager will fail at runtime.

> ⚠️ **`-DCMAKE_BUILD_TYPE=Release` is critical!** Without it CMake defaults to no optimisation flags — the library runs **~11× slower** (11.5s vs 1.0s for a 5.6 MB STL). Release mode enables `-O3 -DNDEBUG`.

> **Note:** The first build compiles geometry + mesh_core + mesh_extended from source (~2 min). Subsequent builds are incremental and fast.

### Start the Python service (from `meshlib-python-testing/`)

```bash
cd meshlib-python-testing
./run.sh
# → opens http://localhost:8000/docs
```

### Test

```bash
curl -X POST http://localhost:8000/self-intersections/detect \
     -F "file=@app/data/sample.stl"
```

The Python service auto-discovers the `.dylib`/`.so` at `../meshlib/web/native_self_intersections/`. Override with `MESHLIB_NATIVE_LIB_DIR=/custom/path`.

### Flags explained

| Flag                                    | Why                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `MESHLIB_LOCAL_BUILD_ENV=1`             | Env var that enables local-dev mode in **meshlib**, bypassing the CI-only `CI_COMMIT_SHA` requirement                  |
| `build_env=local`                       | Env var that enables local-dev mode in the **geometry** submodule (has its own separate `CI_COMMIT_SHA` check)         |
| `-DCMAKE_BUILD_TYPE=Release`            | **Critical.** Enables `-O3` optimisation. Without it the build is ~11× slower                                          |
| `-DCMAKE_C_COMPILER=gcc-15`             | Use Homebrew's real GCC (passes the geometry compiler allowlist). Adjust version to match `ls /opt/homebrew/bin/g++-*` |
| `-DMESHLIB_GEOMETRY_AS_SUBMODULE=ON`    | Build geometry from the submodule rather than looking for a pre-installed package                                      |
| `-DMESHLIB_BUILD_TESTS=OFF`             | Skip test targets (faster, avoids needing CppUnit)                                                                     |
| `-DMESHLIB_BUILD_APP_TARGETS=OFF`       | Skip the CLI app targets (mesh_compare, mesh_converter, etc.)                                                          |
| `-DMESHLIB_BUILD_WITH_OPEN_MP=OFF`      | Avoid needing a GCC-compatible OpenMP runtime on macOS                                                                 |
| `-DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON` | Enables native shared-library targets (self-intersections + fill-holes + bad-edges + noise-shells + inverted-normals)  |

---

## Why Native Over WASM-in-Python

|                        | Native (`ctypes`)                                 | WASM-in-Python (`wasmtime`)                   |
| ---------------------- | ------------------------------------------------- | --------------------------------------------- |
| **Speed**              | ~5× faster than WASM (1.0s vs 5.3s on 5.6 MB STL) | Interpreted overhead                          |
| **Debugging**          | GDB / LLDB just work                              | Opaque WASM runtime                           |
| **Impedance mismatch** | None — plain C ABI                                | Must stub Emscripten imports                  |
| **Dependencies**       | Zero (just the `.dylib`)                          | `wasmtime` + compatible WASM build            |
| **Portability**        | Mac + Linux (server)                              | Theoretical only — browser WASM ≠ server WASM |

The only scenario where WASM-in-Python makes sense is if you literally **cannot compile natively** on the target platform. Since MeshLib already has CMake and builds on Mac/Linux, native is the clear winner.

---

## Platform-Specific Binaries

The native library is **machine code compiled for a specific OS + CPU**. It is not cross-platform like WASM.

| OS          | File extension | Built on your Mac? | Needed for Azure? |
| ----------- | -------------- | ------------------ | ----------------- |
| **macOS**   | `.dylib`       | ✅ Yes (GCC-15)    | ❌ No             |
| **Linux**   | `.so`          | ❌ No              | ✅ Yes            |
| **Windows** | `.dll`         | ❌ No              | ❌ (unlikely)     |

You must compile **on the same OS where Python will run**. The `.dylib` on your Mac is for local dev. Azure runs Linux, so you need the `.so`.

### Building the `.so` for Azure (Docker on your Mac)

Use the provided script to compile inside a Linux container:

```bash
cd meshlib-python-testing
./scripts/build_native_lib.sh
```

This:

1. Spins up a `gcc:14` Docker container
2. Mounts the meshlib repo (read-only)
3. Runs the same cmake + build inside Linux
4. Copies the resulting `.so` to `app/native/libmeshlib_self_intersections.so`
5. Copies all generated `.so` outputs to `app/native/` (`self_intersections`, `fill_holes`, `bad_edges`, `noise_shells`, `inverted_normals`)

For case-manager, copy/update the Linux libs and rebuild the service:

```bash
cp app/native/libmeshlib_*.so ../SykloneAll/Syklone/prd-svc-case-manager/prd_svc_case_manager/meshchecks/lib/
docker compose -f ../SykloneAll/docker-compose-services.yml -p python-services build prd-svc-case-manager
docker compose -f ../SykloneAll/docker-compose-services.yml -p python-services up -d --force-recreate prd-svc-case-manager
```

Optional verification inside the running container:

```bash
docker exec python-services-prd-svc-case-manager-1 sh -lc "nm -D /usr/prd-svc-case-manager/prd_svc_case_manager/meshchecks/lib/libmeshlib_inverted_normals.so | grep meshlib_detect_inverted_normals"
```

Then commit it:

```bash
git add app/native/libmeshlib_self_intersections.so app/native/libmeshlib_fill_holes.so app/native/libmeshlib_bad_edges.so app/native/libmeshlib_noise_shells.so app/native/libmeshlib_inverted_normals.so
git commit -m "Add Linux native mesh libraries (.so)"
git push
```

### Library search order

The Python `ctypes` wrapper looks for the library in this order:

1. `MESHLIB_NATIVE_LIB_DIR` env var (explicit override)
2. `app/native/` directory (committed `.so` — used in production)
3. `../meshlib/web/native_self_intersections/` (sibling repo — local dev with `.dylib`)

On Azure, option 2 "just works" with the committed `.so`. On your Mac, option 3 finds the `.dylib` automatically.

---

## File Layout (Final State)

```
meshlib/
  web/
    wasm_self_intersections/              ← Existing (unchanged)
      CMakeLists.txt                      ← Emscripten → .wasm + .js
      self_intersections_api.cpp          ← THE shared C++ source
      meshlib_self_intersections.js
      meshlib_self_intersections.wasm
    wasm_fill_holes/
      CMakeLists.txt
      fill_holes_api.cpp
      meshlib_fill_holes.js
      meshlib_fill_holes.wasm
    wasm_overlapping_triangles/
      CMakeLists.txt
      overlapping_triangles_api.cpp
      meshlib_overlapping_triangles.js
      meshlib_overlapping_triangles.wasm
    wasm_bad_edges/
      CMakeLists.txt
      bad_edges_api.cpp
      meshlib_bad_edges.js
      meshlib_bad_edges.wasm
    wasm_noise_shells/
      CMakeLists.txt
      noise_shells_api.cpp
      meshlib_noise_shells.js
      meshlib_noise_shells.wasm
    wasm_inverted_normals/
      CMakeLists.txt
      inverted_normals_api.cpp
      meshlib_inverted_normals.js
      meshlib_inverted_normals.wasm
    native_self_intersections/            ← NEW
      CMakeLists.txt                      ← gcc → .dylib / .so
      libmeshlib_self_intersections.dylib   (after build, ~1.4 MB)
    native_fill_holes/                    ← NEW
      CMakeLists.txt                      ← gcc → .dylib / .so
      libmeshlib_fill_holes.dylib           (after build, ~1.2 MB)
    native_bad_edges/                    ← NEW
      CMakeLists.txt                      ← gcc → .dylib / .so
      libmeshlib_bad_edges.dylib           (after build, ~0.8 MB)
    native_noise_shells/                  ← NEW
      CMakeLists.txt                      ← gcc → .dylib / .so
      libmeshlib_noise_shells.dylib         (after build, ~1.4 MB)
    native_inverted_normals/              ← NEW
      CMakeLists.txt                      ← gcc → .dylib / .so
      libmeshlib_inverted_normals.dylib     (after build, ~1.0 MB)

meshlib-python-testing/
  app/
    native/
      self_intersections.py               ← ctypes wrapper (SI detect + repair)
      fill_holes.py                       ← ctypes wrapper (hole detection)
      bad_edges.py                        ← ctypes wrapper (bad-edges + bad-contours diagnostics)
      noise_shells.py                     ← ctypes wrapper (noise-shell detect + remove)
      inverted_normals.py                 ← ctypes wrapper (closed-mesh inversion detect + repair)
    main.py                               ← FastAPI endpoints (v0.3.0)
    data/
      sample.stl
      high_cube.stl
      ... (9 test STL files)
  requirements.txt
  run.sh
  README.md
```
