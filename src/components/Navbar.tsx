import { useNavigate } from 'react-router-dom'
import { COLORS } from '../constants/colors'

interface NavbarProps {
    pageTitle?: string
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
                        className="hello-button"
                        style={{
                            padding: '6px 16px',
                            fontSize: '0.8rem',
                            borderRadius: 10,
                            letterSpacing: 0.5,
                        }}
                    >
                        <span className="hello-button__text">← Back</span>
                    </button>
                )}
            </div>

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

            <div style={{ minWidth: 160 }} />
        </nav>
    )
}

export default Navbar
