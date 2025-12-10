// Remove the incorrect import
// import { log } from '@ohif/core';
// import { DicomMetadataStore } from '@ohif/core';
import { AIEndpoint } from '../components/AIEndpointConfig';

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
  username?: string;
  password?: string;
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
  aiServerName?: string;
  aiServerUrl?: string;
}

// UPS Workitem interfaces
interface WorkitemStatus {
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
  private aiServerName: string;
  private aiServerUrl: string;
  private currentEndpoint: AIEndpoint | null = null;
  private workitemPollingInterval: number | null = null;

  constructor({ configuration = {} }: { configuration?: OrthancAIServiceConfig }) {
    this.orthancUrl = configuration.orthancUrl || 'http://localhost:45821';
    this.aiServerName = configuration.aiServerName || 'ai-server';
    this.aiServerUrl = configuration.aiServerUrl || 'http://orthanc-ai:8042/dicom-web';

    // Try to load the current endpoint from localStorage
    this.loadCurrentEndpoint();
  }

  /**
   * Load the current AI endpoint from localStorage
   */
  private loadCurrentEndpoint(): void {
    try {
      const savedEndpoints = localStorage.getItem('aiEndpoints');
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
      const savedEndpoints = localStorage.getItem('aiEndpoints');
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
    this.aiServerName = endpoint.name;
    this.aiServerUrl = endpoint.url;

    // Update the endpoint in localStorage
    try {
      const savedEndpoints = localStorage.getItem('aiEndpoints');
      if (savedEndpoints) {
        const endpoints: AIEndpoint[] = JSON.parse(savedEndpoints);
        const updatedEndpoints = endpoints.map(e =>
          e.id === endpoint.id ? endpoint : e
        );
        localStorage.setItem('aiEndpoints', JSON.stringify(updatedEndpoints));
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
    console.log('Found DICOM StudyInstanceUID in URL:', firstStudyUID);
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
    try {
      console.log('Looking up Orthanc study ID for StudyInstanceUID:', studyInstanceUID);

      // Call Orthanc's lookup API with the StudyInstanceUID as plain text in the body
      const response = await fetch(`${this.orthancUrl}/tools/lookup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: studyInstanceUID, // Send the UID directly as plain text
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
      console.log('Lookup response:', lookupResults);

      // Find the study result (there could be multiple results)
      const studyResult = lookupResults.find(result => result.Type === 'Study');

      if (!studyResult || !studyResult.ID) {
        throw new Error(`No Orthanc Study ID found for StudyInstanceUID: ${studyInstanceUID}`);
      }

      console.log('Found Orthanc study ID:', studyResult.ID);
      return studyResult.ID;
    } catch (error) {
      console.error('Error getting Orthanc study ID:', error);
      throw error;
    }
  }


  /**
   * Routes the current study to the AI server
   * Uses the StudyInstanceUID from the URL
   */
  async routeCurrentStudyToAI(): Promise<RoutingResponse> {
    try {
      const dicomStudyUID = this.getDicomStudyInstanceUIDFromURL();

      if (!dicomStudyUID) {
        throw new Error('Could not find StudyInstanceUID in the URL');
      }

      return this.routeStudyToAI(dicomStudyUID);
    } catch (error) {
      console.error('Error routing current study to AI:', error);
      throw error;
    }
  }

  async routeStudyToAI(dicomStudyUID: string): Promise<RoutingResponse> {
    try {
      console.log('Starting AI routing for DICOM study UID:', dicomStudyUID);

      // Check if we have a valid AI endpoint
      if (!this.currentEndpoint) {
        throw new Error('No AI endpoint configured. Please add an AI endpoint first.');
      }

      // Get the Orthanc study ID using the lookup API
      const orthancStudyId = await this.getOrthancStudyId(dicomStudyUID);
      console.log('Found Orthanc study ID:', orthancStudyId);

      // Create the routing request with the Orthanc study ID
      const routingRequest: RoutingRequest = {
        study_id: orthancStudyId,
        target: this.currentEndpoint.name,
        target_url: this.currentEndpoint.url
      };

      console.log('Routing request:', routingRequest);

      // Set up timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        // Use the /send-to-ai endpoint
        const response = await fetch(`${this.orthancUrl}/send-to-ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(routingRequest),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          // Try to extract error message from response body
          let errorMessage = `HTTP error! status: ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData.message) {
              errorMessage = errorData.message;
            } else if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch (parseError) {
            // If we can't parse the JSON, try to get text response
            try {
              const errorText = await response.text();
              if (errorText) {
                errorMessage = errorText;
              }
            } catch (textError) {
              // Fall back to status-based message
              console.warn('Could not parse error response:', textError);
            }
          }
          throw new Error(errorMessage);
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
    } catch (error) {
      console.error('Error routing study to AI:', error);
      throw error;
    }
  }

  /**
   * Routes selected series from a study to the AI server
   * @param dicomStudyUID The DICOM StudyInstanceUID
   * @param seriesUIDs Array of DICOM SeriesInstanceUIDs to route
   */
  async routeSeriesToAI(dicomStudyUID: string, seriesUIDs: string[]): Promise<RoutingResponse> {
    try {
      console.log('Starting AI routing for study:', dicomStudyUID);
      console.log('Selected series UIDs:', seriesUIDs);

      // Check if we have a valid AI endpoint
      if (!this.currentEndpoint) {
        throw new Error('No AI endpoint configured. Please add an AI endpoint first.');
      }

      // Validate series UIDs
      if (!seriesUIDs || seriesUIDs.length === 0) {
        throw new Error('No series selected. Please select at least one series.');
      }

      // Get the Orthanc study ID using the lookup API
      const orthancStudyId = await this.getOrthancStudyId(dicomStudyUID);
      console.log('Found Orthanc study ID:', orthancStudyId);

      // Create the routing request with series UIDs
      const routingRequest: RoutingRequest = {
        study_id: orthancStudyId,
        target: this.currentEndpoint.name,
        target_url: this.currentEndpoint.url,
        series_uids: seriesUIDs
      };

      console.log('Routing request:', routingRequest);

      // Set up timeout using AbortController
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      try {
        // Use the /send-to-ai endpoint
        const response = await fetch(`${this.orthancUrl}/send-to-ai`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(routingRequest),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          let errorMessage = `HTTP error! status: ${response.status}`;
          try {
            const errorData = await response.json();
            if (errorData.message) {
              errorMessage = errorData.message;
            } else if (errorData.error) {
              errorMessage = errorData.error;
            }
          } catch (parseError) {
            try {
              const errorText = await response.text();
              if (errorText) {
                errorMessage = errorText;
              }
            } catch (textError) {
              console.warn('Could not parse error response:', textError);
            }
          }
          throw new Error(errorMessage);
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
    } catch (error) {
      console.error('Error routing series to AI:', error);
      throw error;
    }
  }

  async getRoutingStatus(studyId: string): Promise<RoutingResponse> {
    // Since we don't have a real endpoint, return a fake "completed" status
    return {
      status: 'completed',
      message: 'AI processing completed',
      study_id: studyId,
      target: this.aiServerName
    };
  }

  /**
   * Parse DICOM JSON workitem to extract status information
   * @param workitemJson The DICOM JSON workitem object
   * @returns Parsed workitem status
   */
  private parseWorkitemStatus(workitemJson: WorkitemDicomJson): WorkitemStatus {
    const status: WorkitemStatus = {
      state: 'UNKNOWN'
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
          status.progress = parseFloat(progressTag.Value[0]);
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

      console.log('Parsed workitem status:', status);
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
      console.log('Fetching workitem status for:', workitemUid);

      const response = await fetch(`${this.orthancUrl}/ups-rs/workitems/${workitemUid}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/dicom+json, application/json',
        },
      });

      if (!response.ok) {
        console.error(`Failed to get workitem status: ${response.status}`);
        const errorText = await response.text();
        console.error(`Response body: ${errorText}`);
        throw new Error(`Failed to get workitem status: ${response.status}`);
      }

      // Get the response as text first to debug
      const responseText = await response.text();
      console.log('Workitem response text:', responseText);

      // Parse the JSON
      let workitemJson: WorkitemDicomJson;
      try {
        workitemJson = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Failed to parse workitem JSON:', parseError);
        console.error('Response text was:', responseText);
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
   * @param interval Polling interval in milliseconds (default: 2000ms)
   */
  async startWorkitemPolling(
    workitemUid: string,
    callback: (status: WorkitemStatus) => void,
    interval: number = 500
  ): Promise<void> {
    // Stop any existing polling
    this.stopWorkitemPolling();

    console.log(`Starting workitem polling for ${workitemUid} every ${interval}ms`);

    // Start polling
    this.workitemPollingInterval = window.setInterval(async () => {
      try {
        const status = await this.getWorkitemStatus(workitemUid);
        callback(status);

        // Stop polling if workitem reached a terminal state
        if (status.state === 'COMPLETED' || status.state === 'CANCELED') {
          console.log(`Workitem reached terminal state: ${status.state}. Stopping polling.`);
          this.stopWorkitemPolling();
        }
      } catch (error) {
        console.error('Error during workitem polling:', error);
        // Don't stop polling on error, continue trying
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
      console.log('Workitem polling stopped');
    }
  }
}

export default OrthancAIService;
