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
];
