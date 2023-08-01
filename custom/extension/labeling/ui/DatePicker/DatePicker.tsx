import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import moment from 'moment';

/** REACT DATES */
import { SingleDatePicker, isInclusivelyBeforeDay } from 'react-dates';
import 'react-dates/initialize';
import 'react-dates/lib/css/_datepicker.css';
import './DateRange.css';

const renderYearsOptions = () => {
  const currentYear = moment().year();
  const options = [];

  for (let i = 0; i < 100; i++) {
    const year = currentYear - i;
    options.push(
      <option key={year} value={year}>
        {year}
      </option>
    );
  }

  return options;
};

const DatePicker = (props) => {
  const { id, onChange, date, text } = props;
  const [focused, setFocused] = useState(null);
  const renderYearsOptionsCallback = useCallback(renderYearsOptions, []);

  const renderMonthElement = ({ month, onMonthSelect, onYearSelect }) => {
    renderMonthElement.propTypes = {
      month: PropTypes.object,
      onMonthSelect: PropTypes.func,
      onYearSelect: PropTypes.func,
    };

    const handleMonthChange = (event) => {
      onMonthSelect(month, event.target.value);
    };

    const handleYearChange = (event) => {
      onYearSelect(month, event.target.value);
    };

    const handleOnBlur = () => { };

    return (
      <div className="flex justify-center">
        <div className="my-0 mx-1">
          <select
            className="DatePicker_select"
            value={month.month()}
            onChange={handleMonthChange}
            onBlur={handleOnBlur}
          >
            {moment.months().map((label, value) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="my-0 mx-1">
          <select
            className="DatePicker_select"
            value={month.year()}
            onChange={handleYearChange}
            onBlur={handleOnBlur}
          >
            {renderYearsOptionsCallback()}
          </select>
        </div>
      </div>
    );
  };

  // Moment
  const parsedDate = date ? moment(date, 'YYYYMMDD') : null;

  return (
    <SingleDatePicker
      /** REQUIRED */
      date={parsedDate}
      onDateChange={(date) => {
        console.log(date)
        onChange({
          date: date.format('YYYYMMDD'),
        })
      }}
      focused={focused}
      onFocusChange={({ focused }) => setFocused(focused)}
      /** OPTIONAL */
      renderMonthElement={renderMonthElement}
      placeholder={text ? text : "Pick Date"}
      phrases={{
        closeDatePicker: 'Close',
        clearDates: 'Clear dates',
      }}
      isOutsideRange={(day) => !isInclusivelyBeforeDay(day, moment())}
      hideKeyboardShortcutsPanel={true}
      numberOfMonths={1}
      anchorDirection="left"
      displayFormat="DD/MM/YYYY"
    />
  );
};

DatePicker.defaultProps = {
  id: '',
  date: null,
};

DatePicker.propTypes = {
  id: PropTypes.string,
  /** YYYYMMDD (19921022) */
  date: PropTypes.string,
  onChange: PropTypes.func.isRequired,
};

export default DatePicker;
