// `registerIcons` is spied at the module seam rather than through Icons.addIcon:
// the @ohif/ui-next mock exposes Icons as a Proxy that answers every property
// with a component, so neither jest.spyOn nor the "already registered" guard
// inside registerIcons behaves as it does against the real registry.
jest.mock('./icons', () => ({
  ...jest.requireActual('./icons'),
  registerIcons: jest.fn(),
}));

import extension from './index';
import { ORTHANC_AI_ROUTING_ICONS, registerIcons } from './icons';
// The real registry, not the `@ohif/ui-next` mock: that mock is a Proxy whose
// every property is a component, so asserting against it would pass for any
// string at all.
import { Icons as UpstreamIcons } from '../../../../platform/ui-next/src/components/Icons/Icons';

const makeServicesManager = () => ({
  registerService: jest.fn(),
  services: {},
});

describe('orthanc-ai-routing panel module', () => {
  it('registers the AI routing panel', () => {
    const panels = extension.getPanelModule({ servicesManager: makeServicesManager() });

    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({
      name: 'ai-routing-panel',
      iconLabel: 'AI',
      label: 'Analyze with AI',
    });
    expect(typeof panels[0].component).toBe('function');
  });

  // Icons.ByName silently renders a literal "Missing Icon" box for a name that
  // is not in the registry, so a typo — or an icon this extension declares but
  // forgets to register in preRegistration — is only ever caught by eye.
  it('declares only icon names that will resolve at runtime', () => {
    // What Icons holds once preRegistration has run: upstream's set plus ours.
    const available = new Set([
      ...Object.keys(UpstreamIcons),
      ...Object.keys(ORTHANC_AI_ROUTING_ICONS),
    ]);

    // Guard the guard — a set that accepted anything would make this vacuous.
    expect(available.has('list-bullets')).toBe(false);

    const panels = extension.getPanelModule({ servicesManager: makeServicesManager() });
    expect(panels.length).toBeGreaterThan(0);
    panels.forEach(panel => {
      expect([panel.name, available.has(panel.iconName)]).toEqual([panel.name, true]);
    });
  });

  // Declaring the icons is only half of it — without this call they are never
  // on the shared registry, and the panel falls back to "Missing Icon".
  it('registers its icons during preRegistration, before any panel renders', () => {
    (registerIcons as jest.Mock).mockClear();

    extension.preRegistration({ servicesManager: makeServicesManager() });

    expect(registerIcons).toHaveBeenCalled();
  });
});
