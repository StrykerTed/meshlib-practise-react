import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import BasicsPage from './pages/BasicsPage'
import SimplificationPage from './pages/SimplificationPage'
import SmoothingPage from './pages/SmoothingPage'
import AnnotationsPage from './pages/AnnotationsPage'

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/basics" element={<BasicsPage />} />
                <Route path="/simplification" element={<SimplificationPage />} />
                <Route path="/smoothing" element={<SmoothingPage />} />
                <Route path="/annotations" element={<AnnotationsPage />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
