import React from 'react';
import ReleaseUpdateProvider from './ReleaseUpdateProvider';
import PatientListUpdateNotice from './PatientListUpdateNotice';

export default {
  id: 'viewer-updates',
  preRegistration: ({ serviceProvidersManager, appConfig }) => {
    function Provider({ children }) {
      return <ReleaseUpdateProvider appConfig={appConfig}>{children}</ReleaseUpdateProvider>;
    }
    serviceProvidersManager.registerProvider('viewerUpdates', Provider);
  },
  getCustomizationModule: () => [
    {
      name: 'default',
      value: { 'workList.updateNotification': PatientListUpdateNotice },
    },
  ],
};
