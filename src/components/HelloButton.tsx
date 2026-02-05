interface HelloButtonProps {
    onClick: () => void
    disabled?: boolean
    text?: string
}

function HelloButton({ onClick, disabled = false, text = 'Fill Holes' }: HelloButtonProps) {
    return (
        <button
            type="button"
            className="hello-button"
            onClick={onClick}
            disabled={disabled}
        >
            <span className="hello-button__text">{text}</span>
        </button>
    )
}

export default HelloButton
