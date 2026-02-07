import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import Navbar from '../components/Navbar'
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

function AnnotationsPage() {
    const [selectedFile, setSelectedFile] = useState<string>(COMPLEX_STL_FILES[0] ?? '')

    return (
        <>
            <Navbar pageTitle="Annotations" showBack />
            <FileSelector
                files={COMPLEX_STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />

            {/* Informational panel */}
            <div className="ui-panel" style={{ top: '180px', maxWidth: 420 }}>
                <p style={{ margin: 0, color: '#e2e8f0', fontSize: 13, lineHeight: 1.6 }}>
                    Annotations are defined on a mesh surface using barycentric coordinates,
                    so they survive topology-preserving deformations. Types include{' '}
                    <strong style={{ color: '#38bdf8' }}>patches</strong>,{' '}
                    <strong style={{ color: '#a78bfa' }}>landmarks</strong>, and{' '}
                    <strong style={{ color: '#22c55e' }}>contours</strong>.
                </p>
                <p style={{ margin: '8px 0 0', color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                    WASM annotation tools will be wired in a future update.
                </p>
            </div>

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
        </>
    )
}

export default AnnotationsPage
