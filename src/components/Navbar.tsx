import { useNavigate } from 'react-router-dom'
import { COLORS } from '../constants/colors'

interface NavbarProps {
    /** Page title shown in the centre. Defaults to the site name. */
    pageTitle?: string
    /** Show a ← Back button on the left that navigates home. */
    showBack?: boolean
}

function Navbar({ pageTitle = 'MeshLib WASM Experiments', showBack = false }: NavbarProps) {
    const navigate = useNavigate()

    return (
        <nav
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                height: '80px',
                backgroundColor: COLORS.black,
                borderBottom: `1px solid ${COLORS.borderGray}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 18px',
                zIndex: 99,
                boxSizing: 'border-box',
            }}
        >
            {/* Left slot */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 160 }}>
                <img
                    src="/images/logo.svg"
                    alt="DigitalRnD Logo"
                    style={{ height: '40px', width: 'auto' }}
                />
                {showBack && (
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            background: 'none',
                            border: '1px solid rgba(148,163,184,0.25)',
                            borderRadius: 8,
                            color: '#94a3b8',
                            fontSize: 13,
                            fontWeight: 500,
                            padding: '6px 14px',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.color = '#e2e8f0'
                            e.currentTarget.style.borderColor = 'rgba(148,163,184,0.5)'
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.color = '#94a3b8'
                            e.currentTarget.style.borderColor = 'rgba(148,163,184,0.25)'
                        }}
                    >
                        ← Back
                    </button>
                )}
            </div>

            {/* Centre title */}
            <h1
                style={{
                    color: COLORS.sykloneYellow,
                    fontSize: '24px',
                    fontWeight: 300,
                    margin: 0,
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    whiteSpace: 'nowrap',
                }}
            >
                {pageTitle}
            </h1>

            {/* Right slot (spacer for symmetry) */}
            <div style={{ minWidth: 160 }} />
        </nav>
    )
}

export default Navbar
