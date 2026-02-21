/// <reference lib="webworker" />

// Web Worker that runs meshlib noise-shells detect / repair WASM off the main
// thread.  It expects these static assets to be served by Vite from /public:
//   /wasm/meshlib_noise_shells.js
//   /wasm/meshlib_noise_shells.wasm

type EmscriptenModule = {
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  _meshlib_detect_noise_shells_stl: (
    inPtr: number,
    inSize: number,
    outTotalPtr: number,
    outNoisePtr: number,
    outCompDataPtr: number,
    outCompSizePtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_remove_noise_shells_stl: (
    inPtr: number,
    inSize: number,
    areaRatioThreshold: number,
    outPtrPtr: number,
    outSizePtr: number,
    outRemovedPtr: number,
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
  areaRatioThreshold: number;
};

type RequestMessage = DetectRequest | RepairRequest;

type StatusMessage = { id: number; kind: "status"; stage: string };

type DetectResponse =
  | {
      id: number;
      action: "detect";
      ok: true;
      totalComponents: number;
      noiseCount: number;
      components: ArrayBuffer;
    }
  | { id: number; action: "detect"; ok: false; rc: number; error: string };

type RepairResponse =
  | {
      id: number;
      action: "repair";
      ok: true;
      output: ArrayBuffer;
      removedComponents: number;
    }
  | { id: number; action: "repair"; ok: false; rc: number; error: string };

export {};

// ---------------------------------------------------------------------------
// Module bootstrap (same lazy-init pattern as other workers)
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
    // @ts-expect-error -- Emscripten glue JS has no TS declarations
    createModulePromise = import("../wasm/meshlib_noise_shells.js").then(
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

    const outTotalPtr = Module._malloc(4);
    const outNoisePtr = Module._malloc(4);
    const outCompDataPtr = Module._malloc(4);
    const outCompSizePtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outTotalPtr >> 2] = 0;
    Module.HEAPU32[outNoisePtr >> 2] = 0;
    Module.HEAPU32[outCompDataPtr >> 2] = 0;
    Module.HEAPU32[outCompSizePtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Calling meshlib_detect_noise_shells_stl…");
      const rc = Module._meshlib_detect_noise_shells_stl(
        inPtr,
        inputBytes.length,
        outTotalPtr,
        outNoisePtr,
        outCompDataPtr,
        outCompSizePtr,
        errPtrPtr,
      );

      const totalComponents = Module.HEAPU32[outTotalPtr >> 2];
      const noiseCount = Module.HEAPU32[outNoisePtr >> 2];
      const compPtr = Module.HEAPU32[outCompDataPtr >> 2];
      const compBytes = Module.HEAPU32[outCompSizePtr >> 2];
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

      // Copy component float32 data out of WASM heap before freeing.
      let componentsBuf: ArrayBuffer = new ArrayBuffer(0);
      if (compPtr && compBytes > 0) {
        const floatCount = compBytes / 4;
        const compData = Module.HEAPF32.slice(
          compPtr >> 2,
          (compPtr >> 2) + floatCount,
        );
        componentsBuf = compData.buffer;
        Module._meshlib_free(compPtr);
      }

      postStatus(
        id,
        `Detection complete. Total components: ${totalComponents}, noise shells: ${noiseCount}`,
      );
      const resp: DetectResponse = {
        id,
        action: "detect",
        ok: true,
        totalComponents,
        noiseCount,
        components: componentsBuf,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [
        componentsBuf,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(outTotalPtr);
      Module._free(outNoisePtr);
      Module._free(outCompDataPtr);
      Module._free(outCompSizePtr);
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
  const { id, input, areaRatioThreshold } = msg;

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
    const outRemovedPtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outPtrPtr >> 2] = 0;
    Module.HEAPU32[outSizePtr >> 2] = 0;
    Module.HEAPU32[outRemovedPtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(
        id,
        `Calling meshlib_remove_noise_shells_stl (threshold=${areaRatioThreshold})…`,
      );
      const rc = Module._meshlib_remove_noise_shells_stl(
        inPtr,
        inputBytes.length,
        areaRatioThreshold,
        outPtrPtr,
        outSizePtr,
        outRemovedPtr,
        errPtrPtr,
      );

      const outPtr = Module.HEAPU32[outPtrPtr >> 2];
      const outSize = Module.HEAPU32[outSizePtr >> 2];
      const removedComponents = Module.HEAPU32[outRemovedPtr >> 2];
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
        `Repair complete. Removed ${removedComponents} component(s). Output bytes: ${outBytes.byteLength}`,
      );

      const resp: RepairResponse = {
        id,
        action: "repair",
        ok: true,
        output: outBytes.buffer,
        removedComponents,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [
        outBytes.buffer,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(outPtrPtr);
      Module._free(outSizePtr);
      Module._free(outRemovedPtr);
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
