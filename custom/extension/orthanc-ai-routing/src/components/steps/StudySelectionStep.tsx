import React from 'react';
import { Button } from '@ohif/ui';
import StudySelector, { StudyInfo } from '../StudySelector';
import { StudyListSkeleton, EmptyState, ErrorState } from '../LoadingStates';

interface StudySelectionStepProps {
  studies: StudyInfo[];
  selectedStudyUID: string | null;
  onSelectStudy: (studyUID: string) => void;
  onNext: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export const StudySelectionStep: React.FC<StudySelectionStepProps> = ({
  studies,
  selectedStudyUID,
  onSelectStudy,
  onNext,
  isLoading,
  error,
}) => {
  const renderContent = () => {
    if (error) {
      return (
        <ErrorState
          title="Failed to Load Studies"
          message={error}
          onRetry={() => window.location.reload()}
        />
      );
    }

    if (isLoading) {
      return (
        <div>
          <h4 className="text-sm font-medium mb-3 text-muted-foreground">
            Loading studies...
          </h4>
          <StudyListSkeleton />
        </div>
      );
    }

    if (studies.length === 0) {
      return (
        <EmptyState
          icon="📭"
          title="No Studies Available"
          message="No studies found in the viewer. Please load a study first."
        />
      );
    }

    return (
      <>
        <div>
          <h4 className="text-sm font-medium mb-3 text-muted-foreground">
            Select a study to send to AI
          </h4>
          <StudySelector
            studies={studies}
            selectedStudyUID={selectedStudyUID}
            onSelectStudy={onSelectStudy}
          />
        </div>

        <div className="text-xs text-muted-foreground p-2 bg-secondary-dark rounded">
          ℹ️ Studies with 🤖 AI badge already have AI results
        </div>
      </>
    );
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {renderContent()}
      </div>

      <div className="p-4 border-t border-secondary-light">
        <Button
          onClick={onNext}
          disabled={!selectedStudyUID || isLoading}
          className="w-full"
        >
          Next: Select Series →
        </Button>
      </div>
    </div>
  );
};
