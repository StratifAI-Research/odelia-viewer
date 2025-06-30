import { ReactNode } from 'react';
import { AIResult } from '../types';

export interface AIClassificationOverlayProps {
  aiResult: AIResult;
}

export interface OverlayCustomization {
  id: string;
  inheritsFrom: string;
  title: string;
  color: string;
  contentF: () => ReactNode;
}

export interface ViewportActionComponent {
  viewportId: string;
  id: string;
  component: ReactNode;
  location: string;
  indexPriority: number;
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
  setupHeatmapActionCorner: (aiResult: AIResult, onToggle: () => void, isActive: boolean) => void;
  clearActionCorners: () => void;
}
