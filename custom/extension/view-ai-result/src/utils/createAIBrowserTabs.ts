/**
 * Creates tabs for the study browser that groups display sets into Original and AI Results
 * @param {string[]} primaryStudyInstanceUIDs
 * @param {object[]} studyDisplayList
 * @param {object[]} displaySets
 * @returns tabs - The prop object expected by the StudyBrowser component
 */
export function createAIBrowserTabs(
  primaryStudyInstanceUIDs,
  studyDisplayList,
  displaySets
) {
  console.log('createAIBrowserTabs input:', {
    primaryStudyInstanceUIDs,
    studyDisplayList,
    displaySetsCount: displaySets?.length,
    displaySets,
  });

  // Helper function to check if a display set is an AI result
  const isAIResult = (displaySet) => {
    if (!displaySet) return false;

    // Check both uppercase and lowercase property names to be safe
    const modality = displaySet.Modality || displaySet.modality;
    const description = displaySet.SeriesDescription || displaySet.description;

    // Check for AI results: ALL SRs (assuming they are AI results) OR SC modality
    const isSR = modality === 'SR';
    const isSC = modality === 'SC';

    console.log('Checking display set for AI:', {
      displaySetInstanceUID: displaySet.displaySetInstanceUID,
      modality,
      description,
      isSR,
      isSC,
      isMatch: isSR || isSC
    });

    return isSR || isSC;
  };

  // Group display sets by series
  const originalSeries = new Map();
  const aiSeries = new Map();

  displaySets.forEach(displaySet => {
    const seriesKey = `${displaySet.StudyInstanceUID}_${displaySet.SeriesInstanceUID}`;
    const targetMap = isAIResult(displaySet) ? aiSeries : originalSeries;

    if (!targetMap.has(seriesKey)) {
      // Use "AI Results" as description for AI display sets, otherwise use original description
      const description = isAIResult(displaySet)
        ? 'AI Results'
        : displaySet.SeriesDescription || displaySet.description || 'Series';

      // Make studyInstanceUid unique for AI results to avoid React key conflicts
      const studyInstanceUid = isAIResult(displaySet)
        ? `ai-${displaySet.StudyInstanceUID}-${displaySet.SeriesInstanceUID}`
        : displaySet.StudyInstanceUID;

      targetMap.set(seriesKey, {
        studyInstanceUid: studyInstanceUid,
        date: displaySet.SeriesDate || new Date().toISOString(),
        description: description,
        modalities: displaySet.Modality || displaySet.modality || '',
        numInstances: 0,
        displaySets: [],
      });
    }

    const series = targetMap.get(seriesKey);
    series.displaySets.push(displaySet);
    series.numInstances += displaySet.numImageFrames || 1;
  });

  console.log('Grouped series:', {
    originalSeriesCount: originalSeries.size,
    aiSeriesCount: aiSeries.size,
    originalSeries: Array.from(originalSeries.values()),
    aiSeries: Array.from(aiSeries.values()),
  });

  // Create tabs
  const tabs = [
    {
      name: 'original',
      label: 'Original',
      studies: Array.from(originalSeries.values()),
    },
    {
      name: 'ai-results',
      label: 'AI Results',
      studies: Array.from(aiSeries.values()),
    },
    {
      name: 'all',
      label: 'All',
      studies: [...Array.from(originalSeries.values()), ...Array.from(aiSeries.values())],
    },
  ];

  console.log('Created tabs:', {
    tabsCount: tabs.length,
    tabs,
  });

  return tabs;
}
