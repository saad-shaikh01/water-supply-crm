'use client';

import { Card, CardContent } from '@water-supply-crm/ui';
import { Download, FileText } from 'lucide-react';

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => {
        const v = row[h];
        const s = v == null ? '' : String(v);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')
    ),
  ];
  return lines.join('\n');
}

interface ExportSectionProps {
  activeTab: string;
  financialData: any;
  deliveriesData: any;
  customersData: any;
  staffData: any;
  from: string;
  to: string;
}

export function ExportSection({ activeTab, financialData, deliveriesData, customersData, staffData, from, to }: ExportSectionProps) {
  const dateLabel = from && to ? `${from}_to_${to}` : 'all_time';

  const getCurrentData = () => {
    switch (activeTab) {
      case 'financial': return financialData;
      case 'deliveries': return deliveriesData;
      case 'customers': return customersData;
      case 'staff': return staffData;
      default: return null;
    }
  };

  const getCSVRows = (): Record<string, unknown>[] => {
    const d = getCurrentData();
    if (!d) return [];
    switch (activeTab) {
      case 'financial':
        return (d.profit?.byDay ?? []).map((p: any) => ({
          date: p.date, revenue: p.revenue, expenses: p.expenses, profit: p.profit,
        }));
      case 'deliveries':
        return (d.byDay ?? []).map((b: any) => ({
          date: b.date, completed: b.completed, missed: b.missed, pending: b.pending ?? 0,
        }));
      case 'customers':
        return (d.growthByMonth ?? []).map((g: any) => ({
          month: g.month, new: g.new, cumulative: g.cumulative,
        }));
      case 'staff':
        return (d.staff ?? []).map((s: any) => ({
          name: s.name, role: s.role, deliveries: s.deliveries,
          completionRate: `${s.completionRate}%`, cashCollected: s.cashCollected, bottlesDelivered: s.bottlesDelivered,
        }));
      default:
        return [];
    }
  };

  const handleCSV = () => {
    const rows = getCSVRows();
    if (rows.length === 0) return;
    const csv = toCSV(rows);
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `analytics_${activeTab}_${dateLabel}.csv`);
  };

  const handlePDF = async () => {
    const { jsPDF } = await import('jspdf');
    const { default: autoTable } = await import('jspdf-autotable');

    const doc = new jsPDF();
    const rows = getCSVRows();
    if (rows.length === 0) return;

    const headers = Object.keys(rows[0]);
    const body = rows.map((r) => headers.map((h) => String(r[h] ?? '')));

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`Analytics Report — ${activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}`, 14, 20);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Period: ${from || 'All time'} – ${to || 'All time'}`, 14, 30);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 36);

    autoTable(doc, {
      startY: 44,
      head: [headers],
      body,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [245, 247, 250] },
    });

    doc.save(`analytics_${activeTab}_${dateLabel}.pdf`);
  };

  return (
    <Card className="bg-card/40 backdrop-blur-xl border-white/10 rounded-[2rem]">
      <CardContent className="pt-6">
        <p className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-4">Export Current Tab</p>
        <div className="flex gap-3">
          <button
            onClick={handleCSV}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-primary-foreground transition-all text-sm font-semibold"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            onClick={handlePDF}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-card border border-border/50 text-foreground hover:bg-accent transition-all text-sm font-semibold"
          >
            <FileText className="h-4 w-4" />
            Export PDF
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
