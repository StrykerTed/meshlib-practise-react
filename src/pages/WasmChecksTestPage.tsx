import { type ChangeEvent, useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'
import HelloButton from '../components/HelloButton'
import { WasmChecksHolesClient } from '../lib/wasmChecksHolesClient'
import { SelfIntersectionsClient } from '../lib/selfIntersectionsClient'
import { OverlappingTrianglesClient } from '../lib/overlappingTrianglesClient'
import { BadEdgesClient } from '../lib/badEdgesClient'
import { NoiseShellsClient } from '../lib/noiseShellsClient'
import { InvertedNormalsClient } from '../lib/invertedNormalsClient'

function WasmChecksTestPage() {
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [activeAction, setActiveAction] = useState<string | null>(null)
    const [status, setStatus] = useState('')
    const [error, setError] = useState('')
    const [holeCount, setHoleCount] = useState<number | null>(null)
    const [selfIntersectionsCount, setSelfIntersectionsCount] = useState<number | null>(null)
    const [overlappingCount, setOverlappingCount] = useState<number | null>(null)
    const [badEdgesCount, setBadEdgesCount] = useState<number | null>(null)
    const [badContoursCount, setBadContoursCount] = useState<number | null>(null)
    const [noiseShellsCount, setNoiseShellsCount] = useState<number | null>(null)
    const [noiseComponentsCount, setNoiseComponentsCount] = useState<number | null>(null)
    const [localInvertedCount, setLocalInvertedCount] = useState<number | null>(null)
    const [isClosedMesh, setIsClosedMesh] = useState<boolean | null>(null)
    const [isGloballyInverted, setIsGloballyInverted] = useState<boolean | null>(null)

    const holesClientRef = useRef<WasmChecksHolesClient | null>(null)
    const selfIntersectionsClientRef = useRef<SelfIntersectionsClient | null>(null)
    const overlappingClientRef = useRef<OverlappingTrianglesClient | null>(null)
    const badEdgesClientRef = useRef<BadEdgesClient | null>(null)
    const noiseShellsClientRef = useRef<NoiseShellsClient | null>(null)
    const invertedNormalsClientRef = useRef<InvertedNormalsClient | null>(null)

    useEffect(() => {
        const holesClient = new WasmChecksHolesClient()
        const selfIntersectionsClient = new SelfIntersectionsClient()
        const overlappingClient = new OverlappingTrianglesClient()
        const badEdgesClient = new BadEdgesClient()
        const noiseShellsClient = new NoiseShellsClient()
        const invertedNormalsClient = new InvertedNormalsClient()

        holesClientRef.current = holesClient
        selfIntersectionsClientRef.current = selfIntersectionsClient
        overlappingClientRef.current = overlappingClient
        badEdgesClientRef.current = badEdgesClient
        noiseShellsClientRef.current = noiseShellsClient
        invertedNormalsClientRef.current = invertedNormalsClient

        return () => {
            holesClientRef.current = null
            selfIntersectionsClientRef.current = null
            overlappingClientRef.current = null
            badEdgesClientRef.current = null
            noiseShellsClientRef.current = null
            invertedNormalsClientRef.current = null

            holesClient.dispose()
            selfIntersectionsClient.dispose()
            overlappingClient.dispose()
            badEdgesClient.dispose()
            noiseShellsClient.dispose()
            invertedNormalsClient.dispose()
        }
    }, [])

    function onFileChange(event: ChangeEvent<HTMLInputElement>) {
        const nextFile = event.target.files?.[0] ?? null
        setSelectedFile(nextFile)
        setError('')
        setStatus('')
        setActiveAction(null)
        setHoleCount(null)
        setSelfIntersectionsCount(null)
        setOverlappingCount(null)
        setBadEdgesCount(null)
        setBadContoursCount(null)
        setNoiseShellsCount(null)
        setNoiseComponentsCount(null)
        setLocalInvertedCount(null)
        setIsClosedMesh(null)
        setIsGloballyInverted(null)
    }

    async function readInputBytes() {
        if (!selectedFile) throw new Error('No STL selected')
        setStatus('Reading STL…')
        return await selectedFile.arrayBuffer()
    }

    async function onFindHolesV2() {
        const client = holesClientRef.current
        if (!selectedFile || activeAction || !client) return

        setActiveAction('holes')
        setError('')

        try {
            const input = await readInputBytes()
            setStatus('Running Find Holes v2 (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setHoleCount(result.count)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms`)
        } catch (e: any) {
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setActiveAction(null)
        }
    }

    async function onDetectSelfIntersections() {
        const client = selfIntersectionsClientRef.current
        if (!selectedFile || activeAction || !client) return

        setActiveAction('self')
        setError('')

        try {
            const input = await readInputBytes()
            setStatus('Running Self Intersections detect (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setSelfIntersectionsCount(result.count)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms`)
        } catch (e: any) {
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setActiveAction(null)
        }
    }

    async function onDetectOverlappingTriangles() {
        const client = overlappingClientRef.current
        if (!selectedFile || activeAction || !client) return

        setActiveAction('overlap')
        setError('')

        try {
            const input = await readInputBytes()
            setStatus('Running Overlapping Triangles detect (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setOverlappingCount(result.count)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms`)
        } catch (e: any) {
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setActiveAction(null)
        }
    }

    async function onDetectBadEdges() {
        const client = badEdgesClientRef.current
        if (!selectedFile || activeAction || !client) return

        setActiveAction('bad-edges')
        setError('')

        try {
            const input = await readInputBytes()
            setStatus('Running Bad Edges detect (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setBadEdgesCount(result.badEdgesCount)
            setBadContoursCount(result.badContoursCount)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms`)
        } catch (e: any) {
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setActiveAction(null)
        }
    }

    async function onDetectNoiseShells() {
        const client = noiseShellsClientRef.current
        if (!selectedFile || activeAction || !client) return

        setActiveAction('noise')
        setError('')

        try {
            const input = await readInputBytes()
            setStatus('Running Noise Shells detect (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setNoiseComponentsCount(result.totalComponents)
            setNoiseShellsCount(result.noiseCount)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms`)
        } catch (e: any) {
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setActiveAction(null)
        }
    }

    async function onDetectInvertedNormals() {
        const client = invertedNormalsClientRef.current
        if (!selectedFile || activeAction || !client) return

        setActiveAction('inverted')
        setError('')

        try {
            const input = await readInputBytes()
            setStatus('Running Inverted Normals detect (WASM)…')
            const startMs = performance.now()
            const result = await client.detect(input, {
                onStatus: (stage) => setStatus(stage),
            })
            const elapsedMs = performance.now() - startMs
            setLocalInvertedCount(result.localInvertedCount)
            setIsClosedMesh(result.isClosed)
            setIsGloballyInverted(result.isInverted)
            setStatus(`Done in ${elapsedMs.toFixed(0)} ms`)
        } catch (e: any) {
            setError(String(e?.message || e))
            setStatus('')
        } finally {
            setActiveAction(null)
        }
    }

    return (
        <>
            <Navbar pageTitle="WASM Checks Test" showBack />
            <div
                style={{
                    minHeight: '100vh',
                    paddingTop: '120px',
                    display: 'flex',
                    justifyContent: 'center',
                    background: '#0a0a0a',
                    color: '#f3f4f6',
                }}
            >
                <div
                    style={{
                        width: '100%',
                        maxWidth: '760px',
                        padding: '24px',
                        border: '1px solid #374151',
                        borderRadius: '12px',
                        background: '#111827',
                    }}
                >
                    <h2 style={{ marginTop: 0, marginBottom: '14px' }}>Upload STL</h2>
                    <input
                        type="file"
                        accept=".stl,model/stl"
                        onChange={onFileChange}
                        style={{ marginBottom: '16px', display: 'block' }}
                    />

                    <div style={{ marginBottom: '16px', opacity: 0.9 }}>
                        <strong>Selected:</strong> {selectedFile?.name ?? 'None'}
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                        <HelloButton
                            onClick={onFindHolesV2}
                            disabled={!selectedFile || Boolean(activeAction)}
                            text={activeAction === 'holes' ? 'Finding Holes v2…' : 'Find Holes v2'}
                        />
                        <HelloButton
                            onClick={onDetectSelfIntersections}
                            disabled={!selectedFile || Boolean(activeAction)}
                            text={activeAction === 'self' ? 'Detecting…' : 'Detect Self Intersections'}
                        />
                        <HelloButton
                            onClick={onDetectOverlappingTriangles}
                            disabled={!selectedFile || Boolean(activeAction)}
                            text={activeAction === 'overlap' ? 'Detecting…' : 'Detect Overlapping Triangles'}
                        />
                        <HelloButton
                            onClick={onDetectBadEdges}
                            disabled={!selectedFile || Boolean(activeAction)}
                            text={activeAction === 'bad-edges' ? 'Detecting…' : 'Detect Bad Edges'}
                        />
                        <HelloButton
                            onClick={onDetectNoiseShells}
                            disabled={!selectedFile || Boolean(activeAction)}
                            text={activeAction === 'noise' ? 'Detecting…' : 'Detect Noise Shells'}
                        />
                        <HelloButton
                            onClick={onDetectInvertedNormals}
                            disabled={!selectedFile || Boolean(activeAction)}
                            text={activeAction === 'inverted' ? 'Detecting…' : 'Check Inverted Normals'}
                        />
                    </div>

                    <div style={{ marginTop: '18px' }}>
                        {status && <div><strong>Status:</strong> {status}</div>}
                        {error && <div style={{ color: '#fca5a5' }}><strong>Error:</strong> {error}</div>}
                        {holeCount !== null && <div style={{ marginTop: '10px' }}><strong>Hole count:</strong> {holeCount}</div>}
                        {selfIntersectionsCount !== null && <div><strong>Self intersections:</strong> {selfIntersectionsCount}</div>}
                        {overlappingCount !== null && <div><strong>Overlapping triangles:</strong> {overlappingCount}</div>}
                        {badEdgesCount !== null && <div><strong>Bad edges:</strong> {badEdgesCount}</div>}
                        {badContoursCount !== null && <div><strong>Bad contours:</strong> {badContoursCount}</div>}
                        {noiseShellsCount !== null && <div><strong>Noise shells:</strong> {noiseShellsCount}</div>}
                        {noiseComponentsCount !== null && <div><strong>Total components:</strong> {noiseComponentsCount}</div>}
                        {localInvertedCount !== null && <div><strong>Local inverted triangles:</strong> {localInvertedCount}</div>}
                        {isClosedMesh !== null && <div><strong>Mesh closed:</strong> {String(isClosedMesh)}</div>}
                        {isGloballyInverted !== null && <div><strong>Globally inverted:</strong> {String(isGloballyInverted)}</div>}
                    </div>
                </div>
            </div>
        </>
    )
}

export default WasmChecksTestPage
