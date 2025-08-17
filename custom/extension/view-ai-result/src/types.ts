import type { DisplaySet } from '@ohif/core';

export interface Classification {
  side: 'Left' | 'Right';
  isMalignant: boolean | null;
  confidence: number | null;
  errorMessage?: string;
}

export interface AIResult {
  studyInstanceUID: string;
  hasHeatmap: boolean;
  classifications: Classification[];
  /**
   * ISO-8601 UTC timestamp representing when the AI result was created.
   * Typically derived from the SR InstanceCreationDate/Time.
   */
  resultTs?: string;
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
  modelInfo?: {
    name: string;
    algorithmName?: string;
    algorithmVersion?: string;
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
