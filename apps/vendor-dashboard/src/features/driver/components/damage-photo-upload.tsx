'use client';

import { useRef, useState, useEffect } from 'react';
import { Camera, ImagePlus, X, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { damageCaseApi } from '../api/damage-case.api';

interface UploadedPhoto {
  key: string;
  previewUrl: string;
  loading: boolean;
  error?: string;
}

interface DamagePhotoUploadProps {
  onPhotosChange: (keys: string[]) => void;
  maxPhotos?: number;
}

export function DamagePhotoUpload({
  onPhotosChange,
  maxPhotos = 5,
}: DamagePhotoUploadProps) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const uploadedKeys = photos
    .filter((p) => !p.loading && p.key)
    .map((p) => p.key);

  // Notify parent whenever keys change
  useEffect(() => {
    onPhotosChange(uploadedKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedKeys.join(',')]);

  const canAddMore = photos.length < maxPhotos;

  async function handleFiles(files: FileList | null) {
    if (!files || !canAddMore) return;

    const remaining = maxPhotos - photos.length;
    const toProcess = Array.from(files).slice(0, remaining);
    if (toProcess.length === 0) return;

    const placeholders: UploadedPhoto[] = toProcess.map((f) => ({
      key: '',
      previewUrl: URL.createObjectURL(f),
      loading: true,
    }));

    // Capture insertion index before state update
    const insertionIndex = photos.length;

    setPhotos((prev) => [...prev, ...placeholders]);

    const results = await Promise.allSettled(
      toProcess.map((f) => damageCaseApi.uploadPhoto(f)),
    );

    setPhotos((prev) => {
      const updated = [...prev];
      results.forEach((result, i) => {
        const idx = insertionIndex + i;
        if (idx >= updated.length) return;
        if (result.status === 'fulfilled') {
          updated[idx] = { ...updated[idx], key: result.value.key, loading: false };
        } else {
          updated[idx] = { ...updated[idx], loading: false, error: 'Upload failed' };
        }
      });
      return updated;
    });
  }

  function removePhoto(index: number) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Photos
        </span>
        <span className="text-xs text-muted-foreground">
          {uploadedKeys.length} / {maxPhotos}
        </span>
      </div>

      {uploadedKeys.length === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No photos — charge will be blocked until at least one photo is added
        </div>
      )}

      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo, i) => (
            <div
              key={i}
              className="relative aspect-square rounded-xl overflow-hidden border border-border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo.previewUrl}
                alt={`Photo ${i + 1}`}
                className="h-full w-full object-cover"
              />
              {photo.loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
              {photo.error && (
                <div className="absolute inset-0 flex items-center justify-center bg-destructive/30 text-[10px] text-destructive font-semibold px-1 text-center">
                  Failed
                </div>
              )}
              {!photo.loading && (
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Upload buttons */}
      {canAddMore && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2 rounded-xl"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="h-4 w-4" />
            Camera
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1 gap-2 rounded-xl"
            onClick={() => galleryRef.current?.click()}
          >
            <ImagePlus className="h-4 w-4" />
            Gallery
          </Button>
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
