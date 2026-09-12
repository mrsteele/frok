import type { Health } from './types';

export function settingsAttention(health?:Health) {
  const connections=Object.values(health?.connections||{});
  const connected=connections.some(item=>item.enabled&&item.available);
  const chosen=connections.some(item=>item.enabled);
  const capabilities=Object.entries(health?.capabilities||{}).filter(([key])=>key!=='prompt').map(([,value])=>value);
  return {
    connected,
    modelsLocked:!connected,
    connection:!health?undefined:!connected?'error':connections.some(item=>item.enabled&&!item.available)||health.capabilities?.prompt.configured&&!health.capabilities.prompt.ready?'warning':undefined,
    models:!health||!connected?undefined:!capabilities.some(item=>item.configured)||capabilities.some(item=>item.configured&&!item.ready)?'warning':undefined,
    connectionMessage:!health?'Checking connections…':!chosen?'Connect at least one service before choosing pipelines.':'Reconnect a service before choosing pipelines.',
  } as const;
}
