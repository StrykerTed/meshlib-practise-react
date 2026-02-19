import Navbar from '../components/Navbar'
import { BigPageDiv, DescriptionText, DetailText } from '../styles/SiteStyles'

function NoiseChecksPage() {
    return (
        <>
            <Navbar pageTitle="Noise Checks" showBack />
            <BigPageDiv>
                <DescriptionText>Hello world</DescriptionText>
                <DetailText>
                    Noise shells are small, disconnected triangle clusters in an STL mesh with no geometric meaning and no valid enclosed volume.
                </DetailText>
            </BigPageDiv>
        </>
    )
}

export default NoiseChecksPage
