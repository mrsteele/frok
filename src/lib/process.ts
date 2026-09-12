import { spawn } from "node:child_process";
export async function runProcess(command: string, args: string[], options: {cwd?:string; signal?:AbortSignal; onLog?:(line:string)=>void; env?:NodeJS.ProcessEnv; timeout?:number} = {}) {
  options.signal?.throwIfAborted();
  return new Promise<string>((resolve,reject)=>{
    const child = spawn(command,args,{cwd:options.cwd,env:options.env || process.env,stdio:["ignore","pipe","pipe"],detached:process.platform !== "win32"});
    let output="", stopped=false;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => { try { if(child.pid && process.platform !== "win32") process.kill(-child.pid,signal); else child.kill(signal); } catch {} };
    const stop=()=>{stopped=true; kill("SIGTERM"); hardKill=setTimeout(()=>kill("SIGKILL"),5000);};
    const timer=setTimeout(stop,options.timeout || 3*60*60*1000);
    options.signal?.addEventListener("abort",stop,{once:true});
    const log=(chunk:Buffer)=>{ const line=chunk.toString().replace(/\x1b\[[0-9;]*[a-zA-Z]/g,"").replace(/hf_[A-Za-z0-9]+/g,"[redacted]"); output=(output+line).slice(-16000); options.onLog?.(line); };
    child.stdout.on("data",log); child.stderr.on("data",log);
    const clean=()=>{clearTimeout(timer);clearTimeout(hardKill);options.signal?.removeEventListener("abort",stop);};
    child.on("error",e=>{clean();reject(new Error(`Cannot run ${command}: ${e.message}`));});
    child.on("close",code=>{clean();if(stopped) reject(new Error(options.signal?.aborted ? "Cancelled" : "Job exceeded its time limit."));else if(code!==0) reject(new Error(output.trim().slice(-3500)||`${command} exited with code ${code}`));else resolve(output);});
  });
}
export async function available(command:string,args=["--version"]) { try { await runProcess(command,args,{timeout:5000});return true; } catch { return false; } }
