import { ReactNode } from 'react'

interface CanvasContainerProps {
    children: ReactNode
}

export function CanvasContainer({ children }: CanvasContainerProps) {
    return (
        <div style={{
            position: 'absolute',
            top: '80px',
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: 'calc(100vh - 80px)',
        }}>
            {children}
        </div>
    )
}
