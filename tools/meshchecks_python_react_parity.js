import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from '@playwright/test'

const args = new Set(process.argv.slice(2))
const strict = args.has('--strict')
const strictAdvice = args.has('--strict-advice')
const noDevServer = args.has('--no-dev-server')
const allParts = args.has('--all-parts')

const workspaceRoot = process.cwd()
const outputDir = path.join(workspaceRoot, 'playwright-artifacts', 'parity')
const expectedPublicDir = path.join(workspaceRoot, 'public', 'expected')
const pythonEndpoint = process.env.PY_MESHCHECKS_URL || 'http://127.0.0.1:5010/meshchecks/run'
const reactHost = process.env.REACT_PARITY_HOST || '127.0.0.1'
const reactPort = process.env.REACT_PARITY_PORT || '4173'
const reactBaseUrl = `http://${reactHost}:${reactPort}`
const reactPagePath = '/mesh-checks-text?autorun=1'
const reactPageUrl = `${reactBaseUrl}${reactPagePath}`
const baselineCsvPath =
  process.env.PARITY_BASELINE_CSV ||
  path.resolve(workspaceRoot, '..', 'meshlib-python-testing', 'reference', 'magics', 'mesh_report_all_stl_results.csv')

const defaultStlDirs = [
  path.join(workspaceRoot, 'public', 'stl'),
  path.join(workspaceRoot, 'stl'),
  path.resolve(workspaceRoot, '..', 'meshlib-python-testing', 'reference', 'magics'),
]

const extraStlDirs = (process.env.EXTRA_STL_DIRS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
  .map((value) => path.resolve(workspaceRoot, value))

const allStlDirs = [...defaultStlDirs, ...extraStlDirs]

function normalizePartName(name) {
  const trimmed = String(name || '').trim()
  if (trimmed.startsWith('BM-2_0PBL0AA_SURROGATEx ')) return 'BM-2_0PBL0AA_SURROGATEx'
  if (trimmed.startsWith('high_cube ')) return 'high_cube'
  return trimmed
}

function toPartNameFromFile(fileName) {
  const withoutExt = fileName.toLowerCase().endsWith('.stl') ? fileName.slice(0, -4) : fileName
  return normalizePartName(withoutExt)
}

function deriveAdvice(metrics) {
  if (metrics.invertedNormals > 0) return 'Fix normals of inverted triangles'
  if (metrics.planarHoles > 0) return 'Fill planar holes'
  if (metrics.overlappingTriangles > 0) return 'Fix overlapping triangles'
  if (metrics.intersectingTriangles > 0) return 'Fix intersecting triangles'
  if (metrics.badEdges > 0) return 'Fix bad edges'
  if (metrics.noiseShells > 0) return 'Remove noise shells'
  return 'No errors detected'
}

function parseIntSafe(value) {
  const asNumber = Number.parseInt(String(value ?? '0'), 10)
  return Number.isNaN(asNumber) ? 0 : asNumber
}

function parseCsvLine(line) {
  const fields = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      const next = line[index + 1]
      if (inQuotes && next === '"') {
        current += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (char === ',' && !inQuotes) {
      fields.push(current)
      current = ''
      continue
    }
    current += char
  }
  fields.push(current)
  return fields
}

async function loadBaselinePartNames() {
  const csvText = await fs.readFile(baselineCsvPath, 'utf8')
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    throw new Error(`Baseline CSV has no data rows: ${baselineCsvPath}`)
  }

  const headers = parseCsvLine(lines[0])
  const filenameIndex = headers.findIndex((header) => header.trim().toLowerCase() === 'filename')
  if (filenameIndex < 0) {
    throw new Error(`Baseline CSV missing 'filename' header: ${baselineCsvPath}`)
  }

  const partNames = new Set()
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line)
    const fileName = (fields[filenameIndex] || '').trim()
    if (!fileName) continue
    partNames.add(toPartNameFromFile(fileName))
  }

  return partNames
}

