import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Billboard, Text } from '@react-three/drei'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import STLBufferViewer from '../components/STLBufferViewer'
import FileSelector from '../components/FileSelector'
import { SimplificationClient } from '../lib/simplificationClient'
import { CanvasContainer } from '../styles/CanvasContainer'

const COMPLEX_STL_FILES = [
    'complex/bony_penvis_mri.stl',
    'complex/Duck_mesh.stl',
    'complex/UNICORN_mesh_NoTexture.stl',
    'complex/Warrior with Hammer pose 2_28mm_supported.stl',
]

/** Palette for successive simplification results */
const RESULT_COLORS = [
    '#22c55e', // green
    '#f59e0b', // amber
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#a78bfa', // violet
    '#f97316', // orange
    '#14b8a6', // teal
    '#e879f9', // fuchsia
]

interface SimplifiedResult {
    /** Simplified STL binary */
    data: ArrayBuffer
    /** Ratio that was requested (0–1) */
    ratio: number
    /** Faces in input mesh */
    inputFaces: number
    /** Faces after simplification */
    outputFaces: number
    /** Wall‑clock time (ms) */
    elapsedMs: number
}

/**
 * Given how many results already exist, return the [x, y] world‑space offset
 * for the next one. The original sits at x=0, and each result occupies a
 * 60‑unit wide column.  We lay them out along +X first, then wrap to -X,
 * then shift in Y if the row is full.
 *
 * Grid is 210×210 (−105..+105 on each axis).  Models are ~50 units across,
 * so a 60‑unit step gives a 10‑unit gap.
 */
function positionForResult(index: number): [number, number, number] {
    const step = 60
    // Slot 0 → +60, slot 1 → −60, slot 2 → +120, slot 3 → −120 …
    // That keeps results close to the original for the first few runs.
    const slot = index + 1 // skip 0, that's the original
    const side = slot % 2 === 1 ? 1 : -1
    const tier = Math.ceil(slot / 2)
    const x = side * tier * step
    return [x, 0, 0]
}

/** Format a face count as a short human-readable string, e.g. 200K, 1.5M */
function formatCount(n: number): string {
    if (n >= 1_000_000) {
        const m = n / 1_000_000
        return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`
    }
    if (n >= 1_000) {
        const k = n / 1_000
        return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`
    }
    return String(n)
}

