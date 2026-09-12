import { runSetup, setupTasks, health } from '../src/lib/setup';
import { registry } from '../src/lib/registry';
import { libraryDatabase, closeLibraryDatabase } from '../src/lib/library';
libraryDatabase();
try {
    const task=process.argv[2];
    if(!task||task==='status')console.log(JSON.stringify(await health(),null,2));
    else if((setupTasks as readonly string[]).includes(task)){
      const controller=new AbortController();process.on('SIGINT',()=>controller.abort());
      await runSetup(task,controller.signal,line=>process.stdout.write(line));
    }else{console.error(`Usage: npm run setup -- status|${setupTasks.join('|')}`);process.exitCode=1;}
}finally{closeLibraryDatabase();registry.close();}
