import { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          {title}
        </h1>
        {description && (
          <p className="text-muted-foreground mt-2 text-sm md:text-base max-w-2xl leading-relaxed font-medium">
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
