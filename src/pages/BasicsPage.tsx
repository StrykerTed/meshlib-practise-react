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
import { CanvasContainer } from '../styles/CanvasContainer'

const STL_FILES = [
    'baseplate_shoulder_holes.stl',
    'ball_with_missing_faces.stl',
    'icosphere_with_holes.stl',
    'self-intersecting-3d.stl',
    'self-intersecting.stl',
]

function BasicsPage() {
    const [selectedFile, setSelectedFile] = useState<string>(STL_FILES[0] ?? '')
    const [isFilling, setIsFilling] = useState(false)
    const [repairedStl, setRepairedStl] = useState<ArrayBuffer | null>(null)
    const [status, setStatus] = useState<string>('')
    const [error, setError] = useState<string>('')

    const [isDetecting, setIsDetecting] = useState(false)
    const [isRepairing, setIsRepairing] = useState(false)
    const [intersectionCount, setIntersectionCount] = useState<number | null>(null)
    const [intersectionSegments, setIntersectionSegments] = useState<Float32Array | null>(null)

    const fillHolesClientRef = useRef<FillHolesClient | null>(null)
    const selfIntersectionsClientRef = useRef<SelfIntersectionsClient | null>(null)

    useEffect(() => {
        const client = new FillHolesClient()
        fillHolesClientRef.current = client
        const siClient = new SelfIntersectionsClient()
        selfIntersectionsClientRef.current = siClient
        return () => {
            fillHolesClientRef.current = null
            client.dispose()
            selfIntersectionsClientRef.current = null
            siClient.dispose()
        }
    }, [])

    useEffect(() => {
        setRepairedStl(null)
        setStatus('')
        setError('')
        setIntersectionCount(null)
        setIntersectionSegments(null)
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
            const output = await fillHolesClient.fillHoles(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setRepairedStl(output)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms`)
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

    const isBusy = isFilling || isDetecting || isRepairing
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
