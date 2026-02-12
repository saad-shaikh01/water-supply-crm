import { SheetDetail } from '../../../../features/daily-sheets/components/sheet-detail';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SheetDetailPage({ params }: Props) {
  const { id } = await params;
  return <SheetDetail sheetId={id} />;
}
