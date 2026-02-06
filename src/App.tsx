import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HomePage from './pages/HomePage'
import BasicsPage from './pages/BasicsPage'
import SimplificationPage from './pages/SimplificationPage'

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/basics" element={<BasicsPage />} />
                <Route path="/simplification" element={<SimplificationPage />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
