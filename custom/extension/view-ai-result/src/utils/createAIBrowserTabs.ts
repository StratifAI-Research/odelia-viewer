import { getStaticDate } from './dateCache';
import { extractAIResultData } from './extractAIResultData';

/**
 * Creates tabs for the study browser that groups AI results by model name + datetime
 * @param {string[]} primaryStudyInstanceUIDs
 * @param {object[]} studyDisplayList
 * @param {object[]} displaySets - These are thumbnail objects, not actual display sets
 * @param {object} servicesManager - Needed to access displaySetService for real data
 * @returns tabs - The prop object expected by the StudyBrowser component
 */
export function createAIBrowserTabs(
  primaryStudyInstanceUIDs,
  studyDisplayList,
  displaySets,
  servicesManager: any = null
) {
  console.log('createAIBrowserTabs called with:', {
    primaryStudyInstanceUIDs,
    displaySetsCount: displaySets?.length,
    hasServicesManager: !!servicesManager
  });

  // Helper function to check if a display set is an AI result
  const isAIResult = (displaySet) => {
    if (!displaySet) return false;
    const modality = displaySet.Modality || displaySet.modality;
    return modality === 'SR' || modality === 'SC';
  };

    // Helper function to get real display set from service
  const getRealDisplaySet = (thumbnailDisplaySet) => {
    if (!servicesManager?.services?.displaySetService) {
      console.warn('No displaySetService available, using thumbnail data');
      return thumbnailDisplaySet;
    }

    try {
      const realDisplaySet = (servicesManager as any).services.displaySetService.getDisplaySetByUID(
        thumbnailDisplaySet.displaySetInstanceUID
      );
      console.log('Retrieved real display set:', {
        displaySetInstanceUID: thumbnailDisplaySet.displaySetInstanceUID,
        hasInstance: !!realDisplaySet?.instance,
        instanceDate: realDisplaySet?.instance?.InstanceCreationDate,
        instanceTime: realDisplaySet?.instance?.InstanceCreationTime
      });
      return realDisplaySet || thumbnailDisplaySet;
    } catch (error) {
      console.warn('Error getting real display set:', error);
      return thumbnailDisplaySet;
    }
  };

  // Helper function to format DICOM datetime for display
  const formatDateTime = (date, time) => {
    if (!date) return null;

    const year = date.substring(0, 4);
    const month = date.substring(4, 6);
    const day = date.substring(6, 8);

    if (time) {
      const hour = time.substring(0, 2);
      const minute = time.substring(2, 4);
      const second = time.substring(4, 6);
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }

    return `${year}-${month}-${day}`;
  };

  // Group display sets
  const originalSeries = new Map();
  const aiResultGroups = new Map(); // Key: "modelName|datetime", Value: series data
  const missingDateGroups = new Map(); // Key: modelName, Value: series data

  displaySets.forEach(thumbnailDisplaySet => {
    if (isAIResult(thumbnailDisplaySet)) {
      // Get the real display set with instance data
      const realDisplaySet = getRealDisplaySet(thumbnailDisplaySet);

      // Extract AI model info
      const aiResultData = extractAIResultData(realDisplaySet);
      const modelName = aiResultData?.modelInfo?.name || 'AI Model';

      // Extract creation date/time from real display set
      const creationDate = realDisplaySet?.instance?.InstanceCreationDate;
      const creationTime = realDisplaySet?.instance?.InstanceCreationTime;
      const formattedDateTime = formatDateTime(creationDate, creationTime);

      console.log('Processing AI result:', {
        displaySetInstanceUID: thumbnailDisplaySet.displaySetInstanceUID,
        modelName,
        creationDate,
        creationTime,
        formattedDateTime
      });

      if (formattedDateTime) {
        // Group by datetime ONLY (both SC and SR from same run together)
        const groupKey = formattedDateTime;

        if (!aiResultGroups.has(groupKey)) {
          aiResultGroups.set(groupKey, {
            studyInstanceUid: `${thumbnailDisplaySet.StudyInstanceUID}_AI_${formattedDateTime}`.replace(/[^a-zA-Z0-9._-]/g, '_'),
            date: formattedDateTime,
            description: `AI Results - ${formattedDateTime}`,
            modalities: 'AI',
            numInstances: 0,
            displaySets: [],
            modelName,
            sortKey: `${creationDate || '99999999'}${creationTime || '999999'}` // For sorting
          });
        }

        const group = aiResultGroups.get(groupKey);
        group.displaySets.push(thumbnailDisplaySet);
        group.numInstances += thumbnailDisplaySet.numInstances || 1;
            } else {
        // Group missing dates together (both SC and SR together)
        console.log('No datetime found for AI result, using missing date group');
        const missingGroupKey = 'UNKNOWN';

        if (!missingDateGroups.has(missingGroupKey)) {
          missingDateGroups.set(missingGroupKey, {
            studyInstanceUid: `${thumbnailDisplaySet.StudyInstanceUID}_AI_UNKNOWN`.replace(/[^a-zA-Z0-9._-]/g, '_'),
            date: 'Date Unknown',
            description: `AI Results - Date Unknown`,
            modalities: 'AI',
            numInstances: 0,
            displaySets: [],
            modelName
          });
        }

        const group = missingDateGroups.get(missingGroupKey);
        group.displaySets.push(thumbnailDisplaySet);
        group.numInstances += thumbnailDisplaySet.numInstances || 1;
      }
    } else {
      // Original (non-AI) series
      const seriesKey = `${thumbnailDisplaySet.StudyInstanceUID}_${thumbnailDisplaySet.seriesNumber || thumbnailDisplaySet.SeriesInstanceUID}`;

      if (!originalSeries.has(seriesKey)) {
        originalSeries.set(seriesKey, {
          studyInstanceUid: thumbnailDisplaySet.StudyInstanceUID,
          date: thumbnailDisplaySet.seriesDate || getStaticDate(thumbnailDisplaySet),
          description: thumbnailDisplaySet.description || 'Series',
          modalities: thumbnailDisplaySet.modality || '',
          numInstances: 0,
          displaySets: [],
        });
      }

      const series = originalSeries.get(seriesKey);
      series.displaySets.push(thumbnailDisplaySet);
      series.numInstances += thumbnailDisplaySet.numInstances || 1;
    }
  });

  // Create tabs in the specified order
  const tabs: any[] = [];

  // 1. Original tab (always first)
  if (originalSeries.size > 0) {
    tabs.push({
      name: 'original',
      label: 'Original',
      studies: Array.from(originalSeries.values()),
    });
  }

  // 2. AI results tabs sorted by datetime
  const sortedAIGroups = Array.from(aiResultGroups.values()).sort((a, b) => {
    return a.sortKey.localeCompare(b.sortKey);
  });

  sortedAIGroups.forEach((group, index) => {
    tabs.push({
      name: `ai-${index}`,
      label: group.description,
      studies: [group],
    });
  });

  // 3. Missing date tabs grouped by model
  Array.from(missingDateGroups.values()).forEach((group, index) => {
    tabs.push({
      name: `ai-missing-${index}`,
      label: group.description,
      studies: [group],
    });
  });

  // 4. All tab (if there are multiple tabs)
  if (tabs.length > 1) {
    const allStudies = [
      ...Array.from(originalSeries.values()),
      ...sortedAIGroups,
      ...Array.from(missingDateGroups.values())
    ];

    tabs.push({
      name: 'all',
      label: 'All',
      studies: allStudies,
    });
  }

  console.log('Created tabs with datetime grouping:', {
    tabsCount: tabs.length,
    tabLabels: tabs.map(t => t.label),
    originalCount: originalSeries.size,
    aiGroupsCount: aiResultGroups.size,
    missingDateCount: missingDateGroups.size
  });

  return tabs;
}
