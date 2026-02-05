import { Canvas } from '@react-three/fiber'
import { useState } from 'react'
import Navbar from './components/Navbar'
import Scene from './components/Scene'
import STLViewer from './components/STLViewer'
import FileSelector from './components/FileSelector'

// List of STL files available in /stl directory
const STL_FILES = [
    'ball_with_missing_faces.stl',
    'icosphere_with_holes.stl',
]

function App() {
    const [selectedFile, setSelectedFile] = useState<string>(STL_FILES[0] ?? '')

    return (
        <>
            <Navbar />
            <FileSelector
                files={STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />
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
                        position: [-20, -320, 100],
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
                    {selectedFile && <STLViewer filename={selectedFile} />}
                </Canvas>
            </div>
        </>
    )
}

export default App
