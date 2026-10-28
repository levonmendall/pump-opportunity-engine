"""Read retained source718 timing only. No provider requests or source writes."""
import pathlib,json,hashlib,bisect,collections,sys
root=pathlib.Path(sys.argv[1]);pings=[];proofs=[];notifications=[];early=[];starts=[];segments=[]
for p in sorted((root/'events').glob('events-*.ndjson')):
 h=hashlib.sha256();size=0
 with p.open('rb')as f:
  for line in f:
   h.update(line);size+=len(line);e=json.loads(line);k=e['kind'];d=e['data']
   if k=='native-flow-outbound-control'and d.get('opcode')==9:pings.append({'at':d['at'],'connection':d['connection'],'operationId':d['operationId']})
   if k=='native-flow-subscription-ack':proofs.append({'at':d['at'],'connection':d['connection'],'kind':'logsSubscribe'})
   if k=='native-flow-subscription-retired':proofs.append({'at':d['retiredAt'],'connection':d['connection'],'kind':'logsUnsubscribe'})
   if k=='native-flow-information-available':notifications.append(d['receivedAt'])
   if k=='native-flow-early-heartbeat-request':early.append(d)
   if k=='component-physical-start':starts.append(d)
 segments.append({'path':'events/'+p.name,'bytes':size,'sha256':h.hexdigest()})
proofs.sort(key=lambda p:p['at']);notifications.sort();early.sort(key=lambda p:p['at']);previousPing=-1
for ping in pings:
 matches=[p for p in proofs if p['connection']==ping['connection']and p['at']<=ping['at']]
 last=matches[-1]if matches else None;ping['previousCurrentConnectionManagedAck']=last;ping['ackAgeMs']=ping['at']-last['at']if last else None
 ping['precededByEarlyRequestSinceLastPing']=any(previousPing<e['at']<=ping['at']for e in early);previousPing=ping['at']
r=json.loads((root/'receipt.json').read_text());elapsed=r['elapsedMs']/1000
out={'classification':'RETAINED_FORWARD_TIMING_NOT_SAVINGS_OR_CORRECTED_REPLAY','source':r['source'],'runId':r['runId'],'elapsedSeconds':elapsed,'nativeClientPings':len(pings),'earlyHeartbeatRequests':len(early),'physicalStarts':len(starts),'physicalStartsByMethod':dict(collections.Counter(s['kind']['method']for s in starts)),'pingUnitsPerMinute':len(pings)*60/elapsed,'pingShareOfPhysicalStarts':len(pings)/len(starts),'pingCountsByRecentCurrentConnectionAck':{str(age):sum(p['ackAgeMs']is not None and p['ackAgeMs']<=age for p in pings)for age in [500,1000,3000,5000,10000]},'earlyVersusPeriodic':{str(early):{'count':sum(p['precededByEarlyRequestSinceLastPing']==early for p in pings),'withAckWithin10s':sum(p['precededByEarlyRequestSinceLastPing']==early and p['ackAgeMs']is not None and p['ackAgeMs']<=10000 for p in pings)}for early in [False,True]},'pings':pings,'segments':segments,'limitations':['Managed ACK timestamps here are original handler/availability times because source718 did not retain separate conservative ACK receipt. The corrected source records both.','Recent-ACK overlap is not measured savings: explicit early-runway needs and rescheduled future requests differ.','Ordinary inbound notifications cannot prove outbound round-trip liveness. They are not used to postpone PING.','No new provider capacity, complete market coverage or trading profitability is established.']}
print(json.dumps(out,indent=2))
