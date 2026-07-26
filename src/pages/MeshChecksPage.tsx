import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import Scene from '../components/Scene'
import STLViewer from '../components/STLViewer'
import FileSelector from '../components/FileSelector'
import { FillHolesClient } from '../lib/fillHolesClient'
import { SelfIntersectionsClient } from '../lib/selfIntersectionsClient'
import { NoiseShellsClient } from '../lib/noiseShellsClient'
import { InvertedNormalsClient } from '../lib/invertedNormalsClient'
import { OverlappingTrianglesClient } from '../lib/overlappingTrianglesClient'
import { BadEdgesClient } from '../lib/badEdgesClient'
import { CanvasContainer } from '../styles/CanvasContainer'

const COMPLEX_STL_FILES = [
    'complex/bony_penvis_mri.stl',
    'complex/Duck_mesh.stl',
    'complex/UNICORN_mesh_NoTexture.stl',
    'complex/Warrior with Hammer pose 2_28mm_supported.stl',
]

// ── Check‑result types ──────────────────────────────────────────────────

type CheckStatus = 'idle' | 'running' | 'pass' | 'fail' | 'error'

interface CheckResult {
    status: CheckStatus
    summary: string
    detail?: string
}

const INITIAL_CHECK: CheckResult = { status: 'idle', summary: '—' }

// ── Helpers ─────────────────────────────────────────────────────────────

/** Read triangle count from binary STL header (uint32LE at offset 80). */
function triangleCountFromStl(buf: ArrayBuffer): number | null {
    if (buf.byteLength < 84) return null
    return new DataView(buf).getUint32(80, true)
}

// ── Status‑badge colours ────────────────────────────────────────────────

