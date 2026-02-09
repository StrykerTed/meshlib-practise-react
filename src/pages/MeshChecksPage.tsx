import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import FileSelector from '../components/FileSelector'
import { CanvasContainer } from '../styles/CanvasContainer'

const COMPLEX_STL_FILES = [
    'complex/bony_penvis_mri.stl',
    'complex/Duck_mesh.stl',
    'complex/UNICORN_mesh_NoTexture.stl',
    'complex/Warrior with Hammer pose 2_28mm_supported.stl',
]

function MeshChecksPage() {
    const [selectedFile, setSelectedFile] = useState<string>(COMPLEX_STL_FILES[0] ?? '')

    function onRunChecks() {
        alert('Hello World')
    }

    return (
        <>
            <Navbar pageTitle="Mesh Checks" showBack />
            <FileSelector
                files={COMPLEX_STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />

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
                            <STLViewer filename={selectedFile} />
                        </group>
                    )}
                </Canvas>
            </CanvasContainer>

            {/* ---- Controls (bottom‑right) ---- */}
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
                <HelloButton
                    onClick={onRunChecks}
                    disabled={!selectedFile}
                    text="Run Checks"
                />
            </div>
        </>
    )
}

export default MeshChecksPage
