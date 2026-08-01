import React from 'react';
import { id } from './id';
import OrthancAIService from './services/OrthancAIService';
import AIRoutingPanel from './components/AIRoutingPanel';

// Add TypeScript declaration for the window.config
declare global {
  interface Window {
    config: {
      orthancUrl?: string;
      [key: string]: any;
    };
  }
}

// Add configuration defaults if not already present
if (!window.config) {
  window.config = {};
}

// Set Orthanc URL configuration defaults
if (!window.config.orthancUrl) {
  window.config.orthancUrl = window.location.origin;
}

export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id,

  /**
   * Perform any pre-registration tasks here. This is called before the extension
   * is registered. Usually we run tasks such as: configuring the libraries
   * (e.g. cornerstone, cornerstoneTools, ...) or registering any services that
   * this extension is providing.
   */
  preRegistration: ({ servicesManager }: any) => {
    // Create a service factory function
    const createOrthancAIService = () => {
      return {
        name: 'orthancAIService',
        create: ({ configuration = {} }: any) => {
          // Use the window.config defaults
          const serviceConfig = {
            orthancUrl: window.config.orthancUrl,
            ...configuration,
          };
          return new OrthancAIService({ configuration: serviceConfig });
        },
      };
    };

    // Register the OrthancAIService using the factory pattern
    servicesManager.registerService(createOrthancAIService());
  },

  /**
   * PanelModule provides the "Analyze with AI" routing panel rendered in the sidebar.
   */
  getPanelModule: ({ servicesManager }: any) => {
    const wrappedAIRoutingPanel = () => {
      return <AIRoutingPanel servicesManager={servicesManager} />;
    };

    return [
      {
        name: 'ai-routing-panel',
        iconName: 'clipboard',
        iconLabel: 'AI',
        label: 'Analyze with AI',
        component: wrappedAIRoutingPanel,
      },
    ];
  },
};
