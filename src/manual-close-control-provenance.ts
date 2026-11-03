/** One authenticated historical restoration, never a pause-reason whitelist or
 * permission grant. The caller must first authenticate the complete ordered
 * journal/actions history and preserve every earlier owner, unknown or stop
 * barrier. Current protection, reconciliation and admission are separate. */
import {createHash} from 'node:crypto';
import type {LedgerState} from './ledger.js';

const sha = (value:string) => createHash('sha256').update(value).digest('hex');
type ControlRow = Readonly<{revision:number;actionId:string;at:number;kind:string;detail:string;payloadHash:string;result:string}>;
type RowPin = Readonly<Omit<ControlRow,'detail'|'result'> & {detailSha256:string;resultSha256:string}>;
const rowPin = <T extends RowPin>(value:T):Readonly<T> => Object.freeze(value);

/** Source: authenticated control export run41720510364, SHA a420aa2c53d9347ad59f2b9427c91b55bdf5b1721e31f9974e5ac8c6b96c0a96.
 * The exact sale-helper source below, manual-close.ts:105–106, first performs
 * ordinary execution recovery, then preserves inherited intent using
 * manual-hard:SHA256(JSON.stringify({id:orderId,revision:startup.revision})).
 * Its sealed receipt reports both prior recovery flags false and retains the
 * same technical reason. No entire success archive is embedded in runtime. */
export const REVIEWED_MANUAL_CLOSE_CONTROL_PROVENANCE = Object.freeze({
 version:'reviewed-manual-close-control-348004-v1',
 accountId:'poe-3123e352-4581-455b-85db-acd7e825e99e',inceptionAt:1793052456212,
 epochId:'poe-paper-10sol-v3-20261030',epochVersion:'poe-paper-epoch-v3',
 epochSha256:'f781b69b173c6808b226f643da2506788f413836f3114cee86be5b69f6295f1d',
 reason:'PAPER protection currently overdue; candidate admissions closed',
 helperSource:'a2d41ec0c1d5122598e139980263f18260eaf3c6',
 helperBundleSha256:'b4f902a24fb5fadd9cdd5e7ac184aa487bbbd8e12b84e3947aa3ab40a8d5c450',
 saleReceiptSha256:'d8aa6b01360db2cdfa99ba93b468e27fdaa2679b40e59acd1342df12ad64073b',
 authorizationId:'owner-forced-paper-close-20261103-v1',
 orderScope:'owner-authorized-one-use-paper-close',
 mint:'hj4HMwUZ3XwuxNcmMmav7nzUjWWXp3TbkYydC5Mpump',roundTripId:'buy:335058:1793704548604',
 orderId:'manual-close:3df5c5ce81759852d3a18901cb2570809d59e066e727fc9e21dc58c8dbfd5a5f',
 anchor:rowPin({revision:347894,at:1793730051048,kind:'resume',
  actionId:'native-paper-operating-financial-ready:347893:1793730051048',
  payloadHash:'e4894cf7d68adad2435c8324f706fbd873a04a03f94f2514db0b29d43c6bbfc4',
  detailSha256:'4e719068e419f04ddc7f763a2c4d21049e4f995e273d16a3e6a98d697e95fa06',
  resultSha256:'5754fd23c173fb2a38c68490039f8226cbeaf60fedeaf923e95d95282f94fd62'}),
 originalPause:rowPin({revision:347982,at:1793730244591,kind:'pause',
  actionId:'trader:pause:347981:1793730244592',
  payloadHash:'52c6b533dfe1926c79d0878a874f493fd65e77e007d4b0b8e2ceac4b0edd5084',
  detailSha256:'e15cebf3d68dbb1f04cb122672a631a581b9ba59a37191de5a47602a0374a61b',
  resultSha256:'7da234199217a93c78834b36a1f10a4a94adc700f133fffada0880b147d820c1'}),
 startup:rowPin({revision:348003,at:1793730308146,kind:'pause',
  actionId:'execution-recovery:poe-3123e352-4581-455b-85db-acd7e825e99e:348002',
  payloadHash:'5c621969ff2fbc7f78fdfcd873a1f049623ad483e177721da434adf3e6c2ff2f',
  detailSha256:'ae67899487744fdd9e6790cd8bf74ad857c8a72110abb0670c42bb635222eb0e',
  resultSha256:'7da234199217a93c78834b36a1f10a4a94adc700f133fffada0880b147d820c1'}),
 restoration:rowPin({revision:348004,at:1793730308156,kind:'pause',
  actionId:'manual-hard:788f82d8b8a774f9d479574c8c1313ce7f5474faf1ed0c19866eb6c11ade77de',
  payloadHash:'85e112582e8f8bfe326b92344309d08b7dd9f7fb8b2833eb2f87071bc0b6f1f9',
  detailSha256:'0e66894532ca2345864d4561f3865ea361f4fb0db9f3320726db9fc7d7e3f6e5',
  resultSha256:'7da234199217a93c78834b36a1f10a4a94adc700f133fffada0880b147d820c1'}),
 entryPermissionGranted:false,
} as const);

