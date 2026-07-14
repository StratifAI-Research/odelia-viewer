import { AIResult } from '.';

export interface AIClassificationOverlayProps {
  aiResult: AIResult;
}

export interface AIOverlayHookConfig {
  viewportId: string;
  aiResult: AIResult | null;
  isHeatmapViewport: boolean;
  servicesManager: any;
}

export interface AIOverlayHookReturn {
  updateOverlay: (aiResult: AIResult) => void;
  clearOverlay: () => void;
  setupHeatmapActionCorner: (aiResult: AIResult, onToggle: () => void, isActive: boolean, hasHeatmap?: boolean) => void;
  clearActionCorners: () => void;
}
