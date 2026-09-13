// Desktop supervisor IPC controls whether the worker may claim queued jobs.
export class WorkerControl {
  draining = false;
  stopped = false;
  accept(message) {
    if (message?.type === 'drain') this.draining = true;
    if (message?.type === 'resume') this.draining = false;
    if (message?.type === 'stop') { this.stopped = true; return true; }
    return false;
  }
  get mayClaim() { return !this.draining && !this.stopped; }
}
