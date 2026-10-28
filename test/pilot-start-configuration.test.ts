/** Constructor-level integration of real launcher bounds. No live sockets or ledger. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PilotFeeds,PILOT_FEED_MAXIMUM_RECORDED_BYTES,type PilotFeedsOptions,type PilotFeedDependencies} from '../src/pilot-feeds.js';
import {PILOT_EVIDENCE_LIMITS,resolvePilotStage} from '../src/pilot.js';

test('actual six-slot frozen launch accepts its finite retention policy before any network operation',async()=>{
 const stage=resolvePilotStage('three',undefined,6);let physical=0;
 const options:PilotFeedsOptions={control:{async operateData(){physical++;throw Error('fixture prohibits network');},accountControlBytes(){throw Error('no receipt without connection');},noteThrottle(){throw Error('no provider without connection');}},amountConvention:'curve',maximumCandidates:stage.maximumCandidates,durationMs:900000,maxPumpApiBytes:1024*1024*1024,maxDiscoveryBytes:5*1024*1024,maximumRecordedBytes:PILOT_EVIDENCE_LIMITS.feedHardBytes,record(){},onMigration(){},onTrade(){},onGap(){}};
 const dependencies:PilotFeedDependencies={now:()=>100000,monotonic:()=>0,setTimer:()=>0,clearTimer(){},makeSocket(){physical++;throw Error('fixture prohibits network');}};
 const feeds=new PilotFeeds(options,dependencies);assert.equal(PILOT_EVIDENCE_LIMITS.feedHardBytes,PILOT_FEED_MAXIMUM_RECORDED_BYTES);assert.equal(feeds.usage().recordedBytes,0);assert.equal(physical,0);await feeds.stop();assert.equal(physical,0);
 assert.throws(()=>new PilotFeeds({...options,maximumRecordedBytes:PILOT_FEED_MAXIMUM_RECORDED_BYTES+1},dependencies),/INVALID_LIMITS/);
});
