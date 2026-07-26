type DetectRequest = { id: number; input: ArrayBuffer };

type DetectResponseOk = {
  id: number;
  ok: true;
  count: number;
};

type DetectResponseErr = {
  id: number;
  ok: false;
  rc: number;
  error: string;
};

type WorkerStatus = { id: number; kind: 'status'; stage: string };
type WorkerReady = { kind: 'ready' };

type WorkerMessage =
  | DetectResponseOk
  | DetectResponseErr
  | WorkerStatus
  | WorkerReady;

export interface OverlappingTrianglesDetectResult {
  count: number;
}

export class OverlappingTrianglesClient {
  private worker: Worker;
  private nextId = 1;
  private readyPromise: Promise<void>;

  constructor() {
    this.worker = this.createWorker();
    this.readyPromise = this.waitForReady(this.worker);
  }

  private createWorker() {
    return new Worker(
      new URL('../workers/overlappingTriangles.worker.ts', import.meta.url),
      { type: 'module' },
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
          kind === 'ready' ||
          kind === 'status' ||
          typeof (e.data as any)?.id === 'number'
        ) {
          cleanup();
          resolve();
        }
      };
      const onError = (e: ErrorEvent) => {
        cleanup();
        reject(
          new Error(
            `OverlappingTriangles worker failed to start: ${e.message || 'unknown error'}`,
          ),
        );
      };
      const cleanup = () => {
        worker.removeEventListener('message', onMessage);
        worker.removeEventListener('error', onError);
        if (t) clearTimeout(t);
      };

      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
      worker.postMessage({ kind: 'ping' });

      const t = setTimeout(() => {
        cleanup();
        reject(new Error('OverlappingTriangles worker did not become ready (timeout)'));
      }, 15_000);
    });
  }

  dispose() {
    this.worker.terminate();
  }

  async detect(
    input: ArrayBuffer,
    opts?: { timeoutMs?: number; onStatus?: (stage: string) => void },
  ): Promise<OverlappingTrianglesDetectResult> {
    opts?.onStatus?.('Waiting for worker…');
    await this.readyPromise;

    const id = this.nextId++;
    const timeoutMs = opts?.timeoutMs ?? 120_000;

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        this.worker.removeEventListener('message', onMessage);
        this.worker.removeEventListener('error', onError);
        this.worker.removeEventListener('messageerror', onMessageError);
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };

      const onMessage = (e: MessageEvent<WorkerMessage>) => {
        if ((e.data as any)?.kind === 'ready') return;
        if ((e.data as any)?.id !== id) return;
        if ((e.data as any).kind === 'status') {
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

        resolve({ count: resp.count });
      };

      const onError = (e: ErrorEvent) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(
          new Error(
            `OverlappingTriangles worker error: ${e.message || 'unknown error'}`,
          ),
        );
      };
      const onMessageError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        this.resetWorker();
        reject(new Error('OverlappingTriangles worker messageerror'));
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

      this.worker.addEventListener('message', onMessage);
      this.worker.addEventListener('error', onError);
      this.worker.addEventListener('messageerror', onMessageError);

      const copy = input.slice(0);
      const msg: DetectRequest = { id, input: copy };
      this.worker.postMessage(msg, [copy]);
    });
  }
}
