import styled from 'styled-components'

export const BigPageDiv = styled.div`
    padding-top: 100px;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
`

export const LogoImage = styled.img`
    width: min(480px, 80vw);
    height: auto;
    margin-bottom: 32px;
    filter: drop-shadow(0 0 50px rgba(255,181,0,0.2));
`

export const DescriptionText = styled.p`
    color: #94a3b8;
    font-size: 16px;
    max-width: 600px;
    text-align: center;
    line-height: 1.7;
    margin-bottom: 8px;
`

export const DetailText = styled.p`
    color: #64748b;
    font-size: 13px;
    max-width: 560px;
    text-align: center;
    line-height: 1.6;
    margin-bottom: 40px;
`

export const CopyrightText = styled.span`
    color: #475569;
`

export const Footer = styled.div`
    margin-top: auto;
    padding-top: 60px;
    padding-bottom: 24px;
    color: #ffb500;
    font-size: 12px;
    text-align: center;
`

export const HighlightText = styled.span`
    color: #e2e8f0;
`

export const RouteCardsContainer = styled.div`
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    justify-content: center;
    max-width: 720px;
    width: 100%;
    padding: 0 20px;
`
