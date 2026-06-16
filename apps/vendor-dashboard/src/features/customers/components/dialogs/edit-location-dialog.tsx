'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, Badge, Input, Label,
} from '@water-supply-crm/ui';
import { MapPin, LocateFixed, ExternalLink, Navigation, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUpdateCustomerLocation } from '../../hooks/use-customers';
import { reverseGeocode } from '../../../../lib/geocoding';

interface EditLocationDialogProps {
  open: boolean;
  onClose: () => void;
  customerId: string;
  latitude: number | null;
  longitude: number | null;
  currentAddress: string;
}


export function EditLocationDialog({
  open,
  onClose,
  customerId,
  latitude,
  longitude,
  currentAddress,
}: EditLocationDialogProps) {
  const [lat, setLat] = useState<number | null>(latitude);
  const [lng, setLng] = useState<number | null>(longitude);
  const [address, setAddress] = useState(currentAddress);
  const [locating, setLocating] = useState(false);
  const { mutate: updateLocation, isPending } = useUpdateCustomerLocation();

  const handleClose = () => {
    setLat(latitude);
    setLng(longitude);
    setAddress(currentAddress);
    setLocating(false);
    onClose();
  };

  const handleGps = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation is not supported by your browser');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const newLat = pos.coords.latitude;
        const newLng = pos.coords.longitude;
        setLat(newLat);
        setLng(newLng);
        const fetched = await reverseGeocode(newLat, newLng);
        if (fetched) setAddress(fetched);
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
          toast.error('Location access denied — please allow location in browser settings');
        } else {
          toast.error('Could not get your current location');
        }
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSave = () => {
    if (lat == null || lng == null) return;
    updateLocation(
      { customerId, latitude: lat, longitude: lng, address: address || undefined },
      { onSuccess: handleClose },
    );
  };

  const hasCoords = lat != null && lng != null;
  const coordsChanged = lat !== latitude || lng !== longitude;
  const addressChanged = address !== currentAddress;
  const canSave = hasCoords && (coordsChanged || addressChanged);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="rounded-3xl max-w-sm bg-background/95 backdrop-blur-xl border-border/50 p-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/50">
          <DialogTitle className="text-xl font-black flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Edit Location
          </DialogTitle>
          <p className="text-xs text-muted-foreground font-medium mt-1">
            GPS se coordinates aur address dono update honge
          </p>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* GPS Capture Button */}
          <button
            onClick={handleGps}
            disabled={locating || isPending}
            className="w-full flex items-center justify-center gap-3 h-14 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
          >
            {locating ? (
              <>
                <Loader2 className="h-5 w-5 text-primary animate-spin" />
                <span className="text-sm font-bold text-primary">Locating & fetching address…</span>
              </>
            ) : (
              <>
                <LocateFixed className="h-5 w-5 text-primary group-hover:scale-110 transition-transform" />
                <span className="text-sm font-bold text-primary">
                  {hasCoords ? 'Update with Current Location' : 'Use Current Location'}
                </span>
              </>
            )}
          </button>

          {/* Address field */}
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">
              Address
            </Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address enter karein ya GPS se auto-fill karein"
              className="h-11 text-sm"
              disabled={isPending}
            />
            <p className="text-[10px] text-muted-foreground">
              GPS press karne par automatically fill ho jata hai — edit bhi kar sakte hain
            </p>
          </div>

          {/* Coordinates + Map Preview */}
          {hasCoords && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                  Coordinates
                </span>
                {coordsChanged && (
                  <Badge variant="outline" className="text-[10px] font-bold text-emerald-600 border-emerald-500/40 bg-emerald-500/5">
                    Updated
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 p-3 rounded-xl bg-accent/30 border border-border/40">
                <Navigation className="h-4 w-4 text-primary shrink-0" />
                <span className="font-mono text-sm font-bold">
                  {lat!.toFixed(6)}, {lng!.toFixed(6)}
                </span>
              </div>

              {/* Map Preview */}
              <div className="relative rounded-2xl overflow-hidden border border-border/40 h-44">
                <iframe
                  title="Location Preview"
                  width="100%"
                  height="100%"
                  loading="lazy"
                  src={`https://maps.google.com/maps?q=${lat},${lng}&z=17&output=embed`}
                  className="border-none w-full h-full"
                />
                <a
                  href={`https://www.google.com/maps?q=${lat},${lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="absolute top-2 right-2 flex items-center gap-1 bg-background/90 backdrop-blur-sm border border-border/50 rounded-lg px-2 py-1 text-[10px] font-bold hover:bg-primary/10 hover:text-primary transition-all shadow"
                >
                  <ExternalLink className="h-3 w-3" /> Open Maps
                </a>
              </div>
            </div>
          )}

          {!hasCoords && (
            <div className="flex flex-col items-center justify-center gap-2 py-6 rounded-2xl bg-accent/10 border border-dashed border-border/40">
              <MapPin className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60 font-semibold text-center">
                GPS button dabayein — coordinates aur address dono set ho jayenge
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 gap-3 border-t border-border/50 bg-muted/10">
          <Button variant="ghost" onClick={handleClose} className="rounded-xl" disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={isPending || !canSave}
            className="rounded-xl font-bold shadow-lg shadow-primary/20"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              'Save Location'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
