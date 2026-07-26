import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Billboard, Text } from '@react-three/drei'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import FileSelector from '../components/FileSelector'
import STLBufferViewer from '../components/STLBufferViewer'
import ErrorMarkers from '../components/ErrorMarkers'
import { RepairPipelineClient, type MeshReport, type ErrorMarker } from '../lib/repairPipelineClient'
import { CanvasContainer } from '../styles/CanvasContainer'
import { ERROR_COLORS, ERROR_LABELS, METRIC_COLOR, type ErrorType } from '../constants/errorColors'

const STL_FILES = [
    'Michaels_Calibration_Matrix.stl',
    'icosphere_with_holes.stl',
    'ball_with_missing_faces.stl',
    'ball_with_missing_faces_inverted_normal.stl',
    'not-watertight-face.stl',
    'test_noise.stl',
]

// Rows for the before/after report table. `good` decides the colour of the
// after-value (green = improved/clean, amber = residual).
const ROWS: { key: keyof MeshReport; label: string; cleanIsZero?: boolean; cleanIsTrue?: boolean }[] = [
    { key: 'componentCount', label: 'Components' },
    { key: 'holeCount', label: 'Holes', cleanIsZero: true },
    { key: 'boundaryEdgeCount', label: 'Boundary edges', cleanIsZero: true },
    { key: 'nonManifoldEdgeCount', label: 'Non-manifold edges', cleanIsZero: true },
    { key: 'invertedComponentCount', label: 'Inverted components', cleanIsZero: true },
    { key: 'indeterminateComponentCount', label: 'Open (indeterminate) comps', cleanIsZero: true },
    { key: 'degenerateFaceCount', label: 'Degenerate faces' },
    { key: 'duplicateFaceCount', label: 'Duplicate faces' },
    { key: 'isWatertight', label: 'Watertight', cleanIsTrue: true },
    { key: 'isManifold', label: 'Manifold', cleanIsTrue: true },
]

function fmt(v: number | boolean): string {
    return typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)
}

