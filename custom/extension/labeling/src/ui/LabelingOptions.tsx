import React, { useEffect, useState } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@ohif/ui-next';

export type LabelingOptionsProps = {
  label: string;
  label_options: string[];
  label_value?: string;
  onChange: (label: string, value: string) => void;
};

const LabelingOptions = ({
  label,
  label_options,
  label_value = '',
  onChange,
}: LabelingOptionsProps) => {
  const [selectedOption, setSelectedOption] = useState(label_value);

  // Keep the control in sync when the incoming value changes
  // (e.g. a CSV import updates label_value while this control stays mounted).
  useEffect(() => {
    setSelectedOption(label_value);
  }, [label_value]);

  const onChangeValueHandler = (newValue: string) => {
    setSelectedOption(newValue);
    onChange(label, newValue);
  };

  return (
    <div
      className="bg-background group relative flex cursor-pointer items-stretch border border-transparent outline-none transition duration-300"
      data-cy="measurement-item"
    >
      <div className="relative flex w-full flex-col p-1">
        <div className="mb-1 ml-2 flex items-center">
          <div className="text-highlight flex flex-1 items-center text-base">{label}</div>
        </div>
        <div className="ml-3 mr-2 flex items-center">
          <Select
            value={selectedOption}
            onValueChange={onChangeValueHandler}
          >
            <SelectTrigger aria-label={label}>
              <SelectValue placeholder="Select…" />
            </SelectTrigger>
            <SelectContent>
              {/* Radix throws on an empty item value, and the option list comes
                  straight from the panel config. */}
              {label_options.filter(Boolean).map(option => (
                <SelectItem
                  key={option}
                  value={option}
                >
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
};

export default LabelingOptions;
