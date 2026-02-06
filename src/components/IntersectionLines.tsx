import { useLoader } from '@react-three/fiber'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { useMemo } from 'react'
import * as THREE from 'three'

interface IntersectionLinesProps {
    /** Flat Float32Array: [sx,sy,sz, ex,ey,ez, ...] — 6 floats per segment. */
    segments: Float32Array
    /** The same filename used by STLViewer so we can replicate its transform. */
    filename: string
}

/**
 * Renders intersection line segments overlaid on the STL mesh.
 *
 * Because STLViewer centres and scales the geometry, we need to apply the
 * exact same transform to the intersection points so they align.  We
 * re-load the same STL (cached by Three/useLoader), compute the same
 * centre + scale values, then apply them to the raw segment coordinates.
 */
function IntersectionLines({ segments, filename }: IntersectionLinesProps) {
    const geometry = useLoader(STLLoader, `/stl/${filename}`)

    const lineGeometry = useMemo(() => {
        // Replicate the same transform pipeline as STLViewer.
        const geo = geometry.clone()
        geo.computeBoundingBox()

        // 1. Centre offset — geo.center() translates by -centroid
        const bbox = geo.boundingBox!
        const center = new THREE.Vector3()
        bbox.getCenter(center)

        // 2. Scale factor — same logic as STLViewer
        const size = new THREE.Vector3()
        bbox.getSize(size)
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = maxDim > 0 ? 50 / maxDim : 1

        // 3. After centering + scaling, STLViewer translates Z so min-Z = 0.
        //    Compute that offset by applying the transform to the original bbox.
        const scaledMinZ = (bbox.min.z - center.z) * scale
        const zOffset = -scaledMinZ

        // Build a Float32Array of transformed positions (pairs of points).
        const count = segments.length / 6
        const positions = new Float32Array(count * 6) // same layout

        for (let i = 0; i < count; i++) {
            const base = i * 6
            // start point
            positions[base + 0] = (segments[base + 0]! - center.x) * scale
            positions[base + 1] = (segments[base + 1]! - center.y) * scale
            positions[base + 2] = (segments[base + 2]! - center.z) * scale + zOffset
            // end point
            positions[base + 3] = (segments[base + 3]! - center.x) * scale
            positions[base + 4] = (segments[base + 4]! - center.y) * scale
            positions[base + 5] = (segments[base + 5]! - center.z) * scale + zOffset
        }

        const bufGeo = new THREE.BufferGeometry()
        bufGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        return bufGeo
    }, [geometry, segments])

    return (
        <lineSegments geometry={lineGeometry} renderOrder={1}>
            <lineBasicMaterial
                color="#ff2222"
                linewidth={2}
                depthTest={false}
                transparent
                opacity={0.9}
            />
        </lineSegments>
    )
}

export default IntersectionLines
