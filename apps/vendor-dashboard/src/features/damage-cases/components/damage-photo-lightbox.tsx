'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight, X, ImageOff } from 'lucide-react';
import { Dialog, DialogContent } from '@water-supply-crm/ui';

interface DamagePhotoLightboxProps {
  photoKeys: string[];
  signedPhotoUrls?: string[];
}

export function DamagePhotoLightbox({ photoKeys, signedPhotoUrls }: DamagePhotoLightboxProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const urls = signedPhotoUrls ?? [];
  const hasPhotos = urls.length > 0;

  const handlePrev = () => setActiveIndex((i) => Math.max(0, i - 1));
  const handleNext = () => setActiveIndex((i) => Math.min(urls.length - 1, i + 1));

  const openAt = (index: number) => {
    setActiveIndex(index);
    setLightboxOpen(true);
  };

  if (!hasPhotos) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-white/[0.02] p-8 text-center">
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20">
          <ImageOff className="h-8 w-8 text-amber-500" />
        </div>
        <p className="text-sm font-semibold text-muted-foreground">No photos attached</p>
        <p className="text-xs text-muted-foreground/60">
          {photoKeys.length > 0
            ? 'Signed URLs unavailable — please refresh.'
            : 'No photos were uploaded for this damage case.'}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {urls.map((url, i) => (
          <button
            key={photoKeys[i] ?? i}
            onClick={() => openAt(i)}
            className="group relative aspect-square rounded-xl overflow-hidden border border-border hover:border-primary/40 transition-colors bg-black/20 focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <img
              src={url}
              alt={`Damage photo ${i + 1}`}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
          </button>
        ))}
      </div>

      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-4xl w-full p-0 bg-black/95 border-border/20 overflow-hidden">
          <div className="relative flex items-center justify-center min-h-[60vh]">
            {/* Close */}
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute top-3 right-3 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
              aria-label="Close lightbox"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Prev arrow */}
            {activeIndex > 0 && (
              <button
                onClick={handlePrev}
                className="absolute left-3 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                aria-label="Previous photo"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
            )}

            {/* Image */}
            <img
              src={urls[activeIndex]}
              alt={`Damage photo ${activeIndex + 1} of ${urls.length}`}
              className="max-h-[80vh] max-w-full object-contain"
            />

            {/* Next arrow */}
            {activeIndex < urls.length - 1 && (
              <button
                onClick={handleNext}
                className="absolute right-3 z-20 p-2 rounded-full bg-black/60 hover:bg-black/80 text-white transition-colors"
                aria-label="Next photo"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            )}

            {/* Counter */}
            {urls.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-xs font-bold">
                {activeIndex + 1} / {urls.length}
              </div>
            )}
          </div>

          {/* Thumbnail strip */}
          {urls.length > 1 && (
            <div className="flex items-center gap-2 p-3 bg-black/80 overflow-x-auto">
              {urls.map((url, i) => (
                <button
                  key={photoKeys[i] ?? i}
                  onClick={() => setActiveIndex(i)}
                  className={`shrink-0 h-14 w-14 rounded-lg overflow-hidden border-2 transition-colors ${
                    i === activeIndex ? 'border-primary' : 'border-transparent hover:border-white/40'
                  }`}
                >
                  <img src={url} alt={`Thumb ${i + 1}`} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
