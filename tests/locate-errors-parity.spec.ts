import { test, expect } from "@playwright/test";

// In-browser parity for meshlib_locate_errors_stl — calls the C ABI directly
// (no canvas), mirroring the native result on the calibration matrix.
test("browser WASM locate-errors returns outward markers", async ({ page }) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    // @ts-ignore - dev-served Emscripten glue
    const mod: any = await import("/src/wasm/meshlib_repair_pipeline.js");
    const Module: any = await mod.default();
    const res = await fetch("/stl/Michaels_Calibration_Matrix.stl");
    const buf = new Uint8Array(await res.arrayBuffer());

    const inPtr = Module._malloc(buf.length);
    Module.HEAPU8.set(buf, inPtr);
    const mpp = Module._malloc(4);
    const szp = Module._malloc(4);
    const errp = Module._malloc(4);
    Module.HEAPU32[mpp >> 2] = 0;
    Module.HEAPU32[szp >> 2] = 0;
    Module.HEAPU32[errp >> 2] = 0;

    const rc = Module._meshlib_locate_errors_stl(inPtr, buf.length, 0, mpp, szp, errp);
    const ptr = Module.HEAPU32[mpp >> 2];
    const size = Module.HEAPU32[szp >> 2];
    const floats = Array.from(
      Module.HEAPF32.subarray(ptr >> 2, (ptr >> 2) + size / 4),
    ) as number[];
    if (ptr) Module._meshlib_free(ptr);

    const markers = [];
    for (let i = 0; i + 7 <= floats.length; i += 7) {
      const dx = floats[i + 4], dy = floats[i + 5], dz = floats[i + 6];
      markers.push({ type: Math.round(floats[i]), len: Math.hypot(dx, dy, dz) });
    }
    return { rc, count: markers.length, types: [...new Set(markers.map((m) => m.type))].sort(), maxLenErr: Math.max(...markers.map((m) => Math.abs(m.len - 1))) };
  });

  expect(result.rc).toBe(0);
  expect(result.count).toBeGreaterThan(0);
  // self-intersections off → only hole(1) and noise(4) types present
  expect(result.types).toEqual([1, 4]);
  // every direction is a unit vector
  expect(result.maxLenErr).toBeLessThan(1e-3);
});
