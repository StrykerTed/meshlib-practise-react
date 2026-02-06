import Navbar from '../components/Navbar'

function SimplificationPage() {
    return (
        <>
            <Navbar pageTitle="Simplification" showBack />
            <div style={{
                paddingTop: 120,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
                color: '#94a3b8',
            }}>
                <h2 style={{ color: '#e2e8f0', fontWeight: 400, fontSize: 28 }}>
                    Mesh Simplification
                </h2>
                <p style={{ maxWidth: 480, textAlign: 'center', lineHeight: 1.6 }}>
                    Reduce triangle count while preserving mesh quality.
                    This page is a placeholder — implementation coming soon.
                </p>
                <div style={{
                    marginTop: 24,
                    padding: '12px 24px',
                    borderRadius: 12,
                    border: '1px solid rgba(148,163,184,0.15)',
                    background: 'rgba(15,23,42,0.5)',
                    fontSize: 13,
                    color: '#64748b',
                }}>
                    🚧 Under construction
                </div>
            </div>
        </>
    )
}

export default SimplificationPage
