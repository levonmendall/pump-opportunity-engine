#!/usr/bin/env python3
"""One-off sanitized original-account forensic export; never a runtime service.

CLI has no path/SQL/window arguments. A separately hash-verified owner bootstrap
may execute this as root; privileges are permanently dropped before private I/O.
Read-only SQLite includes the active WAL, never immutable=1 or a writer lease.
"""
import datetime,hashlib,json,math,os,pathlib,re,sqlite3,stat,sys,time

ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION=1793052456212
UID,GID=988,982
DB=pathlib.Path('/var/lib/poe/state/ledger.sqlite')
DIAGNOSTICS=pathlib.Path('/var/lib/poe/service/diagnostics')
OUTPUT=pathlib.Path('/var/lib/poe-public/reporting-forensics-20261029.json')
WINDOWS=((1793286840000,1793287560000),(1793292720000,1793292900000),(1793295960000,1793296140000))
ENTRY_SNAPSHOTS=(('9307',1793296000848,1793296000794),('9310',1793296046469,1793296041419))
MAX_CONTROL_ROWS=256
KINDS=('reconcile','resume','pause','order','attempt','safe-stop','cancel-entry-orders')
MAX_ROWS,MAX_DETAIL,MAX_LINE,MAX_LOG,MAX_FACTS,MAX_OUTPUT=1200,65536,65536,1024*1024,512,2*1024*1024
REASONS=frozenset((
 'current equity or liquidation unavailable; entries closed','entry preparation or reconciliation unavailable',
 'current financial reconciliation unavailable; exposure retained','explicit verified runtime readiness',
 'fresh reconciliation or next UTC-day loss reset required','entries paused or reconciliation required',
 'execution startup: fresh reconciliation/readiness required','monitoring capacity unavailable for new risk',
 'selected evidence unavailable; entries closed','financial action unresolved; entries closed and reservations preserved',
 'completed PAPER protection gap exceeded research boundary','resource pressure; new candidate risk closed',
 'operating evidence unavailable; incomplete candidates blocked; financial journal and exposure retained',
 'rolling resource or evidence pressure; exposure retained','feed gap; selected windows require fresh subscription and warming',
 'expiry reached before attempt','USD valuation unavailable; entry canceled before attempt',
 'unknown liquidation marks; entry canceled before attempt','entry gate closed; canceled before attempt',
 'gas reserve needed for held-position management; entry canceled before attempt',
 'missing/stale first-attempt state; gas charged; no retry','malformed first-attempt amounts; gas charged; no retry',
 'price constraint failed; gas charged; no retry','$50 commitment limit at execution; gas charged',
 'exit quote is not for actual full size; gas charged','malformed deposit refund; gas charged; no retry',
 'unverified deposit refund; gas charged','single modeled PAPER attempt; no live fill claim',
 'safe stop requested','operator paused new entries','verified_snapshot_unavailable',
 'startup: observation only; explicit runtime readiness required'))
class Refused(RuntimeError):pass
def need(v,code):
 if not v:raise Refused(code)
