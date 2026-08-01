import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// Radix's Popover and react-day-picker's Calendar are not what these tests are
// about — the subject is what typed text does and does not commit. The stubs
// render the trigger and content inline (no portal, no focus management) and
// capture the props handed to Calendar so the selection it is asked to show can
// be asserted.
const calendarProps: any[] = [];

jest.mock('@ohif/ui-next', () => ({
  __esModule: true,
  Input: (props: any) => <input {...props} />,
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
  Calendar: (props: any) => {
    calendarProps.push(props);
    return (
      <button
        type="button"
        data-testid="calendar-pick"
        onClick={() => props.onSelect?.(new Date(2001, 1, 3))}
      >
        calendar
      </button>
    );
  },
}));

import DatePicker from './DatePicker';

const lastCalendarProps = () => calendarProps[calendarProps.length - 1];

const textbox = () => screen.getByRole('textbox') as HTMLInputElement;
const type = (value: string) => fireEvent.change(textbox(), { target: { value } });
const blur = () => fireEvent.blur(textbox());

/**
 * Render with a controlled `date`, mirroring how LabelingDate drives this:
 * the committed value is echoed straight back in as the `date` prop.
 */
function setup(initial?: string) {
  const onChange = jest.fn();
  const Harness = () => {
    const [date, setDate] = React.useState<string | undefined>(initial);
    return (
      <DatePicker
        date={date}
        onChange={value => {
          onChange(value);
          setDate(value.date);
        }}
      />
    );
  };
  const utils = render(<Harness />);
  return { onChange, ...utils };
}

beforeEach(() => {
  calendarProps.length = 0;
});

describe('DatePicker — typed input', () => {
  it('commits a valid past date as a DICOM DA value', () => {
    const { onChange } = setup();
    type('1992-10-22');
    expect(onChange).toHaveBeenCalledWith({ date: '19921022' });
  });

  it('commits an empty value as a cleared date', () => {
    const { onChange } = setup('19921022');
    type('');
    expect(onChange).toHaveBeenCalledWith({ date: '' });
  });

  it('does NOT commit a future date typed by hand', () => {
    const { onChange } = setup();
    type('2099-01-01');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits today, which is the latest allowed day', () => {
    const { onChange } = setup();
    const today = new Date();
    const iso = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');

    type(iso);

    expect(onChange).toHaveBeenCalledWith({ date: iso.replace(/-/g, '') });
  });

  it.each([
    ['an impossible day', '2024-02-30'],
    ['a non-leap Feb 29', '2023-02-29'],
    ['a month over 12', '2024-13-01'],
    ['incomplete text', '2024-01-0'],
    ['a year only', '2024'],
    ['non-numeric text', 'abcd-ef-gh'],
  ])('does NOT commit %s', (_label, value) => {
    const { onChange } = setup();
    type(value);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does NOT read a two-digit year as year 24', () => {
    // `parse` alone accepts "24-01-01" and yields the DICOM DA 00240101.
    const { onChange } = setup();
    type('24-01-01');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does NOT accept single-digit month/day components', () => {
    const { onChange } = setup();
    type('2024-1-1');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('DatePicker — blur reconciliation', () => {
  it('restores the committed value when the text was never committed', () => {
    setup('19921022');
    type('1992-10-2'); // incomplete: rejected, so the model still holds 19921022
    expect(textbox().value).toBe('1992-10-2');

    blur();

    // Otherwise the box would keep showing a date the export does not carry.
    expect(textbox().value).toBe('1992-10-22');
  });

  it('restores the committed value after a rejected future date', () => {
    setup('19921022');
    type('2099-01-01');
    blur();
    expect(textbox().value).toBe('1992-10-22');
  });

  it('clears the box when there is no committed value to restore', () => {
    setup();
    type('not-a-date');
    blur();
    expect(textbox().value).toBe('');
  });

  it('leaves a deliberately cleared field empty', () => {
    const { onChange } = setup('19921022');
    type('');
    blur();
    expect(textbox().value).toBe('');
    expect(onChange).toHaveBeenCalledWith({ date: '' });
  });

  it('leaves a valid typed date alone', () => {
    setup();
    type('1992-10-22');
    blur();
    expect(textbox().value).toBe('1992-10-22');
  });
});

describe('DatePicker — calendar', () => {
  it('commits a calendar selection', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByTestId('calendar-pick'));
    expect(onChange).toHaveBeenCalledWith({ date: '20010203' });
  });

  it('disables days after today', () => {
    setup();
    expect(lastCalendarProps().disabled).toEqual({ after: expect.any(Date) });
    const cutoff = lastCalendarProps().disabled.after as Date;
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('never shows a disabled future day as the selection', () => {
    setup();
    type('2099-01-01');
    // The typed value is rejected, so the calendar must not highlight it — nor
    // open on the year 2099.
    expect(lastCalendarProps().selected).toBeUndefined();
    expect((lastCalendarProps().defaultMonth as Date).getFullYear()).toBe(
      new Date().getFullYear()
    );
  });

  it('shows a valid typed date as the selection', () => {
    setup();
    type('1992-10-22');
    const selected = lastCalendarProps().selected as Date;
    expect(selected.getFullYear()).toBe(1992);
    expect(selected.getMonth()).toBe(9);
    expect(selected.getDate()).toBe(22);
  });
});
