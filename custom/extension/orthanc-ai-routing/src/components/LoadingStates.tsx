import React from 'react';
import { Button } from '@ohif/ui-next';

export const SeriesListSkeleton: React.FC = () => {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="border-input bg-background animate-pulse rounded border p-3"
        >
          <div className="flex items-start gap-3">
            <div className="bg-muted mt-1 h-4 w-4 rounded" />
            <div className="flex-1 space-y-2">
              <div className="bg-muted h-4 w-2/3 rounded" />
              <div className="bg-muted h-3 w-1/3 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const EmptyState: React.FC<{
  icon?: string;
  title: string;
  message: string;
}> = ({ icon = '📭', title, message }) => {
  return (
    <div className="space-y-3 p-8 text-center">
      <div className="text-4xl">{icon}</div>
      <div className="text-foreground text-sm font-medium">{title}</div>
      <div className="text-muted-foreground text-xs">{message}</div>
    </div>
  );
};

export const ErrorState: React.FC<{
  title: string;
  message: string;
  onRetry?: () => void;
}> = ({ title, message, onRetry }) => {
  return (
    <div className="space-y-3 p-8 text-center">
      <div className="text-4xl">⚠️</div>
      <div className="text-sm font-medium text-red-500">{title}</div>
      <div className="text-muted-foreground text-xs">{message}</div>
      {onRetry && (
        <Button
          onClick={onRetry}
          variant="secondary"
          className="mt-4"
        >
          Try Again
        </Button>
      )}
    </div>
  );
};
