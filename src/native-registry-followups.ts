import {isMarketRegistryContention} from './market-registry.js';

export const NATIVE_REGISTRY_FOLLOWUP_POLICY=Object.freeze({version:'nonfinancial-registry-followups-v1',replay:'scheduler-callback-only',attemptsPerCoordinatorTurn:1,financialReplay:false,freshQualificationRequired:true});
type Kind='technical-reevaluation'|'evaluation-complete'|'economic-rejection';
type Work={kind:Kind;mint:string;at:number;generation:unknown;apply:()=>void;reported:boolean};
/** This queue owns no ledger, quote, order, permission or financial callback.
 * Only the three market-watch feedback callbacks may enter it. A typed SQLite
 * lease refusal is retried outside candidate financial work, never by replaying
 * a candidate or an execution. Unknown/callback/commit failures still propagate.
 * While queued, the bridge admits no additional candidate financial work.
 */
export class NativeRegistryFollowups {
 private readonly queue:Work[]=[];
 private attempts=0;private completed=0;private contentions=0;private discarded=0;
 constructor(private readonly generation:()=>unknown,private readonly record:(kind:string,data:unknown)=>void,private readonly now:()=>number){}
 pending(){return this.queue.length>0;}
 view(){return {version:NATIVE_REGISTRY_FOLLOWUP_POLICY.version,pending:this.queue.length,attempts:this.attempts,completed:this.completed,contentions:this.contentions,generationDiscarded:this.discarded,financialReplay:false};}
 submit(kind:Kind,mint:string,at:number,apply:()=>void){
  const work:Work={kind,mint,at,generation:this.generation(),apply,reported:false};
  if(this.queue.length){this.queue.push(work);return false;}
  if(this.attempt(work))return true;
  this.queue.push(work);return false;
 }
 private attempt(work:Work){
  this.attempts++;
  try{work.apply();this.completed++;return true;}
  catch(error){
   if(!isMarketRegistryContention(error)||error.callbackStarted!==false||!/^SQLITE_(?:BUSY|LOCKED)(?:_|$)/.test(error.sqliteCode))throw error;
   this.contentions++;
   if(!work.reported){work.reported=true;this.record('native-paper-market-followup-deferred',{at:this.now(),requestedAt:work.at,mint:work.mint,kind:work.kind,code:'MARKET_REGISTRY_CONTENTION',sqliteCode:error.sqliteCode,callbackStarted:false,financialReplay:false,financialPermissionChanged:false});}
   return false;
  }
 }
 /** One attempt after due financial protection, before discretionary work. */
 drain(){
  const work=this.queue[0];if(!work)return false;
  if(work.generation!==this.generation()){
   this.record('native-paper-market-followup-generation-retired',{at:this.now(),requestedAt:work.at,mint:work.mint,kind:work.kind,financialReplay:false,freshObservationRequired:true});
   this.queue.shift();this.discarded++;return true;
  }
  if(!this.attempt(work))return false;
  this.queue.shift();return true;
 }
}
