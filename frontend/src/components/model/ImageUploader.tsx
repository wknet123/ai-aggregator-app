import { useState, useRef } from 'react'
import { Plus, X, ZoomIn, Image as ImageIcon } from 'lucide-react'

interface UploadedImage {
  id: string
  file?: File          // absent for refilled images (restored from a server fileId, no local File)
  previewUrl: string
  fileId?: string // Server-side file ID after upload
}

interface ImageUploaderProps {
  onImagesChange: (images: UploadedImage[]) => void
  onUpload: (file: File, index: number) => Promise<string> // Returns file_id
  disabled?: boolean
  maxImages?: number
  mode?: 'video' | 'image' // 'video' for video frames, 'image' for reference image
  initialImages?: UploadedImage[] // seed slots (e.g. restored from history refill); read once at mount
}

export default function ImageUploader({
  onImagesChange,
  onUpload,
  disabled = false,
  maxImages = 3,
  mode = 'video',
  initialImages,
}: ImageUploaderProps) {
  // Uncontrolled: internal slot state seeds once from initialImages at mount. Callers
  // that need to re-seed (history refill) change the component `key` to force a remount.
  const seedSlots = (): (UploadedImage | null)[] => {
    const slots: (UploadedImage | null)[] = [null, null, null]
    ;(initialImages || []).slice(0, 3).forEach((img, i) => { slots[i] = img })
    return slots
  }
  const [images, setImages] = useState<(UploadedImage | null)[]>(seedSlots)
  const [uploading, setUploading] = useState<boolean[]>([false, false, false])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const fileInputRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]

  const handleFileSelect = async (index: number, file: File) => {
    if (!file || disabled) return

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      alert('请上传 JPEG, PNG 或 WebP 格式的图片')
      return
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      alert('图片大小不能超过 10MB')
      return
    }

    // Create preview URL
    const previewUrl = URL.createObjectURL(file)
    const tempImage: UploadedImage = {
      id: crypto.randomUUID(),
      file,
      previewUrl,
    }

    // Update state with temporary image
    const newImages = [...images]
    newImages[index] = tempImage
    setImages(newImages)

    // Set uploading state
    const newUploading = [...uploading]
    newUploading[index] = true
    setUploading(newUploading)

    try {
      // Upload to server
      const fileId = await onUpload(file, index)
      
      // Update with server file ID
      const uploadedImage: UploadedImage = {
        ...tempImage,
        fileId,
      }
      
      const finalImages = [...newImages]
      finalImages[index] = uploadedImage
      setImages(finalImages)
      
      // Notify parent
      onImagesChange(finalImages.filter((img): img is UploadedImage => img !== null))
    } catch (error) {
      // Remove failed upload
      const revertedImages = [...newImages]
      revertedImages[index] = null
      setImages(revertedImages)
      alert('上传失败，请重试')
    } finally {
      const finalUploading = [...uploading]
      finalUploading[index] = false
      setUploading(finalUploading)
    }
  }

  const handleRemove = (index: number) => {
    if (disabled) return
    
    const image = images[index]
    if (image) {
      URL.revokeObjectURL(image.previewUrl)
    }
    
    const newImages = [...images]
    newImages[index] = null
    setImages(newImages)
    
    onImagesChange(newImages.filter((img): img is UploadedImage => img !== null))
  }

  const handleInputChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileSelect(index, file)
    }
    // Reset input
    e.target.value = ''
  }

  const getSlotLabel = (index: number) => {
    if (mode === 'image') {
      return '参考图 (可选)'
    }
    if (index === 0) return '首帧'
    return `图${index + 1} (可选)`
  }

  return (
    <>
      <div className="flex items-end gap-2">
        {images.slice(0, maxImages).map((image, index) => (
          <div key={index} className="flex flex-col items-center">
            {/* Upload Slot */}
            <div
              className={
                "relative w-14 h-14 md:w-16 md:h-16 rounded-lg overflow-hidden " +
                "border-2 border-dashed transition-all duration-200 " +
                (image 
                  ? "border-pink-500/50 bg-[#16161a]" 
                  : "border-gray-600 bg-[#1a1a1f] hover:border-gray-500 hover:bg-[#252530]") +
                (disabled ? " opacity-50 cursor-not-allowed" : " cursor-pointer") +
                " group"
              }
              onClick={() => !disabled && !image && fileInputRefs[index].current?.click()}
            >
              {uploading[index] ? (
                /* Loading State */
                <div className="absolute inset-0 flex items-center justify-center bg-[#1a1a1f]">
                  <div className="w-6 h-6 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : image ? (
                /* Image Preview */
                <>
                  <img
                    src={image.previewUrl}
                    alt={"Image " + (index + 1)}
                    className="w-full h-full object-cover"
                  />
                  {/* Hover Overlay with Zoom */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setPreviewImage(image.previewUrl) }}
                      className="p-1.5 bg-white/20 rounded-full hover:bg-white/30 transition-colors"
                    >
                      <ZoomIn className="w-4 h-4 text-white" />
                    </button>
                  </div>
                  {/* Remove Button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRemove(index) }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  >
                    <X className="w-3 h-3 text-white" />
                  </button>
                </>
              ) : (
                /* Empty Slot */
                <div className="absolute inset-0 flex items-center justify-center">
                  <Plus className="w-5 h-5 text-gray-500 group-hover:text-gray-400 transition-colors" />
                </div>
              )}

              {/* Hidden Input */}
              <input
                ref={fileInputRefs[index]}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => handleInputChange(index, e)}
                disabled={disabled}
              />
            </div>

            {/* Label */}
            <span className={"text-[10px] mt-1 " + (image ? "text-pink-400" : "text-gray-500")}>
              {getSlotLabel(index)}
            </span>
          </div>
        ))}
      </div>

      {/* Full Image Preview Modal */}
      {previewImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <button
              className="absolute -top-10 right-0 text-gray-300 hover:text-white transition-colors"
              onClick={() => setPreviewImage(null)}
            >
              <X className="w-8 h-8" />
            </button>
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-[85vh] object-contain rounded-lg border border-gray-800/50"
            />
          </div>
        </div>
      )}
    </>
  )
}

export type { UploadedImage }
