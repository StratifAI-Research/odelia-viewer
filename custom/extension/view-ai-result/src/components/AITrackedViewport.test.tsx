import React from 'react';
import { render, screen } from '@testing-library/react';
import AITrackedViewport from './AITrackedViewport';

// Stub cornerstone viewport component: surfaces received props into the DOM.
let lastViewportProps: any = null;
const StubViewport = (props: any) => {
  lastViewportProps = props;
  return (
    <div data-testid="cs-viewport">
      <span data-testid="cs-viewport-id">{props.viewportId}</span>
      <span data-testid="cs-ds-count">{props.displaySets.length}</span>
      <span data-testid="cs-show-overlays">{String(props.viewportOptions.showOverlays)}</span>
    </div>
  );
};

const makeServices = () => ({
  services: {
    viewportGridService: { getState: jest.fn(() => ({ viewports: new Map() })) },
    viewportActionCornersService: {
      addComponent: jest.fn(),
      LOCATIONS: { topRight: 'topRight' },
    },
    customizationService: { setCustomizations: jest.fn() },
    aiResultsService: {
      subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      EVENTS: { AI_RESULT_SELECTED: 'sel', AI_RESULT_CLEARED: 'clr' },
    },
  },
});

const baseProps = (over: any = {}) => ({
  viewportId: 'vp-primary',
  servicesManager: makeServices(),
  extensionManager: { getModuleEntry: jest.fn(() => ({ component: StubViewport })) },
  commandsManager: { runCommand: jest.fn() },
  displaySets: [],
  viewportOptions: {},
  ...over,
});

// Component logs verbosely on mount/unmount; silence log and swallow the
// environmental ReactDOMTestUtils.act deprecation, re-emit other errors.
const realError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('ReactDOMTestUtils.act')) {
      return;
    }
    realError(...args);
  });
});
afterAll(() => {
  (console.log as jest.Mock).mockRestore();
  (console.error as jest.Mock).mockRestore();
});

describe('AITrackedViewport', () => {
  beforeEach(() => {
    lastViewportProps = null;
  });

  it('renders the cornerstone viewport wrapper for a primary viewport', () => {
    render(<AITrackedViewport {...baseProps()} />);
    expect(screen.getByTestId('cs-viewport')).toBeTruthy();
    expect(screen.getByTestId('cs-viewport-id').textContent).toBe('vp-primary');
  });

  it('enables overlays for a primary viewport', () => {
    render(<AITrackedViewport {...baseProps()} />);
    expect(screen.getByTestId('cs-show-overlays').textContent).toBe('true');
  });

  it('passes only primary display sets to a primary viewport', () => {
    // No SC here: an SC display set would reclassify this as a heatmap viewport.
    const displaySets = [
      { displaySetInstanceUID: 'mr1', Modality: 'MR' },
      { displaySetInstanceUID: 'mr2', Modality: 'MR' },
      { displaySetInstanceUID: 'sr', Modality: 'SR' },
    ];
    render(<AITrackedViewport {...baseProps({ displaySets })} />);
    // SR is filtered out; only the two MR primaries remain
    expect(screen.getByTestId('cs-ds-count').textContent).toBe('2');
  });

  it('classifies a viewport containing an SC display set as a heatmap viewport', () => {
    // SC display set forces heatmap mode even on a non "-heatmap" viewport id.
    const services = makeServices();
    const displaySets = [
      { displaySetInstanceUID: 'mr', Modality: 'MR' },
      { displaySetInstanceUID: 'sc', Modality: 'SC' },
    ];
    render(
      <AITrackedViewport
        {...baseProps({ viewportId: 'vp-primary', displaySets, servicesManager: services })}
      />
    );
    // heatmap mode disables overlays and forwards the unfiltered list
    expect(screen.getByTestId('cs-show-overlays').textContent).toBe('false');
    expect(screen.getByTestId('cs-ds-count').textContent).toBe('2');
    // and skips AI result subscription
    expect(services.services.aiResultsService.subscribe).not.toHaveBeenCalled();
  });

  it('disables overlays and forwards all display sets for a heatmap viewport', () => {
    const displaySets = [
      { displaySetInstanceUID: 'mr', Modality: 'MR' },
      { displaySetInstanceUID: 'sc', Modality: 'SC' },
    ];
    render(
      <AITrackedViewport {...baseProps({ viewportId: 'vp-heatmap', displaySets })} />
    );
    expect(screen.getByTestId('cs-show-overlays').textContent).toBe('false');
    // heatmap viewport receives the full display set list, unfiltered
    expect(screen.getByTestId('cs-ds-count').textContent).toBe('2');
  });

  it('clears overlays but never adds a heatmap toggle on a heatmap viewport', () => {
    const services = makeServices();
    render(
      <AITrackedViewport
        {...baseProps({ viewportId: 'vp-heatmap', servicesManager: services })}
      />
    );
    const addComponent = services.services.viewportActionCornersService.addComponent;
    // heatmap viewport aggressively clears the AI overlay corner...
    expect(addComponent).toHaveBeenCalled();
    const ids = addComponent.mock.calls.map((c: any[]) => c[0].id);
    expect(ids).toContain('aiOverlay');
    // ...but never registers the heatmap toggle corner
    expect(ids).not.toContain('heatmapToggle');
  });

  it('subscribes to AI result events for a primary viewport', () => {
    const services = makeServices();
    render(<AITrackedViewport {...baseProps({ servicesManager: services })} />);
    expect(services.services.aiResultsService.subscribe).toHaveBeenCalled();
  });

  it('skips event subscription for a heatmap viewport', () => {
    const services = makeServices();
    render(
      <AITrackedViewport
        {...baseProps({ viewportId: 'vp-heatmap', servicesManager: services })}
      />
    );
    expect(services.services.aiResultsService.subscribe).not.toHaveBeenCalled();
  });
});
