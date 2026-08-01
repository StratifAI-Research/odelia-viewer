import { AIEndpoint, toPersistableEndpoints } from '../components/AIEndpointConfig';
import { AI_ENDPOINTS_STORAGE_KEY } from '../constants';
import {
  REQUEST_TIMEOUT_MS,
  describeHttpFailure,
  describeRequestFailure,
  describeUnexpectedBody,
  formatDuration,
  type RequestContext,
} from '../utils/httpErrors';

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
 * Consecutive failed status polls before the job is reported as lost. One
 * failure is usually a blip; several in a row means the server is gone.
 */
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

/**
 * Interface for a single lookup response item from Orthanc
 */
interface OrthancLookupResponseItem {
  ID: string;
  Path: string;
  Type: string;
}

/** Orthanc resource kinds addressable by `/tools/lookup`. */
export type OrthancResourceType = 'Patient' | 'Study' | 'Series' | 'Instance';

class OrthancAIService {
  private orthancUrl: string;
  private currentEndpoint: AIEndpoint | null = null;
  private workitemPollingInterval: number | null = null;
  // Bumped on every stop/start. A tick that is already awaiting a response
  // compares against this to tell whether it still speaks for the current run.
  private pollingGeneration = 0;
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
    const [firstEndpoint] = this.getAIEndpoints();
    if (firstEndpoint) {
      this.setCurrentEndpoint(firstEndpoint);
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
   * fetch with a shared timeout and human-readable failure messages.
   *
   * Every Orthanc call goes through here so a missing or misconfigured server
   * produces one consistent, actionable message instead of a bare
   * "Failed to fetch" or a hang.
   */
  private async request(url: string, init: RequestInit, ctx: RequestContext): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      throw new Error(describeRequestFailure(error, ctx));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Resolve a DICOM UID to Orthanc's internal resource ID via the /tools/lookup
   * API, which finds Orthanc resources by DICOM UID.
   *
   * According to the Orthanc API documentation, the /tools/lookup endpoint
   * expects the DICOM identifier as plain text in the request body.
   *
   * Returns null when Orthanc holds no resource of that type for the UID — an
   * ordinary answer (e.g. a series already deleted), and deliberately distinct
   * from the failures below, which throw a message written for the reader.
   *
   * Every caller needing an Orthanc id goes through here, so the shared timeout,
   * the not-an-Orthanc-server diagnosis and the HTML-body guard are applied once
   * instead of being re-implemented per call site.
   *
   * @param dicomUID The DICOM UID to look up
   * @param type The Orthanc resource kind to pick out of the response
   * @param action Infinitive describing the goal, for failure messages
   */
  async lookupResourceId(
    dicomUID: string,
    type: OrthancResourceType,
    action: string
  ): Promise<string | null> {
    const ctx: RequestContext = {
      action,
      route: 'POST /tools/lookup',
      baseUrl: this.orthancUrl,
      missingRouteMeans: 'not-orthanc',
    };

    const response = await this.request(
      `${this.orthancUrl}/tools/lookup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: dicomUID, // Orthanc expects the bare UID as plain text
      },
      ctx
    );

    if (!response.ok) {
      throw new Error(await describeHttpFailure(response, ctx));
    }

    // A non-Orthanc server can answer 200 with an HTML page (SPA fallback), so
    // the shape is checked rather than assumed — otherwise the reader would get
    // a raw "Unexpected token <" SyntaxError.
    let lookupResults: OrthancLookupResponseItem[];
    try {
      lookupResults = await response.json();
    } catch {
      throw new Error(describeUnexpectedBody(ctx));
    }
    if (!Array.isArray(lookupResults)) {
      throw new Error(describeUnexpectedBody(ctx));
    }

    return lookupResults.find(result => result.Type === type)?.ID ?? null;
  }

  /**
   * Get the Orthanc study ID for a DICOM StudyInstanceUID.
   *
   * Unlike {@link lookupResourceId}, a missing study throws: every caller here
   * is about to route that study to an AI endpoint, so there is nothing useful
   * to do with a null.
   *
   * @param studyInstanceUID The DICOM StudyInstanceUID
   * @returns The Orthanc study ID
   */
  async getOrthancStudyId(studyInstanceUID: string): Promise<string> {
    const orthancId = await this.lookupResourceId(
      studyInstanceUID,
      'Study',
      'look up the study in Orthanc'
    );

    if (!orthancId) {
      throw new Error(`Orthanc has no study with StudyInstanceUID ${studyInstanceUID}.`);
    }

    return orthancId;
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
      const response = await this.request(
        url,
        { method: 'GET' },
        {
          // No `missingRouteMeans`: this caller swallows every failure and
          // falls back to flat series selection by design, so it never builds
          // an HTTP message. Declaring one here would be dead configuration.
          action: 'fetch the model manifest',
          route: 'GET /ai-manifest',
          baseUrl: this.orthancUrl,
        }
      );

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
   * POSTs a routing request to the /send-to-ai endpoint.
   */
  private async postRouting(
    routingRequest: RoutingRequest & {
      input_mapping?: InputMapping;
      input_configuration_id?: string;
    }
  ): Promise<RoutingResponse> {
    const ctx: RequestContext = {
      action: 'send the study to the AI endpoint',
      route: 'POST /send-to-ai',
      baseUrl: this.orthancUrl,
      missingRouteMeans: 'plugin-missing',
    };

    const response = await this.request(
      `${this.orthancUrl}/send-to-ai`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(routingRequest),
      },
      ctx
    );

    if (!response.ok) {
      throw new Error(await describeHttpFailure(response, ctx));
    }

    try {
      return (await response.json()) as RoutingResponse;
    } catch {
      throw new Error(describeUnexpectedBody(ctx));
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
    // No `missingRouteMeans`: a deleted or unknown workitem legitimately 404s,
    // so a 404 here must not be reported as a broken configuration.
    const ctx: RequestContext = {
      action: 'read the AI job status',
      route: 'GET /ups-rs/workitems',
      baseUrl: this.orthancUrl,
    };

    try {
      const response = await this.request(
        `${this.orthancUrl}/ups-rs/workitems/${workitemUid}`,
        {
          method: 'GET',
          headers: {
            Accept: 'application/dicom+json, application/json',
          },
        },
        ctx
      );

      if (!response.ok) {
        throw new Error(await describeHttpFailure(response, ctx));
      }

      // Parse the JSON body directly (parity with getModelManifest;
      // no need to read text first).
      let workitemJson: WorkitemDicomJson;
      try {
        workitemJson = await response.json();
      } catch (parseError) {
        // The raw SyntaxError embeds an excerpt of the body ("Unexpected token
        // '<', \"<!DOCTYPE \"..."), and this message now reaches the panel via
        // the lost-contact path, so it must not be interpolated.
        console.error('Failed to parse workitem JSON:', parseError);
        throw new Error(describeUnexpectedBody(ctx));
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
    // clearInterval only cancels *future* ticks, and a poll can stay in flight
    // for up to the request timeout — at a 2s interval that is ~15 overlapping
    // requests. Without this token those stragglers would keep calling back
    // after the run was cancelled, reset, or replaced by a different workitem.
    const generation = this.pollingGeneration;
    const isCurrentRun = () => generation === this.pollingGeneration;

    // Bound the number of ticks so a workitem that never reaches a terminal
    // state — or a persistently failing/404-ing endpoint — cannot poll forever.
    // Ticks are counted, not completed requests: the count then tracks elapsed
    // wall-clock regardless of how long any individual request takes.
    const maxTicks = Math.max(1, Math.ceil(maxDurationMs / interval));
    let ticks = 0;
    let consecutiveFailures = 0;
    let inFlight = false;

    // Start polling
    this.workitemPollingInterval = window.setInterval(async () => {
      if (!isCurrentRun()) {
        return;
      }

      // Decided synchronously at tick entry, before any await, so a slow request
      // can neither delay the deadline nor let a fast one trip it early.
      ticks++;
      if (ticks >= maxTicks) {
        this.stopWorkitemPolling();
        callback({
          state: 'CANCELED',
          cancellationReason:
            `AI analysis timed out after ${formatDuration(maxTicks * interval)} ` +
            'without a result. The job may still be running on the server.',
        });
        return;
      }

      // One request at a time. At the 2s interval the panel uses, against a
      // server that can take the full request timeout to answer, ticks would
      // otherwise pile up ~15 requests deep — and overlapping replies would
      // scramble the failure counter and the terminal-state handling.
      if (inFlight) {
        return;
      }
      inFlight = true;

      try {
        const status = await this.getWorkitemStatus(workitemUid);
        if (!isCurrentRun()) {
          return;
        }
        consecutiveFailures = 0;
        callback(status);

        // Re-check: the callback may itself have stopped polling or started a
        // run for a different workitem, which this stop would otherwise kill.
        if (!isCurrentRun()) {
          return;
        }

        // Stop polling if workitem reached a terminal state
        if (status.state === 'COMPLETED' || status.state === 'CANCELED') {
          this.stopWorkitemPolling();
          return;
        }
      } catch (error) {
        if (!isCurrentRun()) {
          return;
        }
        console.error('Error during workitem polling:', error);
        consecutiveFailures++;
        // A single failure may be transient, so keep polling. A run of them is
        // not: without this the reader watched a progress bar for the full
        // maxDuration before learning the server had gone away.
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          this.stopWorkitemPolling();
          // Reuse the sanitiser rather than interpolating the error: this string
          // is rendered in the panel, and a raw one could carry a parser excerpt
          // of an HTML body.
          const reason = describeRequestFailure(error, {
            action: 'read the AI job status',
            route: 'GET /ups-rs/workitems',
            baseUrl: this.orthancUrl,
          });
          callback({
            state: 'CANCELED',
            cancellationReason: `Lost contact with the server while the AI job was running. ${reason}`,
          });
          return;
        }
      } finally {
        inFlight = false;
      }
    }, interval);
  }

  /**
   * Stop polling for workitem status
   */
  stopWorkitemPolling(): void {
    // Retire the current generation first, so a tick already awaiting a
    // response becomes a no-op instead of reporting into a stopped run.
    this.pollingGeneration++;
    if (this.workitemPollingInterval !== null) {
      window.clearInterval(this.workitemPollingInterval);
      this.workitemPollingInterval = null;
    }
  }
}

export default OrthancAIService;

/**
 * Register this extension's service on OHIF's global service map so consumers
 * get real types from `servicesManager.services` instead of `any`.
 */
declare global {
  namespace AppTypes {
    interface Services {
      orthancAIService?: OrthancAIService;
    }
  }
}
