import React from 'react';

interface ViewportRendererProps {
  viewportId: string;
  displaySets: any[];
  viewportOptions: any;
  extensionManager: any;
  servicesManager: any;
  commandsManager: any;
  onElementEnabled: (evt: any) => void;
  onElementDisabled: () => void;
  [key: string]: any;
}

export const renderCornerstoneViewport = (props: ViewportRendererProps) => {
  const {
    viewportId,
    displaySets,
    viewportOptions,
    extensionManager,
    servicesManager,
    commandsManager,
    onElementEnabled,
    onElementDisabled,
    ...restProps
  } = props;

  const { component: Component } = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.viewportModule.cornerstone'
  );

  const mergedViewportOptions = {
    ...viewportOptions,
    viewportId,
    viewportType: viewportOptions.viewportType || 'stack',
    toolGroupId: viewportOptions.toolGroupId || 'default',
  };

  return (
    <Component
      {...restProps}
      viewportId={viewportId}
      displaySets={displaySets}
      viewportOptions={mergedViewportOptions}
      servicesManager={servicesManager}
      extensionManager={extensionManager}
      commandsManager={commandsManager}
      onElementEnabled={evt => {
        restProps.onElementEnabled?.(evt);
        onElementEnabled(evt);
      }}
      onElementDisabled={onElementDisabled}
    />
  );
};
