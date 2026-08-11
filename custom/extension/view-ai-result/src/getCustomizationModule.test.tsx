import React from 'react';
import { render, screen } from '@testing-library/react';
import update from 'immutability-helper';
import getCustomizationModule from './getCustomizationModule';
import extension from './index';
import { useAIViewportStore } from './stores/useAIViewportStore';
import type { AIResult } from './types';
// The REAL upstream defaults, imported from source rather than restated here.
// `@ohif/extension-cornerstone` is stubbed for this package's jest environment,
// but this particular file is a bare object literal with no imports of its own,
// so a direct path gives the genuine article. That is the point of the suite:
// what upstream puts in those corners is exactly what this customization used
// to destroy.
import viewportOverlayCustomization from '../../../../extensions/cornerstone/src/customizations/viewportOverlayCustomization';

const aiResult = {
  studyInstanceUID: 's1',
  hasHeatmap: false,
  modelInfo: { name: 'ODELIA-Net' },
  classifications: [{ side: 'Left', result: 'Benign', confidence: 50 }],
} as AIResult;

const overlay = () =>
  getCustomizationModule().find(entry => entry.name === 'aiViewportOverlay')!.value;

/**
 * Apply the customization the way CustomizationService does.
 *
 * `_addReference` splits the module value into one `setModeCustomization` call
 * per key, and each of those runs `update(defaultValue, ourValue)` from
 * immutability-helper — the same function called here. So this exercises the
 * real merge, not an approximation of it.
 */
const applyTo = (corner: string) => {
  const ours = overlay()[corner];
  const upstream = viewportOverlayCustomization[corner];
  return ours === undefined ? upstream : update(upstream, ours);
};

const idsIn = (corner: string) => (applyTo(corner) ?? []).map((item: { id?: string }) => item?.id);

describe('view-ai-result customization module', () => {
  beforeEach(() => useAIViewportStore.setState({ viewports: {} }));

  it('is not named `default` or `global`, which OHIF would apply to every mode', () => {
    const names = getCustomizationModule().map(entry => entry.name);
    expect(names).not.toContain('default');
    expect(names).not.toContain('global');
  });

  it('is exposed by the extension so a mode can reference it by name', () => {
    expect(extension.getCustomizationModule).toBe(getCustomizationModule);
  });

  it('renders the AI summary for the viewport OHIF passes to contentF', () => {
    useAIViewportStore.setState({
      viewports: {
        v1: { aiResult, hasHeatmap: false, isHeatmapActive: false, onToggleHeatmap: null },
      },
    });

    const [item] = applyTo('viewportOverlay.topLeft');
    render(<>{item.contentF({ viewportId: 'v1' })}</>);

    expect(screen.getByText('🤖 ODELIA-Net')).toBeTruthy();
  });

  it('puts the AI summary first, keeping upstream’s topLeft items after it', () => {
    expect(idsIn('viewportOverlay.topLeft')).toEqual([
      'aiResultSummary',
      'StudyDate',
      'SeriesDescription',
    ]);
  });

  // The regression this suite exists for. Setting these corners to `[]` cost the
  // reader the Window/Level readout and the Instance Number on EVERY viewport in
  // the mode -- including a study not yet sent to AI, since the customization is
  // applied unconditionally at mode entry.
  it('leaves the Window/Level readout and the Instance Number alone', () => {
    expect(overlay()['viewportOverlay.bottomLeft']).toBeUndefined();
    expect(overlay()['viewportOverlay.bottomRight']).toBeUndefined();

    expect(idsIn('viewportOverlay.bottomLeft')).toContain('WindowLevel');
    expect(idsIn('viewportOverlay.bottomRight')).toContain('InstanceNumber');
  });

  it('does not restate topRight, which upstream already leaves empty', () => {
    expect(overlay()['viewportOverlay.topRight']).toBeUndefined();
    expect(viewportOverlayCustomization['viewportOverlay.topRight']).toEqual([]);
  });

  // `setModeCustomization` merges against the previous MODE value when there is
  // one, so an accidental second application would otherwise prepend twice.
  it('is idempotent if the customization is applied more than once', () => {
    const once = applyTo('viewportOverlay.topLeft');
    const twice = update(once, overlay()['viewportOverlay.topLeft']);

    expect(twice.map((item: { id?: string }) => item?.id)).toEqual([
      'aiResultSummary',
      'StudyDate',
      'SeriesDescription',
    ]);
  });

  // `$unshift` throws on a missing target; `$apply` has to cope, because a mode
  // that applies this without the cornerstone defaults registered is otherwise a
  // hard crash at mode entry.
  it('survives upstream declaring no topLeft items at all', () => {
    const merged = update(undefined, overlay()['viewportOverlay.topLeft']) as { id?: string }[];

    expect(merged.map(item => item?.id)).toEqual(['aiResultSummary']);
  });
});
