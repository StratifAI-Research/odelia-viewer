interface Label {
  name: string;
  type: "date" | "options"
  options: Array<string>
}
export interface PanelConfig {
  name: string,
  label_options: Array<Label>;
}
export default interface Config {
  panel_configs: Array<PanelConfig>;
}
