/// <reference lib="webworker" />

// Web Worker that runs meshlib FillHoles WASM off the main thread.
// It expects these static assets to be served by Vite from /public:
//   /wasm/meshlib_fill_holes.js
//   /wasm/meshlib_fill_holes.wasm

type EmscriptenModule = {
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  _meshlib_fill_holes_stl: (
    inPtr: number,
    inSize: number,
    outPtrPtr: number,
    outSizePtr: number,
    errPtrPtr: number,
  ) => number;
  _meshlib_free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
};

type CreateModule = (opts?: {
  locateFile?: (path: string) => string;
  onAbort?: (reason: any) => void;
  print?: (text: string) => void;
  printErr?: (text: string) => void;
}) => Promise<EmscriptenModule>;

type PingMessage = { kind: "ping" };
type RequestMessage = { id: number; input: ArrayBuffer };

type StatusMessage = { id: number; kind: "status"; stage: string };

type ResponseMessage =
  | { id: number; ok: true; output: ArrayBuffer }
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
    createModulePromise = import("../wasm/meshlib_fill_holes.js").then(
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

async function handleJobMessage(e: MessageEvent<RequestMessage>) {
  const { id, input } = e.data;

  try {
    postStatus(id, "Worker received job");

    postStatus(id, "Loading WASM module…");
    const Module = await withTimeout(getModule(), 30_000, "WASM module load");
    postStatus(id, "WASM module loaded");
    const inputBytes = new Uint8Array(input);

    postStatus(id, `Input bytes: ${inputBytes.length}`);

    const inPtr = Module._malloc(inputBytes.length);
    Module.HEAPU8.set(inputBytes, inPtr);

    const outPtrPtr = Module._malloc(4);
    const outSizePtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outPtrPtr >> 2] = 0;
    Module.HEAPU32[outSizePtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Calling meshlib_fill_holes_stl…");
      const rc = Module._meshlib_fill_holes_stl(
        inPtr,
        inputBytes.length,
        outPtrPtr,
        outSizePtr,
        errPtrPtr,
      );

      const outPtr = Module.HEAPU32[outPtrPtr >> 2];
      const outSize = Module.HEAPU32[outSizePtr >> 2];
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
        `FillHoles complete. Output bytes: ${outBytes.byteLength}`,
      );

      const msg: ResponseMessage = { id, ok: true, output: outBytes.buffer };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, [
        outBytes.buffer,
      ]);
    } finally {
      Module._free(inPtr);
      Module._free(outPtrPtr);
      Module._free(outSizePtr);
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

// IMPORTANT: Register a message handler immediately so we never miss the initial ping.
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
