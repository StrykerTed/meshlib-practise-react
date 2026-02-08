/**
 * Web Worker for MeshLib Annotations WASM module.
 *
 * Supports three operations:
 *   • select_patch  – grow a patch from a seed face
 *   • create_landmark – validate & snap a landmark position
 *   • patch_from_landmarks – create a closed contour from landmarks → flood-fill patch
 */

/* eslint-disable no-restricted-globals */
const ctx = self as unknown as Worker

let wasmModule: any = null

async function ensureModule() {
    if (wasmModule) return wasmModule
    // @ts-expect-error – dynamic WASM import
    const factory = (await import('../wasm/meshlib_annotations.js')).default
    wasmModule = await factory()
    return wasmModule
}

// ---------------------------------------------------------------------------
// select_patch
// ---------------------------------------------------------------------------
async function handleSelectPatch(
    stlBuffer: ArrayBuffer,
    seedFaceIndex: number,
    centerX: number,
    centerY: number,
    centerZ: number,
    radius: number,
    maxNormalAngleDeg: number,
) {
    const M = await ensureModule()
    const stl = new Uint8Array(stlBuffer)

    // Allocate input buffer
    const inPtr = M._malloc(stl.byteLength)
    M.HEAPU8.set(stl, inPtr)

    // Allocate output pointers (7 uint32 slots)
    const outFaceIndicesPtr = M._malloc(4)
    const outNumFacesPtr = M._malloc(4)
    const outContourPtsPtr = M._malloc(4)
    const outNumContourPtsPtr = M._malloc(4)
    const outContourSizesPtr = M._malloc(4)
    const outNumContoursPtr = M._malloc(4)
    const outErrorPtr = M._malloc(4)

    try {
        const rc = M._meshlib_annotations_select_patch(
            inPtr,
            stl.byteLength,
            seedFaceIndex,
            centerX,
            centerY,
            centerZ,
            radius,
            maxNormalAngleDeg,
            outFaceIndicesPtr,
            outNumFacesPtr,
            outContourPtsPtr,
            outNumContourPtsPtr,
            outContourSizesPtr,
            outNumContoursPtr,
            outErrorPtr,
        )

        if (rc !== 0) {
            const errStrPtr = M.HEAPU32[outErrorPtr >> 2]
            let errMsg = 'annotations select_patch failed'
            if (errStrPtr) {
                const bytes: number[] = []
                let i = errStrPtr
                while (M.HEAPU8[i] !== 0) bytes.push(M.HEAPU8[i++])
                errMsg = new TextDecoder().decode(new Uint8Array(bytes))
                M._meshlib_free(errStrPtr)
            }
            throw new Error(errMsg)
        }

        // Read face indices
        const numFaces = M.HEAPU32[outNumFacesPtr >> 2]
        const faceIndicesPtr = M.HEAPU32[outFaceIndicesPtr >> 2]
        const faceIndices = new Uint32Array(numFaces)
        if (numFaces > 0 && faceIndicesPtr) {
            faceIndices.set(new Uint32Array(M.HEAPU8.buffer, faceIndicesPtr, numFaces))
            M._meshlib_free(faceIndicesPtr)
        }

        // Read contour points
        const numContourPts = M.HEAPU32[outNumContourPtsPtr >> 2]
        const contourPtsPtr = M.HEAPU32[outContourPtsPtr >> 2]
        const contourPoints = new Float32Array(numContourPts * 3)
        if (numContourPts > 0 && contourPtsPtr) {
            contourPoints.set(new Float32Array(M.HEAPU8.buffer, contourPtsPtr, numContourPts * 3))
            M._meshlib_free(contourPtsPtr)
        }

        // Read contour sizes
        const numContours = M.HEAPU32[outNumContoursPtr >> 2]
        const contourSizesPtr = M.HEAPU32[outContourSizesPtr >> 2]
        const contourSizes = new Uint32Array(numContours)
        if (numContours > 0 && contourSizesPtr) {
            contourSizes.set(new Uint32Array(M.HEAPU8.buffer, contourSizesPtr, numContours))
            M._meshlib_free(contourSizesPtr)
        }

        return {
            faceIndices: faceIndices.buffer,
            contourPoints: contourPoints.buffer,
            contourSizes: contourSizes.buffer,
            numFaces,
            numContourPts,
            numContours,
        }
    } finally {
        M._free(inPtr)
        M._free(outFaceIndicesPtr)
        M._free(outNumFacesPtr)
        M._free(outContourPtsPtr)
        M._free(outNumContourPtsPtr)
        M._free(outContourSizesPtr)
        M._free(outNumContoursPtr)
        M._free(outErrorPtr)
    }
}

