import {test} from 'node:test';import assert from 'node:assert/strict';
import {listSolanaAccounts,readOnlyFetch,nativeSolBalances,existingApiCredentials,ORGANIZATION_ID} from './discover.mjs';
import {createECDH} from 'node:crypto';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const account=(id,format='ADDRESS_FORMAT_SOLANA')=>({walletAccountId:id,walletId:'fixture-wallet',organizationId:ORGANIZATION_ID,address:'fixture-public-'+id,addressFormat:format,curve:'CURVE_ED25519',walletDetails:{walletName:'not-exported'}});
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
test('read-only transport denies Turnkey transaction signing, secret export and all submissions',async()=>{
  let sent=0;const transport=readOnlyFetch(async()=>{sent++;return new Response('{}');});
  for(const path of ['submit/sign_transaction','submit/sign_raw_payload','submit/export_wallet','query/get_private_key'])await assert.rejects(transport('https://api.turnkey.com/public/v1/'+path,{method:'POST',body:'{}'}),/DENIED/);
  assert.equal(sent,0);
  await transport('https://api.turnkey.com/public/v1/query/list_wallet_accounts',{method:'POST',body:JSON.stringify({organizationId:ORGANIZATION_ID,includeWalletDetails:true})});assert.equal(sent,1);
});
test('installed SDK query uses the guarded transport and its submission method cannot reach network',async()=>{
  const {TurnkeyServerClient}=await import('@turnkey/sdk-server');
  let sent=0;const original=globalThis.fetch;
  globalThis.fetch=readOnlyFetch(async(_url,init)=>{sent++;assert.equal(init.redirect,'error');return new Response(JSON.stringify({accounts:[]}));});
  try{
    const client=new TurnkeyServerClient({apiBaseUrl:'https://api.turnkey.com',organizationId:ORGANIZATION_ID,stamper:{stamp:async()=>({stampHeaderName:'X-Fixture-Stamp',stampHeaderValue:'fixture-not-authenticated'})}});
    assert.deepEqual(await listSolanaAccounts(q=>client.getWalletAccounts(q)),[]);assert.equal(sent,1);
    await assert.rejects(client.signRawPayload({organizationId:ORGANIZATION_ID,parameters:{}}),/ENDPOINT_DENIED/);assert.equal(sent,1);
  }finally{globalThis.fetch=original;}
});
test('native SOL checks verify mainnet and do not conflate nonce/program lamports with available transfer cash',async()=>{
  const rows=await nativeSolBalances([{...account('1'),address:'6BajxF2CSXTCv5F1HdYH9SFNkqJT94AMW9cCfUq8sSTQ'},{...account('2'),address:'11111111111111111111111111111111'}],async(_url,init)=>{
    const body=JSON.parse(init.body);assert.ok(['getGenesisHash','getMultipleAccounts'].includes(body.method));
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result:body.method==='getGenesisHash'?'5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d':{context:{slot:123},value:[{lamports:100000000,owner:'11111111111111111111111111111111',executable:false,space:0},{lamports:80000000,owner:'11111111111111111111111111111111',executable:false,space:80}]}}));
  });
  assert.equal(rows[0].nativeSol,'0.100000000');assert.equal(rows[0].availableForSimpleTransferLamports,'100000000');assert.equal(rows[1].availableForSimpleTransferLamports,null);
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
