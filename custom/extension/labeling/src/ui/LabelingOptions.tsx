import React, { useEffect, useState } from 'react';

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

  const onChangeValueHandler = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = event.target.value;
    setSelectedOption(newValue);
    event.stopPropagation();
    onChange(label, newValue);
  };

  return (
    <div
      className="group relative flex cursor-pointer items-stretch border border-transparent bg-black outline-none transition duration-300"
      data-cy="measurement-item"
    >
      <div className="relative flex w-full flex-col p-1">
        <div className="mb-1 ml-2 flex items-center">
          <div className="text-primary-light flex flex-1 items-center text-base">{label}</div>
        </div>
        <div className="ml-3 flex items-center">
          <div className="text-primary-light flex flex-1 items-center text-base">
            <select
              onChange={onChangeValueHandler}
              value={selectedOption}
            >
              {label_options.map(option => (
                <option
                  key={option}
                  value={option}
                >
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LabelingOptions;
