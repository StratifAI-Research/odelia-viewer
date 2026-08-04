import React from 'react';
import { render, screen } from '@testing-library/react';
import extension from './index';
import { useAIViewportStore } from './stores/useAIViewportStore';
import type { AIResult } from './types';

const aiResult = { studyInstanceUID: 's1', hasHeatmap: true, classifications: [] } as AIResult;

const toolbarModule = () =>
  extension.getToolbarModule({
    servicesManager: { services: {} },
  } as any);

const heatmapToggleComponent = () => {
  const entry = toolbarModule().find(m => m.name === 'viewAIResult.heatmapToggle');
  return entry?.defaultComponent as React.ComponentType<{ viewportId?: string }>;
};

describe('view-ai-result toolbar module', () => {
  beforeEach(() => useAIViewportStore.setState({ viewports: {} }));

  // The counterpart of this name is `uiType: 'viewAIResult.heatmapToggle'` in
  // custom/mode/send-ai/src/toolbarButtons.ts. OHIF resolves the ui type at
  // render time and throws if it is unknown, so the two must stay in step.
  it('provides the `viewAIResult.heatmapToggle` ui type', () => {
    const entry = toolbarModule().find(m => m.name === 'viewAIResult.heatmapToggle');
    expect(entry?.defaultComponent).toBeTruthy();
  });

  it('renders the heatmap toggle for the viewport the toolbar names', () => {
    useAIViewportStore.setState({
      viewports: {
        'vp-1': { aiResult, hasHeatmap: true, isHeatmapActive: false, onToggleHeatmap: jest.fn() },
      },
    });

    const Component = heatmapToggleComponent();
    render(<Component viewportId="vp-1" />);

    expect((screen.getByRole('button', { name: 'Heatmap' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('renders nothing in viewports that have no AI result', () => {
    const Component = heatmapToggleComponent();
    const { container } = render(<Component viewportId="vp-1" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('evaluate.heatmapSync', () => {
  // The Slice Sync button's lit/unlit state. Driven by viewport MEMBERSHIP of the sync group,
  // which is the thing that actually changes when sync goes on or off.
  const evaluatorFor = (synchronizerIds: string[]) => {
    const servicesManager = {
      services: {
        syncGroupService: {
          getSynchronizersForViewport: () => synchronizerIds.map(id => ({ id })),
        },
        viewportGridService: {
          getState: () => ({
            activeViewportId: 'v1',
            viewports: new Map([
              ['v1', { displaySetInstanceUIDs: ['ds1'], viewportOptions: { viewportId: 'v1' } }],
            ]),
          }),
        },
      },
    };
    const entry = extension
      .getToolbarModule({ servicesManager } as any)
      .find(m => m.name === 'evaluate.heatmapSync');

    return entry?.evaluate as (props?: unknown) => { isActive: boolean; className: string };
  };

  it('reports active, and highlights, while the viewport is in the sync group', () => {
    const result = evaluatorFor(['HEATMAP_IMAGE_SLICE_SYNC'])();

    expect(result.isActive).toBe(true);
    expect(result.className).toContain('text-primary');
  });

  // The regression this guards: the old check asked the synchronizer whether it was disabled.
  // Switching sync off removes the viewports but leaves the synchronizer registered and enabled,
  // so the button stayed lit after the reader turned sync off.
  it('reports inactive once the viewport is no longer a member', () => {
    const result = evaluatorFor(['some-other-synchronizer'])();

    expect(result.isActive).toBe(false);
    expect(result.className).not.toContain('!text-primary');
  });

  it('reports inactive when the viewport is in no sync group at all', () => {
    const result = evaluatorFor([])();

    expect(result.isActive).toBe(false);
  });
});
