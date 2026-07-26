import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Billboard, Text } from '@react-three/drei'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import FileSelector from '../components/FileSelector'
import STLBufferViewer from '../components/STLBufferViewer'
import IntersectionLines from '../components/IntersectionLines'
import { FillHolesClient } from '../lib/fillHolesClient'
import { SelfIntersectionsClient } from '../lib/selfIntersectionsClient'
import { InvertedNormalsClient } from '../lib/invertedNormalsClient'
import { OverlappingTrianglesClient } from '../lib/overlappingTrianglesClient'
import { BadEdgesClient } from '../lib/badEdgesClient'
import { CanvasContainer } from '../styles/CanvasContainer'

const STL_FILES = [
    'baseplate_shoulder_holes.stl',
    'ball_with_missing_faces.stl',
    'icosphere_with_holes.stl',
    'self-intersecting-3d.stl',
    'self-intersecting.stl',
    'test_noise.stl',
    'ball_with_missing_faces_inverted_normal.stl',
]

function BasicsPage() {
    const [selectedFile, setSelectedFile] = useState<string>(STL_FILES[0] ?? '')
    const [isFilling, setIsFilling] = useState(false)
    const [repairedStl, setRepairedStl] = useState<ArrayBuffer | null>(null)
    const [status, setStatus] = useState<string>('')
    const [error, setError] = useState<string>('')
    const [holesFilledCount, setHolesFilledCount] = useState<number | null>(null)

    const [isDetecting, setIsDetecting] = useState(false)
    const [isRepairing, setIsRepairing] = useState(false)
    const [intersectionCount, setIntersectionCount] = useState<number | null>(null)
    const [intersectionSegments, setIntersectionSegments] = useState<Float32Array | null>(null)

    const [isCheckingInverted, setIsCheckingInverted] = useState(false)
    const [isRepairingInverted, setIsRepairingInverted] = useState(false)
    const [isClosedMesh, setIsClosedMesh] = useState<boolean | null>(null)
    const [isInvertedNormals, setIsInvertedNormals] = useState<boolean | null>(null)
    const [signedVolume, setSignedVolume] = useState<number | null>(null)
    const [localInvertedCount, setLocalInvertedCount] = useState<number | null>(null)

    const [isDetectingOverlapping, setIsDetectingOverlapping] = useState(false)
    const [overlappingCount, setOverlappingCount] = useState<number | null>(null)
    const [isDetectingBadEdges, setIsDetectingBadEdges] = useState(false)
    const [badEdgesCount, setBadEdgesCount] = useState<number | null>(null)
    const [badContoursCount, setBadContoursCount] = useState<number | null>(null)

    const fillHolesClientRef = useRef<FillHolesClient | null>(null)
    const selfIntersectionsClientRef = useRef<SelfIntersectionsClient | null>(null)
    const invertedNormalsClientRef = useRef<InvertedNormalsClient | null>(null)
    const overlappingTrianglesClientRef = useRef<OverlappingTrianglesClient | null>(null)
    const badEdgesClientRef = useRef<BadEdgesClient | null>(null)

    useEffect(() => {
        const client = new FillHolesClient()
        fillHolesClientRef.current = client
        const siClient = new SelfIntersectionsClient()
        selfIntersectionsClientRef.current = siClient
        const inClient = new InvertedNormalsClient()
        invertedNormalsClientRef.current = inClient
        const overlapClient = new OverlappingTrianglesClient()
        overlappingTrianglesClientRef.current = overlapClient
        const beClient = new BadEdgesClient()
        badEdgesClientRef.current = beClient
        return () => {
            fillHolesClientRef.current = null
            client.dispose()
            selfIntersectionsClientRef.current = null
            siClient.dispose()
            invertedNormalsClientRef.current = null
            inClient.dispose()
            overlappingTrianglesClientRef.current = null
            overlapClient.dispose()
            badEdgesClientRef.current = null
            beClient.dispose()
        }
    }, [])

    useEffect(() => {
        setRepairedStl(null)
        setStatus('')
        setError('')
        setHolesFilledCount(null)
        setIntersectionCount(null)
        setIntersectionSegments(null)
        setIsClosedMesh(null)
        setIsInvertedNormals(null)
        setSignedVolume(null)
        setLocalInvertedCount(null)
        setOverlappingCount(null)
        setBadEdgesCount(null)
        setBadContoursCount(null)
    }, [selectedFile])

    async function onFillHoles() {
        const fillHolesClient = fillHolesClientRef.current
        if (!selectedFile || isFilling || !fillHolesClient) return

        setIsFilling(true)
        setError('')
        setStatus('Loading STL…')
        try {
            const stlUrl = `/stl/${selectedFile}`
            const res = await fetch(stlUrl)
            if (!res.ok) throw new Error(`Failed to fetch STL (${res.status}): ${stlUrl}`)
            const input = await res.arrayBuffer()
            setStatus('Running FillHoles (WASM in worker)…')
            const startMs = performance.now()
            const result = await fillHolesClient.fillHoles(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            console.log('[BasicsPage] FillHoles result:', result);
            setRepairedStl(result.output)
            setHolesFilledCount(result.holesFilledCount ?? null)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms${result.holesFilledCount !== undefined ? ` - ${result.holesFilledCount} holes filled` : ''}`)
        } catch (e: any) {
            console.error('[FillHoles] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsFilling(false)
        }
    }

    async function fetchStlBuffer(): Promise<ArrayBuffer> {
        const stlUrl = `/stl/${selectedFile}`
        const res = await fetch(stlUrl)
        if (!res.ok) throw new Error(`Failed to fetch STL (${res.status}): ${stlUrl}`)
        return res.arrayBuffer()
    }

    async function onDetectIntersections() {
        const client = selfIntersectionsClientRef.current
        if (!selectedFile || isDetecting || !client) return

        setIsDetecting(true)
        setError('')
        setStatus('Loading STL…')
        setIntersectionCount(null)
        setIntersectionSegments(null)
        try {
            const input = await fetchStlBuffer()
            setStatus('Detecting self-intersections (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setIntersectionCount(result.count)
            setIntersectionSegments(result.segments)
            setStatus(
                result.count === 0
                    ? `No intersections found (${elapsedMs.toFixed(0)} ms)`
                    : `Found ${result.count} intersection(s) in ${elapsedMs.toFixed(0)} ms`,
            )
        } catch (e: any) {
            console.error('[DetectIntersections] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsDetecting(false)
        }
    }

    async function onRepairIntersections() {
        const client = selfIntersectionsClientRef.current
        if (!selectedFile || isRepairing || !client) return

        setIsRepairing(true)
        setError('')
        setStatus('Loading STL…')
        try {
            const input = await fetchStlBuffer()
            setStatus('Repairing self-intersections (WASM)…')
            const startMs = performance.now()
            const result = await client.repair(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setRepairedStl(result.output)
            setStatus(
                `Repair done in ${elapsedMs.toFixed(0)} ms — removed ${result.removedFaces} face(s)`,
            )
        } catch (e: any) {
            console.error('[RepairIntersections] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsRepairing(false)
        }
    }

    async function onCheckInvertedNormals() {
        const client = invertedNormalsClientRef.current
        if (!selectedFile || isCheckingInverted || !client) return

        setIsCheckingInverted(true)
        setError('')
        setStatus('Loading STL…')
        setIsClosedMesh(null)
        setIsInvertedNormals(null)
        setSignedVolume(null)
        setLocalInvertedCount(null)

        try {
            const input = await fetchStlBuffer()
            setStatus('Checking inverted normals (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs

            setIsClosedMesh(result.isClosed)
            setIsInvertedNormals(result.isInverted)
            setSignedVolume(result.signedVolume)
            setLocalInvertedCount(result.localInvertedCount)

            if (result.localInvertedCount > 0) {
                setStatus(`Detected ${result.localInvertedCount} locally inverted triangle(s) (${elapsedMs.toFixed(0)} ms)`)
            } else if (!result.isClosed) {
                setStatus(`Open mesh: no local inverted triangles found (${elapsedMs.toFixed(0)} ms)`)
            } else if (result.isInverted) {
                setStatus(`Global inverted orientation detected (${elapsedMs.toFixed(0)} ms)`)
            } else {
                setStatus(`Normals orientation looks correct (${elapsedMs.toFixed(0)} ms)`)
            }
        } catch (e: any) {
            console.error('[CheckInvertedNormals] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsCheckingInverted(false)
        }
    }

    async function onDetectOverlappingTriangles() {
        const client = overlappingTrianglesClientRef.current
        if (!selectedFile || isDetectingOverlapping || !client) return

        setIsDetectingOverlapping(true)
        setError('')
        setStatus('Loading STL…')
        setOverlappingCount(null)
        try {
            const input = await fetchStlBuffer()
            setStatus('Detecting overlapping triangles (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setOverlappingCount(result.count)
            setStatus(
                result.count === 0
                    ? `No overlapping triangles found (${elapsedMs.toFixed(0)} ms)`
                    : `Found ${result.count} overlapping triangle(s) (${elapsedMs.toFixed(0)} ms)`,
            )
        } catch (e: any) {
            console.error('[DetectOverlappingTriangles] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsDetectingOverlapping(false)
        }
    }

    async function onDetectBadEdges() {
        const client = badEdgesClientRef.current
        if (!selectedFile || isDetectingBadEdges || !client) return

        setIsDetectingBadEdges(true)
        setError('')
        setStatus('Loading STL…')
        setBadEdgesCount(null)
        setBadContoursCount(null)
        try {
            const input = await fetchStlBuffer()
            setStatus('Detecting bad edges (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setBadEdgesCount(result.badEdgesCount)
            setBadContoursCount(result.badContoursCount)
            setStatus(
                result.badEdgesCount === 0
                    ? `No bad edges found (${elapsedMs.toFixed(0)} ms)`
                    : `Found ${result.badEdgesCount} bad edge(s), ${result.badContoursCount} contour(s) (${elapsedMs.toFixed(0)} ms)`,
            )
        } catch (e: any) {
            console.error('[DetectBadEdges] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsDetectingBadEdges(false)
        }
    }

    async function onRepairInvertedNormals() {
        const client = invertedNormalsClientRef.current
        if (!selectedFile || isRepairingInverted || !client) return

        setIsRepairingInverted(true)
        setError('')
        setStatus('Loading STL…')

        try {
            const input = await fetchStlBuffer()
            setStatus('Repairing inverted normals (WASM)…')
            const startMs = performance.now()
            const result = await client.repair(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs

            setRepairedStl(result.output)
            setIsClosedMesh(result.isClosed)
            setIsInvertedNormals(result.wasInverted)
            setSignedVolume(result.signedVolumeAfter)
            setLocalInvertedCount(0)

            if (!result.isClosed) {
                setStatus(`Open mesh: no inversion repair applied (${elapsedMs.toFixed(0)} ms)`)
            } else if (result.wasInverted) {
                setStatus(`Inverted normals repaired (${elapsedMs.toFixed(0)} ms)`)
            } else {
                setStatus(`Mesh was already correctly oriented (${elapsedMs.toFixed(0)} ms)`)
            }
        } catch (e: any) {
            console.error('[RepairInvertedNormals] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsRepairingInverted(false)
        }
    }

    const isBusy =
        isFilling ||
        isDetecting ||
        isRepairing ||
        isCheckingInverted ||
        isRepairingInverted ||
        isDetectingOverlapping ||
        isDetectingBadEdges
    const showSideBySide = Boolean(repairedStl)
    const offsetX = 40

    return (
        <>
            <Navbar pageTitle="Basics" showBack />
            <FileSelector
                files={STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />
            {(status || error) && (
                <div className="ui-panel" style={{ top: '180px' }}>
                    {status && <div><strong>Status:</strong> {status}</div>}
                    {error && <div style={{ color: '#fca5a5' }}><strong>Error:</strong> {error}</div>}
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
                        <group position={[showSideBySide ? -offsetX : 0, 0, 0]}>
                            {showSideBySide && (
                                <Billboard position={[0, -30, 10]}>
                                    <Text
                                        fontSize={5}
                                        color="#ffffff"
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={0.3}
                                        outlineColor="#000000"
                                    >
                                        Original
                                    </Text>
                                </Billboard>
                            )}
                            <STLViewer filename={selectedFile} />
                            {intersectionSegments && intersectionSegments.length > 0 && (
                                <IntersectionLines
                                    segments={intersectionSegments}
                                    filename={selectedFile}
                                />
                            )}
                        </group>
                    )}
                    {repairedStl && (
                        <group position={[offsetX, 0, 0]}>
                            <Billboard position={[0, -30, 10]}>
                                <Text
                                    fontSize={5}
                                    color="#4ade80"
                                    anchorX="center"
                                    anchorY="bottom"
                                    outlineWidth={0.3}
                                    outlineColor="#000000"
                                >
                                    Repaired
                                </Text>
                            </Billboard>
                            <STLBufferViewer data={repairedStl} />
                        </group>
                    )}
                </Canvas>
            </CanvasContainer>

            {/* ---- Action buttons ---- */}
            <div style={{
                position: 'fixed',
                right: 16,
                bottom: 16,
                zIndex: 2000,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'flex-end',
            }}>
                {intersectionCount !== null && (
                    <span style={{
                        color: intersectionCount === 0 ? '#4ade80' : '#fbbf24',
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '4px 10px',
                        borderRadius: 8,
                    }}>
                        {intersectionCount === 0
                            ? '✓ No intersections'
                            : `⚠ ${intersectionCount} intersection(s)`}
                    </span>
                )}
                {holesFilledCount !== null && (
                    <span style={{
                        color: holesFilledCount > 0 ? '#fbbf24' : '#4ade80',
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '4px 10px',
                        borderRadius: 8,
                    }}>
                        {holesFilledCount > 0
                            ? `⚠ ${holesFilledCount} hole(s) were filled`
                            : '✓ No holes detected'}
                    </span>
                )}
                {isClosedMesh !== null && (
                    <span style={{
                        color:
                            localInvertedCount !== null && localInvertedCount > 0
                                ? '#fca5a5'
                                : (!isClosedMesh ? '#93c5fd' : (isInvertedNormals ? '#fca5a5' : '#4ade80')),
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '4px 10px',
                        borderRadius: 8,
                    }}>
                        {localInvertedCount !== null && localInvertedCount > 0
                            ? `⚠ ${localInvertedCount} locally inverted triangle(s)`
                            : (!isClosedMesh
                                ? 'ℹ Open mesh (no global orientation verdict)'
                                : (isInvertedNormals ? '⚠ Global orientation inverted' : '✓ Normals orientation OK'))}
                        {signedVolume !== null && isClosedMesh ? ` — vol=${signedVolume.toFixed(4)}` : ''}
                    </span>
                )}
                {overlappingCount !== null && (
                    <span style={{
                        color: overlappingCount === 0 ? '#4ade80' : '#fbbf24',
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '4px 10px',
                        borderRadius: 8,
                    }}>
                        {overlappingCount === 0
                            ? '✓ No overlapping triangles'
                            : `⚠ ${overlappingCount} overlapping triangle(s)`}
                    </span>
                )}
                {badEdgesCount !== null && (
                    <span style={{
                        color: badEdgesCount === 0 ? '#4ade80' : '#fbbf24',
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '4px 10px',
                        borderRadius: 8,
                    }}>
                        {badEdgesCount === 0
                            ? '✓ No bad edges'
                            : `⚠ ${badEdgesCount} bad edge(s), ${badContoursCount ?? 0} contour(s)`}
                    </span>
                )}
                <HelloButton
                    onClick={onDetectBadEdges}
                    disabled={!selectedFile || isBusy}
                    text={isDetectingBadEdges ? 'Detecting…' : 'Detect Bad Edges'}
                />
                <HelloButton
                    onClick={onDetectOverlappingTriangles}
                    disabled={!selectedFile || isBusy}
                    text={isDetectingOverlapping ? 'Detecting…' : 'Detect Overlapping Triangles'}
                />
                <HelloButton
                    onClick={onCheckInvertedNormals}
                    disabled={!selectedFile || isBusy}
                    text={isCheckingInverted ? 'Checking…' : 'Check Inverted Normals'}
                />
                <HelloButton
                    onClick={onRepairInvertedNormals}
                    disabled={!selectedFile || isBusy}
                    text={isRepairingInverted ? 'Repairing…' : 'Repair Inverted Normals'}
                />
                <HelloButton
                    onClick={onDetectIntersections}
                    disabled={!selectedFile || isBusy}
                    text={isDetecting ? 'Detecting…' : 'Detect Intersections'}
                />
                <HelloButton
                    onClick={onRepairIntersections}
                    disabled={!selectedFile || isBusy}
                    text={isRepairing ? 'Repairing…' : 'Repair Intersections'}
                />
                <HelloButton
                    onClick={onFillHoles}
                    disabled={!selectedFile || isBusy}
                    text={isFilling ? 'Filling…' : 'Fill Holes'}
                />
            </div>
        </>
    )
}

export default BasicsPage
