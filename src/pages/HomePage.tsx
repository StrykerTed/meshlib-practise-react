import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { routeLinks } from '../routeLinks'
import { BigPageDiv, LogoImage, DescriptionText, DetailText, CopyrightText, Footer, HighlightText, RouteCardsContainer } from '../styles/SiteStyles'

function HomePage() {
    return (
        <>
            <Navbar />
            <BigPageDiv>
                <LogoImage
                    src="/images/meshlib_logo.png"
                    alt="MeshLib"
                />

                <DescriptionText>
                    A demo &amp; testing site for running{' '}
                    <HighlightText>MeshLib</HighlightText> mesh-processing
                    algorithms in the browser via WebAssembly.
                </DescriptionText>

                <DetailText>
                    MeshLib is a robust C++ library designed for managing, processing, and
                    handling I/O operations of triangulated surface meshes. It provides an
                    efficient framework to store, manipulate, and process meshes — including
                    algorithms for hole filling, self-intersection repair, remeshing,
                    registration, and more. All computations use 64-bit double precision.
                    <br />
                    <CopyrightText>
                        © Stryker Corporation and its affiliates.
                    </CopyrightText>
                </DetailText>

                <RouteCardsContainer>
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
                </RouteCardsContainer>

                <Footer>
                    DigitalRnD · MeshLib WASM Experiments
                </Footer>
            </BigPageDiv>
        </>
    )
}

export default HomePage