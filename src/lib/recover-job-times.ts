import fs from 'node:fs/promises';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Job } from './types';
import { parseVpipeRuntime } from './runner-time';

// Recover only reported pipeline durations. A job's creation timestamp includes
// queue wait, and file timestamps are not reliable start times after copying.
export async function recoverJobTimes(db: DatabaseSync, jobsDirectory: string) {
  const rows = db.prepare("SELECT id,data FROM jobs WHERE status IN ('completed','failed') AND json_extract(data,'$.runner')='vpipe' AND json_extract(data,'$.kind')='generate' AND json_extract(data,'$.elapsedSeconds') IS NULL AND json_extract(data,'$.runnerSeconds') IS NULL").all() as { id: string; data: string }[];
  let jobsRecovered = 0, outputsRecovered = 0, unavailable = 0;
  for (const row of rows) {
    const job = JSON.parse(row.data) as Job;
    const mode = 'mode' in job.request ? job.request.mode : undefined;
    if (!mode || !['image','video','reference'].includes(mode) || !/^[a-f0-9-]{36}$/i.test(row.id)) continue;
    let text: string;
    try {
      const file = await fs.open(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ jobsDirectory, row.id, 'runner.log'), 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 8 * 1024 * 1024) { unavailable++; continue; }
        text = await file.readFile('utf8');
      } finally { await file.close(); }
    } catch { unavailable++; continue; }
    const durations = new Map<number, number>();
    for (const line of text.split(/[\r\n]/)) {
      const report = /\bPipelineRuntime: pipeline '(frok-(image|video|reference)-(\d+))' ran for /.exec(line);
      if (!report || report[2] !== mode) continue;
      const seconds = parseVpipeRuntime(line, report[1]), seed = Number(report[3]);
      if (seconds !== undefined && Number.isSafeInteger(seed)) durations.set(seed, seconds);
    }
    if (!durations.size) { unavailable++; continue; }
    // Use SQL field updates so recovery cannot overwrite favorites, status,
    // dismissal or metadata that another process changed while reading the log.
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare("UPDATE jobs SET data=json_set(data,'$.runnerSeconds',?) WHERE id=? AND status IN ('completed','failed') AND json_extract(data,'$.runnerSeconds') IS NULL AND json_extract(data,'$.elapsedSeconds') IS NULL")
        .run([...durations.values()].reduce((total, value) => total + value, 0), row.id);
      if (result.changes) {
        jobsRecovered++;
        for (const [seed, seconds] of durations) {
          outputsRecovered += Number(db.prepare("UPDATE media SET data=json_set(data,'$.runnerSeconds',?) WHERE json_extract(data,'$.jobId')=? AND json_extract(data,'$.seed')=? AND json_extract(data,'$.origin')='generated' AND json_extract(data,'$.runnerSeconds') IS NULL AND json_extract(data,'$.elapsedSeconds') IS NULL")
            .run(seconds, row.id, seed).changes);
        }
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return { jobsRecovered, outputsRecovered, unavailable };
}
