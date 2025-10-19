import React, { useEffect } from 'react';
import OrthancAIService from '../services/OrthancAIService';
import { useWizardState } from '../hooks/useWizardState';
import { useStudySeriesSelection } from '../hooks/useStudySeriesSelection';
import { useAIRouting } from '../hooks/useAIRouting';
import { StudySelectionStep } from './steps/StudySelectionStep';
import { SeriesSelectionStep } from './steps/SeriesSelectionStep';
import { EndpointSelectionStep } from './steps/EndpointSelectionStep';
import { ProgressStep } from './steps/ProgressStep';

interface ServicesManager {
  services: {
    orthancAIService: OrthancAIService;
    displaySetService: any;
    uiNotificationService: any;
    customizationService: any;
  };
}

interface AIRoutingPanelProps {
  servicesManager: ServicesManager;
}

const AIRoutingPanel: React.FC<AIRoutingPanelProps> = ({ servicesManager }) => {
  const {
    orthancAIService,
    displaySetService,
    uiNotificationService,
    customizationService,
  } = servicesManager.services;

  // Get the ProgressLoadingBar component from the customization service
  const ProgressLoadingBar = customizationService.getCustomization('ui.progressLoadingBar');

  // Get the actual DICOM StudyInstanceUID from the URL
  const dicomStudyUID = orthancAIService.getDicomStudyInstanceUIDFromURL();

  // Wizard state management
  const wizard = useWizardState(1);

  // Study and series selection management
  const selection = useStudySeriesSelection({
    displaySetService,
    dicomStudyUID,
  });

  // AI routing management
  const routing = useAIRouting({
    orthancAIService,
    uiNotificationService,
    onComplete: () => {
      // Keep on progress screen when complete
    },
  });

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      orthancAIService.stopRefreshCheck();
    };
  }, [orthancAIService]);

  // Handlers
  const handleStudyNext = () => {
    if (selection.selectedStudyUID) {
      selection.selectStudy(selection.selectedStudyUID);
      wizard.goToNextStep();
    }
  };

  const handleSeriesNext = () => {
    if (selection.selectedSeriesUIDs.size > 0) {
      wizard.goToNextStep();
    }
  };

  const handleSendToAI = async () => {
    if (!selection.selectedStudyUID) return;

    wizard.goToNextStep(); // Go to progress screen

    const seriesArray = Array.from(selection.selectedSeriesUIDs);
    await routing.sendToAI(selection.selectedStudyUID, seriesArray);
  };

  const handleReset = () => {
    wizard.reset();
    selection.reset();
    routing.reset();
  };

  // Render current step
  const renderStep = () => {
    switch (wizard.currentStep) {
      case 1:
        return (
          <StudySelectionStep
            studies={selection.availableStudies}
            selectedStudyUID={selection.selectedStudyUID}
            onSelectStudy={selection.selectStudy}
            onNext={handleStudyNext}
            error={routing.error}
          />
        );

      case 2:
        return (
          <SeriesSelectionStep
            studyDescription={
              selection.availableStudies.find(
                st => st.studyInstanceUid === selection.selectedStudyUID
              )?.description || 'Study'
            }
            series={selection.availableSeries}
            selectedSeriesUIDs={selection.selectedSeriesUIDs}
            onToggleSeries={selection.toggleSeries}
            onSelectAll={selection.selectAllSeries}
            onClearSelection={selection.clearSeriesSelection}
            onNext={handleSeriesNext}
            onBack={wizard.goToPrevStep}
            error={routing.error}
          />
        );

      case 3:
        return (
          <EndpointSelectionStep
            currentEndpoint={routing.currentEndpoint}
            onEndpointChange={routing.handleEndpointChange}
            studyDescription={
              selection.availableStudies.find(
                st => st.studyInstanceUid === selection.selectedStudyUID
              )?.description || 'Study'
            }
            selectedSeriesCount={selection.selectedSeriesUIDs.size}
            onSend={handleSendToAI}
            onBack={wizard.goToPrevStep}
            error={routing.error}
          />
        );

      case 4:
        return (
          <ProgressStep
            status={routing.status}
            progress={routing.progress}
            error={routing.error}
            onReset={handleReset}
            ProgressLoadingBar={ProgressLoadingBar}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="p-4 border-b border-secondary-light">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">AI Analysis</h3>
          <div className="text-xs text-muted-foreground">
            Step {wizard.currentStep} of 4
          </div>
        </div>
      </div>

      {/* Step content */}
      {renderStep()}
    </div>
  );
};

export default AIRoutingPanel;
