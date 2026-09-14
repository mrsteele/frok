import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';

export function processLog(directory, environment = process.env) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'backend.log');
  if (existsSync(file) && statSync(file).size > 10 * 1024 * 1024) renameSync(file, file + '.previous');
  const log = createWriteStream(file, { flags: 'a', mode: 0o600 });
  const secrets = Object.entries(environment).filter(([key, value]) => /TOKEN|SECRET|API_KEY/.test(key) && value?.length > 5).map(([, value]) => value);
  return {
    write(chunk) {
      let message = String(chunk).replace(/hf_[A-Za-z0-9]+/g, '[redacted]');
      for (const secret of secrets) message = message.split(secret).join('[redacted]');
      log.write(message);
    },
    close: () => new Promise(resolve => log.end(resolve)),
  };
}
