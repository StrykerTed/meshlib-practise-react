import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Billboard, Text } from '@react-three/drei'
import Navbar from './components/Navbar'
import HelloButton from './components/HelloButton'
import Scene from './components/Scene'
import STLViewer from './components/STLViewer'
import FileSelector from './components/FileSelector'
import STLBufferViewer from './components/STLBufferViewer'
import { FillHolesClient } from './lib/fillHolesClient'

// List of STL files available in /stl directory
const STL_FILES = [
    'baseplate_shoulder_holes.stl',
    'ball_with_missing_faces.stl',
    'icosphere_with_holes.stl',
]

function App() {
    const [selectedFile, setSelectedFile] = useState<string>(STL_FILES[0] ?? '')
    const [isFilling, setIsFilling] = useState(false)
    const [repairedStl, setRepairedStl] = useState<ArrayBuffer | null>(null)
    const [status, setStatus] = useState<string>('')
    const [error, setError] = useState<string>('')

    // Use useRef + useEffect so React 18 StrictMode's
    // unmount-remount cycle creates a fresh worker each time.
    const fillHolesClientRef = useRef<FillHolesClient | null>(null)

    useEffect(() => {
        const client = new FillHolesClient()
        fillHolesClientRef.current = client
        return () => {
            fillHolesClientRef.current = null
            client.dispose()
        }
    }, [])

    useEffect(() => {
        // Clear repaired result when switching source.
        setRepairedStl(null)
        setStatus('')
        setError('')
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
            if (!res.ok) {
                throw new Error(`Failed to fetch STL (${res.status}): ${stlUrl}`)
            }
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
            const msg = String(e?.message || e)
            console.error('[FillHoles] failed:', e)
            setError(msg)
            setStatus('')
        } finally {
            setIsFilling(false)
        }
    }

    const showSideBySide = Boolean(repairedStl)
    const offsetX = 40

    return (
        <>
            <Navbar />
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
            <div style={{
                position: 'absolute',
                top: '80px',
                left: 0,
                right: 0,
                bottom: 0,
                width: '100%',
                height: 'calc(100vh - 80px)',
            }}>
                <Canvas
                    camera={{
                        position: [120, -320, 100],
                        fov: 24,
                        near: 0.1,
                        far: 200000,
                    }}
                    shadows
                    gl={{
                        antialias: true,
                        alpha: false,
                    }}
                    style={{ width: '100%', height: '100%', background: '#ff00ff' }}
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
            </div>

            <HelloButton
                onClick={onFillHoles}
                disabled={!selectedFile || isFilling}
                text={isFilling ? 'Filling…' : 'Fill Holes'}
            />
        </>
    )
}

export default App
