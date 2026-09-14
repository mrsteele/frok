import { serviceValue } from './registry';

// Increment when new jobs need updated request handling or workspace routing.
export const workerProtocolVersion=8;
export function workerStatus() {
  const running=Date.now()-serviceValue('workerHeartbeat',0)<15_000;
  const protocol=serviceValue<{pid:number;version:number}|null>('workerProtocol',null);
  const current=protocol?.version===workerProtocolVersion&&protocol.pid===serviceValue('workerPid',0);
  return {ready:running&&current,outdated:running&&!current,detail:running&&!current
    ?'Restart Frok to update the generation worker before preparing or running pipelines.'
    :running?'Running · one job at a time':'Start the app with npm run dev or npm start'};
}
