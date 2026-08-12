import { useState, useEffect, useRef } from 'react';
import { utils, DicomMetadataStore } from '@ohif/core';
import { SeriesInfo } from '../components/SeriesSelector';

// Study metadata maintained by the study/series selection hook.
export interface StudyInfo {
  studyInstanceUid: string;
  date: string;
  description: string;
  numInstances: number;
  numSeries: number;
}

const { formatDate } = utils;

interface UseStudySeriesSelectionProps {
  displaySetService: any;
  activeStudyUID: string | null; // Auto-detected from viewport
}

export function useStudySeriesSelection({
  displaySetService,
  activeStudyUID,
}: UseStudySeriesSelectionProps) {
  const [availableStudies, setAvailableStudies] = useState<StudyInfo[]>([]);
  const [availableSeries, setAvailableSeries] = useState<SeriesInfo[]>([]);
  const [selectedSeriesUIDs, setSelectedSeriesUIDs] = useState<Set<string>>(new Set());

  // Loading states
  const [isLoadingStudies, setIsLoadingStudies] = useState<boolean>(true);
  const [isLoadingSeries, setIsLoadingSeries] = useState<boolean>(false);

  // Error states
  const [seriesError, setSeriesError] = useState<string | null>(null);

  // Track if hook is mounted
  const isMountedRef = useRef<boolean>(true);

  // Set mounted status
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Load available studies from displaySetService
  useEffect(() => {
    const loadStudies = () => {
      try {
        setIsLoadingStudies(true);

        const displaySets = displaySetService.getActiveDisplaySets();

        if (!displaySets || displaySets.length === 0) {
          setAvailableStudies([]);
          setIsLoadingStudies(false);
          return;
        }

        // Group display sets by study (skip AI results - SR/SC)
        const studyMap = new Map<string, any>();
        displaySets.forEach((ds: any) => {
          const studyUID = ds.StudyInstanceUID;
          if (!studyUID) {
            return;
          } // Skip if no study UID

          // Skip AI results (SR/SC) - we only care about original imaging series
          if (ds.Modality === 'SR' || ds.Modality === 'SC') {
            return;
          }

          if (!studyMap.has(studyUID)) {
            // Get study description from the imaging series instance metadata
            // This avoids getting contaminated by SR/SC series that might have been loaded first
            let studyDescription = '';
            let studyDate = ds.StudyDate || '';

            // Try to get from the series' instance metadata (most reliable for imaging series)
            // DicomMetadataStore's internal model is typed as never[], so
            // getStudy() resolves to `never | undefined`; describe what is read.
            const studyMetadata = DicomMetadataStore.getStudy(studyUID) as
              | {
                  series?: Array<{
                    Modality?: string;
                    StudyDate?: string;
                    instances?: Array<Record<string, any>>;
                  }>;
                }
              | undefined;
            if ((studyMetadata?.series?.length ?? 0) > 0) {
              // Find the first non-SR/SC series to get the real study description
              for (const series of studyMetadata!.series!) {
                const instances = series.instances || [];
                if (instances.length > 0 && series.Modality !== 'SR' && series.Modality !== 'SC') {
                  const firstInstance = instances[0];
                  studyDescription = firstInstance.StudyDescription || '';
                  if (!studyDate) {
                    studyDate = firstInstance.StudyDate || series.StudyDate || '';
                  }
                  break; // Found a good series, use it
                }
              }
            }

            // Fallback to display set if nothing found
            if (!studyDescription) {
              studyDescription = ds.StudyDescription || '';
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
              // Raw DICOM YYYYMMDD kept for a reliable sort (Date.parse on
              // the already-formatted `date` string yields NaN).
              rawDate: studyDate,
              description: displayName,
              numInstances: 0,
              numSeries: 0,
            });
          }

          const study = studyMap.get(studyUID);
          study.numInstances += ds.numImageFrames || 0;
          study.numSeries++;
        });

        const studies = Array.from(studyMap.values());

        // Sort studies by date desc, on the raw YYYYMMDD digits.
        const dateKey = (s: string) => Number(String(s ?? '').replace(/\D/g, '')) || 0;
        studies.sort((a, b) => dateKey(b.rawDate) - dateKey(a.rawDate));

        setAvailableStudies(studies);
        setIsLoadingStudies(false);
      } catch (error) {
        console.error('Error loading studies:', error);
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
  }, [displaySetService]);

  // Auto-load series when activeStudyUID changes, with subscription to handle late-loading display sets
  useEffect(() => {
    if (!activeStudyUID) {
      // Clear series if no active study
      setAvailableSeries([]);
      setSelectedSeriesUIDs(new Set());
      setIsLoadingSeries(false);
      return;
    }

    let mounted = true;
    let retryCount = 0;
    const MAX_RETRIES = 10; // Wait up to ~1 second
    const timeouts: NodeJS.Timeout[] = []; // Track all timeouts for cleanup

    const attemptLoadSeries = () => {
      if (!mounted) {
        return;
      }

      const displaySets = displaySetService.getActiveDisplaySets();

      if (!displaySets || displaySets.length === 0) {
        // Display sets not loaded yet - keep loading state and retry

        retryCount++;

        if (retryCount < MAX_RETRIES) {
          // Retry after short delay
          const timeout = setTimeout(() => {
            if (mounted) {
              attemptLoadSeries();
            }
          }, 100);
          timeouts.push(timeout);
        } else {
          // After max retries, only show error if component is still mounted
          if (mounted) {
            console.warn('Display sets not available after max retries');
            setSeriesError('Display sets not available. Please try again.');
            setIsLoadingSeries(false);
          }
        }
        return;
      }

      // Display sets are available, proceed with loading
      if (mounted) {
        loadSeriesForStudy(activeStudyUID);
      }
    };

    // Start loading
    setIsLoadingSeries(true);
    setSeriesError(null);
    setAvailableSeries([]);
    setSelectedSeriesUIDs(new Set());

    // Initial attempt with small delay to let display sets populate
    const initialTimeout = setTimeout(() => {
      if (mounted) {
        attemptLoadSeries();
      }
    }, 150); // Slightly longer initial delay
    timeouts.push(initialTimeout);

    // Subscribe to display set changes for late arrivals
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      () => {
        if (mounted && retryCount > 0) {
          attemptLoadSeries();
        }
      }
    );

    // Cleanup function
    return () => {
      mounted = false;

      // Clear all pending timeouts
      timeouts.forEach(timeout => clearTimeout(timeout));

      // Unsubscribe from events
      if (subscription && subscription.unsubscribe) {
        subscription.unsubscribe();
      }
    };
  }, [activeStudyUID, displaySetService]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load series for selected study (called after display sets are confirmed available)
  const loadSeriesForStudy = (studyUID: string) => {
    try {
      setIsLoadingSeries(true);
      setSeriesError(null);

      // Get all display sets for this study (exclude AI results)
      const displaySets = displaySetService.getActiveDisplaySets();

      if (!displaySets || displaySets.length === 0) {
        // This shouldn't happen as we check before calling, but handle gracefully
        console.warn('Display sets became unavailable during load');
        setIsLoadingSeries(false);
        return;
      }

      const seriesForStudy = displaySets.filter(
        (ds: any) =>
          ds.StudyInstanceUID === studyUID &&
          ds.Modality !== 'SR' && // Exclude structured reports
          ds.Modality !== 'SC' // Exclude secondary captures (AI heatmaps)
      );

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

      setIsLoadingSeries(false);
    } catch (error) {
      console.error('Error loading series:', error);
      setSeriesError(error instanceof Error ? error.message : 'Failed to load series');
      setIsLoadingSeries(false);
    }
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
    setSelectedSeriesUIDs(new Set());
    setSeriesError(null);
  };

  const retrySeries = () => {
    if (!isMountedRef.current) {
      return;
    }

    if (activeStudyUID) {
      setIsLoadingSeries(true);
      setSeriesError(null);
      setAvailableSeries([]);
      setSelectedSeriesUIDs(new Set());
      // Reload the series for the active study directly (this is a
      // direct call, not an effect trigger).
      loadSeriesForStudy(activeStudyUID);
    }
  };

  return {
    // State
    availableStudies,
    availableSeries,
    selectedSeriesUIDs,

    // Loading states
    isLoadingStudies,
    isLoadingSeries,

    // Error states
    seriesError,

    // Actions
    toggleSeries,
    selectAllSeries,
    clearSeriesSelection,
    reset,
    retrySeries,
  };
}
