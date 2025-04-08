export interface ModeFactoryParams {
  servicesManager: {
    services: {
      measurementService?: any;
      toolbarService?: any;
      toolGroupService?: any;
      syncGroupService?: any;
      segmentationService?: any;
      cornerstoneViewportService?: any;
      uiDialogService?: any;
      uiModalService?: any;
      [key: string]: any;
    };
  };
  extensionManager: any;
  commandsManager: any;
  configuration?: any;
}
