/**
 * Promise-based client that wraps the simplification Web Worker.
 *
 * Follows the same pattern as FillHolesClient / SelfIntersectionsClient.
 */

export interface SimplifyOptions {
  /** 0.0 – 1.0 (e.g. 0.5 = keep 50% of faces). Passed as target_ratio to WASM. */
  targetRatio: number;
  /** Whether to preserve mesh border edges. Defaults to false. */
  preserveBorders?: boolean;
  /** Abort after this many ms. 0 = no timeout. */
  timeoutMs?: number;
  /** Called with human-readable status updates from the worker. */
  onStatus?: (stage: string) => void;
}

export interface SimplifyResult {
  /** Simplified STL binary */
  output: ArrayBuffer;
  /** Number of faces in the input mesh */
  inputFaces: number;
  /** Number of faces after simplification */
  outputFaces: number;
}

export class SimplificationClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (v: SimplifyResult) => void;
      reject: (e: Error) => void;
      onStatus?: (s: string) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();

  /* ---- lifecycle ---- */

  private createWorker(): Worker {
    const w = new Worker(
      new URL("../workers/simplification.worker.ts", import.meta.url),
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
      const timer = setTimeout(() => reject(new Error("Worker ping timeout")), 5_000);
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

  async simplify(
    input: ArrayBuffer,
    opts: SimplifyOptions,
  ): Promise<SimplifyResult> {
    const w = this.ensureWorker();
    const id = this.nextId++;

    return new Promise<SimplifyResult>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutMs = opts.timeoutMs ?? 0;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Simplification timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      this.pending.set(id, { resolve, reject, onStatus: opts.onStatus, timer });

      // target_faces = 0 means "use ratio" on the WASM side
      w.postMessage(
        {
          id,
          input,
          targetFaces: 0,
          targetRatio: opts.targetRatio,
          preserveBorders: opts.preserveBorders ?? false,
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
        inputFaces: d.inputFaces as number,
        outputFaces: d.outputFaces as number,
      });
    } else {
      p.reject(new Error(`Simplification failed (rc=${d.rc}): ${d.error}`));
    }
  };
}
