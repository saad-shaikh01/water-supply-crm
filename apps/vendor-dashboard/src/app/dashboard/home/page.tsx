'use client';

import { Suspense } from 'react';
import { DriverHome } from '../../../features/driver/components/driver-home';

export default function HomePage() {
  return (
    <Suspense>
      <DriverHome />
    </Suspense>
  );
}
