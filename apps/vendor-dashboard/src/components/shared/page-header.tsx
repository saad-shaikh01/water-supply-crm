import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 sm:mb-8 md:mb-10">
      <div className="space-y-1 sm:space-y-1.5 md:space-y-2">
        <h1 className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight text-white leading-tight">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground text-xs sm:text-sm md:text-base max-w-2xl leading-relaxed font-medium line-clamp-2 sm:line-clamp-none">
            {description}
          </p>
        )}
      </div>
      {action && (
        <div className="flex items-center shrink-0">
          {action}
        </div>
      )}
    </div>
  );
}
