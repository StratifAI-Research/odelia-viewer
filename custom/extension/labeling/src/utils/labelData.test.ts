import { seedDefaultLabelData } from './labelData';

describe('seedDefaultLabelData', () => {
  const labelOptions = {
    Ethnicity: { type: 'options', options: ['Unknown', 'A', 'B'] },
    Grade: { type: 'options', options: ['0', '1', '2'] },
    ScanDate: { type: 'date' }, // no options
  };

  it('does not overwrite existing/imported label_data (data loss)', () => {
    const measurement = {
      label_data: { Ethnicity: 'B', Grade: '2', Histopathology: 'malignant' },
    };
    seedDefaultLabelData(measurement, labelOptions);
    expect(measurement.label_data).toEqual({
      Ethnicity: 'B',
      Grade: '2',
      Histopathology: 'malignant',
    });
  });

  it('seeds defaults when label_data is absent', () => {
    const measurement: { label_data?: Record<string, unknown> } = {};
    seedDefaultLabelData(measurement, labelOptions);
    expect(measurement.label_data).toEqual({ Ethnicity: 'Unknown', Grade: '0' });
  });

  it('seeds defaults when label_data is empty', () => {
    const measurement: { label_data?: Record<string, unknown> } = { label_data: {} };
    seedDefaultLabelData(measurement, labelOptions);
    expect(measurement.label_data).toEqual({ Ethnicity: 'Unknown', Grade: '0' });
  });

  it('skips date-type labels without options (does not throw on .options[0])', () => {
    const measurement: { label_data?: Record<string, unknown> } = {};
    expect(() => seedDefaultLabelData(measurement, labelOptions)).not.toThrow();
    expect(measurement.label_data).not.toHaveProperty('ScanDate');
  });
});
