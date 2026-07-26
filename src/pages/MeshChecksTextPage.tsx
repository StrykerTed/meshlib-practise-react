import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import { WasmChecksHolesClient } from '../lib/wasmChecksHolesClient'
import { SelfIntersectionsClient } from '../lib/selfIntersectionsClient'
import { NoiseShellsClient } from '../lib/noiseShellsClient'
import { InvertedNormalsClient } from '../lib/invertedNormalsClient'
import { OverlappingTrianglesClient } from '../lib/overlappingTrianglesClient'
import { BadEdgesClient } from '../lib/badEdgesClient'

type RunStatus = 'idle' | 'running' | 'done' | 'error'

interface FixtureMetrics {
    invertedNormals: number
    badEdges: number
    badContours: number
    nearBadEdges: number
    planarHoles: number
    shells: number
    noiseShells: number
    intersectingTriangles: number
    overlappingTriangles: number
}

interface FixtureRow {
    file: string
    partName: string
    status: 'PASS' | 'FAIL' | 'ERROR'
    advice: string
    metrics: FixtureMetrics
    elapsedMs: number
    error?: string
}

interface ExpectedRow {
    status: 'PASS' | 'FAIL'
    metrics: FixtureMetrics
    advice: string
}

const STLS_TO_TEST = [
    '09ZR0FP_SOLID.stl',
    'BM-2_0PBL0AA_SURROGATEx 5.stl',
    'BM-2_0PBL0AA_SURROGATEx.stl',
    'ball_with_missing_faces.stl',
    'baseplate_shoulder_holes.stl',
    'high_cube.stl',
    'high_cylinder.stl',
    'not-watertight-face.stl',
    'icosphere_with_holes.stl',
    'sample.stl',
    'sample2.stl',
    'self-intersecting-3d.stl',
    'self-intersecting.stl',
    'test_noise.stl',
] as const

function normalizePartName(raw: string): string {
    const trimmed = raw.trim()
    if (trimmed.startsWith('BM-2_0PBL0AA_SURROGATEx ')) return 'BM-2_0PBL0AA_SURROGATEx'
    if (trimmed.startsWith('high_cube ')) return 'high_cube'
    return trimmed
}

function toPartName(file: string): string {
    const base = file.endsWith('.stl') ? file.slice(0, -4) : file
    return normalizePartName(base)
}

function toInt(value: string): number {
    const parsed = Number.parseInt(String(value || '0'), 10)
    return Number.isNaN(parsed) ? 0 : parsed
}

function parseCsvLine(line: string): string[] {
    const out: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
        const ch = line[i]
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"'
                i++
            } else {
                inQuotes = !inQuotes
            }
            continue
        }
        if (ch === ',' && !inQuotes) {
            out.push(current)
            current = ''
            continue
        }
        current += ch
    }
    out.push(current)
    return out
}

function parseExpectedCsv(csvText: string): Record<string, ExpectedRow> {
    const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

    if (lines.length < 2) return {}
    const headers = parseCsvLine(lines[0])
    const index = (name: string) => headers.indexOf(name)

    const partNameIndex = index('partName')
    const fixInfoIndex = index('fixInfo')
    const adviceIndex = index('advice')
    const invertedNormalsIndex = index('invertedNormals')
    const badEdgesIndex = index('badEdges')
    const badContoursIndex = index('badContours')
    const nearBadEdgesIndex = index('nearBadEdges')
    const planarHolesIndex = index('planarHoles')
    const shellsIndex = index('shells')
    const noiseShellsIndex = index('noiseShells')
    const intersectingTrianglesIndex = index('intersectingTriangles')
    const overlappingTrianglesIndex = index('overlappingTriangles')

    const map: Record<string, ExpectedRow> = {}
    for (const line of lines.slice(1)) {
        const cols = parseCsvLine(line)
        const rawName = cols[partNameIndex] || ''
        if (!rawName) continue
        const partName = normalizePartName(rawName)
        const fixInfo = (cols[fixInfoIndex] || 'FAIL').toUpperCase() === 'PASS' ? 'PASS' : 'FAIL'
        map[partName] = {
            status: fixInfo,
            metrics: {
                invertedNormals: toInt(cols[invertedNormalsIndex]),
                badEdges: toInt(cols[badEdgesIndex]),
                badContours: toInt(cols[badContoursIndex]),
                nearBadEdges: toInt(cols[nearBadEdgesIndex]),
                planarHoles: toInt(cols[planarHolesIndex]),
                shells: toInt(cols[shellsIndex]),
                noiseShells: toInt(cols[noiseShellsIndex]),
                intersectingTriangles: toInt(cols[intersectingTrianglesIndex]),
                overlappingTriangles: toInt(cols[overlappingTrianglesIndex]),
            },
            advice: cols[adviceIndex] || '',
        }
    }
    return map
}