// ---------------------------------------------------------------------------
// create_landmark
// ---------------------------------------------------------------------------
async function handleCreateLandmark(
    stlBuffer: ArrayBuffer,
    faceIndex: number,
    posX: number,
    posY: number,
    posZ: number,
) {
    const M = await ensureModule()
    const stl = new Uint8Array(stlBuffer)

    const inPtr = M._malloc(stl.byteLength)
    M.HEAPU8.set(stl, inPtr)

    // Output: 3 floats + error ptr
    const outXPtr = M._malloc(4)
    const outYPtr = M._malloc(4)
    const outZPtr = M._malloc(4)
    const outErrorPtr = M._malloc(4)

    try {
        const rc = M._meshlib_annotations_create_landmark(
            inPtr,
            stl.byteLength,
            faceIndex,
            posX,
            posY,
            posZ,
            outXPtr,
            outYPtr,
            outZPtr,
            outErrorPtr,
        )

        if (rc !== 0) {
            const errStrPtr = M.HEAPU32[outErrorPtr >> 2]
            let errMsg = 'annotations create_landmark failed'
            if (errStrPtr) {
                const bytes: number[] = []
                let i = errStrPtr
                while (M.HEAPU8[i] !== 0) bytes.push(M.HEAPU8[i++])
                errMsg = new TextDecoder().decode(new Uint8Array(bytes))
                M._meshlib_free(errStrPtr)
            }
            throw new Error(errMsg)
        }

        const x = M.HEAPF32[outXPtr >> 2]
        const y = M.HEAPF32[outYPtr >> 2]
        const z = M.HEAPF32[outZPtr >> 2]

        return { x, y, z }
    } finally {
        M._free(inPtr)
        M._free(outXPtr)
        M._free(outYPtr)
        M._free(outZPtr)
        M._free(outErrorPtr)
    }
}

