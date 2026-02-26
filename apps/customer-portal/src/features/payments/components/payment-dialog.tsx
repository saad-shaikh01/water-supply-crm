'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  Input,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Badge,
  cn,
} from '@water-supply-crm/ui';
import { QrCode, Upload, CheckCircle2, Loader2, Info, Banknote, Ban, XCircle, Clock3 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { usePaymentInfo, useInitiateRaastQr, usePaymentStatus, useSubmitManualPayment } from '../hooks/use-payments';

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestedAmount?: number;
}

const TERMINAL_QR_STATUSES = ['PAID', 'EXPIRED', 'REJECTED'] as const;

const QR_STATUS_CONFIG: Record<string, { title: string; message: string; chipClass: string; iconClass: string; icon: typeof Clock3 }> = {
  PENDING: {
    title: 'Payment Created',
    message: 'Your request was created. Complete payment in your banking app.',
    chipClass: 'bg-amber-500/10 text-amber-600',
    iconClass: 'bg-amber-500/10 border-amber-500 text-amber-600',
    icon: Clock3,
  },
  PROCESSING: {
    title: 'Waiting for Confirmation',
    message: 'We are polling for live updates from the payment gateway.',
    chipClass: 'bg-blue-500/10 text-blue-600',
    iconClass: 'bg-blue-500/10 border-blue-500 text-blue-600',
    icon: Loader2,
  },
  PAID: {
    title: 'Payment Received',
    message: 'Payment is confirmed and your account will refresh shortly.',
    chipClass: 'bg-emerald-500/10 text-emerald-600',
    iconClass: 'bg-emerald-500/10 border-emerald-500 text-emerald-600',
    icon: CheckCircle2,
  },
  EXPIRED: {
    title: 'QR Expired',
    message: 'The QR session expired. Generate a new QR to continue.',
    chipClass: 'bg-muted text-muted-foreground',
    iconClass: 'bg-muted border-border text-muted-foreground',
    icon: Ban,
  },
  REJECTED: {
    title: 'Payment Rejected',
    message: 'Payment could not be verified. Please retry or use manual submission.',
    chipClass: 'bg-destructive/10 text-destructive',
    iconClass: 'bg-destructive/10 border-destructive text-destructive',
    icon: XCircle,
  },
};

