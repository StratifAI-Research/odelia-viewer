/**
 * Runtime viewer configuration for the ODELIA deployment.
 *
 * This is assigned to `window.config` at load time and overrides the app's
 * built-in defaults. In production the platform repo (odelia-viewer-platform)
 * may ship its own copy of this file; keep the two in sync for any values that
 * are deployment-specific (data source roots, OIDC authority, aiEndpoints).
 *
 * @type {AppTypes.Config}
 */
window.config = {
  //orthancUrl: 'http://localhost:45821',
  routerBasename: '/viewer',
  showStudyList: true,
  // The ODELIA custom extensions/modes (labeling, orthanc-ai-routing,
  // view-ai-result, labeling-mode, send-ai) are compiled into the app bundle at
  // build time via pluginConfig, so they need no runtime registration. These two
  // arrays are only for loading *additional* external (UMD) plugins at runtime —
  // there are none, hence empty.
  extensions: [],
  modes: [],
  showWarningMessageForCrossOrigin: true,
  showCPUFallbackMessage: true,
  showLoadingIndicator: true,
  experimentalStudyBrowserSort: false,
  strictZSpacingForVolumeViewport: true,
  studyPrefetcher: {
    enabled: true,
    displaySetsCount: 2,
    maxNumPrefetchRequests: 10,
    order: 'closest',
  },
  defaultDataSourceName: 'dicomweb',
  studyList: {
    defaultSortField: 'StudyDate',
    defaultSortOrder: 'descending',
    defaultTimeRange: 'last7days',
    timeRanges: [
      { label: 'Last 7 days', value: 'last7days' },
      { label: 'Last 30 days', value: 'last30days' },
      { label: 'Last 90 days', value: 'last90days' },
      { label: 'Last year', value: 'lastyear' },
      { label: 'All time', value: 'all' },
    ],
  },
  dataSources: [
    {
      namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
      sourceName: 'dicomweb',
      configuration: {
        friendlyName: 'Orthanc Server',
        name: 'Orthanc',
        // Two distinct same-origin reverse-proxy routes to the Orthanc PACS:
        //   /wado             → WADO-URI (legacy single-object retrieve by URI)
        //   /pacs/dicom-web   → DICOMweb: QIDO-RS (query, qidoRoot) +
        //                       WADO-RS (retrieve, wadoRoot) + STOW-RS (upload).
        // They map to different Orthanc endpoints, so the roots differ even
        // though both are served from this origin (no CORS).
        wadoUriRoot: '/wado',
        qidoRoot: '/pacs/dicom-web',
        wadoRoot: '/pacs/dicom-web',
        qidoSupportsIncludeField: true,
        supportsReject: true,
        imageRendering: 'wadors',
        thumbnailRendering: 'wadors',
        enableStudyLazyLoad: true,
        supportsFuzzyMatching: true,
        supportsWildcard: true,
        dicomUploadEnabled: true,
        omitQuotationForMultipartRequest: true,
      },
    }
  ],
  // Preconfigured AI endpoints
  aiEndpoints: [
    {
      id: 'mst-ai',
      name: 'MST AI model',
      url: 'http://orthanc-router-mst:8042/dicom-web',
    },
  ],
  httpErrorHandler: error => {
    console.warn(`HTTP Error Handler (status: ${error.status})`, error);
  },
  // OIDC / Keycloak. `authority` is a same-origin proxied path (/keycloak/...),
  // so the browser talks to Keycloak through this origin — no third-party cookies.
  oidc: [
    {
      authority: '/keycloak/realms/ohif',
      client_id: 'ohif_viewer',
      redirect_uri: '/viewer/callback',
      scope: 'openid profile email',
      post_logout_redirect_uri: '/viewer/',
      response_type: 'code',
      // Silent renew and session monitoring both work by loading the Keycloak
      // authorize endpoint in hidden iframes on a short timer. In Firefox that
      // burst of iframe requests tripped rate limiting / connection errors and
      // broke the session, so both are disabled here. The trade-off: the access
      // token is not auto-refreshed in the background (the user re-authenticates
      // when it expires). `revokeAccessTokenOnSignout` still revokes on logout.
      automaticSilentRenew: false,
      monitorSession: false,
      revokeAccessTokenOnSignout: true
    }],
};
