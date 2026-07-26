export interface RouteLink {
  title: string;
  path: string;
  description: string;
}

export const routeLinks: RouteLink[] = [
  {
    title: "Basics",
    path: "/basics",
    description:
      "Fill holes, detect & repair self-intersections on STL meshes using MeshLib WASM modules with a live 3D preview.",
  },
  {
    title: "Simplification",
    path: "/simplification",
    description:
      "Reduce triangle count using quadric error metric simplification with adjustable target ratio.",
  },
  {
    title: "Smoothing",
    path: "/smoothing",
    description:
      "Apply Laplacian, Taubin, HC, or Tangential Relaxation smoothing with configurable iterations and weights.",
  },
  {
    title: "Annotations",
    path: "/annotations",
    description:
      "Define patches, landmarks, and contours on a mesh surface using barycentric coordinates that survive deformations.",
  },
  {
    title: "Mesh Checks",
    path: "/mesh-checks",
    description:
      "Run diagnostic checks on STL meshes to verify geometry integrity.                                                                        ",
  },
  {
    title: "Mesh Checks (Text Test)",
    path: "/mesh-checks-text",
    description:
      "Run the attached STL fixture set in a non-3D table view for deterministic testing and automation.",
  },
  {
    title: "WASM Checks Test",
    path: "/wasm-checks",
    description:
      "Upload an STL and run all WASM diagnostics checks (holes v2, self-intersections, overlapping triangles, bad edges, noise shells, inverted normals).",
  },
  {
    title: "Noise Checks",
    path: "/noise-checks",
    description:
      "Noise shells are small, disconnected triangle clusters in an STL mesh with no valid enclosed volume.",
  },
  {
    title: "Repair Pipeline",
    path: "/repair",
    description:
      "One-click mesh repair: remove duplicate/degenerate faces, close holes, drop noise shells, and flip inverted faces outward — with a before/after validation report.",
  },
];
