import React from 'react';

/**
 * Speech bubble for the AI Chat panel.
 *
 * Drawn to the same spec as ui-next's own tab icons (22x22 viewBox, unfilled,
 * `currentColor` stroke at the default width, round caps and joins) so it sits
 * beside them in the panel rail without reading as heavier or lighter. The
 * trailing full-bleed path is their invisible bounding box, kept for the same
 * reason: it fixes the glyph's optical size regardless of the drawn extents.
 */
export const AIChatIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.5 2.5h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.5l-4 4v-4h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"
      />
      {/* Zero-length strokes with round caps: the dots render as the cap itself,
          slightly heavier than the outline so they stay legible at 22px. */}
      <path
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        d="M7 8.5h.01M11 8.5h.01M15 8.5h.01"
      />
      <path d="M0 0h22v22H0z" />
    </g>
  </svg>
);

export default AIChatIcon;
