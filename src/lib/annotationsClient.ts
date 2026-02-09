/**
 * AnnotationsClient – promise-based wrapper around the annotations Web Worker.
 *
 * Usage:
 *   const client = new AnnotationsClient()
 *   const patch = await client.selectPatch(stlBuf, { seedFaceIndex: 42, ... })
 *   const lm    = await client.createLandmark(stlBuf, { faceIndex: 42, ... })
 *   client.dispose()
 */

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onStatus?: (status: string) => void;
}

// ---------------------------------------------------------------------------
// selectPatch options & result
// ---------------------------------------------------------------------------
export interface SelectPatchOpts {
  seedFaceIndex: number;
  centerX: number;
  centerY: number;
  centerZ: number;
  radius: number;
  /** Maximum normal angle in degrees. Pass -1 to disable. */
  maxNormalAngleDeg: number;
  onStatus?: (status: string) => void;
}

export interface SelectPatchResult {
  /** Uint32Array of face indices belonging to the patch */
  faceIndices: Uint32Array;
  /** Float32Array of contour points [x,y,z, …] (all contours concatenated) */
  contourPoints: Float32Array;
  /** Uint32Array – number of points in each contour */
  contourSizes: Uint32Array;
  numFaces: number;
  numContourPts: number;
  numContours: number;
}

// ---------------------------------------------------------------------------
// createLandmark options & result
// ---------------------------------------------------------------------------
export interface CreateLandmarkOpts {
  faceIndex: number;
  posX: number;
  posY: number;
  posZ: number;
  onStatus?: (status: string) => void;
}

export interface CreateLandmarkResult {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// patchFromLandmarks options & result
// ---------------------------------------------------------------------------
export interface PatchFromLandmarksOpts {
  /** Face index for each landmark (in order) */
  faceIndices: number[];
  /** Flat array of landmark positions in STL coords [x0,y0,z0, x1,y1,z1, …] */
  positions: number[];
  onStatus?: (status: string) => void;
}

export interface PatchFromLandmarksResult {
  faceIndices: Uint32Array;
  contourPoints: Float32Array;
  contourSizes: Uint32Array;
  numFaces: number;
  numContourPts: number;
  numContours: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------
export class AnnotationsClient {
  private worker: Worker;
  private pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private readyPromise: Promise<void>;

  constructor() {
    this.worker = new Worker(
      new URL("../workers/annotations.worker.ts", import.meta.url),
      { type: "module" },
    );

    this.worker.addEventListener("message", this.onMessage);

    // Ping/pong handshake
    this.readyPromise = new Promise<void>((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, {
        resolve: () => {
          resolve();
        },
        reject: () => resolve(), // still resolve on error
      });
      this.worker.postMessage({ id, type: "ping" });
    });
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }

  // ---- public API -------------------------------------------------------

  async selectPatch(
    stlBuffer: ArrayBuffer,
    opts: SelectPatchOpts,
  ): Promise<SelectPatchResult> {
    await this.readyPromise;

    const raw = await this.send(
      "select_patch",
      {
        stlBuffer,
        seedFaceIndex: opts.seedFaceIndex,
        centerX: opts.centerX,
        centerY: opts.centerY,
        centerZ: opts.centerZ,
        radius: opts.radius,
        maxNormalAngleDeg: opts.maxNormalAngleDeg,
      },
      opts.onStatus,
    );

    return {
      faceIndices: new Uint32Array(raw.faceIndices),
      contourPoints: new Float32Array(raw.contourPoints),
      contourSizes: new Uint32Array(raw.contourSizes),
      numFaces: raw.numFaces,
      numContourPts: raw.numContourPts,
      numContours: raw.numContours,
    };
  }

  async createLandmark(
    stlBuffer: ArrayBuffer,
    opts: CreateLandmarkOpts,
  ): Promise<CreateLandmarkResult> {
    await this.readyPromise;

    return this.send(
      "create_landmark",
      {
        stlBuffer,
        faceIndex: opts.faceIndex,
        posX: opts.posX,
        posY: opts.posY,
        posZ: opts.posZ,
      },
      opts.onStatus,
    );
  }

  async patchFromLandmarks(
    stlBuffer: ArrayBuffer,
    opts: PatchFromLandmarksOpts,
  ): Promise<PatchFromLandmarksResult> {
    await this.readyPromise;

    const raw = await this.send(
      "patch_from_landmarks",
      {
        stlBuffer,
        faceIndices: opts.faceIndices,
        positions: opts.positions,
        numLandmarks: opts.faceIndices.length,
      },
      opts.onStatus,
    );

    return {
      faceIndices: new Uint32Array(raw.faceIndices),
      contourPoints: new Float32Array(raw.contourPoints),
      contourSizes: new Uint32Array(raw.contourSizes),
      numFaces: raw.numFaces,
      numContourPts: raw.numContourPts,
      numContours: raw.numContours,
    };
  }

  // ---- internals --------------------------------------------------------

  private send(
    type: string,
    payload: any,
    onStatus?: (s: string) => void,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, onStatus });
      this.worker.postMessage({ id, type, payload });
    });
  }

  private onMessage = (e: MessageEvent) => {
    const { id, type, result, error, status } = e.data;
    const req = this.pending.get(id);
    if (!req) return;

    if (type === "status") {
      req.onStatus?.(status);
      return; // don't delete – still waiting for result
    }

    this.pending.delete(id);

    if (type === "pong" || type === "result") {
      req.resolve(result);
    } else if (type === "error") {
      req.reject(new Error(error));
    }
  };
}
