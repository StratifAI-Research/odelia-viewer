import { useState, useEffect } from 'react';
import { utils, DicomMetadataStore } from '@ohif/core';
import { StudyInfo } from '../components/StudySelector';
import { SeriesInfo } from '../components/SeriesSelector';

const { formatDate } = utils;

interface UseStudySeriesSelectionProps {
  displaySetService: any;
  dicomStudyUID: string | null;
}

export function useStudySeriesSelection({
  displaySetService,
  dicomStudyUID
}: UseStudySeriesSelectionProps) {
  const [availableStudies, setAvailableStudies] = useState<StudyInfo[]>([]);
  const [selectedStudyUID, setSelectedStudyUID] = useState<string | null>(null);
  const [availableSeries, setAvailableSeries] = useState<SeriesInfo[]>([]);
  const [selectedSeriesUIDs, setSelectedSeriesUIDs] = useState<Set<string>>(new Set());

  // Loading states
  const [isLoadingStudies, setIsLoadingStudies] = useState<boolean>(true);
  const [isLoadingSeries, setIsLoadingSeries] = useState<boolean>(false);

  // Error states
  const [studiesError, setStudiesError] = useState<string | null>(null);
  const [seriesError, setSeriesError] = useState<string | null>(null);

  // Load available studies from displaySetService
  useEffect(() => {
    const loadStudies = () => {
      try {
        setIsLoadingStudies(true);
        setStudiesError(null);

        const displaySets = displaySetService.getActiveDisplaySets();

        if (!displaySets || displaySets.length === 0) {
          console.log('No display sets available yet');
          setAvailableStudies([]);
          setIsLoadingStudies(false);
          return;
        }

        // Group display sets by study
        const studyMap = new Map<string, any>();
        displaySets.forEach((ds: any) => {
          const studyUID = ds.StudyInstanceUID;
          if (!studyUID) return; // Skip if no study UID

          if (!studyMap.has(studyUID)) {
            // Get study metadata from DicomMetadataStore
            const studyMetadata = DicomMetadataStore.getStudy(studyUID);

            // Extract StudyDescription from study metadata (this is populated)
            const studyDescription = studyMetadata?.StudyDescription || '';

            // Get StudyDate from the first series metadata since study metadata
            // doesn't have StudyDate populated when loaded via addSeriesMetadata
            let studyDate = '';
            if (studyMetadata?.series?.length > 0) {
              // Get StudyDate from first series (all series in a study have the same StudyDate)
              studyDate = studyMetadata.series[0].StudyDate || '';
            }

            // Fallback: If still no date, try to get from display set
            if (!studyDate && ds.StudyDate) {
              studyDate = ds.StudyDate;
            }

            // Format date for display
            const formattedDate = formatDate(studyDate) || '';

            // Concatenate date and description for display
            let displayName = '';
            if (formattedDate && studyDescription) {
              displayName = `${formattedDate} - ${studyDescription}`;
            } else if (formattedDate) {
              displayName = formattedDate;
            } else if (studyDescription) {
              displayName = studyDescription;
            } else {
              displayName = 'Unnamed Study';
            }

            studyMap.set(studyUID, {
              studyInstanceUid: studyUID,
              date: formattedDate,
              description: displayName,
              numInstances: 0,
              numSeries: 0,
              hasAIResults: false,
              series: []
            });
          }

          const study = studyMap.get(studyUID);
          study.numInstances += ds.numImageFrames || 0;

          // Check if this is an AI result
          if (ds.Modality === 'SR' || ds.Modality === 'SC') {
            study.hasAIResults = true;
          } else {
            // Only count original series (not AI results)
            study.numSeries++;
          }
        });

        const studies = Array.from(studyMap.values());

        // Sort studies: primary first, then by date
        studies.sort((a, b) => {
          const aIsPrimary = a.studyInstanceUid === dicomStudyUID ? 0 : 1;
          const bIsPrimary = b.studyInstanceUid === dicomStudyUID ? 0 : 1;
          if (aIsPrimary !== bIsPrimary) return aIsPrimary - bIsPrimary;

          // Sort by date desc
          return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
        });

        setAvailableStudies(studies);

        // Auto-select primary study from URL or first study (only if none selected)
        if (studies.length > 0 && !selectedStudyUID) {
          const primaryStudy = studies.find(s => s.studyInstanceUid === dicomStudyUID) || studies[0];
          setSelectedStudyUID(primaryStudy.studyInstanceUid);
        }

        setIsLoadingStudies(false);
      } catch (error) {
        console.error('Error loading studies:', error);
        setStudiesError(error instanceof Error ? error.message : 'Failed to load studies');
        setIsLoadingStudies(false);
      }
    };

    // Initial load with small delay to let display sets populate
    const initialLoadTimeout = setTimeout(() => {
      loadStudies();
    }, 100);

    // Subscribe to display set changes
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      loadStudies
    );

    return () => {
      clearTimeout(initialLoadTimeout);
      subscription.unsubscribe();
    };
  }, [displaySetService, dicomStudyUID, selectedStudyUID]);

  // Load series for selected study
  const loadSeriesForStudy = (studyUID: string) => {
    console.log('Loading series for study:', studyUID);

    try {
      setIsLoadingSeries(true);
      setSeriesError(null);

      // Clear previous series selection
      setAvailableSeries([]);
      setSelectedSeriesUIDs(new Set());

      // Get all display sets for this study (exclude AI results)
      const displaySets = displaySetService.getActiveDisplaySets();

      if (!displaySets || displaySets.length === 0) {
        setSeriesError('No display sets available');
        setIsLoadingSeries(false);
        return;
      }

      const seriesForStudy = displaySets.filter((ds: any) =>
        ds.StudyInstanceUID === studyUID &&
        ds.Modality !== 'SR' && // Exclude structured reports
        ds.Modality !== 'SC'    // Exclude secondary captures (AI heatmaps)
      );

      console.log(`Found ${seriesForStudy.length} series for study ${studyUID}`);

      if (seriesForStudy.length === 0) {
        // Study has no processable series (only AI results)
        setAvailableSeries([]);
        setIsLoadingSeries(false);
        return;
      }

      const mappedSeries: SeriesInfo[] = seriesForStudy.map((ds: any) => ({
        displaySetInstanceUID: ds.displaySetInstanceUID,
        SeriesInstanceUID: ds.SeriesInstanceUID,
        SeriesDescription: ds.SeriesDescription || `Series ${ds.SeriesNumber || 'Unknown'}`,
        SeriesNumber: ds.SeriesNumber || 0,
        Modality: ds.Modality || 'Unknown',
        numImageFrames: ds.numImageFrames || 0,
        StudyInstanceUID: ds.StudyInstanceUID,
      }));

      // Sort by series number
      mappedSeries.sort((a, b) => a.SeriesNumber - b.SeriesNumber);

      setAvailableSeries(mappedSeries);

      // Auto-select all series by default
      const allSeriesUIDs = new Set(mappedSeries.map(s => s.SeriesInstanceUID));
      setSelectedSeriesUIDs(allSeriesUIDs);

      console.log(`Auto-selected ${allSeriesUIDs.size} series`);
      setIsLoadingSeries(false);
    } catch (error) {
      console.error('Error loading series:', error);
      setSeriesError(error instanceof Error ? error.message : 'Failed to load series');
      setIsLoadingSeries(false);
    }
  };

  const selectStudy = (studyUID: string) => {
    setSelectedStudyUID(studyUID);
    loadSeriesForStudy(studyUID);
  };

  const toggleSeries = (seriesUID: string) => {
    const newSelection = new Set(selectedSeriesUIDs);
    if (newSelection.has(seriesUID)) {
      newSelection.delete(seriesUID);
    } else {
      newSelection.add(seriesUID);
    }
    setSelectedSeriesUIDs(newSelection);
  };

  const selectAllSeries = () => {
    const allSeriesUIDs = new Set(availableSeries.map(s => s.SeriesInstanceUID));
    setSelectedSeriesUIDs(allSeriesUIDs);
  };

  const clearSeriesSelection = () => {
    setSelectedSeriesUIDs(new Set());
  };

  const reset = () => {
    setSelectedStudyUID(null);
    setAvailableSeries([]);
    setSelectedSeriesUIDs(new Set());
    setSeriesError(null);
  };

  return {
    // State
    availableStudies,
    selectedStudyUID,
    availableSeries,
    selectedSeriesUIDs,

    // Loading states
    isLoadingStudies,
    isLoadingSeries,

    // Error states
    studiesError,
    seriesError,

    // Actions
    selectStudy,
    toggleSeries,
    selectAllSeries,
    clearSeriesSelection,
    reset,
  };
}
