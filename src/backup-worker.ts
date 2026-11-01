import {parentPort,workerData} from 'node:worker_threads';
import {FinancialBackupStore,type BackupArtifactRequest,type BackupWorkerData} from './backup.js';

if(!parentPort)throw new Error('backup artifact worker requires a parent');
const data=workerData as BackupWorkerData,port=parentPort,store=new FinancialBackupStore(data.options),cancellation=new Int32Array(data.cancellation);
let deadlineAtMonoNs:bigint|null=null,lastId=0,queue=Promise.resolve();
store.bindWorkerOperation(data.operation,()=>Atomics.load(cancellation,0)!==0||deadlineAtMonoNs!==null&&process.hrtime.bigint()>=deadlineAtMonoNs);
port.on('message',(request:BackupArtifactRequest)=>{
  if(!request||!Number.isSafeInteger(request.id)||request.id<=lastId||typeof request.deadlineAtMonoNs!=='bigint'||!request.task||!['acquire','prepare','copy','finish','abort','recover'].includes(request.task.task)){
    Atomics.store(cancellation,0,1);port.postMessage({id:request?.id??null,ok:false,error:'backup artifact request scope mismatch; pending artifacts preserved'});return;
  }
  lastId=request.id;
  // One phase runs at a time. A queued/stale request never inherits a newer
  // phase's deadline or permission, including after cancellation or timeout.
  queue=queue.then(async()=>{
    deadlineAtMonoNs=request.deadlineAtMonoNs;
    try{const result=await store.runArtifactTask(request.task);if(Atomics.load(cancellation,0)!==0||process.hrtime.bigint()>=request.deadlineAtMonoNs)throw new Error('backup artifact request cancelled or expired; pending artifacts preserved');port.postMessage({id:request.id,ok:true,result});}
    catch(error){port.postMessage({id:request.id,ok:false,error:error instanceof Error?error.message:'backup artifact operation failed'});}
    finally{deadlineAtMonoNs=null;}
  });
});
