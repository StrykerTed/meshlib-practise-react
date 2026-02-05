import { useLoader } from '@react-three/fiber'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'

interface STLViewerProps {
    filename: string
}

function STLViewer({ filename }: STLViewerProps) {
    const geometry = useLoader(STLLoader, `/stl/${filename}`)

    // Center and scale the geometry
    const processedGeometry = useMemo(() => {
        const geo = geometry.clone()
        geo.computeVertexNormals()
        geo.center()

        // Get bounding box to determine scale
        geo.computeBoundingBox()
        const bbox = geo.boundingBox
        if (bbox) {
            const size = new THREE.Vector3()
            bbox.getSize(size)
            const maxDim = Math.max(size.x, size.y, size.z)

            // Scale to reasonable size (e.g., 50 units max dimension)
            if (maxDim > 0) {
                const scale = 50 / maxDim
                geo.scale(scale, scale, scale)
            }

            // After scaling, recompute bounds and move the model up so it sits on Z=0.
            // (Keep X/Y centered from geo.center(), but ensure it doesn't go below the floor.)
            geo.computeBoundingBox()
            const bbox2 = geo.boundingBox
            if (bbox2) {
                geo.translate(0, 0, -bbox2.min.z)
            }
        }

        return geo
    }, [geometry])

    return (
        <mesh geometry={processedGeometry} castShadow receiveShadow>
            <meshStandardMaterial
                color="#3b82f6"
                roughness={0.5}
                metalness={0.1}
                side={THREE.DoubleSide}
            />
        </mesh>
    )
}

export default STLViewer
