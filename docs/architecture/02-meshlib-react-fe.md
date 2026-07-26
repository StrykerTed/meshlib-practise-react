# meshlib-react-fe (web UI)

Path: `/Users/ted.tedford/Public/MyLocalRepos/meshlib-react-fe`

A browser STL viewer and mesh-tooling UI. It loads WASM modules compiled from the
`meshlib` C++ repo and renders 3D meshes plus diagnostic/repair results
(before/after) with Three.js. It is effectively the interactive test harness and
demo surface for meshlib's algorithms.

## Stack

- **React 18** + **TypeScript** (strict) + **Vite 5** (`@vitejs/plugin-react`).
- **React Router v7** for multi-page routing.
- **React Three Fiber 8** + **@react-three/drei 9** + **Three.js 0.162** for 3D.
- **styled-components 6** for styling.
- **Playwright** for e2e + parity tests.

### npm scripts (`package.json`)

| Script | Does |
|--------|------|
| `dev` | Vite dev server (hot reload, ~http://localhost:5173) |
| `build` | `tsc && vite build` → `dist/` |
| `preview` | Serve the production build |
| `test:e2e`, `test:e2e:ui`, `test:e2e:strict`, `test:e2e:pdf`, `test:e2e:video` | Playwright suites |
| `test:parity`, `test:parity:strict`, `test:parity:all` | Compare React WASM results vs Python native results |

## `src/` layout

```
src/
├── main.tsx            React 18 createRoot → mounts <App/> in StrictMode
├── App.tsx             React Router routes
├── routeLinks.ts       Route metadata (title/path/description) for nav cards
├── index.css
├── pages/              One component per route (Canvas + UI)
├── components/         Reusable 3D + UI components
├── lib/                <tool>Client.ts — main-thread wrappers around workers
├── workers/            <tool>.worker.ts — Web Workers that run the WASM
├── wasm/               meshlib_<tool>.js + .wasm (+ some .d.ts) — copied from meshlib
├── types/              emscripten module typings
├── constants/          colors.ts
└── styles/             SiteStyles.tsx, CanvasContainer.tsx
```

### Pages / routes (`App.tsx`, `pages/`)

| Route | Page | Purpose |
|-------|------|---------|
| `/` | `HomePage` | Landing page; cards from `routeLinks.ts`. |
| `/basics` | `BasicsPage` | Fill holes, detect/repair self-intersections, inverted normals, bad edges, overlapping triangles. |
| `/simplification` | `SimplificationPage` | Quadric-error mesh decimation. |
| `/smoothing` | `SmoothingPage` | Laplacian / Taubin / HC / tangential-relaxation smoothing. |
| `/annotations` | `AnnotationsPage` | Place landmarks & patches on the mesh surface. |
| `/mesh-checks` | `MeshChecksPage` | 3D visualization of diagnostic checks. |
| `/mesh-checks-text` | `MeshChecksTextPage` | Deterministic table runner over STL fixtures (drives Playwright; supports `?autorun=1`). |
| `/noise-checks` | `NoiseChecksPage` | Noise-shell detection & visualization. |
| `/wasm-checks`, `/wasm-tests/findholes-v2` | `WasmChecksTestPage` | Upload an STL and run all checks. |

### 3D components (`components/`)

- **Scene.tsx** — scene setup. **Z-up** coordinate system (medical/CAD convention: `DEFAULT_UP=(0,0,1)`), grid on the XY plane, multi-light rig + soft shadows, floor plane, `OrbitControls` with damping.
- **STLViewer.tsx** — loads `/stl/<file>` via Three's `STLLoader` (`useLoader`); clones geometry, recomputes normals, centers, optional auto-scale (fit to 50 units) and ground-align (sit on Z=0); renders with `meshPhysicalMaterial`, flat-shaded.
- **STLBufferViewer.tsx** — renders an STL from an in-memory `ArrayBuffer` (used for repaired meshes returned by WASM).
- **STLInteractiveViewer.tsx** — per-face vertex coloring, click raycasting for face selection, landmark spheres, contour `LineSegments` (used by annotations).
- **IntersectionLines.tsx** — overlays segment data (`Float32Array` of `[sx,sy,sz,ex,ey,ez,…]`) using the **same** center/scale/Z-align transform as STLViewer so overlays line up with the mesh.
- **FileSelector.tsx**, **Navbar.tsx**, **HelloButton.tsx** — UI.

### State

No global store (no Redux/Zustand). Local `useState`; client instances held in
`useRef` and created/disposed in `useEffect`; async work runs in Web Workers and
returns via `postMessage`.

## How the UI calls WASM (the client → worker → WASM pattern)

This is the central pattern — see [03-wasm-pipeline.md](03-wasm-pipeline.md) for
the full lifecycle. Per tool there are three matched files:

```
src/lib/<tool>Client.ts      (main thread)  — public async API, spawns the worker
src/workers/<tool>.worker.ts (worker thread) — dynamic-imports the WASM .js glue
src/wasm/meshlib_<tool>.js    + .wasm         — Emscripten module (copied from meshlib)
```

Flow: a page creates a `…Client` in `useEffect` → the client constructs a
`new Worker(new URL("../workers/<tool>.worker.ts", import.meta.url), {type:"module"})`
→ the worker does `import("../wasm/meshlib_<tool>.js")` and instantiates the
Emscripten `Module` (with a `locateFile` callback to find the `.wasm`) → input
STL bytes are written to `Module.HEAPU8` at a `_malloc`'d pointer → the C ABI
function (e.g. `_meshlib_fill_holes_stl`) is called → output bytes are read back,
`_meshlib_free`'d, and `postMessage`'d (transferring the `ArrayBuffer`) to the
main thread.

### Tools currently wired up (`src/lib/`, `src/workers/`, `src/wasm/`)

`fill_holes`, `findholes_v2` (`wasmChecksHolesClient`), `self_intersections`,
`overlapping_triangles`, `bad_edges`, `noise_shells`, `inverted_normals`,
`simplification`, `smoothing`, `annotations`. (All present as `.js` **and**
`.wasm` in `src/wasm/`.)

## Vite config (`vite.config.ts`)

- alias `@wasm` → `./src/wasm`
- `assetsInclude: ["**/*.wasm"]`, `build.assetsInlineLimit: 0` (keep `.wasm` as separate fetched assets)
- `worker.format: "es"`, `esbuild.target / build.target: "esnext"`
- `optimizeDeps.exclude` the WASM glue so Vite doesn't try to pre-bundle it

## STL fixtures (`public/`)

- `public/stl/` — fixtures served at `/stl/<file>` (e.g. `sample.stl`, `self-intersecting.stl`, `icosphere_with_holes.stl`, `test_noise.stl`), plus `public/stl/complex/` and `public/stl/pelvis/` anatomy meshes.
- `public/images/`, `public/expected/` (expected results for parity), `public/favicon-48x48.png`.

## Testing

`playwright.config.ts`: `testDir: ./tests`, Chromium, 10-min per-test timeout,
sequential (`fullyParallel:false`), `baseURL` ~`http://127.0.0.1:4173`, web server
launches the dev server, screenshots/trace on failure, video gated by `PW_VIDEO`.

- `tests/mesh-checks-text.spec.ts` — opens `/mesh-checks-text?autorun=1`, waits for the fixture suite, asserts all rows finish without ERROR and spot-checks specific PASS/FAIL outcomes.
- `tests/mesh-checks-text.strict.spec.ts`, `tests/mesh-checks-text.pdf.spec.ts` — strict + PDF-export variants.
- `tools/meshchecks_python_react_parity.js` — compares React/WASM diagnostics against Python/native results in `public/expected/python_expected_results.csv` (`npm run test:parity`).

`MeshChecksTextPage` doubles as the automation entry point: it runs all checks
over the STL fixtures and renders a PASS/FAIL/ERROR table, comparing to expected CSV.

## Existing markdown in the repo

Repo root: `README.md`, `how_to_cmake_new_things.md`,
`python-js-compile.details.md`, `meshlib-gap-analysis.md`,
`noise-shells-summary.md`, `stl_data_format_queries.md`, plus scratch files
(`ttd.md`, `tttdd.md`). `docs/`: `wasm_test_status.md`,
`wasm_updates_progress_todo.md`. The new architecture docs live in
`docs/architecture/` (this set).

## Build output (`dist/`)

`npm run build` → `dist/` with hashed JS/CSS bundles + separate worker chunks,
non-inlined `.wasm` assets, `stl/`, `images/`, `expected/`, and `index.html`.
