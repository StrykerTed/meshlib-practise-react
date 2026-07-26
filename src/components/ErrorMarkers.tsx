import { useLoader } from '@react-three/fiber'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { ErrorMarker } from '../lib/repairPipelineClient'
import { ERROR_COLORS, type ErrorType } from '../constants/errorColors'

interface ErrorMarkersProps {
    markers: ErrorMarker[]
    /** Same filename STLViewer renders, so we replicate its transform for alignment. */
    filename: string
    /** Must match the STLViewer instance these overlay (RepairPage uses false/true). */
    autoScale?: boolean
    groundAlign?: boolean
}

/**
 * Draws one colored line per detected problem, starting at the error point and
 * pointing radially outward. Positions arrive in original STL coordinates; we
 * apply the same centre/scale/ground-align transform as STLViewer so the lines
 * register with the rendered mesh (same approach as IntersectionLines).
 */
function ErrorMarkers({ markers, filename, autoScale = false, groundAlign = true }: ErrorMarkersProps) {
    const geometry = useLoader(STLLoader, `/stl/${filename}`)

    const byType = useMemo(() => {
        const geo = geometry.clone()
        geo.computeBoundingBox()
        const bbox = geo.boundingBox!
        const center = new THREE.Vector3()
        bbox.getCenter(center)
        const size = new THREE.Vector3()
        bbox.getSize(size)
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = autoScale && maxDim > 0 ? 50 / maxDim : 1
        const zOffset = groundAlign ? -((bbox.min.z - center.z) * scale) : 0
        const lineLen = size.length() * 0.08 // ~8% of bbox diagonal (original units)

        // Group endpoints by error type → one lineSegments per color.
        const groups = new Map<ErrorType, number[]>()
        for (const m of markers) {
            const sx = (m.x - center.x) * scale
            const sy = (m.y - center.y) * scale
            const sz = (m.z - center.z) * scale + zOffset
            const ex = sx + m.dx * lineLen * scale
            const ey = sy + m.dy * lineLen * scale
            const ez = sz + m.dz * lineLen * scale
            const arr = groups.get(m.type) ?? []
            arr.push(sx, sy, sz, ex, ey, ez)
            groups.set(m.type, arr)
        }

        return Array.from(groups.entries()).map(([type, positions]) => {
            const g = new THREE.BufferGeometry()
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
            return { type, geometry: g }
        })
    }, [geometry, markers, autoScale, groundAlign])

    return (
        <group>
            {byType.map(({ type, geometry: g }) => (
                <lineSegments key={type} geometry={g} renderOrder={2}>
                    <lineBasicMaterial
                        color={ERROR_COLORS[type]}
                        linewidth={2}
                        depthTest={false}
                        transparent
                        opacity={0.95}
                    />
                </lineSegments>
            ))}
        </group>
    )
}

export default ErrorMarkers
