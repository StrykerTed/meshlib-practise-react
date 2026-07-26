/// <reference lib="webworker" />

// Web Worker that runs the meshlib repair-pipeline WASM off the main thread.
// Bundled by Vite from src/wasm/meshlib_repair_pipeline.{js,wasm}.
//
// Pipeline (C++): dedupe input faces -> RepairMesh (degenerate/short-edges/
// self-intersections/isolated/noise) -> defensive hole fill -> per-component
// outward orientation -> unified before/after validation report.

const REPORT_LEN = 16; // uint32 slots, matches ReportField enum in repair_pipeline_api.cpp

type EmscriptenModule = {
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  _meshlib_repair_pipeline_stl: (
    inPtr: number,
    inSize: number,
    componentAreaRatioThreshold: number,
    outBeforePtr: number,
    outAfterPtr: number,
    reportLen: number,
    outStlPtrPtr: number,
    outStlSizePtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_validate_mesh_stl: (
    inPtr: number,
    inSize: number,
    outReportPtr: number,
    reportLen: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_locate_errors_stl: (
    inPtr: number,
    inSize: number,
    includeSelfIntersections: number,
    outMarkersPtrPtr: number,
    outMarkersSizePtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  HEAPF32: Float32Array;
};

type CreateModule = (opts?: {
  locateFile?: (path: string) => string;
  onAbort?: (reason: any) => void;
}) => Promise<EmscriptenModule>;

type PingMessage = { kind: "ping" };

type RepairRequest = {
  id: number;
  action: "repair";
  input: ArrayBuffer;
  componentAreaRatioThreshold: number;
};

type LocateRequest = {
  id: number;
  action: "locate";
  input: ArrayBuffer;
  includeSelfIntersections: boolean;
};

type RequestMessage = RepairRequest | LocateRequest;

type LocateResponse =
  | { id: number; action: "locate"; ok: true; markers: ArrayBuffer }
  | { id: number; action: "locate"; ok: false; rc: number; error: string };

type StatusMessage = { id: number; kind: "status"; stage: string };

type RepairResponse =
  | {
      id: number;
      action: "repair";
      ok: true;
      output: ArrayBuffer;
      before: ArrayBuffer; // Uint32Array[16]
      after: ArrayBuffer; // Uint32Array[16]
    }
  | { id: number; action: "repair"; ok: false; rc: number; error: string };

export {};

let createModulePromise: Promise<CreateModule> | undefined;
let modulePromise: Promise<EmscriptenModule> | undefined;

function postStatus(id: number, stage: string) {
  const msg: StatusMessage = { id, kind: "status", stage };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!timeoutMs) return promise;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function getCreateModule(): Promise<CreateModule> {
  if (!createModulePromise) {
    // @ts-expect-error -- Emscripten glue JS has no TS declarations
    createModulePromise = import("../wasm/meshlib_repair_pipeline.js").then(
      (m: any) => m.default as CreateModule,
    );
  }
  return createModulePromise;
}

async function getModule(): Promise<EmscriptenModule> {
  if (!modulePromise) {
    const createModule = await getCreateModule();
    modulePromise = createModule({
      onAbort: (reason: any) => { throw new Error(`WASM aborted: ${String(reason)}`); },
    });
  }
  return modulePromise;
}

function readCString(Module: EmscriptenModule, ptr: number): string {
  if (!ptr) return "";
  const heap = Module.HEAPU8;
  const bytes: number[] = [];
  for (let p = ptr; heap[p] !== 0; p++) bytes.push(heap[p]);
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
}

async function handleRepair(msg: RepairRequest) {
  const { id, input, componentAreaRatioThreshold } = msg;
  try {
    postStatus(id, "Loading WASM module…");
    const Module = await withTimeout(getModule(), 30_000, "WASM module load");
    postStatus(id, "WASM module loaded");

    const inputBytes = new Uint8Array(input);
    const inPtr = Module._malloc(inputBytes.length);
    Module.HEAPU8.set(inputBytes, inPtr);

    const beforePtr = Module._malloc(REPORT_LEN * 4);
    const afterPtr = Module._malloc(REPORT_LEN * 4);
    const outStlPtrPtr = Module._malloc(4);
    const outStlSizePtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outStlPtrPtr >> 2] = 0;
    Module.HEAPU32[outStlSizePtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Running repair pipeline (WASM)…");
      const rc = Module._meshlib_repair_pipeline_stl(
        inPtr,
        inputBytes.length,
        componentAreaRatioThreshold,
        beforePtr,
        afterPtr,
        REPORT_LEN,
        outStlPtrPtr,
        outStlSizePtr,
        errPtrPtr,
      );

      if (rc !== 0) {
        const errPtr = Module.HEAPU32[errPtrPtr >> 2];
        const err = readCString(Module, errPtr);
        if (errPtr) Module._meshlib_free(errPtr);
        self.postMessage({ id, action: "repair", ok: false, rc, error: err } as RepairResponse);
        return;
      }

      const beforeArr = Module.HEAPU32.slice(beforePtr >> 2, (beforePtr >> 2) + REPORT_LEN);
      const afterArr = Module.HEAPU32.slice(afterPtr >> 2, (afterPtr >> 2) + REPORT_LEN);

      const outStlPtr = Module.HEAPU32[outStlPtrPtr >> 2];
      const outStlSize = Module.HEAPU32[outStlSizePtr >> 2];
      const outBytes = Module.HEAPU8.slice(outStlPtr, outStlPtr + outStlSize);
      if (outStlPtr) Module._meshlib_free(outStlPtr);

      postStatus(id, `Repair complete. Output bytes: ${outBytes.byteLength}`);
      const resp: RepairResponse = {
        id,
        action: "repair",
        ok: true,
        output: outBytes.buffer,
        before: beforeArr.buffer,
        after: afterArr.buffer,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [
        outBytes.buffer,
        beforeArr.buffer,
        afterArr.buffer,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(beforePtr);
      Module._free(afterPtr);
      Module._free(outStlPtrPtr);
      Module._free(outStlSizePtr);
      Module._free(errPtrPtr);
    }
  } catch (error: any) {
    self.postMessage({
      id,
      action: "repair",
      ok: false,
      rc: -1,
      error: String(error?.stack || error),
    } as RepairResponse);
  }
}

async function handleLocate(msg: LocateRequest) {
  const { id, input, includeSelfIntersections } = msg;
  try {
    postStatus(id, "Loading WASM module…");
    const Module = await withTimeout(getModule(), 30_000, "WASM module load");

    const inputBytes = new Uint8Array(input);
    const inPtr = Module._malloc(inputBytes.length);
    Module.HEAPU8.set(inputBytes, inPtr);

    const outMarkersPP = Module._malloc(4);
    const outSizePtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outMarkersPP >> 2] = 0;
    Module.HEAPU32[outSizePtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, includeSelfIntersections ? "Locating errors (incl. self-intersections, slow)…" : "Locating errors…");
      const rc = Module._meshlib_locate_errors_stl(
        inPtr,
        inputBytes.length,
        includeSelfIntersections ? 1 : 0,
        outMarkersPP,
        outSizePtr,
        errPtrPtr,
      );

      if (rc !== 0) {
        const errPtr = Module.HEAPU32[errPtrPtr >> 2];
        const err = readCString(Module, errPtr);
        if (errPtr) Module._meshlib_free(errPtr);
        self.postMessage({ id, action: "locate", ok: false, rc, error: err } as LocateResponse);
        return;
      }

      const markersPtr = Module.HEAPU32[outMarkersPP >> 2];
      const markersSize = Module.HEAPU32[outSizePtr >> 2];
      let markers: ArrayBuffer = new ArrayBuffer(0);
      if (markersPtr && markersSize > 0) {
        const floatCount = markersSize / 4;
        const data = Module.HEAPF32.slice(markersPtr >> 2, (markersPtr >> 2) + floatCount);
        markers = data.buffer;
        Module._meshlib_free(markersPtr);
      }

      postStatus(id, `Located ${markers.byteLength / 28} marker(s)`);
      const resp: LocateResponse = { id, action: "locate", ok: true, markers };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [markers]);
    } finally {
      Module._free(inPtr);
      Module._free(outMarkersPP);
      Module._free(outSizePtr);
      Module._free(errPtrPtr);
    }
  } catch (error: any) {
    self.postMessage({
      id,
      action: "locate",
      ok: false,
      rc: -1,
      error: String(error?.stack || error),
    } as LocateResponse);
  }
}

(self as unknown as DedicatedWorkerGlobalScope).addEventListener(
  "message",
  (e: MessageEvent<RequestMessage | PingMessage>) => {
    if ((e.data as any)?.kind === "ping") {
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({ kind: "ready" });
      return;
    }
    const data = e.data as RequestMessage;
    if (data.action === "repair") void handleRepair(data);
    else if (data.action === "locate") void handleLocate(data);
  },
);
