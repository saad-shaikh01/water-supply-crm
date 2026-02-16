'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter, SheetDescription,
  Button, Input, Label,
} from '@water-supply-crm/ui';
import { generateSheetSchema, type GenerateSheetInput } from '../schemas';
import { useGenerateSheet, useGenerationStatus } from '../hooks/use-daily-sheets';
import { Calendar, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';

interface SheetGenerateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SheetGenerate({ open, onOpenChange }: SheetGenerateProps) {
  const [jobId, setJobId] = useState<string | null>(null);
  const { mutate: generate, isPending: isSubmitting } = useGenerateSheet();
  const { data: status, isLoading: isPolling } = useGenerationStatus(jobId || '');

  const { register, handleSubmit, reset, formState: { errors } } = useForm<GenerateSheetInput>({
    resolver: zodResolver(generateSheetSchema),
    defaultValues: { date: new Date().toISOString().split('T')[0] },
  });

  useEffect(() => {
    if (!open) {
      reset();
      setJobId(null);
    }
  }, [open, reset]);

  // Handle completion
  useEffect(() => {
    if (status?.status === 'completed') {
      const timer = setTimeout(() => {
        onOpenChange(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [status?.status, onOpenChange]);

  const onSubmit = (data: GenerateSheetInput) => {
    generate(data, { 
      onSuccess: (res: any) => {
        setJobId(res.jobId);
      } 
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
            Generate daily delivery sheets for all active routes scheduled for the selected date.
          </SheetDescription>
        </SheetHeader>

        {!jobId ? (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-8">
            <div className="space-y-3 p-6 rounded-2xl bg-accent/20 border border-border/30">
              <Label className="text-sm font-semibold">Delivery Date</Label>
              <Input 
                type="date" 
                className="bg-background border-border/50 h-12 text-lg font-medium focus:ring-primary/20 transition-all"
                {...register('date')} 
              />
              {errors.date && <p className="text-xs font-medium text-destructive">{errors.date.message}</p>}
              <p className="text-[11px] text-muted-foreground mt-2 italic">
                Tip: This will create sheets for all routes that have deliveries on this day.
              </p>
            </div>

            <SheetFooter className="pt-6 border-t">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" className="min-w-[140px] shadow-lg shadow-primary/20" disabled={isSubmitting}>
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
