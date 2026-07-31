import React, { useEffect, useState } from 'react';
import { format, isValid, parse } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar, Popover, PopoverContent, PopoverTrigger, cn } from '@ohif/ui-next';

const DICOM_DATE = 'yyyyMMdd';
const INPUT_DATE = 'yyyy-MM-dd';

const toInputValue = (dicomDate?: string): string => {
  if (!dicomDate) {
    return '';
  }
  const parsed = parse(dicomDate, DICOM_DATE, new Date());
  return isValid(parsed) ? format(parsed, INPUT_DATE) : '';
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
 * hand-rolled is `captionLayout="dropdown"` here. Future dates are disabled, as
 * before — a labelled date can only be today or earlier.
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

    const parsed = parse(value, INPUT_DATE, new Date());
    if (isValid(parsed)) {
      onChange({ date: format(parsed, DICOM_DATE) });
    }
  };

  const selectedDate = isValid(parse(inputValue, INPUT_DATE, new Date()))
    ? parse(inputValue, INPUT_DATE, new Date())
    : undefined;

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
          <input
            id={id || undefined}
            type="text"
            placeholder={placeholder}
            autoComplete="off"
            value={inputValue}
            onChange={onInputChange}
            className={cn(
              'border-input focus:border-ring hover:text-foreground placeholder:text-muted-foreground bg-background hover:bg-background h-7 w-full justify-start rounded border py-1 pl-1.5 pr-0.5 text-left text-base font-normal'
            )}
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
