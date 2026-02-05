function HelloButton() {
    return (
        <button
            type="button"
            className="hello-button"
            onClick={() => {
                console.log('Fill Holes')
            }}
        >
            <span className="hello-button__text">Fill Holes</span>
        </button>
    )
}

export default HelloButton
