'use client';

import { Card, CardContent, CardHeader, CardTitle, Skeleton, Separator } from '@water-supply-crm/ui';
import { User, Mail, Phone, MapPin, Package, DollarSign } from 'lucide-react';
import { useProfile } from '../hooks/use-profile';

export function ProfileCard() {
  const { data: profile, isLoading } = useProfile();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!profile) return null;

  const fields = [
    { icon: User, label: 'Name', value: profile.name },
    { icon: Mail, label: 'Email', value: profile.email },
    { icon: Phone, label: 'Phone', value: profile.phone ?? '—' },
    { icon: MapPin, label: 'Address', value: profile.address ?? '—' },
    { icon: Package, label: 'Route', value: profile.route?.name ?? '—' },
    { icon: DollarSign, label: 'Wallet Balance', value: `Rs. ${profile.walletBalance.toLocaleString()}` },
  ];

  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle>Account Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {fields.map(({ icon: Icon, label, value }, i) => (
            <div key={label}>
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="text-sm font-medium">{value}</p>
                </div>
              </div>
              {i < fields.length - 1 && <Separator className="mt-4" />}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-6">
          Member since {new Date(profile.createdAt).toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })}
        </p>
      </CardContent>
    </Card>
  );
}
