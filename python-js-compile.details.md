# MeshLib: Native Python vs Browser WASM — Compilation Strategy

> **Date:** 10 Feb 2026
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
#define EMSCRIPTEN_KEEPALIVE   // no-op for native builds
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

|                        | Browser (JS)                                    | Server (Python)                                        |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| **Binary**             | `meshlib_self_intersections.wasm`               | `libmeshlib_self_intersections.dylib` (`.so` on Linux) |
| **Loader**             | Emscripten JS glue (`.js`)                      | Python `ctypes.CDLL()`                                 |
| **Same C++ source?**   | ✅ `self_intersections_api.cpp`                 | ✅ same file                                           |
| **Same exported fns?** | ✅ `meshlib_detect_self_intersections_stl` etc. | ✅ identical symbols                                   |
| **Compiler**           | Emscripten → WASM bytecode                      | GCC → native ARM64 machine code                        |

---

## What Changed

### `meshlib` repo (C++ side)

| File                                           | Change                                                                                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/native_self_intersections/CMakeLists.txt` | **New.** Builds `self_intersections_api.cpp` as a `SHARED` library. Outputs `libmeshlib_self_intersections.dylib` (macOS) or `.so` (Linux) into `web/native_self_intersections/`. |
| `CMakeLists.txt` (root, line ~41)              | Added option `MESHLIB_BUILD_NATIVE_PYTHON_LIBS` (default `OFF`). When `ON` and not Emscripten, runs `add_subdirectory(web/native_self_intersections)`.                            |

The existing WASM build (`web/wasm_self_intersections/`) is **completely untouched**.

### `meshlib-python-testing` repo (Python side)

| File                               | Change                                                                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `app/wasm/` (entire directory)     | **Deleted.** Removed the `wasmtime` loader, `.wasm` binary, and all WASI code.                                                         |
| `app/native/self_intersections.py` | **New.** `ctypes` wrapper class `SelfIntersections` with `.detect()` and `.repair()` methods matching the C signatures exactly.        |
| `app/main.py`                      | Rewritten. Loads the native lib at startup, exposes `POST /self-intersections/detect` and `POST /self-intersections/repair` endpoints. |
| `requirements.txt`                 | Removed `wasmtime`, `pydantic`. Added `python-multipart` (for file uploads).                                                           |
| `README.md`                        | Full rewrite with architecture diagram and build/run instructions.                                                                     |

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
    -DCMAKE_C_COMPILER=gcc-15 \
    -DCMAKE_CXX_COMPILER=g++-15 \
    -DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON \
    -DMESHLIB_BUILD_TESTS=OFF \
    -DMESHLIB_BUILD_APP_TARGETS=OFF \
    -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
    -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON

cmake --build build-native --target meshlib_self_intersections_native
```

This produces `web/native_self_intersections/libmeshlib_self_intersections.dylib` (2.5 MB).

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
| `-DCMAKE_C_COMPILER=gcc-15`             | Use Homebrew's real GCC (passes the geometry compiler allowlist). Adjust version to match `ls /opt/homebrew/bin/g++-*` |
| `-DMESHLIB_GEOMETRY_AS_SUBMODULE=ON`    | Build geometry from the submodule rather than looking for a pre-installed package                                      |
| `-DMESHLIB_BUILD_TESTS=OFF`             | Skip test targets (faster, avoids needing CppUnit)                                                                     |
| `-DMESHLIB_BUILD_APP_TARGETS=OFF`       | Skip the CLI app targets (mesh_compare, mesh_converter, etc.)                                                          |
| `-DMESHLIB_BUILD_WITH_OPEN_MP=OFF`      | Avoid needing a GCC-compatible OpenMP runtime on macOS                                                                 |
| `-DMESHLIB_BUILD_NATIVE_PYTHON_LIBS=ON` | Enables our new native shared-library target                                                                           |

---

## Why Native Over WASM-in-Python

|                        | Native (`ctypes`)        | WASM-in-Python (`wasmtime`)                   |
| ---------------------- | ------------------------ | --------------------------------------------- |
| **Speed**              | ~2-5× faster             | Interpreted overhead                          |
| **Debugging**          | GDB / LLDB just work     | Opaque WASM runtime                           |
| **Impedance mismatch** | None — plain C ABI       | Must stub Emscripten imports                  |
| **Dependencies**       | Zero (just the `.dylib`) | `wasmtime` + compatible WASM build            |
| **Portability**        | Mac + Linux (server)     | Theoretical only — browser WASM ≠ server WASM |

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

Then commit it:

```bash
git add app/native/libmeshlib_self_intersections.so
git commit -m "Add Linux native self-intersections library"
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
    native_self_intersections/            ← NEW
      CMakeLists.txt                      ← clang/gcc → .dylib / .so
      libmeshlib_self_intersections.dylib   (after build)

meshlib-python-testing/
  app/
    native/
      self_intersections.py               ← ctypes wrapper
    main.py                               ← FastAPI endpoints
    data/
      sample.stl
  requirements.txt
  run.sh
  README.md
```
