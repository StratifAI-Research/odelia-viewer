import React, { useCallback, useMemo } from 'react';
import {
  formatRange,
  formatSliceTally,
  rangeSize,
  sampleSliceNumbers,
  SliceLimit,
  SliceRange,
} from '../../utils/sliceSelection';
import './SliceRangeSlider.css';

/**
 * Native range thumbs are inset by half their width, so a mark placed at a raw
 * percentage drifts from the handle it belongs to — by 6px at each end of the
 * track. Every mark is therefore positioned inside the same reduced span. Keep in
 * step with the thumb width in SliceRangeSlider.css.
 */
const THUMB_PX = 12;

interface SliceRangeSliderProps {
  /** Total slices in the series. */
  total: number;
  /** 1-based inclusive selection. */
  range: SliceRange;
  /** How many slices to sample from the range. */
  count: number;
  /** The slice the viewport shows, 1-based; null when it shows a different series. */
  viewerSliceNumber: number | null;
  /** Distinguishes the accessible names when several series are attached. */
  seriesLabel: string;
  /** How many slices may be sent, and what decides it — see maxSlicesForModel. */
  sliceLimit: SliceLimit;
  onRangeChange: (range: SliceRange) => void;
  onCountChange: (count: number) => void;
}

/**
 * Dual-handle slice-range control.
 *
 * Its whole purpose is to keep apart two facts a single slider would blur: the
 * range the user *selected*, and the slices that will actually be *sent*. The
 * range is a band; the model sees a sample of it. Reporting only the band invites
 * a reader to believe a 45-slice range means 45 images were analysed.
 *
 * Three marks share one track and mean different things:
 *   - the shaded band: the selected range
 *   - the dots above it: the exact slices that will reach the model
 *   - the triangle below it: the slice the viewport is showing right now
 *
 * The triangle is deliberately outside the band. It is orientation — where you
 * are — not part of the selection; drawing it among the dots would suggest that
 * scrolling changes what gets sent.
 *
 * Built from two native range inputs rather than custom pointer handling, so
 * keyboard and touch work without reimplementation.
 */
