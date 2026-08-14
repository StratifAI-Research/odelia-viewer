import React from 'react';
import { installConsoleErrorFilter } from '../test-utils/harness';
import { render, screen } from '@testing-library/react';
import AITrackedViewport, { areEqual } from './AITrackedViewport';
import { useAIViewportStore } from '../stores/useAIViewportStore';
import { AISideBySideViewportProps } from '../types';

// Stub cornerstone viewport component: surfaces received props into the DOM.
let _lastViewportProps: any = null;
const StubViewport = (props: any) => {
  _lastViewportProps = props;
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
installConsoleErrorFilter({ silenceLog: true });

describe('AITrackedViewport', () => {
  beforeEach(() => {
    _lastViewportProps = null;
    useAIViewportStore.setState({ viewports: {} });
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
    render(<AITrackedViewport {...baseProps({ viewportId: 'vp-heatmap', displaySets })} />);
    expect(screen.getByTestId('cs-show-overlays').textContent).toBe('false');
    // heatmap viewport receives the full display set list, unfiltered
    expect(screen.getByTestId('cs-ds-count').textContent).toBe('2');
  });

  it('publishes AI state for a primary viewport so the overlay and corner can render', () => {
    render(<AITrackedViewport {...baseProps()} />);
    const state = useAIViewportStore.getState().viewports['vp-primary'];
    expect(state).toBeDefined();
    expect(typeof state.onToggleHeatmap).toBe('function');
  });

  it('publishes no AI state for a heatmap viewport', () => {
    render(<AITrackedViewport {...baseProps({ viewportId: 'vp-heatmap' })} />);
    expect(useAIViewportStore.getState().viewports['vp-heatmap']).toBeUndefined();
  });

  it('drops its published AI state when the viewport unmounts', () => {
    const { unmount } = render(<AITrackedViewport {...baseProps()} />);
    expect(useAIViewportStore.getState().viewports['vp-primary']).toBeDefined();
    unmount();
    expect(useAIViewportStore.getState().viewports['vp-primary']).toBeUndefined();
  });

  it('subscribes to AI result events for a primary viewport', () => {
    const services = makeServices();
    render(<AITrackedViewport {...baseProps({ servicesManager: services })} />);
    expect(services.services.aiResultsService.subscribe).toHaveBeenCalled();
  });

  it('skips event subscription for a heatmap viewport', () => {
    const services = makeServices();
    render(
      <AITrackedViewport {...baseProps({ viewportId: 'vp-heatmap', servicesManager: services })} />
    );
    expect(services.services.aiResultsService.subscribe).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// `areEqual` is the React.memo prop comparator. It returns TRUE when props are
// effectively equal (skip re-render) and FALSE when a meaningful change must
// trigger a re-render. It exists because OHIF's ViewportGrid passes fresh
// object/closure references on every grid render, so the default shallow compare
// would re-render (and re-run every AI hook/effect) on every frame — the
// "20 renders/sec" viewer-rendering-loop gotcha.
// ---------------------------------------------------------------------------
describe('AITrackedViewport areEqual', () => {
  const ds = (over: any = {}) => ({
    displaySetInstanceUID: 'ds-1',
    Modality: 'MR',
    StudyInstanceUID: 'study-1',
    images: [{ imageId: 'img-1' }, { imageId: 'img-2' }],
    ...over,
  });

  const BASE_OPTS = { viewportType: 'stack', orientation: 'axial', toolGroupId: 'default' };

  const props = (over: Partial<AISideBySideViewportProps> = {}): AISideBySideViewportProps => ({
    viewportId: 'viewport-1',
    servicesManager: {} as any,
    extensionManager: {} as any,
    commandsManager: {} as any,
    displaySets: [ds()],
    viewportOptions: { ...BASE_OPTS },
    ...over,
  });

  it('skips re-render when props are content-equal but freshly-constructed (the perf guarantee)', () => {
    // Simulates the grid handing us brand-new object/array identities each render.
    const prev = props();
    const next = props();
    expect(prev.displaySets).not.toBe(next.displaySets); // different references...
    expect(areEqual(prev, next)).toBe(true); // ...but we still skip.
  });

  it('re-renders when the top-level needsRerendering escape hatch is set', () => {
    expect(areEqual(props(), props({ needsRerendering: true }))).toBe(false);
  });

  it('IGNORES nested viewportOptions.needsRerendering (handled at the base viewport layer)', () => {
    // Regression guard for the "persistent loop" risk: the base viewport clears
    // this flag on the copied options object it receives, not on the grid's
    // original, so honoring it here would re-render on every grid frame.
    const prev = props();
    const next = props({ viewportOptions: { ...prev.viewportOptions, needsRerendering: true } });
    expect(areEqual(prev, next)).toBe(true);
  });

  it('re-renders when viewportId changes', () => {
    expect(areEqual(props(), props({ viewportId: 'viewport-2' }))).toBe(false);
  });

  // Each option test changes exactly ONE field (spreading BASE_OPTS) so it isolates
  // its own branch rather than tripping an earlier check on a now-undefined field.
  it('re-renders when orientation changes', () => {
    const next = props({ viewportOptions: { ...BASE_OPTS, orientation: 'sagittal' } });
    expect(areEqual(props(), next)).toBe(false);
  });

  it('re-renders when toolGroupId changes', () => {
    const next = props({ viewportOptions: { ...BASE_OPTS, toolGroupId: 'other' } });
    expect(areEqual(props(), next)).toBe(false);
  });

  it('re-renders when viewportType changes (heatmap stack <-> volume toggle)', () => {
    const next = props({ viewportOptions: { ...BASE_OPTS, viewportType: 'volume' } });
    expect(areEqual(props(), next)).toBe(false);
  });

  it('does NOT re-render when the incoming viewportType is undefined (matches OHIF guard)', () => {
    const prev = props({ viewportOptions: { viewportType: 'stack' } });
    const next = props({ viewportOptions: {} });
    expect(areEqual(prev, next)).toBe(true);
  });

  it('re-renders when displaySet count changes', () => {
    const next = props({ displaySets: [ds(), ds({ displaySetInstanceUID: 'ds-2' })] });
    expect(areEqual(props(), next)).toBe(false);
  });

  it('re-renders when a displaySetInstanceUID changes', () => {
    expect(areEqual(props(), props({ displaySets: [ds({ displaySetInstanceUID: 'ds-9' })] }))).toBe(
      false
    );
  });

  it('re-renders when Modality changes for the same UID (heatmap detection input)', () => {
    expect(areEqual(props(), props({ displaySets: [ds({ Modality: 'SC' })] }))).toBe(false);
  });

  it('re-renders when StudyInstanceUID changes for the same UID (AI-result selection input)', () => {
    expect(areEqual(props(), props({ displaySets: [ds({ StudyInstanceUID: 'study-2' })] }))).toBe(
      false
    );
  });

  it('re-renders when the image list length changes', () => {
    expect(
      areEqual(props(), props({ displaySets: [ds({ images: [{ imageId: 'img-1' }] })] }))
    ).toBe(false);
  });

  it('re-renders when an imageId changes at the same list length (the OHIF gotcha)', () => {
    const next = props({
      displaySets: [ds({ images: [{ imageId: 'img-1' }, { imageId: 'img-CHANGED' }] })],
    });
    expect(areEqual(props(), next)).toBe(false);
  });

  it('tolerates missing displaySets / viewportOptions without throwing', () => {
    const bare = props({ displaySets: undefined as any, viewportOptions: undefined });
    const bare2 = props({ displaySets: undefined as any, viewportOptions: undefined });
    expect(areEqual(bare, bare2)).toBe(true);
  });
});
