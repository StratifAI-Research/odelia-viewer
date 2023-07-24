type Label = {
  id: number;
  // the label for the segment
  label_name: string;
  // whether the segmentation is hydrated or not (non-hydrated SEG -> temporary segmentation for display in SEG Viewport
  // but hydrated SEG -> segmentation that is persisted in the store)
  hydrated: boolean;
  // whether the segment is visible
  isVisible: boolean;
  label_value: string;
};

export { Label };
