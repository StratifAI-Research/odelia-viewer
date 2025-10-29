import React from 'react';

export const StudyListSkeleton: React.FC = () => {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map(i => (
        <div
          key={i}
          className="p-3 rounded border border-secondary-light bg-black animate-pulse"
        >
          <div className="flex items-start gap-3">
            <div className="mt-1 w-4 h-4 rounded-full bg-secondary-light" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-secondary-light rounded w-3/4" />
              <div className="h-3 bg-secondary-light rounded w-1/2" />
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
          className="p-3 rounded border border-secondary-light bg-black animate-pulse"
        >
          <div className="flex items-start gap-3">
            <div className="mt-1 w-4 h-4 rounded bg-secondary-light" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-secondary-light rounded w-2/3" />
              <div className="h-3 bg-secondary-light rounded w-1/3" />
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
}> = ({
  icon = '📭',
  title,
  message
}) => {
  return (
    <div className="text-center p-8 space-y-3">
      <div className="text-4xl">{icon}</div>
      <div className="text-sm font-medium text-white">{title}</div>
      <div className="text-xs text-muted-foreground">{message}</div>
    </div>
  );
};

export const ErrorState: React.FC<{
  title: string;
  message: string;
  onRetry?: () => void;
}> = ({
  title,
  message,
  onRetry
}) => {
  return (
    <div className="text-center p-8 space-y-3">
      <div className="text-4xl">⚠️</div>
      <div className="text-sm font-medium text-red-500">{title}</div>
      <div className="text-xs text-muted-foreground">{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 px-4 py-2 text-xs bg-secondary-dark hover:bg-secondary-main rounded text-white transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
};


