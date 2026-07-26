# WASM artifact provenance

These `.wasm` binaries and their Emscripten glue `.js` files are **build outputs**, committed
deliberately so the app never depends on a local C++ toolchain or on any particular checkout of
`meshlib` being present.

`meshlib` is a third-party dependency (Stryker GitLab,
`strykercorp/robotics/geometry-modeling/meshlib.git`) that we **consume but do not own or
maintain**. We cannot commit to it. Therefore:

- The C ABI binding source that produces these artifacts lives in **`wasm-src/`** in this repo.
- Local `meshlib` checkouts are treated as **read-only, pinned build inputs** — never modified.
- Any source change `meshlib` needs is carried as a patch file in `wasm-src/patches/`.

## Rebuilding

See `wasm-src/README.md`. In short:

```bash
cd wasm-src
./build.sh --meshlib-path /path/to/pristine/meshlib --tool repair_pipeline
```

## Known provenance

Recorded 2026-07-26. **Prior to this date nothing was version-stamped**, so per-artifact
provenance below is reconstructed from file mtimes and is best-effort, not authoritative.

The reference checkout was `/Users/ted.tedford/Public/MyLocalRepos/meshlib` at commit
`d4c6f67e5d18582f687e799f4da1859d9008b1d1` — `master`, `VERSION` 1.6.49, dated 2026-03-09.

| Artifact | Built (mtime) | Has T-junction fix? | Notes |
|---|---|---|---|
| `meshlib_simplification` | 2026-02-07 | n/a | |
| `meshlib_annotations` | 2026-02-07 | n/a | |
| `meshlib_smoothing` | 2026-02-07 | n/a | |
| `meshlib_fill_holes` | 2026-02-15 | no | pre-dates the fix |
| `meshlib_noise_shells` | 2026-02-19 | n/a | |
| `meshlib_inverted_normals` | 2026-02-26 | n/a | |
| `meshlib_overlapping_triangles` | 2026-03-01 | n/a | |
| `meshlib_self_intersections` | 2026-03-01 | n/a | |
| `meshlib_repair_pipeline` | 2026-06-22 | **yes** (via `FindHoles`) | |
| `meshlib_findholes_v2` | 2026-06-24 13:28 | **yes** (via `FindHoles`) | shares `fill_holes_api.cpp` |
| `meshlib_bad_edges` | 2026-06-24 13:36 | **yes** (direct call) | |

"n/a" means the module does not call `FindHoles()` and is unaffected.

### Caveat: these are not reproducible from a clean commit

The reference checkout's HEAD is dated 2026-03-09, but several artifacts were built later, from a
**dirty working tree** rather than from any commit. That tree carried uncommitted local changes,
notably `ClassifyTJunctionSegments` (ADO #20089).

That fix has two call sites:

- `FillHoles_C::FindHoles()` itself (`lib/extended/src/algorithms/fill_holes.cpp:454`) — so every
  module that calls `FindHoles` inherits it
- `wasm_bad_edges/bad_edges_api.cpp:245` — a direct call

Rebuilding any of the three "yes" modules above **requires applying
`wasm-src/patches/tjunction-ado20089.patch`**. Without it, hole counts and bad-edge counts will
differ on meshes containing T-junctions — a geometrically watertight mesh with non-conforming
triangulation will be wrongly reported as having holes. Background:
`docs/mesh-checks-tjunction-fix-20089.md`. Regression test:
`meshlib-python-testing/tests/test_tjunction_holes.py` (7 cases).

### Drift found and corrected, 2026-07-26

At the time of this commit three artifacts in this directory were **stale** — the fixed builds
existed only in the untracked `meshlib/web/` working directory and had never been copied across:

| Module | Was | Corrected to |
|---|---|---|
| `meshlib_bad_edges` | 2026-03-01 | 2026-06-24 13:36 |
| `meshlib_findholes_v2` | 2026-03-01 | 2026-06-24 13:28 |
| `meshlib_fill_holes` | 2026-02-05 | 2026-02-15 |

In other words the T-junction fix had been built but never shipped into this app. This is exactly
the failure mode that untracked artifacts and a manual copy step produce.

Going forward, every rebuild must update the table above with the meshlib commit hash and the list
of applied patches, in the same commit as the binaries.

## Toolchain used

- Emscripten **4.0.8** (Homebrew, not emsdk) — note the CI pipeline in `meshlib` pins 4.0.4
- Eigen 5.0.1 (Homebrew), header-only
- CMake 3.31.5
- macOS arm64

Each module is a **separate, self-contained binary with meshlib statically linked in**. Modules
never share memory or state and are lazy-loaded per page, so artifacts built from *different*
meshlib versions can safely coexist in this app — there is no cross-module ABI surface.
