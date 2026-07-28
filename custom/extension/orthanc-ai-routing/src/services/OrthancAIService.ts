import { AIEndpoint, toPersistableEndpoints } from '../components/AIEndpointConfig';
import { AI_ENDPOINTS_STORAGE_KEY } from '../constants';

interface OrthancStudy {
  ID: string;
  MainDicomTags: {
    PatientName: string;
    StudyDescription: string;
    StudyInstanceUID: string;
    [key: string]: string;
  };
  Series: string[];
  [key: string]: any;
}

interface RoutingRequest {
  study_id: string;
  target: string;
  target_url?: string;
  series_uids?: string[];
}

interface RoutingResponse {
  status: string;
  message: string;
  study_id?: string;
  target?: string;
  workitem_uid?: string;
}

interface OrthancAIServiceConfig {
  orthancUrl?: string;
}

// Model Input Manifest interfaces

export interface InputSpec {
  key: string;
  label: string;
  required: boolean;
  modality?: string;
  auto_detect_patterns?: string[];
}

export interface InputConfiguration {
  id: string;
  name: string;
  description?: string;
  inputs: InputSpec[];
}

export interface ModelManifest {
  model_id: string;
  model_name: string;
  version: string;
  input_configurations: InputConfiguration[];
}

export interface InputMapping {
  [roleKey: string]: string; // role key -> SeriesInstanceUID
}

// UPS Workitem interfaces
export interface WorkitemStatus {
  state: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELED' | 'UNKNOWN';
  progress?: number;
  progressDescription?: string;
  cancellationReason?: string;
}

interface DicomTagValue {
  vr: string;
  Value?: any[];
}

interface WorkitemDicomJson {
  [tag: string]: DicomTagValue;
}

/**
 * Interface for a single lookup response item from Orthanc
 */
interface OrthancLookupResponseItem {
  ID: string;
  Path: string;
  Type: string;
}

class OrthancAIService {
  private orthancUrl: string;
  private currentEndpoint: AIEndpoint | null = null;
  private workitemPollingInterval: number | null = null;
  private manifestCache: Map<string, ModelManifest | null> = new Map();

  constructor({ configuration = {} }: { configuration?: OrthancAIServiceConfig }) {
    // Same-origin fallback; the extension's preRegistration always provides
    // window.config.orthancUrl (defaulting to window.location.origin).
    this.orthancUrl = configuration.orthancUrl || window.location.origin;

    // Try to load the current endpoint from localStorage
    this.loadCurrentEndpoint();
  }

  /**
   * Load the current AI endpoint from localStorage
   */
  private loadCurrentEndpoint(): void {
    try {
      const savedEndpoints = localStorage.getItem(AI_ENDPOINTS_STORAGE_KEY);
      if (savedEndpoints) {
        const endpoints: AIEndpoint[] = JSON.parse(savedEndpoints);
        if (endpoints.length > 0) {
          this.setCurrentEndpoint(endpoints[0]);
        }
      }
    } catch (error) {
      console.error('Failed to load AI endpoints:', error);
    }
  }

  /**
   * Get all configured AI endpoints
   */
  getAIEndpoints(): AIEndpoint[] {
    try {
      const savedEndpoints = localStorage.getItem(AI_ENDPOINTS_STORAGE_KEY);
      if (savedEndpoints) {
        return JSON.parse(savedEndpoints);
      }
    } catch (error) {
      console.error('Failed to get AI endpoints:', error);
    }
    return [];
  }

  /**
   * Get the current AI endpoint
   */
  getCurrentEndpoint(): AIEndpoint | null {
    return this.currentEndpoint;
  }

  /**
   * Set the current AI endpoint
   */
  setCurrentEndpoint(endpoint: AIEndpoint): void {
    this.currentEndpoint = endpoint;

    // Update the endpoint in localStorage
    try {
      const savedEndpoints = localStorage.getItem(AI_ENDPOINTS_STORAGE_KEY);
      if (savedEndpoints) {
        const endpoints: AIEndpoint[] = JSON.parse(savedEndpoints);
        const updatedEndpoints = endpoints.map(e => (e.id === endpoint.id ? endpoint : e));
        localStorage.setItem(
          AI_ENDPOINTS_STORAGE_KEY,
          JSON.stringify(toPersistableEndpoints(updatedEndpoints))
        );
      }
    } catch (error) {
      console.error('Failed to update AI endpoint in localStorage:', error);
    }
  }