function hasIssues(metrics) {
  return (
    metrics.invertedNormals > 0 ||
    metrics.badEdges > 0 ||
    metrics.planarHoles > 0 ||
    metrics.noiseShells > 0 ||
    metrics.intersectingTriangles > 0 ||
    metrics.overlappingTriangles > 0
  )
}

async function listStlFilesRecursively(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const absPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      const nested = await listStlFilesRecursively(absPath)
      files.push(...nested)
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.stl')) {
      files.push(absPath)
    }
  }
  return files
}

async function discoverStlFiles() {
  const found = []
  for (const dirPath of allStlDirs) {
    try {
      const stats = await fs.stat(dirPath)
      if (!stats.isDirectory()) continue
      const files = await listStlFilesRecursively(dirPath)
      for (const filePath of files) {
        found.push(filePath)
      }
    } catch {
      continue
    }
  }

  const byPartName = new Map()
  for (const filePath of found) {
    const fileName = path.basename(filePath)
    const partName = toPartNameFromFile(fileName)
    if (!byPartName.has(partName)) {
      byPartName.set(partName, filePath)
    }
  }

  return [...byPartName.entries()]
    .map(([partName, filePath]) => ({
      partName,
      filePath,
      fileName: path.basename(filePath),
    }))
    .sort((a, b) => a.partName.localeCompare(b.partName))
}

