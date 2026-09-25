export const WORKFLOW_QUEUE = 'workflow';
export const PROCESS_STEP_JOB = 'process-step';

export interface ExecuteStepJobData {
  workflowId: string;
  stepId: string;
}
