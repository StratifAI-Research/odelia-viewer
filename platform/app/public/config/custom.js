/** @type {AppTypes.Config} */

window.config = {
  name: 'config/custom.js',
  routerBasename: null,
  extensions: [],
  modes: [],
  customizationService: {},
  showStudyList: true,
  maxNumberOfWebWorkers: 3,
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  groupEnabledModesFirst: true,
  allowMultiSelectExport: true,
  maxNumRequests: {
    interaction: 100,
    thumbnail: 75,
    prefetch: 25,
  },
  // The custom DisclaimerBanner (view-ai-result) replaces OHIF's own
  // investigational-use dialog; without this they stack on top of each other.
  investigationalUseDialog: {
    option: 'never',
  },
  defaultDataSourceName: 'dicomweb',
};
