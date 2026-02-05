type WorkerRequest = { id: number; input: ArrayBuffer }

type WorkerResponse =
    | { id: number; ok: true; output: ArrayBuffer }
    | { id: number; ok: false; rc: number; error: string }

type WorkerStatus = { id: number; kind: 'status'; stage: string }

type WorkerReady = { kind: 'ready' }

type WorkerMessage = WorkerResponse | WorkerStatus | WorkerReady

export class FillHolesClient {
    private worker: Worker
    private nextId = 1
    private readyPromise: Promise<void>

    constructor() {
        this.worker = this.createWorker()
        this.readyPromise = this.waitForReady(this.worker)
    }

    private createWorker() {
        return new Worker(new URL('../workers/fillHoles.worker.ts', import.meta.url), {
            type: 'module',
        })
    }

    private resetWorker() {
        try {
            this.worker.terminate()
        } finally {
            this.worker = this.createWorker()
            this.readyPromise = this.waitForReady(this.worker)
        }
    }

    private waitForReady(worker: Worker) {
        return new Promise<void>((resolve, reject) => {
            const onMessage = (e: MessageEvent<WorkerMessage>) => {
                const kind = (e.data as any)?.kind

                if (kind === 'ready') {
                    cleanup()
                    resolve()
                }

                // If we got any other message from the worker, it's alive.
                if (kind === 'status' || typeof (e.data as any)?.id === 'number') {
                    cleanup()
                    resolve()
                }
            }
            const onError = (e: ErrorEvent) => {
                cleanup()
                reject(new Error(`FillHoles worker failed to start: ${e.message || 'unknown error'}`))
            }
            const cleanup = () => {
                worker.removeEventListener('message', onMessage)
                worker.removeEventListener('error', onError)
                if (t) clearTimeout(t)
            }

            worker.addEventListener('message', onMessage)
            worker.addEventListener('error', onError)

            // Ask the worker to confirm readiness after listeners are attached.
            worker.postMessage({ kind: 'ping' })

            const t = setTimeout(() => {
                cleanup()
                reject(new Error('FillHoles worker did not become ready (timeout)'))
            }, 15_000)
        })
    }

    dispose() {
        this.worker.terminate()
    }

    async fillHoles(
        input: ArrayBuffer,
        opts?: { timeoutMs?: number; onStatus?: (stage: string) => void },
    ): Promise<ArrayBuffer> {
        opts?.onStatus?.('Waiting for worker…')
        await this.readyPromise

        const id = this.nextId++
        const timeoutMs = opts?.timeoutMs ?? 120_000

        return await new Promise((resolve, reject) => {
            let settled = false
            const cleanup = () => {
                this.worker.removeEventListener('message', onMessage)
                this.worker.removeEventListener('error', onError)
                this.worker.removeEventListener('messageerror', onMessageError)
                if (timeoutHandle) clearTimeout(timeoutHandle)
            }

            const onMessage = (e: MessageEvent<WorkerMessage>) => {
                if ((e.data as any)?.kind === 'ready') return
                if ((e.data as any)?.id !== id) return

                if ((e.data as any).kind === 'status') {
                    opts?.onStatus?.((e.data as WorkerStatus).stage)
                    return
                }

                settled = true
                cleanup()

                const resp = e.data as WorkerResponse

                if (!resp.ok) {
                    // If the worker got into a bad state, reset for next run.
                    this.resetWorker()
                    reject(new Error(`FillHoles failed (rc=${resp.rc}): ${resp.error}`))
                    return
                }

                resolve(resp.output)
            }

            const onError = (e: ErrorEvent) => {
                if (settled) return
                settled = true
                cleanup()
                this.resetWorker()
                reject(new Error(`FillHoles worker error: ${e.message || 'unknown error'}`))
            }

            const onMessageError = () => {
                if (settled) return
                settled = true
                cleanup()
                this.resetWorker()
                reject(new Error('FillHoles worker messageerror (could not deserialize message)'))
            }

            const timeoutHandle = timeoutMs
                ? setTimeout(() => {
                      if (settled) return
                      settled = true
                      cleanup()
                      this.resetWorker()
                      reject(new Error(`FillHoles timed out after ${timeoutMs}ms`))
                  }, timeoutMs)
                : undefined

            this.worker.addEventListener('message', onMessage)
            this.worker.addEventListener('error', onError)
            this.worker.addEventListener('messageerror', onMessageError)
            const msg: WorkerRequest = { id, input }
            this.worker.postMessage(msg, [input])
        })
    }
}
