import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,realpathSync} from 'node:fs';
import type {LedgerState} from './ledger.js';

const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export const REVIEWED_MARKET_CONTENTION=Object.freeze({
 version:'owner-evidenced-market-contention-212280-v1',
 accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,
 epochId:'poe-paper-10sol-v3-20261030',attemptedRevision:212277,cashLamports:'9856630758',
 reportPath:'/var/lib/poe-public/diagnostics/financial-failure-20261101.json',
 reportSha256:'5e900ce15313f25aa848cdf22e77eeb29f5bd3ca55cf9cd667e9b063fcb8cc95',
 errorSha256:'3dc07c1777abf93a1fe2ca3d60d9d5c1b4f610e24222915af914bb35bc3e5fd4',
 incidentLineSha256:'d42e1a232485416d5f22fd17f17219ae8b7acddfbd4e0f420045b475936c1195',
 anchorRevision:209559,anchorAt:1793504634985,
 anchorActionSha256:'2ba2b5ea9a98b2d72bcba27c3b91232bde1089507a64bf005d484dd06410c98e',
 entryPermissionGranted:false,
} as const);
/** Exact authenticated controls, not a reason-string whitelist. The fourth
 * record is the retained subsequent source-recovery closure. Its underlying
 * source fault is not declared harmless: a new source and all current financial
 * readiness checks must pass independently. No later hard intent is accepted.
 */
export const REVIEWED_MARKET_CONTENTION_CONTROLS=Object.freeze([
 {revision:212280,at:1793508368755,actionSha256:'8445ef6c37f46102358438973285b45d96f5b007227d91134d09c4a3cda3e6d2',detailSha256:'086d8068832c0106cc7da802c47a7a45ce9710c58593e3cbf070cc9a00b1d6fa',kind:'ordinary'},
 {revision:212418,at:1793508743796,actionSha256:'586c664d883d5b6503b2be1686a65daf73b86afb04387de21de4aeb61258d3eb',detailSha256:'80ef5ed6fa380c678c41c42e9e1ff89a05e39a18f39f23b0dc387c9e25b6275f',kind:'startup'},
 {revision:212419,at:1793508743802,actionSha256:'e98dc2bfa50911ba53d670b592c3402f3d831a1f5cf637ff6475de6ebe9b46b3',detailSha256:'abd90504299d7806d76362c4cf5b0d600c5d5b7f1ec7896347f0961a44213edc',kind:'restored'},
 {revision:213178,at:1793509761197,actionSha256:'3316a8b0552b6ba0202836d6d594978e1bfa5d2b299c740f3f01dfecf53d2254',detailSha256:'7d178153143db0f5a00dad8f616c10cc528a9a20009f32211835bed1ee97b0a8',kind:'ordinary'},
] as const);
export type ReviewedContentionControl={revision:number;at:number;actionSha256:string;detailSha256:string;reasonSha256:string;ordinary:boolean;startup:boolean;restored:boolean;temporary:boolean;kind:string;paused:boolean;cancellations:number};
export type ReviewedContentionHistory={anchor:{revision:number;at:number;kind:string;actionSha256:string}|null;controls:ReviewedContentionControl[]};
/** Input control rows must already have passed the ledger's joined action,
 * payload, result, ordering and owner-intent authentication. This additional
 * proof is read-only and grants no trading permission. */
export function reviewedMarketContentionLineage(s:Readonly<LedgerState>,h:ReviewedContentionHistory|null,evidenceAccepted:boolean,nonfinancialOnly:boolean):boolean{
 const p=REVIEWED_MARKET_CONTENTION;
 if(!evidenceAccepted||!nonfinancialOnly||!h||s.accountId!==p.accountId||s.inceptionAt!==p.inceptionAt||s.mode!=='PAPER'||s.paperEpoch?.id!==p.epochId||s.equityRisk?.version!=='paper-equity-risk-v3-no-daily-stop-v1'||s.lamports!==p.cashLamports||s.controls.entriesEnabled||s.controls.stopRequested||s.daily.lossPaused||Object.keys(s.positions).length||Object.keys(s.pending).length||h.anchor?.kind!=='resume'||h.anchor.revision!==p.anchorRevision||h.anchor.at!==p.anchorAt||h.anchor.actionSha256!==p.anchorActionSha256||h.controls.length<4)return false;
 for(let i=0;i<4;i++){
  const a=h.controls[i]!,e=REVIEWED_MARKET_CONTENTION_CONTROLS[i]!;
  if(a.revision!==e.revision||a.at!==e.at||a.actionSha256!==e.actionSha256||a.detailSha256!==e.detailSha256||a.kind!=='pause'||!a.paused||a.cancellations!==0||Number(a.ordinary)+Number(a.startup)+Number(a.restored)!==1||!a[e.kind])return false;
 }
 let previous=h.controls[3]!;
 for(const a of h.controls.slice(4)){
  if(a.revision<=previous.revision||a.at<previous.at||a.kind!=='pause'||!a.paused||a.cancellations!==0||a.restored||!a.temporary||!(a.startup&&!a.ordinary||a.ordinary&&!a.startup))return false;
  previous=a;
 }
 return previous.revision<=s.revision&&previous.at===s.controls.changedAt&&previous.reasonSha256===hash(s.controls.reason);
}
/** Only the already owner-executed, sanitized fixed report is read. Never read
 * raw evidence, credentials or arbitrary paths here. A new/missing report is
 * not an authorization and leaves the inherited pause closed. */
export function readReviewedMarketContentionReportSha256():string|null{
 const path=REVIEWED_MARKET_CONTENTION.reportPath;let fd:number|undefined;
 try{
  if(realpathSync(path)!==path)return null;
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const a=fstatSync(fd);if(!a.isFile()||a.uid!==988||a.nlink!==1||(a.mode&0o777)!==0o644||a.size<=0||a.size>32768)return null;
  const raw=Buffer.alloc(a.size+1);let n=0;while(n<raw.length){const got=readSync(fd,raw,n,raw.length-n,null);if(!got)break;n+=got;}
  const b=fstatSync(fd);if(n!==a.size||a.dev!==b.dev||a.ino!==b.ino||a.size!==b.size||a.mtimeMs!==b.mtimeMs||a.ctimeMs!==b.ctimeMs)return null;
  const digest=hash(raw.subarray(0,n));return digest===REVIEWED_MARKET_CONTENTION.reportSha256?digest:null;
 }catch{return null;}finally{if(fd!==undefined)closeSync(fd);}
}
