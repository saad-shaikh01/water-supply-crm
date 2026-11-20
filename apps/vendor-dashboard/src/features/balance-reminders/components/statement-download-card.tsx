'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, User, CheckCircle2, AlertTriangle, FileArchive, Info } from 'lucide-react';
import {
  Card, CardContent, CardHeader, CardTitle, Button, Input, Label,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
  cn,
} from '@water-supply-crm/ui';
import { toast } from 'sonner';
import {
  balanceRemindersApi,
  type StatementDownloadPreview,
  type StatementDownloadStatus,
} from '../api/balance-reminders.api';
import { useCustomerSearch } from '../../customers/hooks/use-customers';
import { useAllVans } from '../../vans/hooks/use-vans';

const WEEKDAYS = [
  { label: 'Monday', value: '1' }, { label: 'Tuesday', value: '2' }, { label: 'Wednesday', value: '3' },
  { label: 'Thursday', value: '4' }, { label: 'Friday', value: '5' }, { label: 'Saturday', value: '6' },
];

type Mode = 'eligible' | 'single';
type PaymentFilter = 'BOTH' | 'MONTHLY' | 'CASH';
type Phase = 'select' | 'running' | 'done';

const POLL_MS = 1500;

const currentMonth = () => new Date().toISOString().slice(0, 7);

const errMessage = (err: any, fallback: string) => {
  const m = err?.response?.data?.message;
  return Array.isArray(m) ? m.join(', ') : m || fallback;
};

/** Hand a Blob to the browser as a file download. */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * "Download statements" — saves customers' statement PDFs to this computer (one PDF, or a ZIP)
 * instead of WhatsApp-ing them. Sends nothing, writes no send-log, ignores cooldown / phone
 * validity; only INACTIVE customers are left out.
 */
