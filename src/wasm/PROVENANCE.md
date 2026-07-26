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

| Artifact | Built (mtime) | Notes |
|---|---|---|
| `meshlib_fill_holes` | 2026-02-05 | |
| `meshlib_annotations` | 2026-02-07 | |
| `meshlib_simplification` | 2026-02-07 | |
| `meshlib_smoothing` | 2026-02-07 | |
| `meshlib_noise_shells` | 2026-02-19 | |
| `meshlib_inverted_normals` | 2026-02-26 | |
| `meshlib_bad_edges` | 2026-03-01 | |
| `meshlib_findholes_v2` | 2026-03-01 | shares `fill_holes_api.cpp` |
| `meshlib_overlapping_triangles` | 2026-03-01 | |
| `meshlib_self_intersections` | 2026-03-01 | |
| `meshlib_repair_pipeline` | 2026-06-22 | **see caveat below** |

### Caveat: these are not reproducible from a clean commit

The reference checkout's HEAD is dated 2026-03-09, but `meshlib_repair_pipeline.wasm` was built
2026-06-22. It was therefore built from a **dirty working tree**, not from any commit — and that
tree carried uncommitted local changes, including `ClassifyTJunctionSegments` (ADO #20089), which
alters `FindHoles()` behaviour and is consumed by the repair pipeline's hole count.

Those working-tree changes are preserved as patch files in `wasm-src/patches/`. Rebuilding
`repair_pipeline` byte-for-identically in behaviour requires applying
`patches/tjunction-ado20089.patch`. Without it, hole counts will differ on meshes containing
T-junctions.

Going forward, every rebuild should update the table above with the meshlib commit hash and the
list of applied patches.

## Toolchain used

- Emscripten **4.0.8** (Homebrew, not emsdk) — note the CI pipeline in `meshlib` pins 4.0.4
- Eigen 5.0.1 (Homebrew), header-only
- CMake 3.31.5
- macOS arm64

Each module is a **separate, self-contained binary with meshlib statically linked in**. Modules
never share memory or state and are lazy-loaded per page, so artifacts built from *different*
meshlib versions can safely coexist in this app — there is no cross-module ABI surface.