const SliceRangeSlider: React.FC<SliceRangeSliderProps> = ({
  total,
  range,
  count,
  viewerSliceNumber,
  seriesLabel,
  sliceLimit,
  onRangeChange,
  onCountChange,
}) => {
  const span = rangeSize(range);
  const sampled = useMemo(() => sampleSliceNumbers(range, count), [range, count]);

  /** Track offset of a slice number, inset to match the handles. */
  const offsetOf = useCallback(
    (sliceNumber: number): string => {
      const fraction = total <= 1 ? 0 : (sliceNumber - 1) / (total - 1);
      return `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${fraction})`;
    },
    [total]
  );

  // The handles cannot cross: dragging one past the other pushes it along. That
  // keeps `start <= end` an invariant of the control rather than something the
  // sampler downstream has to defend against.
  const handleStart = (value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const start = Math.min(Math.max(1, value), total);
    onRangeChange({ start, end: Math.max(start, range.end) });
  };

  const handleEnd = (value: number) => {
    if (!Number.isFinite(value)) {
      return;
    }
    const end = Math.min(Math.max(1, value), total);
    onRangeChange({ start: Math.min(range.start, end), end });
  };

  if (total <= 0) {
    return null;
  }

  const maxCount = Math.min(span, sliceLimit.limit);
  // A window wider than the limit cannot send all of itself, and the only sign of
  // that was the + button greying out. "Range 67–120" beside "50 slices sent"
  // then reads as arithmetic that does not add up.
  const cappedByLimit = span > sliceLimit.limit;

  /** Why the selection is being truncated, in the terms that caused it. */
  const limitExplanation = () => {
    const skipped = span - sampled.length;
    const tail = `so ${skipped} of the ${span} slices in this window are skipped. Narrow the window to send every slice in it.`;
    if (sliceLimit.reason === 'transport' || !sliceLimit.contextLength) {
      return `${sliceLimit.limit} slices is the most one message can carry, ${tail}`;
    }
    const context = `${Math.round(sliceLimit.contextLength / 1000)}k context`;
    return sliceLimit.reason === 'model'
      ? `This model fits ${sliceLimit.limit} slices — a ${context} at ${sliceLimit.tokensPerImage} tokens per image — ${tail}`
      : `This model reports no per-image cost; at an assumed ${sliceLimit.tokensPerImage} tokens each its ${context} fits ${sliceLimit.limit} slices, ${tail}`;
  };

  return (
    <div className="mt-1.5">
      {/* The selection, then what it actually sends. Two quantities, stated
          separately, because the second is the one that reaches the model. */}
      <div className="text-muted-foreground flex items-baseline justify-between gap-2 text-[11px]">
        <span>Range {formatRange(range, total)}</span>
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onCountChange(count - 1)}
            disabled={count <= 1}
            title="Send fewer slices"
            aria-label={`Send fewer slices from ${seriesLabel}`}
            className="hover:text-foreground disabled:opacity-40"
          >
            −
          </button>
          <span
            className="text-foreground whitespace-nowrap"
            title={
              cappedByLimit
                ? `The window holds ${span} slices; ${sliceLimit.limit} is the most this model can be sent`
                : undefined
            }
          >
            {cappedByLimit
              ? `${sampled.length} of ${span} slices sent`
              : `${formatSliceTally(sampled.length)} sent`}
          </span>
          <button
            type="button"
            onClick={() => onCountChange(count + 1)}
            disabled={count >= maxCount}
            title="Send more slices"
            aria-label={`Send more slices from ${seriesLabel}`}
            className="hover:text-foreground disabled:opacity-40"
          >
            +
          </button>
        </span>
      </div>

      {/* Track. `relative` anchors the band, the dots and the viewer marker; the
          two inputs sit on top of it. */}
      <div className="relative mt-1 h-6">
        <div className="bg-secondary absolute left-0 right-0 top-[10px] h-1 rounded-full" />
        <div
          className="bg-primary absolute top-[10px] h-1 rounded-full"
          style={{
            left: offsetOf(range.start),
            right: `calc(100% - ${offsetOf(range.end)})`,
          }}
        />

        {/* The slices that will actually be sent. Above the band rather than on
            it, so a handle parked at either end cannot hide one. */}
        {sampled.map(n => (
          <span
            key={n}
            aria-hidden="true"
            className="bg-highlight absolute top-1 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
            style={{ left: offsetOf(n) }}
          />
        ))}

        {/* Where the viewport is. Different shape, below the track: it must not
            read as one of the sent slices. */}
        {viewerSliceNumber != null && (
          <span
            aria-hidden="true"
            title={`Viewer is on slice ${viewerSliceNumber}`}
            className="text-foreground absolute top-[15px] -translate-x-1/2 text-[9px] leading-none"
            style={{ left: offsetOf(viewerSliceNumber) }}
          >
            ▲
          </span>
        )}

        <input
          type="range"
          min={1}
          max={total}
          value={range.start}
          onChange={e => handleStart(parseInt(e.target.value, 10))}
          aria-label={`First slice of ${seriesLabel}`}
          aria-valuetext={`Slice ${range.start} of ${total}`}
          className="chat-slice-range absolute left-0 top-[6px] h-3 w-full appearance-none bg-transparent"
        />
        <input
          type="range"
          min={1}
          max={total}
          value={range.end}
          onChange={e => handleEnd(parseInt(e.target.value, 10))}
          aria-label={`Last slice of ${seriesLabel}`}
          aria-valuetext={`Slice ${range.end} of ${total}`}
          className="chat-slice-range absolute left-0 top-[6px] h-3 w-full appearance-none bg-transparent"
        />
      </div>

      {/* A legend, because three marks on one track are not self-explanatory and
          mistaking the range for the sent slices is the error that matters. */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]">
        <span className="flex items-center gap-1">
          <span
            aria-hidden="true"
            className="bg-highlight h-1.5 w-1.5 rounded-full"
          />
          sent to model
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true">▲</span>
          viewer slice
        </span>
      </div>

      {cappedByLimit && (
        <p className="text-muted-foreground mt-0.5 text-[10px]">{limitExplanation()}</p>
      )}
    </div>
  );
};

export default SliceRangeSlider;