function SimplificationPage() {
    const [selectedFile, setSelectedFile] = useState<string>(COMPLEX_STL_FILES[0] ?? '')
    const [targetRatio, setTargetRatio] = useState<number>(0.5)
    const [preserveBorders, setPreserveBorders] = useState(false)
    const [isSimplifying, setIsSimplifying] = useState(false)
    const [status, setStatus] = useState('')
    const [error, setError] = useState('')
    const [results, setResults] = useState<SimplifiedResult[]>([])
    const [sourceFaceCount, setSourceFaceCount] = useState<number | null>(null)

    const clientRef = useRef<SimplificationClient | null>(null)

    // Lifecycle
    useEffect(() => {
        const c = new SimplificationClient()
        clientRef.current = c
        return () => {
            clientRef.current = null
            c.dispose()
        }
    }, [])

    // Reset when the user picks a different file + read face count from STL header
    useEffect(() => {
        setResults([])
        setStatus('')
        setError('')
        setSourceFaceCount(null)

        if (!selectedFile) return

        // Binary STL: 80-byte header + uint32LE triangle count at offset 80
        let cancelled = false
        fetch(`/stl/${selectedFile}`)
            .then((res) => {
                if (!res.ok) throw new Error(`fetch ${res.status}`)
                return res.arrayBuffer()
            })
            .then((buf) => {
                if (cancelled) return
                if (buf.byteLength >= 84) {
                    const view = new DataView(buf)
                    const triangles = view.getUint32(80, true) // little-endian
                    setSourceFaceCount(triangles)
                }
            })
            .catch(() => { /* non-critical – leave count as null */ })

        return () => { cancelled = true }
    }, [selectedFile])

    async function onSimplify() {
        const client = clientRef.current
        if (!selectedFile || isSimplifying || !client) return

        setIsSimplifying(true)
        setError('')
        setStatus('Fetching STL…')
        try {
            const res = await fetch(`/stl/${selectedFile}`)
            if (!res.ok) throw new Error(`Failed to fetch STL (${res.status})`)
            const input = await res.arrayBuffer()

            setStatus('Running simplification (WASM)…')
            const startMs = performance.now()
            const result = await client.simplify(input, {
                targetRatio,
                preserveBorders,
                onStatus: (s) => setStatus(s),
            })
            const elapsedMs = performance.now() - startMs

            const entry: SimplifiedResult = {
                data: result.output,
                ratio: targetRatio,
                inputFaces: result.inputFaces,
                outputFaces: result.outputFaces,
                elapsedMs,
            }
            setResults((prev) => [...prev, entry])
            setStatus(
                `Done in ${elapsedMs.toFixed(0)} ms — ${result.inputFaces} → ${result.outputFaces} faces`,
            )
        } catch (e: any) {
            console.error('[Simplification] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsSimplifying(false)
        }
    }

    function onClearResults() {
        setResults([])
        setStatus('')
        setError('')
    }

    const hasResults = results.length > 0

    return (
        <>
            <Navbar pageTitle="Simplification" showBack />
            <FileSelector
                files={COMPLEX_STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />

            {/* Status / Error panel */}
            {(status || error) && (
                <div className="ui-panel" style={{ top: '180px' }}>
                    {status && (
                        <div>
                            <strong>Status:</strong> {status}
                        </div>
                    )}
                    {error && (
                        <div style={{ color: '#fca5a5' }}>
                            <strong>Error:</strong> {error}
                        </div>
                    )}
                </div>
            )}

            {/* Processing overlay */}
            {isSimplifying && (
                <div className="wasm-spinner-overlay">
                    <div className="wasm-spinner-ring" />
                    <div className="wasm-spinner-label">{status || 'Processing…'}</div>
                </div>
            )}

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

                    {/* ---- Original model ---- */}
                    {selectedFile && (
                        <group position={[0, 0, 0]}>
                            {hasResults && (
                                <Billboard position={[0, -30, 10]}>
                                    <Text
                                        fontSize={5}
                                        color="#ffffff"
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={0.3}
                                        outlineColor="#000000"
                                    >
                                        Original
                                    </Text>
                                </Billboard>
                            )}
                            <STLViewer filename={selectedFile} />
                        </group>
                    )}

                    {/* ---- Simplified results ---- */}
                    {results.map((r, i) => {
                        const pos = positionForResult(i)
                        const color = RESULT_COLORS[i % RESULT_COLORS.length]
                        const pct = Math.round(r.ratio * 100)
                        return (
                            <group key={i} position={pos}>
                                <Billboard position={[0, -30, 10]}>
                                    <Text
                                        fontSize={4}
                                        color={color}
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={0.3}
                                        outlineColor="#000000"
                                    >
                                        {`${pct}%  (${r.outputFaces.toLocaleString()} faces)`}
                                    </Text>
                                </Billboard>
                                <STLBufferViewer data={r.data} color={color} />
                            </group>
                        )
                    })}
                </Canvas>
            </CanvasContainer>

            {/* ---- Controls (bottom‑right) ---- */}
            <div
                style={{
                    position: 'fixed',
                    right: 16,
                    bottom: 16,
                    zIndex: 2000,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'flex-end',
                }}
            >
                {/* Source model complexity */}
                {sourceFaceCount !== null && (
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            background: 'rgba(15,23,42,0.85)',
                            padding: '6px 14px',
                            borderRadius: 10,
                        }}
                    >
                        <span style={{ color: '#94a3b8', fontSize: 13 }}>Source mesh</span>
                        <span
                            style={{
                                color: '#38bdf8',
                                fontWeight: 700,
                                fontSize: 14,
                            }}
                        >
                            {formatCount(sourceFaceCount)} triangles
                        </span>
                        <span style={{ color: '#64748b', fontSize: 11 }}>
                            ({sourceFaceCount.toLocaleString()})
                        </span>
                    </div>
                )}

                {/* Ratio slider + label */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '6px 14px',
                        borderRadius: 10,
                    }}
                >
                    <label
                        htmlFor="ratio-slider"
                        style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}
                    >
                        Target ratio
                    </label>
                    <input
                        id="ratio-slider"
                        type="range"
                        min={0.01}
                        max={1}
                        step={0.01}
                        value={targetRatio}
                        onChange={(e) => setTargetRatio(Number(e.target.value))}
                        style={{ width: 120, accentColor: '#FFB500' }}
                    />
                    <span
                        style={{
                            color: '#FFB500',
                            fontWeight: 700,
                            fontSize: 14,
                            minWidth: 42,
                            textAlign: 'right',
                        }}
                    >
                        {Math.round(targetRatio * 100)}%
                    </span>
                </div>

                {/* Preserve borders toggle */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: 'rgba(15,23,42,0.85)',
                        padding: '4px 14px',
                        borderRadius: 10,
                    }}
                >
                    <input
                        id="preserve-borders"
                        type="checkbox"
                        checked={preserveBorders}
                        onChange={(e) => setPreserveBorders(e.target.checked)}
                        style={{ accentColor: '#FFB500' }}
                    />
                    <label
                        htmlFor="preserve-borders"
                        style={{ color: '#e2e8f0', fontSize: 13 }}
                    >
                        Preserve borders
                    </label>
                </div>

                {/* Results summary */}
                {hasResults && (
                    <span
                        style={{
                            color: '#94a3b8',
                            fontSize: 12,
                            background: 'rgba(15,23,42,0.85)',
                            padding: '3px 10px',
                            borderRadius: 8,
                        }}
                    >
                        {results.length} result{results.length > 1 ? 's' : ''} on grid
                    </span>
                )}

                {/* Buttons */}
                {hasResults && (
                    <HelloButton
                        onClick={onClearResults}
                        disabled={isSimplifying}
                        text="Clear Results"
                    />
                )}
                <HelloButton
                    onClick={onSimplify}
                    disabled={!selectedFile || isSimplifying}
                    text={isSimplifying ? 'Simplifying…' : 'Simplify'}
                />
            </div>
        </>
    )
}

export default SimplificationPage
