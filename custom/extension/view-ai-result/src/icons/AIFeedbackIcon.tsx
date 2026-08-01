import React from 'react';

/**
 * Pencil for the AI Feedback panel — the reader marks a verdict on the model's
 * output, which is an annotation gesture rather than a measurement one.
 *
 * ui-next does ship a `pencil`, but it is a filled glyph on a 28x28 viewBox and
 * would read noticeably heavier than the 22x22 stroked tab icons beside it, so
 * this is drawn to the tab spec instead (see AIChatIcon for the details).
 */
export const AIFeedbackIcon = (props: React.SVGProps<SVGSVGElement>) => (
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
      {/* Nib, then the two shaft edges up to the far end. */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.8 19.2 4 15.6 16.8 2.8l2.4 2.4L6.4 18z"
      />
      {/* Ferrule: parallel to the nib, 86% along the shaft. */}
      <path
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 4.6 17.4 7"
      />
      <path d="M0 0h22v22H0z" />
    </g>
  </svg>
);

export default AIFeedbackIcon;
