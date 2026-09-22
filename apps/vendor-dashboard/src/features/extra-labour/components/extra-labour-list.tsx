import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@water-supply-crm/ui';
import {
  ChevronLeft,
  ChevronRight,
  Edit2,
  Eye,
  Plus,
  Search,
  Tag,
  UserCheck,
  Users,
  UserX,
} from 'lucide-react';
import {
  useExtraLabourList,
  useExtraLabourSummary,
  useExtraLabourTypes,
} from '../hooks/use-extra-labour';
import { ExtraLabourListItem } from '../api/extra-labour.api';
import { ExtraLabourKpis } from './extra-labour-kpis';
import { ExtraLabourFormDialog } from './extra-labour-form-dialog';
import { ManageLabourTypesDialog } from './manage-labour-types-dialog';
import { ExtraLabourProfileDrawer } from './extra-labour-profile-drawer';

interface ExtraLabourListProps {
  /** Gates POST /extra-labour ("Add Extra Labourer"). */
  canCreate?: boolean;
  /** Gates PATCH /extra-labour/:id and the Labour Types CRUD (both require `extra_labour:manage`). */
  canManageTypes?: boolean;
}

export function ExtraLabourList({ canCreate = true, canManageTypes = true }: ExtraLabourListProps) {
  const { data: listData, isLoading, filters } = useExtraLabourList();
  const { data: summary, isLoading: loadingSummary } = useExtraLabourSummary();
  const { data: types = [] } = useExtraLabourTypes();

  const [formOpen, setFormOpen] = useState(false);
  const [typesOpen, setTypesOpen] = useState(false);
  const [editingLabourer, setEditingLabourer] = useState<ExtraLabourListItem | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  const labourers = listData?.data ?? [];
  const meta = listData?.meta ?? { total: 0, page: 1, limit: 20, totalPages: 1 };

  const formatPKR = (amount: number) =>
    new Intl.NumberFormat('en-PK', {
      style: 'currency',
      currency: 'PKR',
      maximumFractionDigits: 0,
    }).format(amount);

  const handleAddClick = () => {
    setEditingLabourer(null);
    setFormOpen(true);
  };

  const handleEditClick = (l: ExtraLabourListItem) => {
    setEditingLabourer(l);
    setFormOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* KPI Section */}
      <ExtraLabourKpis summary={summary} isLoading={loadingSummary} />

      {/* Header Bar & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Extra Labour Roster
          </h2>
          <Badge variant="outline" className="text-xs">
            {meta.total} registered
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {canManageTypes && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTypesOpen(true)}
              className="gap-1.5 text-xs"
            >
              <Tag className="w-3.5 h-3.5" /> Manage Categories
            </Button>
          )}

          {canCreate && (
            <Button type="button" size="sm" onClick={handleAddClick} className="gap-1.5 text-xs">
              <Plus className="w-4 h-4" /> Add Extra Labourer
            </Button>
          )}
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-card border rounded-xl shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <Input
            placeholder="Search name, phone, CNIC..."
            value={filters.search}
            onChange={(e) => {
              filters.setSearch(e.target.value);
              filters.setPage(1);
            }}
            className="pl-9 text-xs h-9"
          />
        </div>

        <div>
          {/* Radix's SelectItem forbids value="" (reserved to mean "cleared, show
              placeholder"), so the "All" option uses a sentinel and is mapped back
              to '' — the actual filters.labourTypeId representation — at the boundary. */}
          <Select
            value={filters.labourTypeId || 'all'}
            onValueChange={(val) => {
              filters.setLabourTypeId(val === 'all' ? '' : val);
              filters.setPage(1);
            }}
          >
            <SelectTrigger className="text-xs h-9">
              <SelectValue placeholder="All Labour Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Labour Categories</SelectItem>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Select
            value={filters.isActive}
            onValueChange={(val) => {
              filters.setIsActive(val);
              filters.setPage(1);
            }}
          >
            <SelectTrigger className="text-xs h-9">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="true">Active Only</SelectItem>
              <SelectItem value="false">Inactive Only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Roster Directory Table & Card Fallback */}
      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      ) : labourers.length === 0 ? (
        <Card className="border border-dashed p-8 text-center bg-card">
          <CardContent className="space-y-3 p-0">
            <div className="p-3 bg-muted rounded-full w-fit mx-auto text-muted-foreground">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-foreground">No labourers found</h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              No extra labourers match your current filter parameters. Add a new worker or reset your search.
            </p>
            {canCreate && (
              <Button type="button" size="sm" onClick={handleAddClick} className="mt-2">
                <Plus className="w-4 h-4 mr-1.5" /> Add Worker Now
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Desktop Table */}
          <div className="hidden md:block rounded-xl border bg-card overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/40 border-b font-semibold text-muted-foreground uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Worker Name</th>
                  <th className="py-3 px-4">Role Category</th>
                  <th className="py-3 px-4">Contact / CNIC</th>
                  <th className="py-3 px-4 text-right">Lifetime Paid</th>
                  <th className="py-3 px-4">Last Paid</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {labourers.map((l) => (
                  <tr
                    key={l.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setActiveProfileId(l.id)}
                  >
                    <td className="py-3 px-4 font-semibold text-foreground text-sm">
                      {l.name}
                      {l.notes && (
                        <p className="text-[11px] font-normal text-muted-foreground truncate max-w-[200px]">
                          {l.notes}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <Badge variant="outline" className="text-xs px-2 py-0.5 font-normal">
                        {l.labourTypeName}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground space-y-0.5">
                      {l.phone && <div className="text-foreground">{l.phone}</div>}
                      {l.cnic && <div className="font-mono text-[10px]">{l.cnic}</div>}
                      {!l.phone && !l.cnic && <span>—</span>}
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-foreground text-sm">
                      {formatPKR(l.totalPaid)}
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {l.paymentsCount} payments
                      </span>
                    </td>
                    <td className="py-3 px-4 text-muted-foreground">
                      {l.lastPaidAt
                        ? new Date(l.lastPaidAt).toLocaleDateString('en-PK', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'Never'}
                    </td>
                    <td className="py-3 px-4">
                      {l.isActive ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[11px]">
                          <UserCheck className="w-3 h-3 mr-1" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[11px]">
                          <UserX className="w-3 h-3 mr-1" /> Inactive
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => setActiveProfileId(l.id)}
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> History
                        </Button>
                        {canManageTypes && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            onClick={() => handleEditClick(l)}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Fallback View */}
          <div className="md:hidden space-y-3">
            {labourers.map((l) => (
              <Card
                key={l.id}
                className="bg-card shadow-sm border p-4 space-y-3 cursor-pointer"
                onClick={() => setActiveProfileId(l.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-base text-foreground">{l.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">
                        {l.labourTypeName}
                      </Badge>
                      {l.isActive ? (
                        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="font-bold text-base text-foreground block">
                      {formatPKR(l.totalPaid)}
                    </span>
                    <span className="text-xs text-muted-foreground">{l.paymentsCount} payments</span>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground space-y-1 pt-1 border-t border-border/40">
                  {l.phone && <div>Phone: <span className="text-foreground">{l.phone}</span></div>}
                  {l.cnic && <div>CNIC: <span className="font-mono text-foreground">{l.cnic}</span></div>}
                  <div>
                    Last Paid:{' '}
                    <span className="text-foreground">
                      {l.lastPaidAt
                        ? new Date(l.lastPaidAt).toLocaleDateString('en-PK', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })
                        : 'Never'}
                    </span>
                  </div>
                </div>

                <div
                  className="flex items-center justify-end gap-2 pt-2 border-t"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs h-8"
                    onClick={() => setActiveProfileId(l.id)}
                  >
                    <Eye className="w-3.5 h-3.5 mr-1" /> View History
                  </Button>
                  {canManageTypes && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-xs h-8"
                      onClick={() => handleEditClick(l)}
                    >
                      <Edit2 className="w-3.5 h-3.5 mr-1" /> Edit
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* Pagination Controls */}
          {meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Showing {labourers.length} of {meta.total} labourers (Page {meta.page} of{' '}
                {meta.totalPages})
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => filters.setPage(Math.max(1, filters.page - 1))}
                  disabled={filters.page <= 1}
                >
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => filters.setPage(Math.min(meta.totalPages, filters.page + 1))}
                  disabled={filters.page >= meta.totalPages}
                >
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Form Dialog */}
      {formOpen && (
        <ExtraLabourFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          labourer={editingLabourer}
          onManageTypesClick={canManageTypes ? () => setTypesOpen(true) : undefined}
        />
      )}

      {/* Manage Types Dialog */}
      {typesOpen && canManageTypes && (
        <ManageLabourTypesDialog open={typesOpen} onOpenChange={setTypesOpen} />
      )}

      {/* Profile Detail Drawer */}
      {activeProfileId && (
        <ExtraLabourProfileDrawer
          labourerId={activeProfileId}
          onClose={() => setActiveProfileId(null)}
          onEditClick={
            canManageTypes
              ? (labourer) => {
                  setActiveProfileId(null);
                  handleEditClick(labourer);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
