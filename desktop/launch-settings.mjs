import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { readRuntimeOptions, readOllamaAddress } from './preferences.mjs';

export function launchSettings(data, environment = process.env) {
  const folder = path.join(data, 'library');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(path.join(folder, 'frok.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
    return { ...readRuntimeOptions(database, environment), ollamaUrl: readOllamaAddress(database, environment) };
  } finally { database.close(); }
}
