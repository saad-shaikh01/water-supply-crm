import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Input,
} from '@water-supply-crm/ui';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Edit2,
  FileText,
  Phone,
  Truck,
  UserCheck,
  UserX,
  Wallet,
} from 'lucide-react';
import {
  useExtraLabourPayments,
  useExtraLabourProfile,
} from '../hooks/use-extra-labour';
import { ExtraLabourListItem } from '../api/extra-labour.api';

interface ExtraLabourProfileDrawerProps {
  labourerId: string | null;
  onClose: () => void;
  onEditClick?: (labourer: ExtraLabourListItem) => void;
}

export function ExtraLabourProfileDrawer({
  labourerId,
  onClose,
  onEditClick,
}: ExtraLabourProfileDrawerProps) {
  const isOpen = !!labourerId;
  const { data: profile, isLoading: loadingProfile } = useExtraLabourProfile(labourerId);

  const [page, setPage] = useState(1);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data: paymentsData, isLoading: loadingPayments } = useExtraLabourPayments(
    labourerId,
    { page, limit: 10, from: from || undefined, to: to || undefined },
  );

  const formatPKR = (amount: number) =>
    new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0,
    }).format(amount);

  const payments = paymentsData?.data ?? [];
  const meta = paymentsData?.meta ?? { total: 0, page: 1, limit: 10, totalPages: 1 };

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl p-0 flex flex-col bg-background">
        {loadingProfile || !profile ? (
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-y-auto">
            {/* Header */}
            <div className="p-5 border-b bg-muted/20 space-y-3 shrink-0">
              <SheetHeader className="text-left">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs font-semibold px-2 py-0.5">
                      {profile.labourTypeName}
                    </Badge>
                    {profile.isActive ? (
                      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-xs">
                        <UserCheck className="w-3 h-3 mr-1" /> Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        <UserX className="w-3 h-3 mr-1" /> Inactive
                      </Badge>
                    )}
                  </div>

                  {onEditClick && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onEditClick({
                          id: profile.id,
                          name: profile.name,
                          phone: profile.phone,
                          cnic: profile.cnic,
                          labourTypeId: profile.labourTypeId,
                          labourTypeName: profile.labourTypeName,
                          notes: profile.notes,
                          isActive: profile.isActive,
                          totalPaid: profile.summary.totalPaid,
                          lastPaidAt: profile.summary.lastPaidAt,
                          paymentsCount: profile.summary.paymentsCount,
                        })
                      }
                      className="h-8 px-2.5 text-xs gap-1 text-muted-foreground hover:text-foreground"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit Profile
                    </Button>
                  )}
                </div>

                <SheetTitle className="text-2xl font-bold text-foreground mt-1">
                  {profile.name}
                </SheetTitle>
                <SheetDescription className="sr-only">Worker profile and payment ledger</SheetDescription>
              </SheetHeader>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground pt-1">
                {profile.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5" /> {profile.phone}
                  </span>
                )}
                {profile.cnic && (
                  <span className="flex items-center gap-1 font-mono">
                    <FileText className="w-3.5 h-3.5" /> CNIC: {profile.cnic}
                  </span>
                )}
                {profile.summary.lastPaidAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> Last Paid:{' '}
                    {new Date(profile.summary.lastPaidAt).toLocaleDateString('en-PK', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                )}
              </div>

              {profile.notes && (
                <div className="p-2.5 rounded-lg bg-background border text-xs text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">Notes: </span>
                  {profile.notes}
                </div>
              )}
            </div>

            {/* Summary KPIs */}
            <div className="p-5 border-b bg-card space-y-4">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Payout Statistics
              </h4>

              <div className="grid grid-cols-2 gap-3">
                <Card className="bg-muted/30 border-border">
                  <CardContent className="p-3.5 space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Total Earnings Paid</p>
                    <p className="text-lg font-bold text-foreground">
                      {formatPKR(profile.summary.totalPaid)}
                    </p>
                  </CardContent>
                </Card>

                <Card className="bg-muted/30 border-border">
                  <CardContent className="p-3.5 space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Payout Count</p>
                    <p className="text-lg font-bold text-foreground">
                      {profile.summary.paymentsCount}{' '}
                      <span className="text-xs font-normal text-muted-foreground">payments</span>
                    </p>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Payment Ledger / History */}
            <div className="p-5 space-y-4 flex-1">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Wallet className="w-4 h-4 text-primary" /> Payment Ledger ({meta.total})
                </h4>

                <div className="flex items-center gap-2">
                  <Input
                    type="date"
                    size={28}
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setPage(1);
                    }}
                    className="h-7 text-xs w-32"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    size={28}
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setPage(1);
                    }}
                    className="h-7 text-xs w-32"
                  />
                </div>
              </div>

              {loadingPayments ? (
                <div className="space-y-2 py-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : payments.length === 0 ? (
                <div className="p-8 text-center border rounded-lg bg-muted/20 text-muted-foreground text-sm">
                  No payment records found for this period.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {payments.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors space-y-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground">
                              {formatPKR(p.amount)}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-[10px] px-1.5 py-0 flex items-center gap-1"
                            >
                              <CreditCard className="w-2.5 h-2.5" />
                              {p.paidFromCash ? 'Cash' : 'Bank / Card'}
                            </Badge>
                          </div>
                          {p.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
                          )}
                        </div>

                        <div className="text-right shrink-0">
                          <span className="text-xs font-medium text-foreground flex items-center gap-1 justify-end">
                            <Calendar className="w-3 h-3 text-muted-foreground" />
                            {new Date(p.date).toLocaleDateString('en-PK', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
                        <span className="flex items-center gap-1">
                          {p.vanPlateNumber ? (
                            <>
                              <Truck className="w-3 h-3 text-muted-foreground" />
                              <span>Van {p.vanPlateNumber}</span>
                            </>
                          ) : (
                            <span>Office Cash</span>
                          )}
                          {p.dailySheetId && (
                            <span className="font-mono text-[10px] text-muted-foreground">
                              (Sheet #{p.dailySheetId.slice(0, 8).toUpperCase()})
                            </span>
                          )}
                        </span>
                        {p.recordedByName && <span>By {p.recordedByName}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {meta.totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted-foreground">
                    Page {meta.page} of {meta.totalPages}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={meta.page <= 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                      disabled={meta.page >= meta.totalPages}
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
