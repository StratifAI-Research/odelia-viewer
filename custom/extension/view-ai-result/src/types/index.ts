// Loose stand-in for `AppTypes.DisplaySet`: the AI code reads fields OHIF's own
// type does not declare (SR/SC extras attached by the extraction utilities), so
// adopting the real type is a refactor of its own. `Record<string, any>` rather
// than `any` keeps intersections like `DisplaySet & { SOPInstanceUID: string }`
// below checking their explicit members.
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
  servicesManager: AppTypes.ServicesManager;
  extensionManager: AppTypes.ExtensionManager;
  commandsManager: AppTypes.CommandsManager;
  displaySets: DisplaySet[];
  viewportOptions?: any;
  onElementEnabled?: (evt: any) => void;
  onElementDisabled?: () => void;
  // OHIF's forced-rerender escape hatch. The ViewportGrid passes this top-level
  // prop (derived from `displaySet.needsRerendering`); the memo comparator honors it.
  needsRerendering?: boolean;
}
