import type { PipelineStatus } from '@/lib/pipelines/schema';
import type { Health } from '@/lib/types';

export function groupWorkflowsByConnection(workflows: PipelineStatus[], health?: Health) {
  const connected: PipelineStatus[] = [], disconnected: PipelineStatus[] = [];
  for (const workflow of workflows) {
    const connection = health?.connections?.[workflow.runner];
    // Missing model files still belong with the user's connected provider.
    (connection?.enabled && connection.available ? connected : disconnected).push(workflow);
  }
  return { connected, disconnected };
}
