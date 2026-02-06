/// <reference lib="webworker" />

// Web Worker that runs meshlib self-intersection detect / repair WASM off the
// main thread.  It expects these static assets to be served by Vite from /public:
//   /wasm/meshlib_self_intersections.js
//   /wasm/meshlib_self_intersections.wasm

type EmscriptenModule = {
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  _meshlib_detect_self_intersections_stl: (
    inPtr: number,
    inSize: number,
    outCountPtr: number,
    outSegmentsDataPtr: number,
    outSegmentsSizePtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_repair_self_intersections_stl: (
    inPtr: number,
    inSize: number,
    outPtrPtr: number,
    outSizePtr: number,
    outRemovedFacesPtr: number,
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
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<EmscriptenModule>;

type PingMessage = { kind: "ping" };

type DetectRequest = {
  id: number;
  action: "detect";
  input: ArrayBuffer;
};

type RepairRequest = {
  id: number;
  action: "repair";
  input: ArrayBuffer;
};

type RequestMessage = DetectRequest | RepairRequest;

type StatusMessage = { id: number; kind: "status"; stage: string };

type DetectResponse =
  | {
      id: number;
      action: "detect";
      ok: true;
      count: number;
      segments: ArrayBuffer;
    }
  | { id: number; action: "detect"; ok: false; rc: number; error: string };

type RepairResponse =
  | {
      id: number;
      action: "repair";
      ok: true;
      output: ArrayBuffer;
      removedFaces: number;
    }
  | { id: number; action: "repair"; ok: false; rc: number; error: string };

export {};

// ---------------------------------------------------------------------------
// Module bootstrap (same lazy-init pattern as fillHoles worker)
// ---------------------------------------------------------------------------

let createModulePromise: Promise<CreateModule> | undefined;
let modulePromise: Promise<EmscriptenModule> | undefined;

function postStatus(id: number, stage: string) {
  const msg: StatusMessage = { id, kind: "status", stage };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!timeoutMs) return promise;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function getCreateModule(): Promise<CreateModule> {
  if (!createModulePromise) {
    createModulePromise = import("../wasm/meshlib_self_intersections.js").then(
      (m: any) => m.default as CreateModule,
    );
  }
  return createModulePromise;
}

async function getModule(): Promise<EmscriptenModule> {
  if (!modulePromise) {
    const createModule = await getCreateModule();
    modulePromise = createModule({
      onAbort: (reason: any) => {
        throw new Error(`WASM aborted: ${String(reason)}`);
      },
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

// ---------------------------------------------------------------------------
// Detect handler
// ---------------------------------------------------------------------------

async function handleDetect(msg: DetectRequest) {
  const { id, input } = msg;

  try {
    postStatus(id, "Worker received detect job");
    postStatus(id, "Loading WASM module…");
    const Module = await withTimeout(getModule(), 30_000, "WASM module load");
    postStatus(id, "WASM module loaded");

    const inputBytes = new Uint8Array(input);
    postStatus(id, `Input bytes: ${inputBytes.length}`);

    const inPtr = Module._malloc(inputBytes.length);
    Module.HEAPU8.set(inputBytes, inPtr);

    const outCountPtr = Module._malloc(4);
    const outSegmentsDataPtr = Module._malloc(4);
    const outSegmentsSizePtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outCountPtr >> 2] = 0;
    Module.HEAPU32[outSegmentsDataPtr >> 2] = 0;
    Module.HEAPU32[outSegmentsSizePtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Calling meshlib_detect_self_intersections_stl…");
      const rc = Module._meshlib_detect_self_intersections_stl(
        inPtr,
        inputBytes.length,
        outCountPtr,
        outSegmentsDataPtr,
        outSegmentsSizePtr,
        errPtrPtr,
      );

      const count = Module.HEAPU32[outCountPtr >> 2];
      const segPtr = Module.HEAPU32[outSegmentsDataPtr >> 2];
      const segBytes = Module.HEAPU32[outSegmentsSizePtr >> 2];
      const errPtr = Module.HEAPU32[errPtrPtr >> 2];

      if (rc !== 0) {
        const err = readCString(Module, errPtr);
        if (errPtr) Module._meshlib_free(errPtr);
        const resp: DetectResponse = {
          id,
          action: "detect",
          ok: false,
          rc,
          error: err,
        };
        self.postMessage(resp);
        return;
      }

      // Copy segment float32 data out of WASM heap before freeing.
      let segmentsBuf: ArrayBuffer = new ArrayBuffer(0);
      if (segPtr && segBytes > 0) {
        const floatCount = segBytes / 4;
        const segData = Module.HEAPF32.slice(
          segPtr >> 2,
          (segPtr >> 2) + floatCount,
        );
        segmentsBuf = segData.buffer;
        Module._meshlib_free(segPtr);
      }

      postStatus(id, `Detection complete. Intersections found: ${count}`);
      const resp: DetectResponse = {
        id,
        action: "detect",
        ok: true,
        count,
        segments: segmentsBuf,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [
        segmentsBuf,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(outCountPtr);
      Module._free(outSegmentsDataPtr);
      Module._free(outSegmentsSizePtr);
      Module._free(errPtrPtr);
    }
  } catch (error: any) {
    const resp: DetectResponse = {
      id,
      action: "detect",
      ok: false,
      rc: -1,
      error: String(error?.stack || error),
    };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp);
  }
}

// ---------------------------------------------------------------------------
// Repair handler
// ---------------------------------------------------------------------------

async function handleRepair(msg: RepairRequest) {
  const { id, input } = msg;

  try {
    postStatus(id, "Worker received repair job");
    postStatus(id, "Loading WASM module…");
    const Module = await withTimeout(getModule(), 30_000, "WASM module load");
    postStatus(id, "WASM module loaded");

    const inputBytes = new Uint8Array(input);
    postStatus(id, `Input bytes: ${inputBytes.length}`);

    const inPtr = Module._malloc(inputBytes.length);
    Module.HEAPU8.set(inputBytes, inPtr);

    const outPtrPtr = Module._malloc(4);
    const outSizePtr = Module._malloc(4);
    const outRemovedFacesPtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outPtrPtr >> 2] = 0;
    Module.HEAPU32[outSizePtr >> 2] = 0;
    Module.HEAPU32[outRemovedFacesPtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Calling meshlib_repair_self_intersections_stl…");
      const rc = Module._meshlib_repair_self_intersections_stl(
        inPtr,
        inputBytes.length,
        outPtrPtr,
        outSizePtr,
        outRemovedFacesPtr,
        errPtrPtr,
      );

      const outPtr = Module.HEAPU32[outPtrPtr >> 2];
      const outSize = Module.HEAPU32[outSizePtr >> 2];
      const removedFaces = Module.HEAPU32[outRemovedFacesPtr >> 2];
      const errPtr = Module.HEAPU32[errPtrPtr >> 2];

      if (rc !== 0) {
        const err = readCString(Module, errPtr);
        if (errPtr) Module._meshlib_free(errPtr);
        const resp: RepairResponse = {
          id,
          action: "repair",
          ok: false,
          rc,
          error: err,
        };
        self.postMessage(resp);
        return;
      }

      const outBytes = Module.HEAPU8.slice(outPtr, outPtr + outSize);
      Module._meshlib_free(outPtr);

      postStatus(
        id,
        `Repair complete. Removed ${removedFaces} faces. Output bytes: ${outBytes.byteLength}`,
      );

      const resp: RepairResponse = {
        id,
        action: "repair",
        ok: true,
        output: outBytes.buffer,
        removedFaces,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [
        outBytes.buffer,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(outPtrPtr);
      Module._free(outSizePtr);
      Module._free(outRemovedFacesPtr);
      Module._free(errPtrPtr);
    }
  } catch (error: any) {
    const resp: RepairResponse = {
      id,
      action: "repair",
      ok: false,
      rc: -1,
      error: String(error?.stack || error),
    };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp);
  }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

(self as unknown as DedicatedWorkerGlobalScope).addEventListener(
  "message",
  (e: MessageEvent<RequestMessage | PingMessage>) => {
    if ((e.data as any)?.kind === "ping") {
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({
        kind: "ready",
      });
      return;
    }

    const data = e.data as RequestMessage;
    if (data.action === "detect") {
      void handleDetect(data);
    } else if (data.action === "repair") {
      void handleRepair(data);
    }
  },
);
