// Single source of truth for error type → color, shared by the 3D marker lines
// (ErrorMarkers) and the report-table legend swatches (RepairPage).
// Type ids match the `meshlib_locate_errors_stl` marker encoding.

export type ErrorType = 1 | 2 | 3 | 4;

export const ERROR_COLORS: Record<ErrorType, string> = {
  1: '#ef4444', // hole / boundary loop — red
  2: '#f59e0b', // non-manifold edge — amber
  3: '#ec4899', // self-intersection — pink
  4: '#eab308', // noise / extra component — yellow
};

export const ERROR_LABELS: Record<ErrorType, string> = {
  1: 'Holes',
  2: 'Non-manifold edges',
  3: 'Self-intersections',
  4: 'Noise / extra components',
};

// Maps a report-table metric key to the error color used for its swatch.
export const METRIC_COLOR: Record<string, string> = {
  holeCount: ERROR_COLORS[1],
  nonManifoldEdgeCount: ERROR_COLORS[2],
  selfIntersectionCount: ERROR_COLORS[3],
  componentCount: ERROR_COLORS[4],
};
