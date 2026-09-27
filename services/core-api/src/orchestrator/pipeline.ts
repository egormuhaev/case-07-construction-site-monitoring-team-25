import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface PipelineStepDefinition {
  name: string;
  serviceName: string;
  serviceUrl: string;
  pollIntervalMs: number;
}

interface PipelineFile {
  pipelines?: Record<string, { steps?: unknown }>;
  steps?: unknown;
}

@Injectable()
export class PipelineConfigService implements OnModuleInit {
  private readonly logger = new Logger(PipelineConfigService.name);
  private pipelines = new Map<string, PipelineStepDefinition[]>();

  async onModuleInit() {
    const configuredPath = process.env.PIPELINE_CONFIG_PATH ?? 'config/pipeline.json';
    const configPath = resolve(configuredPath);
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as PipelineFile;

    if (parsed.pipelines && Object.keys(parsed.pipelines).length > 0) {
      for (const [name, pipeline] of Object.entries(parsed.pipelines)) {
        this.pipelines.set(name, this.parseSteps(pipeline.steps, name));
      }
    } else if (Array.isArray(parsed.steps)) {
      this.pipelines.set('default', this.parseSteps(parsed.steps, 'default'));
    } else {
      throw new Error(`Pipeline config ${configPath} must contain pipelines or steps`);
    }

    this.logger.log(
      `Loaded pipelines: ${[...this.pipelines.keys()].join(', ')} from ${configPath}`,
    );
  }

  getPipeline(name: string): PipelineStepDefinition[] {
    const steps = this.pipelines.get(name);
    if (!steps) {
      throw new Error(`Unknown pipeline: ${name}`);
    }
    return steps.map((step) => ({ ...step }));
  }

  private parseSteps(value: unknown, pipeline: string): PipelineStepDefinition[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error(`Pipeline ${pipeline} must contain at least one step`);
    }
    const steps = value.map((item, index) => this.parseStep(item, `${pipeline}[${index}]`));
    const names = new Set(steps.map((step) => step.name));
    if (names.size !== steps.length) {
      throw new Error(`Pipeline ${pipeline} contains duplicate step names`);
    }
    return steps;
  }

  private parseStep(value: unknown, label: string): PipelineStepDefinition {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${label} must be an object`);
    }
    const step = value as Record<string, unknown>;
    const name = this.requiredString(step.name, `${label}.name`);
    const serviceName = this.requiredString(step.serviceName, `${label}.serviceName`);
    const serviceUrl = this.requiredString(step.serviceUrl, `${label}.serviceUrl`);
    const pollIntervalMs = Number(step.pollIntervalMs ?? 5000);
    const url = new URL(serviceUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`${label}.serviceUrl must use http or https`);
    }
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 1000) {
      throw new Error(`${label}.pollIntervalMs must be at least 1000`);
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
