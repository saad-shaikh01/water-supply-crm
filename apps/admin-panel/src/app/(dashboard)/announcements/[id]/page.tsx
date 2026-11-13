import { AnnouncementDetailClient } from '../../../../features/announcements/components/announcement-detail-client';

export default async function AnnouncementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnnouncementDetailClient id={id} />;
}
