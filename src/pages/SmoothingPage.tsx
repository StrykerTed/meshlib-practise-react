import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { Billboard, Text } from '@react-three/drei'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import STLBufferViewer from '../components/STLBufferViewer'
import FileSelector from '../components/FileSelector'
import { SmoothingClient } from '../lib/smoothingClient'
import type { SmoothingMethod } from '../lib/smoothingClient'
import { CanvasContainer } from '../styles/CanvasContainer'

const COMPLEX_STL_FILES = [
    'complex/bony_penvis_mri.stl',
    'complex/Duck_mesh.stl',
    'complex/UNICORN_mesh_NoTexture.stl',
    'complex/Warrior with Hammer pose 2_28mm_supported.stl',
]

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

const METHODS: { value: SmoothingMethod; label: string; description: string }[] = [
    {
        value: 'laplacian',
        label: 'Laplacian',
        description: 'Classic smoothing — strong effect but tends to shrink the mesh.',
    },
    {
        value: 'taubin',
        label: 'Taubin',
        description: 'Volume-preserving two-step filter (λ inward, μ outward).',
    },
    {
        value: 'laplacianHC',
        label: 'Laplacian HC',
        description: 'Humphrey\'s Classes — good smoothing with less shrinkage than Laplacian.',
    },
    {
        value: 'tangentialRelaxation',
        label: 'Tangential Relaxation',
        description: 'Improves triangle quality while preserving surface shape.',
    },
]

interface SmoothedResult {
    data: ArrayBuffer
    method: SmoothingMethod
    methodLabel: string
    iterations: number
    faces: number
    vertices: number
    elapsedMs: number
    /** Method-specific params for the billboard */
    params: string
}

function positionForResult(index: number): [number, number, number] {
    const step = 60
    const slot = index + 1
    const side = slot % 2 === 1 ? 1 : -1
    const tier = Math.ceil(slot / 2)
    const x = side * tier * step
    return [x, 0, 0]
}

/** Format a count as a short human-readable string, e.g. 200K, 1.5M */
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

/** Build a short description of the method params for billboard display */
function describeParams(method: SmoothingMethod, iterations: number, lambda: number, mu: number, alpha: number, beta: number): string {
    switch (method) {
        case 'laplacian':
            return `${iterations} iter`
        case 'taubin':
            return `${iterations} iter  λ=${lambda} μ=${mu}`
        case 'laplacianHC':
            return `${iterations} iter  α=${alpha} β=${beta}`
        case 'tangentialRelaxation':
            return `${iterations} iter`
    }
}

/* ---- Reusable styled control row ---- */
const controlRowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'rgba(15,23,42,0.85)',
    padding: '6px 14px',
    borderRadius: 10,
}

const labelStyle: React.CSSProperties = {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 600,
    minWidth: 70,
}

const valueStyle: React.CSSProperties = {
    color: '#FFB500',
    fontWeight: 700,
    fontSize: 14,
    minWidth: 42,
    textAlign: 'right' as const,
}