def integer(v):return type(v)is int and 0<=v<=9007199254740991
def number(v):return type(v)in(int,float)and math.isfinite(v)and 0<=v<=9007199254740991
def timestamp(v):return v if integer(v)else None
def boolean(v):return v if type(v)is bool else None
def identity(v):return v if type(v)is str and re.fullmatch('[1-9A-HJ-NP-Za-km-z]{32,44}',v)else None
def reason(v):return v if type(v)is str and v in REASONS else 'UNRECOGNIZED_REASON_REDACTED' if v is not None else None
def hashed(v):return hashlib.sha256(v.encode()).hexdigest()if type(v)is str and len(v)<=512 else None
def in_window(at):return integer(at)and any(start<=at<end for start,end in WINDOWS)
def iso(at):return datetime.datetime.fromtimestamp(at/1000,datetime.timezone.utc).isoformat().replace('+00:00','Z')
def metadata(path,uid):
 need(path.resolve()==path,'CANONICAL_FIXED_PATH_REQUIRED');s=path.lstat();need(stat.S_ISREG(s.st_mode)and not stat.S_ISLNK(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o600,'FIXED_FILE_SHAPE');return s
def same_inode(a,b):return(a.st_dev,a.st_ino,a.st_uid)==(b.st_dev,b.st_ino,b.st_uid)
def drop_original_identity():
 need(os.geteuid()in(0,UID),'ORIGINAL_OWNER_ACCESS_REQUIRED')
 if os.geteuid()==0:
  os.closerange(3,1024)
  os.setgroups([]);os.setresgid(GID,GID,GID);os.setresuid(UID,UID,UID)
 need(os.getresuid()==(UID,UID,UID)and os.getresgid()==(GID,GID,GID),'PERMANENT_ORIGINAL_IDENTITY_REQUIRED')
def price_fact(value,at):
 value=value if type(value)is dict else {};observed=timestamp(value.get('at'));raw=value.get('microUsdPerSol')
 return {'present':bool(value),'observedAt':observed,'ageMs':at-observed if observed is not None else None,'microUsdPerSol':raw if type(raw)is str and re.fullmatch('[0-9]{1,20}',raw)else None,'freshUnder10000ms':observed is not None and 0<=at-observed<=10000}
def mark_facts(value,at):
 value=value if type(value)is dict else {};rows=[]
 for mint,mark in list(value.items())[:8]:
  mark=mark if type(mark)is dict else {};observed=timestamp(mark.get('at'));rows.append({'mint':identity(mint),'observedAt':observed,'ageMs':at-observed if observed is not None else None,'freshUnder2000ms':observed is not None and 0<=at-observed<=2000})
 return {'count':len(value),'rows':rows,'truncated':len(value)>8,'meaning':'Timestamp freshness only; amounts and executable-price validity are not inferred.'}
def sanitize_journal(revision,action_id,at,kind,detail,result,order_detail):
 d=detail if type(detail)is dict else {};r=result if type(result)is dict else {};out={'revision':revision,'actionIdSha256':hashed(action_id),'at':at,'kind':kind,'price':price_fact(d.get('price'),at),'marks':mark_facts(d.get('marks'),at)}
 if kind in('pause','resume'):
  out['reason']=reason(d.get('reason',r.get('reason')));out['entriesEnabledResult']=boolean(r.get('enabled'));out['pausedResult']=boolean(r.get('paused'))
 if kind=='reconcile':out['reconciledAt']=at;out['pausedResult']=boolean(r.get('paused'))
 ready=d.get('readiness')
 if type(ready)is dict:out['readiness']={'marketAt':timestamp(ready.get('marketAt')),**{key:boolean(ready.get(key))for key in('recoveryComplete','candidateWindowsReady','budgetAvailable')}}
 order=d.get('input')if kind=='order'else order_detail.get('input')if type(order_detail)is dict else None
 if type(order)is dict:out['order']={'idSha256':hashed(order.get('id')),'mint':identity(order.get('mint')),'side':order.get('side')if order.get('side')in('buy','sell')else None,**{key:timestamp(order.get(key))for key in('decidedAt','executeAt','expiresAt')}}
 if kind=='attempt':
  q=d.get('quote');qt=timestamp(q.get('at'))if type(q)is dict else None
  out['attempt']={'orderIdSha256':hashed(d.get('orderId')),'result':r.get('status')if r.get('status')in('filled','failed','expired')else None,'reason':reason(r.get('reason')),'resultAt':timestamp(r.get('at')),'quotePresent':type(q)is dict,'quoteAt':qt,'quoteAgeMs':at-qt if qt is not None else None}
 return out
def _entry_control_anchors(conn,deadline,detail_budget):
 """Reconstruct only fields whose committed journal semantics establish them.

 The public sequence is not a financial journal revision. Event-time lookup is
 explicit; current financial_state controls are NEVER substituted for history.
 """
 def decoded(raw):
  need(raw is not None,'CONTROL_DETAIL_UNAVAILABLE');detail_budget['bytes']+=len(raw.encode());need(detail_budget['bytes']<=4*1024*1024,'TOTAL_DETAIL_BOUND');value=json.loads(raw);need(type(value)is dict,'CONTROL_DETAIL_SHAPE');return value
 anchors=[]
 for sequence,source_at,expected_reconciliation in ENTRY_SNAPSHOTS:
  need(time.monotonic()<=deadline,'READ_DEADLINE')
  query="SELECT j.revision,j.action_id,j.at,j.kind,CASE WHEN length(CAST(j.detail AS BLOB))<=? THEN j.detail ELSE NULL END,CASE WHEN length(CAST(a.result AS BLOB))<=? THEN a.result ELSE NULL END FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.at<=? AND j.kind IN ('pause','resume','safe-stop','inception') ORDER BY j.revision DESC LIMIT ?"
  rows=conn.execute(query,(MAX_DETAIL,MAX_DETAIL,source_at,MAX_CONTROL_ROWS+1))
  control={'entriesEnabled':None,'stopRequested':None,'changedAt':None,'reason':None};setter=None;stop_setter=None;inspected=0;unavailable=0;truncated=False;tie=False
  for index,(revision,action_id,at,kind,raw,result_raw)in enumerate(rows):
   if index>=MAX_CONTROL_ROWS:truncated=True;break
   need(time.monotonic()<=deadline,'READ_DEADLINE');inspected+=1;tie|=at==source_at
   try:d=decoded(raw);r={}if kind=='inception'and result_raw is None else decoded(result_raw)
   except(json.JSONDecodeError,TypeError,ValueError,Refused):unavailable+=1;break
   successful_resume=kind=='resume'and r.get('enabled')is True
   valid_pause=kind=='pause'and r.get('paused')is True and type(d.get('reason'))is str and 0<len(d['reason'])<=512
   valid_stop=kind=='safe-stop'and type(r.get('safeToExit'))is bool and r.get('state')==('stopped-safe'if r['safeToExit']else'management-required')
   valid_inception=kind=='inception'and at==INCEPTION and d.get('mode')=='PAPER'
   if not(successful_resume or valid_pause or valid_stop or valid_inception or kind=='resume'and r.get('enabled')is False):unavailable+=1;break
   fact={'revision':revision,'actionIdSha256':hashed(action_id),'at':at,'kind':kind}
   if setter is None and(successful_resume or valid_pause or valid_stop or valid_inception):
    control['entriesEnabled']=successful_resume;control['changedAt']=at;control['reason']=reason('explicit verified runtime readiness'if successful_resume else 'safe stop requested'if valid_stop else 'startup: observation only; explicit runtime readiness required'if valid_inception else d.get('reason'));setter=fact
   if stop_setter is None and(successful_resume or valid_stop or valid_inception):control['stopRequested']=valid_stop;stop_setter=fact
   if setter is not None and stop_setter is not None:break
  # The last successful reconciliation is reported separately from controls.
  # A newer order/attempt can set the loss pause, so do not backdate its result.
  row=conn.execute("SELECT j.revision,j.action_id,j.at,j.kind,CASE WHEN length(CAST(j.detail AS BLOB))<=? THEN j.detail ELSE NULL END,CASE WHEN length(CAST(a.result AS BLOB))<=? THEN a.result ELSE NULL END FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.at<=? AND j.kind='reconcile' ORDER BY j.revision DESC LIMIT 1",(MAX_DETAIL,MAX_DETAIL,source_at)).fetchone();reconciliation={'available':False,'expectedAt':expected_reconciliation,'matchesSnapshotTimestamp':False}
  if row is not None:
   revision,action_id,at,kind,raw,result_raw=row
   try:
    d=decoded(raw);r=decoded(result_raw);need(type(r.get('paused'))is bool,'RECONCILIATION_RESULT_UNAVAILABLE');reconciliation={'available':True,'expectedAt':expected_reconciliation,'matchesSnapshotTimestamp':at==expected_reconciliation,'ageAtSourceMs':source_at-at,'fact':sanitize_journal(revision,action_id,at,kind,d,r,None)}
   except(json.JSONDecodeError,TypeError,ValueError,Refused):pass # Reconciliation unavailability does not erase established raw controls.
  anchors.append({'sequence':sequence,'sourceGeneratedAt':source_at,'available':setter is not None and stop_setter is not None and unavailable==0 and not tie,'controls':control,'entryControlSetter':setter,'stopControlSetter':stop_setter,'inspectedControlRows':inspected,'unavailableControlRows':unavailable,'controlHistoryTruncated':truncated,'ambiguousAtSourceTimestamp':tie,'latestReconciliation':reconciliation,'sourceSnapshotRevisionBound':False,'meaning':'Committed journal event-time reconstruction only; public sequence is not a financial journal revision. Timestamp ties, missing actions or bounded history remain unavailable. Current controls are never backdated; reconciliation pausedResult is not raw controls.'})
 return anchors
def _journal(db,uid=UID,budget_seconds=1.5):
 before=metadata(db,uid);deadline=time.monotonic()+budget_seconds;conn=None
 # Active WAL needs its pre-existing shared-memory file; never ask SQLite to
 # create missing WAL infrastructure as part of this forensic read.
 wal,shm=pathlib.Path(str(db)+'-wal'),pathlib.Path(str(db)+'-shm');sidecars=[]
 for path in(wal,shm):
  try:metadata(path,uid);sidecars.append(path)
  except FileNotFoundError:pass
 need(wal not in sidecars or shm in sidecars,'EXISTING_WAL_SHARED_MEMORY_REQUIRED')
 try:
  conn=sqlite3.connect(db.as_uri()+'?mode=ro',uri=True,timeout=.025,isolation_level=None)
  conn.execute('PRAGMA query_only=ON');conn.execute('PRAGMA trusted_schema=OFF');conn.execute('PRAGMA busy_timeout=25')
  need(conn.execute('PRAGMA query_only').fetchone()==(1,)and conn.execute('PRAGMA trusted_schema').fetchone()==(0,),'SQLITE_READ_ONLY_REQUIRED')
  tables=dict(conn.execute("SELECT name,type FROM sqlite_master WHERE name IN ('financial_state','journal','actions')"));need(tables=={'financial_state':'table','journal':'table','actions':'table'},'ORIGINAL_TABLES_REQUIRED')
  def authorizer(action,a,b,_db,_source):
   if action==sqlite3.SQLITE_READ:return sqlite3.SQLITE_OK if a in('financial_state','journal','actions')else sqlite3.SQLITE_DENY
   if action==sqlite3.SQLITE_SELECT:return sqlite3.SQLITE_OK
   if action==sqlite3.SQLITE_FUNCTION:return sqlite3.SQLITE_OK if b in('length',)else sqlite3.SQLITE_DENY
   if action==sqlite3.SQLITE_TRANSACTION:return sqlite3.SQLITE_OK if a in('BEGIN','ROLLBACK')else sqlite3.SQLITE_DENY
   return sqlite3.SQLITE_DENY
  conn.set_authorizer(authorizer);conn.set_progress_handler(lambda:1 if time.monotonic()>deadline else 0,1000);conn.execute('BEGIN')
  row=conn.execute('SELECT length(CAST(body AS BLOB)),CASE WHEN length(CAST(body AS BLOB))<=? THEN body ELSE NULL END FROM financial_state WHERE singleton=1',(2*1024*1024,)).fetchone();need(row is not None and row[0]<=2*1024*1024 and row[1]is not None,'BOUNDED_ORIGINAL_STATE_REQUIRED');state=json.loads(row[1]);need(state.get('accountId')==ACCOUNT and state.get('inceptionAt')==INCEPTION and state.get('mode')=='PAPER','ORIGINAL_ACCOUNT_IDENTITY_REQUIRED')
  facts=[];truncated=False;unavailable=0;detail_bytes=0
  detail_budget={'bytes':0};entry_controls=_entry_control_anchors(conn,deadline,detail_budget);detail_bytes=detail_budget['bytes']
  for start,end in WINDOWS:
   need(time.monotonic()<=deadline,'READ_DEADLINE')
   query='SELECT revision,action_id,at,kind,CASE WHEN length(CAST(detail AS BLOB))<=? THEN detail ELSE NULL END FROM journal WHERE at>=? AND at<? AND kind IN ('+','.join('?'for _ in KINDS)+') ORDER BY revision LIMIT ?'
   rows=conn.execute(query,(MAX_DETAIL,start,end,*KINDS,MAX_ROWS+1))
   for index,(revision,action_id,at,kind,raw)in enumerate(rows):
    if index>=MAX_ROWS:truncated=True;break
    need(time.monotonic()<=deadline,'READ_DEADLINE')
    try:
     need(raw is not None,'DETAIL_BOUND');detail_bytes+=len(raw.encode());need(detail_bytes<=4*1024*1024,'TOTAL_DETAIL_BOUND');detail=json.loads(raw);result_row=conn.execute('SELECT CASE WHEN length(CAST(result AS BLOB))<=? THEN result ELSE NULL END FROM actions WHERE id=?',(MAX_DETAIL,action_id)).fetchone();result=json.loads(result_row[0])if result_row and result_row[0]is not None else {};order_detail=None
     if kind=='attempt'and type(detail)is dict and type(detail.get('orderId'))is str and len(detail['orderId'])<=100:
      order=conn.execute('SELECT CASE WHEN length(CAST(detail AS BLOB))<=? THEN detail ELSE NULL END FROM journal WHERE action_id=?',(MAX_DETAIL,'order:'+detail['orderId'])).fetchone();order_detail=json.loads(order[0])if order and order[0]is not None else None
     facts.append(sanitize_journal(revision,action_id,at,kind,detail,result,order_detail))
    except(json.JSONDecodeError,TypeError,ValueError,Refused):
     unavailable+=1
     if detail_bytes>4*1024*1024:truncated=True;break
  need(conn.total_changes==0,'SQLITE_CHANGES_REFUSED');conn.execute('ROLLBACK');need(same_inode(before,metadata(db,uid)),'ORIGINAL_LEDGER_INODE_CHANGED')
  return {'available':True,'accountId':ACCOUNT,'inceptionAt':INCEPTION,'mode':'PAPER','stateRevisionAtRead':state.get('revision')if integer(state.get('revision'))else None,'ledgerDevice':before.st_dev,'ledgerInode':before.st_ino,'queryOnly':True,'trustedSchema':False,'totalChanges':conn.total_changes,'boundedRowsPerWindow':MAX_ROWS,'truncated':truncated,'unavailableRows':unavailable,'facts':facts,'entryControlAnchors':entry_controls,'readElapsedMs':round((budget_seconds-max(0,deadline-time.monotonic()))*1000)}
 finally:
  if conn is not None:
   conn.set_progress_handler(None,0);conn.close()
def _small_scalars(value,keys):
 if type(value)is not dict:return {}
 return {k:value[k]for k in keys if k in value and(type(value[k])is bool or number(value[k]))}
def sanitize_log(row,prefix):
 if type(row)is not dict:return None
 if prefix=='publisher'and row.get('published')is True:
  if row.get('accountId')!=ACCOUNT or row.get('inceptionAt')!='2026-10-26T22:07:36.212Z'or not in_window(row.get('acknowledgedAtMs')):return None
  return {'kind':'matched-publisher-ack','at':timestamp(row.get('acknowledgedAtMs')),'sourceAt':timestamp(row.get('sourceAtMs')),'release':row.get('release')if type(row.get('release'))is str and re.fullmatch('[a-f0-9]{40}',row['release'])else None,'result':row.get('result')if row.get('result')in('accepted','duplicate')else None}
 at=row.get('at')
 if not in_window(at):return None
 if prefix=='publisher'and type(row.get('sourceAvailable'))is bool:return {'kind':'publisher-source-availability','at':at,'sourceAvailable':row['sourceAvailable'],'reason':reason(row.get('reason'))}
 kind=row.get('kind');d=row.get('data')
 if prefix!='supervisor'or kind not in('rolling-resource-sample','source-started','publisher-started','source-stop-request','source-transport-process-settlement','service-admission-write-unavailable')or type(d)is not dict:return None
 out={'kind':kind,'at':at,**_small_scalars(d,('pid','availableMemoryBytes','availableDiskBytes','parentRssBytes','healthySamples','settled','monitoringInterruption','financialManagementContinues','newRiskMustRemainClosed'))}
 if kind=='rolling-resource-sample':
  out['resource']=_small_scalars(d.get('resource'),('critical','newRiskPressure','healthy','publisherRestart'));out['rollingCpuCores']=_small_scalars(d.get('rollingCpuCores'),('source','publisher'));out['sourceSnapshotAt']=timestamp(d.get('sourceSnapshotAt'))
  p=d.get('processes');out['processes']={name:_small_scalars(p.get(name),('rssBytes','cpuSeconds','pid','members'))for name in('source','publisher')}if type(p)is dict else {}
 src=d.get('source')
 if type(src)is dict and type(src.get('commit'))is str and re.fullmatch('[a-f0-9]{40}',src['commit']):out['sourceCommit']=src['commit']
 if 'reason'in d:out['reason']=reason(d['reason'])
 return out
def _logs(directory,uid=UID,budget_seconds=3):
 results=[];facts=[];deadline=time.monotonic()+budget_seconds
 try:
  d=directory.lstat();need(directory.resolve()==directory and stat.S_ISDIR(d.st_mode)and not stat.S_ISLNK(d.st_mode)and d.st_uid==uid and stat.S_IMODE(d.st_mode)==0o700,'PRIVATE_DIAGNOSTIC_DIRECTORY_REQUIRED')
 except(OSError,Refused):return {'files':[],'facts':[],'unavailableReason':'PRIVATE_DIAGNOSTIC_DIRECTORY_UNAVAILABLE','meaning':'No historical absence or continuity can be inferred.'}
 for prefix in('source','publisher','supervisor'):
  for index in range(4):
   path=directory/(prefix+'-'+str(index)+'.log');item={'file':path.name,'available':False};results.append(item)
   if time.monotonic()>deadline:item['unavailableReason']='READ_DEADLINE';continue
   fd=None
   try:
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);before=os.fstat(fd);need(stat.S_ISREG(before.st_mode)and before.st_uid==uid and before.st_nlink==1 and stat.S_IMODE(before.st_mode)==0o600 and before.st_size<=MAX_LOG,'LOG_SHAPE_OR_BOUND')
    remaining=before.st_size;buf=b'';bad=oversized=lines=0;discarding=False;h=hashlib.sha256()
    while remaining:
     need(time.monotonic()<=deadline,'READ_DEADLINE');raw=os.read(fd,min(65536,remaining));need(bool(raw),'LOG_SHORT_READ');remaining-=len(raw);h.update(raw);buf+=raw
     while b'\n'in buf:
      line,buf=buf.split(b'\n',1);lines+=1
      if lines%64==0:need(time.monotonic()<=deadline,'READ_DEADLINE')
      if discarding:discarding=False;continue
      if len(line)>MAX_LINE:oversized+=1;continue
      try:fact=sanitize_log(json.loads(line),prefix)
      except(ValueError,TypeError,RecursionError):bad+=1;continue
      if fact is not None and len(facts)<MAX_FACTS:facts.append({'file':path.name,**fact})
     if len(buf)>MAX_LINE:buf=b'';oversized+=1;discarding=True
    after=os.fstat(fd);item.update(available=True,bytesRead=before.st_size,sha256=h.hexdigest(),lines=lines,malformedLines=bad,oversizedFragments=oversized,trailingFragmentBytes=len(buf),trailingFragmentDiscarded=discarding,changedDuringRead=(before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns))
   except(FileNotFoundError,PermissionError,OSError,Refused):item['unavailableReason']='FILE_UNAVAILABLE_OR_BOUND'
   finally:
    if fd is not None:os.close(fd)
 return {'files':results,'facts':facts,'maximumFacts':MAX_FACTS,'factCapacityReached':len(facts)>=MAX_FACTS,'meaning':'Bounded surviving duplicate logs only. Rotation/restart can erase this interval; no matching facts is not proof of no incident. Source console is not the essential evidence stream.'}
