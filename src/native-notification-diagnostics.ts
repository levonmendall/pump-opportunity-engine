/** Bounded shape information about a refused provider payload. Labels and
 * discriminators are observations only: without a canonical identity they
 * cannot establish execution, economic harmlessness, or an audit boundary. */
import {createHash} from 'node:crypto';
import {PUMP_AMM_PROGRAM_ID} from './sdk.js';

const AMM=PUMP_AMM_PROGRAM_ID.toBase58();
const SWAPS=new Set(['Buy','BuyExactQuoteIn','BuyV2','BuyExactQuoteInV2','Sell','SellV2','MultiHopSwap']);
export const NATIVE_REFUSED_NOTIFICATION_DIAGNOSTICS=Object.freeze({version:'native-refused-log-shape-v1',maximumLines:4096,maximumLineBytes:32768,maximumTextBytes:512*1024,maximumDiscriminators:8});
export function nativeRefusedLogShape(logs:unknown){
 const limits=NATIVE_REFUSED_NOTIFICATION_DIAGNOSTICS;
 const result={version:limits.version,meaning:'UNVERIFIED_LOG_SHAPE' as const,economicMeaningEstablished:false as const,qualificationEvidence:false as const,
  envelopeWithinBounds:false,logLines:Array.isArray(logs)?logs.length:null,logTextBytes:0,truncationMarker:false,
  invocationStack:'unavailable' as 'unavailable'|'complete'|'incomplete'|'malformed',invocations:0,ammInvocations:0,
  swapInstructionMarkers:0,boostInstructionMarkers:0,otherAmmInstructionMarkers:0,otherInstructionMarkers:0,
  programDataRecords:0,eventDiscriminators:[] as string[],omittedDiscriminatorRecords:0};
 if(!Array.isArray(logs)||logs.length>limits.maximumLines)return result;
 for(const line of logs){if(typeof line!=='string')return result;const bytes=Buffer.byteLength(line);result.logTextBytes+=bytes;if(bytes>limits.maximumLineBytes||result.logTextBytes>limits.maximumTextBytes)return result;}
 result.envelopeWithinBounds=true;const stack:string[]=[],discriminators=new Set<string>();let malformed=false;
 for(const line of logs as string[]){
  result.truncationMarker||=/log.*truncat|truncat.*log/i.test(line);
  const invoke=/^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/.exec(line),end=/^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:.*)$/.exec(line);
  if(invoke){const depth=Number(invoke[2]);result.invocations++;if(invoke[1]===AMM)result.ammInvocations++;if(depth!==stack.length+1||depth>16){malformed=true;continue;}stack.push(invoke[1]!);continue;}
  if(end){if(stack.at(-1)!==end[1])malformed=true;else stack.pop();continue;}
  const label=/^Program log: Instruction: ([A-Za-z0-9_]{1,96})$/.exec(line);
  if(label){if(stack.at(-1)!==AMM)result.otherInstructionMarkers++;else if(SWAPS.has(label[1]!))result.swapInstructionMarkers++;else if(label[1]==='BoostBuyAndBurn')result.boostInstructionMarkers++;else result.otherAmmInstructionMarkers++;}
  if(line.startsWith('Program data: ')){
   result.programDataRecords++;const encoded=line.slice(14);
   if(/^[A-Za-z0-9+/]{11,}={0,2}$/.test(encoded)&&encoded.length%4===0){const bytes=Buffer.from(encoded,'base64');if(bytes.length>=8){const discriminator=bytes.subarray(0,8).toString('hex');if(!discriminators.has(discriminator)){if(discriminators.size<limits.maximumDiscriminators){discriminators.add(discriminator);result.eventDiscriminators.push(discriminator);}else result.omittedDiscriminatorRecords++;}}}
  }
 }
 result.invocationStack=malformed?'malformed':stack.length?'incomplete':'complete';return result;
}
export function nativeRefusedLogShapeKey(shape:ReturnType<typeof nativeRefusedLogShape>){
 return createHash('sha256').update(JSON.stringify({envelopeWithinBounds:shape.envelopeWithinBounds,truncationMarker:shape.truncationMarker,invocationStack:shape.invocationStack,
  swap:shape.swapInstructionMarkers>0,boost:shape.boostInstructionMarkers>0,otherAmm:shape.otherAmmInstructionMarkers>0,other:shape.otherInstructionMarkers>0,
  eventDiscriminators:shape.eventDiscriminators,omittedDiscriminatorRecords:shape.omittedDiscriminatorRecords>0})).digest('hex');
}