export function PaymentDialog({ open, onOpenChange, suggestedAmount = 0 }: PaymentDialogProps) {
  const queryClient = useQueryClient();
  const { data: info } = usePaymentInfo();
  const { mutate: initiateRaast, isPending: isInitiatingRaast } = useInitiateRaastQr();
  const { mutate: submitManual, isPending: isSubmittingManual } = useSubmitManualPayment();

  const [amount, setAmount] = useState<string | number>(suggestedAmount > 0 ? suggestedAmount : '');
  const [method, setMethod] = useState<'RAAST_QR' | 'MANUAL'>('RAAST_QR');
  const [manualMethod, setManualMethod] = useState('MANUAL_RAAST');
  const [refNo, setRefNo] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [qrResponse, setQrResponse] = useState<any>(null);
  const [qrPaymentId, setQrPaymentId] = useState('');
  const [hasSyncedTerminalState, setHasSyncedTerminalState] = useState(false);

  const { data: paymentStatus, isFetching: isStatusFetching } = usePaymentStatus(qrPaymentId);

  const currentQrStatus = (paymentStatus as any)?.status ?? qrResponse?.status;
  const currentStatusConfig = QR_STATUS_CONFIG[currentQrStatus] ?? QR_STATUS_CONFIG.PROCESSING;
  const isTerminalQrStatus = TERMINAL_QR_STATUSES.includes(currentQrStatus as (typeof TERMINAL_QR_STATUSES)[number]);

  useEffect(() => {
    if (!qrPaymentId || !isTerminalQrStatus || hasSyncedTerminalState) return;
    setHasSyncedTerminalState(true);
    queryClient.invalidateQueries({ queryKey: ['payment-history'] });
  }, [hasSyncedTerminalState, isTerminalQrStatus, qrPaymentId, queryClient]);

  const handleInitiateRaast = () => {
    if (!amount || Number(amount) <= 0) return;

    initiateRaast(
      { amount: Number(amount) },
      {
        onSuccess: (data) => {
          setQrResponse(data);
          setQrPaymentId(data.paymentRequestId ?? data.id ?? '');
          setHasSyncedTerminalState(false);
          if (data.checkoutUrl) {
            window.open(data.checkoutUrl, '_blank');
          }
        },
      }
    );
  };

  const handleSubmitManual = () => {
    if (!amount || !refNo) return;

    const formData = new FormData();
    formData.append('amount', String(amount));
    formData.append('method', manualMethod);
    formData.append('referenceNo', refNo);
    if (file) formData.append('screenshot', file);

    submitManual(formData, {
      onSuccess: () => {
        onOpenChange(false);
        resetForm();
      },
    });
  };

  const resetForm = () => {
    setQrResponse(null);
    setQrPaymentId('');
    setHasSyncedTerminalState(false);
    setAmount(suggestedAmount > 0 ? suggestedAmount : '');
    setMethod('RAAST_QR');
    setManualMethod('MANUAL_RAAST');
    setRefNo('');
    setFile(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) resetForm();
      }}
    >
      <DialogContent className="rounded-[2.5rem] max-w-lg p-0 overflow-hidden bg-background/95 backdrop-blur-xl border-border/50">
        <div className="bg-primary/5 p-8 border-b border-border/50">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
                <Banknote className="h-6 w-6" />
              </div>
              Make Payment
            </DialogTitle>
            <DialogDescription className="font-bold text-muted-foreground mt-1">
              Choose your preferred method to clear your balance.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-8">
          {!qrResponse ? (
            <div className="space-y-8">
              <div className="space-y-3">
                <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Enter Amount (PKR)</Label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-black text-muted-foreground">Rs</span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-16 pl-12 text-3xl font-black font-mono rounded-2xl border-2 focus:ring-primary/20 transition-all bg-accent/20"
                  />
                </div>
              </div>

              <Tabs value={method} onValueChange={(value) => setMethod(value as 'RAAST_QR' | 'MANUAL')} className="w-full">
                <TabsList className="grid w-full grid-cols-2 p-1 bg-muted/50 rounded-2xl h-14">
                  <TabsTrigger value="RAAST_QR" className="rounded-xl font-bold gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    <QrCode className="h-4 w-4" /> Raast QR
                  </TabsTrigger>
                  <TabsTrigger value="MANUAL" className="rounded-xl font-bold gap-2 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    <Upload className="h-4 w-4" /> Manual
                  </TabsTrigger>
                </TabsList>

                <div className="mt-8">
                  <TabsContent value="RAAST_QR" className="space-y-6">
                    <div className="p-6 rounded-[2rem] bg-primary/5 border border-primary/10 flex items-start gap-4">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Info className="h-5 w-5 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-sm font-bold">Instant Activation</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Scan the QR code with any banking app (HBL, JazzCash, Easypaisa). Your balance will be updated instantly.
                        </p>
                      </div>
                    </div>
                    <Button
                      className="w-full h-14 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 active:scale-95 transition-all"
                      onClick={handleInitiateRaast}
                      disabled={isInitiatingRaast || !amount}
                    >
                      {isInitiatingRaast ? <Loader2 className="animate-spin" /> : 'Generate Raast QR'}
                    </Button>
                  </TabsContent>

                  <TabsContent value="MANUAL" className="space-y-6">
                    <div className="space-y-4">
                      <div className="p-4 rounded-2xl bg-accent/30 border border-border/50">
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-2">Vendor Raast ID</p>
                        <p className="text-lg font-black font-mono">{info?.raastId || 'Not Configured'}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Pay to this ID first, then submit details here.</p>
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-black uppercase tracking-widest">Reference / TID</Label>
                        <Input
                          placeholder="Enter Transaction ID"
                          value={refNo}
                          onChange={(e) => setRefNo(e.target.value)}
                          className="h-12 rounded-xl"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label className="text-xs font-black uppercase tracking-widest">Screenshot (Optional)</Label>
                        <div className="relative">
                          <Input
                            type="file"
                            accept="image/*"
                            onChange={(e) => setFile(e.target.files?.[0] || null)}
                            className="h-12 rounded-xl pt-3 cursor-pointer"
                          />
                          <Upload className="absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>
                    </div>

                    <Button
                      className="w-full h-14 rounded-2xl font-black text-lg shadow-xl shadow-primary/20 active:scale-95 transition-all"
                      onClick={handleSubmitManual}
                      disabled={isSubmittingManual || !amount || !refNo}
                    >
                      {isSubmittingManual ? <Loader2 className="animate-spin" /> : 'Submit for Review'}
                    </Button>
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          ) : (
            <div className="py-10 text-center space-y-6 animate-in fade-in zoom-in-95">
              <div className={cn('h-20 w-20 rounded-full border-4 flex items-center justify-center mx-auto', currentStatusConfig.iconClass)}>
                <currentStatusConfig.icon className={cn('h-10 w-10', currentQrStatus === 'PROCESSING' && 'animate-spin')} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-center">
                  <Badge className={cn('rounded-full border-0 px-3 py-1 text-[11px] font-bold', currentStatusConfig.chipClass)}>
                    {currentQrStatus ?? 'PROCESSING'}
                  </Badge>
                </div>
                <h3 className="text-2xl font-black">{currentStatusConfig.title}</h3>
                <p className="text-sm text-muted-foreground max-w-[320px] mx-auto leading-relaxed">
                  {currentStatusConfig.message} Amount: <span className="font-bold text-foreground">Rs {amount}</span>.
                </p>
                {!isTerminalQrStatus && (
                  <p className="text-[11px] font-bold text-primary">
                    {isStatusFetching ? 'Refreshing status...' : 'Live status updates every 5 seconds.'}
                  </p>
                )}
              </div>
              <div className="pt-4 flex flex-col gap-2">
                {qrResponse.checkoutUrl && (
                  <Button
                    variant="outline"
                    className="rounded-xl h-12 font-bold"
                    onClick={() => window.open(qrResponse.checkoutUrl, '_blank')}
                  >
                    Re-open Checkout
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="rounded-xl h-12 font-bold"
                  onClick={() => {
                    if (isTerminalQrStatus) {
                      onOpenChange(false);
                      resetForm();
                      return;
                    }
                    setQrResponse(null);
                    setQrPaymentId('');
                  }}
                >
                  {isTerminalQrStatus ? 'Done' : 'Close'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
