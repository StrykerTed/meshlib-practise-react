import { Canvas } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLInteractiveViewer, { FaceClickInfo, ContourData } from '../components/STLInteractiveViewer'
import FileSelector from '../components/FileSelector'
import { CanvasContainer } from '../styles/CanvasContainer'
import { AnnotationsClient } from '../lib/annotationsClient'

const COMPLEX_STL_FILES = [
    'complex/bony_penvis_mri.stl',
    'complex/Duck_mesh.stl',
    'complex/UNICORN_mesh_NoTexture.stl',
    'complex/Warrior with Hammer pose 2_28mm_supported.stl',
]

type AnnotationMode = 'patch' | 'landmark'

function AnnotationsPage() {
    const [selectedFile, setSelectedFile] = useState<string>(COMPLEX_STL_FILES[0] ?? '')
    const [mode, setMode] = useState<AnnotationMode>('patch')

    // Patch controls
    const [radius, setRadius] = useState(20)
    const [maxAngle, setMaxAngle] = useState(45)
    const [useAngleLimit, setUseAngleLimit] = useState(true)

    // State
    const [isProcessing, setIsProcessing] = useState(false)
    const [status, setStatus] = useState('')
    const [error, setError] = useState('')

    // Visuals
    const [highlightedFaces, setHighlightedFaces] = useState<Set<number>>(new Set())
    const [landmarks, setLandmarks] = useState<THREE.Vector3[]>([])
    /** Face index for each landmark (parallel array with landmarks) — needed by WASM */
    const [landmarkFaceIndices, setLandmarkFaceIndices] = useState<number[]>([])
    /** STL-space positions for each landmark (parallel, flat [x,y,z,...]) */
    const [landmarkStlPositions, setLandmarkStlPositions] = useState<number[]>([])
    const [contours, setContours] = useState<ContourData[]>([])

    // Cached raw STL buffer (original coordinates)
    const stlBufferRef = useRef<ArrayBuffer | null>(null)
    // Transform info so we can map between viewer coords ↔ STL coords
    const transformRef = useRef<{ scale: number; centerOffset: THREE.Vector3; zShift: number } | null>(null)

    const clientRef = useRef<AnnotationsClient | null>(null)

    // Lifecycle
    useEffect(() => {
        const c = new AnnotationsClient()
        clientRef.current = c
        return () => {
            clientRef.current = null
            c.dispose()
        }
    }, [])

    // Fetch raw STL when file changes & compute transform params
    useEffect(() => {
        setHighlightedFaces(new Set())
        setLandmarks([])
        setLandmarkFaceIndices([])
        setLandmarkStlPositions([])
        setContours([])
        setStatus('')
        setError('')
        stlBufferRef.current = null
        transformRef.current = null

        if (!selectedFile) return

        let cancelled = false
        fetch(`/stl/${selectedFile}`)
            .then((res) => {
                if (!res.ok) throw new Error(`fetch ${res.status}`)
                return res.arrayBuffer()
            })
            .then((buf) => {
                if (cancelled) return
                stlBufferRef.current = buf

                // Compute the same transform that STLInteractiveViewer applies
                const loader = new STLLoader()

                // Get the raw centroid (before any transform)
                const rawGeo = loader.parse(buf.slice(0))
                rawGeo.computeBoundingBox()
                const centroid = new THREE.Vector3()
                rawGeo.boundingBox!.getCenter(centroid)

                // Center + scale (mirrors STLInteractiveViewer)
                const geo = loader.parse(buf.slice(0))
                geo.center()
                geo.computeBoundingBox()
                const size = new THREE.Vector3()
                geo.boundingBox!.getSize(size)
                const maxDim = Math.max(size.x, size.y, size.z)
                const scale = maxDim > 0 ? 50 / maxDim : 1
                geo.scale(scale, scale, scale)
                geo.computeBoundingBox()
                const zShift = -geo.boundingBox!.min.z

                transformRef.current = { scale, centerOffset: centroid, zShift }
            })
            .catch(() => { /* non-critical */ })

        return () => { cancelled = true }
    }, [selectedFile])

    /**
     * Convert a point from VIEWER space (centered, scaled, z-shifted)
     * back to original STL coordinate space.
     */
    const viewerToStl = useCallback((pt: THREE.Vector3): THREE.Vector3 => {
        const t = transformRef.current
        if (!t) return pt.clone()
        return new THREE.Vector3(
            pt.x / t.scale + t.centerOffset.x,
            pt.y / t.scale + t.centerOffset.y,
            (pt.z - t.zShift) / t.scale + t.centerOffset.z,
        )
    }, [])

    /**
     * Convert a point from STL coordinate space to VIEWER space.
     */
    const stlToViewer = useCallback((x: number, y: number, z: number): THREE.Vector3 => {
        const t = transformRef.current
        if (!t) return new THREE.Vector3(x, y, z)
        return new THREE.Vector3(
            (x - t.centerOffset.x) * t.scale,
            (y - t.centerOffset.y) * t.scale,
            (z - t.centerOffset.z) * t.scale + t.zShift,
        )
    }, [])

    // ---- Face click handler ------------------------------------------------
    const handleFaceClick = useCallback(
        async (info: FaceClickInfo) => {
            const client = clientRef.current
            const stlBuf = stlBufferRef.current
            if (!client || !stlBuf || isProcessing) return

            if (mode === 'patch') {
                setIsProcessing(true)
                setError('')
                setStatus('Selecting patch…')

                try {
                    // Convert click point to original STL coords
                    const stlPt = viewerToStl(info.point)

                    const result = await client.selectPatch(stlBuf, {
                        seedFaceIndex: info.faceIndex,
                        centerX: stlPt.x,
                        centerY: stlPt.y,
                        centerZ: stlPt.z,
                        radius: radius / (transformRef.current?.scale ?? 1),
                        maxNormalAngleDeg: useAngleLimit ? maxAngle : -1,
                        onStatus: setStatus,
                    })

                    // Update highlights
                    const faces = new Set<number>()
                    for (let i = 0; i < result.faceIndices.length; i++) {
                        faces.add(result.faceIndices[i])
                    }
                    setHighlightedFaces(faces)

                    // Convert contour points from STL coords → viewer coords
                    const contourList: ContourData[] = []
                    let offset = 0
                    for (let ci = 0; ci < result.numContours; ci++) {
                        const count = result.contourSizes[ci]
                        const pts = new Float32Array(count * 3)
                        for (let pi = 0; pi < count; pi++) {
                            const sx = result.contourPoints[(offset + pi) * 3]
                            const sy = result.contourPoints[(offset + pi) * 3 + 1]
                            const sz = result.contourPoints[(offset + pi) * 3 + 2]
                            const vp = stlToViewer(sx, sy, sz)
                            pts[pi * 3] = vp.x
                            pts[pi * 3 + 1] = vp.y
                            pts[pi * 3 + 2] = vp.z
                        }
                        contourList.push({ points: pts, closed: true })
                        offset += count
                    }
                    setContours(contourList)

                    setStatus(
                        `Patch: ${result.numFaces} faces, ${result.numContours} contour${result.numContours !== 1 ? 's' : ''}`,
                    )
                } catch (e: any) {
                    console.error('[Annotations] patch failed:', e)
                    setError(String(e?.message || e))
                    setStatus('')
                } finally {
                    setIsProcessing(false)
                }
            } else if (mode === 'landmark') {
                // Add landmark at click position (viewer coords — already transformed)
                setLandmarks((prev) => [...prev, info.point.clone()])
                // Store face index + STL-space position for later WASM call
                const stlPt = viewerToStl(info.point)
                setLandmarkFaceIndices((prev) => [...prev, info.faceIndex])
                setLandmarkStlPositions((prev) => [...prev, stlPt.x, stlPt.y, stlPt.z])
                setStatus(`${landmarks.length + 1} landmark${landmarks.length > 0 ? 's' : ''} placed`)
            }
        },
        [mode, radius, maxAngle, useAngleLimit, isProcessing, viewerToStl, stlToViewer, landmarks.length],
    )

    // ---- Live contour preview (connects landmarks in order) ----------------
    const contourPreview = useMemo<ContourData[]>(() => {
        if (landmarks.length < 2) return []
        const pts = new Float32Array(landmarks.length * 3)
        for (let i = 0; i < landmarks.length; i++) {
            pts[i * 3] = landmarks[i].x
            pts[i * 3 + 1] = landmarks[i].y
            pts[i * 3 + 2] = landmarks[i].z
        }
        return [{ points: pts, closed: landmarks.length >= 3 }]
    }, [landmarks])

    // Merge contours from WASM result + live preview
    const allContours = useMemo<ContourData[]>(() => {
        // If we have WASM contours (from Create Patch), show those; otherwise show preview
        if (contours.length > 0) return contours
        return contourPreview
    }, [contours, contourPreview])

    // ---- Create Patch from landmarks via WASM ------------------------------
    const handleCreatePatch = useCallback(async () => {
        const client = clientRef.current
        const stlBuf = stlBufferRef.current
        if (!client || !stlBuf || isProcessing) return
        if (landmarks.length < 3) {
            setError('Place at least 3 landmarks to create a patch.')
            return
        }

        setIsProcessing(true)
        setError('')
        setStatus('Creating patch from landmarks…')

        try {
            const result = await client.patchFromLandmarks(stlBuf, {
                faceIndices: landmarkFaceIndices,
                positions: landmarkStlPositions,
                onStatus: setStatus,
            })

            // Highlight patch faces
            const faces = new Set<number>()
            for (let i = 0; i < result.faceIndices.length; i++) {
                faces.add(result.faceIndices[i])
            }
            setHighlightedFaces(faces)

            // Convert boundary contour points from STL → viewer coords
            const contourList: ContourData[] = []
            let offset = 0
            for (let ci = 0; ci < result.numContours; ci++) {
                const count = result.contourSizes[ci]
                const pts = new Float32Array(count * 3)
                for (let pi = 0; pi < count; pi++) {
                    const sx = result.contourPoints[(offset + pi) * 3]
                    const sy = result.contourPoints[(offset + pi) * 3 + 1]
                    const sz = result.contourPoints[(offset + pi) * 3 + 2]
                    const vp = stlToViewer(sx, sy, sz)
                    pts[pi * 3] = vp.x
                    pts[pi * 3 + 1] = vp.y
                    pts[pi * 3 + 2] = vp.z
                }
                contourList.push({ points: pts, closed: true })
                offset += count
            }
            setContours(contourList)

            setStatus(
                `Patch: ${result.numFaces} faces, ${result.numContours} contour${result.numContours !== 1 ? 's' : ''}`,
            )
        } catch (e: any) {
            console.error('[Annotations] patch_from_landmarks failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsProcessing(false)
        }
    }, [isProcessing, landmarks.length, landmarkFaceIndices, landmarkStlPositions, stlToViewer])

    // ---- Undo last landmark ------------------------------------------------
    function undoLastLandmark() {
        setLandmarks((prev) => prev.slice(0, -1))
        setLandmarkFaceIndices((prev) => prev.slice(0, -1))
        setLandmarkStlPositions((prev) => prev.slice(0, -3))
        // Clear any existing patch result since landmarks changed
        setHighlightedFaces(new Set())
        setContours([])
    }

    function onClear() {
        setHighlightedFaces(new Set())
        setLandmarks([])
        setLandmarkFaceIndices([])
        setLandmarkStlPositions([])
        setContours([])
        setStatus('')
        setError('')
    }

    return (
        <>
            <Navbar pageTitle="Annotations" showBack />
            <FileSelector
                files={COMPLEX_STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />

            {/* Info + Status panel */}
            <div className="ui-panel" style={{ top: '180px', maxWidth: 440 }}>
                <p style={{ margin: 0, color: '#e2e8f0', fontSize: 13, lineHeight: 1.6 }}>
                    <strong>Click on the mesh</strong> to{' '}
                    {mode === 'patch' ? (
                        <>grow a <strong style={{ color: '#ef4444' }}>patch</strong> (highlighted faces + <strong style={{ color: '#22c55e' }}>contour</strong> boundary)</>
                    ) : (
                        <>place <strong style={{ color: '#3b82f6' }}>landmarks</strong> around a region, then <strong>Create Patch</strong> to connect them and fill the enclosed faces</>
                    )}
                    . Annotations use barycentric coordinates and survive deformations.
                </p>
                {status && (
                    <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>
                        <strong>Status:</strong> {status}
                    </div>
                )}
                {error && (
                    <div style={{ marginTop: 4, color: '#fca5a5', fontSize: 12 }}>
                        <strong>Error:</strong> {error}
                    </div>
                )}
            </div>

            {/* Processing overlay */}
            {isProcessing && (
                <div className="wasm-spinner-overlay">
                    <div className="wasm-spinner-ring" />
                    <div className="wasm-spinner-label">{status || 'Processing…'}</div>
                </div>
            )}

            <CanvasContainer>
                <Canvas
                    camera={{
                        position: [120, -320, 100],
                        fov: 24,
                        near: 0.1,
                        far: 200000,
                    }}
                    shadows
                    gl={{ antialias: true, alpha: false }}
                    style={{ width: '100%', height: '100%', background: '#0a0a0a' }}
                >
                    <Scene />

                    {selectedFile && (
                        <group position={[0, 0, 0]}>
                            <STLInteractiveViewer
                                filename={selectedFile}
                                highlightedFaces={highlightedFaces}
                                highlightColor="#ef4444"
                                landmarks={landmarks}
                                contours={allContours}
                                onFaceClick={handleFaceClick}
                            />
                        </group>
                    )}
                </Canvas>
            </CanvasContainer>

            {/* ---- Controls (bottom-right) ---- */}
            <div
                style={{
                    position: 'fixed',
                    right: 16,
                    bottom: 16,
                    zIndex: 2000,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'flex-end',
                }}
            >
                {/* Mode selector */}
                <div
                    style={{
                        display: 'flex',
                        gap: 6,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '6px 10px',
                        borderRadius: 10,
                    }}
                >
                    <button
                        onClick={() => setMode('patch')}
                        style={{
                            padding: '4px 12px',
                            borderRadius: 6,
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: 12,
                            background: mode === 'patch' ? '#ef4444' : '#334155',
                            color: '#fff',
                        }}
                    >
                        Patch
                    </button>
                    <button
                        onClick={() => setMode('landmark')}
                        style={{
                            padding: '4px 12px',
                            borderRadius: 6,
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 600,
                            fontSize: 12,
                            background: mode === 'landmark' ? '#a855f7' : '#334155',
                            color: '#fff',
                        }}
                    >
                        Landmark
                    </button>
                </div>

                {/* Patch controls (only when in patch mode) */}
                {mode === 'patch' && (
                    <>
                        {/* Radius slider */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                background: 'rgba(15,23,42,0.85)',
                                padding: '6px 14px',
                                borderRadius: 10,
                            }}
                        >
                            <label style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
                                Radius
                            </label>
                            <input
                                type="range"
                                min={2}
                                max={100}
                                step={1}
                                value={radius}
                                onChange={(e) => setRadius(Number(e.target.value))}
                                style={{ width: 100, accentColor: '#ef4444' }}
                            />
                            <span
                                style={{
                                    color: '#ef4444',
                                    fontWeight: 700,
                                    fontSize: 14,
                                    minWidth: 32,
                                    textAlign: 'right',
                                }}
                            >
                                {radius}
                            </span>
                        </div>

                        {/* Angle limit toggle + slider */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                background: 'rgba(15,23,42,0.85)',
                                padding: '4px 14px',
                                borderRadius: 10,
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={useAngleLimit}
                                onChange={(e) => setUseAngleLimit(e.target.checked)}
                                style={{ accentColor: '#22c55e' }}
                            />
                            <label style={{ color: '#e2e8f0', fontSize: 13 }}>
                                Normal angle limit
                            </label>
                            {useAngleLimit && (
                                <>
                                    <input
                                        type="range"
                                        min={5}
                                        max={180}
                                        step={1}
                                        value={maxAngle}
                                        onChange={(e) => setMaxAngle(Number(e.target.value))}
                                        style={{ width: 80, accentColor: '#22c55e' }}
                                    />
                                    <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 13, minWidth: 36 }}>
                                        {maxAngle}°
                                    </span>
                                </>
                            )}
                        </div>
                    </>
                )}

                {/* Info badges */}
                {highlightedFaces.size > 0 && (
                    <span
                        style={{
                            color: '#94a3b8',
                            fontSize: 12,
                            background: 'rgba(15,23,42,0.85)',
                            padding: '3px 10px',
                            borderRadius: 8,
                        }}
                    >
                        {highlightedFaces.size} faces selected
                    </span>
                )}
                {landmarks.length > 0 && (
                    <span
                        style={{
                            color: '#3b82f6',
                            fontSize: 12,
                            background: 'rgba(15,23,42,0.85)',
                            padding: '3px 10px',
                            borderRadius: 8,
                        }}
                    >
                        {landmarks.length} landmark{landmarks.length > 1 ? 's' : ''}
                    </span>
                )}

                {/* Landmark mode buttons */}
                {mode === 'landmark' && landmarks.length >= 3 && (
                    <HelloButton
                        onClick={handleCreatePatch}
                        disabled={isProcessing}
                        text={`Create Patch (${landmarks.length} pts)`}
                    />
                )}
                {mode === 'landmark' && landmarks.length > 0 && (
                    <HelloButton
                        onClick={undoLastLandmark}
                        disabled={isProcessing}
                        text="Undo Last"
                    />
                )}

                {/* Clear button */}
                {(highlightedFaces.size > 0 || landmarks.length > 0) && (
                    <HelloButton onClick={onClear} disabled={isProcessing} text="Clear All" />
                )}
            </div>
        </>
    )
}

export default AnnotationsPage
