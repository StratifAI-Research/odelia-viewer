import React, { useEffect, useState } from 'react';
import DatePicker from './DatePicker/DatePicker';

export type LabelingDateProps = {
  label: string;
  /** DICOM DA value, e.g. 19921022. */
  label_value?: string;
  onChange: (label: string, value: string) => void;
};

const LabelingDate = ({ label, label_value = '', onChange }: LabelingDateProps) => {
  const [selectedOption, setSelectedOption] = useState(label_value);

  // Keep the control in sync when the incoming value changes
  // (e.g. a CSV import updates label_value while this control stays mounted).
  useEffect(() => {
    setSelectedOption(label_value);
  }, [label_value]);

  const onChangeValueHandler = ({ date }: { date: string }) => {
    setSelectedOption(date);
    onChange(label, date);
  };

  return (
    <div
      className="group relative flex cursor-pointer items-stretch border border-transparent bg-background outline-none transition duration-300"
      data-cy="measurement-item"
    >
      <div className="relative flex w-full flex-col p-1">
        <div className="mb-1 ml-2 flex items-center">
          <div className="text-highlight flex flex-1 items-center text-base">{label}</div>
        </div>
        <div className="ml-3 flex items-center">
          <DatePicker
            date={selectedOption}
            onChange={onChangeValueHandler}
          />
        </div>
      </div>
    </div>
  );
};

export default LabelingDate;
