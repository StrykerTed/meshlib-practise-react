import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

function Scene() {
    const { scene, camera, gl } = useThree()

    useEffect(() => {
        // Set Z-up coordinate system 
        THREE.Object3D.DEFAULT_UP.set(0, 0, 1)

        // Set camera up vector for Z-up
        camera.up.set(0, 0, 1)
        camera.lookAt(0, 0, 0)
        camera.updateProjectionMatrix()

        gl.setClearColor(0x000000, 1)

        console.log('Camera position:', camera.position)
        console.log('Camera up:', camera.up)
    }, [camera, gl])

    const grid = useMemo(() => {
        const floorSize = 210
        const gridDivisions = 21
        const gridHelper = new THREE.GridHelper(
            floorSize,
            gridDivisions,
            0x475569, // colorCenterLine
            0x1f2937  // colorGrid
        )
        // Rotate to Z-up orientation
        gridHelper.rotation.x = Math.PI / 2
        gridHelper.position.z = 0
        return gridHelper
    }, [])

    useEffect(() => {
        scene.add(grid)
        return () => {
            scene.remove(grid)
        }
    }, [scene, grid])

    return (
        <>
            <ambientLight color={0xffffff} intensity={0.8} />
            <directionalLight
                color={0xffffff}
                position={[50, -50, 100]}
                intensity={1.5}
                castShadow
                shadow-mapSize={[2048, 2048]}
                shadow-camera-near={0.1}
                shadow-camera-far={500}
                shadow-camera-left={-250}
                shadow-camera-right={250}
                shadow-camera-top={250}
                shadow-camera-bottom={-250}
                shadow-bias={-0.0005}
                shadow-normalBias={0.05}
            />

            <directionalLight
                color={0xffffff}
                position={[-30, 40, 60]}
                intensity={0.2}
            />

            <directionalLight
                color={0xccddff}
                position={[0, 50, -80]}
                intensity={0.35}
            />

            <mesh rotation={[0, 0, 0]} position={[0, 0, -0.04]} receiveShadow>
                <planeGeometry args={[210, 210]} />
                <meshStandardMaterial color="#111827" roughness={1} />
            </mesh>

            <OrbitControls
                enableDamping={true}
                target={[0, 0, 15]}
                maxDistance={900}
                zoomSpeed={.16}
            />
        </>
    )
}

export default Scene
