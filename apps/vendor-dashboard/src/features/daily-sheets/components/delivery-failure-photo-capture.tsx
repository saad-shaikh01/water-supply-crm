'use client';

import { useRef, useState } from 'react';
import { Camera, Check, X, Loader2 } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { useUploadDeliveryPhoto } from '../hooks/use-daily-sheets';

interface DeliveryFailurePhotoCaptureProps {
  photoKey: string | null;
  onPhotoChange: (key: string | null) => void;
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

// Phone cameras routinely produce 8-20MB photos. Holding that much image data in
// memory (preview blob + upload buffer) on a low-RAM device increases the odds the
// OS kills the backgrounded tab. Downscale/re-encode client-side before upload.
async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  } catch {
    // Compression unsupported/failed — fall back to the original file rather than blocking capture.
    return file;
  }
}

export function DeliveryFailurePhotoCapture({ photoKey, onPhotoChange }: DeliveryFailurePhotoCaptureProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { mutate: uploadPhoto } = useUploadDeliveryPhoto();

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setPreviewUrl(URL.createObjectURL(file));
    setLoading(true);
    const uploadFile = await compressImage(file);
    uploadPhoto(uploadFile, {
      onSuccess: (data) => {
        setLoading(false);
        onPhotoChange(data.key);
      },
      onError: () => {
        setLoading(false);
        setError('Upload failed — tap to retry');
      },
    });
  }

  function handleRemove() {
    setPreviewUrl(null);
    setError(null);
    onPhotoChange(null);
  }

  return (
    <div className="space-y-2">
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Photo Evidence (optional)
      </span>

      {photoKey || previewUrl ? (
        <div className="relative h-24 w-24 rounded-xl overflow-hidden border border-border bg-muted aspect-square">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Photo evidence" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full flex items-center justify-center bg-emerald-500/10">
              <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </div>
          )}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          )}
          {error && (
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="absolute inset-0 flex items-center justify-center bg-destructive/30 text-[9px] text-destructive font-semibold px-1 text-center"
            >
              {error}
            </button>
          )}
          {!loading && (
            <button
              type="button"
              onClick={handleRemove}
              className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 rounded-xl h-12"
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-4 w-4" />
          Capture Photo
        </Button>
      )}

      <p className="text-[11px] text-muted-foreground">Opens your camera directly</p>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );
}
