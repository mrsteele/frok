import path from 'node:path';
import os from 'node:os';
import { config as dotenv } from 'dotenv';
dotenv({ path: process.env.FROK_ENV_FILE || ['.env.local', '.env'], quiet: true });
export const root = path.resolve(/* turbopackIgnore: true */ process.env.FROK_APP_ROOT || process.cwd());
export const pipelineHome = path.resolve(/* turbopackIgnore: true */ process.env.FROK_PIPELINE_HOME || process.env.FROK_HOME || path.join(os.homedir(),'frok'));
export const defaultPipelinesDir = path.join(pipelineHome,'pipelines');
export const pipelineTemplatesDir = path.join(root,'resources','pipelines');
export const dataDir = path.resolve(/* turbopackIgnore: true */ root, process.env.FROK_DATA_DIR || '.data');
