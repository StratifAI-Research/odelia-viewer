import React from 'react';

export interface StudyInfo {
  studyInstanceUid: string;
  date: string;
  description: string;
  numInstances: number;
  numSeries: number;
  hasAIResults?: boolean;
}

interface StudySelectorProps {
  studies: StudyInfo[];
  selectedStudyUID: string | null;
  onSelectStudy: (studyUID: string) => void;
}

const StudySelector: React.FC<StudySelectorProps> = ({
  studies,
  selectedStudyUID,
  onSelectStudy,
}) => {
  if (studies.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-3 bg-secondary-dark rounded">
        No studies available
      </div>
    );
  }

  return (
    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
      {studies.map(study => {
        const isSelected = study.studyInstanceUid === selectedStudyUID;

        return (
          <div
            key={study.studyInstanceUid}
            onClick={() => onSelectStudy(study.studyInstanceUid)}
            className={`
              p-3 rounded cursor-pointer transition-colors
              border border-secondary-light
              ${isSelected
                ? 'bg-primary-dark border-primary-light'
                : 'bg-black hover:bg-secondary-dark'
              }
            `}
          >
            <div className="flex items-start gap-3">
              {/* Radio button indicator */}
              <div className="mt-1 flex-shrink-0">
                <div
                  className={`
                    w-4 h-4 rounded-full border-2
                    flex items-center justify-center
                    ${isSelected
                      ? 'border-primary-light'
                      : 'border-secondary-light'
                    }
                  `}
                >
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full bg-primary-light" />
                  )}
                </div>
              </div>

              {/* Study info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium text-white truncate flex-1">
                    {study.date || study.description || 'Unnamed Study'}
                  </div>
                  {study.hasAIResults && (
                    <div className="flex-shrink-0 px-2 py-0.5 text-xs rounded bg-primary-main text-white font-medium">
                      🤖 AI
                    </div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {study.date || 'No date'} · {study.numSeries} series · {study.numInstances} instances
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StudySelector;
