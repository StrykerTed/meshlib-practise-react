import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import Navbar from '../components/Navbar'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import FileSelector from '../components/FileSelector'
import { CanvasContainer } from '../styles/CanvasContainer'

const COMPLEX_STL_FILES = [
    'complex/Duck_mesh.stl',
    'complex/UNICORN_mesh_NoTexture.stl',
    'complex/Warrior with Hammer pose 2_28mm_supported.stl',
]

function SimplificationPage() {
    const [selectedFile, setSelectedFile] = useState<string>(COMPLEX_STL_FILES[0] ?? '')

    return (
        <>
            <Navbar pageTitle="Simplification" showBack />
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
                    {selectedFile && <STLViewer filename={selectedFile} />}
                </Canvas>
            </CanvasContainer>
        </>
    )
}

export default SimplificationPage