function getAdvice(metrics: FixtureMetrics): string {
    if (metrics.invertedNormals > 0) return 'Fix normals of inverted triangles'
    if (metrics.planarHoles > 0) return 'Fill planar holes'
    if (metrics.overlappingTriangles > 0) return 'Fix overlapping triangles'
    if (metrics.intersectingTriangles > 0) return 'Fix intersecting triangles'
    if (metrics.badEdges > 0) return 'Fix bad edges'
    if (metrics.noiseShells > 0) return 'Remove noise shells'
    return 'No errors detected'
}

function hasIssues(metrics: FixtureMetrics): boolean {
    return (
        metrics.invertedNormals > 0 ||
        metrics.badEdges > 0 ||
        metrics.planarHoles > 0 ||
        metrics.noiseShells > 0 ||
        metrics.intersectingTriangles > 0 ||
        metrics.overlappingTriangles > 0
    )
}

function metricDiffs(actual: FixtureMetrics, expected: FixtureMetrics): string[] {
    const diffs: string[] = []
    const fields = Object.keys(actual) as Array<keyof FixtureMetrics>
    for (const field of fields) {
        if (actual[field] !== expected[field]) {
            diffs.push(`${field}: expected ${expected[field]}, got ${actual[field]}`)
        }
    }
    return diffs
}

