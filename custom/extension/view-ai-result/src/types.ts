// Placeholder for the isolated custom typecheck (@ohif is shimmed to any; see
// custom/types/ohif-any.d.ts). `Record<string, any>` rather than `any` so that
// intersections like `DisplaySet & { SOPInstanceUID: string; ... }` below keep
// checking their explicit members. Swap back to
// `import type { DisplaySet } from '@ohif/core'` when real types are wired in.
type DisplaySet = Record<string, any>;

export interface Classification {
  side: 'Left' | 'Right';
  result: 'Malignant' | 'Benign' | 'No lesion' | null;
  confidence: number | null;
  errorMessage?: string;
}

export interface AIResult {
  studyInstanceUID: string;
  displaySetInstanceUID?: string; // SR display set UID that this result was extracted from
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
