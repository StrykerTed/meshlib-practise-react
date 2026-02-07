/// <reference lib="webworker" />

// Web Worker that runs meshlib Smoothing WASM off the main thread.

type EmscriptenModule = {
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  _meshlib_smooth_stl: (
    inPtr: number,
    inSize: number,
    method: number,
    iterations: number,
    lambda: number,
    mu: number,
    alpha: number,
    beta: number,
    outPtrPtr: number,
    outSizePtr: number,
    outFacesPtr: number,
    outVerticesPtr: number,
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
type RequestMessage = {
  id: number;
  input: ArrayBuffer;
  method: number;
  iterations: number;
  lambda: number;
  mu: number;
  alpha: number;
  beta: number;
};

type StatusMessage = { id: number; kind: "status"; stage: string };

type ResponseMessage =
  | {
      id: number;
      ok: true;
      output: ArrayBuffer;
      faces: number;
      vertices: number;
    }
  | { id: number; ok: false; rc: number; error: string };

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
    createModulePromise = import("../wasm/meshlib_smoothing.js").then(
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

const METHOD_NAMES = [
  "Laplacian",
  "Taubin",
  "LaplacianHC",
  "TangentialRelaxation",
];

async function handleJobMessage(e: MessageEvent<RequestMessage>) {
  const { id, input, method, iterations, lambda, mu, alpha, beta } = e.data;

  try {
    postStatus(id, "Worker received job");

    postStatus(id, "Loading WASM module…");
    const Module = await withTimeout(getModule(), 30_000, "WASM module load");
    postStatus(id, "WASM module loaded");

    const inputBytes = new Uint8Array(input);
    postStatus(id, `Input bytes: ${inputBytes.length}`);

    const inPtr = Module._malloc(inputBytes.length);
    Module.HEAPU8.set(inputBytes, inPtr);

    // Allocate output pointers (4 bytes each)
    const outPtrPtr = Module._malloc(4);
    const outSizePtr = Module._malloc(4);
    const outFacesPtr = Module._malloc(4);
    const outVerticesPtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);

    Module.HEAPU32[outPtrPtr >> 2] = 0;
    Module.HEAPU32[outSizePtr >> 2] = 0;
    Module.HEAPU32[outFacesPtr >> 2] = 0;
    Module.HEAPU32[outVerticesPtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      const name = METHOD_NAMES[method] ?? `method=${method}`;
      postStatus(
        id,
        `Calling meshlib_smooth_stl (${name}, ${iterations} iters)…`,
      );
      const rc = Module._meshlib_smooth_stl(
        inPtr,
        inputBytes.length,
        method,
        iterations,
        lambda,
        mu,
        alpha,
        beta,
        outPtrPtr,
        outSizePtr,
        outFacesPtr,
        outVerticesPtr,
        errPtrPtr,
      );

      const outPtr = Module.HEAPU32[outPtrPtr >> 2];
      const outSize = Module.HEAPU32[outSizePtr >> 2];
      const faces = Module.HEAPU32[outFacesPtr >> 2];
      const vertices = Module.HEAPU32[outVerticesPtr >> 2];
      const errPtr = Module.HEAPU32[errPtrPtr >> 2];

      if (rc !== 0) {
        const err = readCString(Module, errPtr);
        if (errPtr) Module._meshlib_free(errPtr);
        const msg: ResponseMessage = { id, ok: false, rc, error: err };
        self.postMessage(msg);
        return;
      }

      const outBytes = Module.HEAPU8.slice(outPtr, outPtr + outSize);
      Module._meshlib_free(outPtr);

      postStatus(
        id,
        `Smoothing complete (${name}). ${faces} faces, ${vertices} vertices. Output: ${outBytes.byteLength} bytes`,
      );

      const msg: ResponseMessage = {
        id,
        ok: true,
        output: outBytes.buffer,
        faces,
        vertices,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, [
        outBytes.buffer,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(outPtrPtr);
      Module._free(outSizePtr);
      Module._free(outFacesPtr);
      Module._free(outVerticesPtr);
      Module._free(errPtrPtr);
    }
  } catch (error: any) {
    const msg: ResponseMessage = {
      id,
      ok: false,
      rc: -1,
      error: String(error?.stack || error),
    };
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
  }
}

(self as unknown as DedicatedWorkerGlobalScope).addEventListener(
  "message",
  (e: MessageEvent<RequestMessage | PingMessage>) => {
    if ((e.data as any)?.kind === "ping") {
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({
        kind: "ready",
      });
      return;
    }
    void handleJobMessage(e as MessageEvent<RequestMessage>);
  },
);
