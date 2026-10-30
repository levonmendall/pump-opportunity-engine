import{test}from'node:test';import assert from'node:assert/strict';
import{validateRpc}from'../src/network.js';
test('bounded origin recovery may read a finalized block but cannot simulate, sign or send',()=>{
 assert.doesNotThrow(()=>validateRpc({method:'getBlock',params:[123,{transactionDetails:'signatures',rewards:false,commitment:'finalized'}]}));
 for(const method of ['simulateTransaction','sendTransaction','sendRawTransaction','signTransaction','signAndSendTransaction','requestAirdrop','trade','getWalletAccounts'])assert.throws(()=>validateRpc({method}),/PAPER_RPC_METHOD_DENIED/);
});
