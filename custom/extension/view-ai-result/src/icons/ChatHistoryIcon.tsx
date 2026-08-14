import React from 'react';

/**
 * Clock-with-rewind: the conventional "history" glyph, used by the chat panel's
 * thread switcher.
 *
 * Drawn to the same spec as ui-next's own tab icons (22x22 viewBox, unfilled,
 * `currentColor` stroke, round caps and joins) so it sits beside them without
 * reading as heavier or lighter. The trailing full-bleed path is their invisible
 * bounding box, kept for the same reason: it fixes the glyph's optical size
 * regardless of the drawn extents.
 */
export const ChatHistoryIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 22 22"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <g
      fill="none"
      fillRule="evenodd"
    >
      {/* Dial, left open at the upper-left so the rewind arrow reads as part of
          the same stroke rather than a separate mark. */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.9 7.4A8 8 0 1 1 3 11"
      />
      {/* Rewind arrowhead at the open end. */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.5 3.5v4h4"
      />
      {/* Hands, pointing to roughly 10:10 as clock faces conventionally do. */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M11 6.8V11l3 1.8"
      />
      <path d="M0 0h22v22H0z" />
    </g>
  </svg>
);

export default ChatHistoryIcon;
