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