function RepairPage() {
    const [selectedFile, setSelectedFile] = useState<string>(STL_FILES[0] ?? '')
    const [denoise, setDenoise] = useState<boolean>(true)
    const [repairedStl, setRepairedStl] = useState<ArrayBuffer | null>(null)
    const [before, setBefore] = useState<MeshReport | null>(null)
    const [after, setAfter] = useState<MeshReport | null>(null)
    const [status, setStatus] = useState<string>('')
    const [error, setError] = useState<string>('')
    const [isRepairing, setIsRepairing] = useState(false)

    const [markers, setMarkers] = useState<ErrorMarker[] | null>(null)
    const [includeSelfInt, setIncludeSelfInt] = useState<boolean>(false)
    const [isLocating, setIsLocating] = useState(false)

    const clientRef = useRef<RepairPipelineClient | null>(null)

    useEffect(() => {
        const client = new RepairPipelineClient()
        clientRef.current = client
        return () => {
            clientRef.current = null
            client.dispose()
        }
    }, [])

    useEffect(() => {
        setRepairedStl(null)
        setBefore(null)
        setAfter(null)
        setStatus('')
        setError('')
        setMarkers(null)
    }, [selectedFile])

    async function fetchStlBuffer(): Promise<ArrayBuffer> {
        const stlUrl = `/stl/${selectedFile}`
        const res = await fetch(stlUrl)
        if (!res.ok) throw new Error(`Failed to fetch STL (${res.status}): ${stlUrl}`)
        return res.arrayBuffer()
    }

    async function onRepair() {
        const client = clientRef.current
        if (!selectedFile || isRepairing || !client) return
        setIsRepairing(true)
        setError('')
        setStatus('Loading STL…')
        setRepairedStl(null)
        setBefore(null)
        setAfter(null)
        try {
            const input = await fetchStlBuffer()
            const startMs = performance.now()
            const result = await client.repair(input, {
                componentAreaRatioThreshold: denoise ? 1.0 : 0.0,
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setRepairedStl(result.output)
            setBefore(result.before)
            setAfter(result.after)
            setStatus(
                `Repair done in ${elapsedMs.toFixed(0)} ms — ` +
                (result.after.isWatertight ? 'watertight ✓' : 'not watertight') +
                `, ${result.after.holeCount} hole(s), ${result.after.invertedComponentCount} inverted component(s)`,
            )
        } catch (e: any) {
            console.error('[Repair] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsRepairing(false)
        }
    }

    async function onShowErrors() {
        const client = clientRef.current
        if (!selectedFile || isLocating || !client) return
        setIsLocating(true)
        setError('')
        setMarkers(null)
        setStatus(includeSelfInt ? 'Locating errors (incl. self-intersections, slow)…' : 'Locating errors…')
        try {
            const input = await fetchStlBuffer()
            const startMs = performance.now()
            const found = await client.locateErrors(input, {
                includeSelfIntersections: includeSelfInt,
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setMarkers(found)
            setStatus(
                found.length === 0
                    ? `No errors found (${elapsedMs.toFixed(0)} ms)`
                    : `Found ${found.length} error marker(s) in ${elapsedMs.toFixed(0)} ms`,
            )
        } catch (e: any) {
            console.error('[ShowErrors] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsLocating(false)
        }
    }

    // Per-type marker counts for the legend.
    const markerCounts = useMemo(() => {
        const counts: Record<number, number> = {}
        for (const m of markers ?? []) counts[m.type] = (counts[m.type] ?? 0) + 1
        return counts
    }, [markers])

    const showSideBySide = Boolean(repairedStl)
    const offsetX = 40
    const isBusy = isRepairing || isLocating

    return (
        <>
            <Navbar pageTitle="Repair Pipeline" showBack />
            <FileSelector
                files={STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />
            {(status || error) && (
                <div className="ui-panel" style={{ top: '180px' }}>
                    {status && <div><strong>Status:</strong> {status}</div>}
                    {error && <div style={{ color: '#fca5a5' }}><strong>Error:</strong> {error}</div>}
                </div>
            )}

            {/* ---- Before / after report ---- */}
            {before && after && (
                <div className="ui-panel" style={{ top: '240px', maxWidth: 320 }}>
                    <table style={{ fontSize: 12, borderCollapse: 'collapse', width: '100%' }}>
                        <thead>
                            <tr style={{ color: '#94a3b8' }}>
                                <th style={{ textAlign: 'left', paddingRight: 10 }}>Metric</th>
                                <th style={{ textAlign: 'right', paddingRight: 10 }}>Before</th>
                                <th style={{ textAlign: 'right' }}>After</th>
                            </tr>
                        </thead>
                        <tbody>
                            {ROWS.map((row) => {
                                const bv = before[row.key]
                                const av = after[row.key]
                                let good = false
                                if (row.cleanIsZero) good = av === 0
                                else if (row.cleanIsTrue) good = av === true
                                else good = true // neutral metric (e.g. component count)
                                const swatch = METRIC_COLOR[row.key as string]
                                return (
                                    <tr key={String(row.key)}>
                                        <td style={{ paddingRight: 10 }}>
                                            {swatch && (
                                                <span style={{
                                                    display: 'inline-block', width: 8, height: 8, borderRadius: 2,
                                                    background: swatch, marginRight: 6, verticalAlign: 'middle',
                                                }} />
                                            )}
                                            {row.label}
                                        </td>
                                        <td style={{ textAlign: 'right', paddingRight: 10, color: '#94a3b8' }}>{fmt(bv)}</td>
                                        <td style={{ textAlign: 'right', color: good ? '#4ade80' : '#fbbf24', fontWeight: 600 }}>{fmt(av)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            <CanvasContainer>
                <Canvas
                    camera={{ position: [120, -320, 100], fov: 24, near: 0.1, far: 200000 }}
                    shadows
                    gl={{ antialias: true, alpha: false }}
                    style={{ width: '100%', height: '100%', background: '#0a0a0a' }}
                >
                    <Scene />
                    {selectedFile && (
                        <group position={[showSideBySide ? -offsetX : 0, 0, 0]}>
                            {showSideBySide && (
                                <Billboard position={[0, -30, 10]}>
                                    <Text fontSize={5} color="#ffffff" anchorX="center" anchorY="bottom" outlineWidth={0.3} outlineColor="#000000">
                                        Original
                                    </Text>
                                </Billboard>
                            )}
                            <STLViewer filename={selectedFile} doubleSided autoScale={false} groundAlign={true} />
                            {markers && markers.length > 0 && (
                                <ErrorMarkers markers={markers} filename={selectedFile} autoScale={false} groundAlign={true} />
                            )}
                        </group>
                    )}
                    {repairedStl && (
                        <group position={[offsetX, 0, 0]}>
                            <Billboard position={[0, -30, 10]}>
                                <Text fontSize={5} color="#4ade80" anchorX="center" anchorY="bottom" outlineWidth={0.3} outlineColor="#000000">
                                    Repaired
                                </Text>
                            </Billboard>
                            <STLBufferViewer data={repairedStl} doubleSided autoScale={false} groundAlign={true} />
                        </group>
                    )}
                </Canvas>
            </CanvasContainer>

            {/* ---- Action controls ---- */}
            <div style={{
                position: 'fixed', right: 16, bottom: 16, zIndex: 2000,
                display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end',
            }}>
                {/* Error legend (per-type counts), shown after Show Errors */}
                {markers && markers.length > 0 && (
                    <div style={{
                        fontSize: 12, color: '#cbd5e1', background: 'rgba(15,23,42,0.85)',
                        padding: '6px 10px', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 3,
                    }}>
                        {([1, 2, 3, 4] as ErrorType[])
                            .filter((t) => (markerCounts[t] ?? 0) > 0)
                            .map((t) => (
                                <div key={t} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <span style={{ width: 10, height: 10, borderRadius: 2, background: ERROR_COLORS[t] }} />
                                    {ERROR_LABELS[t]}: {markerCounts[t]}
                                </div>
                            ))}
                    </div>
                )}
                <label style={{
                    fontSize: 12, color: '#cbd5e1', background: 'rgba(15,23,42,0.85)',
                    padding: '4px 10px', borderRadius: 8, display: 'flex', gap: 6, alignItems: 'center',
                }}>
                    <input type="checkbox" checked={denoise} onChange={(e) => setDenoise(e.target.checked)} />
                    Remove noise shells (keep largest body)
                </label>
                <label style={{
                    fontSize: 12, color: '#cbd5e1', background: 'rgba(15,23,42,0.85)',
                    padding: '4px 10px', borderRadius: 8, display: 'flex', gap: 6, alignItems: 'center',
                }}>
                    <input type="checkbox" checked={includeSelfInt} onChange={(e) => setIncludeSelfInt(e.target.checked)} />
                    Include self-intersections (slow)
                </label>
                <HelloButton
                    onClick={onShowErrors}
                    disabled={!selectedFile || isBusy}
                    text={isLocating ? 'Locating…' : 'Show Errors'}
                />
                <HelloButton
                    onClick={onRepair}
                    disabled={!selectedFile || isBusy}
                    text={isRepairing ? 'Repairing…' : 'Repair Mesh'}
                />
            </div>
        </>
    )
}

export default RepairPage
