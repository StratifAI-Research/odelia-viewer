import { log } from '@ohif/core';

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
  target_url: string;
}

interface RoutingResponse {
  success: boolean;
  message: string;
  routingId?: string;
}

interface OrthancAIServiceConfig {
  orthancUrl?: string;
  aiServerName?: string;
  aiServerUrl?: string;
}

class OrthancAIService {
  private orthancUrl: string;
  private aiServerName: string;
  private aiServerUrl: string;

  constructor({ configuration = {} }: { configuration?: OrthancAIServiceConfig }) {
    this.orthancUrl = configuration.orthancUrl || 'http://localhost:8000';
    this.aiServerName = configuration.aiServerName || 'ai-server';
    this.aiServerUrl = configuration.aiServerUrl || 'http://orthanc-ai:8042';
  }

  async routeStudyToAI(studyId: string): Promise<RoutingResponse> {
    try {
      const routingRequest: RoutingRequest = {
        study_id: studyId,
        target: this.aiServerName,
        target_url: this.aiServerUrl
      };

      const response = await fetch(`${this.orthancUrl}/send-to-ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(routingRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log.error('Failed to route study to AI:', errorText);
        throw new Error(`Failed to route study to AI: ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      log.error('Error routing study to AI:', error);
      throw error;
    }
  }

  async getRoutingStatus(studyId: string): Promise<RoutingResponse> {
    try {
      const response = await fetch(`${this.orthancUrl}/routing-status/${studyId}`);
      if (!response.ok) {
        const errorText = await response.text();
        log.error('Failed to fetch routing status:', errorText);
        throw new Error(`Failed to fetch routing status: ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      log.error('Error getting routing status:', error);
      throw error;
    }
  }
}

export default OrthancAIService;
