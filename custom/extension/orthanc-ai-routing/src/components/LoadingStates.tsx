import React from 'react';

// Public loading-state component for the AI routing panel's study list. Kept as
// exported API for reuse across routing steps.
export const StudyListSkeleton: React.FC = () => {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="border-secondary-light animate-pulse rounded border bg-black p-3"
        >
          <div className="flex items-start gap-3">
            <div className="bg-secondary-light mt-1 h-4 w-4 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="bg-secondary-light h-4 w-3/4 rounded" />
              <div className="bg-secondary-light h-3 w-1/2 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export const SeriesListSkeleton: React.FC = () => {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4].map(i => (
        <div
          key={i}
          className="border-secondary-light animate-pulse rounded border bg-black p-3"
        >
          <div className="flex items-start gap-3">
            <div className="bg-secondary-light mt-1 h-4 w-4 rounded" />
            <div className="flex-1 space-y-2">
              <div className="bg-secondary-light h-4 w-2/3 rounded" />
              <div className="bg-secondary-light h-3 w-1/3 rounded" />
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
      <div className="text-sm font-medium text-white">{title}</div>
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
        <button
          onClick={onRetry}
          className="bg-secondary-dark hover:bg-secondary-main mt-4 rounded px-4 py-2 text-xs text-white transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
};
