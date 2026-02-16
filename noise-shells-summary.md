# Noise Shells in Materialise Magics

## Overview

Noise shells are small, disconnected clusters of triangles within an STL mesh that have no geometrical meaning. They are not connected to the main part geometry and do not enclose a valid volume. Magics treats these as waste artifacts that can typically be safely removed, though it recommends visual inspection before deletion since even a small shell of a few triangles could occasionally be important.

## Display Mode (Diagnostics)

In display/diagnostics mode (section 16.2.2.2.7 in the documentation), Magics identifies and highlights noise shells within the mesh. This allows the user to visually inspect which shells have been flagged before deciding whether to remove them. The recommendation is to always review flagged shells before removal.

## Fix Mode (Removal)

In the fix wizard's advanced options, noise shell removal is controlled by a single **"Remove noise shells"** checkbox. When enabled, Magics automatically detects and removes all shells it classifies as geometrical noise during the fix operation.

The documentation notes that the algorithm is conservative — it prefers to play it safe, and occasionally some noise shells may not be removed automatically.

## Assumptions

Based on the available documentation, the noise shell removal process appears to work as follows:

1. **Shell identification** — Magics analyses the mesh topology to identify discrete, disconnected groups of triangles (shells) that are not part of the main body.
2. **Volume/connectivity test** — Each shell is evaluated for whether it encloses a meaningful volume and whether it connects to the primary geometry. Shells that fail both criteria are classified as noise.
3. **Automatic removal** — When the checkbox is ticked, all identified noise shells are deleted from the mesh in a single pass. There are no user-configurable thresholds specifically for noise shell detection (e.g. minimum triangle count or shell size) — it is a binary on/off operation.
4. **Conservative bias** — The algorithm errs on the side of keeping shells rather than removing legitimate geometry, meaning some noise may survive the automatic pass and require manual cleanup.
5. **Part of broader fix pipeline** — Noise shell removal sits alongside other advanced fix options (sharp triangle filtering, hole closing, triangle reduction) and is typically run as part of a combined STL repair workflow rather than in isolation.