def _publish(output,value,uid=UID):
 parent=output.parent;before=parent.lstat();need(stat.S_ISDIR(before.st_mode)and not stat.S_ISLNK(before.st_mode)and before.st_uid==uid and not before.st_mode&0o022 and parent.resolve()==parent,'EXISTING_PUBLIC_DIRECTORY_REQUIRED')
 raw=json.dumps(value,separators=(',',':'),allow_nan=False).encode()+b'\n';need(len(raw)<=MAX_OUTPUT,'SANITIZED_OUTPUT_BOUND');fd_dir=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);tmp='.reporting-forensics-20261029.'+str(os.getpid())+'.pending';fd=None
 try:
  need(same_inode(before,os.fstat(fd_dir)),'PUBLIC_DIRECTORY_CHANGED')
  try:old=os.stat(output.name,dir_fd=fd_dir,follow_symlinks=False);need(stat.S_ISREG(old.st_mode)and old.st_uid==uid and old.st_nlink==1,'FORENSIC_OUTPUT_SHAPE')
  except FileNotFoundError:pass
  fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=fd_dir);os.fchmod(fd,0o644);offset=0
  while offset<len(raw):n=os.write(fd,raw[offset:]);need(n>0,'OUTPUT_SHORT_WRITE');offset+=n
  os.fsync(fd);os.close(fd);fd=None;os.replace(tmp,output.name,src_dir_fd=fd_dir,dst_dir_fd=fd_dir);os.fsync(fd_dir)
 finally:
  if fd is not None:os.close(fd)
  os.close(fd_dir)
 return {'path':str(output),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
def main():
 need(len(sys.argv)==1,'NO_ARGUMENTS_ACCEPTED');drop_original_identity()
 result={'schemaVersion':1,'kind':'POE_ORIGINAL_SANITIZED_REPORTING_FORENSICS','generatedAt':int(time.time()*1000),'accountId':ACCOUNT,'inceptionAt':INCEPTION,'readerUid':os.getuid(),'readerGid':os.getgid(),'windows':[{'fromAt':start,'untilAtExclusive':end,'fromUtc':iso(start),'untilUtcExclusive':iso(end)}for start,end in WINDOWS],'financialWrites':0,'serviceControlOperations':0,'credentialReads':0,'essentialEvidenceRead':False,'limitations':['No original payloads, cash, quantities, wallet/provider strings or arbitrary reasons are exported.','No SQL financial mutation; a live WAL reader can take SQLite shared-memory read locks. No checkpoint or journal-mode change is issued.','A failed reconciliation is not journaled by the application; pause/result facts and missing success intervals may explain it but cannot invent its failed inputs.','Price and mark freshness fields describe timestamps only, not independently validated availability.','Essential service evidence is intentionally not read in this first bounded export.','Current state identity only is read; it is never backdated into historical state.']}
 try:result['journal']=_journal(DB)
 except(OSError,sqlite3.Error,ValueError,Refused):result['journal']={'available':False,'reason':'READ_ONLY_JOURNAL_UNAVAILABLE_OR_BOUND','financialWrites':0}
 result['diagnostics']=_logs(DIAGNOSTICS);receipt=_publish(OUTPUT,result);print(json.dumps({'kind':'POE_FORENSICS_EXPORT_RECEIPT','readerUid':os.getuid(),'readerGid':os.getgid(),'financialWrites':0,**receipt}))
if __name__=='__main__':
 try:main()
 except(Exception):print(json.dumps({'kind':'POE_FORENSICS_EXPORT_REFUSED','reason':'ACCESS_IDENTITY_INPUT_OR_OUTPUT_VALIDATION_FAILED','financialWrites':0,'serviceChanges':0}));sys.exit(1)
