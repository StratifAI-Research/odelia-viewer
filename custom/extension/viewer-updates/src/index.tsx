import React from 'react';
import ReleaseUpdateProvider from './ReleaseUpdateProvider';
import PatientListUpdateNotice from './PatientListUpdateNotice';
import OdeliaAboutModal from './components/OdeliaAboutModal';

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
      value: {
        'workList.updateNotification': PatientListUpdateNotice,
        'ohif.aboutModal': OdeliaAboutModal,
      },
    },
  ],
};
