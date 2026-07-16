export type LabelOptionDef = { type?: string; options?: string[] };

/**
 * Seed a measurement's `label_data` with the first option of each configured
 * `options`-type label — but ONLY when the measurement has no `label_data` yet.
 *
 * Previously `LabelingTable` performed this inline, keyed off
 * `measurement.label === ''`. That condition is also true for CSV-imported
 * lesions (`importCSVReport` sets `label = ''` after assigning the imported
 * `label_data`), so opening such a lesion's table wiped the imported values and
 * reseeded config defaults — silent data loss on the import → view round-trip.
 *
 * Guarding on empty `label_data` instead preserves imported/existing values.
 * `date`-type labels carry no `options`, so they are skipped rather than
 * dereferencing `options[0]` (which previously threw for such labels).
 *
 * Mutates `measurement` in place (callers pass the service-owned object).
 */
export function seedDefaultLabelData(
  measurement: { label_data?: Record<string, unknown> },
  labelOptions: Record<string, LabelOptionDef>
): void {
  const hasLabelData = !!measurement.label_data && Object.keys(measurement.label_data).length > 0;
  if (hasLabelData) {
    return;
  }

  const seeded: Record<string, unknown> = {};
  Object.keys(labelOptions).forEach(key => {
    const options = labelOptions[key]?.options;
    if (options && options.length > 0) {
      seeded[key] = options[0];
    }
  });
  measurement.label_data = seeded;
}