export type ManualCloseControlProvenanceInput = Readonly<{
 state:Readonly<Pick<LedgerState,'accountId'|'inceptionAt'|'mode'|'paperEpoch'|'revision'|'lastAt'>>;
 anchor:ControlRow|null|undefined;
 /** The active authenticated technical origin maintained by the ordered loop,
  * not a separately searched earlier matching row. */
 originalPause:ControlRow|null|undefined;
 previousControl:ControlRow|null|undefined;
 row:ControlRow|null|undefined;
}>;

function matches(row:ControlRow|null|undefined,pin:RowPin):boolean{
 return !!row&&row.revision===pin.revision&&row.at===pin.at&&row.kind===pin.kind
  &&row.actionId===pin.actionId&&row.payloadHash===pin.payloadHash
  &&typeof row.detail==='string'&&Buffer.byteLength(row.detail)<=65536&&sha(row.detail)===pin.detailSha256
  &&typeof row.result==='string'&&Buffer.byteLength(row.result)<=65536&&sha(row.result)===pin.resultSha256;
}

/** Recognize this original preservation as a restoration. The caller still
 * checks current reason, chronology, original originRevision, final control and
 * all later controls, and uses the unmodified original row in its authority
 * digest. This function performs no IO and never supplies readiness proof. */
export function isReviewedManualCloseControlRestoration(input:ManualCloseControlProvenanceInput):boolean{
 const p=REVIEWED_MANUAL_CLOSE_CONTROL_PROVENANCE;
 // Ordinary startup and unknown rows must not hash unrelated retained state.
 if(!matches(input.row,p.restoration))return false;
 const s=input.state;
 if(s.accountId!==p.accountId||s.inceptionAt!==p.inceptionAt||s.mode!=='PAPER'
  ||s.paperEpoch?.id!==p.epochId||s.paperEpoch.version!==p.epochVersion
  ||sha(JSON.stringify(s.paperEpoch))!==p.epochSha256
  ||!Number.isSafeInteger(s.revision)||s.revision<p.restoration.revision
  ||!Number.isSafeInteger(s.lastAt)||s.lastAt<p.restoration.at
  ||!matches(input.anchor,p.anchor)||!matches(input.originalPause,p.originalPause)
  ||!matches(input.previousControl,p.startup))return false;
 const orderId='manual-close:'+sha(JSON.stringify({scope:p.orderScope,authorizationId:p.authorizationId,
  accountId:p.accountId,inceptionAt:p.inceptionAt,epochId:p.epochId,mint:p.mint,roundTripId:p.roundTripId}));
 return orderId===p.orderId&&p.restoration.revision===p.startup.revision+1
  &&input.row!.actionId==='manual-hard:'+sha(JSON.stringify({id:orderId,revision:input.previousControl!.revision}));
}
