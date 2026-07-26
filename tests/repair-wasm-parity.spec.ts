import { test, expect } from "@playwright/test";

// Direct in-browser WASM parity check — bypasses the Three.js canvas (which is
// pathologically slow under headless software WebGL) and calls the C ABI the
// same way the worker does, then compares to the known native result.
test("browser WASM repair matches native on the calibration matrix", async ({ page }) => {
  await page.goto("/"); // load the Vite dev origin so it can serve modules

  const result = await page.evaluate(async () => {
    // @ts-ignore - dev-served Emscripten glue
    const mod: any = await import("/src/wasm/meshlib_repair_pipeline.js");
    const Module: any = await mod.default();
    const res = await fetch("/stl/Michaels_Calibration_Matrix.stl");
    const buf = new Uint8Array(await res.arrayBuffer());

    const inPtr = Module._malloc(buf.length);
    Module.HEAPU8.set(buf, inPtr);
    const beforePtr = Module._malloc(16 * 4);
    const afterPtr = Module._malloc(16 * 4);
    const outPP = Module._malloc(4);
    const outSz = Module._malloc(4);
    const errPP = Module._malloc(4);
    Module.HEAPU32[outPP >> 2] = 0;
    Module.HEAPU32[outSz >> 2] = 0;
    Module.HEAPU32[errPP >> 2] = 0;

    const rc = Module._meshlib_repair_pipeline_stl(
      inPtr, buf.length, 1.0, beforePtr, afterPtr, 16, outPP, outSz, errPP,
    );
    const after = Array.from(Module.HEAPU32.subarray(afterPtr >> 2, (afterPtr >> 2) + 16)) as number[];
    const before = Array.from(Module.HEAPU32.subarray(beforePtr >> 2, (beforePtr >> 2) + 16)) as number[];
    const outSize = Module.HEAPU32[outSz >> 2];
    const outPtr = Module.HEAPU32[outPP >> 2];
    if (outPtr) Module._meshlib_free(outPtr);
    return { rc, before, after, outSize };
  });

  // ReportField indices: 5=holes, 8=invertedComponents, 9=indeterminate, 10=watertight
  expect(result.rc).toBe(0);
  expect(result.before[5]).toBeGreaterThan(0); // had holes
  expect(result.after[5]).toBe(0); // holes closed
  expect(result.after[8]).toBe(0); // no inverted components
  expect(result.after[9]).toBe(0); // all components decidable
  expect(result.after[10]).toBe(1); // watertight
  expect(result.outSize).toBeGreaterThan(0);
});
