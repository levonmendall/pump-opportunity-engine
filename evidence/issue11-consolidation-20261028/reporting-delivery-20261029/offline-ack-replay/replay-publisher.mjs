import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SnapshotPublisher} from '/workspace/pump-opportunity-engine/src/reporting.ts';
const root='/workspace/pump-opportunity-engine/evidence/issue11-consolidation-20261028/reporting-delivery-20261029';
const names=['render-1793244474544.json','render-1793244499183.json','render-1793244765991.json','render-1793244785486.json','render-1793244843405.json'];
const rows=[];
for(const name of names){
 const e=JSON.parse(readFileSync(root+'/'+name)),snapshot=e.snapshot,at=Date.parse(snapshot.times.generatedAt),received=Date.parse(e.receivedAt),dir='/tmp/poe-ack-replay-20261029/'+name;
 mkdirSync(dir,{mode:0o700,recursive:true});const raw=Buffer.from(JSON.stringify(snapshot)+'\n'),rawSha=createHash('sha256').update(raw).digest('hex');writeFileSync(dir+'/snapshot.json',raw,{mode:0o600});
 const identity={accountId:snapshot.account.id,inceptionAt:snapshot.account.inceptionAt,...snapshot.source};
 const previous=Date.now;Date.now=()=>received;
 for(const mode of ['normal','extra-key','wrong-mime']){
  let ack=null,requests=0;
  const publisher=new SnapshotPublisher({url:'https://fixture.invalid/api/snapshot',secret:'OFFLINE_DISPOSABLE_SENTINEL',identity,fetch:async(_url,opts)=>{requests++;if(JSON.stringify(JSON.parse(opts.body))!==JSON.stringify(snapshot))throw Error('OFFLINE_BODY_CHANGED');return new Response(JSON.stringify(mode==='extra-key'?{result:'accepted',extra:true}:{result:'accepted'}),{headers:{'content-type':mode==='wrong-mime'?'text/plain':'application/json; charset=utf-8'}});},onAcknowledgement:value=>{ack=value;}});
  publisher.offer(snapshot,rawSha);const metrics=await publisher.publishOnce();
  rows.push({file:name,mode,at,received,requests,metrics,ack,canonicalMatches:ack?ack.fingerprint===e.fingerprint:null});
  if(mode==='normal')writeFileSync(dir+'/ack.json',JSON.stringify(ack)+'\n',{mode:0o600});
 }
 Date.now=previous;
}
writeFileSync('/tmp/poe-ack-replay-20261029/publisher-result.json',JSON.stringify(rows,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(rows.map(({ack,metrics,...r})=>({...r,ackEmitted:ack!==null,successes:metrics.successes,failures:metrics.failures})),null,2));
