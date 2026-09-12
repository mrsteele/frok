import path from 'node:path';
import { dataDir } from '../src/lib/paths';
import { auditLibrary } from '../src/lib/library-audit';

const directory = process.argv[2] ? path.resolve(process.argv[2]) : path.join(dataDir, 'library');
console.log(JSON.stringify(auditLibrary(directory), null, 2));
