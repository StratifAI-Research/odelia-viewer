/**
 * A single label definition. `options` is present only for `type: 'options'`;
 * a `type: 'date'` entry has none. This matches config.json (the previous
 * `Label` type declared `{ name; type; options }`, which the JSON never had).
 */
export interface LabelDef {
  type: 'options' | 'date';
  options?: string[];
}

/**
 * One `label_options` entry is a single-key map of label-name -> definition
 * (e.g. `{ "Ethnicity": { type, options } }`), NOT an object with name/type/
 * options fields. Consumers merge the array via `Object.assign({}, ...entries)`
 * (initLabels, LabelingTable) and test membership with `key in entries[0]`
 * (importCSVReport).
 */
export type LabelOption = Record<string, LabelDef>;

export interface PanelConfig {
  name: string;
  label_options: LabelOption[];
}

export default interface Config {
  panel_configs: PanelConfig[];
}
