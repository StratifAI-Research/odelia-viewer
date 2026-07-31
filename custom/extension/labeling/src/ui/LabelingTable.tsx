import React from 'react';
import LabelingOptions from './LabelingOptions';
import LabelingDate from './LabelingDate';
import { seedDefaultLabelData } from '../utils/labelData';

interface LabelingTableProps {
  title: string;
  measurement: { uid: string; label_data?: Record<string, string> } & Record<string, unknown>;
  config: { label_options: Array<Record<string, { type?: string; options?: string[] }>> };
  onChange: (uid: string, label: string, value: string) => void;
}

const LabelingTable = ({ title, measurement, config, onChange }: LabelingTableProps) => {
  const label_options = Object.assign({}, ...config.label_options);
  // Seed default label data only for genuinely-uninitialised measurements.
  // Never overwrite existing/imported label_data (see seedDefaultLabelData).
  seedDefaultLabelData(measurement, label_options);

  return (
    <div>
      <div className="bg-secondary-main flex justify-between px-2 py-1">
        <span className="text-base font-bold uppercase tracking-widest text-white">{title}</span>
      </div>
      <div className="ohif-scrollbar max-h-64 overflow-y-auto overflow-x-hidden">
        {!!measurement.label_data &&
          Object.keys(measurement.label_data)
            .filter(key => key in label_options)
            .map((key, index) => {
              if (label_options[key].type === 'options') {
                return (
                  <LabelingOptions
                    key={key}
                    label={key ?? `Label ${index + 1}`}
                    label_options={label_options[key].options ?? []}
                    label_value={measurement.label_data?.[key] ?? ''}
                    onChange={(label, label_value) => {
                      onChange(measurement.uid, label, label_value);
                    }}
                  />
                );
              } else {
                return (
                  <LabelingDate
                    key={key}
                    label={key ?? `Label ${index + 1}`}
                    label_value={measurement.label_data?.[key] ?? ''}
                    onChange={(label, label_value) => {
                      onChange(measurement.uid, label, label_value);
                    }}
                  />
                );
              }
            })}
      </div>
    </div>
  );
};

export default LabelingTable;
