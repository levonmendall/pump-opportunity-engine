/** Offline counterfactual only. Reuses recorded action/availability times and
 * actual captured bytes; no networking, accounts, orders or financial writes. */
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync,writeFileSync,statSync,lstatSync} from 'node:fs';
import {join,resolve,relative,dirname,basename} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {ActivePipeline,type ActiveScope,type ActiveHint} from '../src/active-pipeline.js';

type RecordRow={kind:string;recordedAt:number;data:any};
type FixProof={transactions:Array<{signature:string;side:string;actualInstruction?:string;originalGapAt?:number;originalGapReason?:string;correctedOfflineMapping?:{transferChecks:{baseTransfer:boolean;userQuoteTransfer:boolean}}}>};
const need=(value:unknown,reason:string)=>{if(!value)throw Error('OFFLINE_REPLAY_'+reason);};
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');

export function replayOvernightCorrection(records:RecordRow[],scope:ActiveScope,fixProof:FixProof){
  const opens=records.filter(r=>r.kind==='research-pipeline-open'),ends=records.filter(r=>r.kind==='research-observation-end'),closes=records.filter(r=>r.kind==='research-pipeline-close');
  need(opens.length===1&&ends.length===1&&closes.length===1,'ONE_BOUNDED_OBSERVATION_REQUIRED');
  const openAt=opens[0]!.data.at,endAt=ends[0]!.data.at,closeAt=closes[0]!.data.at;
  const suppressible=new Set(fixProof.transactions.filter(t=>t.side==='buy'&&t.actualInstruction==='buy_exact_quote_in_v2'&&t.originalGapReason==='executed-transfer-or-feature-validation-unavailable'&&t.correctedOfflineMapping?.transferChecks.baseTransfer&&t.correctedOfflineMapping?.transferChecks.userQuoteTransfer).map(t=>t.originalGapAt));
  const timeline:Array<{at:number;index:number;kind:string;data:any}>=[],removedMappingGaps:RecordRow[]=[],outsideObservationQuotes:Array<{usedAt:number;reason:string}>=[];
  for(let i=0;i<records.length;i++){
    const row=records[i]!,d=row.data;
    if(row.kind==='research-pipeline-open')timeline.push({at:d.at,index:i,kind:'open',data:d});
    else if(row.kind==='selected-pumpapi-payload')timeline.push({at:d.receivedAt,index:i,kind:'observe',data:d});
    else if(row.kind==='confirmed-enrichment'){
      need(Number.isSafeInteger(d.requestedAt)&&Number.isSafeInteger(d.availableAt)&&d.requestedAt>=d.hint.receivedAt+1000&&d.availableAt>=d.requestedAt,'INVALID_ENRICHMENT_TIMING');
      timeline.push({at:d.requestedAt,index:i,kind:'start',data:d},{at:d.availableAt,index:i,kind:'complete',data:d});
    }else if(row.kind==='research-feature-view')timeline.push({at:d.at,index:i,kind:'tick',data:d});
    else if(row.kind==='combined-three-holding-evaluation'){
      if(d.usedAt<openAt||d.usedAt>endAt){outsideObservationQuotes.push({usedAt:d.usedAt,reason:'Outside original stream observation; never introduced into candidate or hypothetical entry state.'});continue;}
      const holding=d.holdings?.find((h:any)=>h.mint===scope.mint);need(holding?.quote,'SELECTED_QUOTE_MISSING');
      timeline.push({at:d.usedAt,index:i,kind:'price',data:{quote:holding.quote,units:holding.units}});
    }else if(row.kind==='research-quality-gap'){
      if(suppressible.has(d.at)&&d.reason==='executed-transfer-or-feature-validation-unavailable')removedMappingGaps.push(row);
      else timeline.push({at:d.at,index:i,kind:'gap',data:d});
    }else if(row.kind==='research-observation-end')timeline.push({at:d.at,index:i,kind:'end',data:d});
    else if(row.kind==='research-pipeline-close')timeline.push({at:d.at,index:i,kind:'close',data:d});
  }
  need(removedMappingGaps.length===suppressible.size,'CORRECTION_GAP_PROOF_MISMATCH');
  timeline.sort((a,b)=>a.at-b.at||a.index-b.index);need(timeline.every(r=>Number.isSafeInteger(r.at)&&r.at>=openAt&&r.at<=closeAt),'OUTSIDE_OR_INVALID_TIMELINE');
  // Historical feature request times are replay inputs, not a promise about
  // today's diagnostic recorder cadence. Evaluate every original sample even
  // when equivalent current diagnostics are coalesced.
  let now=openAt;const featureSamples:Array<NonNullable<ReturnType<ActivePipeline['snapshot']>['latestFeature']>>=[],emitted:RecordRow[]=[],core=new ActivePipeline({scope,now:()=>now,record:(kind,data)=>emitted.push({kind,recordedAt:now,data})}),active=new Map<string,ActiveHint>(),availability:Array<Record<string,unknown>>=[];
  for(const event of timeline){
    now=event.at;const d=event.data;
    switch(event.kind){
      case'open':core.open(now);break;
      case'observe':core.observe(JSON.parse(d.payloadUtf8),now);break;
      case'start':{const hint=core.nextHint(now);need(hint&&hint.signature===d.hint.signature&&hint.receivedAt===d.hint.receivedAt,'ORIGINAL_REQUEST_IDENTITY_MISMATCH');active.set(d.hint.signature,hint!);break;}
      case'complete':{const hint=active.get(d.hint.signature);need(hint,'NO_ORIGINAL_REQUEST_START');const rows=core.completeHint(hint!,d.transaction,now);active.delete(d.hint.signature);availability.push({signature:d.hint.signature,providerReceivedAt:d.hint.receivedAt,originalRequestedAt:d.requestedAt,confirmedAvailableAt:now,normalizedAvailableAt:now,normalizedEvents:rows.length,sides:rows.map(r=>r.side),allExecutedTransfersPass:rows.every(r=>r.transferChecks.baseTransfer&&r.transferChecks.userQuoteTransfer)});break;}
      case'tick':{core.tick(now);const feature=core.snapshot(now,{recordFeatures:false}).latestFeature;if(feature)featureSamples.push(feature);break;}
      case'price':need(String(d.units)===String(scope.baseUnits),'QUOTE_SIZE_CHANGED');core.price(d.quote,now);break;
      case'gap':core.gap(d.reason,now);break;
      case'end':core.endObservation(now,d.reason);break;
      case'close':core.close(now,d.reason);break;
    }
  }
  need(active.size===0,'UNRESOLVED_ORIGINAL_REQUEST');
  const state=core.snapshot(closeAt),unique=new Map<number,{firstAvailableAt:number;lastAvailableAt:number;samples:number;curve:unknown;user:unknown}>();
  for(const d of featureSamples){if(d.at>=endAt||!d.fullyEnriched||!d.curve.sufficientlyObserved||!d.user.sufficientlyObserved||!d.curve.tradeCount||!d.user.tradeCount)continue;
    const prior=unique.get(d.curve.windowEndAt);unique.set(d.curve.windowEndAt,{firstAvailableAt:prior?.firstAvailableAt??d.at,lastAvailableAt:d.at,samples:(prior?.samples??0)+1,curve:d.curve,user:d.user});
  }
  return {classification:'CORRECTED_COUNTERFACTUAL_CHRONOLOGICAL_REPLAY_NOT_FORWARD_ACCEPTANCE',openAt,endAt,closeAt,timelineEvents:timeline.length,excludedPrewarmOrPostwindowQuotes:outsideObservationQuotes,removedMappingGapsOnlyInCounterfactual:removedMappingGaps,informationAvailability:availability,normalizedEvents:state.normalizedEvents,normalizedBuys:state.normalizedBuys,normalizedSells:state.normalizedSells,failedTransactions:state.failedTransactions,pending:state.pending,remainingQualityGaps:state.qualityGaps,originalApplicationStopRetained:state.qualityGaps.some(g=>g.at===endAt&&g.reason==='COMPONENT_FIELD_APPLICATION_STOP'),rawEnrichedFeatureWarmSeconds:state.enrichedFeatureWarmSeconds,rawNoPendingFeatureWarmSeconds:state.noPendingFeatureWarmSeconds,uniqueCompleteClosedWindowEnds:[...unique].map(([windowEndAt,value])=>({windowEndAt,...value})),distinctRawWarmedWindowEnds:unique.size,quotes:{accepted:state.prices.accepted,rejected:state.prices.rejected,changes:state.prices.changes,freshCacheMs:state.prices.freshCacheMs,staleCacheMs:state.prices.staleCacheMs,timeEvidence:'Original confirmed same-batch bank Clock; never relabeled a block timestamp.',modeledHoldingOnly:true,exitTriggers:state.prices.triggerEvents},executedEvidence:state.executedEvidence,independentlyAuditedCompleteWindows:0,independentCoverage:'PENDING_SEPARATE_BOUNDED_AUDIT',forwardAcceptance:false,combinedAcceptance:false,entriesEnabled:false,paperTradesCreated:0,financialPnl:null,syntheticPrices:0,interpolatedPrices:0,networkRequests:0};
}

