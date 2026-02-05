interface FileSelectorProps {
    files: string[]
    selectedFile: string
    onFileSelect: (filename: string) => void
}

function FileSelector({ files, selectedFile, onFileSelect }: FileSelectorProps) {
    return (
        <div className="ui-panel">
            <label>
                STL File:
                <select
                    value={selectedFile}
                    onChange={(e) => onFileSelect(e.target.value)}
                >
                    {files.map((file) => (
                        <option key={file} value={file}>
                            {file}
                        </option>
                    ))}
                </select>
            </label>
        </div>
    )
}

export default FileSelector
