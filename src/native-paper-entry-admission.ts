/** Transient admission for one already-admitted candidate workflow. This is
 * neither financial permission nor a provider quota: the caller retains all
 * current ledger, physical-provider and completed-protection checks. */
export const NATIVE_PAPER_ENTRY_ADMISSION_POLICY=Object.freeze({
 version:'scoped-entry-workflow-accounted-starts-v2',maximumAccountedStarts:9,
 meaning:'Debit charged workflow request-start units once per completed call, including protected context reads and conservative uninvoked reservations. A zero-accounted-unit refusal consumes no scope; protective priority and financial/provider reserves remain unchanged.'
});
const tokenBrand:unique symbol=Symbol('native-paper-entry-admission');
export type NativePaperEntryAdmissionToken=Readonly<{
 mint:string;windowEndAt:number;deadlineAt:number;[tokenBrand]:true;
}>;
type Scope={token:NativePaperEntryAdmissionToken;spent:number;limit:number;lastAt:number};
const uint=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const mintText=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=96&&!/[\u0000-\u001f]/.test(value);

export class NativePaperEntryAdmission {
 private active:Scope|null=null;
 private lastObservedAt=0;
 constructor(readonly maximumAccountedStarts:number=NATIVE_PAPER_ENTRY_ADMISSION_POLICY.maximumAccountedStarts){
  if(!uint(maximumAccountedStarts)||maximumAccountedStarts<1||maximumAccountedStarts>NATIVE_PAPER_ENTRY_ADMISSION_POLICY.maximumAccountedStarts)throw Error('NATIVE_PAPER_ENTRY_START_BOUND');
 }
 begin(input:{mint:string;windowEndAt:number;deadlineAt:number;at:number;fullyAdmitted:boolean;maximumAccountedStarts?:number}):NativePaperEntryAdmissionToken|null{
  const limit=input.maximumAccountedStarts??this.maximumAccountedStarts;
  if(input.fullyAdmitted!==true||!mintText(input.mint)||!uint(input.windowEndAt)||!uint(input.deadlineAt)||!uint(input.at)||input.windowEndAt>input.at||input.at>input.deadlineAt||!uint(limit)||limit<1||limit>this.maximumAccountedStarts)return null;
  if(input.at<this.lastObservedAt){this.active=null;return null;}
  this.lastObservedAt=input.at;
  if(this.active){
   if(this.valid(this.active.token,input.at))return null;
  }
  const token=Object.freeze({mint:input.mint,windowEndAt:input.windowEndAt,deadlineAt:input.deadlineAt,[tokenBrand]:true as const});
  this.active={token,spent:0,limit,lastAt:input.at};return token;
 }
 /** Unknown/closed/copied tokens cannot mutate a later scope. Invalid or
  * regressing time invalidates only the currently matching token. */
 valid(token:NativePaperEntryAdmissionToken,at:number):boolean{
  const scope=this.active;if(!scope||scope.token!==token)return false;
  if(!uint(at)||at<scope.lastAt||at<this.lastObservedAt||at>token.deadlineAt){this.active=null;return false;}
  scope.lastAt=at;this.lastObservedAt=at;return true;
 }
 remaining(token:NativePaperEntryAdmissionToken,at:number):number{
  return this.valid(token,at)?this.active!.limit-this.active!.spent:0;
 }
 /** The caller supplies exactly one charged-unit delta per RPC call. The
  * authoritative counter may charge an uninvoked conservative reservation.
  * Such a charge remains consumed; zero is permitted only for an actual zero
  * counter delta. This scope does not claim provider receipt or refund units. */
 recordAccountedStarts(token:NativePaperEntryAdmissionToken,count:number,at:number):boolean{
  if(!this.valid(token,at))return false;
  const scope=this.active!;
  if(!uint(count)||count>scope.limit-scope.spent){this.active=null;return false;}
  scope.spent+=count;return true;
 }
 close(token:NativePaperEntryAdmissionToken):boolean{
  if(this.active?.token!==token)return false;this.active=null;return true;
 }
 view(token:NativePaperEntryAdmissionToken,at:number){
  if(!this.valid(token,at))return null;
  return {...token,limit:this.active!.limit,spent:this.active!.spent,remaining:this.active!.limit-this.active!.spent};
 }
}