export function writeOvernightCorrection(directory=resolve('evidence/overnight-20261027/11-combined')){
  const output=join(directory,'offline-corrected-replay.json');
  const originals=readdirSync(directory).filter(name=>name!=='offline-corrected-replay.json').sort().map(name=>join(directory,name));
  need(originals.length>0&&originals.every(path=>statSync(path).isFile()),'EXPLICIT_FLAT_EVIDENCE_DIRECTORY_REQUIRED');
  const before=originals.map(path=>({path:relative(process.cwd(),path),sha256:hash(readFileSync(path)),bytes:statSync(path).size}));
  const capture=JSON.parse(readFileSync(join(directory,'capture.json'),'utf8')),proof=JSON.parse(readFileSync(join(directory,'offline-mapping-audit.json'),'utf8'));
  const mapper=readFileSync('src/pumpapi-mapping.ts'),pipeline=readFileSync('src/active-pipeline.ts');
  need(hash(mapper)===proof.sourceCode.mapperAfterSha256,'MAPPER_DIFFERS_FROM_FROZEN_FIX');
  const records=readFileSync(join(directory,'observations.ndjson'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as RecordRow);
  const corrected=replayOvernightCorrection(records,capture.scope,proof);
  const after=originals.map(path=>({path:relative(process.cwd(),path),sha256:hash(readFileSync(path)),bytes:statSync(path).size}));need(JSON.stringify(before)===JSON.stringify(after),'ORIGINAL_EVIDENCE_CHANGED');
  const result={schemaVersion:1,generatedAt:new Date().toISOString(),classification:corrected.classification,originalFilesBefore:before,originalFilesAfter:after,allOriginalFilesUnchanged:true,sourceCode:{mapperSha256:hash(mapper),pipelineSha256:hash(pipeline),replayScriptSha256:hash(readFileSync(import.meta.filename))},correctionScope:{instruction:'buy_exact_quote_in_v2 ONLY',change:'For these proved actual BuyEvents, quote_amount_in is the complete executed user debit; user_quote_amount_in is the net curve input. Reverse only those two mappings for this instruction variant.',amountConventions:'Curve and user amounts remain separate research feature views; no primary strategy convention is silently selected.',fees:'Actual LP/protocol/creator fees remain in evidence. Observed buyback_fee is part of protocol_fee, not another full debit. No costs are charged or P&L constructed in this replay.',proof:'offline-mapping-audit.json contains original event bytes, instruction roles, actual transfers and pinned SDK/IDL evidence.'},originalForwardResult:{normalizedEvents:capture.normalizedEvents,normalizedBuys:capture.normalizedBuys,normalizedSells:capture.normalizedSells,failedTransactions:capture.failedTransactions,qualityGaps:capture.qualityGaps,enrichedFeatureWarmSeconds:capture.enrichedFeatureWarmSeconds,noPendingFeatureWarmSeconds:capture.noPendingFeatureWarmSeconds,complete60SecondFeatureWindows:capture.complete60SecondFeatureWindows,combinedAcceptance:capture.combinedAcceptance,stopReason:capture.stopReason,observationMs:capture.observationMs,preserved:true},correctedOfflineReplay:corrected,interpretation:'A mapping-only counterfactual on the original chronological observations can recover research features that the original runtime failed to calculate. It does not retroactively pass the failed forward experiment. Full-flow completeness and protection remain separate evidence requirements.',productionChanged:false,financialAccountCreated:false,originalAccountChanged:false,paperEntriesEnabled:false,liveTrading:false,acceptanceClockStarted:false};
  writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return {output,result};
}

/** Verify the existing historical artifact without rewriting it. A later
 * separately proved variant fix may change a source hash while leaving this
 * v2-only replay identical; compare semantics and disclose both source versions.
 * Window samples use the original recorded feature-request times, independent
 * of the current diagnostic coalescing policy; no timing/amount/gap is ignored.
 */
export function verifyExistingOvernightCorrection(directory=resolve('evidence/overnight-20261027/11-combined')){
  const output=join(directory,'offline-corrected-replay.json'),storedBytes=readFileSync(output),stored=JSON.parse(storedBytes.toString('utf8'));
  need(stored.schemaVersion===1&&stored.allOriginalFilesUnchanged===true&&Array.isArray(stored.originalFilesBefore)&&stored.originalFilesBefore.length>=8&&stored.originalFilesBefore.length<=16&&isDeepStrictEqual(stored.originalFilesBefore,stored.originalFilesAfter),'STORED_ORIGINAL_MANIFEST_MISMATCH');
  const expectedDirectory=resolve(directory),seen=new Set<string>();
  const originals=stored.originalFilesBefore.map((entry:any)=>{
    need(entry&&typeof entry.path==='string'&&entry.path.length<=1024&&/^[a-f0-9]{64}$/.test(entry.sha256)&&Number.isSafeInteger(entry.bytes)&&entry.bytes>=0&&entry.bytes<=32*1024*1024,'STORED_ORIGINAL_MANIFEST_INVALID');
    const path=resolve(entry.path);need(dirname(path)===expectedDirectory&&!seen.has(path)&&basename(path)!=='offline-corrected-replay.json','STORED_ORIGINAL_PATH');seen.add(path);
    const stat=lstatSync(path);need(stat.isFile()&&stat.size===entry.bytes&&hash(readFileSync(path))===entry.sha256,'STORED_ORIGINAL_HASH_MISMATCH');return path;
  });
  for(const name of ['baseline.json','grant.json','observations.ndjson','capture.json','offline-mapping-audit.json','rpc-budget.json','summary.json','supervisor.json'])need(seen.has(join(expectedDirectory,name)),'REQUIRED_ORIGINAL_RECEIPT_MISSING');
  const capture=JSON.parse(readFileSync(join(directory,'capture.json'),'utf8')),proof=JSON.parse(readFileSync(join(directory,'offline-mapping-audit.json'),'utf8'));
  need(stored.sourceCode?.mapperSha256===proof.sourceCode?.mapperAfterSha256,'STORED_FIX_SOURCE_MISMATCH');
  const records=readFileSync(join(directory,'observations.ndjson'),'utf8').trim().split('\n').map(line=>JSON.parse(line) as RecordRow);
  const corrected=replayOvernightCorrection(records,capture.scope,proof);
  need(isDeepStrictEqual(corrected,stored.correctedOfflineReplay),'STORED_SEMANTIC_REPLAY_MISMATCH');
  // Ensure reads/replay never changed a source receipt or the historical output.
  originals.forEach((path:string,index:number)=>need(hash(readFileSync(path))===stored.originalFilesBefore[index].sha256,'ORIGINAL_EVIDENCE_CHANGED'));
  need(hash(readFileSync(output))===hash(storedBytes),'STORED_ARTIFACT_CHANGED');
  const current={mapperSha256:hash(readFileSync('src/pumpapi-mapping.ts')),pipelineSha256:hash(readFileSync('src/active-pipeline.ts')),replayScriptSha256:hash(readFileSync(import.meta.filename))};
  return {output,classification:'READ_ONLY_EXISTING_CORRECTED_REPLAY_VERIFIED',semanticReplayMatches:true,originalFilesUnchanged:true,storedArtifactSha256:hash(storedBytes),sourceCodeComparison:{recorded:stored.sourceCode,current,mapperMatchesRecorded:current.mapperSha256===stored.sourceCode.mapperSha256,pipelineMatchesRecorded:current.pipelineSha256===stored.sourceCode.pipelineSha256,replayScriptMatchesRecorded:current.replayScriptSha256===stored.sourceCode.replayScriptSha256,meaning:'Source hashes remain historical. Current code recomputed exactly the stored v2 replay; differing hashes do not rewrite or relabel the prior artifact.'},normalizedEvents:corrected.normalizedEvents,buys:corrected.normalizedBuys,sells:corrected.normalizedSells,rawWarmedClosedWindowEnds:corrected.distinctRawWarmedWindowEnds,readOnly:true,forwardAcceptance:false,networkRequests:0};
}

if(resolve(process.argv[1]??'')===import.meta.filename){
  const args=process.argv.slice(2);need(args.length===0||args.length===1&&args[0]==='--verify-existing','UNRECOGNIZED_ARGUMENTS');
  if(args[0]==='--verify-existing')process.stdout.write(JSON.stringify(verifyExistingOvernightCorrection())+'\n');
  else{const {output,result}=writeOvernightCorrection();process.stdout.write(JSON.stringify({output,classification:result.classification,normalizedEvents:result.correctedOfflineReplay.normalizedEvents,buys:result.correctedOfflineReplay.normalizedBuys,sells:result.correctedOfflineReplay.normalizedSells,rawWarmedClosedWindowEnds:result.correctedOfflineReplay.distinctRawWarmedWindowEnds,originalFilesUnchanged:result.allOriginalFilesUnchanged,forwardAcceptance:false,networkRequests:0})+'\n');}
}
