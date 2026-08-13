'use client';

import { useState } from 'react';
import { Plus, FileText, Trash2, Pencil } from 'lucide-react';
import { Card, CardContent, Button, Badge } from '@water-supply-crm/ui';
import { VEHICLE_DOCUMENT_TYPE_LABELS } from '@water-supply-crm/types';
import type { VehicleDocumentEntry } from '@water-supply-crm/types';
import { DocumentFormDialog } from './dialogs/document-form-dialog';
import { ConfirmDialog } from '../../../components/shared/confirm-dialog';
import { useDeactivateVehicleDocument } from '../hooks/use-fleet';
import { useCan } from '../../authz/hooks/use-can';

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

interface VehicleDocumentsTabProps {
  vanId: string;
  documents: VehicleDocumentEntry[];
}

export function VehicleDocumentsTab({ vanId, documents }: VehicleDocumentsTabProps) {
  const canUpdate = useCan('fleet:update');
  const [formOpen, setFormOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<VehicleDocumentEntry | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const { mutate: deactivate, isPending: isRemoving } = useDeactivateVehicleDocument();

  return (
    <div className="space-y-4">
      {canUpdate && (
        <div className="flex justify-end">
          <Button onClick={() => { setEditDoc(null); setFormOpen(true); }} className="rounded-xl font-bold gap-2">
            <Plus className="h-4 w-4" />
            Add Document
          </Button>
        </div>
      )}

      {documents.length === 0 ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No documents on file yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map((doc) => {
            const remaining = daysUntil(doc.expiryDate);
            const isExpired = remaining != null && remaining < 0;
            const isExpiringSoon = remaining != null && remaining >= 0 && remaining <= doc.reminderDaysBefore;
            return (
              <Card key={doc.id} className={`rounded-2xl ${isExpired ? 'border-destructive/50' : isExpiringSoon ? 'border-amber-500/50' : ''}`}>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">{VEHICLE_DOCUMENT_TYPE_LABELS[doc.type]}</p>
                      {doc.documentNumber && <p className="text-xs text-muted-foreground">#{doc.documentNumber}</p>}
                      {doc.expiryDate && (
                        <Badge
                          variant="outline"
                          className={`mt-1 text-[11px] ${
                            isExpired
                              ? 'bg-destructive/10 text-destructive border-destructive/30'
                              : isExpiringSoon
                                ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                                : ''
                          }`}
                        >
                          {isExpired ? `Expired ${Math.abs(remaining!)}d ago` : `Expires in ${remaining}d`}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {canUpdate && (
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditDoc(doc); setFormOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRemoveId(doc.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <DocumentFormDialog vanId={vanId} open={formOpen} onOpenChange={setFormOpen} document={editDoc} />

      <ConfirmDialog
        open={!!removeId}
        onOpenChange={(o) => { if (!o) setRemoveId(null); }}
        title="Remove Document"
        description="This document will be removed from the active list but its history is kept for audit."
        onConfirm={() => { if (removeId) deactivate(removeId, { onSuccess: () => setRemoveId(null) }); }}
        isLoading={isRemoving}
        confirmLabel="Remove"
      />
    </div>
  );
}
