'use client';

import { useState } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Skeleton, Badge,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Separator
} from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { StatusBadge } from '../../../components/shared/status-badge';
import { useDailySheet, useLoadOut, useCheckIn, useCloseSheet, useUpdateDeliveryItem } from '../hooks/use-daily-sheets';
import { dailySheetsApi } from '../api/daily-sheets.api';
import { toast } from 'sonner';
import { 
  Truck, Package, CheckCircle2, ClipboardList, 
  ArrowLeft, Download, MapPin, User, 
  Droplets, DollarSign, Info, AlertCircle, Save
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { cn } from '@water-supply-crm/ui';
import { motion, AnimatePresence } from 'framer-motion';

interface DeliveryItem {
  id: string;
  customerId: string;
  customer?: { name: string; address: string; customerCode: string };
  productId: string;
  product?: { name: string };
  status: 'PENDING' | 'COMPLETED' | 'EMPTY_ONLY' | 'NOT_AVAILABLE' | 'RESCHEDULED' | 'CANCELLED';
  filledDropped: number;
  emptyReceived: number;
  cashCollected: number;
  reason?: string;
}

interface SheetDetailProps {
  sheetId: string;
}

export function SheetDetail({ sheetId }: SheetDetailProps) {
  const router = useRouter();
  const { data, isLoading } = useDailySheet(sheetId);
  const { mutate: recordLoadOut, isPending: isSavingLoadOut } = useLoadOut(sheetId);
  const { mutate: recordCheckIn, isPending: isSavingCheckIn } = useCheckIn(sheetId);
  const { mutate: closeSheet, isPending: isClosing } = useCloseSheet(sheetId);
  const { mutate: updateItem, isPending: isUpdatingItem } = useUpdateDeliveryItem(sheetId);

  // Dialog States
  const [loadOutOpen, setLoadOutOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState<string | null>(null);

  // Form States
  const [loadOutCount, setLoadOutCount] = useState(0);
  const [checkInData, setCheckIn] = useState({ filledInCount: 0, emptyInCount: 0, cashCollected: 0 });
  const [itemForm, setItemForm] = useState<Partial<DeliveryItem>>({});

  if (isLoading) return <div className="space-y-6"><Skeleton className="h-20 w-full rounded-3xl" /><Skeleton className="h-96 w-full rounded-3xl" /></div>;

  const sheet = (data ?? {}) as Record<string, any>;
  const items = (sheet.items ?? []) as DeliveryItem[];
  
  // Status Derivation
  const isClosed = !!sheet.isClosed;
  const isCheckedIn = !isClosed && (sheet.cashCollected > 0 || sheet.filledInCount > 0);
  const isLoaded = !isClosed && !isCheckedIn && sheet.filledOutCount > 0;
  const isNew = !isClosed && !isCheckedIn && !isLoaded;

  const currentStatus = isClosed ? 'CLOSED' : isCheckedIn ? 'CHECKED_IN' : isLoaded ? 'LOADED' : 'OPEN';

  const handleOpenDelivery = (item: DeliveryItem) => {
    if (isClosed || isCheckedIn) return;
    setItemForm({
      status: item.status === 'PENDING' ? 'COMPLETED' : item.status,
      filledDropped: item.filledDropped || 1,
      emptyReceived: item.emptyReceived || 1,
      cashCollected: item.cashCollected || 0,
      reason: item.reason || '',
    });
    setDeliveryOpen(item.id);
  };

  const onSaveItem = () => {
    if (!deliveryOpen) return;
    updateItem({
      itemId: deliveryOpen,
      data: itemForm
    }, {
      onSuccess: () => setDeliveryOpen(null)
    });
  };

  const handleExportPdf = async () => {
    try {
      const res = await dailySheetsApi.exportPdf(sheetId);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sheet-${sheetId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Failed to export PDF');
    }
  };

  return (
    <div className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()} className="rounded-full">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight">
              {new Date(sheet.date).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </h1>
            <StatusBadge status={currentStatus} />
          </div>
          <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1 font-medium">
            <MapPin className="h-3 w-3" /> {sheet.route?.name} • <Truck className="h-3 w-3 ml-1" /> {sheet.van?.plateNumber}
          </p>
        </div>
        <div className="flex gap-2">
          {!isClosed && (
            <div className="flex gap-2">
              {isNew && <Button onClick={() => { setLoadOutCount(items.length * 2); setLoadOutOpen(true); }} className="rounded-full font-bold shadow-lg shadow-primary/20">Start Load-Out</Button>}
              {isLoaded && <Button onClick={() => setCheckInOpen(true)} className="rounded-full font-bold shadow-lg shadow-primary/20" variant="secondary">Check In</Button>}
              {isCheckedIn && <Button onClick={() => closeSheet()} disabled={isClosing} className="rounded-full font-bold shadow-lg shadow-primary/20">Close & Reconcile</Button>}
            </div>
          )}
          <Button variant="outline" size="icon" className="rounded-full" onClick={handleExportPdf}>
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Lifecycle Stepper */}
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Generated', active: true, icon: ClipboardList },
          { label: 'Loaded', active: isLoaded || isCheckedIn || isClosed, icon: Package },
          { label: 'Invoiced', active: isCheckedIn || isClosed, icon: DollarSign },
          { label: 'Closed', active: isClosed, icon: CheckCircle2 },
        ].map((step, i) => (
          <div key={i} className="flex flex-col items-center gap-2">
            <div className={cn(
              "h-10 w-10 rounded-full flex items-center justify-center transition-all duration-500",
              step.active ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "bg-muted text-muted-foreground"
            )}>
              <step.icon className="h-5 w-5" />
            </div>
            <span className={cn("text-[10px] font-bold uppercase tracking-widest", step.active ? "text-primary" : "text-muted-foreground")}>
              {step.label}
            </span>
          </div>
        ))}
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
              <User className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Driver</p>
              <p className="text-sm font-black">{sheet.driver?.name}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-500">
              <Droplets className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Load Dispatch</p>
              <p className="text-sm font-black">{sheet.filledOutCount} Filled</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Progress</p>
              <p className="text-sm font-black">{items.filter(i => i.status !== 'PENDING').length} / {items.length} Done</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
              <DollarSign className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase text-muted-foreground">Cash Collected</p>
              <p className="text-sm font-black">₨ {sheet.cashCollected?.toLocaleString()}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Items List */}
      <div className="space-y-4">
        <h3 className="text-lg font-black flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          Delivery Queue
        </h3>
        <div className="grid gap-3">
          {items.map((item, idx) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
            >
              <Card className={cn(
                "group overflow-hidden border-border/50 hover:border-primary/30 transition-all cursor-pointer",
                item.status !== 'PENDING' ? "bg-muted/30 opacity-80" : "bg-card/50"
              )} onClick={() => handleOpenDelivery(item)}>
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                    <div className="h-10 w-10 rounded-full bg-accent flex items-center justify-center shrink-0 font-black text-sm">
                      {item.customer?.name?.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm sm:text-base truncate">{item.customer?.name}</h4>
                        <Badge variant="outline" className="text-[9px] font-mono px-1.5">{item.customer?.customerCode}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                        <MapPin className="h-2.5 w-2.5" /> {item.customer?.address}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 sm:border-l sm:pl-6 border-border/50">
                      <div className="text-center">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">Status</p>
                        <StatusBadge status={item.status} />
                      </div>
                      <div className="text-right min-w-[80px]">
                        <p className="text-[10px] font-bold uppercase text-muted-foreground">Record</p>
                        <p className="text-sm font-black font-mono">
                          {item.status === 'PENDING' ? '—' : `${item.filledDropped} Drop`}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Load-Out Dialog */}
      <Dialog open={loadOutOpen} onOpenChange={setLoadOutOpen}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Dispatch Load</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest text-muted-foreground">Filled Bottles Dispatched</Label>
              <Input 
                type="number" 
                value={loadOutCount} 
                onChange={(e) => setLoadOutCount(Number(e.target.value))}
                className="h-12 text-2xl font-black font-mono"
              />
              <p className="text-[11px] text-muted-foreground italic">Enter the total count of filled bottles loaded into the van.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLoadOutOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => recordLoadOut({ filledOutCount: loadOutCount }, { onSuccess: () => setLoadOutOpen(false) })} 
              disabled={isSavingLoadOut}
              className="rounded-xl font-bold"
            >
              Confirm Load-Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Check-In Dialog */}
      <Dialog open={checkInOpen} onOpenChange={setCheckInOpen}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black">Arrival Check-In</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Filled Returned</Label>
              <Input type="number" value={checkInData.filledInCount} onChange={e => setCheckIn(p => ({ ...p, filledInCount: Number(e.target.value) }))} className="font-mono font-bold" />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Empties Returned</Label>
              <Input type="number" value={checkInData.emptyInCount} onChange={e => setCheckIn(p => ({ ...p, emptyInCount: Number(e.target.value) }))} className="font-mono font-bold" />
            </div>
            <div className="col-span-2 space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Total Cash Collected (₨)</Label>
              <Input type="number" value={checkInData.cashCollected} onChange={e => setCheckIn(p => ({ ...p, cashCollected: Number(e.target.value) }))} className="h-12 text-xl font-black font-mono" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCheckInOpen(false)}>Cancel</Button>
            <Button 
              onClick={() => recordCheckIn(checkInData, { onSuccess: () => setCheckInOpen(false) })} 
              disabled={isSavingCheckIn}
              className="rounded-xl font-bold"
            >
              Record Arrival
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delivery Item Entry Dialog */}
      <Dialog open={!!deliveryOpen} onOpenChange={(o) => !o && setDeliveryOpen(null)}>
        <DialogContent className="rounded-3xl max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl font-black flex items-center gap-2">
              <Droplets className="h-5 w-5 text-primary" />
              Record Delivery
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Status</Label>
              <Select value={itemForm.status} onValueChange={v => setItemForm(p => ({ ...p, status: v as any }))}>
                <SelectTrigger className="h-11 font-bold"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="EMPTY_ONLY">Only Empties Received</SelectItem>
                  <SelectItem value="NOT_AVAILABLE">Customer Not Available</SelectItem>
                  <SelectItem value="RESCHEDULED">Rescheduled</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Dropped</Label>
                <Input type="number" value={itemForm.filledDropped} onChange={e => setItemForm(p => ({ ...p, filledDropped: Number(e.target.value) }))} className="font-mono font-bold h-11" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-xs uppercase tracking-widest">Received</Label>
                <Input type="number" value={itemForm.emptyReceived} onChange={e => setItemForm(p => ({ ...p, emptyReceived: Number(e.target.value) }))} className="font-mono font-bold h-11" />
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Cash Collected (₨)</Label>
              <Input type="number" value={itemForm.cashCollected} onChange={e => setItemForm(p => ({ ...p, cashCollected: Number(e.target.value) }))} className="h-12 text-lg font-black font-mono bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400" />
            </div>

            <div className="space-y-2">
              <Label className="font-bold text-xs uppercase tracking-widest">Note / Reason</Label>
              <Input placeholder="Optional details..." value={itemForm.reason} onChange={e => setItemForm(p => ({ ...p, reason: e.target.value }))} className="h-11" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeliveryOpen(null)}>Discard</Button>
            <Button onClick={onSaveItem} disabled={isUpdatingItem} className="rounded-xl font-bold min-w-[120px]">
              {isUpdatingItem ? 'Saving...' : 'Save Record'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
