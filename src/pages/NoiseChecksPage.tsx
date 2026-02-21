import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Billboard, Text } from '@react-three/drei'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import FileSelector from '../components/FileSelector'
import STLBufferViewer from '../components/STLBufferViewer'
import { NoiseShellsClient, type ComponentInfo } from '../lib/noiseShellsClient'
import { CanvasContainer } from '../styles/CanvasContainer'

const STL_FILES = [
    'test_noise.stl',
    'goat_statue_scan.stl',
]

function NoiseChecksPage() {
    const [selectedFile, setSelectedFile] = useState<string>(STL_FILES[0] ?? '')
    const [repairedStl, setRepairedStl] = useState<ArrayBuffer | null>(null)
    const [status, setStatus] = useState<string>('')
    const [error, setError] = useState<string>('')

    const [isDetecting, setIsDetecting] = useState(false)
    const [isRepairing, setIsRepairing] = useState(false)
    const [totalComponents, setTotalComponents] = useState<number | null>(null)
    const [noiseCount, setNoiseCount] = useState<number | null>(null)
    const [components, setComponents] = useState<ComponentInfo[] | null>(null)

    const noiseShellsClientRef = useRef<NoiseShellsClient | null>(null)

    useEffect(() => {
        const client = new NoiseShellsClient()
        noiseShellsClientRef.current = client
        return () => {
            noiseShellsClientRef.current = null
            client.dispose()
        }
    }, [])

    useEffect(() => {
        setRepairedStl(null)
        setStatus('')
        setError('')
        setTotalComponents(null)
        setNoiseCount(null)
        setComponents(null)
    }, [selectedFile])

    async function fetchStlBuffer(): Promise<ArrayBuffer> {
        const stlUrl = `/stl/${selectedFile}`
        const res = await fetch(stlUrl)
        if (!res.ok) throw new Error(`Failed to fetch STL (${res.status}): ${stlUrl}`)
        return res.arrayBuffer()
    }

    async function onDetectNoiseShells() {
        const client = noiseShellsClientRef.current
        if (!selectedFile || isDetecting || !client) return

        setIsDetecting(true)
        setError('')
        setStatus('Loading STL…')
        setTotalComponents(null)
        setNoiseCount(null)
        setComponents(null)
        try {
            const input = await fetchStlBuffer()
            setStatus('Detecting noise shells (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setTotalComponents(result.totalComponents)
            setNoiseCount(result.noiseCount)
            setComponents(result.components)
            setStatus(
                result.noiseCount === 0
                    ? `No noise shells found — mesh has 1 component (${elapsedMs.toFixed(0)} ms)`
                    : `Found ${result.noiseCount} noise shell(s) out of ${result.totalComponents} component(s) in ${elapsedMs.toFixed(0)} ms`,
            )
        } catch (e: any) {
            console.error('[DetectNoiseShells] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsDetecting(false)
        }
    }

    async function onRepairNoiseShells() {
        const client = noiseShellsClientRef.current
        if (!selectedFile || isRepairing || !client) return

        setIsRepairing(true)
        setError('')
        setStatus('Loading STL…')
        try {
            const input = await fetchStlBuffer()
            setStatus('Removing noise shells (WASM)…')
            const startMs = performance.now()
            const result = await client.repair(input, {
                onStatus: (stage) => setStatus(stage),
                areaRatioThreshold: 1.0,
            })
            const elapsedMs = performance.now() - startMs
            setRepairedStl(result.output)
            setStatus(
                `Repair done in ${elapsedMs.toFixed(0)} ms — removed ${result.removedComponents} component(s)`,
            )
        } catch (e: any) {
            console.error('[RepairNoiseShells] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsRepairing(false)
        }
    }

    const isBusy = isDetecting || isRepairing
    const showSideBySide = Boolean(repairedStl)
    const offsetX = 40

    return (
        <>
            <Navbar pageTitle="Noise Checks" showBack />
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
                            <STLViewer filename={selectedFile} doubleSided autoScale={false} groundAlign={true} />
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
                            <STLBufferViewer data={repairedStl} doubleSided autoScale={false} groundAlign={true} />
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
                {noiseCount !== null && (
                    <span style={{
                        color: noiseCount === 0 ? '#4ade80' : '#fbbf24',
                        fontSize: 13,
                        fontWeight: 600,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '4px 10px',
                        borderRadius: 8,
                    }}>
                        {noiseCount === 0
                            ? '✓ No noise shells'
                            : `⚠ ${noiseCount} noise shell(s) / ${totalComponents} component(s)`}
                    </span>
                )}
                {components && components.length > 0 && (
                    <div style={{
                        fontSize: 11,
                        color: '#94a3b8',
                        background: 'rgba(15,23,42,0.85)',
                        padding: '6px 10px',
                        borderRadius: 8,
                        maxHeight: 120,
                        overflowY: 'auto',
                    }}>
                        {components.map((c, i) => (
                            <div key={i}>
                                {i === 0 ? '▶ Main' : `  #${i}`}: area={c.area.toFixed(1)} faces={c.faceCount} verts={c.vertexCount}
                            </div>
                        ))}
                    </div>
                )}
                <HelloButton
                    onClick={onDetectNoiseShells}
                    disabled={!selectedFile || isBusy}
                    text={isDetecting ? 'Detecting…' : 'Noise Checks'}
                />
                <HelloButton
                    onClick={onRepairNoiseShells}
                    disabled={!selectedFile || isBusy}
                    text={isRepairing ? 'Repairing…' : 'Noise Repair'}
                />
            </div>
        </>
    )
}

export default NoiseChecksPage
