import { create } from 'zustand';
import type { AIResult } from '../types';

/**
 * Per-viewport AI state published by the AI viewport wrapper and consumed by
 * the pieces OHIF renders *inside* the cornerstone viewport — the viewport
 * overlay item and the action-corner toolbar button.
 *
 * Those consumers are mounted by OHIF (through the customization service and
 * the toolbar service), not by us, so they only ever receive a `viewportId`.
 * This store is the channel that turns that id back into "what is this
 * viewport showing". It replaces the pre-3.13 `viewportActionCornersService`,
 * which let a viewport imperatively push rendered elements into a corner.
 */
export type ViewportAIState = {
  /** The AI result currently displayed by the viewport, if any. */
  aiResult: AIResult | null;
  /** Whether that result carries a heatmap that can be opened. */
  hasHeatmap: boolean;
  /** Whether the heatmap layout is currently open for this viewport. */
  isHeatmapActive: boolean;
  /** Toggles the heatmap layout; null when the viewport cannot toggle. */
  onToggleHeatmap: (() => void) | null;
};

type AIViewportStore = {
  viewports: Record<string, ViewportAIState>;
  setViewportAIState: (viewportId: string, state: ViewportAIState) => void;
  clearViewportAIState: (viewportId: string) => void;
};

/**
 * True when the two states are interchangeable for rendering purposes. The
 * writer syncs on every render of the viewport wrapper, so without this the
 * store would hand out a new object each time and re-render every consumer.
 */
function isSameState(a: ViewportAIState | undefined, b: ViewportAIState): boolean {
  return (
    !!a &&
    a.aiResult === b.aiResult &&
    a.hasHeatmap === b.hasHeatmap &&
    a.isHeatmapActive === b.isHeatmapActive &&
    a.onToggleHeatmap === b.onToggleHeatmap
  );
}

export const useAIViewportStore = create<AIViewportStore>()(set => ({
  viewports: {},

  setViewportAIState: (viewportId, state) =>
    set(store => {
      if (isSameState(store.viewports[viewportId], state)) {
        return store;
      }
      return { viewports: { ...store.viewports, [viewportId]: state } };
    }),

  clearViewportAIState: viewportId =>
    set(store => {
      if (!(viewportId in store.viewports)) {
        return store;
      }
      const viewports = { ...store.viewports };
      delete viewports[viewportId];
      return { viewports };
    }),
}));

/** Subscribes to a single viewport's AI state. `undefined` when unknown. */
export const useViewportAIState = (viewportId: string): ViewportAIState | undefined =>
  useAIViewportStore(store => store.viewports[viewportId]);
