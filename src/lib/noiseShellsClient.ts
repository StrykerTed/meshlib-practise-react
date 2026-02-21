// ---------------------------------------------------------------------------
// Client for the noise-shells WASM worker.
// Mirrors SelfIntersectionsClient but supports detect + repair for noise
// shells (small disconnected components).
// ---------------------------------------------------------------------------

type DetectRequest = { id: number; action: "detect"; input: ArrayBuffer };
type RepairRequest = {
  id: number;
  action: "repair";
  input: ArrayBuffer;
  areaRatioThreshold: number;
};

type DetectResponseOk = {
  id: number;
  action: "detect";
  ok: true;
  totalComponents: number;
  noiseCount: number;
  components: ArrayBuffer;
};
type DetectResponseErr = {
  id: number;
  action: "detect";
  ok: false;
  rc: number;
  error: string;
};
type RepairResponseOk = {
  id: number;
  action: "repair";
  ok: true;
  output: ArrayBuffer;
  removedComponents: number;
};
type RepairResponseErr = {
  id: number;
  action: "repair";
  ok: false;
  rc: number;
  error: string;
};

type WorkerStatus = { id: number; kind: "status"; stage: string };
type WorkerReady = { kind: "ready" };

type WorkerMessage =
  | DetectResponseOk
  | DetectResponseErr
  | RepairResponseOk
  | RepairResponseErr
  | WorkerStatus
  | WorkerReady;

export interface ComponentInfo {
  /** Surface area of the component. */
  area: number;
  /** Number of faces in the component. */
  faceCount: number;
  /** Number of vertices in the component. */
  vertexCount: number;
}

export interface DetectResult {
  /** Total number of connected components in the mesh. */
  totalComponents: number;
  /** Number of noise shells (all components except the largest). */
  noiseCount: number;
  /** Per-component info, sorted descending by size (index 0 = main body). */
  components: ComponentInfo[];
}

export interface RepairResult {
  /** The repaired binary STL with noise shells removed. */
  output: ArrayBuffer;
  /** Number of small components that were removed. */
  removedComponents: number;
}

export class NoiseShellsClient {
  private worker: Worker;
  private nextId = 1;
  private readyPromise: Promise<void>;

  constructor() {
    this.worker = this.createWorker();
    this.readyPromise = this.waitForReady(this.worker);
  }

  private createWorker() {
    return new Worker(
      new URL("../workers/noiseShells.worker.ts", import.meta.url),
      { type: "module" },
    );
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
        if (
          kind === "ready" ||
          kind === "status" ||
          typeof (e.data as any)?.id === "number"
        ) {
          cleanup();
          resolve();
        }
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        reject(
          new Error(
            `NoiseShells worker failed to start: ${e.message || "unknown error"}`,
          ),
        );
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
        reject(
          new Error("NoiseShells worker did not become ready (timeout)"),
        );
      }, 15_000);
    });
  }

  dispose() {
    this.worker.terminate();
  }

  // -----------------------------------------------------------------------
  // Detect
  // -----------------------------------------------------------------------

  async detect(
    input: ArrayBuffer,
    opts?: { timeoutMs?: number; onStatus?: (stage: string) => void },
  ): Promise<DetectResult> {
    opts?.onStatus?.("Waiting for worker…");
    await this.readyPromise;

    const id = this.nextId++;
    const timeoutMs = opts?.timeoutMs ?? 120_000;

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        this.worker.removeEventListener("messageerror", onMessageError);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        if ((e.data as any)?.kind === "ready") return;
        if ((e.data as any)?.id !== id) return;
        if ((e.data as any).kind === "status") {
          opts?.onStatus?.((e.data as WorkerStatus).stage);
          return;
        }

        settled = true;
        cleanup();

        const resp = e.data as DetectResponseOk | DetectResponseErr;
        if (!resp.ok) {
          this.resetWorker();
          reject(new Error(`Detect failed (rc=${resp.rc}): ${resp.error}`));
          return;
        }

        // Unpack the float32 component buffer: 3 floats per component
        // [area, faceCount, vertexCount]
        const floats = new Float32Array(resp.components);
        const components: ComponentInfo[] = [];
        for (let i = 0; i < floats.length; i += 3) {
          components.push({
            area: floats[i],
            faceCount: floats[i + 1],
            vertexCount: floats[i + 2],
          });
        }

        resolve({
          totalComponents: resp.totalComponents,
          noiseCount: resp.noiseCount,
          components,
        });
      };

      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(
          new Error(
            `NoiseShells worker error: ${e.message || "unknown error"}`,
          ),
        );
      };
      const onMessageError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(new Error("NoiseShells worker messageerror"));
      };

      const timeoutHandle = timeoutMs
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            this.resetWorker();
            reject(new Error(`Detect timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : undefined;

      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", onError);
      this.worker.addEventListener("messageerror", onMessageError);

      // Need to copy the buffer since we transfer it
      const copy = input.slice(0);
      const msg: DetectRequest = { id, action: "detect", input: copy };
      this.worker.postMessage(msg, [copy]);
    });
  }

  // -----------------------------------------------------------------------
  // Repair (remove noise shells)
  // -----------------------------------------------------------------------

  async repair(
    input: ArrayBuffer,
    opts?: {
      timeoutMs?: number;
      onStatus?: (stage: string) => void;
      /** Area ratio threshold (0–1). Components below this ratio of the
       *  largest component's area are removed. Default 1.0 = keep only
       *  the largest component. */
      areaRatioThreshold?: number;
    },
  ): Promise<RepairResult> {
    opts?.onStatus?.("Waiting for worker…");
    await this.readyPromise;

    const id = this.nextId++;
    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const areaRatioThreshold = opts?.areaRatioThreshold ?? 1.0;

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.worker.removeEventListener("message", onMessage);
        this.worker.removeEventListener("error", onError);
        this.worker.removeEventListener("messageerror", onMessageError);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        if ((e.data as any)?.kind === "ready") return;
        if ((e.data as any)?.id !== id) return;
        if ((e.data as any).kind === "status") {
          opts?.onStatus?.((e.data as WorkerStatus).stage);
          return;
        }

        settled = true;
        cleanup();

        const resp = e.data as RepairResponseOk | RepairResponseErr;
        if (!resp.ok) {
          this.resetWorker();
          reject(new Error(`Repair failed (rc=${resp.rc}): ${resp.error}`));
          return;
        }
        resolve({
          output: resp.output,
          removedComponents: resp.removedComponents,
        });
      };

      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(
          new Error(
            `NoiseShells worker error: ${e.message || "unknown error"}`,
          ),
        );
      };
      const onMessageError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(new Error("NoiseShells worker messageerror"));
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
      this.worker.addEventListener("messageerror", onMessageError);

      const msg: RepairRequest = {
        id,
        action: "repair",
        input,
        areaRatioThreshold,
      };
      this.worker.postMessage(msg, [input]);
    });
  }
}
