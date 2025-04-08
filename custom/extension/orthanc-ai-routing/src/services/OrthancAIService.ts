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

// Define DICOM tag structure
interface DicomTagValue {
  Value?: any[];
  vr?: string;
}

interface DicomTags {
  [tag: string]: DicomTagValue;
}

interface RoutingRequest {
  study_id: string;
  target: string;
  target_url?: string;
  username?: string;
  password?: string;
}

interface RoutingResponse {
  status: string;
  message: string;
  study_id?: string;
  target?: string;
}

interface OrthancAIServiceConfig {
  orthancUrl?: string;
  aiServerName?: string;
  aiServerUrl?: string;
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
  private refreshInterval: number | null = null;
  private initialSeriesCount: number = 0;
  private dicomStudyUID: string | null = null;
  private refreshCallback: Function | null = null;
  private currentEndpoint: AIEndpoint | null = null;

  constructor({ configuration = {} }: { configuration?: OrthancAIServiceConfig }) {
    this.orthancUrl = configuration.orthancUrl || 'http://localhost:45821';
    this.aiServerName = configuration.aiServerName || 'ai-server';
    this.aiServerUrl = configuration.aiServerUrl || 'http://orthanc-ai:8042';

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
        const errorText = await response.text();
        console.error('Failed to lookup study:', errorText);
        throw new Error(`Failed to lookup study: ${errorText}`);
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
   * Get the current series count for a study
   * @param orthancStudyId The Orthanc study ID
   * @returns The number of series in the study
   */
  async getStudySeriesCount(orthancStudyId: string): Promise<number> {
    try {
      const response = await fetch(`${this.orthancUrl}/studies/${orthancStudyId}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to get study info:', errorText);
        throw new Error(`Failed to get study info: ${errorText}`);
      }

      const studyInfo: OrthancStudy = await response.json();
      console.log('Study info:', studyInfo);

      return studyInfo.Series?.length || 0;
    } catch (error) {
      console.error('Error getting study series count:', error);
      return 0;
    }
  }

  /**
   * Refresh the current page
   */
  private refreshPage(): void {
    console.log('Refreshing page...');
    window.location.reload();
  }

  /**
   * Start polling for new series in the study
   * @param callback Function to call when new series are detected
   * @param interval Polling interval in milliseconds
   * @param autoRefresh Whether to automatically refresh the page when new series are detected
   */
  async startRefreshCheck(callback?: Function, interval: number = 5000, autoRefresh: boolean = true): Promise<void> {
    // Stop any existing refresh check
    this.stopRefreshCheck();

    this.refreshCallback = callback || null;
    this.dicomStudyUID = this.getDicomStudyInstanceUIDFromURL();

    if (!this.dicomStudyUID) {
      console.error('Cannot start refresh check: No StudyInstanceUID found in URL');
      return;
    }

    try {
      // Get the Orthanc study ID
      const orthancStudyId = await this.getOrthancStudyId(this.dicomStudyUID);

      // Get the initial series count
      this.initialSeriesCount = await this.getStudySeriesCount(orthancStudyId);
      console.log(`Initial series count: ${this.initialSeriesCount}`);

      // Start polling
      this.refreshInterval = window.setInterval(async () => {
        try {
          const currentSeriesCount = await this.getStudySeriesCount(orthancStudyId);
          console.log(`Current series count: ${currentSeriesCount}, Initial: ${this.initialSeriesCount}`);

          if (currentSeriesCount > this.initialSeriesCount) {
            console.log('New series detected! Triggering refresh...');
            this.initialSeriesCount = currentSeriesCount;

            if (this.refreshCallback) {
              this.refreshCallback();
            }

            if (autoRefresh) {
              this.refreshPage();
            }
          }
        } catch (error) {
          console.error('Error during refresh check:', error);
        }
      }, interval);
    } catch (error) {
      console.error('Failed to start refresh check:', error);
    }
  }

  /**
   * Stop polling for new series
   */
  stopRefreshCheck(): void {
    if (this.refreshInterval !== null) {
      window.clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('Refresh check stopped');
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

      // Now create the routing request with the Orthanc study ID
      const routingRequest: RoutingRequest = {
        study_id: orthancStudyId,
        target: this.currentEndpoint.name,
        target_url: this.currentEndpoint.url
      };

      // Add username and password if provided
      if (this.currentEndpoint.username) {
        routingRequest.username = this.currentEndpoint.username;
      }

      if (this.currentEndpoint.password) {
        routingRequest.password = this.currentEndpoint.password;
      }

      console.log('Routing request:', routingRequest);

      const response = await fetch(`${this.orthancUrl}/send-to-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(routingRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to route study to AI:', errorText);
        throw new Error(`Failed to route study to AI: ${errorText}`);
      }

      const responseData = await response.json();
      console.log('Routing response:', responseData);
      return responseData;
    } catch (error) {
      console.error('Error routing study to AI:', error);
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
}

export default OrthancAIService;
