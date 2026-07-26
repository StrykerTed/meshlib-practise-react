import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import BasicsPage from './pages/BasicsPage'
import SimplificationPage from './pages/SimplificationPage'
import SmoothingPage from './pages/SmoothingPage'
import AnnotationsPage from './pages/AnnotationsPage'
import MeshChecksPage from './pages/MeshChecksPage'
import NoiseChecksPage from './pages/NoiseChecksPage'
import RepairPage from './pages/RepairPage'
import MeshChecksTextPage from './pages/MeshChecksTextPage'
import WasmChecksTestPage from './pages/WasmChecksTestPage'

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/basics" element={<BasicsPage />} />
                <Route path="/simplification" element={<SimplificationPage />} />
                <Route path="/smoothing" element={<SmoothingPage />} />
                <Route path="/annotations" element={<AnnotationsPage />} />
                <Route path="/mesh-checks" element={<MeshChecksPage />} />
                <Route path="/mesh-checks-text" element={<MeshChecksTextPage />} />
                <Route path="/noise-checks" element={<NoiseChecksPage />} />
                <Route path="/repair" element={<RepairPage />} />
                <Route path="/findholes-v2" element={<WasmChecksTestPage />} />
                <Route path="/wasm-checks" element={<WasmChecksTestPage />} />
                <Route path="/wasm-tests/findholes-v2" element={<WasmChecksTestPage />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
