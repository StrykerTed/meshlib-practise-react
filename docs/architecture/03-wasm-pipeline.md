# The WASM pipeline (C++ → browser)

This is the workflow that ties the repos together — the thing you'll touch most.
It's how one mesh algorithm becomes a browser-callable tool. The canonical
source of truth is [`meshlib/web/ADDING_NEW_TOOLS.md`](../../../meshlib/web/ADDING_NEW_TOOLS.md);
this doc summarizes it and records how the running code actually differs.

## The four layers of a "tool"

Each tool (`fill_holes`, `self_intersections`, `noise_shells`, …) exists across
four layers, all driven from **one** C++ source file:

```
1. C++ API     meshlib/web/wasm_<tool>/<tool>_api.cpp   (extern "C", plain C ABI)
                     │                         │
        emcmake/emcc │                         │ g++/gcc (same .cpp, relative path)
                     ▼                         ▼
2. WASM build  meshlib_<tool>.js + .wasm   3. Native build  libmeshlib_<tool>.dylib/.so
                     │                                        │
            copy to React                              load via ctypes
                     ▼                                        ▼
4a. React      src/wasm/ + src/workers/ + src/lib/    4b. Python (meshlib-python-testing)
               + src/pages/ + route                       FastAPI + app/native/<tool>.py
```

> **Heads-up — a fourth repo.** `ADDING_NEW_TOOLS.md` and the native/Python path
> reference **`meshlib-python-testing`** (FastAPI service, `app/native/`,
> `scripts/build_native_lib.sh` which cross-compiles the Linux `.so` in a
> `gcc:14` Docker container). That repo is **not** in this workspace's open
> folders. If you'll work on the server/parity side, you'll need to clone it.
> This is the real "docker compiler" of the system — not `meshlib-docker-compiler`
> (see [04-meshlib-docker-compiler.md](04-meshlib-docker-compiler.md)).

## The C ABI contract

Every tool exposes a plain C ABI so it's callable from both Emscripten and
ctypes. Rules (from the guide):

- `extern "C"`, functions return `int` (`0` = success).
- Inputs are raw STL bytes (`const uint8_t*`, `size_t`).
- Outputs via `malloc`'d buffers returned through `uint8_t** out_data, size_t* out_size`.
- Errors via `char** out_error`.
- Always export `meshlib_free(void* p)` so the caller can release buffers.
- Naming: `meshlib_<verb>_<noun>_stl(...)`.
- Compile clean under `-Werror` for **both** `emcc` and `g++` (shared source).

Example (`noise_shells`):
```c
int meshlib_detect_noise_shells_stl(const uint8_t* stl_data, size_t stl_size,
    uint32_t* out_total_components, uint32_t* out_noise_count,
    uint8_t** out_components_data, size_t* out_components_size, char** out_error);
int meshlib_remove_noise_shells_stl(const uint8_t* stl_data, size_t stl_size,
    float area_ratio_threshold, uint8_t** out_data, size_t* out_size,
    uint32_t* out_removed_components, char** out_error);
void meshlib_free(void* p);
```

## Building the WASM artifact

`web/wasm_<tool>/CMakeLists.txt` builds an Emscripten `add_executable` target
`meshlib_<tool>_wasm`, links `${MESHLIB_EXTENDED}` + `${MESHLIB_CORE}`, outputs
`OUTPUT_NAME meshlib_<tool>` **into its own source dir**, with link options:

| Flag | Why |
|------|-----|
| `MODULARIZE=1` | output is a factory function (call it to get a `Module`) |
| `EXPORT_ES6=1` | ES-module `import`/`export` |
| `ENVIRONMENT=web` | no Node polyfills |
| `ALLOW_MEMORY_GROWTH=1` | variable-size meshes |
| `FILESYSTEM=0` | smaller bundle; we pass raw bytes, no virtual FS |
| `EXPORTED_FUNCTIONS=[...]` | the `_meshlib_*` funcs + `_malloc`/`_free` |
| `EXPORTED_RUNTIME_METHODS=['HEAPU8','HEAPU32','HEAPF32']` | heap views for marshalling |

Configure once (local-build mode + geometry submodule so no Artifactory needed):

```bash
build_env=local MESHLIB_LOCAL_BUILD_ENV=1 \
emcmake cmake -S . -B build-wasm-fillholes \
  -DMESHLIB_GEOMETRY_AS_SUBMODULE=ON -DMESHLIB_BUILD_TESTS=OFF \
  -DMESHLIB_BUILD_APP_TARGETS=OFF -DMESHLIB_BUILD_WITH_OPEN_MP=OFF \
  -DMESHLIB_BUILD_WASM_DEMO=ON -DCMAKE_BUILD_TYPE=Release \
  -DEigen3_DIR=/opt/homebrew/opt/eigen/share/eigen3/cmake \
  -DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER

cmake --build build-wasm-fillholes -j 8 --target meshlib_<tool>_wasm
```
→ emits `meshlib_<tool>.js` (~50 KB) + `.wasm` (~1 MB) into `web/wasm_<tool>/`.

