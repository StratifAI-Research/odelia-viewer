import React from 'react';

/**
 * Processor for the "Analyze with AI" panel — the panel picks a model and sends
 * a study off to be computed on, so a chip reads more directly than the
 * clipboard it replaces (which suggested a worklist).
 *
 * Drawn to ui-next's tab-icon spec: 22x22 viewBox, unfilled, `currentColor`
 * stroke at the default width, round caps and joins, plus their invisible
 * full-bleed bounding path.
 */
export const AIModelIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
      {/* Package, then the die inside it. */}
      <rect
        stroke="currentColor"
        strokeLinejoin="round"
        x="5.5"
        y="5.5"
        width="11"
        height="11"
        rx="1.5"
      />
      <rect
        stroke="currentColor"
        strokeLinejoin="round"
        x="9"
        y="9"
        width="4"
        height="4"
        rx="0.5"
      />
      {/* Three pins per side, symmetric about the centre. */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        d="M8.5 2.5v3M11 2.5v3M13.5 2.5v3M8.5 16.5v3M11 16.5v3M13.5 16.5v3M2.5 8.5h3M2.5 11h3M2.5 13.5h3M16.5 8.5h3M16.5 11h3M16.5 13.5h3"
      />
      <path d="M0 0h22v22H0z" />
    </g>
  </svg>
);

export default AIModelIcon;
