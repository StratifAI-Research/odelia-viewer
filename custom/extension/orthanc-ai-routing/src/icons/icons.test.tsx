import React from 'react';
import { render } from '@testing-library/react';
import { ORTHANC_AI_ROUTING_ICONS } from './index';

const entries = Object.entries(ORTHANC_AI_ROUTING_ICONS);

describe('orthanc-ai-routing panel icons', () => {
  it.each(entries)('%s renders an svg on the 22x22 tab grid', (_name, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector('svg')!;

    expect(svg).toBeTruthy();
    // Matching ui-next's tab icons: same box, so the glyph sits at the same
    // optical size as the ones beside it in the panel rail.
    expect(svg.getAttribute('viewBox')).toBe('0 0 22 22');
  });

  it.each(entries)('%s inherits colour rather than hard-coding it', (_name, Icon) => {
    const { container } = render(<Icon />);

    // A literal fill/stroke would ignore the rail's selected/hover states.
    expect(container.querySelectorAll('[stroke="currentColor"]').length).toBeGreaterThan(0);
    expect(container.querySelector('[stroke="#000"], [stroke="black"]')).toBeNull();
  });

  // Icons.ByName passes className through; an icon that drops its props renders
  // at the wrong size and colour, and nothing else catches it.
  it.each(entries)('%s forwards className to the svg', (_name, Icon) => {
    const { container } = render(<Icon className="h-5 w-5" />);

    expect(container.querySelector('svg')!.getAttribute('class')).toBe('h-5 w-5');
  });
});
