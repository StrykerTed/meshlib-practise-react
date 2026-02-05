import { COLORS } from '../constants/colors'

function Navbar() {
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
            <img
                src="/images/logo.svg"
                alt="Logo"
                style={{
                    height: '40px',
                    width: 'auto',
                }}
            />
            <h1
                style={{
                    color: COLORS.sykloneYellow,
                    fontSize: '32px',
                    fontWeight: 300,
                    margin: 0,
                    position: 'absolute',
                    left: '50%',
                    transform: 'translateX(-50%)',
                }}
            >
                MeshLib WASM Experiments
            </h1>
        </nav>
    )
}

export default Navbar
