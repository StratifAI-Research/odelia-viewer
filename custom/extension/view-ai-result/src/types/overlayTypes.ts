import { AIResult } from '.';

export interface AIOverlayHookConfig {
  viewportId: string;
  aiResult: AIResult | null;
  isHeatmapViewport: boolean;
  /** Whether the heatmap layout is currently open for this viewport. */
  isHeatmapActive?: boolean;
  /** Opens / closes the heatmap layout; omitted when the viewport cannot. */
  onToggleHeatmap?: (() => void) | null;
}