// ---------------------------------------------------------------------------
// patch_from_landmarks
// ---------------------------------------------------------------------------
async function handlePatchFromLandmarks(
    stlBuffer: ArrayBuffer,
    faceIndicesArr: number[],
    positionsArr: number[], // flat [x0,y0,z0, x1,y1,z1, ...]
    numLandmarks: number,
) {
    const M = await ensureModule()
    const stl = new Uint8Array(stlBuffer)

    // Allocate input STL
    const inPtr = M._malloc(stl.byteLength)
    M.HEAPU8.set(stl, inPtr)

    // Allocate face_indices array (uint32)
    const faceIdxBytes = numLandmarks * 4
    const faceIdxPtr = M._malloc(faceIdxBytes)
    const faceIdxView = new Uint32Array(M.HEAPU8.buffer, faceIdxPtr, numLandmarks)
    faceIdxView.set(faceIndicesArr)

    // Allocate positions array (float32)
    const posBytes = numLandmarks * 3 * 4
    const posPtr = M._malloc(posBytes)
    const posView = new Float32Array(M.HEAPU8.buffer, posPtr, numLandmarks * 3)
    posView.set(positionsArr)

    // Output pointers
    const outFaceIndicesPtr = M._malloc(4)
    const outNumFacesPtr = M._malloc(4)
    const outContourPtsPtr = M._malloc(4)
    const outNumContourPtsPtr = M._malloc(4)
    const outContourSizesPtr = M._malloc(4)
    const outNumContoursPtr = M._malloc(4)
    const outErrorPtr = M._malloc(4)

    try {
        const rc = M._meshlib_annotations_patch_from_landmarks(
            inPtr,
            stl.byteLength,
            faceIdxPtr,
            posPtr,
            numLandmarks,
            outFaceIndicesPtr,
            outNumFacesPtr,
            outContourPtsPtr,
            outNumContourPtsPtr,
            outContourSizesPtr,
            outNumContoursPtr,
            outErrorPtr,
        )

        if (rc !== 0) {
            const errStrPtr = M.HEAPU32[outErrorPtr >> 2]
            let errMsg = 'patch_from_landmarks failed'
            if (errStrPtr) {
                const bytes: number[] = []
                let i = errStrPtr
                while (M.HEAPU8[i] !== 0) bytes.push(M.HEAPU8[i++])
                errMsg = new TextDecoder().decode(new Uint8Array(bytes))
                M._meshlib_free(errStrPtr)
            }
            throw new Error(errMsg)
        }

        // Read results (same layout as select_patch)
        const numFaces = M.HEAPU32[outNumFacesPtr >> 2]
        const faceIndicesResultPtr = M.HEAPU32[outFaceIndicesPtr >> 2]
        const faceIndices = new Uint32Array(numFaces)
        if (numFaces > 0 && faceIndicesResultPtr) {
            faceIndices.set(new Uint32Array(M.HEAPU8.buffer, faceIndicesResultPtr, numFaces))
            M._meshlib_free(faceIndicesResultPtr)
        }

        const numContourPts = M.HEAPU32[outNumContourPtsPtr >> 2]
        const contourPtsResultPtr = M.HEAPU32[outContourPtsPtr >> 2]
        const contourPoints = new Float32Array(numContourPts * 3)
        if (numContourPts > 0 && contourPtsResultPtr) {
            contourPoints.set(new Float32Array(M.HEAPU8.buffer, contourPtsResultPtr, numContourPts * 3))
            M._meshlib_free(contourPtsResultPtr)
        }

        const numContours = M.HEAPU32[outNumContoursPtr >> 2]
        const contourSizesResultPtr = M.HEAPU32[outContourSizesPtr >> 2]
        const contourSizes = new Uint32Array(numContours)
        if (numContours > 0 && contourSizesResultPtr) {
            contourSizes.set(new Uint32Array(M.HEAPU8.buffer, contourSizesResultPtr, numContours))
            M._meshlib_free(contourSizesResultPtr)
        }

        return {
            faceIndices: faceIndices.buffer,
            contourPoints: contourPoints.buffer,
            contourSizes: contourSizes.buffer,
            numFaces,
            numContourPts,
            numContours,
        }
    } finally {
        M._free(inPtr)
        M._free(faceIdxPtr)
        M._free(posPtr)
        M._free(outFaceIndicesPtr)
        M._free(outNumFacesPtr)
        M._free(outContourPtsPtr)
        M._free(outNumContourPtsPtr)
        M._free(outContourSizesPtr)
        M._free(outNumContoursPtr)
        M._free(outErrorPtr)
    }
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------
ctx.addEventListener('message', async (e: MessageEvent) => {
    const { id, type, payload } = e.data

    try {
        if (type === 'ping') {
            ctx.postMessage({ id, type: 'pong' })
            return
        }

        if (type === 'select_patch') {
            ctx.postMessage({ id, type: 'status', status: 'Loading WASM module…' })
            const result = await handleSelectPatch(
                payload.stlBuffer,
                payload.seedFaceIndex,
                payload.centerX,
                payload.centerY,
                payload.centerZ,
                payload.radius,
                payload.maxNormalAngleDeg,
            )
            ctx.postMessage(
                { id, type: 'result', result },
                [result.faceIndices, result.contourPoints, result.contourSizes] as any,
            )
            return
        }

        if (type === 'create_landmark') {
            ctx.postMessage({ id, type: 'status', status: 'Creating landmark…' })
            const result = await handleCreateLandmark(
                payload.stlBuffer,
                payload.faceIndex,
                payload.posX,
                payload.posY,
                payload.posZ,
            )
            ctx.postMessage({ id, type: 'result', result })
            return
        }

        if (type === 'patch_from_landmarks') {
            ctx.postMessage({ id, type: 'status', status: 'Building patch from landmarks…' })
            const result = await handlePatchFromLandmarks(
                payload.stlBuffer,
                payload.faceIndices,
                payload.positions,
                payload.numLandmarks,
            )
            ctx.postMessage(
                { id, type: 'result', result },
                [result.faceIndices, result.contourPoints, result.contourSizes] as any,
            )
            return
        }

        throw new Error(`Unknown message type: ${type}`)
    } catch (err: any) {
        ctx.postMessage({ id, type: 'error', error: err?.message ?? String(err) })
    }
})
