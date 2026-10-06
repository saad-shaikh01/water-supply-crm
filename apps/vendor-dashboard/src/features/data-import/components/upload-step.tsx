'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import {
  Button, Card, CardContent, Input, Label, cn,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@water-supply-crm/ui';
import { IMPORT_ENTITY, IMPORT_MAX_MB } from '../constants';
import type { ImportWizardData } from '../api/data-import.api';
import { downloadTemplate, importErrorOf, useUploadImport } from '../hooks/use-data-import';
import { fileSize } from './format';

const ACCEPTED = ['.xlsx', '.csv'];

/** Step 1 — pick a file, read it, let the user correct sheet / header row, then continue to mapping. */
export function UploadStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadImport();

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportWizardData | null>(null);
  const [sheet, setSheet] = useState<string | undefined>();
  const [headerRow, setHeaderRow] = useState<string>('');

  const pick = (f: File | undefined) => {
    setError(null);
    setResult(null);
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (!ACCEPTED.includes(ext)) return setError('Only .xlsx and .csv files are supported.');
    if (f.size > IMPORT_MAX_MB * 1024 * 1024) return setError(`The file is larger than ${IMPORT_MAX_MB} MB.`);
    setFile(f);
  };

  const read = async (opts?: { sheetName?: string; headerRow?: number }) => {
    if (!file) return;
    setError(null);
    try {
      const data = await upload.mutateAsync({ entity: IMPORT_ENTITY, file, replaceBatchId: result?.batch.id, ...opts });
      setResult(data);
      setSheet(data.batch.sheetName ?? undefined);
      setHeaderRow('');
      qc.setQueryData(['data-imports', 'detail', data.batch.id], { batch: data.batch, wizard: data });
    } catch (e) {
      setError(importErrorOf(e, 'Could not read this file.').message);
    }
  };

  const reread = () => read({ sheetName: sheet, headerRow: headerRow ? Number(headerRow) : undefined });

  return (
    <div className="space-y-6 max-w-3xl">
      <Card className="rounded-3xl">
        <CardContent className="p-6 space-y-5">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
            onClick={() => inputRef.current?.click()}
            className={cn(
              'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center cursor-pointer transition-colors',
              dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
            )}
          >
            <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            {file ? (
              <>
                <FileSpreadsheet className="h-10 w-10 text-primary" />
                <p className="font-semibold">{file.name}</p>
                <p className="text-xs text-muted-foreground">{fileSize(file.size)} — click to choose a different file</p>
              </>
            ) : (
              <>
                <Upload className="h-10 w-10 text-muted-foreground" />
                <p className="font-semibold">Drop your customer Excel / CSV here, or click to browse</p>
                <p className="text-xs text-muted-foreground">.xlsx or .csv · up to {IMPORT_MAX_MB} MB · up to 5,000 rows. Any column layout works — you map the columns next.</p>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-destructive/10 text-destructive p-3 text-sm">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" className="rounded-full gap-2" onClick={() => downloadTemplate(IMPORT_ENTITY)}>
              <Download className="h-4 w-4" /> Download template
            </Button>
            {!result && (
              <Button className="rounded-full gap-2" disabled={!file || upload.isPending} onClick={() => read()}>
                {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Read file
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {result && (
        <Card className="rounded-3xl">
          <CardContent className="p-6 space-y-5">
            <div>
              <p className="font-semibold">
                Found {result.batch.rowCount.toLocaleString()} row{result.batch.rowCount === 1 ? '' : 's'} and {result.headers.length} columns
              </p>
              <p className="text-xs text-muted-foreground">Check that the column names below are the headings of your data.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {(result.sheets?.length ?? 0) > 1 && (
                <div className="space-y-1.5">
                  <Label>Sheet</Label>
                  <Select value={sheet} onValueChange={setSheet}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>{result.sheets?.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Headings are on row</Label>
                <Input
                  type="number" min={1} max={50} className="h-10 rounded-xl" placeholder={`auto-detected: row ${result.batch.headerRowIndex}`}
                  value={headerRow} onChange={(e) => setHeaderRow(e.target.value)}
                />
              </div>
            </div>
            {(sheet !== result.batch.sheetName || headerRow) && (
              <Button variant="outline" size="sm" className="rounded-full" disabled={upload.isPending} onClick={reread}>
                {upload.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Read again with these settings
              </Button>
            )}

            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>{result.headers.map((h) => <TableHead key={h} className="whitespace-nowrap">{h}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {result.sampleRows.slice(0, 5).map((r) => (
                    <TableRow key={r.rowNumber}>
                      {result.headers.map((h) => <TableCell key={h} className="whitespace-nowrap max-w-[220px] truncate">{String(r.values[h] ?? '')}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end">
              <Button className="rounded-full gap-2" onClick={() => router.push(`/dashboard/data-import/${result.batch.id}`)}>
                Continue to mapping <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
