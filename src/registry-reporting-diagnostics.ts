/** Public provenance of a detached nonfinancial sample, never financial age. */
export const REGISTRY_REPORTING_REASON_CODES=['REPORTING_SCOPE_UNAVAILABLE','REPORTING_WATCH_STATE_UNAVAILABLE','REPORTING_RESPONSE_TOO_LARGE','REPORTING_READ_BUSY','REPORTING_READ_UNAVAILABLE','REPORTING_RESULT_INVALID','REPORTING_SEND_FAILED','REPORTING_REQUEST_INVALID','REPORTING_REQUEST_TIMEOUT','REPORTING_INTAKE_PRIORITY','REPORTING_SAMPLE_STALE','REPORTING_PENDING','REPORTING_NOT_REQUESTED','WORKER_UNAVAILABLE','OTHER_UNEXPORTED_REASON'] as const;
export type RegistryReportingDiagnostics={mode:'DETACHED_WORKER';state:'FRESH'|'STALE'|'UNAVAILABLE';sourceInstanceId:string;sampledAt:string;workerGeneration:number;sampleWorkerGeneration:number|null;requestedAt:string|null;observedAt:string|null;completedAt:string|null;durationMs:number|null;ageMs:number|null;pending:boolean;failures:number;reasonCode:typeof REGISTRY_REPORTING_REASON_CODES[number]|null};
const record=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
const INCEPTION=Date.parse('2026-10-26T22:07:36.212Z');
const keys='mode state sourceInstanceId sampledAt workerGeneration sampleWorkerGeneration requestedAt observedAt completedAt durationMs ageMs pending failures reasonCode';
function need(v:unknown):asserts v{if(!v)throw Error('REGISTRY_REPORTING_DIAGNOSTICS_INVALID');}
export function projectRegistryReportingDiagnostics(value:unknown,generated:number):RegistryReportingDiagnostics|null {
 const r=record(value);if(r.mode!=='DETACHED_WORKER')return null;
 try{const iso=(v:unknown)=>count(v)&&v>=INCEPTION&&v<=generated?new Date(v).toISOString():null;
  return validateRegistryReportingDiagnostics({mode:r.mode,state:r.state,sourceInstanceId:r.sourceInstanceId,sampledAt:iso(r.sampledAt),workerGeneration:r.workerGeneration,sampleWorkerGeneration:r.sampleWorkerGeneration,requestedAt:iso(r.requestedAt),observedAt:iso(r.observedAt),completedAt:iso(r.completedAt),durationMs:r.durationMs,ageMs:r.ageMs,pending:r.pending,failures:r.failures,reasonCode:r.reasonCode===null?null:(REGISTRY_REPORTING_REASON_CODES as readonly unknown[]).includes(r.reasonCode)?r.reasonCode:'OTHER_UNEXPORTED_REASON'},generated);
 }catch{return null;}
}
export function validateRegistryReportingDiagnostics(value:unknown,generated:number):RegistryReportingDiagnostics {
 const r=record(value);need(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(r).sort().join(' ')===keys.split(' ').sort().join(' '));
 need(r.mode==='DETACHED_WORKER'&&['FRESH','STALE','UNAVAILABLE'].includes(r.state)&&typeof r.sourceInstanceId==='string'&&r.sourceInstanceId.length<=256&&/^native-runner:[a-zA-Z0-9-]+:[a-zA-Z0-9-]+$/.test(r.sourceInstanceId));
 const time=(value:unknown,nullable=false):number|null=>{if(nullable&&value===null)return null;const at=typeof value==='string'?Date.parse(value):NaN;need(Number.isSafeInteger(at)&&at>=INCEPTION&&at<=generated&&new Date(at).toISOString()===value);return at;};
 const sampled=time(r.sampledAt)!,requested=time(r.requestedAt,true),observed=time(r.observedAt,true),completed=time(r.completedAt,true);
 need(count(r.workerGeneration)&&count(r.failures)&&typeof r.pending==='boolean'&&(r.reasonCode===null||(REGISTRY_REPORTING_REASON_CODES as readonly unknown[]).includes(r.reasonCode)));
 need(r.sampleWorkerGeneration===null||count(r.sampleWorkerGeneration)&&r.sampleWorkerGeneration<=r.workerGeneration);
 if(observed===null)need(r.state==='UNAVAILABLE'&&completed===null&&r.durationMs===null&&r.ageMs===null&&r.sampleWorkerGeneration===null);
 else{need(Number.isFinite(r.durationMs)&&r.durationMs>=0&&r.durationMs<=Number.MAX_SAFE_INTEGER);need(r.state!=='UNAVAILABLE'&&requested!==null&&completed!==null&&requested<=observed&&observed<=completed&&completed<=sampled&&r.ageMs===sampled-observed&&r.sampleWorkerGeneration!==null);}
 if(requested!==null)need(requested<=sampled);
 if(r.state==='FRESH')need(r.reasonCode===null&&r.sampleWorkerGeneration===r.workerGeneration&&r.ageMs<=30000);
 need(Buffer.byteLength(JSON.stringify(r))<=2048);return r as RegistryReportingDiagnostics;
}
