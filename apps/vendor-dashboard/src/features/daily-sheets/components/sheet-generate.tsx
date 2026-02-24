'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { generateSheetSchema, type GenerateSheetInput } from '../schemas';
import { useGenerateSheet, useGenerationStatus } from '../hooks/use-daily-sheets';
import { useAllVans } from '../../vans/hooks/use-vans';
import { Calendar, Loader2, CheckCircle2, AlertCircle, Truck } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';

interface SheetGenerateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SheetGenerate({ open, onOpenChange }: SheetGenerateProps) {
  const queryClient = useQueryClient();
  const [jobId, setJobId] = useState<string | null>(null);
  const [vanMode, setVanMode] = useState<'all' | 'specific'>('all');
  const [selectedVanIds, setSelectedVanIds] = useState<string[]>([]);

  const { mutate: generate, isPending: isSubmitting } = useGenerateSheet();
  const { data: status, isLoading: isPolling } = useGenerationStatus(jobId || '');
  const { data: vansData } = useAllVans();
  const allVans = ((vansData as any)?.data ?? []) as Array<{ id: string; plateNumber: string; isActive: boolean }>;
  const activeVans = allVans.filter((v) => v.isActive !== false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<GenerateSheetInput>({
    resolver: zodResolver(generateSheetSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0] },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setJobId(null);
      setVanMode('all');
      setSelectedVanIds([]);
    }
  }, [open, reset]);

  // Handle completion
  useEffect(() => {
    if (status?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['sheets'] });
      const timer = setTimeout(() => {
        onOpenChange(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status?.status, onOpenChange, queryClient]);

  const toggleVan = (vanId: string) => {
    setSelectedVanIds((prev) =>
      prev.includes(vanId) ? prev.filter((id) => id !== vanId) : [...prev, vanId],
    );
  };

  const onSubmit = (data: GenerateSheetInput) => {
    const payload: Record<string, unknown> = { date: data.date };
    if (vanMode === 'specific' && selectedVanIds.length > 0) {
      payload.vanIds = selectedVanIds;
    }
    generate(payload, {
      onSuccess: (res: any) => {
        setJobId(res.jobId);
      },
    });
  };

  const isGenerating = jobId && (status?.status === 'active' || status?.status === 'waiting' || status?.status === 'delayed');
  const isCompleted = status?.status === 'completed';
  const isFailed = status?.status === 'failed';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md bg-background/95 backdrop-blur-xl border-l border-border/50">
        <SheetHeader className="pb-6 border-b">
          <SheetTitle className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="h-6 w-6 text-primary" />
            Generate Sheets
          </SheetTitle>
          <SheetDescription>
            Generate daily delivery sheets for active vans scheduled for the selected date.
          </SheetDescription>
        </SheetHeader>

        {!jobId ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-8">
            {/* Date picker */}
            <div className="space-y-3 p-6 rounded-2xl bg-accent/20 border border-border/30">
              <Label className="text-sm font-semibold">Delivery Date</Label>
              <Input
                type="date"
                className="bg-background border-border/50 h-12 text-lg font-medium focus:ring-primary/20 transition-all"
                {...register('date')}
              />
              {errors.date && <p className="text-xs font-medium text-destructive">{errors.date.message}</p>}
            </div>

            {/* Van selection */}
            <div className="space-y-3 p-6 rounded-2xl bg-accent/20 border border-border/30">
              <Label className="text-sm font-semibold flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Van Selection
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVanMode('all')}
                  className={cn(
                    'flex-1 py-2 px-4 rounded-xl text-sm font-semibold border transition-all',
                    vanMode === 'all'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border/50 text-muted-foreground hover:border-primary/50',
                  )}
                >
                  All Vans
                </button>
                <button
                  type="button"
                  onClick={() => setVanMode('specific')}
                  className={cn(
                    'flex-1 py-2 px-4 rounded-xl text-sm font-semibold border transition-all',
                    vanMode === 'specific'
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border/50 text-muted-foreground hover:border-primary/50',
                  )}
                >
                  Select Specific
                </button>
              </div>

              {vanMode === 'specific' && (
                <div className="mt-3 space-y-2 max-h-48 overflow-y-auto">
                  {activeVans.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No active vans found</p>
                  ) : (
                    activeVans.map((van) => (
                      <label
                        key={van.id}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                          selectedVanIds.includes(van.id)
                            ? 'bg-primary/10 border-primary/40'
                            : 'bg-background border-border/40 hover:border-primary/30',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="rounded accent-primary h-4 w-4"
                          checked={selectedVanIds.includes(van.id)}
                          onChange={() => toggleVan(van.id)}
                        />
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-semibold">{van.plateNumber}</span>
                      </label>
                    ))
                  )}
                </div>
              )}

              {vanMode === 'specific' && selectedVanIds.length > 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {selectedVanIds.length} van{selectedVanIds.length > 1 ? 's' : ''} selected
                </p>
              )}
              {vanMode === 'all' && (
                <p className="text-[11px] text-muted-foreground italic">
                  Sheets will be created for all active vans with scheduled customers.
                </p>
              )}
            </div>

            <SheetFooter className="pt-6 border-t">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="min-w-[140px] shadow-lg shadow-primary/20"
                disabled={isSubmitting || (vanMode === 'specific' && selectedVanIds.length === 0)}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Starting...
                  </>
                ) : 'Generate Now'}
              </Button>
            </SheetFooter>
          </form>
        ) : (
          <div className="py-12 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in zoom-in-95">
            <div className={cn(
              "h-20 w-20 rounded-full flex items-center justify-center border-4",
              isCompleted ? "bg-emerald-500/10 border-emerald-500 text-emerald-500" :
              isFailed ? "bg-destructive/10 border-destructive text-destructive" :
              "bg-primary/10 border-primary/20 text-primary border-t-primary animate-spin"
            )}>
              {isCompleted ? <CheckCircle2 className="h-10 w-10" /> :
               isFailed ? <AlertCircle className="h-10 w-10" /> :
               <Loader2 className="h-10 w-10" />}
            </div>

            <div className="space-y-2">
              <h3 className="text-xl font-bold">
                {isCompleted ? 'Success!' : isFailed ? 'Failed' : 'Generating Sheets...'}
              </h3>
              <p className="text-sm text-muted-foreground max-w-[280px]">
                {isCompleted ? `Successfully generated ${status.result?.sheetIds?.length || 0} delivery sheets.` :
                 isFailed ? `Error: ${status.failedReason || 'Unknown error occurred.'}` :
                 `Current status: ${status?.status || 'Processing...'}. Please wait.`}
              </p>
            </div>

            {!isCompleted && !isFailed && (
              <div className="w-full bg-accent h-2 rounded-full overflow-hidden">
                <div
                  className="bg-primary h-full transition-all duration-500 ease-out"
                  style={{ width: `${status?.progress || 10}%` }}
                />
              </div>
            )}

            {(isCompleted || isFailed) && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => onOpenChange(false)}
              >
                Close Window
              </Button>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
