"""Reproduce a read-only same-service resource pair from retained host receipts."""
import pathlib,json,hashlib,datetime
p=pathlib.Path(__file__).resolve().parent
ids=['40964701519','40965851417']
a,b=[json.loads((p/(i+'.receipt.json')).read_text())for i in ids]
source={'commit':'ba33ee535ad1703da36905a5e2f44088ae19a43d','sha256':'870ac98a2377fefde564b9a3a252a7cc7cb3a561582abd48bda22ee18a14bee7'}
config='797f8c1f0a1e23a9771b05356ff51d71f081b520e994f4cf6b2ed1c7c44c6511'
for r in[a,b]:
 assert r['kind']=='POE_ORIGINAL_CUTOVER_REFUSAL_READ_ONLY'
 assert r['publicStatus']['release']==source['commit'] and r['publicStatus']['strategy']=='adaptive-momentum-v2-paper-v1'
 assert r['publicStatus']['accountId']=='poe-3123e352-4581-455b-85db-acd7e825e99e' and r['publicStatus']['inceptionAt']=='2026-10-26T22:07:36.212Z'
 assert r['publicStatus']['mode']=='PAPER' and r['publicStatus']['liveTrading']is False
 assert r['upgradeVerification']['value']['source']==source and r['upgradeVerification']['value']['verification']['configurationSha256']==config
 assert r['service']['MainPID']=='2474047' and r['service']['NRestarts']=='0' and r['service']['ActiveState']=='active'
 assert r['financialDatabaseOpened']is False and r['serviceChanges']==r['providerRequests']==r['credentialReads']==0
 assert r['currentCgroup']['pids']==[2474047,2474050,2474051]
 assert r['hostResourceUsage']['serviceScope']=='poe-runtime.service cgroup, including owned children'
 assert r['service']['ExecMainStartTimestamp']=='Thu 2026-10-29 22:16:50 UTC'
ra,rb=[r['hostResourceUsage']for r in[a,b]]
elapsed_ms=rb['sampleAt']-ra['sampleAt'];assert elapsed_ms>0
seconds=elapsed_ms/1000
cpu_fields=['usage_usec','user_usec','system_usec','nr_periods','nr_throttled','throttled_usec']
cpu_delta={k:rb['serviceCpu'][k]-ra['serviceCpu'][k]for k in cpu_fields};assert all(v>=0 for v in cpu_delta.values())
assert [d['device']for d in ra['serviceIo']['devices']]==[d['device']for d in rb['serviceIo']['devices']]
io_delta={k:rb['serviceIo']['totals'][k]-ra['serviceIo']['totals'][k]for k in ra['serviceIo']['totals']};assert all(v>=0 for v in io_delta.values())
roles=[]
for xa,xb in zip(a['ownedProcessRoles'],b['ownedProcessRoles']):
 assert xa['pid']==xb['pid']and xa['role']==xb['role']and xa['ownerUid']==xb['ownerUid']==988
 delta=xb['cpuSeconds']-xa['cpuSeconds'];assert delta>=0
 roles.append({'role':xa['role'],'pid':xa['pid'],'cpuSecondsDelta':delta,'meanCpuCores':delta/seconds,'rssBeforeBytes':xa['rssBytes'],'rssAfterBytes':xb['rssBytes'],'rssChangeBytes':xb['rssBytes']-xa['rssBytes']})
events={k:b['effectivePerformanceControls']['cgroupMemoryEvents'][k]-a['effectivePerformanceControls']['cgroupMemoryEvents'][k]for k in a['effectivePerformanceControls']['cgroupMemoryEvents']if k!='available'};assert all(v>=0 for v in events.values())
net=[]
ni=[{d['interface']:d for d in r['hostNetwork']['interfaces']}for r in[ra,rb]]
assert set(ni[0])==set(ni[1])
for name in ni[0]:
 fields=['receivedBytes','receivedPackets','transmittedBytes','transmittedPackets']
 delta={k:ni[1][name][k]-ni[0][name][k]for k in fields};assert all(v>=0 for v in delta.values())
 net.append({'interface':name,'delta':delta,'receivedBytesPerSecond':delta['receivedBytes']/seconds,'transmittedBytesPerSecond':delta['transmittedBytes']/seconds})
