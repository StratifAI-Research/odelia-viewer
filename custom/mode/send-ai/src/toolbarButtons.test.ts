import toolbarButtons from './toolbarButtons';

const byId = (id: string) => toolbarButtons.find(button => button.id === id);

describe('send-ai toolbarButtons', () => {
  it('does not reuse an upstream button id', () => {
    // `register()` keeps the first definition for an id, and the cornerstone
    // pack (referenced by this mode) already registers `ImageSliceSync`.
    expect(byId('ImageSliceSync')).toBeUndefined();
    expect(byId('HeatmapSliceSync')).toBeDefined();
  });

  it('wires the slice-sync button to this extension`s command and evaluator', () => {
    expect(byId('HeatmapSliceSync')?.props).toMatchObject({
      commands: 'toggleHeatmapImageSliceSync',
      evaluate: 'evaluate.heatmapSync',
    });
  });

  it('declares the action-corner heatmap toggle with the ui type view-ai-result provides', () => {
    // Counterpart: the `viewAIResult.heatmapToggle` entry in
    // custom/extension/view-ai-result/src/index.tsx (getToolbarModule).
    // An unknown ui type throws inside ToolbarService at render time.
    expect(byId('aiHeatmapToggle')?.uiType).toBe('viewAIResult.heatmapToggle');
  });
});
