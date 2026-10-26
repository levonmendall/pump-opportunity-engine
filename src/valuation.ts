import type {UsdPrice} from './ledger.js';

// Public USD valuation only. This client has no authentication, wallet, order,
// arbitrary-URL or trade/submission method. Receive time is not an oracle timestamp.
export async function fetchPublicUsdPrice(transport:typeof fetch=fetch):Promise<UsdPrice>{
  const response=await transport('https://api.coinbase.com/v2/prices/SOL-USD/spot',{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(4000)});
  if(!response.ok)throw new Error('USD_PRICE_UNAVAILABLE');
  if(Number(response.headers.get('content-length'))>2048){await response.body?.cancel();throw new Error('USD_PRICE_RESPONSE_TOO_LARGE');}
  const reader=response.body?.getReader();if(!reader)throw new Error('USD_PRICE_EMPTY');
  let size=0;const chunks:Uint8Array[]=[];
  try{for(;;){const row=await reader.read();if(row.done)break;size+=row.value.length;if(size>2048){await reader.cancel();throw new Error('USD_PRICE_RESPONSE_TOO_LARGE');}chunks.push(row.value);}}finally{reader.releaseLock();}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8')).data;
  if(data?.base!=='SOL'||data?.currency!=='USD'||typeof data.amount!=='string'||!/^\d{1,7}(?:\.\d{1,12})?$/.test(data.amount))throw new Error('USD_PRICE_INVALID');
  const [whole,fraction='']=data.amount.split('.');
  const amount=BigInt(whole)*1_000_000n+BigInt((fraction+'000000').slice(0,6));
  if(amount<=0n)throw new Error('USD_PRICE_NONPOSITIVE');
  return {microUsdPerSol:amount.toString(),at:Date.now(),source:'Coinbase public SOL-USD spot; application receive time, not guaranteed oracle publication time'};
}
