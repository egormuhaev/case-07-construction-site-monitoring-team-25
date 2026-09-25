import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface PipelineStepDefinition {
  name: string;
  serviceName: string;
  serviceUrl: string;
  pollIntervalMs: number;
}

interface PipelineConfigFile {
  steps?: unknown;
}

@Injectable()
export class PipelineConfigService implements OnModuleInit {
  private readonly logger = new Logger(PipelineConfigService.name);
  private steps: PipelineStepDefinition[] = [];

  async onModuleInit() {
    const configuredPath = process.env.PIPELINE_CONFIG_PATH ?? 'config/pipeline.json';
    const configPath = resolve(configuredPath);
    const content = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(content) as PipelineConfigFile;

    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      throw new Error(`Pipeline config ${configPath} must contain at least one step`);
    }

    this.steps = parsed.steps.map((value, index) => this.parseStep(value, index));

    const uniqueNames = new Set(this.steps.map((step) => step.name));
    if (uniqueNames.size !== this.steps.length) {
      throw new Error(`Pipeline config ${configPath} contains duplicate step names`);
    }

    this.logger.log(`Loaded ${this.steps.length} pipeline steps from ${configPath}`);
  }

  getSteps(): PipelineStepDefinition[] {
    return this.steps.map((step) => ({ ...step }));
  }

  private parseStep(value: unknown, index: number): PipelineStepDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Pipeline step ${index} must be an object`);
    }

    const step = value as Record<string, unknown>;
    const name = this.requiredString(step.name, `steps[${index}].name`);
    const serviceName = this.requiredString(
      step.serviceName,
      `steps[${index}].serviceName`,
    );
    const serviceUrl = this.requiredString(step.serviceUrl, `steps[${index}].serviceUrl`);
    const pollIntervalMs = Number(step.pollIntervalMs ?? 5000);

    const url = new URL(serviceUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`steps[${index}].serviceUrl must use http or https`);
    }

    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) {
      throw new Error(`steps[${index}].pollIntervalMs must be at least 1000`);
    }

    return { name, serviceName, serviceUrl, pollIntervalMs };
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${field} must be a non-empty string`);
    }
    return value.trim();
  }
}
