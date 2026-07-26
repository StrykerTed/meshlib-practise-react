/// <reference lib="webworker" />

type EmscriptenModule = {
  _malloc: (n: number) => number;
  _free: (ptr: number) => void;
  _meshlib_find_holes_stl: (
    inPtr: number,
    inSize: number,
    outCountPtr: number,
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
  | { id: number; action: "detect-holes"; ok: true; count: number }
  | { id: number; action: "detect-holes"; ok: false; rc: number; error: string };

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
    createModulePromise = import("../wasm/meshlib_findholes_v2.js").then(
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

    const outCountPtr = Module._malloc(4);
    const errPtrPtr = Module._malloc(4);
    Module.HEAPU32[outCountPtr >> 2] = 0;
    Module.HEAPU32[errPtrPtr >> 2] = 0;

    try {
      postStatus(id, "Calling meshlib_find_holes_stl…");
      const rc = Module._meshlib_find_holes_stl(
        inPtr,
        inputBytes.length,
        outCountPtr,
        errPtrPtr,
      );

      const count = Module.HEAPU32[outCountPtr >> 2];
      const errPtr = Module.HEAPU32[errPtrPtr >> 2];

      if (rc !== 0) {
        const err = readCString(Module, errPtr);
        if (errPtr) Module._meshlib_free(errPtr);
        const msg: ResponseMessage = {
          id,
          action: "detect-holes",
          ok: false,
          rc,
          error: err || "unknown error",
        };
        (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
        return;
      }

      const msg: ResponseMessage = {
        id,
        action: "detect-holes",
        ok: true,
        count,
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
    } finally {
      Module._free(inPtr);
      Module._free(outCountPtr);
      Module._free(errPtrPtr);
    }
  } catch (error: any) {
    const msg: ResponseMessage = {
      id,
      action: "detect-holes",
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
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({ kind: "ready" });
      return;
    }
    void handleJobMessage(e as MessageEvent<RequestMessage>);
  },
);
