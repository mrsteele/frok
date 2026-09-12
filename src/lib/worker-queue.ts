import { activeOperations, beginOperation, endOperation, setServiceValue } from './registry';
import { claimJob, db } from './db';

// Cancellation changes the job status before the runner and its cleanup exit.
// Keep runtime locations fixed until the worker releases its operation too.
export function queueBusy() {
  return !!db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') LIMIT 1").get()
    || activeOperations().some(operation => operation.kind === 'worker');
}

export function claimNextJob(){
  let operation:string;
  try {operation=beginOperation('worker');}catch{return;}
  try {const job=claimJob();if(job){setServiceValue('activeJob',{id:job.id,pid:process.pid});return {job,operation};}}
  catch(error){endOperation(operation);throw error;}
  endOperation(operation);
}
