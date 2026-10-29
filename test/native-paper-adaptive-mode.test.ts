/** OFFLINE strategy selection and evidence admission. No provider, operating
 * account, financial writer or network call is made by the CLI/config checks. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseNativePaperArgs,nativePaperConfigurationSha256,resolveNativePaperStrategy} from '../src/run-native-paper.js';
import {ADAPTIVE_PILOT_BINDING,ADAPTIVE_PILOT_CONTRACT_SHA256} from '../src/pilot-contract.js';
import {NATIVE_PAPER_DATA_CONTRACT_VERSION} from '../src/native-paper-contract.js';
const base=['--resume','--directory','/OFFLINE-no-account','--input','/OFFLINE-no-input','--paper-contract',NATIVE_PAPER_DATA_CONTRACT_VERSION];

test('active adaptive native mode is explicit, versioned, two positions and four deep slots',()=>{
 const args=parseNativePaperArgs([...base,'--service','--strategy','adaptive-momentum-v2','--stage','two']);
 assert.equal(args.strategy,'adaptive-momentum-v2');assert.equal(args.stage,'two');assert.equal(args.deepSlots,4);assert.equal(args.service,true);assert.equal(args.durationMs,undefined);
 const selected=resolveNativePaperStrategy(args.stage,args.strategy);
 assert.deepEqual(selected.binding,ADAPTIVE_PILOT_BINDING);assert.equal(selected.binding.maxPositions,2);assert.equal(selected.contract.version,'adaptive-momentum-v2-paper-v1');assert.equal(selected.contractSha256,ADAPTIVE_PILOT_CONTRACT_SHA256);
 const hash=nativePaperConfigurationSha256(args);assert.match(hash,/^[a-f0-9]{64}$/);assert.notEqual(hash,nativePaperConfigurationSha256({service:true,stage:'two',deepSlots:4}));
});

test('baseline rollback selection and its configuration remain unchanged when strategy is omitted',()=>{
 const old=parseNativePaperArgs([...base,'--stage','two','--deep-slots','4','--service']);
 assert.equal(Object.hasOwn(old,'strategy'),false);assert.equal(resolveNativePaperStrategy('two').contract.version,'persistent-buying-pilot-concurrent-stage-2-v1');
 assert.equal(nativePaperConfigurationSha256(old),nativePaperConfigurationSha256({...old,strategy:'baseline'}));
 assert.equal(nativePaperConfigurationSha256(old),'7e1d449a053a8cad89ff7b5e9dc84c01f118cbeeeaeea9958473b75f6a547292');
});

test('unknown or mismatched adaptive strategy controls refuse before account access',()=>{
 for(const stage of ['single','shadow','three'])assert.throws(()=>parseNativePaperArgs([...base,'--strategy','adaptive-momentum-v2','--stage',stage]),/NATIVE_PAPER_ADAPTIVE_REQUIRES_TWO_POSITION_STAGE/);
 assert.throws(()=>parseNativePaperArgs([...base,'--strategy','live-money','--stage','two']),/NATIVE_PAPER_STRATEGY/);
 assert.throws(()=>nativePaperConfigurationSha256({strategy:'adaptive-momentum-v2',stage:'two',deepSlots:6}),/NATIVE_PAPER_ADAPTIVE_REQUIRES_FOUR_DEEP_SLOTS/);
 assert.throws(()=>nativePaperConfigurationSha256({strategy:'adaptive-momentum-v2',stage:'two',deepSlots:3}),/NATIVE_PAPER_ADAPTIVE_REQUIRES_FOUR_DEEP_SLOTS/);
 assert.throws(()=>parseNativePaperArgs([...base,'--strategy','adaptive-momentum-v2','--strategy','adaptive-momentum-v2','--stage','two']),/NATIVE_PAPER_UNKNOWN_OR_DUPLICATE_ARGUMENT/);
});
