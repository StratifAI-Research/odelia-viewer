import PanelStudyBrowserTracking from './panels/PanelStudyBrowserTracking/PanelStudyBrowserTracking';
import i18n from 'i18next';
import React, { useCallback } from 'react';
import { useSystem } from '@ohif/core';
import { requestDisplaySetCreationForStudy } from '@ohif/extension-default';
import getImageSrcFromImageId from './utils/getImageSrcFromImageId';
import FeedbackPanel from './panels/FeedbackPanel/FeedbackPanel';
import ChatPanel from './panels/ChatPanel/ChatPanel';

type Panel = AppTypes.PanelModule.Panel;

function _getStudyForPatientUtility(extensionManager) {
  const utilityModule = extensionManager.getModuleEntry(
    '@ohif/extension-default.utilityModule.common'
  );

  const { getStudiesForPatientByMRN } = utilityModule.exports;
  return getStudiesForPatientByMRN;
}

function _createGetImageSrcFromImageIdFn(extensionManager) {
  const utilities = extensionManager.getModuleEntry(
    '@ohif/extension-cornerstone.utilityModule.common'
  );

  try {
    const { cornerstone } = utilities.exports.getCornerstoneLibraries();
    return getImageSrcFromImageId.bind(null, cornerstone);
  } catch {
    throw new Error('Required command not found');
  }
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

// The panel components read the managers from context (useSystem), so the module
// factory ignores its argument — the parameter is kept because OHIF's extension
// manager always passes one.
function getPanelModule(_extensionParams?: Record<string, unknown>): Panel[] {
  return [
    {
      name: 'seriesList',
      iconName: 'tab-studies',
      iconLabel: 'Studies',
      label: i18n.t('SidePanel:Studies'),
      component: props => <WrappedPanelStudyBrowserTracking {...props} />,
    },
    {
      name: 'aiFeedback',
      iconName: 'tab-linear',
      iconLabel: 'Feedback',
      label: 'Feedback',
      component: props => <FeedbackPanel {...props} />,
    },
    {
      name: 'aiChat',
      iconName: 'tab-patient-info',
      iconLabel: 'AI Chat',
      label: 'AI Chat',
      component: props => <ChatPanel {...props} />,
    },
  ];
}

export default getPanelModule;
