import type { LucideIcon } from 'lucide-react';
import { Card, CardContent, Button } from '@water-supply-crm/ui';

interface ListLoadingStateProps {
  rows?: number;
}

interface ListEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface ListErrorStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onRetry: () => void;
}

export function ListLoadingState({ rows = 3 }: ListLoadingStateProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-20 rounded-2xl bg-accent/30 animate-pulse" />
      ))}
    </div>
  );
}

export function ListEmptyState({ icon: Icon, title, description }: ListEmptyStateProps) {
  return (
    <Card className="bg-card/50">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center">
        <Icon className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <p className="font-bold text-muted-foreground">{title}</p>
        <p className="text-sm text-muted-foreground/60 mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

export function ListErrorState({ icon: Icon, title, description, onRetry }: ListErrorStateProps) {
  return (
    <Card className="bg-card/50 border-destructive/20">
      <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-2">
        <Icon className="h-12 w-12 text-destructive/60 mb-2" />
        <p className="font-bold text-destructive">{title}</p>
        <p className="text-sm text-muted-foreground max-w-sm">{description}</p>
        <Button variant="outline" className="rounded-xl mt-3" onClick={onRetry}>
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}
