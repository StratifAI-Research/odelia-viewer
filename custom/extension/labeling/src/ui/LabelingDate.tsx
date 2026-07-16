import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import DatePicker from './DatePicker/DatePicker';

const LabelingDate = ({ id, label, label_value, onChange }) => {
  const [isHovering, setIsHovering] = useState(false);
  const [selectedOption, setSelectedOption] = useState(label_value);

  // LAB-L4/M-06: keep the control in sync when the incoming value changes
  // (e.g. a CSV import updates label_value while this control stays mounted).
  useEffect(() => {
    setSelectedOption(label_value);
  }, [label_value]);

  const onChangeValueHandler = ({ date }) => {
    setSelectedOption(date);
    onChange(label, date);
  };

  const onMouseEnter = () => setIsHovering(true);
  const onMouseLeave = () => setIsHovering(false);

  return (
    <div
      className={classnames(
        'group relative flex cursor-pointer items-stretch border border-transparent bg-black outline-none transition duration-300'
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      data-cy={'measurement-item'}
    >
      <div className="relative flex w-full flex-col p-1">
        <div className="mb-1 ml-2 flex items-center">
          <div className="text-primary-light flex flex-1 items-center text-base">{label}</div>
        </div>
        <div className="ml-3 flex items-center">
          <DatePicker
            date={selectedOption}
            onChange={e => onChangeValueHandler(e)}
          />
        </div>
      </div>
    </div>
  );
};

LabelingDate.propTypes = {
  id: PropTypes.oneOfType([PropTypes.number.isRequired, PropTypes.string.isRequired]),
  index: PropTypes.number.isRequired,
  label: PropTypes.string,
  label_value: PropTypes.string,
  isActive: PropTypes.bool,
  isVisible: PropTypes.bool,
  onClick: PropTypes.func,
  onEdit: PropTypes.func,
  onDelete: PropTypes.func,
  toggleVisibility: PropTypes.func,
};

LabelingDate.defaultProps = {
  isActive: false,
  label_value: '',
};

export default LabelingDate;