ack=b['acceptedSource']['value'];assert ack['source']==source and ack['accountId']==b['publicStatus']['accountId']and ack['runId']=='native-paper-20261029221651345'
assert ack['sourceAtMs']<=ack['acknowledgedAtMs']<=ack['observedBySupervisorAtMs']<=b['checkedAt']
result={'kind':'original-service-real-resource-pair-v1','source':source,'configurationSha256':config,'workflowRuns':ids,'sampleBeforeAt':ra['sampleAt'],'sampleAfterAt':rb['sampleAt'],'elapsedMs':elapsed_ms,'elapsedSeconds':seconds,'samePhysicalServiceAndNativePids':True,'serviceRestartCount':0,'counterResetDetected':False,'cpu':{'scope':'original POE service cgroup','delta':cpu_delta,'meanCpuCores':cpu_delta['usage_usec']/1_000_000/seconds,'logicalCpuCount':b['effectivePerformanceControls']['logicalCpuCount'],'logicalCapacityFraction':cpu_delta['usage_usec']/1_000_000/seconds/b['effectivePerformanceControls']['logicalCpuCount']},'io':{'scope':'original POE service cgroup kernel cumulative physical I/O; NOT retained disk growth','deviceSet':[d['device']for d in rb['serviceIo']['devices']],'delta':io_delta,'meanWriteBytesPerSecond':io_delta['wbytes']/seconds,'meanReadBytesPerSecond':io_delta['rbytes']/seconds},'processes':roles,'serviceMemory':{'before':ra['serviceMemory'],'after':rb['serviceMemory'],'eventsDelta':events},'hostMemoryAvailable':{'beforeBytes':ra['hostMemory']['availableBytes'],'afterBytes':rb['hostMemory']['availableBytes'],'scope':'HOST AGGREGATE; unrelated services and admin runner included'},'rootFilesystemAvailable':{'beforeBytes':ra['rootFilesystem']['availableBytes'],'afterBytes':rb['rootFilesystem']['availableBytes'],'changeBytes':rb['rootFilesystem']['availableBytes']-ra['rootFilesystem']['availableBytes'],'scope':'HOST AGGREGATE; not POE-attributable disk growth'},'hostNetwork':{'scope':'HOST AGGREGATE; not POE-attributable','interfaces':net},'currentOriginalChannelAcknowledgment':{'source':ack['source'],'runId':ack['runId'],'sourceAtMs':ack['sourceAtMs'],'sequence':ack['sequence'],'acknowledgedAtMs':ack['acknowledgedAtMs'],'observedBySupervisorAtMs':ack['observedBySupervisorAtMs'],'acceptedDistinctSourcesThisSupervisor':ack['acceptedDistinctSourcesThisSupervisor'],'sourceToAcknowledgmentMs':ack['acknowledgedAtMs']-ack['sourceAtMs']},'lastPublicStatus':b['publicStatus'],'dailyReset':{'historicalUpgradeReceiptStillPresent':True,'originalResetAppliedAt':b['upgradeVerification']['value']['ownerDailyLossReset']['receipt']['at'],'originalResetLossPausedAfter':False,'currentLiveDailyStateExported':False},'limitations':['This pair covers529.580 real seconds after source startup; it is not sustained24h acceptance or a memory-leak proof.','Memory growth includes startup/warmup and changing workload; two endpoints do not establish steady-state growth.','Kernel physical write bytes are not evidence-store retained bytes; filesystem/network metrics include unrelated host work.','The upgrade financial/reset receipt is historical. This read-only report does not reopen the ledger or export current positions/daily baseline; do not treat the old flat snapshot as current.','The current public blocker is readiness required with fresh reconciliation. This sample alone does not identify its underlying candidate/provider reason or prove permanent entry pause.','No two-position live reliability claim is established.'],'measurementActions':{'financialDatabaseOpened':False,'financialWrites':0,'serviceChanges':0,'extraProviderRequests':0}}
(p/'resource-pair-analysis.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'elapsedSeconds':seconds,'meanCpuCores':result['cpu']['meanCpuCores'],'throttlingDeltaUsec':cpu_delta['throttled_usec'],'physicalWriteBytes':io_delta['wbytes'],'meanWriteBytesPerSecond':result['io']['meanWriteBytesPerSecond'],'nativeRssBeforeAfterBytes':[[v['role'],v['rssBeforeBytes'],v['rssAfterBytes']]for v in roles],'memoryEventsDelta':events,'rootDiskAvailableAfterBytes':rb['rootFilesystem']['availableBytes'],'ackDelayMs':result['currentOriginalChannelAcknowledgment']['sourceToAcknowledgmentMs']},indent=2))
