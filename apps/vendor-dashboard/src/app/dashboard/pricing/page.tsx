'use client';

import { Suspense } from 'react';
import { PricingPage } from '../../../features/pricing/pages/pricing-page';

export default function PricingRoute() {
  return (
    <Suspense>
      <PricingPage />
    </Suspense>
  );
}
