import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Icon } from '@ohif/ui';
import LabelingOptions from './LabelingOptions';
import LabelingDate from './LabelingDate';
const LabelingTable = ({ title, measurement, config, onClick, onChange }) => {
  const label_options = Object.assign({}, ...config.label_options);
  // Fill in label data for new measurements

  if (measurement.label == '') {
    measurement.label_data = {};
    console.log(measurement.label_data);
    Object.keys(label_options).forEach(element => {
      measurement.label_data[element] = label_options[element].options[0];
    });
  }

  return (
    <div>
      <div className="flex justify-between px-2 py-1 bg-secondary-main">
        <span className="text-base font-bold tracking-widest text-white uppercase">
          {title}
        </span>
      </div>
      <div className="overflow-x-hidden overflow-y-auto ohif-scrollbar max-h-64">
        {!!measurement.label_data &&
          Object.keys(measurement.label_data)
            .filter(key => key in label_options)
            .map((key, index) => {
              if (label_options[key].type == 'options') {
                return (
                  <LabelingOptions
                    key={key}
                    id={index}
                    index={index + 1}
                    label={key ?? `Label ${index + 1}`}
                    label_options={label_options[key].options ?? []}
                    label_value={measurement.label_data[key]}
                    onClick={() => {
                      onClick(key);
                    }}
                    onChange={(label, label_value) => {
                      onChange(measurement.uid, label, label_value);
                    }}
                  />
                );
              } else {
                return (
                  <LabelingDate
                    key={key}
                    id={index}
                    index={index + 1}
                    label={key ?? `Label ${index + 1}`}
                    label_value={measurement.label_data[key]}
                    onClick={() => {
                      onClick(key);
                    }}
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

LabelingTable.propTypes = {
  title: PropTypes.string.isRequired,
  labels: PropTypes.array.isRequired,
  activeLabelId: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onToggleVisibility: PropTypes.func.isRequired,
  onToggleVisibilityAll: PropTypes.func.isRequired,
};

LabelingTable.defaultProps = {
  title: '',
  labels: [],
  activeLabelId: '',
  onClick: () => {},
  onEdit: () => {},
  onToggleVisibility: () => {},
  onToggleVisibilityAll: () => {},
};

export default LabelingTable;
