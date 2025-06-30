/**
 * Filters display sets to return only primary imaging data,
 * excluding AI results (SR) and heatmaps (SC)
 */
export const getPrimaryDisplaySets = (displaySets: any[]): any[] => {
  return displaySets.filter(ds => {
    // Exclude AI results (Structured Reports) and heatmaps (Secondary Capture)
    return ds.Modality !== 'SR' && ds.Modality !== 'SC';
  });
};

/**
 * Gets the first primary display set for initial viewport rendering
 */
export const getPrimaryDisplaySet = (displaySets: any[]): any | null => {
  const primarySets = getPrimaryDisplaySets(displaySets);
  return primarySets.length > 0 ? primarySets[0] : null;
};
