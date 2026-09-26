import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class WorkflowCacheService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkflowCacheService.name);
  private readonly redis = new Redis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
    lazyConnect: false,
    connectTimeout: 2000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  private readonly ttlSeconds = Number(process.env.CACHE_TTL_SECONDS ?? 604800);

  constructor() {
    this.redis.on('error', (error) => {
      this.logger.warn(`Redis cache error: ${error.message}`);
    });
  }

  async setStepInput(workflowId: string, stepId: string, value: Record<string, unknown>) {
    await this.setJson(this.inputKey(workflowId, stepId), value);
  }

  async getStepInput<T extends Record<string, unknown>>(workflowId: string, stepId: string) {
    return this.getJson<T>(this.inputKey(workflowId, stepId));
  }

  async setStepOutput(workflowId: string, stepId: string, value: Record<string, unknown>) {
    await this.setJson(this.outputKey(workflowId, stepId), value);
  }

  async getStepOutput<T extends Record<string, unknown>>(workflowId: string, stepId: string) {
    return this.getJson<T>(this.outputKey(workflowId, stepId));
  }

  private inputKey(workflowId: string, stepId: string) {
    return `workflow:${workflowId}:step:${stepId}:input`;
  }

  private outputKey(workflowId: string, stepId: string) {
    return `workflow:${workflowId}:step:${stepId}:output`;
  }

  private async setJson(key: string, value: Record<string, unknown>) {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not write cache key ${key}: ${message}`);
    }
  }

  private async getJson<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not read cache key ${key}: ${message}`);
      return null;
    }
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      this.redis.disconnect();
    }
  }
}
