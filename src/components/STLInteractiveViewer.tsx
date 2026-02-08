/**
 * STLInteractiveViewer – loads an STL file and supports face-level interaction.
 *
 * Features:
 *   • Raycasting on click → returns faceIndex + intersection point
 *   • Face-level coloring for highlighted patches
 *   • Landmark spheres rendered at user-placed positions
 *   • Contour lines rendered as LineLoop
 *
 * The geometry is NON-INDEXED (standard STL Loader output) so that each
 * triangle's three vertices can be coloured independently, enabling per-face
 * highlighting.
 */
import { useLoader, ThreeEvent } from '@react-three/fiber'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { Line } from '@react-three/drei'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FaceClickInfo {
    /** Index of the triangle that was clicked */
    faceIndex: number
    /** Intersection point in LOCAL (model) coordinates */
    point: THREE.Vector3
    /** Intersection point in WORLD coordinates */
    worldPoint: THREE.Vector3
}

export interface ContourData {
    /** Flat array of [x,y,z, x,y,z, …] positions for one contour (model coords) */
    points: Float32Array
    /** Whether to close the loop */
    closed: boolean
}

interface STLInteractiveViewerProps {
    filename: string
    /** Set of face indices to highlight */
    highlightedFaces?: Set<number>
    /** Colour used for highlighted faces (CSS hex) */
    highlightColor?: string
    /** Array of 3D positions (model coords) to render as landmark spheres */
    landmarks?: THREE.Vector3[]
    /** Boundary contour lines */
    contours?: ContourData[]
    /** Called when a face is clicked */
    onFaceClick?: (info: FaceClickInfo) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function STLInteractiveViewer({
    filename,
    highlightedFaces,
    highlightColor = '#ef4444',
    landmarks,
    contours,
    onFaceClick,
}: STLInteractiveViewerProps) {
    const rawGeometry = useLoader(STLLoader, `/stl/${filename}`)
    const meshRef = useRef<THREE.Mesh>(null)

    // ---- process geometry (center, scale, sit on Z=0) ----------------------
    const processedGeometry = useMemo(() => {
        const geo = rawGeometry.clone()
        geo.computeVertexNormals()
        geo.center()

        geo.computeBoundingBox()
        const bbox = geo.boundingBox!
        const size = new THREE.Vector3()
        bbox.getSize(size)
        const maxDim = Math.max(size.x, size.y, size.z)
        const scale = maxDim > 0 ? 50 / maxDim : 1
        geo.scale(scale, scale, scale)

        geo.computeBoundingBox()
        const bbox2 = geo.boundingBox!
        const tz = -bbox2.min.z
        geo.translate(0, 0, tz)

        // Initialize per-face colour attribute (all default blue)
        const posAttr = geo.getAttribute('position')
        const colors = new Float32Array(posAttr.count * 3)
        const defaultColor = new THREE.Color('#3b82f6')
        for (let i = 0; i < posAttr.count; i++) {
            colors[i * 3] = defaultColor.r
            colors[i * 3 + 1] = defaultColor.g
            colors[i * 3 + 2] = defaultColor.b
        }
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))

        return geo
    }, [rawGeometry])

    // ---- update face colours when highlightedFaces changes ------------------
    useEffect(() => {
        const colorAttr = processedGeometry.getAttribute('color') as THREE.BufferAttribute
        if (!colorAttr) return

        const defaultColor = new THREE.Color('#3b82f6')
        const hlColor = new THREE.Color(highlightColor)
        const arr = colorAttr.array as Float32Array
        const faceCount = colorAttr.count / 3

        for (let f = 0; f < faceCount; f++) {
            const c = highlightedFaces?.has(f) ? hlColor : defaultColor
            for (let v = 0; v < 3; v++) {
                const idx = (f * 3 + v) * 3
                arr[idx] = c.r
                arr[idx + 1] = c.g
                arr[idx + 2] = c.b
            }
        }
        colorAttr.needsUpdate = true
    }, [processedGeometry, highlightedFaces, highlightColor])

    // ---- click handler with raycasting ------------------------------------
    const handleClick = useCallback(
        (e: ThreeEvent<MouseEvent>) => {
            if (!onFaceClick) return
            e.stopPropagation()

            // e.faceIndex is the triangle index from the raycaster
            const faceIndex = e.faceIndex
            if (faceIndex === undefined) return

            // Local-space point
            const localPoint = e.point.clone()
            if (meshRef.current) {
                meshRef.current.worldToLocal(localPoint)
            }

            onFaceClick({
                faceIndex,
                point: localPoint,
                worldPoint: e.point.clone(),
            })
        },
        [onFaceClick],
    )

    // ---- contour line geometries (memoised) --------------------------------
    const contourLines = useMemo(() => {
        if (!contours || contours.length === 0) return null

        return contours.map((c, ci) => {
            const pts: [number, number, number][] = []
            for (let i = 0; i < c.points.length; i += 3) {
                pts.push([c.points[i], c.points[i + 1], c.points[i + 2]])
            }
            if (c.closed && pts.length > 0) {
                pts.push([...pts[0]]) // close the loop
            }
            return { key: ci, points: pts }
        })
    }, [contours])

    return (
        <group>
            {/* Main mesh with vertex colours */}
            <mesh
                ref={meshRef}
                geometry={processedGeometry}
                castShadow
                receiveShadow
                onClick={handleClick}
            >
                <meshPhysicalMaterial
                    vertexColors
                    roughness={0.45}
                    metalness={0.05}
                    clearcoat={0.15}
                    clearcoatRoughness={0.4}
                    flatShading
                    side={THREE.FrontSide}
                />
            </mesh>

            {/* Landmark spheres */}
            {landmarks?.map((pos, i) => (
                <mesh key={`lm-${i}`} position={pos}>
                    <sphereGeometry args={[0.3, 16, 16]} />
                    <meshStandardMaterial color="#3b82f6" emissive="#3b82f6" emissiveIntensity={0.6} />
                </mesh>
            ))}

            {/* Contour lines */}
            {contourLines?.map((cl) => (
                <Line
                    key={`contour-${cl.key}`}
                    points={cl.points}
                    color="#f97316"
                    lineWidth={2.5}
                />
            ))}
        </group>
    )
}

export default STLInteractiveViewer
