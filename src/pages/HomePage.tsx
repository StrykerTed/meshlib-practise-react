import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { routeLinks } from '../routeLinks'

function HomePage() {
    return (
        <>
            <Navbar />
            <div style={{
                paddingTop: 100,
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 0,
            }}>
                {/* ---- Hero / Logo ---- */}
                <img
                    src="/images/meshlib_logo.png"
                    alt="MeshLib"
                    style={{
                        width: 'min(480px, 80vw)',
                        height: 'auto',
                        marginBottom: 32,
                        filter: 'drop-shadow(0 0 50px rgba(255,181,0,0.2))',
                    }}
                />

                <p style={{
                    color: '#94a3b8',
                    fontSize: 16,
                    maxWidth: 600,
                    textAlign: 'center',
                    lineHeight: 1.7,
                    marginBottom: 8,
                }}>
                    A demo &amp; testing site for running{' '}
                    <span style={{ color: '#e2e8f0' }}>MeshLib</span> mesh-processing
                    algorithms in the browser via WebAssembly.
                </p>

                <p style={{
                    color: '#64748b',
                    fontSize: 13,
                    maxWidth: 560,
                    textAlign: 'center',
                    lineHeight: 1.6,
                    marginBottom: 40,
                }}>
                    MeshLib is a robust C++ library designed for managing, processing, and
                    handling I/O operations of triangulated surface meshes. It provides an
                    efficient framework to store, manipulate, and process meshes — including
                    algorithms for hole filling, self-intersection repair, remeshing,
                    registration, and more. All computations use 64-bit double precision.
                    <br />
                    <span style={{ color: '#475569' }}>
                        © Stryker Corporation and its affiliates.
                    </span>
                </p>

                {/* ---- Route cards ---- */}
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 20,
                    justifyContent: 'center',
                    maxWidth: 720,
                    width: '100%',
                    padding: '0 20px',
                }}>
                    {routeLinks.map((link) => (
                        <Link
                            key={link.path}
                            to={link.path}
                            style={{ textDecoration: 'none', flex: '1 1 300px', maxWidth: 340 }}
                        >
                            <div className="route-card">
                                <h3 className="route-card__title">{link.title}</h3>
                                <p className="route-card__desc">{link.description}</p>
                                <span className="route-card__arrow">→</span>
                            </div>
                        </Link>
                    ))}
                </div>

                {/* ---- Footer ---- */}
                <div style={{
                    marginTop: 'auto',
                    paddingTop: 60,
                    paddingBottom: 24,
                    color: '#334155',
                    fontSize: 12,
                    textAlign: 'center',
                }}>
                    DigitalRnD · MeshLib WASM Experiments
                </div>
            </div>
        </>
    )
}

export default HomePage