function MeshChecksTextPage() {
    const [runStatus, setRunStatus] = useState<RunStatus>('idle')
    const [rows, setRows] = useState<FixtureRow[]>([])
    const [runError, setRunError] = useState<string | null>(null)
    const [activeFile, setActiveFile] = useState<string | null>(null)
    const [completedCount, setCompletedCount] = useState(0)
    const [mismatchNotes, setMismatchNotes] = useState<string[]>([])
    const [expectedByPart, setExpectedByPart] = useState<Record<string, ExpectedRow>>({})
    const [expectedSource, setExpectedSource] = useState<string>('')

    const holesClientRef = useRef<WasmChecksHolesClient | null>(null)
    const selfIntRef = useRef<SelfIntersectionsClient | null>(null)
    const overlappingRef = useRef<OverlappingTrianglesClient | null>(null)
    const badEdgesRef = useRef<BadEdgesClient | null>(null)
    const noiseRef = useRef<NoiseShellsClient | null>(null)
    const invertedRef = useRef<InvertedNormalsClient | null>(null)
    const autoRunStartedRef = useRef(false)

    useEffect(() => {
        const holes = new WasmChecksHolesClient()
        holesClientRef.current = holes
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
            holesClientRef.current = null
            holes.dispose()
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

    useEffect(() => {
        const shouldAutoRun = new URLSearchParams(window.location.search).get('autorun') === '1'
        if (!shouldAutoRun || autoRunStartedRef.current) return
        autoRunStartedRef.current = true
        void runSuite()
    }, [])

    useEffect(() => {
        let active = true
        async function loadExpected() {
            try {
                const response = await fetch('/expected/python_expected_results.csv')
                if (!response.ok) {
                    if (!active) return
                    setExpectedByPart({})
                    setExpectedSource('')
                    return
                }
                const csvText = await response.text()
                if (!active) return
                setExpectedByPart(parseExpectedCsv(csvText))
                setExpectedSource('/expected/python_expected_results.csv')
            } catch {
                if (!active) return
                setExpectedByPart({})
                setExpectedSource('')
            }
        }
        void loadExpected()
        return () => {
            active = false
        }
    }, [])

    async function runSingleFixture(file: string): Promise<FixtureRow> {
        const startMs = performance.now()
        const partName = toPartName(file)

        const res = await fetch(`/stl/${file}`)
        if (!res.ok) {
            throw new Error(`Failed to fetch ${file} (${res.status})`)
        }
        const inputBuf = await res.arrayBuffer()

        const [holes, intersections, overlapping, badEdges, noise, inverted] = await Promise.all([
            holesClientRef.current?.detect(inputBuf.slice(0)),
            selfIntRef.current?.detect(inputBuf.slice(0), { timeoutMs: 300_000 }),
            overlappingRef.current?.detect(inputBuf.slice(0)),
            badEdgesRef.current?.detect(inputBuf.slice(0)),
            noiseRef.current?.detect(inputBuf.slice(0)),
            invertedRef.current?.detect(inputBuf.slice(0)),
        ])

        if (!holes || !intersections || !overlapping || !badEdges || !noise || !inverted) {
            throw new Error('One or more WASM clients are not ready')
        }

        const metrics: FixtureMetrics = {
            invertedNormals: inverted.localInvertedCount,
            badEdges: badEdges.badEdgesCount,
            badContours: badEdges.badContoursCount,
            nearBadEdges: 0,
            planarHoles: holes.count,
            shells: noise.totalComponents,
            noiseShells: noise.noiseCount,
            intersectingTriangles: intersections.count,
            overlappingTriangles: overlapping.count,
        }

        const status: 'PASS' | 'FAIL' = hasIssues(metrics) ? 'FAIL' : 'PASS'
        const advice = getAdvice(metrics)

        return {
            file,
            partName,
            status,
            advice,
            metrics,
            elapsedMs: performance.now() - startMs,
        }
    }

    async function runSuite() {
        if (runStatus === 'running') return

        setRunStatus('running')
        setRunError(null)
        setRows([])
        setMismatchNotes([])
        setCompletedCount(0)

        const nextRows: FixtureRow[] = []
        const mismatches: string[] = []

        for (const file of STLS_TO_TEST) {
            setActiveFile(file)
            try {
                const row = await runSingleFixture(file)
                nextRows.push(row)

                const expected = expectedByPart[row.partName]
                if (expected) {
                    if (expected.status !== row.status) {
                        mismatches.push(`${row.partName}: expected ${expected.status}, got ${row.status}`)
                    }
                    const diffs = metricDiffs(row.metrics, expected.metrics)
                    if (diffs.length > 0) {
                        mismatches.push(`${row.partName}: ${diffs.join('; ')}`)
                    }
                    if (expected.advice !== row.advice) {
                        mismatches.push(`${row.partName}: advice expected "${expected.advice}", got "${row.advice}"`)
                    }
                }
            } catch (error: any) {
                const msg = String(error?.message || error)
                nextRows.push({
                    file,
                    partName: toPartName(file),
                    status: 'ERROR',
                    advice: 'Execution error',
                    metrics: {
                        invertedNormals: 0,
                        badEdges: 0,
                        badContours: 0,
                        nearBadEdges: 0,
                        planarHoles: 0,
                        shells: 0,
                        noiseShells: 0,
                        intersectingTriangles: 0,
                        overlappingTriangles: 0,
                    },
                    elapsedMs: 0,
                    error: msg,
                })
            }
            setRows([...nextRows])
            setCompletedCount(nextRows.length)
        }

        setActiveFile(null)
        setMismatchNotes(mismatches)

        const hasErrors = nextRows.some((r) => r.status === 'ERROR')
        setRunStatus(hasErrors ? 'error' : 'done')
        if (hasErrors) {
            setRunError('One or more fixtures failed to execute. See ERROR rows.')
        }
    }

    const total = STLS_TO_TEST.length
    const passCount = rows.filter((r) => r.status === 'PASS').length
    const failCount = rows.filter((r) => r.status === 'FAIL').length
    const errorCount = rows.filter((r) => r.status === 'ERROR').length

    return (
        <>
            <Navbar pageTitle="Mesh Checks Text Test" showBack />

            <div
                style={{
                    marginTop: 100,
                    padding: '16px 18px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        flexWrap: 'wrap',
                    }}
                >
                    <div data-testid="suite-summary" style={{ fontSize: 14, color: '#cbd5e1' }}>
                        Fixtures: {total} · Completed: {completedCount} · PASS: {passCount} · FAIL: {failCount} · ERROR: {errorCount}
                    </div>
                    <HelloButton
                        onClick={runSuite}
                        disabled={runStatus === 'running'}
                        text={runStatus === 'running' ? 'Running…' : 'Run Fixture Suite'}
                    />
                </div>

                {runStatus === 'running' && (
                    <div data-testid="active-file" style={{ fontSize: 13, color: '#fbbf24' }}>
                        Running: {activeFile}
                    </div>
                )}

                {runError && (
                    <div data-testid="run-error" style={{ color: '#fca5a5', fontSize: 13 }}>
                        {runError}
                    </div>
                )}

                {!expectedSource && (
                    <div style={{ color: '#fbbf24', fontSize: 12 }}>
                        Expected results source not found at /expected/python_expected_results.csv. Run parity script to publish expected values.
                    </div>
                )}

                {expectedSource && (
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>
                        Expected source: {expectedSource}
                    </div>
                )}

                <div
                    style={{
                        border: '1px solid rgba(148, 163, 184, 0.25)',
                        borderRadius: 10,
                        overflowX: 'auto',
                    }}
                >
                    <table
                        data-testid="results-table"
                        style={{
                            width: '100%',
                            borderCollapse: 'collapse',
                            minWidth: 1400,
                            fontSize: 12,
                        }}
                    >
                        <thead>
                            <tr style={{ background: 'rgba(30, 41, 59, 0.7)' }}>
                                <th style={cellHeaderStyle}>Part Name</th>
                                <th style={cellHeaderStyle}>FixInfo</th>
                                <th style={cellHeaderStyle}>Inverted Normals</th>
                                <th style={cellHeaderStyle}>Bad Edges</th>
                                <th style={cellHeaderStyle}>Bad Contours</th>
                                <th style={cellHeaderStyle}>Near Bad Edges</th>
                                <th style={cellHeaderStyle}>Planar Holes</th>
                                <th style={cellHeaderStyle}>Shells</th>
                                <th style={cellHeaderStyle}>Noise Shells</th>
                                <th style={cellHeaderStyle}>Intersecting Triangles</th>
                                <th style={cellHeaderStyle}>Overlapping Triangles</th>
                                <th style={cellHeaderStyle}>Advice</th>
                                <th style={cellHeaderStyle}>ms</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => {
                                const isError = row.status === 'ERROR'
                                const rowBg =
                                    row.status === 'PASS'
                                        ? 'rgba(34,197,94,0.08)'
                                        : row.status === 'FAIL'
                                          ? 'rgba(239,68,68,0.08)'
                                          : 'rgba(239,68,68,0.18)'
                                return (
                                    <tr key={row.file} data-testid={`result-row-${row.partName}`} style={{ background: rowBg }}>
                                        <td style={cellStyle}>{row.partName}</td>
                                        <td style={cellStyle}>{row.status === 'ERROR' ? 'ERROR' : row.status}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.invertedNormals}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.badEdges}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.badContours}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.nearBadEdges}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.planarHoles}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.shells}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.noiseShells}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.intersectingTriangles}</td>
                                        <td style={cellStyle}>{isError ? '-' : row.metrics.overlappingTriangles}</td>
                                        <td style={cellStyle}>{isError ? row.error || 'Execution error' : row.advice}</td>
                                        <td style={cellStyle}>{Math.round(row.elapsedMs)}</td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {runStatus === 'done' && mismatchNotes.length === 0 && (
                    <div data-testid="expected-match" style={{ color: '#86efac', fontSize: 13 }}>
                        All fixture rows match expected diagnostics.
                    </div>
                )}

                {mismatchNotes.length > 0 && (
                    <div data-testid="expected-mismatch" style={{ color: '#fca5a5', fontSize: 13 }}>
                        <div style={{ marginBottom: 6 }}>Expected-value mismatches:</div>
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {mismatchNotes.map((note) => (
                                <li key={note}>{note}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>
        </>
    )
}

const cellHeaderStyle: CSSProperties = {
    textAlign: 'left',
    fontWeight: 700,
    padding: '8px 10px',
    borderBottom: '1px solid rgba(148, 163, 184, 0.3)',
    color: '#e2e8f0',
}

const cellStyle: CSSProperties = {
    padding: '7px 10px',
    borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
    color: '#dbeafe',
    whiteSpace: 'nowrap',
}

export default MeshChecksTextPage