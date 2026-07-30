/** Shared constants for the orthanc-ai-routing extension. */

/** localStorage key under which the configured AI endpoints are persisted. */
export const AI_ENDPOINTS_STORAGE_KEY = 'aiEndpoints';

/**
 * Built-in fallback AI endpoint. Only used when neither localStorage nor
 * `window.config.aiEndpoints` supplies endpoints (i.e. a misconfigured deployment) —
 * at deploy time `config/app-config.js` overrides it. The URL mirrors the canonical
 * router service in odelia-viewer-platform (`config/app-config.js` aiEndpoints).
 */
export const DEFAULT_AI_ENDPOINT_NAME = 'ai-server';
export const DEFAULT_AI_ENDPOINT_URL = 'http://orthanc-router-mst:8042/dicom-web';