function SmoothingPage() {
    const [selectedFile, setSelectedFile] = useState<string>(COMPLEX_STL_FILES[0] ?? '')
    const [method, setMethod] = useState<SmoothingMethod>('laplacian')
    const [iterations, setIterations] = useState(5)
    const [lambda, setLambda] = useState(0.5)
    const [mu, setMu] = useState(0.53)
    const [alpha, setAlpha] = useState(0.0)
    const [beta, setBeta] = useState(0.5)

    const [isSmoothing, setIsSmoothing] = useState(false)
    const [status, setStatus] = useState('')
    const [error, setError] = useState('')
    const [results, setResults] = useState<SmoothedResult[]>([])
    const [sourceFaceCount, setSourceFaceCount] = useState<number | null>(null)

    const clientRef = useRef<SmoothingClient | null>(null)

    // Lifecycle
    useEffect(() => {
        const c = new SmoothingClient()
        clientRef.current = c
        return () => {
            clientRef.current = null
            c.dispose()
        }
    }, [])

    // Reset when the user picks a different file + read face count
    useEffect(() => {
        setResults([])
        setStatus('')
        setError('')
        setSourceFaceCount(null)

        if (!selectedFile) return

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
                    setSourceFaceCount(view.getUint32(80, true))
                }
            })
            .catch(() => { /* non-critical */ })

        return () => { cancelled = true }
    }, [selectedFile])

    async function onSmooth() {
        const client = clientRef.current
        if (!selectedFile || isSmoothing || !client) return

        setIsSmoothing(true)
        setError('')
        setStatus('Fetching STL…')
        try {
            const res = await fetch(`/stl/${selectedFile}`)
            if (!res.ok) throw new Error(`Failed to fetch STL (${res.status})`)
            const input = await res.arrayBuffer()

            const methodLabel = METHODS.find((m) => m.value === method)?.label ?? method

            setStatus(`Running ${methodLabel} smoothing (WASM)…`)
            const startMs = performance.now()
            const result = await client.smooth(input, {
                method,
                iterations,
                lambda,
                mu,
                alpha,
                beta,
                onStatus: (s) => setStatus(s),
            })
            const elapsedMs = performance.now() - startMs

            const entry: SmoothedResult = {
                data: result.output,
                method,
                methodLabel,
                iterations,
                faces: result.faces,
                vertices: result.vertices,
                elapsedMs,
                params: describeParams(method, iterations, lambda, mu, alpha, beta),
            }
            setResults((prev) => [...prev, entry])
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms — ${methodLabel}, ${iterations} iterations`)
        } catch (e: any) {
            console.error('[Smoothing] failed:', e)
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setIsSmoothing(false)
        }
    }

    function onClearResults() {
        setResults([])
        setStatus('')
        setError('')
    }

    const hasResults = results.length > 0
    const selectedMethodInfo = METHODS.find((m) => m.value === method)

    return (
        <>
            <Navbar pageTitle="Smoothing" showBack />
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
            {isSmoothing && (
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

                    {/* ---- Smoothed results ---- */}
                    {results.map((r, i) => {
                        const pos = positionForResult(i)
                        const color = RESULT_COLORS[i % RESULT_COLORS.length]
                        return (
                            <group key={i} position={pos}>
                                <Billboard position={[0, -30, 10]}>
                                    <Text
                                        fontSize={3.5}
                                        color={color}
                                        anchorX="center"
                                        anchorY="bottom"
                                        outlineWidth={0.3}
                                        outlineColor="#000000"
                                    >
                                        {`${r.methodLabel}  ${r.params}`}
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
                {/* Source mesh complexity */}
                {sourceFaceCount !== null && (
                    <div style={controlRowStyle}>
                        <span style={{ color: '#94a3b8', fontSize: 13 }}>Source mesh</span>
                        <span style={{ color: '#38bdf8', fontWeight: 700, fontSize: 14 }}>
                            {formatCount(sourceFaceCount)} triangles
                        </span>
                        <span style={{ color: '#64748b', fontSize: 11 }}>
                            ({sourceFaceCount.toLocaleString()})
                        </span>
                    </div>
                )}

                {/* Method selector */}
                <div style={controlRowStyle}>
                    <label htmlFor="smooth-method" style={labelStyle}>
                        Method
                    </label>
                    <select
                        id="smooth-method"
                        value={method}
                        onChange={(e) => setMethod(e.target.value as SmoothingMethod)}
                        style={{
                            background: 'rgba(2,6,23,0.6)',
                            color: '#e5e7eb',
                            border: '1px solid rgba(148,163,184,0.25)',
                            borderRadius: 8,
                            padding: '4px 8px',
                            fontSize: 13,
                            cursor: 'pointer',
                            outline: 'none',
                        }}
                    >
                        {METHODS.map((m) => (
                            <option key={m.value} value={m.value}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Method description */}
                {selectedMethodInfo && (
                    <div
                        style={{
                            ...controlRowStyle,
                            maxWidth: 360,
                        }}
                    >
                        <span style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.4 }}>
                            {selectedMethodInfo.description}
                        </span>
                    </div>
                )}

                {/* Iterations */}
                <div style={controlRowStyle}>
                    <label htmlFor="iterations-slider" style={labelStyle}>
                        Iterations
                    </label>
                    <input
                        id="iterations-slider"
                        type="range"
                        min={1}
                        max={100}
                        step={1}
                        value={iterations}
                        onChange={(e) => setIterations(Number(e.target.value))}
                        style={{ width: 120, accentColor: '#FFB500' }}
                    />
                    <span style={valueStyle}>{iterations}</span>
                </div>

                {/* Taubin: lambda */}
                {method === 'taubin' && (
                    <div style={controlRowStyle}>
                        <label htmlFor="lambda-slider" style={labelStyle}>
                            Lambda (λ)
                        </label>
                        <input
                            id="lambda-slider"
                            type="range"
                            min={0.01}
                            max={0.99}
                            step={0.01}
                            value={lambda}
                            onChange={(e) => setLambda(Number(e.target.value))}
                            style={{ width: 120, accentColor: '#FFB500' }}
                        />
                        <span style={valueStyle}>{lambda.toFixed(2)}</span>
                    </div>
                )}

                {/* Taubin: mu */}
                {method === 'taubin' && (
                    <div style={controlRowStyle}>
                        <label htmlFor="mu-slider" style={labelStyle}>
                            Mu (μ)
                        </label>
                        <input
                            id="mu-slider"
                            type="range"
                            min={0.01}
                            max={0.99}
                            step={0.01}
                            value={mu}
                            onChange={(e) => setMu(Number(e.target.value))}
                            style={{ width: 120, accentColor: '#FFB500' }}
                        />
                        <span style={valueStyle}>{mu.toFixed(2)}</span>
                    </div>
                )}

                {/* Taubin: mu > lambda warning */}
                {method === 'taubin' && mu <= lambda && (
                    <div
                        style={{
                            ...controlRowStyle,
                            borderColor: 'rgba(239,68,68,0.5)',
                            border: '1px solid rgba(239,68,68,0.5)',
                        }}
                    >
                        <span style={{ color: '#fca5a5', fontSize: 12 }}>
                            ⚠ μ must be greater than λ
                        </span>
                    </div>
                )}

                {/* LaplacianHC: alpha */}
                {method === 'laplacianHC' && (
                    <div style={controlRowStyle}>
                        <label htmlFor="alpha-slider" style={labelStyle}>
                            Alpha (α)
                        </label>
                        <input
                            id="alpha-slider"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={alpha}
                            onChange={(e) => setAlpha(Number(e.target.value))}
                            style={{ width: 120, accentColor: '#FFB500' }}
                        />
                        <span style={valueStyle}>{alpha.toFixed(2)}</span>
                    </div>
                )}

                {/* LaplacianHC: beta */}
                {method === 'laplacianHC' && (
                    <div style={controlRowStyle}>
                        <label htmlFor="beta-slider" style={labelStyle}>
                            Beta (β)
                        </label>
                        <input
                            id="beta-slider"
                            type="range"
                            min={0}
                            max={1}
                            step={0.01}
                            value={beta}
                            onChange={(e) => setBeta(Number(e.target.value))}
                            style={{ width: 120, accentColor: '#FFB500' }}
                        />
                        <span style={valueStyle}>{beta.toFixed(2)}</span>
                    </div>
                )}

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
                        disabled={isSmoothing}
                        text="Clear Results"
                    />
                )}
                <HelloButton
                    onClick={onSmooth}
                    disabled={
                        !selectedFile ||
                        isSmoothing ||
                        (method === 'taubin' && mu <= lambda)
                    }
                    text={isSmoothing ? 'Smoothing…' : 'Smooth'}
                />
            </div>
        </>
    )
}

export default SmoothingPage
