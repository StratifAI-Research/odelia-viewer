import { utils } from '@ohif/core';

// Simple static date cache to prevent refreshing
const staticDateCache = new Map<string, string>();

/**
 * Get a static date for a display set that won't change on re-render
 */
export function getStaticDate(displaySet: any): string {
  const displaySetId = displaySet.displaySetInstanceUID || 'unknown';

  // If we already have a static date for this display set, return it
  if (staticDateCache.has(displaySetId)) {
    const cachedDate = staticDateCache.get(displaySetId)!;
    return cachedDate;
  }

  // Try to get the best available date and make it static
  let dateValue: any = null;

  // For AI results (SR/SC), try AI result creation date first
  if (displaySet.Modality === 'SR' || displaySet.Modality === 'SC') {
    dateValue = displaySet.instance?.InstanceCreationDate;
  }

  // Fallback to series date
  if (!dateValue && displaySet.SeriesDate) {
    dateValue = displaySet.SeriesDate;
  }

  // Final fallback to study date
  if (!dateValue && displaySet.StudyDate) {
    dateValue = displaySet.StudyDate;
  }

  // If still no date, try to extract from instance object
  if (!dateValue && displaySet.instance) {
    dateValue = displaySet.instance.SeriesDate || displaySet.instance.StudyDate || displaySet.instance.InstanceCreationDate;
  }

  // If no standard DICOM date fields are available, return empty string
  let staticDate = '';
  if (dateValue) {
    try {
      // Simple date formatting without using formatDate function
      if (typeof dateValue === 'string' && dateValue.length === 8) {
        // DICOM date format YYYYMMDD
        const year = dateValue.substring(0, 4);
        const month = dateValue.substring(4, 6);
        const day = dateValue.substring(6, 8);
        staticDate = `${month}/${day}/${year}`;
      } else {
        staticDate = dateValue.toString();
      }
    } catch (error) {
      console.warn('Error formatting date:', dateValue, error);
      staticDate = ''; // Return empty string on error
    }
  }

  // Cache the static date so it never changes
  staticDateCache.set(displaySetId, staticDate);

  return staticDate;
}
