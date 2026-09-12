import { db } from '../src/lib/db';
import { jobsDir } from '../src/lib/config';
import { recoverJobTimes } from '../src/lib/recover-job-times';
import { closeLibraryDatabase } from '../src/lib/library';
try {console.log(JSON.stringify(await recoverJobTimes(db,jobsDir())));}
finally {closeLibraryDatabase();}
