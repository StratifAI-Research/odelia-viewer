import React from 'react';
import { render, act } from '@testing-library/react';
import { installConsoleErrorFilter } from '../test-utils/harness';

import AITrackedViewport from './AITrackedViewport';

// AI-result selection / heatmap regression coverage. The component's hooks are
// mocked so the test can drive the AI_RESULT_SELECTED callback directly and
// observe which result the heatmap layout is built from.

let mockInitialResult: any = null;
const mockToggleHeatmapLayout = jest.fn();
// Stands in for the store write: records the AI state the viewport publishes
// for its overlay item and action-corner button.
const mockPublishAIState = jest.fn();
const mockSubRef: { onSelected: ((r: any, uid: string) => void) | null } = { onSelected: null };

jest.mock('../hooks/useAIResult', () => ({ useAIResult: () => mockInitialResult }));
jest.mock('../hooks/useAIOverlay', () => ({
  useAIOverlay: (config: any) => mockPublishAIState(config),
}));
jest.mock('../hooks/useViewportElement', () => ({
  useViewportElement: () => ({ onElementEnabled: () => {}, onElementDisabled: () => {} }),
}));
jest.mock('../hooks/useAIResultSubscription', () => ({
  useAIResultSubscription: (cfg: any) => {
    mockSubRef.onSelected = cfg.onAIResultSelected;
  },
}));
jest.mock('../utils', () => {
  const actual = jest.requireActual('../utils');
  return {
    ...actual,
    HeatmapLayoutManager: {
      toggleHeatmapLayout: (...args: any[]) => mockToggleHeatmapLayout(...args),
    },
    renderCornerstoneViewport: () => null,
  };
});

installConsoleErrorFilter({ silenceLog: true });

const baseProps = (over: any = {}) => ({
  viewportId: 'vp-primary',
  servicesManager: { services: { viewportGridService: {} } },
  extensionManager: { getModuleEntry: jest.fn() },
  commandsManager: { runCommand: jest.fn() },
  displaySets: [{ displaySetInstanceUID: 'mr-A', Modality: 'MR' }],
  viewportOptions: {},
  ...over,
});

const resultWithHeatmap = (id: string, scUID: string) => ({
  id,
  hasHeatmap: true,
  heatmapDisplaySet: { displaySetInstanceUID: scUID },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockInitialResult = null;
  mockSubRef.onSelected = null;
});

describe('AITrackedViewport — AI result selection & heatmap', () => {
  it('auto-opening on a fresh SC click uses the NEW result, not the previous one', () => {
    // Previous/initial result A has its own heatmap; the user then clicks the SC
    // thumbnail of a *different* result B.
    mockInitialResult = resultWithHeatmap('A', 'sc-A');
    render(<AITrackedViewport {...baseProps()} />);
    expect(mockSubRef.onSelected).toBeTruthy();

    const resultB = resultWithHeatmap('B', 'sc-B');
    act(() => {
      // clicked UID matches B's own heatmap SC → should auto-open B's heatmap
      mockSubRef.onSelected!(resultB, 'sc-B');
    });

    // The layout must be built from B's heatmap, never A's stale one.
    const openCalls = mockToggleHeatmapLayout.mock.calls.filter(c => c[0] === true);
    expect(openCalls.length).toBeGreaterThan(0);
    const lastOpen = openCalls[openCalls.length - 1];
    expect(lastOpen[1].aiResult).toBe(resultB);
    expect(lastOpen[1].aiResult.heatmapDisplaySet.displaySetInstanceUID).toBe('sc-B');
  });

  it("does not open a heatmap when the clicked UID is not the new result's SC", () => {
    mockInitialResult = resultWithHeatmap('A', 'sc-A');
    render(<AITrackedViewport {...baseProps()} />);

    const resultB = resultWithHeatmap('B', 'sc-B');
    act(() => {
      // user clicked B's SR (not its SC) → no auto-open
      mockSubRef.onSelected!(resultB, 'sr-B');
    });

    const openCalls = mockToggleHeatmapLayout.mock.calls.filter(c => c[0] === true);
    expect(openCalls.length).toBe(0);
  });

  it('selecting a result then navigating to a new study drops the stale selection', () => {
    mockInitialResult = { id: 'A' };
    const { rerender } = render(<AITrackedViewport {...baseProps()} />);

    // Select an explicit result X for the current study.
    const resultX = { id: 'X' };
    act(() => {
      mockSubRef.onSelected!(resultX, 'x');
    });
    // currentAIResult is now X — that is what the viewport publishes.
    expect(mockPublishAIState.mock.calls.some((c: any[]) => c[0]?.aiResult?.id === 'X')).toBe(true);

    // Navigate to a different study: new primary display set + new initial result B.
    mockPublishAIState.mockClear();
    mockInitialResult = { id: 'B' };
    act(() => {
      rerender(
        <AITrackedViewport
          {...baseProps({ displaySets: [{ displaySetInstanceUID: 'mr-B', Modality: 'MR' }] })}
        />
      );
    });

    // The stale selection X must be gone; the new study's initial result B wins.
    const publishedIds = mockPublishAIState.mock.calls.map((c: any[]) => c[0]?.aiResult?.id);
    expect(publishedIds).toContain('B');
    expect(publishedIds).not.toContain('X');
  });
});
