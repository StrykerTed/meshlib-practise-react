// Emscripten JS glue – lives in src/wasm/ and is bundled by Vite.
// We need wildcard path declarations since workers resolve relative paths differently.

declare module "*.meshlib_fill_holes.js" {
  const createModule: any;
  export default createModule;
}

declare module "../wasm/meshlib_fill_holes.js" {
  const createModule: any;
  export default createModule;
}

declare module "@wasm/meshlib_fill_holes.js" {
  const createModule: any;
  export default createModule;
}

declare module "*.meshlib_self_intersections.js" {
  const createModule: any;
  export default createModule;
}

declare module "../wasm/meshlib_self_intersections.js" {
  const createModule: any;
  export default createModule;
}

declare module "@wasm/meshlib_self_intersections.js" {
  const createModule: any;
  export default createModule;
}

declare module "*.meshlib_simplification.js" {
  const createModule: any;
  export default createModule;
}

declare module "../wasm/meshlib_simplification.js" {
  const createModule: any;
  export default createModule;
}

declare module "@wasm/meshlib_simplification.js" {
  const createModule: any;
  export default createModule;
}

declare module "*.meshlib_smoothing.js" {
  const createModule: any;
  export default createModule;
}

declare module "../wasm/meshlib_smoothing.js" {
  const createModule: any;
  export default createModule;
}

declare module "@wasm/meshlib_smoothing.js" {
  const createModule: any;
  export default createModule;
}

declare module "*.meshlib_annotations.js" {
  const createModule: any;
  export default createModule;
}

declare module "../wasm/meshlib_annotations.js" {
  const createModule: any;
  export default createModule;
}

declare module "@wasm/meshlib_annotations.js" {
  const createModule: any;
  export default createModule;
}
