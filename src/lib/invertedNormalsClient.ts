type DetectRequest = { id: number; action: "detect"; input: ArrayBuffer };
type RepairRequest = { id: number; action: "repair"; input: ArrayBuffer };

type DetectResponseOk = {
  id: number;
  action: "detect";
  ok: true;
  isClosed: boolean;
  isInverted: boolean | null;
  signedVolume: number | null;
  localInvertedCount: number;
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
  isClosed: boolean;
  wasInverted: boolean | null;
  signedVolumeBefore: number | null;
  signedVolumeAfter: number | null;
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

export interface InvertedDetectResult {
  isClosed: boolean;
  isInverted: boolean | null;
  signedVolume: number | null;
  localInvertedCount: number;
}

export interface InvertedRepairResult {
  output: ArrayBuffer;
  isClosed: boolean;
  wasInverted: boolean | null;
  signedVolumeBefore: number | null;
  signedVolumeAfter: number | null;
}

export class InvertedNormalsClient {
  private worker: Worker;
  private nextId = 1;
  private readyPromise: Promise<void>;

  constructor() {
    this.worker = this.createWorker();
    this.readyPromise = this.waitForReady(this.worker);
  }

  private createWorker() {
    return new Worker(
      new URL("../workers/invertedNormals.worker.ts", import.meta.url),
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
            `InvertedNormals worker failed to start: ${e.message || "unknown error"}`,
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
          new Error("InvertedNormals worker did not become ready (timeout)"),
        );
      }, 15_000);
    });
  }

  dispose() {
    this.worker.terminate();
  }

  async detect(
    input: ArrayBuffer,
    opts?: { timeoutMs?: number; onStatus?: (stage: string) => void },
  ): Promise<InvertedDetectResult> {
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

        resolve({
          isClosed: resp.isClosed,
          isInverted: resp.isInverted,
          signedVolume: resp.signedVolume,
          localInvertedCount: resp.localInvertedCount,
        });
      };

      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(
          new Error(
            `InvertedNormals worker error: ${e.message || "unknown error"}`,
          ),
        );
      };
      const onMessageError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(new Error("InvertedNormals worker messageerror"));
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

      const copy = input.slice(0);
      const msg: DetectRequest = { id, action: "detect", input: copy };
      this.worker.postMessage(msg, [copy]);
    });
  }

  async repair(
    input: ArrayBuffer,
    opts?: { timeoutMs?: number; onStatus?: (stage: string) => void },
  ): Promise<InvertedRepairResult> {
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

        const resp = e.data as RepairResponseOk | RepairResponseErr;
        if (!resp.ok) {
          this.resetWorker();
          reject(new Error(`Repair failed (rc=${resp.rc}): ${resp.error}`));
          return;
        }

        resolve({
          output: resp.output,
          isClosed: resp.isClosed,
          wasInverted: resp.wasInverted,
          signedVolumeBefore: resp.signedVolumeBefore,
          signedVolumeAfter: resp.signedVolumeAfter,
        });
      };

      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(
          new Error(
            `InvertedNormals worker error: ${e.message || "unknown error"}`,
          ),
        );
      };
      const onMessageError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(new Error("InvertedNormals worker messageerror"));
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

      const msg: RepairRequest = { id, action: "repair", input };
      this.worker.postMessage(msg, [input]);
    });
  }
}