function badgeColors(status: CheckStatus) {
    switch (status) {
        case 'pass':
            return { bg: 'rgba(34,197,94,0.15)', border: '#22c55e', text: '#4ade80' }
        case 'fail':
            return { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#fca5a5' }
        case 'error':
            return { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#fca5a5' }
        case 'running':
            return { bg: 'rgba(250,204,21,0.12)', border: '#facc15', text: '#fde68a' }
        default:
            return { bg: 'rgba(100,116,139,0.15)', border: '#475569', text: '#94a3b8' }
    }
}

function statusIcon(status: CheckStatus) {
    switch (status) {
        case 'pass':
            return '✓'
        case 'fail':
            return '✗'
        case 'error':
            return '⚠'
        case 'running':
            return '⏳'
        default:
            return '·'
    }
}

// ── Component ───────────────────────────────────────────────────────────

function MeshChecksPage() {
    const [selectedFile, setSelectedFile] = useState<string>(COMPLEX_STL_FILES[0] ?? '')
    const [isRunning, setIsRunning] = useState(false)

    const [holesCheck, setHolesCheck] = useState<CheckResult>(INITIAL_CHECK)
    const [intersectionsCheck, setIntersectionsCheck] = useState<CheckResult>(INITIAL_CHECK)
    const [overlappingCheck, setOverlappingCheck] = useState<CheckResult>(INITIAL_CHECK)
    const [badEdgesCheck, setBadEdgesCheck] = useState<CheckResult>(INITIAL_CHECK)
    const [noiseShellsCheck, setNoiseShellsCheck] = useState<CheckResult>(INITIAL_CHECK)
    const [invertedNormalsCheck, setInvertedNormalsCheck] = useState<CheckResult>(INITIAL_CHECK)

    const fillHolesRef = useRef<FillHolesClient | null>(null)
    const selfIntRef = useRef<SelfIntersectionsClient | null>(null)
    const overlappingRef = useRef<OverlappingTrianglesClient | null>(null)
    const badEdgesRef = useRef<BadEdgesClient | null>(null)
    const noiseRef = useRef<NoiseShellsClient | null>(null)
    const invertedRef = useRef<InvertedNormalsClient | null>(null)

    // Boot WASM clients once
    useEffect(() => {
        const fh = new FillHolesClient()
        fillHolesRef.current = fh
        const si = new SelfIntersectionsClient()
        selfIntRef.current = si
        const overlap = new OverlappingTrianglesClient()
        overlappingRef.current = overlap
        const be = new BadEdgesClient()
        badEdgesRef.current = be
        const ns = new NoiseShellsClient()
        noiseRef.current = ns
        const inv = new InvertedNormalsClient()
        invertedRef.current = inv
        return () => {
            fillHolesRef.current = null
            fh.dispose()
            selfIntRef.current = null
            si.dispose()
            overlappingRef.current = null
            overlap.dispose()
            badEdgesRef.current = null
            be.dispose()
            noiseRef.current = null
            ns.dispose()
            invertedRef.current = null
            inv.dispose()
        }
    }, [])

    // Reset results when file changes
    useEffect(() => {
        setHolesCheck(INITIAL_CHECK)
        setIntersectionsCheck(INITIAL_CHECK)
        setOverlappingCheck(INITIAL_CHECK)
        setBadEdgesCheck(INITIAL_CHECK)
        setNoiseShellsCheck(INITIAL_CHECK)
        setInvertedNormalsCheck(INITIAL_CHECK)
    }, [selectedFile])

    // ── Run all checks ──────────────────────────────────────────────────

    async function onRunChecks() {
        if (!selectedFile || isRunning) return
        setIsRunning(true)
        setHolesCheck({ status: 'running', summary: 'Checking…' })
        setIntersectionsCheck({ status: 'running', summary: 'Checking…' })
        setOverlappingCheck({ status: 'running', summary: 'Checking…' })
        setBadEdgesCheck({ status: 'running', summary: 'Checking…' })
        setNoiseShellsCheck({ status: 'running', summary: 'Checking…' })
        setInvertedNormalsCheck({ status: 'running', summary: 'Checking…' })

        // Fetch the STL once — both checks share it
        let inputBuf: ArrayBuffer
        try {
            const res = await fetch(`/stl/${selectedFile}`)
            if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
            inputBuf = await res.arrayBuffer()
        } catch (e: any) {
            const msg = String(e?.message || e)
            setHolesCheck({ status: 'error', summary: 'Fetch error', detail: msg })
            setIntersectionsCheck({ status: 'error', summary: 'Fetch error', detail: msg })
            setOverlappingCheck({ status: 'error', summary: 'Fetch error', detail: msg })
            setBadEdgesCheck({ status: 'error', summary: 'Fetch error', detail: msg })
            setNoiseShellsCheck({ status: 'error', summary: 'Fetch error', detail: msg })
            setInvertedNormalsCheck({ status: 'error', summary: 'Fetch error', detail: msg })
            setIsRunning(false)
            return
        }

        const inputTris = triangleCountFromStl(inputBuf)

        // Run both checks in parallel
        const holesPromise = runHolesCheck(inputBuf, inputTris)
        const intPromise = runIntersectionsCheck(inputBuf)
        const overlapPromise = runOverlappingCheck(inputBuf)
        const badEdgesPromise = runBadEdgesCheck(inputBuf)
        const noisePromise = runNoiseShellsCheck(inputBuf)
        const invPromise = runInvertedNormalsCheck(inputBuf)
        await Promise.allSettled([
            holesPromise,
            intPromise,
            overlapPromise,
            badEdgesPromise,
            noisePromise,
            invPromise,
        ])

        setIsRunning(false)
    }

    async function runOverlappingCheck(inputBuf: ArrayBuffer) {
        const client = overlappingRef.current
        if (!client) {
            setOverlappingCheck({ status: 'error', summary: 'Client not ready' })
            return
        }
        try {
            const startMs = performance.now()
            const result = await client.detect(inputBuf.slice(0), {
                onStatus: (s) =>
                    setOverlappingCheck((prev) => ({ ...prev, summary: s })),
            })
            const elapsedMs = performance.now() - startMs

            if (result.count === 0) {
                setOverlappingCheck({
                    status: 'pass',
                    summary: 'No overlapping triangles',
                    detail: `MeshLib detect returned 0 overlaps (${elapsedMs.toFixed(0)} ms)`,
                })
            } else {
                setOverlappingCheck({
                    status: 'fail',
                    summary: `${result.count} overlap(s)`,
                    detail: `MeshLib detected overlapping triangle pairs (${elapsedMs.toFixed(0)} ms)`,
                })
            }
        } catch (e: any) {
            setOverlappingCheck({
                status: 'error',
                summary: 'Check failed',
                detail: String(e?.message || e),
            })
        }
    }

    async function runBadEdgesCheck(inputBuf: ArrayBuffer) {
        const client = badEdgesRef.current
        if (!client) {
            setBadEdgesCheck({ status: 'error', summary: 'Client not ready' })
            return
        }
        try {
            const startMs = performance.now()
            const result = await client.detect(inputBuf.slice(0), {
                onStatus: (s) =>
                    setBadEdgesCheck((prev) => ({ ...prev, summary: s })),
            })
            const elapsedMs = performance.now() - startMs

            if (result.badEdgesCount === 0) {
                setBadEdgesCheck({
                    status: 'pass',
                    summary: 'No bad edges',
                    detail: `Contours=${result.badContoursCount}, boundary=${result.boundaryEdgesCount}, non-manifold=${result.nonManifoldEdgesCount} (${elapsedMs.toFixed(0)} ms)`,
                })
            } else {
                setBadEdgesCheck({
                    status: 'fail',
                    summary: `${result.badEdgesCount} bad edge(s)`,
                    detail: `Contours=${result.badContoursCount}, boundary=${result.boundaryEdgesCount}, non-manifold=${result.nonManifoldEdgesCount} (${elapsedMs.toFixed(0)} ms)`,
                })
            }
        } catch (e: any) {
            setBadEdgesCheck({
                status: 'error',
                summary: 'Check failed',
                detail: String(e?.message || e),
            })
        }
    }

    async function runHolesCheck(inputBuf: ArrayBuffer, inputTris: number | null) {
        const client = fillHolesRef.current
        if (!client) {
            setHolesCheck({ status: 'error', summary: 'Client not ready' })
            return
        }
        try {
            // fillHoles internally calls MeshLib C++ FindHoles() then fills.
            // By comparing triangle counts we know if holes were found.
            const startMs = performance.now()
            const { output, holesFilledCount } = await client.fillHoles(inputBuf.slice(0), {
                onStatus: (s) =>
                    setHolesCheck((prev) => ({ ...prev, summary: s })),
            })
            const elapsedMs = performance.now() - startMs
            const outputTris = triangleCountFromStl(output)

            if (inputTris !== null && outputTris !== null) {
                const addedTris = outputTris - inputTris
                if (addedTris > 0) {
                    const holeNote = holesFilledCount != null ? `${holesFilledCount} hole(s) filled, ` : ''
                    setHolesCheck({
                        status: 'fail',
                        summary: `Holes detected`,
                        detail: `MeshLib FindHoles found boundaries — ${holeNote}${addedTris} triangle(s) added to fill (${elapsedMs.toFixed(0)} ms)`,
                    })
                } else {
                    setHolesCheck({
                        status: 'pass',
                        summary: 'Watertight — no holes',
                        detail: `MeshLib FindHoles returned 0 boundaries (${elapsedMs.toFixed(0)} ms)`,
                    })
                }
            } else {
                // Couldn't read triangle counts — fall back to byte‑size comparison
                if (output.byteLength !== inputBuf.byteLength) {
                    setHolesCheck({
                        status: 'fail',
                        summary: 'Holes detected',
                        detail: `Output size differs from input (${elapsedMs.toFixed(0)} ms)`,
                    })
                } else {
                    setHolesCheck({
                        status: 'pass',
                        summary: 'Watertight — no holes',
                        detail: `No change after fill pass (${elapsedMs.toFixed(0)} ms)`,
                    })
                }
            }
        } catch (e: any) {
            setHolesCheck({
                status: 'error',
                summary: 'Check failed',
                detail: String(e?.message || e),
            })
        }
    }

    async function runIntersectionsCheck(inputBuf: ArrayBuffer) {
        const client = selfIntRef.current
        if (!client) {
            setIntersectionsCheck({ status: 'error', summary: 'Client not ready' })
            return
        }
        try {
            const startMs = performance.now()
            const result = await client.detect(inputBuf.slice(0), {
                onStatus: (s) =>
                    setIntersectionsCheck((prev) => ({ ...prev, summary: s })),
            })
            const elapsedMs = performance.now() - startMs

            if (result.count === 0) {
                setIntersectionsCheck({
                    status: 'pass',
                    summary: 'No self-intersections',
                    detail: `MeshLib detect returned 0 pairs (${elapsedMs.toFixed(0)} ms)`,
                })
            } else {
                setIntersectionsCheck({
                    status: 'fail',
                    summary: `${result.count} intersection(s)`,
                    detail: `MeshLib detected ${result.count} self-intersecting face pair(s) (${elapsedMs.toFixed(0)} ms)`,
                })
            }
        } catch (e: any) {
            setIntersectionsCheck({
                status: 'error',
                summary: 'Check failed',
                detail: String(e?.message || e),
            })
        }
    }

    async function runNoiseShellsCheck(inputBuf: ArrayBuffer) {
        const client = noiseRef.current
        if (!client) {
            setNoiseShellsCheck({ status: 'error', summary: 'Client not ready' })
            return
        }
        try {
            const startMs = performance.now()
            const result = await client.detect(inputBuf.slice(0), {
                onStatus: (s) =>
                    setNoiseShellsCheck((prev) => ({ ...prev, summary: s })),
            })
            const elapsedMs = performance.now() - startMs

            if (result.noiseCount === 0) {
                setNoiseShellsCheck({
                    status: 'pass',
                    summary: 'No noise shells',
                    detail: `1 connected component (${elapsedMs.toFixed(0)} ms)`,
                })
            } else {
                setNoiseShellsCheck({
                    status: 'fail',
                    summary: `${result.noiseCount} noise shell(s)`,
                    detail: `${result.totalComponents} component(s) total (${elapsedMs.toFixed(0)} ms)`,
                })
            }
        } catch (e: any) {
            setNoiseShellsCheck({
                status: 'error',
                summary: 'Check failed',
                detail: String(e?.message || e),
            })
        }
    }

    async function runInvertedNormalsCheck(inputBuf: ArrayBuffer) {
        const client = invertedRef.current
        if (!client) {
            setInvertedNormalsCheck({ status: 'error', summary: 'Client not ready' })
            return
        }
        try {
            const startMs = performance.now()
            const result = await client.detect(inputBuf.slice(0), {
                onStatus: (s) =>
                    setInvertedNormalsCheck((prev) => ({ ...prev, summary: s })),
            })
            const elapsedMs = performance.now() - startMs

            if (!result.isClosed) {
                if (result.localInvertedCount > 0) {
                    setInvertedNormalsCheck({
                        status: 'fail',
                        summary: `${result.localInvertedCount} locally inverted tri(s)`,
                        detail: `Open mesh; local orientation inconsistencies found (${elapsedMs.toFixed(0)} ms)`,
                    })
                } else {
                    setInvertedNormalsCheck({
                        status: 'pass',
                        summary: 'Open mesh (no local inversions)',
                        detail: `Global orientation check applies to closed meshes (${elapsedMs.toFixed(0)} ms)`,
                    })
                }
                return
            }

            if (result.localInvertedCount > 0 || result.isInverted) {
                setInvertedNormalsCheck({
                    status: 'fail',
                    summary: `${result.localInvertedCount} locally inverted tri(s)`,
                    detail: `Signed volume ${result.signedVolume?.toFixed(6)} (${elapsedMs.toFixed(0)} ms)`,
                })
            } else {
                setInvertedNormalsCheck({
                    status: 'pass',
                    summary: 'Normals orientation OK',
                    detail: `Signed volume ${result.signedVolume?.toFixed(6)} (${elapsedMs.toFixed(0)} ms)`,
                })
            }
        } catch (e: any) {
            setInvertedNormalsCheck({
                status: 'error',
                summary: 'Check failed',
                detail: String(e?.message || e),
            })
        }
    }

    // ── Overall verdict ─────────────────────────────────────────────────

    function overallStatus(): CheckStatus {
        const checks = [
            holesCheck,
            intersectionsCheck,
            overlappingCheck,
            badEdgesCheck,
            noiseShellsCheck,
            invertedNormalsCheck,
        ]
        if (checks.some((c) => c.status === 'running')) return 'running'
        if (checks.some((c) => c.status === 'error')) return 'error'
        if (checks.every((c) => c.status === 'idle')) return 'idle'
        if (checks.some((c) => c.status === 'fail')) return 'fail'
        if (checks.every((c) => c.status === 'pass')) return 'pass'
        return 'idle'
    }

    function overallLabel(): string {
        switch (overallStatus()) {
            case 'pass':
                return 'ALL CHECKS PASSED'
            case 'fail':
                return 'CHECKS FAILED'
            case 'running':
                return 'RUNNING CHECKS…'
            case 'error':
                return 'CHECK ERROR'
            default:
                return 'NOT RUN'
        }
    }

    const verdict = overallStatus()

    // ── Render ──────────────────────────────────────────────────────────

    return (
        <>
            <Navbar pageTitle="Mesh Checks" showBack />
            <FileSelector
                files={COMPLEX_STL_FILES}
                selectedFile={selectedFile}
                onFileSelect={setSelectedFile}
            />

            {/* ── Results panel (top‑left) ── */}
            {verdict !== 'idle' && (
                <div
                    style={{
                        position: 'fixed',
                        left: 16,
                        top: 180,
                        zIndex: 2000,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        minWidth: 320,
                        maxWidth: 420,
                    }}
                >
                    {/* Overall banner */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            background: badgeColors(verdict).bg,
                            border: `1.5px solid ${badgeColors(verdict).border}`,
                            borderRadius: 12,
                            padding: '10px 16px',
                        }}
                    >
                        <span style={{ fontSize: 22 }}>
                            {verdict === 'pass' ? '🟢' : verdict === 'fail' ? '🔴' : verdict === 'running' ? '🟡' : '⚪'}
                        </span>
                        <span
                            style={{
                                color: badgeColors(verdict).text,
                                fontWeight: 800,
                                fontSize: 15,
                                letterSpacing: 0.5,
                            }}
                        >
                            {overallLabel()}
                        </span>
                    </div>

                    {/* Individual check rows */}
                    {[
                        { label: 'Holes', check: holesCheck },
                        { label: 'Self-Intersections', check: intersectionsCheck },
                        { label: 'Overlapping Triangles', check: overlappingCheck },
                        { label: 'Bad Edges', check: badEdgesCheck },
                        { label: 'Noise Shells', check: noiseShellsCheck },
                        { label: 'Inverted Normals', check: invertedNormalsCheck },
                    ].map(({ label, check }) => {
                        const c = badgeColors(check.status)
                        return (
                            <div
                                key={label}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 2,
                                    background: c.bg,
                                    border: `1px solid ${c.border}`,
                                    borderRadius: 10,
                                    padding: '8px 14px',
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 8,
                                    }}
                                >
                                    <span
                                        style={{
                                            fontSize: 15,
                                            fontWeight: 700,
                                            color: c.text,
                                            minWidth: 18,
                                            textAlign: 'center',
                                        }}
                                    >
                                        {statusIcon(check.status)}
                                    </span>
                                    <span
                                        style={{
                                            color: '#e2e8f0',
                                            fontWeight: 600,
                                            fontSize: 13,
                                        }}
                                    >
                                        {label}
                                    </span>
                                    <span
                                        style={{
                                            marginLeft: 'auto',
                                            color: c.text,
                                            fontSize: 13,
                                            fontWeight: 600,
                                        }}
                                    >
                                        {check.summary}
                                    </span>
                                </div>
                                {check.detail && (
                                    <span
                                        style={{
                                            color: '#94a3b8',
                                            fontSize: 11,
                                            paddingLeft: 26,
                                        }}
                                    >
                                        {check.detail}
                                    </span>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}

            {/* ── Spinner overlay while running ── */}
            {isRunning && (
                <div className="wasm-spinner-overlay">
                    <div className="wasm-spinner-ring" />
                    <div className="wasm-spinner-label">Running mesh checks…</div>
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

                    {selectedFile && (
                        <group position={[0, 0, 0]}>
                            <STLViewer filename={selectedFile} />
                        </group>
                    )}
                </Canvas>
            </CanvasContainer>

            {/* ── Run button (bottom‑right) ── */}
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
                <HelloButton
                    onClick={onRunChecks}
                    disabled={!selectedFile || isRunning}
                    text={isRunning ? 'Running…' : 'Run Checks'}
                />
            </div>
        </>
    )
}

export default MeshChecksPage
