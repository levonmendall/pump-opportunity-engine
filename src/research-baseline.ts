/** Read-only, explicit ordered counterbook chain. Never opens credentials or
 * edits/refunds a historical grant. Pending reservations require independent
 * confirmation that the prior physical operation/process has settled. */
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import type {ComponentBaseline} from './component-budget.js';

const MIB=1024*1024;
/** Explicit finite history runway: at most256 x128KiB (32MiB) of input.
 * Callers still default to32 paths; no directory scan, rewrite or refund. */
export const RESEARCH_MAXIMUM_PATHS=256;
type Book=Record<string,unknown>;
export type ResearchBaselineSource={path:string;sha256:string;incrementUnits:number;incrementObservedBytes:number;pendingReservedBytes:number};
export type ResearchBaselineOptions={paths:readonly string[];now:number;physicalSettled?:boolean;/** Standing research explicitly removes only the historical lifetime caps. */allowCumulativeBeyondLegacy?:boolean;/** Bounded explicit chapter list; never searches the filesystem. */maximumPaths?:number};
const int=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
function need(v:unknown,code:string):asserts v {if(!v)throw Error('RESEARCH_BASELINE_'+code);}
function times(value:unknown,now:number):number[]{need(Array.isArray(value)&&value.every((t,i)=>int(t)&&t<=now&&(i===0||t>=value[i-1])),'INVALID_STARTS');return [...value];}
function readBook(path:string){
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=fstatSync(fd);need(stat.isFile()&&stat.size>0&&stat.size<=128*1024,'INVALID_FILE');
    const bytes=readFileSync(fd);need(bytes.length===stat.size&&bytes.length<=128*1024,'CHANGED_FILE');
    let book:unknown;try{book=JSON.parse(bytes.toString('utf8'));}catch{throw Error('RESEARCH_BASELINE_INVALID_JSON');}
    need(book&&typeof book==='object'&&!Array.isArray(book),'INVALID_BOOK');
    return {book:book as Book,sha256:createHash('sha256').update(bytes).digest('hex')};
  }finally{closeSync(fd);}
}
function pendingBytes(value:unknown,firstId:number,lastId:number,legacy:boolean){
  need(Array.isArray(value),'INVALID_PENDING');const ids=new Set<number>();let bytes=0;
  for(const raw of value){
    need(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_PENDING');const p=raw as Book;
    const reserve=legacy?p.unobservedBytes:p.reservedBytes;
    need(int(p.id)&&p.id>=firstId&&p.id<=lastId&&!ids.has(p.id)&&int(reserve)&&reserve<=2*MIB,'INVALID_PENDING');
    if(!legacy)need(['http','ws','ws-upgrade'].includes(String(p.transport)),'INVALID_PENDING');
    ids.add(p.id);bytes+=reserve;
  }
  return {bytes,count:ids.size};
}

/** Baseline bytes include each unknown reservation once, in addition to actual
 * observed bytes. A later linked baseline must carry that conservative debit;
 * it is never counted again as a new chapter's observed traffic. */
export function readResearchBaseline(options:ResearchBaselineOptions){
  const maximumPaths=options.maximumPaths??32;
  need(int(maximumPaths)&&maximumPaths>=1&&maximumPaths<=RESEARCH_MAXIMUM_PATHS&&(options.allowCumulativeBeyondLegacy===undefined||typeof options.allowCumulativeBeyondLegacy==='boolean')&&int(options.now)&&Array.isArray(options.paths)&&options.paths.length>0&&options.paths.length<=maximumPaths,'INVALID_OPTIONS');
  const paths=options.paths.map(p=>{need(typeof p==='string'&&p.length>0,'INVALID_PATH');return resolve(p);});
  need(new Set(paths).size===paths.length,'DUPLICATE_PATH');
  const sources:ResearchBaselineSource[]=[];let baseline:ComponentBaseline|undefined,observedBytes=0,uncertainResponseBytes=0,pendingOperations=0,lastObservedAt=0;
  for(let index=0;index<paths.length;index++){
    const path=paths[index]!,{book:b,sha256}=readBook(path);
    need(b.schemaVersion===1&&int(b.lastObservedAt)&&b.lastObservedAt<=options.now&&b.lastObservedAt>=lastObservedAt,'INVALID_CLOCK');lastObservedAt=b.lastObservedAt;
    if(index===0){
      need(b.blockedReason==='RPC_HTTP_429'&&int(b.calls)&&int(b.bytes),'INVALID_LEGACY_BOOK');
      const starts=times(b.starts,b.lastObservedAt);need(starts.length===b.calls,'INVALID_LEGACY_CALLS');
      const pending=pendingBytes(b.pending,1,b.calls,true);
      observedBytes=b.bytes;uncertainResponseBytes=pending.bytes;pendingOperations=pending.count;
      baseline={calls:b.calls,bytes:b.bytes+pending.bytes,starts,refusal:'RPC_HTTP_429',refusalAt:b.lastObservedAt,sha256};
      sources.push({path,sha256,incrementUnits:b.calls,incrementObservedBytes:b.bytes,pendingReservedBytes:pending.bytes});
    }else{
      need(baseline,'MISSING_BASELINE');const linked=b.baseline as Partial<ComponentBaseline>|undefined;
      need(linked&&linked.calls===baseline.calls&&linked.bytes===baseline.bytes&&linked.refusal===baseline.refusal&&linked.refusalAt===baseline.refusalAt&&linked.sha256===baseline.sha256&&JSON.stringify(linked.starts)===JSON.stringify(baseline.starts),'CHAIN_CONFLICT');
      need(typeof b.grantId==='string'&&int(b.startedAt)&&b.startedAt>=baseline.refusalAt&&b.startedAt<=b.lastObservedAt&&int(b.httpBytes)&&int(b.wsBytes),'INVALID_CHAPTER');
      const reserved=times(b.starts,b.lastObservedAt);need(reserved.every(t=>t>=Number(b.startedAt)),'INVALID_CHAPTER_STARTS');
      const actual=new Map<number,number>();
      if(b.actualInvocations!==undefined){
        need(Array.isArray(b.actualInvocations),'INVALID_INVOCATIONS');
        for(const raw of b.actualInvocations){
          need(raw&&typeof raw==='object'&&!Array.isArray(raw),'INVALID_INVOCATIONS');const r=raw as Book;
          need(int(r.id)&&r.id>baseline.calls&&r.id<=baseline.calls+reserved.length&&!actual.has(r.id)&&int(r.at)&&r.at>=reserved[r.id-baseline.calls-1]!&&r.at<=b.lastObservedAt,'INVALID_INVOCATIONS');
          actual.set(r.id,r.at);
        }
      }
      const newStarts=reserved.map((at,i)=>actual.get(baseline!.calls+i+1)??at);
      const pending=pendingBytes(b.pending,baseline.calls+1,baseline.calls+reserved.length,false);
      observedBytes+=b.httpBytes+b.wsBytes;uncertainResponseBytes+=pending.bytes;pendingOperations+=pending.count;
      baseline={...baseline,calls:baseline.calls+reserved.length,bytes:baseline.bytes+b.httpBytes+b.wsBytes+pending.bytes,starts:[...baseline.starts,...newStarts].sort((a,z)=>a-z),sha256};
      sources.push({path,sha256,incrementUnits:reserved.length,incrementObservedBytes:b.httpBytes+b.wsBytes,pendingReservedBytes:pending.bytes});
    }
    need(int(baseline.calls)&&int(baseline.bytes)&&(options.allowCumulativeBeyondLegacy===true||baseline.calls<=240&&baseline.bytes<=64*MIB),'CUMULATIVE_CAP');
  }
  need(baseline,'MISSING_BASELINE');
  if(pendingOperations&&!options.physicalSettled){
    const error=Object.assign(Error('RESEARCH_BASELINE_PHYSICAL_UNCERTAINTY'),{uncertainResponseBytes,pendingOperations});throw error;
  }
  return {baseline,sources,observedBytes,uncertainResponseBytes,pendingOperations,physicalSettlementConfirmed:options.physicalSettled===true};
}