## Getting it into the React app

The guide's copy step (step 8a):
```bash
cp meshlib/web/wasm_<tool>/meshlib_<tool>.js   meshlib-react-fe/src/wasm/
cp meshlib/web/wasm_<tool>/meshlib_<tool>.wasm meshlib-react-fe/public/
```

> ⚠️ **Doc vs. reality.** The guide says the `.wasm` goes in `public/`. In the
> current checkout the `.wasm` files actually live in **`src/wasm/`** alongside
> the `.js` (there are no `meshlib_*.wasm` at `public/` root). Either works as
> long as the worker's `locateFile` resolves the URL the same way — just be aware
> the running app uses `src/wasm/` and follow the existing tools when adding one.
> Vite is configured for this (`@wasm` alias, `assetsInclude:["**/*.wasm"]`,
> `assetsInlineLimit:0`).

There is **no automated bridge** between the repos — copying is manual. If you
change C++, you must rebuild the WASM and re-copy.

## The runtime call path (browser)

Three matched files per tool, plus a TS declaration:

```
src/types/emscripten-public-wasm.d.ts   (module declarations for the .js)
src/wasm/meshlib_<tool>.js (+ .wasm)     (Emscripten output, copied in)
src/workers/<tool>.worker.ts             (loads WASM, runs the C ABI off-thread)
src/lib/<tool>Client.ts                  (promise API on the main thread)
src/pages/<Name>Page.tsx                 (UI: file picker + canvas + results)
```

Lifecycle (from the real `fillHolesClient.ts`):

1. A page constructs `new FillHolesClient()` in a `useEffect`, kept in a `useRef`; `dispose()`/terminate on unmount.
2. The client spawns `new Worker(new URL("../workers/fillHoles.worker.ts", import.meta.url), {type:"module"})` and `postMessage({kind:"ping"})`, resolving a `readyPromise` when the worker answers (15 s startup timeout).
3. `fillHoles(input: ArrayBuffer)` assigns a request `id`, posts `{id, input}` **transferring** the `ArrayBuffer`, and waits (default 120 s timeout). The client is resilient: on error/timeout/`messageerror` it terminates and **resets** the worker for the next run.
4. The worker dynamic-imports `../wasm/meshlib_<tool>.js`, instantiates the Emscripten `Module` (with `locateFile` to find the `.wasm`), `_malloc`s an input buffer, writes bytes to `Module.HEAPU8`, calls `_meshlib_<verb>_<noun>_stl(...)`, reads back the output buffer, `_meshlib_free`s, and posts `{id, ok:true, output, …counts}` back (transferring the output buffer).
5. The page renders the result — e.g. `STLBufferViewer` for a repaired mesh `ArrayBuffer`, or `IntersectionLines` for returned segment data.

## Adding a new tool — condensed checklist

Full version + troubleshooting in `ADDING_NEW_TOOLS.md`. The essentials:

**In `meshlib`:**
- [ ] `web/wasm_<tool>/<tool>_api.cpp` — the C ABI.
- [ ] `web/wasm_<tool>/CMakeLists.txt` — WASM target (`if(NOT EMSCRIPTEN) FATAL`).
- [ ] `web/native_<tool>/CMakeLists.txt` — native target, reuses the same `.cpp`.
- [ ] Root `CMakeLists.txt` — `add_subdirectory` for both, inside the `MESHLIB_BUILD_WASM_DEMO` / `MESHLIB_BUILD_NATIVE_PYTHON_LIBS` guards (~lines 467 / 480).
- [ ] Build: `--target meshlib_<tool>_wasm` (and `_native` for `.dylib`).

**In `meshlib-react-fe`:**
- [ ] Copy `.js` (→ `src/wasm/`) and `.wasm` (→ `src/wasm/`, per current practice).
- [ ] Add declarations in `src/types/emscripten-public-wasm.d.ts`.
- [ ] `src/workers/<tool>.worker.ts`, `src/lib/<tool>Client.ts`, `src/pages/<Name>Page.tsx`, and a route in `src/App.tsx`.

**In `meshlib-python-testing` (separate repo, for native/server parity):**
- [ ] `.so` via `scripts/build_native_lib.sh` (gcc:14 Docker), ctypes wrapper, FastAPI routes.

Then validate with the FE Playwright/parity suites (see [02-meshlib-react-fe.md](02-meshlib-react-fe.md)).

## Common gotchas

- **Missing `CI_COMMIT_SHA`** → prefix configure with `MESHLIB_LOCAL_BUILD_ENV=1 build_env=local`.
- **CMake can't find Eigen** → `brew install eigen` + `-DEigen3_DIR=/opt/homebrew/opt/eigen/share/eigen3/cmake`.
- **Emscripten shadows Homebrew packages** → `-DCMAKE_FIND_ROOT_PATH_MODE_PACKAGE=NEVER`.
- **`-Werror` fails** → the same `.cpp` must be warning-clean under both `emcc` and `g++`.
- **CORS / module load on `file://`** → serve over HTTP (Vite dev/preview, or `python3 -m http.server`).
