import type { Panel } from '@ohif/core';
import PanelStudyBrowserTracking from './panels/PanelStudyBrowserTracking/PanelStudyBrowserTracking';
import i18n from 'i18next';
import React, { useCallback } from 'react';
import { useSystem } from '@ohif/core';
import { requestDisplaySetCreationForStudy } from '@ohif/extension-default';

function _getStudyForPatientUtility(extensionManager) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-default.utilityModule.common'
  );

  const { getStudiesForPatientByMRN } = utilityModule.exports;
  return getStudiesForPatientByMRN;
}

function _createGetImageSrcFromImageIdFn(extensionManager) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-default.utilityModule.common'
  );

  const { getImageSrcFromImageId } = utilityModule.exports;
  return getImageSrcFromImageId;
}

function WrappedPanelStudyBrowserTracking() {
  const { extensionManager } = useSystem();
  const dataSource = extensionManager.getActiveDataSource()[0];

  const getStudiesForPatientByMRN = _getStudyForPatientUtility(extensionManager);
  const _getStudiesForPatientByMRN = getStudiesForPatientByMRN.bind(null, dataSource);
  const _getImageSrcFromImageId = useCallback(
    _createGetImageSrcFromImageIdFn(extensionManager),
    []
  );
  const _requestDisplaySetCreationForStudy = requestDisplaySetCreationForStudy.bind(
    null,
    dataSource
  );

  return (
    <PanelStudyBrowserTracking
      dataSource={dataSource}
      getImageSrc={_getImageSrcFromImageId}
      getStudiesForPatientByMRN={_getStudiesForPatientByMRN}
      requestDisplaySetCreationForStudy={_requestDisplaySetCreationForStudy}
    />
  );
}

function getPanelModule({ commandsManager, extensionManager, servicesManager }): Panel[] {
  return [
    {
      name: 'seriesList',
      iconName: 'tab-studies',
      iconLabel: 'Studies',
      label: i18n.t('SidePanel:Studies'),
      component: props => <WrappedPanelStudyBrowserTracking {...props} />,
    },
  ];
}

export default getPanelModule;
