import {fileURLToPath} from 'node:url';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,relative,resolve} from 'node:path';
import {createECDH} from 'node:crypto';

export const ORGANIZATION_ID=process.env.TURNKEY_ORGANIZATION_ID??'00000000-0000-0000-0000-000000000000';
export function existingApiCredentials(env=process.env){
  let apiPublicKey=env.TURNKEY_API_PUBLIC_KEY,apiPrivateKey=env.TURNKEY_API_PRIVATE_KEY;
  let binding={kind:'raw-runtime-variable',publicKeyBinding:'TURNKEY_API_PUBLIC_KEY',privateKeyBinding:'TURNKEY_API_PRIVATE_KEY'};
  if(env.TURNKEY_API_KEY_FILE){
    const path=resolve(env.TURNKEY_API_KEY_FILE),file=lstatSync(path),parent=lstatSync(dirname(path));
    const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),r=relative(repo,realpathSync(path));
    if(!file.isFile()||file.isSymbolicLink()||file.uid!==process.getuid()||(file.mode&0o077)!==0||file.size>8192||!parent.isDirectory()||parent.uid!==process.getuid()||(parent.mode&0o077)!==0||!(r==='..'||r.startsWith('../')))throw new Error('TURNKEY_SECRET_FILE_PERMISSIONS_OR_LOCATION_INVALID');
    const data=JSON.parse(readFileSync(path,'utf8'));apiPublicKey=data.apiPublicKey;apiPrivateKey=data.apiPrivateKey;
    binding={kind:'raw-secret-file',publicKeyBinding:'TURNKEY_API_KEY_FILE:apiPublicKey',privateKeyBinding:'TURNKEY_API_KEY_FILE:apiPrivateKey'};
  }
  if(!apiPublicKey||!apiPrivateKey)throw new Error('TURNKEY_AUTHENTICATION_BINDING_UNAVAILABLE');
  if(typeof apiPublicKey!=='string'||typeof apiPrivateKey!=='string')throw new Error('TURNKEY_RAW_CREDENTIAL_MATERIAL_UNAVAILABLE');
  apiPublicKey=apiPublicKey.replace(/^0x/,'');apiPrivateKey=apiPrivateKey.replace(/^0x/,'');
  if(!/^[a-f0-9]{64}$/i.test(apiPrivateKey)||!/^([a-f0-9]{66}|[a-f0-9]{130})$/i.test(apiPublicKey))throw new Error('TURNKEY_RAW_CREDENTIAL_MATERIAL_UNAVAILABLE');
  try{const key=createECDH('prime256v1');key.setPrivateKey(Buffer.from(apiPrivateKey,'hex'));if(key.getPublicKey('hex',apiPublicKey.length===66?'compressed':'uncompressed').toLowerCase()!==apiPublicKey.toLowerCase())throw new Error();}catch{throw new Error('TURNKEY_API_AUTH_KEY_PAIR_MISMATCH');}
  return {apiPublicKey,apiPrivateKey,binding};
}
// This is a one-off use of the existing authentication binding, not a wallet
// integration in the trader. No signing/export/submission method is invoked.
export async function listSolanaAccounts(getWalletAccounts,{limit=100,maxPages=100}={}){
  const all=new Map();let after;
  for(let page=0;page<maxPages;page++){
    const response=await getWalletAccounts({organizationId:ORGANIZATION_ID,includeWalletDetails:true,paginationOptions:{limit:String(limit),...(after?{after}:{})}});
    if(!response||!Array.isArray(response.accounts))throw new Error('TURNKEY_INVALID_RESPONSE');
    if(response.accounts.length===0)return [...all.values()].filter(a=>a.addressFormat==='ADDRESS_FORMAT_SOLANA');
    for(const account of response.accounts){
      if(typeof account.walletAccountId!=='string'||!account.walletAccountId||account.organizationId!==ORGANIZATION_ID||typeof account.address!=='string')throw new Error('TURNKEY_INVALID_ACCOUNT_IDENTITY');
      if(all.has(account.walletAccountId))throw new Error('TURNKEY_PAGINATION_OVERLAP');
      all.set(account.walletAccountId,{walletAccountId:account.walletAccountId,walletId:account.walletId,organizationId:account.organizationId,address:account.address,addressFormat:account.addressFormat,curve:account.curve});
    }
    const next=response.accounts.at(-1).walletAccountId;
    if(next===after)throw new Error('TURNKEY_PAGINATION_STALLED');
    after=next;
    // Continue even for a short page: do not infer the provider's effective cap.
  }
  throw new Error('TURNKEY_DISCOVERY_CAP_REACHED_NOT_COMPLETE');
}
export function readOnlyFetch(transport){
  return async(input,init={})=>{
    const url=String(input instanceof Request?input.url:input);
    if(url!=='https://api.turnkey.com/public/v1/query/list_wallet_accounts'||init.method!=='POST')throw new Error('TURNKEY_READ_ONLY_ENDPOINT_DENIED');
    const body=JSON.parse(String(init.body));
    if(body.organizationId!==ORGANIZATION_ID||body.walletId!==undefined||body.includeWalletDetails!==true)throw new Error('TURNKEY_READ_ONLY_QUERY_DENIED');
    return transport(input,{...init,redirect:'error',signal:AbortSignal.timeout(12000)});
  };
}
export async function nativeSolBalances(accounts,transport=fetch){
  let id=0;
  const rpc=async(method,params)=>{
    const requestId=++id;
    const response=await transport('https://api.mainnet.solana.com',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),redirect:'error',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('TURNKEY_BALANCE_RPC_UNAVAILABLE');
    if(Number(response.headers.get('content-length'))>200000){await response.body?.cancel();throw new Error('TURNKEY_BALANCE_RESPONSE_TOO_LARGE');}
    const reader=response.body?.getReader();if(!reader)throw new Error('TURNKEY_BALANCE_RESPONSE_EMPTY');
    let size=0;const chunks=[];
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>200000){await reader.cancel();throw new Error('TURNKEY_BALANCE_RESPONSE_TOO_LARGE');}chunks.push(part.value);}}finally{reader.releaseLock();}
    const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(data.id!==requestId||data.jsonrpc!=='2.0'||data.error)throw new Error('TURNKEY_BALANCE_RPC_ERROR');
    return data.result;
  };
  if(await rpc('getGenesisHash',[])!=='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')throw new Error('TURNKEY_BALANCE_WRONG_CLUSTER');
  const rows=[];
  for(let offset=0;offset<accounts.length;offset+=100){
    const batch=accounts.slice(offset,offset+100);
    if(batch.some(a=>a.curve!=='CURVE_ED25519'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a.address)))throw new Error('TURNKEY_UNSUPPORTED_SOLANA_ACCOUNT');
    const result=await rpc('getMultipleAccounts',[batch.map(a=>a.address),{commitment:'confirmed',encoding:'base64',dataSlice:{offset:0,length:0}}]);
    if(!result?.context||!Array.isArray(result.value)||result.value.length!==batch.length)throw new Error('TURNKEY_BALANCE_INVALID_CONTEXT');
    result.value.forEach((value,index)=>{
      const lamports=value?.lamports??0;
      if(!Number.isSafeInteger(lamports)||lamports<0)throw new Error('TURNKEY_BALANCE_INTEGER_UNSUPPORTED');
      const ordinary=value===null||(value.owner==='11111111111111111111111111111111'&&value.executable===false&&value.space===0);
      const n=BigInt(lamports);
      rows.push({...batch[index],nativeLamports:n.toString(),nativeSol:`${n/1000000000n}.${(n%1000000000n).toString().padStart(9,'0')}`,availableForSimpleTransferLamports:ordinary?n.toString():null,slot:result.context.slot,commitment:'confirmed',checkedAt:new Date().toISOString()});
    });
    if(offset+100<accounts.length)await new Promise(resolve=>setTimeout(resolve,500));
  }
  return rows;
}
async function run(){
  if(!process.env.TURNKEY_ORGANIZATION_ID||!/^[-a-f0-9]{36}$/i.test(ORGANIZATION_ID))throw new Error('TURNKEY_ORGANIZATION_CONFIGURATION_REQUIRED');
  let credentials;
  try{credentials=existingApiCredentials();}
  catch(error){const status=error instanceof Error&&/^TURNKEY_[A-Z_]+$/.test(error.message)?error.message:'TURNKEY_CREDENTIAL_CONFIGURATION_INVALID';console.log(JSON.stringify({status,organizationId:ORGANIZATION_ID,rawSecretFileConfigured:!!process.env.TURNKEY_API_KEY_FILE,requiredRawBindings:['TURNKEY_API_KEY_FILE (raw protected JSON file)','or raw TURNKEY_API_PUBLIC_KEY plus TURNKEY_API_PRIVATE_KEY'],queriesAttempted:0,credentialValuesDisplayed:false,transactionSigningOrBroadcast:false}));process.exitCode=2;return;}
  const actualFetch=globalThis.fetch;
  globalThis.fetch=readOnlyFetch(actualFetch);
  try{
    const {Turnkey}=await import('@turnkey/sdk-server');
    const client=new Turnkey({apiBaseUrl:'https://api.turnkey.com',defaultOrganizationId:ORGANIZATION_ID,apiPublicKey:credentials.apiPublicKey,apiPrivateKey:credentials.apiPrivateKey}).apiClient();
    const accounts=await nativeSolBalances(await listSolanaAccounts(input=>client.getWalletAccounts(input)),actualFetch);
    const funded=accounts.filter(a=>a.availableForSimpleTransferLamports!==null&&BigInt(a.availableForSimpleTransferLamports)>=60005000n);
    console.log(JSON.stringify({status:'READ_ONLY_IDENTIFICATION_COMPLETE',organizationId:ORGANIZATION_ID,binding:credentials.binding,accounts,sourceSelection:funded.length===1?'single-sufficient-source-candidate-requires-fresh-fee-and-owner-approval':funded.length>1?'owner-selection-required':'no-sufficient-verified-simple-transfer-source',transactionSigningOrBroadcast:false}));
  }catch(error){
    // SDK errors may embed credentials or stamped payloads. Never log them.
    const code=error instanceof Error&&/^TURNKEY_[A-Z_]+$/.test(error.message)?error.message:'TURNKEY_AUTH_OR_QUERY_FAILED';
    console.log(JSON.stringify({status:code,organizationId:ORGANIZATION_ID,secretDetailsSuppressed:true,transactionSigningOrBroadcast:false}));process.exitCode=2;
  }finally{globalThis.fetch=actualFetch;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1])await run();
