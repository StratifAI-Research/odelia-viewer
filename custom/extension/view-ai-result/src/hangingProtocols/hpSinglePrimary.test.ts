import hpSinglePrimary from './hpSinglePrimary';

describe('hpSinglePrimary protocol', () => {
  it('declares the expected id and name', () => {
    expect(hpSinglePrimary.id).toBe('@ohif/extension-view-ai-result.hpSinglePrimary');
    expect(hpSinglePrimary.name).toBe('Single Primary Viewport');
  });

  it('matches studies that have at least one imaging display set', () => {
    expect(hpSinglePrimary.protocolMatchingRules).toHaveLength(1);
    const [rule] = hpSinglePrimary.protocolMatchingRules;
    expect(rule.id).toBe('HasPrimaryImaging');
    expect(rule.attribute).toBe('numberOfDisplaySetsWithImages');
    expect(rule.constraint).toEqual({ greaterThan: { value: 0 } });
  });

  it('binds the default tool group', () => {
    expect(hpSinglePrimary.toolGroupIds).toEqual(['default']);
  });

  it('selects a single primary display set that excludes SR and SC modalities', () => {
    const selectorIds = Object.keys(hpSinglePrimary.displaySetSelectors);
    expect(selectorIds).toEqual(['primaryDisplaySetId']);

    const rules = hpSinglePrimary.displaySetSelectors.primaryDisplaySetId.seriesMatchingRules;
    // Require imaging frames; exclude SR; exclude SC; prefer URL display sets.
    const required = rules.find((r: any) => r.attribute === 'numImageFrames')!;
    expect(required.required).toBe(true);
    expect(required.constraint).toEqual({ greaterThan: { value: 0 } });

    const excluded = rules
      .filter((r: any) => r.attribute === 'Modality')
      .map((r: any) => r.constraint.equals);
    expect(excluded).toEqual(expect.arrayContaining(['SR', 'SC']));
    rules
      .filter((r: any) => r.attribute === 'Modality')
      .forEach((r: any) => expect(r.weight).toBe(-100));

    const urlRule = rules.find((r: any) => r.attribute === 'isDisplaySetFromUrl')!;
    expect(urlRule.constraint).toEqual({ equals: true });
  });

  it('defaults to a stack viewport showing the primary display set', () => {
    expect(hpSinglePrimary.defaultViewport.viewportOptions.viewportType).toBe('stack');
    expect(hpSinglePrimary.defaultViewport.viewportOptions.toolGroupId).toBe('default');
    expect(hpSinglePrimary.defaultViewport.viewportOptions.allowUnmatchedView).toBe(true);
    expect(hpSinglePrimary.defaultViewport.displaySets).toEqual([
      { id: 'primaryDisplaySetId', matchedDisplaySetsIndex: -1 },
    ]);
  });

  it('forces a single-cell grid stage with one stack viewport', () => {
    expect(hpSinglePrimary.stages).toHaveLength(1);
    const [stage] = hpSinglePrimary.stages;
    expect(stage.name).toBe('singlePrimary');
    expect(stage.viewportStructure.layoutType).toBe('grid');
    expect(stage.viewportStructure.properties).toEqual({ rows: 1, columns: 1 });

    expect(stage.viewports).toHaveLength(1);
    const [viewport] = stage.viewports;
    expect(viewport.viewportOptions.viewportType).toBe('stack');
    expect(viewport.viewportOptions.toolGroupId).toBe('default');
    expect(viewport.viewportOptions.initialImageOptions).toEqual({ custom: 'sopInstanceLocation' });
    expect(viewport.displaySets).toEqual([
      { id: 'primaryDisplaySetId', matchedDisplaySetsIndex: 0 },
    ]);
  });
});
