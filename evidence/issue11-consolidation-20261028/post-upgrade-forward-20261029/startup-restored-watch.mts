import {PilotNativeFlow} from '/workspace/pump-opportunity-engine/src/pilot-native-flow.ts';
import {NativeCandidateRunner} from '/workspace/pump-opportunity-engine/src/native-candidate-runner.ts';
import {PilotWatch} from '/workspace/pump-opportunity-engine/src/pilot-watch.ts';
import {serviceNativePaperStartup} from '/workspace/pump-opportunity-engine/src/run-native-paper.ts';
import {CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW} from '/workspace/pump-opportunity-engine/src/program-log-mapping.ts';
let at=1793282400000;let io=0;const watch=new PilotWatch({maximumDeep:6,maximumIdentities:174,maximumOlderResearch:24,now:()=>at,record:()=>{}});
for(let i=0;i<30;i++){const signature='offline-signature-'+i;watch.discover({signature,receivedAt:at-1000});watch.verify(signature,{mint:'offline-mint-'+i,pool:'offline-pool-'+i,migrationAt:at-600000,verifiedAt:at});if(i<6)watch.transition('offline-mint-'+i,'DEEP_OBSERVATION','offline prior-generation selected',at);}
const record=()=>{};const blocked=()=>{io++;throw Error('NETWORK FORBIDDEN IN OFFLINE FIXTURE');};const rpc={usage:()=>({}),call:blocked};
const flow=new PilotNativeFlow({dataContract:CONFIRMED_PROGRAM_ACTIVITY_V3_SHADOW,control:{usage:()=>({}),operateData:blocked}as any,support:{}as any,maximumCandidates:6,persistent:true,record,onTrade:()=>{},onGap:()=>{}},{now:()=>at,monotonic:()=>0,setTimer:()=>0,clearTimer:()=>{}});
const runner=new NativeCandidateRunner({rpc:rpc as any,flow,now:()=>at,maximumDeep:6,restoredWatch:watch.export(),record});
const trace:string[]=[];let index=0;for(let step=0;step<2;step++)index=await serviceNativePaperStartup({managementOnly:false,nextSource:index,owned:()=>false,protect:async()=>{},sourceAdmission:()=>runner.discretionaryAdmission(1500,at).admitted,sources:[async()=>{trace.push('discovery');},async()=>{trace.push('watch');}],record,now:()=>at});
console.log(JSON.stringify({fixture:true,io,watchRows:watch.export().rows.length,priorDeepRows:watch.export().rows.filter(r=>r.state==='DEEP_OBSERVATION').length,runnerCandidates:runner.candidates.length,deadline:runner.deadlineView(at),admission:runner.discretionaryAdmission(1500,at),startupIndex:index,startupTrace:trace},null,2));
