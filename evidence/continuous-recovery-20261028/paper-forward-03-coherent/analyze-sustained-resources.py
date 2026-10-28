#!/usr/bin/env python3
"""Read-only analysis of hash-indexed POE public-projection evidence; no RPC/account writes."""
import argparse,hashlib,json,math,pathlib,re,statistics,tarfile
MAX_TOTAL=40*1024*1024
MAX_SAMPLE=256*1024

def need(ok,why):
 if not ok:raise ValueError(why)
def sha(b):return hashlib.sha256(b).hexdigest()
def load(path):
 if path.is_dir():
  def read(name):
   q=path/name;need(not q.is_symlink()and q.is_file()and q.stat().st_size<=MAX_TOTAL,'unsafe/missing/oversized indexed file '+name);need(q.resolve().is_relative_to(path.resolve()),'path escape');return q.read_bytes()
  index_raw=read('index.json');index=json.loads(index_raw);files={'index.json':index_raw}
  for row in index['files']:files[row['file']]=read(row['file'])
 else:
  need(path.stat().st_size<=MAX_TOTAL,'archive input too large');files={};size=0
  with tarfile.open(path,'r:gz')as archive:
   for row in archive:
    need(row.isfile()and not row.name.startswith('/')and'..'not in pathlib.PurePosixPath(row.name).parts and row.name not in files,'unsafe/duplicate archive member');size+=row.size;need(size<=MAX_TOTAL,'expanded archive exceeds bound');files[row.name]=archive.extractfile(row).read()
  index=json.loads(files['index.json'])
 need(index.get('classification')=='paper-public-projection-evidence','wrong evidence classification')
 need(isinstance(index.get('files'),list)and len(index['files'])<=512,'index member bound');need(sum(row['bytes']for row in index['files'])<=MAX_TOTAL,'indexed bytes exceed bound')
 seen=set()
 for row in index['files']:
  name=row['file'];need(name not in seen,'duplicate indexed file');seen.add(name);body=files[name];need(len(body)==row['bytes']and sha(body)==row['sha256'],'index integrity mismatch '+name)
 need(set(files)==seen|{'index.json'},'unindexed artifact members');return index,files

def percentile(values,p):
 if not values:return None
 values=sorted(values);i=(len(values)-1)*p;a=math.floor(i);b=math.ceil(i);return values[a]+(values[b]-values[a])*(i-a)
def dist(values):return {'samples':len(values),'minimum':min(values)if values else None,'p50':percentile(values,.5),'p95':percentile(values,.95),'peak':max(values)if values else None}
def slope(points):
 if len(points)<2:return None
 xm=statistics.mean(x for x,y in points);ym=statistics.mean(y for x,y in points);den=sum((x-xm)**2 for x,y in points)
 return sum((x-xm)*(y-ym)for x,y in points)/den if den else None
def trend(points):
 return {'samples':len(points),'first':points[0][1]if points else None,'last':points[-1][1]if points else None,'delta':points[-1][1]-points[0][1]if len(points)>1 else None,'linearSlopePerSecond':slope(points),'scopeSeconds':points[-1][0]-points[0][0]if len(points)>1 else None}
