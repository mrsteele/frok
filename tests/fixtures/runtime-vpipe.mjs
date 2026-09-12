#!/usr/bin/env node
// Log-only fixture: no model, image encoder or video encoder is launched.
import fs from 'node:fs/promises';
const pipeline = JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--launch') + 1], 'utf8'));
const prompt = pipeline.stages.find(stage => stage.id === 'text-prompt').config.text;
const output = pipeline.stages.find(stage => stage.id === 'save-image').config.path;
if (prompt !== 'fail') await fs.writeFile(output, 'synthetic placeholder, not an image');
process.stdout.write("[INFO] Stage 'denoise' ran for 9 m 0 s\n");
process.stdout.write("[INFO] PipelineRuntime: pipeline 'unrelated' ran for 1 h 0 m 0 s\n");
process.stdout.write(`[INFO] PipelineRuntime: pipeline '${pipeline.id}' ran for 11 m `);
setTimeout(() => { process.stdout.write('25 s'); process.exitCode = prompt === 'fail' ? 7 : 0; }, 10);