  /**
   * Get the actual DICOM StudyInstanceUID from the URL
   */
  getDicomStudyInstanceUIDFromURL(): string | null {
    const url = new URL(window.location.href);
    const studyUIDs = url.searchParams.get('StudyInstanceUIDs');

    if (!studyUIDs) {
      console.error('No StudyInstanceUIDs parameter found in URL');
      return null;
    }

    // In case there are multiple UIDs, take the first one
    const firstStudyUID = studyUIDs.split(',')[0];

    return firstStudyUID;
  }

  /**
   * Get Orthanc study ID using the /tools/lookup API
   * This endpoint lets us find Orthanc resources by DICOM UIDs
   *
   * According to the Orthanc API documentation, the /tools/lookup endpoint
   * expects the DICOM identifier as plain text in the request body.
   *
   * @param studyInstanceUID The DICOM StudyInstanceUID
   * @returns The Orthanc study ID
   */
  async getOrthancStudyId(studyInstanceUID: string): Promise<string> {
    // Bound the lookup with a timeout (mirrors postRouting) so a hung Orthanc
    // does not block routing indefinitely.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      // Call Orthanc's lookup API with the StudyInstanceUID as plain text in the body
      const response = await fetch(`${this.orthancUrl}/tools/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: studyInstanceUID, // Send the UID directly as plain text
        signal: controller.signal,
      });

      if (!response.ok) {
        // Try to extract error message from response body
        let errorMessage = `Failed to lookup study (${response.status})`;
        try {
          const errorText = await response.text();
          if (errorText) {
            errorMessage = `Failed to lookup study: ${errorText}`;
          }
        } catch (parseError) {
          console.warn('Could not parse lookup error response:', parseError);
        }
        console.error(errorMessage);
        throw new Error(errorMessage);
      }

      // The response is an array of lookup results
      const lookupResults: OrthancLookupResponseItem[] = await response.json();

      // Find the study result (there could be multiple results)
      const studyResult = lookupResults.find(result => result.Type === 'Study');

      if (!studyResult || !studyResult.ID) {
        throw new Error(`No Orthanc Study ID found for StudyInstanceUID: ${studyInstanceUID}`);
      }

      return studyResult.ID;
    } catch (error) {
      console.error('Error getting Orthanc study ID:', error);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Fetch the model input manifest for a given AI endpoint URL.
   * Returns null when the model does not provide a manifest (fallback to flat selection).
   * Results are cached per endpoint URL.
   */
  async getModelManifest(endpointUrl: string): Promise<ModelManifest | null> {
    if (this.manifestCache.has(endpointUrl)) {
      return this.manifestCache.get(endpointUrl)!;
    }

    try {
      const url = `${this.orthancUrl}/ai-manifest?target_url=${encodeURIComponent(endpointUrl)}`;
      const response = await fetch(url);

      if (!response.ok) {
        // Do not cache a transient fetch failure: a network blip would otherwise
        // degrade the model to flat series selection until the cache is cleared
        // (on endpoint change) or the page is reloaded.
        console.warn(`Manifest fetch failed (${response.status}), falling back`);
        return null;
      }

      const data = await response.json();

      if (data.manifest === null || data.manifest === undefined) {
        if (data.model_id) {
          const manifest = data as ModelManifest;
          this.manifestCache.set(endpointUrl, manifest);
          return manifest;
        }
        this.manifestCache.set(endpointUrl, null);
        return null;
      }

      const manifest = data.manifest as ModelManifest;
      this.manifestCache.set(endpointUrl, manifest);
      return manifest;
    } catch (error) {
      // Transient error — do not cache, so a later call can retry.
      console.warn('Error fetching model manifest:', error);
      return null;
    }
  }

  /**
   * Clear the manifest cache (e.g. when endpoints change)
   */
  clearManifestCache(): void {
    this.manifestCache.clear();
  }

  /**
   * Derives a user-facing message from a non-ok response.
   *
   * The body stream can only be consumed once, so we read it as text and then
   * try to parse JSON. A non-JSON body (e.g. an HTML error page) falls back to
   * the clean status message rather than surfacing raw markup.
   */
  private async extractErrorMessage(response: Response): Promise<string> {
    const fallback = `HTTP error! status: ${response.status}`;
    let bodyText: string;
    try {
      bodyText = await response.text();
    } catch {
      return fallback;
    }
    if (!bodyText) {
      return fallback;
    }
    try {
      const errorData = JSON.parse(bodyText);
      return errorData.message || errorData.error || fallback;
    } catch {
      return fallback;
    }
  }

  /**
   * POSTs a routing request to the /send-to-ai endpoint with a 30s timeout and
   * shared error handling. Shared by routeStudyToAI and routeSeriesToAI.
   */
  private async postRouting(
    routingRequest: RoutingRequest & {
      input_mapping?: InputMapping;
      input_configuration_id?: string;
    }
  ): Promise<RoutingResponse> {
    // Set up timeout using AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(`${this.orthancUrl}/send-to-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(routingRequest),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(await this.extractErrorMessage(response));
      }

      const data = await response.json();
      return data as RoutingResponse;
    } catch (error: unknown) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Request timed out after 30 seconds');
      }
      throw error;
    }
  }

  async routeStudyToAI(dicomStudyUID: string): Promise<RoutingResponse> {
    try {
      // Check if we have a valid AI endpoint
      if (!this.currentEndpoint) {
        throw new Error('No AI endpoint configured. Please add an AI endpoint first.');
      }

      // Get the Orthanc study ID using the lookup API
      const orthancStudyId = await this.getOrthancStudyId(dicomStudyUID);

      // Create the routing request with the Orthanc study ID
      const routingRequest: RoutingRequest = {
        study_id: orthancStudyId,
        target: this.currentEndpoint.name,
        target_url: this.currentEndpoint.url,
      };

      return await this.postRouting(routingRequest);
    } catch (error) {
      console.error('Error routing study to AI:', error);
      throw error;
    }
  }

  /**
   * Routes selected series from a study to the AI server
   * @param dicomStudyUID The DICOM StudyInstanceUID
   * @param seriesUIDs Array of DICOM SeriesInstanceUIDs to route
   * @param inputMapping Optional role→series mapping for multi-input models
   * @param inputConfigurationId Optional manifest input-configuration ID
   */
  async routeSeriesToAI(
    dicomStudyUID: string,
    seriesUIDs: string[],
    inputMapping?: InputMapping,
    inputConfigurationId?: string
  ): Promise<RoutingResponse> {
    try {
      if (!this.currentEndpoint) {
        throw new Error('No AI endpoint configured. Please add an AI endpoint first.');
      }

      if (!seriesUIDs || seriesUIDs.length === 0) {
        throw new Error('No series selected. Please select at least one series.');
      }

      const orthancStudyId = await this.getOrthancStudyId(dicomStudyUID);

      const routingRequest: RoutingRequest & {
        input_mapping?: InputMapping;
        input_configuration_id?: string;
      } = {
        study_id: orthancStudyId,
        target: this.currentEndpoint.name,
        target_url: this.currentEndpoint.url,
        series_uids: seriesUIDs,
      };

      if (inputMapping) {
        routingRequest.input_mapping = inputMapping;
      }
      if (inputConfigurationId) {
        routingRequest.input_configuration_id = inputConfigurationId;
      }

      return await this.postRouting(routingRequest);
    } catch (error) {
      console.error('Error routing series to AI:', error);
      throw error;
    }
  }

  /**
   * Parse DICOM JSON workitem to extract status information
   * @param workitemJson The DICOM JSON workitem object
   * @returns Parsed workitem status
   */
  private parseWorkitemStatus(workitemJson: WorkitemDicomJson): WorkitemStatus {
    const status: WorkitemStatus = {
      state: 'UNKNOWN',
    };

    try {
      // Extract ProcedureStepState (00741000)
      const stateTag = workitemJson['00741000'];
      if (stateTag?.Value?.[0]) {
        status.state = stateTag.Value[0] as WorkitemStatus['state'];
      }

      // Extract Progress Information Sequence (00741002) for IN_PROGRESS state
      const progressSeq = workitemJson['00741002'];
      if (progressSeq?.Value?.[0]) {
        const progressItem = progressSeq.Value[0];

        // Extract Procedure Step Progress (00741004)
        const progressTag = progressItem['00741004'];
        if (progressTag?.Value?.[0]) {
          const parsedProgress = parseFloat(progressTag.Value[0]);
          if (Number.isFinite(parsedProgress)) {
            status.progress = parsedProgress;
          }
        }

        // Extract Procedure Step Progress Description (00741006)
        const progressDescTag = progressItem['00741006'];
        if (progressDescTag?.Value?.[0]) {
          status.progressDescription = progressDescTag.Value[0];
        }
      }

      // Extract Reason For Cancellation (00741238) for CANCELED state
      const cancellationTag = workitemJson['00741238'];
      if (cancellationTag?.Value?.[0]) {
        status.cancellationReason = cancellationTag.Value[0];
      }

      return status;
    } catch (error) {
      console.error('Error parsing workitem status:', error);
      return status;
    }
  }

  /**
   * Get workitem status from the UPS-RS endpoint
   * @param workitemUid The workitem UID to retrieve
   * @returns Parsed workitem status
   */
  async getWorkitemStatus(workitemUid: string): Promise<WorkitemStatus> {
    try {
      const response = await fetch(`${this.orthancUrl}/ups-rs/workitems/${workitemUid}`, {
        method: 'GET',
        headers: {
          Accept: 'application/dicom+json, application/json',
        },
      });

      if (!response.ok) {
        console.error(`Failed to get workitem status: ${response.status}`);
        const errorText = await response.text();
        console.error(`Response body: ${errorText}`);
        throw new Error(`Failed to get workitem status: ${response.status}`);
      }

      // Parse the JSON body directly (parity with getModelManifest;
      // no need to read text first).
      let workitemJson: WorkitemDicomJson;
      try {
        workitemJson = await response.json();
      } catch (parseError) {
        console.error('Failed to parse workitem JSON:', parseError);
        throw new Error(`Failed to parse workitem JSON: ${parseError}`);
      }

      return this.parseWorkitemStatus(workitemJson);
    } catch (error) {
      console.error('Error getting workitem status:', error);
      throw error;
    }
  }

  /**
   * Start polling for workitem status updates
   * @param workitemUid The workitem UID to poll
   * @param callback Function to call with status updates
   * @param interval Polling interval in milliseconds (default: 500ms)
   * @param maxDurationMs Maximum total polling duration before timing out
   */
  startWorkitemPolling(
    workitemUid: string,
    callback: (status: WorkitemStatus) => void,
    interval: number = 500,
    maxDurationMs: number = 10 * 60 * 1000
  ): void {
    // Stop any existing polling
    this.stopWorkitemPolling();

    // Bound the number of ticks so a workitem that never reaches a terminal
    // state — or a persistently failing/404-ing endpoint — cannot poll forever
    // (previously it stopped only on COMPLETED/CANCELED and kept retrying on any
    // error). On timeout, stop and surface it to the caller.
    const maxAttempts = Math.max(1, Math.ceil(maxDurationMs / interval));
    let attempts = 0;

    // Start polling
    this.workitemPollingInterval = window.setInterval(async () => {
      attempts++;
      try {
        const status = await this.getWorkitemStatus(workitemUid);
        callback(status);

        // Stop polling if workitem reached a terminal state
        if (status.state === 'COMPLETED' || status.state === 'CANCELED') {
          this.stopWorkitemPolling();
          return;
        }
      } catch (error) {
        console.error('Error during workitem polling:', error);
        // Don't stop polling on a single error — a transient failure may recover.
      }

      if (attempts >= maxAttempts) {
        this.stopWorkitemPolling();
        callback({
          state: 'CANCELED',
          cancellationReason: `Polling timed out after ${maxAttempts} attempts`,
        });
      }
    }, interval);
  }

  /**
   * Stop polling for workitem status
   */
  stopWorkitemPolling(): void {
    if (this.workitemPollingInterval !== null) {
      window.clearInterval(this.workitemPollingInterval);
      this.workitemPollingInterval = null;
    }
  }
}

export default OrthancAIService;