async function postStlToPython(filePath, fileName) {
  const bytes = await fs.readFile(filePath)
  const body = new FormData()
  body.append('file', new Blob([bytes], { type: 'application/sla' }), fileName)

  const response = await fetch(pythonEndpoint, { method: 'POST', body })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Python endpoint ${response.status} for ${fileName}: ${detail.slice(0, 400)}`)
  }

  return response.json()
}

function mapPythonResultToRow(result, sourcePath) {
  if (result?.skipped) {
    return {
      partName: toPartNameFromFile(result.file || ''),
      file: result.file || '',
      sourcePath,
      fixInfo: 'PASS',
      invertedNormals: 0,
      badEdges: 0,
      badContours: 0,
      nearBadEdges: 0,
      planarHoles: 0,
      shells: 0,
      noiseShells: 0,
      intersectingTriangles: 0,
      overlappingTriangles: 0,
      advice: 'Excluded by filename pattern',
      skipped: true,
      skipReason: result.reason || '',
    }
  }

  const metrics = {
    invertedNormals: parseIntSafe(result?.inverted_normals?.local_inverted_count),
    badEdges: parseIntSafe(result?.bad_edges?.bad_edges),
    badContours: parseIntSafe(result?.bad_edges?.bad_contours),
    nearBadEdges: 0,
    planarHoles: parseIntSafe(result?.holes?.count),
    shells: parseIntSafe(result?.noise_shells?.total_components),
    noiseShells: parseIntSafe(result?.noise_shells?.noise_count),
    intersectingTriangles: parseIntSafe(
      result?.self_intersections?.intersecting_triangles ?? result?.self_intersections?.count,
    ),
    overlappingTriangles: parseIntSafe(result?.overlapping_triangles?.count),
  }

  const inferredAllPassed = !hasIssues(metrics)
  const allPassed = typeof result?.all_passed === 'boolean' ? result.all_passed : inferredAllPassed

  return {
    partName: toPartNameFromFile(result.file || ''),
    file: result.file || '',
    sourcePath,
    fixInfo: allPassed ? 'PASS' : 'FAIL',
    invertedNormals: metrics.invertedNormals,
    badEdges: metrics.badEdges,
    badContours: metrics.badContours,
    nearBadEdges: metrics.nearBadEdges,
    planarHoles: metrics.planarHoles,
    shells: metrics.shells,
    noiseShells: metrics.noiseShells,
    intersectingTriangles: metrics.intersectingTriangles,
    overlappingTriangles: metrics.overlappingTriangles,
    advice: deriveAdvice(metrics),
    skipped: false,
    skipReason: '',
  }
}

function csvEscape(value) {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

async function writeCsv(filePath, headers, rows) {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','))
  }
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8')
}

function toComparisonRow(pythonRow, reactRow) {
  const strictFields = [
    'fixInfo',
    'invertedNormals',
    'badEdges',
    'badContours',
    'nearBadEdges',
    'planarHoles',
    'shells',
    'noiseShells',
    'intersectingTriangles',
    'overlappingTriangles',
  ]
  const allFields = strictAdvice ? [...strictFields, 'advice'] : strictFields

  if (!reactRow) {
    return {
      partName: pythonRow.partName,
      status: 'missing_in_react',
      mismatchCount: allFields.length,
      mismatchFields: allFields.join('|'),
      pythonFixInfo: pythonRow.fixInfo,
      reactFixInfo: '',
      pythonBadEdges: pythonRow.badEdges,
      reactBadEdges: '',
      pythonPlanarHoles: pythonRow.planarHoles,
      reactPlanarHoles: '',
      pythonIntersectingTriangles: pythonRow.intersectingTriangles,
      reactIntersectingTriangles: '',
      pythonOverlappingTriangles: pythonRow.overlappingTriangles,
      reactOverlappingTriangles: '',
      pythonNoiseShells: pythonRow.noiseShells,
      reactNoiseShells: '',
      pythonInvertedNormals: pythonRow.invertedNormals,
      reactInvertedNormals: '',
      pythonAdvice: pythonRow.advice,
      reactAdvice: '',
    }
  }

  const mismatches = []
  for (const field of allFields) {
    if (pythonRow[field] !== reactRow[field]) mismatches.push(field)
  }

  return {
    partName: pythonRow.partName,
    status: mismatches.length ? 'mismatch' : 'match',
    mismatchCount: mismatches.length,
    mismatchFields: mismatches.join('|'),
    pythonFixInfo: pythonRow.fixInfo,
    reactFixInfo: reactRow.fixInfo,
    pythonBadEdges: pythonRow.badEdges,
    reactBadEdges: reactRow.badEdges,
    pythonPlanarHoles: pythonRow.planarHoles,
    reactPlanarHoles: reactRow.planarHoles,
    pythonIntersectingTriangles: pythonRow.intersectingTriangles,
    reactIntersectingTriangles: reactRow.intersectingTriangles,
    pythonOverlappingTriangles: pythonRow.overlappingTriangles,
    reactOverlappingTriangles: reactRow.overlappingTriangles,
    pythonNoiseShells: pythonRow.noiseShells,
    reactNoiseShells: reactRow.noiseShells,
    pythonInvertedNormals: pythonRow.invertedNormals,
    reactInvertedNormals: reactRow.invertedNormals,
    pythonAdvice: pythonRow.advice,
    reactAdvice: reactRow.advice,
  }
}

async function waitForServer(url, timeoutMs = 120_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok || response.status === 404) return
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function runWithReactPage() {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(reactPageUrl, { waitUntil: 'domcontentloaded' })

    await page.waitForFunction(
      () => {
        const text = document.querySelector('[data-testid="suite-summary"]')?.textContent || ''
        const fixturesMatch = text.match(/Fixtures:\s*(\d+)/i)
        const completedMatch = text.match(/Completed:\s*(\d+)/i)
        const fixtures = fixturesMatch ? Number.parseInt(fixturesMatch[1] || '0', 10) : 0
        const completed = completedMatch ? Number.parseInt(completedMatch[1] || '0', 10) : 0
        return Number.isFinite(fixtures) && Number.isFinite(completed) && fixtures > 0 && completed >= fixtures
      },
      undefined,
      { timeout: 8 * 60 * 1000 },
    )

    const rows = await page.$$eval('[data-testid^="result-row-"]', (elements) => {
      return elements.map((element) => {
        const cells = Array.from(element.querySelectorAll('td')).map((td) => (td.textContent || '').trim())
        return {
          partName: cells[0] || '',
          fixInfo: cells[1] || '',
          invertedNormals: Number.parseInt(cells[2] || '0', 10) || 0,
          badEdges: Number.parseInt(cells[3] || '0', 10) || 0,
          badContours: Number.parseInt(cells[4] || '0', 10) || 0,
          nearBadEdges: Number.parseInt(cells[5] || '0', 10) || 0,
          planarHoles: Number.parseInt(cells[6] || '0', 10) || 0,
          shells: Number.parseInt(cells[7] || '0', 10) || 0,
          noiseShells: Number.parseInt(cells[8] || '0', 10) || 0,
          intersectingTriangles: Number.parseInt(cells[9] || '0', 10) || 0,
          overlappingTriangles: Number.parseInt(cells[10] || '0', 10) || 0,
          advice: cells[11] || '',
        }
      })
    })

    return rows
  } finally {
    await browser.close()
  }
}

async function main() {
  await fs.mkdir(outputDir, { recursive: true })
  await fs.mkdir(expectedPublicDir, { recursive: true })

  const baselinePartNames = await loadBaselinePartNames()
  const discovered = (await discoverStlFiles()).filter((fixture) => baselinePartNames.has(fixture.partName))
  if (!discovered.length) {
    throw new Error(`No STL files found. Searched: ${allStlDirs.join(', ')}`)
  }

  console.log(`[parity] Found ${discovered.length} unique STL parts across ${allStlDirs.length} directories`)
  console.log(`[parity] Baseline CSV: ${baselineCsvPath}`)
  console.log(`[parity] Baseline part count: ${baselinePartNames.size}`)
  console.log(`[parity] Python endpoint: ${pythonEndpoint}`)

  const pythonRows = []
  for (const fixture of discovered) {
    try {
      const result = await postStlToPython(fixture.filePath, fixture.fileName)
      const row = mapPythonResultToRow(result, path.relative(workspaceRoot, fixture.filePath))
      if (!row.partName) row.partName = fixture.partName
      pythonRows.push(row)
      console.log(`[python] ${row.partName} -> ${row.fixInfo}`)
    } catch (error) {
      pythonRows.push({
        partName: fixture.partName,
        file: fixture.fileName,
        sourcePath: path.relative(workspaceRoot, fixture.filePath),
        fixInfo: 'ERROR',
        invertedNormals: 0,
        badEdges: 0,
        badContours: 0,
        nearBadEdges: 0,
        planarHoles: 0,
        shells: 0,
        noiseShells: 0,
        intersectingTriangles: 0,
        overlappingTriangles: 0,
        advice: 'Python endpoint error',
        skipped: false,
        skipReason: String(error),
      })
      console.log(`[python] ${fixture.partName} -> ERROR`)
    }
  }

  const pythonCsvHeaders = [
    'partName',
    'file',
    'sourcePath',
    'fixInfo',
    'invertedNormals',
    'badEdges',
    'badContours',
    'nearBadEdges',
    'planarHoles',
    'shells',
    'noiseShells',
    'intersectingTriangles',
    'overlappingTriangles',
    'advice',
    'skipped',
    'skipReason',
  ]

  const pythonCsvPath = path.join(outputDir, 'python_expected_results.csv')
  await writeCsv(pythonCsvPath, pythonCsvHeaders, pythonRows)
  const pythonCsvPublicPath = path.join(expectedPublicDir, 'python_expected_results.csv')
  await writeCsv(pythonCsvPublicPath, pythonCsvHeaders, pythonRows)

  let devServer = null
  try {
    if (!noDevServer) {
      devServer = spawn(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', 'dev', '--', '--host', reactHost, '--port', reactPort],
        {
          cwd: workspaceRoot,
          stdio: 'ignore',
        },
      )
      await waitForServer(reactBaseUrl)
    }

    const reactRows = await runWithReactPage()
    const normalizedReactRows = reactRows.map((row) => ({ ...row, partName: normalizePartName(row.partName) }))
    const dedupedReactRows = []
    const seenReactParts = new Set()
    for (const row of normalizedReactRows) {
      if (!baselinePartNames.has(row.partName)) continue
      if (seenReactParts.has(row.partName)) continue
      seenReactParts.add(row.partName)
      dedupedReactRows.push(row)
    }

    const reactCsvHeaders = [
      'partName',
      'fixInfo',
      'invertedNormals',
      'badEdges',
      'badContours',
      'nearBadEdges',
      'planarHoles',
      'shells',
      'noiseShells',
      'intersectingTriangles',
      'overlappingTriangles',
      'advice',
    ]

    const reactCsvPath = path.join(outputDir, 'react_wasm_results.csv')
    await writeCsv(reactCsvPath, reactCsvHeaders, dedupedReactRows)

    const reactByPart = new Map(dedupedReactRows.map((row) => [row.partName, row]))
    const overlappingPartNames = new Set(
      pythonRows
        .map((pythonRow) => pythonRow.partName)
        .filter((partName) => reactByPart.has(partName)),
    )

    const pythonRowsForComparison = allParts
      ? pythonRows
      : pythonRows.filter((pythonRow) => overlappingPartNames.has(pythonRow.partName))

    const comparisons = pythonRowsForComparison.map((pythonRow) => toComparisonRow(pythonRow, reactByPart.get(pythonRow.partName)))

    const reactOnlyParts = dedupedReactRows
      .filter((row) => !pythonRows.some((pythonRow) => pythonRow.partName === row.partName))
      .map((row) => row.partName)

    const comparisonCsvHeaders = [
      'partName',
      'status',
      'mismatchCount',
      'mismatchFields',
      'pythonFixInfo',
      'reactFixInfo',
      'pythonBadEdges',
      'reactBadEdges',
      'pythonPlanarHoles',
      'reactPlanarHoles',
      'pythonIntersectingTriangles',
      'reactIntersectingTriangles',
      'pythonOverlappingTriangles',
      'reactOverlappingTriangles',
      'pythonNoiseShells',
      'reactNoiseShells',
      'pythonInvertedNormals',
      'reactInvertedNormals',
      'pythonAdvice',
      'reactAdvice',
    ]

    const comparisonCsvPath = path.join(outputDir, 'python_vs_react_comparison.csv')
    await writeCsv(comparisonCsvPath, comparisonCsvHeaders, comparisons)

    const summary = {
      generatedAt: new Date().toISOString(),
      strict,
      strictAdvice,
      allParts,
      baselineCsvPath,
      baselinePartCount: baselinePartNames.size,
      pythonEndpoint,
      reactPageUrl,
      searchedStlDirs: allStlDirs,
      totalPythonParts: pythonRows.length,
      totalReactParts: dedupedReactRows.length,
      comparedParts: pythonRowsForComparison.length,
      matchCount: comparisons.filter((row) => row.status === 'match').length,
      mismatchCount: comparisons.filter((row) => row.status !== 'match').length,
      reactOnlyParts,
      outputFiles: {
        pythonExpectedCsv: pythonCsvPath,
        pythonExpectedCsvPublic: pythonCsvPublicPath,
        reactWasmCsv: reactCsvPath,
        comparisonCsv: comparisonCsvPath,
      },
    }

    const summaryPath = path.join(outputDir, 'summary.json')
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

    console.log(`[parity] Wrote ${pythonCsvPath}`)
    console.log(`[parity] Wrote ${pythonCsvPublicPath}`)
    console.log(`[parity] Wrote ${reactCsvPath}`)
    console.log(`[parity] Wrote ${comparisonCsvPath}`)
    console.log(`[parity] Wrote ${summaryPath}`)
    console.log(`[parity] Matches: ${summary.matchCount} | Mismatches: ${summary.mismatchCount}`)

    if (strict && summary.mismatchCount > 0) {
      process.exitCode = 1
    }
  } finally {
    if (devServer && !devServer.killed) {
      devServer.kill('SIGTERM')
    }
  }
}

main().catch((error) => {
  console.error('[parity] Fatal:', error)
  process.exit(1)
})
