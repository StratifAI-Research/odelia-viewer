// This package does not stub @ohif/ui-next globally, and importing the barrel
// reaches its ViewportGridProvider, which imports @ohif/core — not resolvable
// from here. Only panel metadata is read below (no component is rendered), so a
// passthrough for every named export is enough to cut that chain.
jest.mock('@ohif/ui-next', () => {
  const react = require('react');
  const Passthrough = ({ children }: any) => react.createElement('div', null, children);
  return new Proxy(
    { __esModule: true } as Record<string, unknown>,
    { get: (target, name: string) => (name in target ? target[name] : Passthrough) }
  );
});

// @ohif/core is a webpack external, unresolvable in this package's jest env
// (same reason and shape as the mock in utils/downloadCSVReport.test.ts). The
// panel components below are never rendered, so none of it is exercised.
jest.mock(
  '@ohif/core',
  () => ({
    DicomMetadataStore: { getStudy: () => undefined, getSeries: () => undefined },
    utils: { guid: () => 'test-guid' },
  }),
  { virtual: true }
);

import extension from './index';
// The real icon registry — deliberately not the mock above.
import { Icons as UpstreamIcons } from '../../../../platform/ui-next/src/components/Icons/Icons';

const makeArgs = () => ({
  servicesManager: { services: {} },
  extensionManager: {},
  commandsManager: {},
});

describe('labeling panel module', () => {
  it('registers the three labelling side panels in order', () => {
    const panels = extension.getPanelModule(makeArgs());

    expect(panels.map((p: any) => p.name)).toEqual([
      'panelLabeling',
      'panelLabelingStudy',
      'panelLabelingLesion',
    ]);
  });

  /**
   * Icons.ByName resolves these strings against ui-next's registry and silently
   * renders a literal "Missing Icon" box for anything absent from it. This panel
   * module shipped `list-bullets`, which has never been a registered icon, and
   * nothing failed — it just looked wrong.
   *
   * This extension registers no icons of its own, so every name it declares has
   * to already be upstream's.
   */
  it('declares only icon names that ui-next actually provides', () => {
    const available = new Set(Object.keys(UpstreamIcons));

    // Guard the guard — a set that accepted anything would make this vacuous.
    expect(available.has('list-bullets')).toBe(false);

    const panels = extension.getPanelModule(makeArgs());
    expect(panels.length).toBeGreaterThan(0);
    panels.forEach((panel: any) => {
      expect([panel.name, available.has(panel.iconName)]).toEqual([panel.name, true]);
    });
  });
});