def number(v):return isinstance(v,(int,float))and not isinstance(v,bool)and math.isfinite(v)
def analyze(index,files):
 result={'kind':'poe-sustained-resource-analysis-v1','source':index['source'],'accountId':index['accountId'],'inceptionAt':index['inceptionAt'],'segments':[],'limitations':['Timeline samples are process/group observations, not exclusive function CPU attribution.','Summed live-group CPU omits exited processes; intervals with changed membership remain UNKNOWN.','Disk free-space trend is host filesystem headroom, not exclusive POE or ledger storage growth.','Source-reported counters retain their own snapshot timestamps; stale snapshots do not become fresh on collection.','No traffic completeness, provider entitlement, protection acceptance, or whole-market denominator follows from resource measurements.']}
 for name in sorted(files):
  match=re.fullmatch(r'segments/(\d+)/supervision\.json',name)
  if not match:continue
  i=int(match[1]);meta=json.loads(files[name]);summ=meta.get('resourceTimeline');data_name=f'segments/{i}/resource-samples.ndjson';out={'ordinal':i,'sourceRunId':meta.get('sourceRunId'),'segmentElapsedSeconds':None,'timelineStatus':'UNAVAILABLE','timelineManifest':summ};result['segments'].append(out)
  if number(meta.get('startedAt'))and number(meta.get('stoppedAt')):out['segmentElapsedSeconds']=(meta['stoppedAt']-meta['startedAt'])/1000
  if not summ or data_name not in files:out['unavailableReason']=(summ or{}).get('disabledReason')or'NO_RETAINED_TIMELINE';continue
  raw=files[data_name];need(len(raw)<=MAX_SAMPLE and len(raw)==summ['bytes']and sha(raw)==summ['sha256'],'timeline manifest mismatch');rows=[json.loads(line)for line in raw.splitlines()];need(len(rows)==summ['samples']and len(rows)>0,'sample count mismatch')
  for r in rows:
   need(r['kind']=='poe-paper-resource-sample-v1'and r['source']==index['source']and r['accountId']==index['accountId']and r['inceptionAt']==index['inceptionAt']and r['ordinal']==i and r.get('sourceRunId')in[None,meta.get('sourceRunId')],'sample identity mismatch')
  elapsed=[r['elapsedMs']/1000 for r in rows];need(all(b>=a for a,b in zip(elapsed,elapsed[1:])),'monotonic collection clock regression');out.update(timelineStatus='MEASURED',samples=len(rows),sampledElapsedSeconds=elapsed[-1]-elapsed[0],firstElapsedSeconds=elapsed[0],lastElapsedSeconds=elapsed[-1],processes={},collector={'wallMs':dist([r['collectionMs']for r in rows]),'cpuMicros':dist([r['collectionCpuMicros']for r in rows]),'totalCollectionCpuSeconds':sum(r['collectionCpuMicros']for r in rows)/1e6},headroom={},sourceCounters={},sourceSnapshotLagMs=dist([r['at']-r['sourceSnapshotAt']for r in rows if number(r.get('sourceSnapshotAt'))and r['sourceSnapshotAt']<=r['at']]),snapshotFutureCount=sum(number(r.get('sourceSnapshotAt'))and r['sourceSnapshotAt']>r['at']for r in rows))
  timeline=[]
  for actor in ['source','publisher','supervisor']:
   known=[];rss=[];cpu=[];unknown=[];membership_changes=0;prior=None
   for r,t in zip(rows,elapsed):
    v=r['processes'].get(actor)
    if v is None:unknown.append({'elapsedSeconds':t,'reason':'PROCESS_VIEW_UNAVAILABLE'});prior=None;continue
    rss.append((t,v['rssBytes']));cpu.append((t,v['cpuSeconds']));fraction=v.get('oneCoreFraction');delta=v.get('cpuDeltaSeconds');same=prior is not None and prior['membershipSha256']==v['membershipSha256']
    if prior and not same:membership_changes+=1
    if number(fraction)and number(delta)and same:known.append((delta,fraction,r.get('intervalMs')))
    else:unknown.append({'elapsedSeconds':t,'reason':'FIRST_OR_CHANGED_MEMBERSHIP_OR_COUNTER_UNAVAILABLE'})
    prior=v
   out['processes'][actor]={'rssBytes':{**trend(rss),'peak':max((v for t,v in rss),default=None)},'reportedLiveCpuSeconds':trend(cpu),'stableMembershipObservedCpuSeconds':sum(v[0]for v in known),'stableMembershipCoveredSeconds':sum(v[2]/1000 for v in known if number(v[2])),'intervalOneCoreFraction':dist([v[1]for v in known]),'unknownIntervals':unknown,'membershipChanges':membership_changes,'totalCpuInterpretation':'Stable intervals give observed subset, not full-run CPU when missing/membership changes exist.'}
  for field in ['availableDiskBytes','availableMemoryBytes']:out['headroom'][field]={**trend([(t,r[field])for r,t in zip(rows,elapsed)if number(r.get(field))]),'minimum':min((r[field]for r in rows if number(r.get(field))),default=None)}
  for section,key in [('rpc','newUnits'),('rpc','newAccountedResponseBytes'),('native','socketBytes'),('native','normalizedEvents'),('feeds','pumpApiSocketBytes'),(None,'eventBytes')]:
   points=[];last_at=None;resets=0
   for r in rows:
    at=r.get('sourceSnapshotAt');u=r.get('sourceReportedUsage',{});v=u.get(key)if section is None else u.get(section,{}).get(key)
    if not(number(at)and number(v))or at==last_at:continue
    if points and(at<last_at or v<points[-1][1]):resets+=1
    points.append((at/1000,v));last_at=at
   label=f'{section}.{key}'if section else key
   out['sourceCounters'][label]={**trend(points),'counterOrTimestampRegressions':resets,'rateMeaning':'Linear slope over unique source timestamps; unavailable on counter/timestamp regression.'}
   if resets:out['sourceCounters'][label]['linearSlopePerSecond']=None;out['sourceCounters'][label]['delta']=None
  for r,t in zip(rows,elapsed):
   timeline.append({'elapsedSeconds':t,'collectedAt':r['at'],'sourceSnapshotAt':r.get('sourceSnapshotAt'),'sourceRunId':r.get('sourceRunId'),'snapshotLagMs':r['at']-r['sourceSnapshotAt']if number(r.get('sourceSnapshotAt'))and r['sourceSnapshotAt']<=r['at']else None,'sourceReportedUsage':r.get('sourceReportedUsage',{}),'processMembership':{k:None if v is None else {'membershipSha256':v['membershipSha256'],'knownCpuInterval':number(v.get('oneCoreFraction'))and number(v.get('cpuDeltaSeconds'))}for k,v in r['processes'].items()}})
  out['timestampedSnapshots']=timeline
 return result

def main():
 p=argparse.ArgumentParser();p.add_argument('--input',type=pathlib.Path,required=True,help='Verified extracted archive directory or tar.gz');p.add_argument('--output',type=pathlib.Path);args=p.parse_args();index,files=load(args.input);out=analyze(index,files);body=json.dumps(out,indent=2,allow_nan=False)+'\n'
 if args.output:args.output.write_text(body)
 else:print(body,end='')
if __name__=='__main__':main()
