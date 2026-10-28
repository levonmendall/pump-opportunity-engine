import { openSync,writeSync,closeSync,statSync,fsyncSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
export function json(value:unknown):string {
  return JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v);
}
// Bounded Gate A recorder: full selected observations, no arbitrary metadata fetches.
// A full file stops collection, never silently drops required evidence.
export class Recorder {
  private fd:number; private bytes:number; private seq=0;
  private closed=false;
  constructor(path:string,private maxBytes=10_000_000){this.fd=openSync(path,'a',0o600);this.bytes=statSync(path).size;}
  record(kind:string,data:unknown){
    const line=json({schemaVersion:1,sequence:++this.seq,receivedAt:new Date().toISOString(),monotonicMs:performance.now(),kind,data})+'\n';
    if(this.bytes+Buffer.byteLength(line)>this.maxBytes) throw new Error('EVIDENCE_CAPACITY_REACHED');
    writeSync(this.fd,line);this.bytes+=Buffer.byteLength(line);
  }
  close(){if(this.closed)return;this.closed=true;try{fsyncSync(this.fd);}finally{closeSync(this.fd);}}
}

export {BoundedRotatingRecorder} from "./retained-recorder.js";
