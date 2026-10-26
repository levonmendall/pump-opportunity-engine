import {test} from 'node:test';import assert from 'node:assert/strict';
import {listSolanaAccounts,listStandaloneSolanaAccounts,discoverSolanaAccounts,readOnlyFetch,nativeSolBalances,existingApiCredentials,ORGANIZATION_ID,DISCOVERY_LIMITS} from './discover.mjs';
import {createECDH} from 'node:crypto';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const account=(id,format='ADDRESS_FORMAT_SOLANA')=>({walletAccountId:id,walletId:'fixture-wallet',organizationId:ORGANIZATION_ID,address:'fixture-public-'+id,addressFormat:format,curve:'CURVE_ED25519',walletDetails:{walletName:'not-exported'}});
const metadata=(id='fixture-key',address='11111111111111111111111111111111')=>({privateKeyId:id,curve:'CURVE_ED25519',publicKey:'fixture-public-component',privateKeyName:'not-exported',addresses:[{format:'ADDRESS_FORMAT_SOLANA',address}],privateKeyTags:['not-exported'],imported:true,exported:false});
test('organization-wide enumeration omits walletId, includes details and paginates past short pages',async()=>{
  const calls=[];const pages=[[account('1')],[account('2','ADDRESS_FORMAT_ETHEREUM')],[account('3')],[]];
  const result=await listSolanaAccounts(async q=>{calls.push(q);return {accounts:pages.shift()};},{limit:100});
  assert.deepEqual(result.map(x=>x.walletAccountId),['1','3']);assert.equal(calls.length,4);
  assert.ok(calls.every(x=>x.organizationId===ORGANIZATION_ID&&x.includeWalletDetails&&!('walletId'in x)));
  assert.equal(calls[1].paginationOptions.after,'1');assert.ok(!('walletDetails'in result[0]));
});
test('ambiguous accounts stay separate and incomplete/repeating pagination is refused',async()=>{
  let page=0;const two=await listSolanaAccounts(async()=>({accounts:page++===0?[account('1'),account('2')]:[]}));assert.equal(two.length,2);
  await assert.rejects(listSolanaAccounts(async()=>({accounts:[account('1')]})),/OVERLAP/);
  await assert.rejects(listSolanaAccounts(async()=>({accounts:[account('1')]}),{maxPages:1}),/NOT_COMPLETE/);
});
test('standalone metadata fallback only follows complete zero-Solana wallet enumeration',async()=>{
  const calls=[];let page=0;
  const client={getWalletAccounts:async query=>{calls.push(['wallet',query]);return {accounts:page++===0?[account('eth','ADDRESS_FORMAT_ETHEREUM')]:[]};},getPrivateKeys:async query=>{calls.push(['metadata',query]);return {privateKeys:[metadata(),{...metadata('unsupported'),curve:'CURVE_SECP256K1'},{...metadata('eth-only'),addresses:[{format:'ADDRESS_FORMAT_ETHEREUM',address:'fixture-eth'}]}]};}};
  const result=await discoverSolanaAccounts(client);
  assert.equal(result.metadataFallbackUsed,true);assert.equal(calls.length,3);assert.deepEqual(calls[2],['metadata',{organizationId:ORGANIZATION_ID}]);
  assert.deepEqual(result.accounts,[{sourceKind:'standalone-key-public-metadata',privateKeyId:'fixture-key',organizationId:ORGANIZATION_ID,address:'11111111111111111111111111111111',addressFormat:'ADDRESS_FORMAT_SOLANA',curve:'CURVE_ED25519'}]);
  assert.ok(!JSON.stringify(result).includes('not-exported'));assert.ok(!JSON.stringify(result).includes('fixture-public-component'));
  page=0;let fallbackCalls=0;
  const wallet=await discoverSolanaAccounts({getWalletAccounts:async()=>({accounts:page++===0?[account('sol')]:[]}),getPrivateKeys:async()=>{fallbackCalls++;throw new Error('must not run');}});
  assert.equal(wallet.metadataFallbackUsed,false);assert.equal(wallet.accounts[0].sourceKind,'wallet-account');assert.equal(fallbackCalls,0);
  await assert.rejects(discoverSolanaAccounts({getWalletAccounts:async()=>({accounts:[account('repeated')]}),getPrivateKeys:async()=>{fallbackCalls++;return {privateKeys:[]};}}),/OVERLAP/);assert.equal(fallbackCalls,0);
});
test('metadata and wallet candidate bounds reject partial discovery and malformed Solana identities',async()=>{
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[metadata('1'),metadata('2')]}),{maxKeys:1}),/METADATA_CAP/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[metadata('1'),metadata('2')]}),{maxCandidates:1}),/CANDIDATE_CAP/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[metadata('1'),metadata('1')]})),/METADATA_IDENTITY/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[metadata('1','invalid-address')]})),/METADATA_ADDRESS/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[metadata('1','2'.repeat(32))]})),/METADATA_ADDRESS/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[{...metadata(),addresses:Array(DISCOVERY_LIMITS.addressesPerKey+1).fill({format:'ADDRESS_FORMAT_SOLANA',address:'11111111111111111111111111111111'})}]})),/METADATA_IDENTITY/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[{...metadata(),addresses:[...metadata().addresses,...metadata().addresses]}]})),/METADATA_ADDRESS/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:'invalid'})),/INVALID_METADATA_RESPONSE/);
  await assert.rejects(listStandaloneSolanaAccounts(async()=>({privateKeys:[]}),{maxCandidates:DISCOVERY_LIMITS.candidates+1}),/LIMIT_INVALID/);
  let page=0;await assert.rejects(listSolanaAccounts(async()=>({accounts:page++===0?[account('1'),account('2')]:[]}),{maxAccounts:1}),/ACCOUNT_CAP/);
  page=0;await assert.rejects(listSolanaAccounts(async()=>({accounts:page++===0?[account('1'),account('2')]:[]}),{maxCandidates:1}),/CANDIDATE_CAP/);
  await assert.rejects(listSolanaAccounts(async()=>({accounts:[account('1'),account('2')]}),{limit:1}),/INVALID_RESPONSE/);
});
test('read-only transport denies Turnkey transaction signing, secret export and all submissions',async()=>{
  let sent=0;const transport=readOnlyFetch(async()=>{sent++;return new Response('{}');});
  for(const path of ['submit/sign_transaction','submit/sign_raw_payload','submit/export_wallet','submit/export_private_key','submit/sol_send_transaction','query/get_private_key','query/list_secrets'])await assert.rejects(transport('https://api.turnkey.com/public/v1/'+path,{method:'POST',body:'{}'}),/DENIED/);
  assert.equal(sent,0);
  await transport('https://api.turnkey.com/public/v1/query/list_wallet_accounts',{method:'POST',body:JSON.stringify({organizationId:ORGANIZATION_ID,includeWalletDetails:true})});assert.equal(sent,1);
  await transport('https://api.turnkey.com/public/v1/query/list_private_keys',{method:'POST',body:JSON.stringify({organizationId:ORGANIZATION_ID})});assert.equal(sent,2);
});
test('per-endpoint query allowlist refuses extra fields, wrong organization and overlarge bodies',async()=>{
  let sent=0;const transport=readOnlyFetch(async()=>{sent++;return new Response('{}');});
  for(const body of [{organizationId:ORGANIZATION_ID,privateKeyId:'fixture-key'},{organizationId:ORGANIZATION_ID,includeWalletDetails:true},{organizationId:ORGANIZATION_ID,paginationOptions:{limit:'1'}},{organizationId:'wrong'},null])await assert.rejects(transport('https://api.turnkey.com/public/v1/query/list_private_keys',{method:'POST',body:JSON.stringify(body)}),/QUERY_DENIED/);
  for(const extra of [{walletId:'fixture-wallet'},{parameters:{}},{paginationOptions:{limit:'101'}},{paginationOptions:{limit:'100',before:'fixture'}},{paginationOptions:{limit:100}},{paginationOptions:{limit:'1',after:'x'.repeat(129)}}])await assert.rejects(transport('https://api.turnkey.com/public/v1/query/list_wallet_accounts',{method:'POST',body:JSON.stringify({organizationId:ORGANIZATION_ID,includeWalletDetails:true,...extra})}),/QUERY_DENIED/);
  for(const body of ['not json',' '.repeat(DISCOVERY_LIMITS.requestBytes+1)])await assert.rejects(transport('https://api.turnkey.com/public/v1/query/list_private_keys',{method:'POST',body}),/QUERY_DENIED/);
  for(const url of ['https://api.turnkey.com/public/v1/query/list_private_keys?export=true','https://api.turnkey.com.evil/public/v1/query/list_private_keys'])await assert.rejects(transport(url,{method:'POST',body:JSON.stringify({organizationId:ORGANIZATION_ID})}),/ENDPOINT_DENIED/);
  assert.equal(sent,0);
});
test('Turnkey responses are byte bounded even without a content-length header',async()=>{
  const query={method:'POST',body:JSON.stringify({organizationId:ORGANIZATION_ID})};
  await assert.rejects(readOnlyFetch(async()=>new Response('too large',{headers:{'content-length':String(DISCOVERY_LIMITS.responseBytes+1)}}))('https://api.turnkey.com/public/v1/query/list_private_keys',query),/RESPONSE_TOO_LARGE/);
  let cancelled=false;const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(DISCOVERY_LIMITS.responseBytes));controller.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  await assert.rejects(readOnlyFetch(async()=>new Response(body))('https://api.turnkey.com/public/v1/query/list_private_keys',query),/RESPONSE_TOO_LARGE/);assert.equal(cancelled,true);
});
test('installed SDK query uses the guarded transport and its submission method cannot reach network',async()=>{
  const {TurnkeyServerClient}=await import('@turnkey/sdk-server');
  let sent=0;const original=globalThis.fetch;
  globalThis.fetch=readOnlyFetch(async(url,init)=>{sent++;assert.equal(init.redirect,'error');return new Response(JSON.stringify(String(url).endsWith('list_private_keys')?{privateKeys:[metadata()]}:{accounts:[]}));});
  try{
    const client=new TurnkeyServerClient({apiBaseUrl:'https://api.turnkey.com',organizationId:ORGANIZATION_ID,stamper:{stamp:async()=>({stampHeaderName:'X-Fixture-Stamp',stampHeaderValue:'fixture-not-authenticated'})}});
    assert.deepEqual(await listSolanaAccounts(q=>client.getWalletAccounts(q)),[]);assert.equal(sent,1);
    assert.equal((await discoverSolanaAccounts(client)).accounts[0].sourceKind,'standalone-key-public-metadata');assert.equal(sent,3);
    for(const method of ['signRawPayload','signTransaction','exportPrivateKey','solSendTransaction'])await assert.rejects(client[method]({organizationId:ORGANIZATION_ID,parameters:{}}),/ENDPOINT_DENIED/);assert.equal(sent,3);
  }finally{globalThis.fetch=original;}
});
test('native SOL checks verify mainnet and do not conflate nonce/program lamports with available transfer cash',async()=>{
  const rows=await nativeSolBalances([{...account('1'),address:'6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ'},{...account('2'),address:'11111111111111111111111111111111'}],async(_url,init)=>{
    const body=JSON.parse(init.body);assert.ok(['getGenesisHash','getMultipleAccounts'].includes(body.method));
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='getGenesisHash'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d':{context:{slot:123},value:[{lamports:100000000,owner:'11111111111111111111111111111111',executable:false,space:0},{lamports:80000000,owner:'11111111111111111111111111111111',executable:false,space:80}]}}));
  });
  assert.equal(rows[0].nativeSol,'0.100000000');assert.equal(rows[0].availableForSimpleTransferLamports,'100000000');assert.equal(rows[1].availableForSimpleTransferLamports,null);
});
test('standalone metadata uses the same native-balance verifier and rejects excessive candidates before RPC',async()=>{
  const accounts=await listStandaloneSolanaAccounts(async()=>({privateKeys:[metadata()]}));let calls=0;
  const rows=await nativeSolBalances(accounts,async(_url,init)=>{calls++;const body=JSON.parse(init.body);return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='getGenesisHash'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d':{context:{slot:123},value:[null]}}));});
  assert.equal(rows[0].sourceKind,'standalone-key-public-metadata');assert.equal(rows[0].nativeLamports,'0');assert.equal(rows[0].availableForSimpleTransferLamports,'0');assert.equal(calls,2);
  await assert.rejects(nativeSolBalances(Array(DISCOVERY_LIMITS.candidates+1).fill(accounts[0]),async()=>{throw new Error('must not reach network');}),/CANDIDATE_CAP/);
});
test('raw credential availability rejects proxy placeholders and verifies a protected file without displaying values',()=>{
  assert.throws(()=>existingApiCredentials({TURNKEY_API_PUBLIC_KEY:'network-placeholder',TURNKEY_API_PRIVATE_KEY:'network-placeholder'}),/RAW_CREDENTIAL/);
  assert.throws(()=>existingApiCredentials({}),/BINDING_UNAVAILABLE/);
  const dir=mkdtempSync(join(tmpdir(),'poe-turnkey-fixture-'));chmodSync(dir,0o700);const path=join(dir,'auth.json');
  const fixture=createECDH('prime256v1');fixture.generateKeys();
  const data={apiPublicKey:fixture.getPublicKey('hex','compressed'),apiPrivateKey:fixture.getPrivateKey('hex')};
  try{
    writeFileSync(path,JSON.stringify(data),{mode:0o600});
    const configured=existingApiCredentials({TURNKEY_API_KEY_FILE:path});assert.equal(configured.binding.kind,'raw-secret-file');assert.equal(configured.apiPublicKey,data.apiPublicKey);
    chmodSync(path,0o644);assert.throws(()=>existingApiCredentials({TURNKEY_API_KEY_FILE:path}),/PERMISSIONS_OR_LOCATION/);
  }finally{rmSync(dir,{recursive:true});}
});
