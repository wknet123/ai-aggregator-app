import { useState, useCallback } from 'react'
import { Upload, X, Image as ImageIcon } from 'lucide-react'

interface FileUploadProps {
  onFileSelect: (file: File) => void
  onFileRemove: () => void
  accept?: string
  maxSize?: number // in MB
  disabled?: boolean
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onFileSelect,
  onFileRemove,
  accept = 'image/jpeg,image/png,image/webp',
  maxSize = 10,
  disabled = false
}) => {
  const [preview, setPreview] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const handleFile = useCallback((file: File) => {
    setError(null)
    
    // Validate file type
    const acceptedTypes = accept.split(',').map(t => t.trim())
    if (!acceptedTypes.includes(file.type)) {
      setError(`Invalid file type. Accepted: ${accept}`)
      return
    }
    
    // Validate file size
    const fileSizeMB = file.size / (1024 * 1024)
    if (fileSizeMB > maxSize) {
      setError(`File size exceeds ${maxSize}MB limit`)
      return
    }
    
    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => {
      setPreview(e.target?.result as string)
      setFileName(file.name)
      onFileSelect(file)
    }
    reader.readAsDataURL(file)
  }, [accept, maxSize, onFileSelect])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFile(file)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFile(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  const handleRemove = () => {
    setPreview(null)
    setFileName(null)
    setError(null)
    onFileRemove()
  }

  return (
    <div className="space-y-2">
      {!preview ? (
        <div
          className={`
            relative border-2 border-dashed rounded-lg p-8
            transition-colors cursor-pointer
            ${isDragging ? 'border-pink-500 bg-pink-500/10' : 'border-gray-700 hover:border-pink-500/50'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <input
            type="file"
            accept={accept}
            onChange={handleChange}
            disabled={disabled}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
          
          <div className="flex flex-col items-center justify-center text-center">
            <Upload className="w-12 h-12 text-gray-500 mb-4" />
            <p className="text-sm text-gray-400 mb-1">
              Click to upload or drag and drop
            </p>
            <p className="text-xs text-gray-500">
              {accept.split(',').map(t => t.split('/')[1]).join(', ').toUpperCase()} (Max {maxSize}MB)
            </p>
          </div>
        </div>
      ) : (
        <div className="relative border border-gray-800/50 rounded-lg overflow-hidden">
          <img
            src={preview}
            alt="Preview"
            className="w-full h-48 object-cover"
          />
          
          <div className="absolute top-2 right-2">
            <button
              onClick={handleRemove}
              disabled={disabled}
              className="p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="absolute bottom-0 left-0 right-0 bg-black/50 backdrop-blur-sm p-2">
            <div className="flex items-center text-white text-sm">
              <ImageIcon className="w-4 h-4 mr-2" />
              <span className="truncate">{fileName}</span>
            </div>
          </div>
        </div>
      )}
      
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
    </div>
  )
}
