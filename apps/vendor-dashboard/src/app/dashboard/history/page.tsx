'use client';

import { Suspense } from 'react';
import { DriverHistory } from '../../../features/driver/components/driver-history';

export default function HistoryPage() {
  return (
    <Suspense>
      <DriverHistory />
    </Suspense>
  );
}
