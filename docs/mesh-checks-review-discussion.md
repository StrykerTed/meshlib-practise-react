# Syklone mesh checks — discussion notes (for code review, discuss later)

Running notes seeded while fixing ADO #20089. These are **observations & open questions** for the
planned full review of the Syklone mesh checks (6 C++ checks + the `pkg-syklone-js` verdict layer;
no repair — Syklone has none yet). Not decisions.

---

## 1. The verdict layer conflates "boundary edges" with "defects" — likely why the checks cry wolf

While fixing #20089 I traced how results become the user-facing pass/fail. The bad_edges verdict is:

```js
// pkg-syklone-js/.../tool_part_creator/commands/command_import_components_locally_mesh_checks.js (~line 159)
const issues = (result.badEdgesCount || 0) + (result.badContoursCount || 0);
const isPassing = issues === 0;
```

and in the C++ (`web/wasm_bad_edges/bad_edges_api.cpp`):

```cpp
bad_edges_count = boundary_edges_count + non_manifold_edges_count + orientation_invalid_two_neighbor_edges_count;
```

**So `bad_edges_count` rolls boundary edges, non-manifold edges, and orientation-invalid edges into one
number, and the UI fails the part if that number (plus bad contours) is > 0.** Concretely, on the
watertight bridge, `bad_edges_count = 20 + 0 + 0 = 20` → the part showed overall **FAIL** even though it
has no real holes and no non-manifold edges. (My #20089 fix excludes T-junction edges from this count to
unblock the bridge, but the underlying conflation remains.)

**This is very likely a big contributor to "the checks often report bad meshes":**
- *Any* single-incidence (boundary) edge — i.e. any topologically open mesh — fails the part, even when
  it's geometrically fine or intentionally open. A boundary edge is a **fact about topology**, not by
  itself a **defect**.
- Three semantically different problems (open boundary / non-manifold / inconsistent orientation) are
  summed into one pass/fail. The user can't tell which, and any one trips the whole part.
- There is **no separate "watertight / closed" indicator** — closure is implied by `bad_edges_count`
  rather than reported as its own thing. (`inverted_normals` even computes an `isClosed` field, but the
  verdict ignores it.)

### Discussion questions
- Should "is the mesh closed/watertight?" be its **own** informational status, separate from "are there
  defects?" — so an open-but-valid mesh isn't auto-failed?
- Should boundary edges be a *warning*, non-manifold/orientation be *errors*, with distinct messaging,
  instead of one summed count?
- What does Syklone actually *require* of a part at this stage — must it be closed, or just free of
  non-manifold/self-intersection/inverted defects? The verdict should encode the real manufacturing
  requirement, not "any boundary edge = bad".

---

## 2. Two independent "holes" implementations that disagree

`findholes_v2` (half-edge topology, shares code with hole filling) and `bad_edges` (its own undirected
adjacency graph) are entirely separate and **disagreed** on the bridge (6 holes vs 8 contours). Two
sources of truth for the same concept is a correctness/trust problem and doubles maintenance (every fix
— like #20089 — must be applied twice).

### Discussion questions
- Unify on a **single topology pass** feeding all checks (boundary loops computed once; `bad_edges`
  layers its non-manifold/orientation reporting on top)? The new `ClassifyTJunctionSegments` helper is
  deliberately shared by both as a first step.
- Where should the shared topology/boundary model live (lib/extended vs a small dedicated module)?

---

## 3. Other things to probe in the review

- **Tolerances:** several checks use absolute epsilons against float32 STL coords. Scale-sensitivity =
  false positives/negatives on very small or very large parts. Audit each check's tolerance for
  scale-relativity.
- **Degenerate/duplicate faces, zero-area triangles, ASCII vs binary STL:** how does each check behave?
- **Double-counting across checks:** e.g. a self-intersection that's also reported as overlapping
  triangles — does the user see one issue or three?
- **Performance:** O(E²)-style hotspots (the #20089 line-grouping is one; check others) on large meshes.
- **Per-check verdict thresholds:** every check currently fails on `count > 0`. Is any of them prone to
  tiny/benign nonzero counts (noise shells, near-coincident overlaps) that should be warn-not-fail?
- **`isClosed` / `signedVolume`** from `inverted_normals` are computed but unused — surface them?

---

## 4. Suggested review shape (when we run it)

Multi-agent: one reviewer per check (bad_edges, findholes_v2, inverted_normals, noise_shells,
overlapping_triangles, self_intersections) + one for the `pkg-syklone-js` verdict/aggregation layer +
a consistency/architecture reviewer (the two-hole-paths + conflation issues above). Adversarially verify
findings, then synthesize a prioritized list with a concrete "fix the verdict semantics" proposal at the
top, since that's the most likely root cause of the "cries wolf" experience.
