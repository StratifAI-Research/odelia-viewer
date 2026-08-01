import React, { useEffect, useState } from 'react';
import { format, isValid, parse, startOfDay } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar, Input, Popover, PopoverContent, PopoverTrigger } from '@ohif/ui-next';

const DICOM_DATE = 'yyyyMMdd';
const INPUT_DATE = 'yyyy-MM-dd';

/**
 * Exactly four-digit year, two-digit month, two-digit day.
 *
 * `parse` is lenient about component width: it reads "24-01-01" as the year 24
 * (committing a DICOM DA of 00240101) and "2024-1-1" as January 1st. A fixed
 * width field should not silently accept either, so the shape is checked before
 * parsing rather than trusting the parse alone.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const toInputValue = (dicomDate?: string): string => {
  if (!dicomDate) {
    return '';
  }
  const parsed = parse(dicomDate, DICOM_DATE, new Date());
  return isValid(parsed) ? format(parsed, INPUT_DATE) : '';
};

/**
 * The date a typed value denotes, or undefined when it is not a complete, real,
 * non-future day.
 *
 * A labelled date can only be today or earlier. The calendar enforces that with
 * `disabled={{ after: today }}`, and the text input has to apply the same bound
 * or the constraint is one keystroke away from being bypassed. Impossible
 * calendar days (2024-02-30, 2023-02-29, 2024-13-01) are already rejected by
 * `parse`, so only the width and the upper bound are added here.
 */
const parseTypedDate = (value: string): Date | undefined => {
  if (!ISO_DATE_RE.test(value)) {
    return undefined;
  }
  const parsed = parse(value, INPUT_DATE, new Date());
  if (!isValid(parsed) || startOfDay(parsed) > startOfDay(new Date())) {
    return undefined;
  }
  return parsed;
};

export type DatePickerProps = {
  id?: string;
  /** DICOM DA value, e.g. 19921022. */
  date?: string;
  placeholder?: string;
  /** Receives `{ date }` as a DICOM DA value, or an empty string when cleared. */
  onChange: (value: { date: string }) => void;
};

/**
 * Single-date picker for a label whose value is a DICOM DA string.
 *
 * Built on ui-next's Calendar (react-day-picker) rather than react-dates, which
 * is unmaintained and pulled in moment; the year dropdown the old picker
 * hand-rolled is `captionLayout="dropdown"` here.
 *
 * A labelled date can only be today or earlier. Both entry paths enforce that:
 * the calendar disables later days, and typed text goes through
 * {@link parseTypedDate}, which applies the same bound — the calendar's
 * constraint alone was bypassable by typing a future date by hand.
 */
export default function DatePicker({
  id = '',
  date,
  placeholder = 'Pick Date',
  onChange,
}: DatePickerProps) {
  const [inputValue, setInputValue] = useState<string>(() => toInputValue(date));
  const [open, setOpen] = useState(false);

  // Keep in sync when the value changes underneath us (e.g. a CSV import).
  useEffect(() => {
    setInputValue(toInputValue(date));
  }, [date]);

  const commit = (selected: Date | undefined) => {
    if (!selected) {
      setInputValue('');
      onChange({ date: '' });
      return;
    }
    setInputValue(format(selected, INPUT_DATE));
    onChange({ date: format(selected, DICOM_DATE) });
  };

  const onInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setInputValue(value);

    if (value === '') {
      onChange({ date: '' });
      return;
    }

    const parsed = parseTypedDate(value);
    if (parsed) {
      onChange({ date: format(parsed, DICOM_DATE) });
    }
    // Anything else — still being typed, malformed, or in the future — is left
    // uncommitted. onInputBlur decides what to do with it.
  };

  /**
   * Text that never became a value must not be left on screen looking like one.
   *
   * While typing, the box can hold something the field rejected (incomplete,
   * malformed, or a future date) while the model still holds the previous date —
   * so the reader would see one date and the CSV export would carry another.
   * Restoring the committed value on blur makes the rejection visible instead.
   */
  const onInputBlur = () => {
    if (inputValue === '' || parseTypedDate(inputValue)) {
      return;
    }
    setInputValue(toInputValue(date));
  };

  // Derived from the validated value, so the calendar can never highlight — or
  // open on the month of — a day it disables.
  const selectedDate = parseTypedDate(inputValue);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
    >
      <PopoverTrigger asChild>
        <div className="relative w-full">
          {!inputValue && (
            <CalendarIcon className="text-primary pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" />
          )}
          <Input
            id={id || undefined}
            type="text"
            placeholder={placeholder}
            autoComplete="off"
            value={inputValue}
            onChange={onInputChange}
            onBlur={onInputBlur}
            data-cy="input-labeling-date"
          />
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto overflow-hidden p-0"
        align="start"
      >
        <Calendar
          autoFocus
          mode="single"
          captionLayout="dropdown"
          defaultMonth={selectedDate ?? new Date()}
          selected={selectedDate}
          onSelect={selected => {
            commit(selected);
            setOpen(false);
          }}
          startMonth={new Date(new Date().getFullYear() - 100, 0)}
          endMonth={new Date()}
          disabled={{ after: new Date() }}
          numberOfMonths={1}
        />
      </PopoverContent>
    </Popover>
  );
}
