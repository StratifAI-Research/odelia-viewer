import type { DisplaySet } from '@ohif/core';

export interface Classification {
  side: 'Left' | 'Right';
  isMalignant: boolean;
  confidence: number;
  location: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
}

export interface AIResult {
  studyInstanceUID: string;
  hasHeatmap: boolean;
  classifications: Classification[];
  heatmapDisplaySet?: DisplaySet & {
    SOPInstanceUID: string;
    metadata: {
      InstanceNumber: number;
      Rows: number;
      Columns: number;
      BitsAllocated: number;
      BitsStored: number;
      HighBit: number;
      PhotometricInterpretation: string;
      SamplesPerPixel: number;
      PixelRepresentation: number;
      RescaleIntercept: number;
      RescaleSlope: number;
      WindowCenter: number;
      WindowWidth: number;
      ColorSpace: string;
    };
    viewportOptions?: {
      colormap: {
        name: string;
        colors: [number, number, number][];
      };
    };
  };
}

export interface MockAIResults {
  [studyInstanceUID: string]: AIResult;
}

export interface AISideBySideViewportProps {
  viewportId: string;
  servicesManager: any;
  extensionManager: any;
  commandsManager: any;
  displaySets: DisplaySet[];
  viewportOptions?: any;
  onElementEnabled?: (evt: any) => void;
  onElementDisabled?: () => void;
}

export interface Layout {
  numRows: number;
  numCols: number;
  layoutType: string;
  findOrCreateViewport?: (position: number) => {
    displaySetInstanceUIDs: string[];
    viewportOptions: {
      viewportId: string;
      toolGroupId: string;
    };
  };
}
