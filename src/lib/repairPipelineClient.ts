// Main-thread client for the meshlib repair-pipeline worker. Mirrors the
// ready-ping + timeout + reset-on-error pattern used by the other WASM clients.

// Field order MUST match the ReportField enum in repair_pipeline_api.cpp.
export interface MeshReport {
  vertexCount: number;
  faceCount: number;
  componentCount: number;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  holeCount: number;
  degenerateFaceCount: number;
  duplicateFaceCount: number;
  invertedComponentCount: number;
  indeterminateComponentCount: number;
  isWatertight: boolean;
  isManifold: boolean;
}

export function decodeReport(buf: ArrayBuffer): MeshReport {
  const r = new Uint32Array(buf);
  return {
    vertexCount: r[0],
    faceCount: r[1],
    componentCount: r[2],
    boundaryEdgeCount: r[3],
    nonManifoldEdgeCount: r[4],
    holeCount: r[5],
    degenerateFaceCount: r[6],
    duplicateFaceCount: r[7],
    invertedComponentCount: r[8],
    indeterminateComponentCount: r[9],
    isWatertight: r[10] === 1,
    isManifold: r[11] === 1,
  };
}

type WorkerResponse =
  | { id: number; action?: "repair"; ok: true; output: ArrayBuffer; before: ArrayBuffer; after: ArrayBuffer }
  | { id: number; action: "locate"; ok: true; markers: ArrayBuffer }
  | { id: number; ok: false; rc: number; error: string };

// One located problem: a point on the mesh and a unit outward direction.
export interface ErrorMarker {
  type: 1 | 2 | 3 | 4;
  x: number; y: number; z: number;
  dx: number; dy: number; dz: number;
}

export function decodeMarkers(buf: ArrayBuffer): ErrorMarker[] {
  const f = new Float32Array(buf);
  const out: ErrorMarker[] = [];
  for (let i = 0; i + 7 <= f.length; i += 7) {
    out.push({
      type: Math.round(f[i]) as 1 | 2 | 3 | 4,
      x: f[i + 1], y: f[i + 2], z: f[i + 3],
      dx: f[i + 4], dy: f[i + 5], dz: f[i + 6],
    });
  }
  return out;
}

type WorkerMessage = WorkerResponse | { id: number; kind: "status"; stage: string } | { kind: "ready" };

export interface RepairResult {
  output: ArrayBuffer;
  before: MeshReport;
  after: MeshReport;
}

export class RepairPipelineClient {
  private worker: Worker;
  private nextId = 1;
  private readyPromise: Promise<void>;

  constructor() {
    this.worker = this.createWorker();
    this.readyPromise = this.waitForReady(this.worker);
  }

  private createWorker() {
    return new Worker(new URL("../workers/repairPipeline.worker.ts", import.meta.url), {
      type: "module",
    });
  }

  private resetWorker() {
    try {
      this.worker.terminate();
    } finally {
      this.worker = this.createWorker();
      this.readyPromise = this.waitForReady(this.worker);
    }
  }

  private waitForReady(worker: Worker) {
    return new Promise<void>((resolve, reject) => {
      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        const kind = (e.data as any)?.kind;
        if (kind === "ready" || kind === "status" || typeof (e.data as any)?.id === "number") {
          cleanup();
          resolve();
        }
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        reject(new Error(`Repair worker failed to start: ${e.message || "unknown error"}`));
      };
      const cleanup = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        if (t) clearTimeout(t);
      };
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.postMessage({ kind: "ping" });
      const t = setTimeout(() => {
        cleanup();
        reject(new Error("Repair worker did not become ready (timeout)"));
      }, 60_000);
    });
  }

  dispose() {
    this.worker.terminate();
  }

  async repair(
    input: ArrayBuffer,
    opts?: {
      componentAreaRatioThreshold?: number;
      timeoutMs?: number;
      onStatus?: (stage: string) => void;
    },
  ): Promise<RepairResult> {
    opts?.onStatus?.("Waiting for worker…");
    await this.readyPromise;

    const id = this.nextId++;
    const timeoutMs = opts?.timeoutMs ?? 180_000;
    const componentAreaRatioThreshold = opts?.componentAreaRatioThreshold ?? 1.0;

    return await new Promise<RepairResult>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        if ((e.data as any)?.kind === "ready") return;
        if ((e.data as any)?.id !== id) return;
        if ((e.data as any).kind === "status") {
          opts?.onStatus?.((e.data as any).stage);
          return;
        }
        settled = true;
        cleanup();
        const resp = e.data as WorkerResponse;
        if (!resp.ok) {
          this.resetWorker();
          reject(new Error(`Repair failed (rc=${resp.rc}): ${resp.error}`));
          return;
        }
        const rr = resp as { output: ArrayBuffer; before: ArrayBuffer; after: ArrayBuffer };
        resolve({
          output: rr.output,
          before: decodeReport(rr.before),
          after: decodeReport(rr.after),
        });
      };

      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(new Error(`Repair worker error: ${e.message || "unknown error"}`));
      };

      const timeoutHandle = timeoutMs
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            this.resetWorker();
            reject(new Error(`Repair timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;

      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      this.worker.postMessage({ id, action: "repair", input, componentAreaRatioThreshold }, [input]);
    });
  }

  async locateErrors(
    input: ArrayBuffer,
    opts?: {
      includeSelfIntersections?: boolean;
      timeoutMs?: number;
      onStatus?: (stage: string) => void;
    },
  ): Promise<ErrorMarker[]> {
    opts?.onStatus?.("Waiting for worker…");
    await this.readyPromise;

    const id = this.nextId++;
    const includeSelfIntersections = opts?.includeSelfIntersections ?? false;
    const timeoutMs = opts?.timeoutMs ?? (includeSelfIntersections ? 180_000 : 60_000);

    return await new Promise<ErrorMarker[]>((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        if ((e.data as any)?.kind === "ready") return;
        if ((e.data as any)?.id !== id) return;
        if ((e.data as any).kind === "status") {
          opts?.onStatus?.((e.data as any).stage);
          return;
        }
        settled = true;
        cleanup();
        const resp = e.data as WorkerResponse;
        if (!resp.ok) {
          this.resetWorker();
          reject(new Error(`Locate errors failed (rc=${(resp as any).rc}): ${(resp as any).error}`));
          return;
        }
        resolve(decodeMarkers((resp as any).markers));
      };

      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(new Error(`Locate worker error: ${e.message || "unknown error"}`));
      };

      const timeoutHandle = timeoutMs
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            this.resetWorker();
            reject(new Error(`Locate errors timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;

      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      this.worker.postMessage({ id, action: "locate", input, includeSelfIntersections }, [input]);
    });
  }
}
