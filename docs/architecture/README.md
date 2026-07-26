# Meshlib System Architecture

> Onboarding + reference docs for the meshlib workspace. Written 2026-06-18 from a
> full investigation of the three sibling repos. Start here.

This workspace contains three sibling repositories that together deliver a
**browser-based mesh inspection & repair tool** backed by a Stryker C++ mesh
library compiled to WebAssembly.

| Repo | Language | Role |
|------|----------|------|
| [`meshlib`](#1-meshlib-c) | C++ | The mesh processing engine. Builds native libs, desktop apps, **WASM modules**, and native Python libs. |
| [`meshlib-react-fe`](#2-meshlib-react-fe) | React + TS | The web UI. Loads the WASM modules and renders 3D STL meshes + diagnostics. |
| [`meshlib-docker-compiler`](#3-meshlib-docker-compiler--mismatch) | Docker | ⚠️ Currently contains **unrelated** Syklone `case-manager` files, not meshlib build tooling. See note. |

## The big picture

```
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│  meshlib (C++)              │         │  meshlib-react-fe (React/TS)      │
│                             │         │                                   │
│  lib/core   lib/extended    │         │  pages/        components/        │
│  lib/grid   lib/registration│         │   (UI routes)   (3D viewers)      │
│       │                     │         │       │                           │
│       ▼                     │  build  │       ▼                           │
│  web/wasm_<tool>/           │  +copy  │  src/lib/<tool>Client.ts          │
│   <tool>_api.cpp  (C ABI)   │ ──────► │  src/workers/<tool>.worker.ts     │
│       │  emcmake/emcc       │         │  src/wasm/meshlib_<tool>.js+.wasm  │
│       ▼                     │         │       │                           │
│  meshlib_<tool>.js + .wasm  │         │       ▼ Emscripten heap + C ABI    │
│                             │         │  Three.js / R3F renders result    │
│  web/native_<tool>/  ───────┼────────►│  (Python service, parity testing) │
│   same .cpp → .dylib/.so    │         │                                   │
└─────────────────────────────┘         └──────────────────────────────────┘
```

**The core idea:** each mesh tool is written **once** as a plain C ABI in
`meshlib/web/wasm_<tool>/<tool>_api.cpp`, then compiled to **two targets** from
the same source:

- **WASM** (`emcmake`/Emscripten) → `meshlib_<tool>.js` + `.wasm`, consumed by the React app in the browser.
- **Native** (`.dylib`/`.so`) → consumed by a Python service for server-side use and parity testing.

The compiled WASM artifacts are **manually copied** from `meshlib/web/wasm_<tool>/`
into `meshlib-react-fe/src/wasm/`. There is no automated build bridge between the
repos today — see [03-wasm-pipeline.md](03-wasm-pipeline.md).

## Document map

| Doc | What's in it |
|-----|--------------|
| [01-meshlib-cpp.md](01-meshlib-cpp.md) | The C++ library: modules, directory layout, CMake build options, native vs WASM builds, key APIs, CI, tests. |
| [02-meshlib-react-fe.md](02-meshlib-react-fe.md) | The React app: stack, `src/` layout, pages/routes, the client→worker→WASM pattern, 3D rendering, Playwright tests. |
| [03-wasm-pipeline.md](03-wasm-pipeline.md) | **The cross-cutting workflow.** How a tool flows from C++ source → WASM → browser. Adding a new tool end-to-end. |
| [04-meshlib-docker-compiler.md](04-meshlib-docker-compiler.md) | What's actually in that repo, and why it does not match its name. |

## Pre-existing docs worth knowing about

These already exist and were **not** duplicated here — go to the source for detail:

In `meshlib/`:
- [`README.md`](../../../meshlib/README.md) — modules, SDMS/Artifactory install, dev workflow.
- [`ted_readme.md`](../../../meshlib/ted_readme.md) — local WASM FillHoles build walkthrough (macOS).
- [`web/ADDING_NEW_TOOLS.md`](../../../meshlib/web/ADDING_NEW_TOOLS.md) — the canonical "add a new tool" guide (C++/WASM/native/React/Python).
- `documentation/doxy_*.dox` — Doxygen API docs (data structures, IO, algorithms, registration, etc.).

In `meshlib-react-fe/` (repo root):
- `how_to_cmake_new_things.md` — building the WASM & native targets.
- `python-js-compile.details.md` — the two-target (WASM + native) compile strategy in depth.
- `meshlib-gap-analysis.md` — the 6 required mesh checks mapped to meshlib APIs + status.
- `noise-shells-summary.md`, `stl_data_format_queries.md` — topic deep-dives.
- `docs/wasm_test_status.md`, `docs/wasm_updates_progress_todo.md` — per-tool WASM migration/test status.

## 1. meshlib (C++)

Robust triangulated-surface mesh library (v1.6.49). Modular sub-libraries under
`lib/` (`core`, `extended`, `grid`, `registration`, `logging`, `common`,
`shape_model`), exported as `stryker::lib::mesh::*` CMake targets. Also builds
desktop apps (`app/`), a Doxygen doc site, and the dual WASM/native tool builds
under `web/`. Depends on a `geometry` git submodule (Eigen-based math). Full
detail in [01-meshlib-cpp.md](01-meshlib-cpp.md).

## 2. meshlib-react-fe

React 18 + TypeScript + Vite + React Three Fiber STL viewer and mesh-tooling UI.
Each tool is wrapped by a `src/lib/<tool>Client.ts` that spawns a
`src/workers/<tool>.worker.ts` Web Worker, which loads `src/wasm/meshlib_<tool>.js`
and calls into the WASM C ABI over the Emscripten heap. Results render via
Three.js. Playwright drives e2e + parity tests. Full detail in
[02-meshlib-react-fe.md](02-meshlib-react-fe.md).

## 3. meshlib-docker-compiler — ⚠️ mismatch

Despite the name, this repo's `Dockerfile`, `Dockerfile.fp`, and
`docker-compose.yml` currently describe the **Syklone `prd-svc-case-manager`**
Python service (MongoDB + RabbitMQ + Azurite) — **no** Emscripten, CMake, C++, or
meshlib content. It looks like leftover/misplaced files. Flagged for the team to
decide: repurpose it for real meshlib WASM compilation, or remove it. Detail in
[04-meshlib-docker-compiler.md](04-meshlib-docker-compiler.md).
