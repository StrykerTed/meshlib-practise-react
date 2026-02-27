/// <reference lib="webworker" />

// Web Worker that runs meshlib inverted-normals detect / repair WASM off the
// main thread. It expects these assets in src/wasm:
//   meshlib_inverted_normals.js
//   meshlib_inverted_normals.wasm

type EmscriptenModule = {
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  _meshlib_detect_inverted_normals_stl: (
    inPtr: number,
    inSize: number,
    outIsClosedPtr: number,
    outIsInvertedPtr: number,
    outSignedVolumePtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_detect_inverted_normals_local_stl: (
    inPtr: number,
    inSize: number,
    outLocalCountPtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_repair_inverted_normals_stl: (
    inPtr: number,
    inSize: number,
    outPtrPtr: number,
    outSizePtr: number,
    outWasInvertedPtr: number,
    outIsClosedPtr: number,
    outSignedVolumeBeforePtr: number,
    outSignedVolumeAfterPtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  HEAPF64: Float64Array;
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
      isClosed: boolean;
      isInverted: boolean | null;
      signedVolume: number | null;
      localInvertedCount: number;
    }
  | { id: number; action: "detect"; ok: false; rc: number; error: string };

type RepairResponse =
  | {
      id: number;
      action: "repair";
      ok: true;
      output: ArrayBuffer;
      isClosed: boolean;
      wasInverted: boolean | null;
      signedVolumeBefore: number | null;
      signedVolumeAfter: number | null;
    }
  | { id: number; action: "repair"; ok: false; rc: number; error: string };

export {};

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
    createModulePromise = import("../wasm/meshlib_inverted_normals.js").then(
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

    const outIsClosedPtr = Module._malloc(4);
    const outIsInvertedPtr = Module._malloc(4);
    const outSignedVolumePtr = Module._malloc(8);
    const outLocalCountPtr = Module._malloc(4);
    const localErrPtrPtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outIsClosedPtr >> 2] = 0;
    Module.HEAPU32[outIsInvertedPtr >> 2] = 0;
    Module.HEAPF64[outSignedVolumePtr >> 3] = 0;
    Module.HEAPU32[outLocalCountPtr >> 2] = 0;
    Module.HEAPU32[localErrPtrPtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Calling meshlib_detect_inverted_normals_stl…");
      const rc = Module._meshlib_detect_inverted_normals_stl(
        inPtr,
        inputBytes.length,
        outIsClosedPtr,
        outIsInvertedPtr,
        outSignedVolumePtr,
        errPtrPtr,
      );

      const isClosed = Module.HEAPU32[outIsClosedPtr >> 2] === 1;
      const isInvertedRaw = Module.HEAPU32[outIsInvertedPtr >> 2] === 1;
      const signedVolumeRaw = Module.HEAPF64[outSignedVolumePtr >> 3];
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

      const rcLocal = Module._meshlib_detect_inverted_normals_local_stl(
        inPtr,
        inputBytes.length,
        outLocalCountPtr,
        localErrPtrPtr,
      );

      const localInvertedCount = Module.HEAPU32[outLocalCountPtr >> 2];
      const localErrPtr = Module.HEAPU32[localErrPtrPtr >> 2];

      if (rcLocal !== 0) {
        const err = readCString(Module, localErrPtr);
        if (localErrPtr) Module._meshlib_free(localErrPtr);
        const resp: DetectResponse = {
          id,
          action: "detect",
          ok: false,
          rc: rcLocal,
          error: err,
        };
        self.postMessage(resp);
        return;
      }

      const resp: DetectResponse = {
        id,
        action: "detect",
        ok: true,
        isClosed,
        isInverted: isClosed ? isInvertedRaw : null,
        signedVolume: isClosed ? signedVolumeRaw : null,
        localInvertedCount,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp);
    } finally {
      Module._free(inPtr);
      Module._free(outIsClosedPtr);
      Module._free(outIsInvertedPtr);
      Module._free(outSignedVolumePtr);
      Module._free(outLocalCountPtr);
      Module._free(localErrPtrPtr);
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
    const outWasInvertedPtr = Module._malloc(4);
    const outIsClosedPtr = Module._malloc(4);
    const outSignedVolumeBeforePtr = Module._malloc(8);
    const outSignedVolumeAfterPtr = Module._malloc(8);
    const errPtrPtr = Module._malloc(4);

    Module.HEAPU32[outPtrPtr >> 2] = 0;
    Module.HEAPU32[outSizePtr >> 2] = 0;
    Module.HEAPU32[outWasInvertedPtr >> 2] = 0;
    Module.HEAPU32[outIsClosedPtr >> 2] = 0;
    Module.HEAPF64[outSignedVolumeBeforePtr >> 3] = 0;
    Module.HEAPF64[outSignedVolumeAfterPtr >> 3] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Calling meshlib_repair_inverted_normals_stl…");
      const rc = Module._meshlib_repair_inverted_normals_stl(
        inPtr,
        inputBytes.length,
        outPtrPtr,
        outSizePtr,
        outWasInvertedPtr,
        outIsClosedPtr,
        outSignedVolumeBeforePtr,
        outSignedVolumeAfterPtr,
        errPtrPtr,
      );

      const outPtr = Module.HEAPU32[outPtrPtr >> 2];
      const outSize = Module.HEAPU32[outSizePtr >> 2];
      const wasInvertedRaw = Module.HEAPU32[outWasInvertedPtr >> 2] === 1;
      const isClosed = Module.HEAPU32[outIsClosedPtr >> 2] === 1;
      const signedVolumeBeforeRaw =
        Module.HEAPF64[outSignedVolumeBeforePtr >> 3];
      const signedVolumeAfterRaw = Module.HEAPF64[outSignedVolumeAfterPtr >> 3];
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

      const resp: RepairResponse = {
        id,
        action: "repair",
        ok: true,
        output: outBytes.buffer,
        isClosed,
        wasInverted: isClosed ? wasInvertedRaw : null,
        signedVolumeBefore: isClosed ? signedVolumeBeforeRaw : null,
        signedVolumeAfter: isClosed ? signedVolumeAfterRaw : null,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(resp, [
        outBytes.buffer,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(outPtrPtr);
      Module._free(outSizePtr);
      Module._free(outWasInvertedPtr);
      Module._free(outIsClosedPtr);
      Module._free(outSignedVolumeBeforePtr);
      Module._free(outSignedVolumeAfterPtr);
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

self.addEventListener(
  "message",
  (event: MessageEvent<RequestMessage | PingMessage>) => {
    const msg = event.data as RequestMessage | PingMessage;

    if ((msg as PingMessage).kind === "ping") {
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({
        kind: "ready",
      });
      return;
    }

    if ("action" in msg && msg.action === "detect") {
      void handleDetect(msg as DetectRequest);
    } else if ("action" in msg && msg.action === "repair") {
      void handleRepair(msg as RepairRequest);
    }
  },
);
