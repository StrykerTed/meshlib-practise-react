/**
 * Promise-based client that wraps the smoothing Web Worker.
 *
 * Follows the same pattern as FillHolesClient / SimplificationClient.
 */

export type SmoothingMethod =
  | "laplacian"
  | "taubin"
  | "laplacianHC"
  | "tangentialRelaxation";

/** Map human-readable method names to the integer expected by the WASM API */
const METHOD_INDEX: Record<SmoothingMethod, number> = {
  laplacian: 0,
  taubin: 1,
  laplacianHC: 2,
  tangentialRelaxation: 3,
};

export interface SmoothOptions {
  /** Which smoothing algorithm to use. */
  method: SmoothingMethod;
  /** Number of smoothing iterations (≥ 1). */
  iterations: number;
  /** Taubin: inward diffusion [0,1]. Default 0.5. */
  lambda?: number;
  /** Taubin: outward diffusion (must be > lambda) [0,1]. Default 0.53. */
  mu?: number;
  /** LaplacianHC: smoothing strength [0,1]. Default 0.0. */
  alpha?: number;
  /** LaplacianHC: correction strength [0,1]. Default 0.5. */
  beta?: number;
  /** Abort after this many ms. 0 = no timeout. */
  timeoutMs?: number;
  /** Called with human-readable status updates from the worker. */
  onStatus?: (stage: string) => void;
}

export interface SmoothResult {
  /** Smoothed STL binary */
  output: ArrayBuffer;
  /** Face count (unchanged by smoothing) */
  faces: number;
  /** Vertex count */
  vertices: number;
}

export class SmoothingClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: SmoothResult) => void;
      reject: (e: Error) => void;
      onStatus?: (s: string) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  /* ---- lifecycle ---- */

  private createWorker(): Worker {
    const w = new Worker(
      new URL("../workers/smoothing.worker.ts", import.meta.url),
      { type: "module" },
    );
    w.addEventListener("message", this.handleMessage);
    return w;
  }

  private ensureWorker(): Worker {
    if (!this.worker) this.worker = this.createWorker();
    return this.worker;
  }

  /** Verify the worker is alive. Rejects after 5 s. */
  async ping(): Promise<void> {
    const w = this.ensureWorker();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Worker ping timeout")),
        5_000,
      );
      const handler = (e: MessageEvent) => {
        if (e.data?.kind === "ready") {
          clearTimeout(timer);
          w.removeEventListener("message", handler);
          resolve();
        }
      };
      w.addEventListener("message", handler);
      w.postMessage({ kind: "ping" });
    });
  }

  /** Kill the worker and create a fresh one on next call. */
  resetWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error("Worker was reset"));
    }
    this.pending.clear();
  }

  dispose(): void {
    this.resetWorker();
  }

  /* ---- main entry point ---- */

  async smooth(input: ArrayBuffer, opts: SmoothOptions): Promise<SmoothResult> {
    const w = this.ensureWorker();
    const id = this.nextId++;

    return new Promise<SmoothResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutMs = opts.timeoutMs ?? 0;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Smoothing timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      this.pending.set(id, {
        resolve,
        reject,
        onStatus: opts.onStatus,
        timer,
      });

      w.postMessage(
        {
          id,
          input,
          method: METHOD_INDEX[opts.method],
          iterations: opts.iterations,
          lambda: opts.lambda ?? 0.5,
          mu: opts.mu ?? 0.53,
          alpha: opts.alpha ?? 0.0,
          beta: opts.beta ?? 0.5,
        },
        [input],
      );
    });
  }

  /* ---- internal message handler ---- */

  private handleMessage = (e: MessageEvent) => {
    const d = e.data;
    if (!d || typeof d !== "object") return;

    // status updates
    if (d.kind === "status") {
      const p = this.pending.get(d.id);
      if (p?.onStatus) p.onStatus(d.stage);
      return;
    }

    // final result
    const id: number = d.id;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (p.timer) clearTimeout(p.timer);

    if (d.ok) {
      p.resolve({
        output: d.output as ArrayBuffer,
        faces: d.faces as number,
        vertices: d.vertices as number,
      });
    } else {
      p.reject(new Error(`Smoothing failed (rc=${d.rc}): ${d.error}`));
    }
  };
}