export function StatementDownloadCard() {
  const { data: allVansData } = useAllVans();

  const [mode, setMode] = useState<Mode>('eligible');
  const [month, setMonth] = useState(currentMonth());
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('BOTH');
  const [vanFilter, setVanFilter] = useState('all');
  const [dayFilter, setDayFilter] = useState('all');

  // single-customer combobox
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const { data: searchData, isFetching: isSearching } = useCustomerSearch(debouncedSearch, mode === 'single');
  const results: any[] = (searchData as any)?.data ?? [];

  // modal
  const [open, setOpen] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<StatementDownloadPreview | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [listSearch, setListSearch] = useState('');
  const [phase, setPhase] = useState<Phase>('select');
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatementDownloadStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isFetchingFile, setIsFetchingFile] = useState(false);

  const vans: any[] = ((allVansData as any)?.data ?? []) as any[];
  const canPreview = mode === 'eligible' || !!customerId;

  const openPreview = async () => {
    setIsLoadingPreview(true);
    try {
      const res = await balanceRemindersApi.previewStatementDownload({
        mode: mode === 'single' ? 'single' : 'eligible',
        month,
        ...(mode === 'single'
          ? { customerIds: [customerId] }
          : {
              paymentType: paymentFilter === 'BOTH' ? undefined : paymentFilter,
              vanId: vanFilter === 'all' ? undefined : vanFilter,
              dayOfWeek: dayFilter === 'all' ? undefined : Number(dayFilter),
            }),
      });
      setPreview(res.data);
      setUnchecked(new Set());
      setListSearch('');
      setPhase('select');
      setJobId(null);
      setStatus(null);
      setOpen(true);
    } catch (err) {
      toast.error(errMessage(err, 'Failed to load customers'));
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const selected = useMemo(
    () => (preview?.customers ?? []).filter((c) => !unchecked.has(c.customerId)),
    [preview, unchecked],
  );
  const visible = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const list = preview?.customers ?? [];
    return q
      ? list.filter((c) => c.name.toLowerCase().includes(q) || c.customerCode.toLowerCase().includes(q) || (c.phone ?? '').includes(q))
      : list;
  }, [preview, listSearch]);

  const limit = preview?.limit ?? 300;
  const overLimit = selected.length > limit;

  const toggle = (id: string) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const setAllVisible = (checked: boolean) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const c of visible) { if (checked) next.delete(c.customerId); else next.add(c.customerId); }
      return next;
    });

  const downloadFile = async (id: string, fallbackName: string) => {
    setIsFetchingFile(true);
    try {
      const res = await balanceRemindersApi.getStatementDownloadFile(id);
      saveBlob(res.data, fallbackName);
    } catch (err) {
      toast.error(errMessage(err, 'Could not download the file — it may have expired. Please start again.'));
    } finally {
      setIsFetchingFile(false);
    }
  };

  const startDownload = async () => {
    if (selected.length === 0 || overLimit) return;
    setIsStarting(true);
    try {
      const res = await balanceRemindersApi.startStatementDownload({
        customerIds: selected.map((c) => c.customerId),
        month: preview?.month,
      });
      setJobId(res.data.jobId);
      setStatus(null);
      setPhase('running');
    } catch (err) {
      toast.error(errMessage(err, 'Could not start the download'));
    } finally {
      setIsStarting(false);
    }
  };

  // Poll the background job until it finishes; auto-save the file when ready.
  useEffect(() => {
    if (phase !== 'running' || !jobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await balanceRemindersApi.getStatementDownloadStatus(jobId);
        if (cancelled) return;
        const s = res.data;
        setStatus(s);
        if (s.state === 'running') {
          timer = setTimeout(tick, POLL_MS);
          return;
        }
        setPhase('done');
        if (s.state === 'done' && s.file) {
          await downloadFile(jobId, s.file.name);
        } else if (s.state === 'failed') {
          toast.error(s.error ?? 'Download failed');
        }
      } catch (err) {
        if (cancelled) return;
        toast.error(errMessage(err, 'Lost track of the download. Please start again.'));
        setPhase('select');
      }
    };
    let timer: ReturnType<typeof setTimeout> = setTimeout(tick, 600);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, jobId]);

  const closeModal = () => {
    // Closing mid-render is fine: the server job finishes on its own and the file simply expires.
    setOpen(false);
    setPhase('select');
    setJobId(null);
    setStatus(null);
  };

  const pct = status && status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0;

  return (
    <>
      <Card className="bg-card/50 backdrop-blur-sm border-border/50 overflow-hidden">
        <CardHeader className="pb-3 border-b border-border/50 bg-white/5">
          <CardTitle className="text-sm font-bold flex items-center gap-2 uppercase tracking-widest text-muted-foreground">
            <Download className="h-4 w-4 text-primary" />
            Download Statements
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          <div className="flex items-start gap-2 p-3 rounded-xl bg-primary/5 border border-primary/20 text-[11px] text-muted-foreground">
            <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5 text-primary" />
            <span>
              Saves statement PDFs to this computer — <span className="font-bold">nothing is sent on WhatsApp</span> and
              nothing is logged. Every active customer is included (cooldown and invalid phone numbers don't matter);
              inactive customers are skipped.
            </span>
          </div>

          {/* Mode */}
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Customers</Label>
            <div className="grid grid-cols-2 gap-2">
              {([['eligible', 'Multiple / All'], ['single', 'Single Customer']] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMode(v)}
                  className={cn(
                    'px-3 py-2 rounded-xl text-xs font-bold border transition-colors',
                    mode === v ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {mode === 'eligible' && (
            <>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Customer Type</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(['BOTH', 'MONTHLY', 'CASH'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setPaymentFilter(t)}
                      className={cn(
                        'px-3 py-2 rounded-xl text-xs font-bold border transition-colors',
                        paymentFilter === t ? 'bg-primary/15 border-primary/40 text-primary' : 'bg-white/5 border-white/10 text-muted-foreground hover:bg-white/10',
                      )}
                    >
                      {t === 'BOTH' ? 'Both' : t === 'MONTHLY' ? 'Monthly' : 'Cash'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Van</Label>
                  <Select value={vanFilter} onValueChange={setVanFilter}>
                    <SelectTrigger className="bg-accent/30 border-border/50 h-11 rounded-xl"><SelectValue placeholder="All vans" /></SelectTrigger>
                    <SelectContent className="rounded-xl border-border shadow-2xl max-h-64">
                      <SelectItem value="all">All vans</SelectItem>
                      {vans.map((v) => <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Delivery Day</Label>
                  <Select value={dayFilter} onValueChange={setDayFilter}>
                    <SelectTrigger className="bg-accent/30 border-border/50 h-11 rounded-xl"><SelectValue placeholder="Any day" /></SelectTrigger>
                    <SelectContent className="rounded-xl border-border shadow-2xl">
                      <SelectItem value="all">Any day</SelectItem>
                      {WEEKDAYS.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          {mode === 'single' && (
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Customer</Label>
              <div className="relative">
                <Input
                  placeholder="Search by name, code or phone…"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setCustomerId(''); setDropdownOpen(true); }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                  className={cn('bg-accent/30 border-border/50 h-11 rounded-xl pr-9', customerId && 'border-primary/40')}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {isSearching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : customerId ? <CheckCircle2 className="h-4 w-4 text-primary" />
                    : <User className="h-4 w-4 text-muted-foreground/50" />}
                </div>
                {dropdownOpen && (
                  <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-popover shadow-2xl max-h-64 overflow-y-auto">
                    {results.length > 0 ? results.map((c: any) => (
                      <button
                        key={c.id}
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setCustomerId(c.id);
                          setSearch(`${c.name}${c.customerCode ? ` (${c.customerCode})` : ''}`);
                          setDropdownOpen(false);
                        }}
                        className={cn('w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors', customerId === c.id && 'bg-primary/10')}
                      >
                        <p className="font-semibold truncate">
                          {c.name}
                          {c.customerCode && <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">({c.customerCode})</span>}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{c.phoneNumber ?? ''}</p>
                      </button>
                    )) : (
                      <p className="px-3 py-4 text-xs text-muted-foreground text-center">
                        {isSearching ? 'Searching…' : debouncedSearch ? 'No active customers found.' : 'Type to search customers…'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground ml-1">Statement Month</Label>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full h-11 rounded-xl border border-border/50 bg-accent/30 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <Button
            onClick={openPreview}
            disabled={!canPreview || isLoadingPreview}
            className="w-full rounded-xl h-10 text-xs font-bold shadow-lg shadow-primary/20"
          >
            {isLoadingPreview ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileArchive className="mr-1.5 h-3.5 w-3.5" />}
            Preview &amp; Download
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { if (!o) closeModal(); }}>
        <DialogContent className="rounded-3xl max-w-lg max-h-[88vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base">Download statements — {preview?.month}</DialogTitle>
            <DialogDescription className="text-xs">
              PDFs are saved to this computer. Nothing is sent to customers on WhatsApp.
            </DialogDescription>
          </DialogHeader>

          {phase === 'select' && preview && (
            <div className="flex-1 min-h-0 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold">{selected.length} of {preview.customers.length} selected</span>
                <span className="space-x-3">
                  <button type="button" className="text-primary font-bold" onClick={() => setAllVisible(true)}>Select all</button>
                  <button type="button" className="text-muted-foreground font-bold" onClick={() => setAllVisible(false)}>Clear</button>
                </span>
              </div>
              {preview.customers.length > 8 && (
                <Input
                  placeholder="Filter list…"
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  className="h-9 rounded-xl bg-accent/30 border-border/50 text-xs"
                />
              )}

              {overLimit && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    At most {limit} statements can be downloaded at once. Untick some customers, or narrow by van /
                    delivery day / customer type and download in parts.
                  </span>
                </div>
              )}

              <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/40">
                {visible.length === 0 ? (
                  <p className="p-6 text-center text-xs text-muted-foreground">No active customers match.</p>
                ) : visible.map((c) => (
                  <label key={c.customerId} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/30">
                    <input
                      type="checkbox"
                      checked={!unchecked.has(c.customerId)}
                      onChange={() => toggle(c.customerId)}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block text-xs font-semibold truncate">
                        {c.name} <span className="font-mono text-[10px] text-muted-foreground">({c.customerCode})</span>
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {c.paymentType === 'CASH' ? 'Cash' : 'Monthly'} · ₨{Number(c.balance ?? 0).toLocaleString()}
                      </span>
                    </span>
                  </label>
                ))}
              </div>

              {preview.skippedInactive.length > 0 && (
                <details className="text-[11px] text-muted-foreground">
                  <summary className="cursor-pointer font-semibold">
                    {preview.skippedInactive.length} inactive customer{preview.skippedInactive.length !== 1 ? 's' : ''} skipped
                  </summary>
                  <p className="mt-1 max-h-24 overflow-y-auto">
                    {preview.skippedInactive.map((c) => `${c.name} (${c.customerCode})`).join(', ')}
                  </p>
                </details>
              )}

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" onClick={closeModal} className="rounded-xl text-xs font-bold">Cancel</Button>
                <Button
                  onClick={startDownload}
                  disabled={selected.length === 0 || overLimit || isStarting}
                  className="rounded-xl text-xs font-bold"
                >
                  {isStarting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                  {selected.length === 1 ? 'Download PDF' : `Download ZIP (${selected.length})`}
                </Button>
              </DialogFooter>
            </div>
          )}

          {phase === 'running' && (
            <div className="py-8 space-y-4">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold">
                <Loader2 className="h-4 w-4 animate-spin" /> Preparing statements…
              </div>
              <div className="h-2 rounded-full bg-accent/40 overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-center text-xs text-muted-foreground">
                {status ? `${status.processed} / ${status.total} done` : 'Starting…'} — keep this window open.
              </p>
            </div>
          )}

          {phase === 'done' && status && (
            <div className="space-y-4 overflow-y-auto">
              {status.state === 'failed' ? (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-xs text-destructive">
                  <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                  <span>{status.error ?? 'The download failed. Please try again.'}</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-400">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  <span>
                    {status.generated} statement{status.generated !== 1 ? 's' : ''} ready
                    {status.file ? ` — saved as ${status.file.name}` : ''}.
                  </span>
                </div>
              )}

              {status.failed.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>
                      {status.failed.length} customer{status.failed.length !== 1 ? 's' : ''}' statement could not be
                      generated and {status.failed.length !== 1 ? 'are' : 'is'} not in the download. Nothing was sent to
                      them on WhatsApp either.
                    </span>
                  </div>
                  <div className="max-h-44 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/40">
                    {status.failed.map((f) => (
                      <div key={f.customerId} className="px-3 py-1.5 text-xs flex justify-between gap-3">
                        <span className="truncate font-semibold">{f.name}</span>
                        <span className="font-mono text-[10px] text-muted-foreground shrink-0">{f.customerCode}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-2">
                {status.file && jobId && (
                  <Button
                    variant="outline"
                    disabled={isFetchingFile}
                    onClick={() => downloadFile(jobId, status.file!.name)}
                    className="rounded-xl text-xs font-bold"
                  >
                    {isFetchingFile ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    Download again
                  </Button>
                )}
                <Button onClick={closeModal} className="rounded-xl text-xs font-bold">Close</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
