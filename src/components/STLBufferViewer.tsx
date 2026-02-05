import { useMemo } from 'react'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import * as THREE from 'three'

interface STLBufferViewerProps {
    data: ArrayBuffer
    color?: string
}

function processGeometry(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
    const geo = geometry.clone()
    geo.computeVertexNormals()
    geo.center()

    geo.computeBoundingBox()
    const bbox = geo.boundingBox
    if (bbox) {
        const size = new THREE.Vector3()
        bbox.getSize(size)
        const maxDim = Math.max(size.x, size.y, size.z)

        if (maxDim > 0) {
            const scale = 50 / maxDim
            geo.scale(scale, scale, scale)
        }

        geo.computeBoundingBox()
        const bbox2 = geo.boundingBox
        if (bbox2) {
            geo.translate(0, 0, -bbox2.min.z)
        }
    }

    return geo
}

function STLBufferViewer({ data, color = '#22c55e' }: STLBufferViewerProps) {
    const geometry = useMemo(() => {
        const loader = new STLLoader()
        const parsed = loader.parse(data) as THREE.BufferGeometry
        return processGeometry(parsed)
    }, [data])

    return (
        <mesh geometry={geometry} castShadow receiveShadow>
            <meshStandardMaterial
                color={color}
                roughness={0.5}
                metalness={0.1}
                side={THREE.DoubleSide}
            />
        </mesh>
    )
}

export default STLBufferViewer
