import {parentPort,workerData} from 'node:worker_threads';
import {FinancialBackupStore,type BackupArtifactTask} from './backup.js';

if(!parentPort)throw new Error('backup artifact worker requires a parent');
const port=parentPort,store=new FinancialBackupStore(workerData);
port.on('message',(task:BackupArtifactTask)=>{
  try{port.postMessage({ok:true,result:store.runArtifactTask(task)});}
  catch(error){port.postMessage({ok:false,error:error instanceof Error?error.message:'backup artifact operation failed'});}
});
