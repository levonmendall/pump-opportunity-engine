import type {UsdPrice} from './ledger.js';

export type PublicUsdPriceObservation={source:'coinbase-public-sol-usd';startedAt:number;completedAt:number;durationMs:number;outcome:'received'|'unavailable';reasonCode:'USD_PRICE_RECEIVED'|'USD_PRICE_HTTP_STATUS'|'USD_PRICE_TIMEOUT'|'USD_PRICE_TRANSPORT'|'USD_PRICE_RESPONSE_TOO_LARGE'|'USD_PRICE_EMPTY'|'USD_PRICE_INVALID'|'USD_PRICE_NONPOSITIVE';httpStatus:number|null;receivedAt:number|null;publicationTimeKnown:false};

// Public USD valuation only. This client has no authentication, wallet, order,
// arbitrary-URL or trade/submission method. Receive time is not an oracle timestamp.
export async function fetchPublicUsdPrice(transport:typeof fetch=fetch,observe?:(fact:PublicUsdPriceObservation)=>void):Promise<UsdPrice>{
  const startedAt=Date.now(),mono=performance.now();let httpStatus:number|null=null,reasonCode:PublicUsdPriceObservation['reasonCode']='USD_PRICE_TRANSPORT';
  const publish=(outcome:PublicUsdPriceObservation['outcome'],receivedAt:number|null)=>{try{observe?.({source:'coinbase-public-sol-usd',startedAt,completedAt:Date.now(),durationMs:Math.max(0,performance.now()-mono),outcome,reasonCode,httpStatus,receivedAt,publicationTimeKnown:false});}catch{/* Disposable telemetry cannot invalidate an independently valid price. */}};
  try{
  const response=await transport('https://api.coinbase.com/v2/prices/SOL-USD/spot',{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(4000)});
  httpStatus=response.status;
  if(!response.ok){reasonCode='USD_PRICE_HTTP_STATUS';await response.body?.cancel();throw new Error('USD_PRICE_UNAVAILABLE');}
  if(Number(response.headers.get('content-length'))>2048){reasonCode='USD_PRICE_RESPONSE_TOO_LARGE';await response.body?.cancel();throw new Error('USD_PRICE_RESPONSE_TOO_LARGE');}
  const reader=response.body?.getReader();if(!reader){reasonCode='USD_PRICE_EMPTY';throw new Error('USD_PRICE_EMPTY');}
  let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const row=await reader.read();if(row.done)break;size+=row.value.length;if(size>2048){reasonCode='USD_PRICE_RESPONSE_TOO_LARGE';await reader.cancel();throw new Error('USD_PRICE_RESPONSE_TOO_LARGE');}chunks.push(row.value);}}finally{reader.releaseLock();}
  reasonCode='USD_PRICE_INVALID';
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8')).data;
  if(data?.base!=='SOL'||data?.currency!=='USD'||typeof data.amount!=='string'||!/^\d{1,7}(?:\.\d{1,12})?$/.test(data.amount))throw new Error('USD_PRICE_INVALID');
  const [whole,fraction='']=data.amount.split('.');
  const amount=BigInt(whole)*1_000_000n+BigInt((fraction+'000000').slice(0,6));
  if(amount<=0n){reasonCode='USD_PRICE_NONPOSITIVE';throw new Error('USD_PRICE_NONPOSITIVE');}
  const price={microUsdPerSol:amount.toString(),at:Date.now(),source:'Coinbase public SOL-USD spot; application receive time, not guaranteed oracle publication time'};
  reasonCode='USD_PRICE_RECEIVED';publish('received',price.at);return price;
  }catch(error){if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))reasonCode='USD_PRICE_TIMEOUT';publish('unavailable',null);throw error;}
}
