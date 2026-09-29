import { Injectable } from '@nestjs/common';

export type ExternalJobStatus = 'ACCEPTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface SubmitServiceJobRequest {
  requestId: string;
  workflowId: string;
  step: string;
  payload: Record<string, unknown>;
}

export interface ExternalJobResponse {
  jobId: string;
  status: ExternalJobStatus;
  result?: Record<string, unknown>;
  error?: string;
}

export class ServiceRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ServiceRequestError';
  }
}

@Injectable()
export class ServiceClientService {
  private readonly timeoutMs = Number(process.env.SERVICE_TIMEOUT_MS ?? 15000);

  submitJob(
    serviceUrl: string,
    request: SubmitServiceJobRequest,
  ): Promise<ExternalJobResponse> {
    return this.request(`${this.baseUrl(serviceUrl)}/jobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-request-id': request.requestId,
      },
      body: JSON.stringify(request),
    });
  }

  getJob(serviceUrl: string, jobId: string): Promise<ExternalJobResponse> {
    return this.request(
      `${this.baseUrl(serviceUrl)}/jobs/${encodeURIComponent(jobId)}`,
      { method: 'GET' },
    );
  }

  private baseUrl(serviceUrl: string) {
    return serviceUrl.replace(/\/+$/, '');
  }

  private async request(url: string, init: RequestInit): Promise<ExternalJobResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: controller.signal });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ServiceRequestError(`Service is unavailable: ${message}`, true);
      }

      const body = await this.parseResponse(response);

      if (!response.ok) {
        const retryable =
          response.status >= 500 || response.status === 408 || response.status === 429;
        throw new ServiceRequestError(
          typeof body.error === 'string'
            ? body.error
            : `Service returned HTTP ${response.status}`,
          retryable,
          response.status,
        );
      }

      if (!this.isExternalJobStatus(body.status)) {
        throw new ServiceRequestError('Service returned an invalid job status', false);
      }

      if (!body.jobId || typeof body.jobId !== 'string') {
        throw new ServiceRequestError('Service response does not contain jobId', false);
      }

      if (
        body.status === 'COMPLETED' &&
        (!body.result || typeof body.result !== 'object' || Array.isArray(body.result))
      ) {
        throw new ServiceRequestError('Completed service job does not contain result', false);
      }

      return {
        jobId: body.jobId,
        status: body.status,
        result: body.result as Record<string, unknown> | undefined,
        error: typeof body.error === 'string' ? body.error : undefined,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async parseResponse(response: Response): Promise<Record<string, unknown>> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Response is not a JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new ServiceRequestError(
        `Service returned invalid JSON with HTTP ${response.status}`,
        response.status >= 500 || response.status === 408 || response.status === 429,
        response.status,
      );
    }
  }

  private isExternalJobStatus(value: unknown): value is ExternalJobStatus {
    return ['ACCEPTED', 'PROCESSING', 'COMPLETED', 'FAILED'].includes(String(value));
  }
}
