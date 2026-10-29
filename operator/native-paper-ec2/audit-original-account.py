#!/usr/bin/env python3
"""Read-only exact original POE identity/journal/ownership audit.

Run through existing owner/root access or as the existing poe-runtime user.
No initialization, state import, checkpoint, service command, wallet, secret or
provider operation occurs. An active WAL is included by SQLite's RO snapshot.
"""
import contextlib,errno,fcntl,hashlib,json,os,pathlib,pwd,sqlite3,stat,subprocess,sys,time
ACCOUNT='poe-3123e352-4581-455b-85db-acd7e825e99e'
INCEPTION=1793052456212
INCEPTION_ISO='2026-10-26T22:07:36.212Z'
DB=pathlib.Path('/var/lib/poe/state/ledger.sqlite')
PUBLIC=pathlib.Path('/var/lib/poe-public/status.json')
MIB=1024*1024
class Refused(RuntimeError):pass
def need(value,code):
 if not value:raise Refused(code)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def integer(value):return type(value)is int and value>=0
def amount(v,signed=False):
 import re
 need(type(v)is str and re.fullmatch('-?(0|[1-9][0-9]{0,38})'if signed else'0|[1-9][0-9]{0,38}',v)is not None,'CANONICAL_FINANCIAL_AMOUNT_REQUIRED');return int(v)
def file_metadata(path,uid=None,private=False):
 try:s=path.lstat()
 except FileNotFoundError:return {'exists':False}
 need(stat.S_ISREG(s.st_mode)and not stat.S_ISLNK(s.st_mode)and s.st_nlink==1,'REGULAR_SINGLE_LINK_FILE_REQUIRED')
 need(uid is None or s.st_uid==uid,'FINANCIAL_FILE_OWNER_MISMATCH');need(not private or stat.S_IMODE(s.st_mode)==0o600,'PRIVATE_FINANCIAL_MODE_REQUIRED')
 return {'exists':True,'ownerUid':s.st_uid,'mode':stat.S_IMODE(s.st_mode),'bytes':s.st_size,'device':s.st_dev,'inode':s.st_ino,'mtimeNs':s.st_mtime_ns}
def read_regular(path,limit,uid,mode):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode)and s.st_nlink==1 and s.st_uid==uid and stat.S_IMODE(s.st_mode)==mode and 0<s.st_size<=limit,'BOUNDED_EXACT_OWNER_READ_REQUIRED');raw=os.read(fd,s.st_size+1);a=os.fstat(fd);need(len(raw)==s.st_size and(s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(a.st_size,a.st_mtime_ns,a.st_ctime_ns),'AUDIT_INPUT_CHANGED');return raw
 finally:os.close(fd)
@contextlib.contextmanager
def original_owner(uid,gid):
 """Legitimate root-only privilege drop; SQLite auxiliaries remain app-owned."""
 need(type(uid)is int and uid>0 and type(gid)is int and gid>=0,'ORIGINAL_NONROOT_SQLITE_OWNER_REQUIRED');before_uid=os.geteuid();before_gid=os.getegid();before_groups=os.getgroups();need(before_uid in[0,uid],'ORIGINAL_SQLITE_OWNER_ACCESS_REQUIRED');dropped=before_uid==0
 if not dropped:
  need(os.getegid()==gid,'ORIGINAL_SQLITE_GROUP_REQUIRED');yield;return
 try:
  os.setgroups([]);os.setegid(gid);os.seteuid(uid)
  try:
   need(os.geteuid()==uid and os.getegid()==gid,'ORIGINAL_SQLITE_OWNER_CONTEXT_REQUIRED');yield
  finally:os.seteuid(0)
 finally:
  os.setegid(before_gid);os.setgroups(before_groups)
def service_status():
 r=subprocess.run(['/usr/bin/systemctl','show','poe-runtime.service','--property=MainPID,NRestarts,User,Group,LoadState,ActiveState,SubState,UnitFileState'],capture_output=True,text=True,timeout=5,env={'PATH':'/usr/bin:/bin','LANG':'C'},check=False);need(r.returncode==0 and len(r.stdout)<=4096 and len(r.stderr)<=4096,'ORIGINAL_SERVICE_METADATA_UNAVAILABLE');allowed={'MainPID','NRestarts','User','Group','LoadState','ActiveState','SubState','UnitFileState'};return{key:value for line in r.stdout.splitlines()for key,sep,value in[line.partition('=')]if sep and key in allowed}
def process_ownership(database,owner_lock,uid,proc=pathlib.Path('/proc')):
 rows=[];unavailable=0;scanned=0
 for path in proc.iterdir():
  if not path.name.isdigit()or int(path.name)==os.getpid():continue
  scanned+=1;need(scanned<=4096,'PROCESS_CENSUS_BOUND')
  try:
   if path.stat().st_uid!=uid:continue
   descriptors=list((path/'fd').iterdir());need(len(descriptors)<=256,'FINANCIAL_FD_CENSUS_BOUND');has_db=has_lock=False
   for fd in descriptors:
    try:fs=fd.stat()
    except(FileNotFoundError,ProcessLookupError,PermissionError):continue
    has_db=has_db or(fs.st_dev,fs.st_ino)==(database['device'],database['inode']);has_lock=has_lock or(fs.st_dev,fs.st_ino)==(owner_lock['device'],owner_lock['inode'])
   if has_db or has_lock:
    cg=(path/'cgroup').read_text();need(len(cg)<=8192,'PROCESS_CGROUP_BOUND');rows.append({'pid':int(path.name),'hasDatabaseFd':has_db,'hasOwnerLockFd':has_lock,'sameOriginalServiceCgroup':'/system.slice/poe-runtime.service'in cg})
  except(FileNotFoundError,ProcessLookupError,PermissionError):unavailable+=1
 return {'processes':rows,'unavailableOwnedProcesses':unavailable,'databaseAndOwnerFdCandidates':sum(r['hasDatabaseFd']and r['hasOwnerLockFd']for r in rows),'meaning':'Own-user descriptor metadata, not process environment or command contents. Flock probe separately establishes whether some owner holds the lease.'}
def audit_snapshot(db,existing_transaction=False):
 db.execute('PRAGMA query_only=ON');db.execute('PRAGMA trusted_schema=OFF');db.execute('PRAGMA busy_timeout=1000')
 if existing_transaction:need(db.in_transaction,'EXISTING_READ_ONLY_SNAPSHOT_REQUIRED')
 else:db.execute('BEGIN')
 try:
  need(db.execute('PRAGMA query_only').fetchone()==(1,),'READ_ONLY_CONNECTION_REQUIRED');need(db.execute('PRAGMA quick_check').fetchone()==('ok',),'ORIGINAL_LEDGER_QUICK_CHECK_FAILED')
  tables={r[0]for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")};need(tables=={'financial_state','actions','journal','metadata'},'ORIGINAL_LEDGER_SCHEMA_MISMATCH')
  row=db.execute('SELECT body FROM financial_state WHERE singleton=1').fetchone();need(row is not None and type(row[0])is str and 0<len(row[0].encode())<=2*MIB,'FINANCIAL_STATE_BOUND');raw=row[0].encode();state=json.loads(raw)
  need(state.get('schemaVersion')==1 and state.get('accountId')==ACCOUNT and state.get('mode')=='PAPER'and state.get('inceptionAt')==INCEPTION and state.get('initialMicroUsd')=='1000000000','EXACT_ORIGINAL_ACCOUNT_REQUIRED')
  revision=state.get('revision');need(integer(revision),'ORIGINAL_REVISION_REQUIRED');counts={name:db.execute('SELECT count(*) FROM '+name).fetchone()[0]for name in sorted(tables)};need(counts['financial_state']==1 and counts['actions']==revision and counts['journal']==revision+1,'FINANCIAL_JOURNAL_COUNTS_MISMATCH');need(db.execute('SELECT min(revision),max(revision) FROM journal').fetchone()==(0,revision),'FINANCIAL_JOURNAL_RANGE_MISMATCH')
  need(db.execute('SELECT count(*) FROM actions a LEFT JOIN journal j ON j.action_id=a.id WHERE j.action_id IS NULL').fetchone()==(0,)and db.execute('SELECT count(*) FROM journal j LEFT JOIN actions a ON a.id=j.action_id WHERE j.revision>0 AND a.id IS NULL').fetchone()==(0,),'ACTION_JOURNAL_LINK_MISMATCH')
  positions=state.get('positions');pending=state.get('pending');deposits=state.get('lockedDeposits');need(type(positions)is dict and type(pending)is dict and type(deposits)is dict,'OWNERSHIP_STATE_REQUIRED');cash=amount(state['lamports']);reserved=sum(amount(v['reserved'])for v in pending.values());locked=sum(amount(v)for v in deposits.values());need(reserved<=cash,'RESERVATIONS_EXCEED_CASH')
  price=state['inceptionPrice'];need(type(price)is dict and integer(price.get('at'))and price['at']<=INCEPTION and amount(price['microUsdPerSol'])>0,'INCEPTION_PRICE_INVALID');initial_lamports=1000000000*1000000000//amount(price['microUsdPerSol']);need(amount(state['roundingResidualMicroUsd'])==1000000000-initial_lamports*amount(price['microUsdPerSol'])//1000000000,'INCEPTION_VALUE_REWRITTEN')
  controls=state.get('controls');daily=state.get('daily');need(type(controls)is dict and type(daily)is dict and type(controls.get('entriesEnabled'))is bool and type(controls.get('stopRequested'))is bool,'CONTROL_STATE_INVALID')
  result={'accountId':ACCOUNT,'inceptionAt':INCEPTION,'inceptionIso':INCEPTION_ISO,'initialMicroUsd':'1000000000','mode':'PAPER','revision':revision,'stateBodySha256':digest(raw),'stateBodyBytes':len(raw),'tableCounts':counts,'quickCheck':'ok','journalRangeContiguous':True,'actionJournalLinksValid':True,'inceptionPriceSha256':digest(json.dumps(price,sort_keys=True,separators=(',',':')).encode()),'inceptionLamports':str(initial_lamports),'roundingResidualMicroUsd':state['roundingResidualMicroUsd'],'cashLamports':state['lamports'],'reservedLamports':str(reserved),'lockedDepositLamports':str(locked),'openPositions':len(positions),'pendingActions':len(pending),'positionsStateSha256':digest(json.dumps(positions,sort_keys=True,separators=(',',':')).encode()),'pendingStateSha256':digest(json.dumps(pending,sort_keys=True,separators=(',',':')).encode()),'realizedLamports':str(amount(state['realizedLamports'],True)),'executionCostsLamports':str(amount(state['executionCosts'])),'gasReserveLamports':str(amount(state['gasReserve'])),'financialControls':{key:controls.get(key)for key in['entriesEnabled','stopRequested','changedAt','readinessVersion']},'controlReasonSha256':digest(str(controls.get('reason','')).encode()),'dailyControls':{key:daily.get(key)for key in['day','paused','lossPaused','reconciledAt']},'flatAtSnapshot':not positions and not pending and reserved==0,'metadataValuesExported':False,'rawStateExported':False,'walletFilesRead':False}
  return result
 finally:
  if not existing_transaction:db.execute('ROLLBACK')
def main():
 need(len(sys.argv)==1,'AUDIT_ACCEPTS_NO_ALTERNATE_ACCOUNT_OR_PATH');uid=pwd.getpwnam('poe-runtime').pw_uid;need(uid!=0 and os.getuid()in[0,uid],'EXISTING_OWNER_ACCESS_REQUIRED');before=service_status();need(before.get('User')=='poe-runtime','ORIGINAL_SERVICE_USER_MISMATCH');need(DB.resolve(strict=True)==DB and DB.parent.resolve(strict=True)==DB.parent,'ORIGINAL_LEDGER_CANONICAL_PATH_REQUIRED');parent=DB.parent.lstat();need(stat.S_ISDIR(parent.st_mode)and parent.st_uid==uid and stat.S_IMODE(parent.st_mode)==0o700,'ORIGINAL_LEDGER_DIRECTORY_REQUIRED');dbmeta=file_metadata(DB,uid,True);need(dbmeta['exists'],'ORIGINAL_LEDGER_MUST_ALREADY_EXIST')
 fd=os.open(DB,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  locked=file_metadata(pathlib.Path(str(DB)+'.owner.lock'),uid,True);need(locked['exists'],'ORIGINAL_OWNER_LOCK_REQUIRED');lease=os.open(str(DB)+'.owner.lock',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
  try:
   try:fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB);owner_held=False;fcntl.flock(lease,fcntl.LOCK_UN)
   except BlockingIOError:owner_held=True
  finally:os.close(lease)
  with original_owner(uid,pwd.getpwnam('poe-runtime').pw_gid):
   db=sqlite3.connect('file:'+str(DB)+'?mode=ro',uri=True,timeout=1)
   try:result=audit_snapshot(db)
   finally:db.close()
  current=DB.lstat();need((current.st_dev,current.st_ino)==(dbmeta['device'],dbmeta['inode'])and(current.st_dev,current.st_ino)==(os.fstat(fd).st_dev,os.fstat(fd).st_ino),'ORIGINAL_LEDGER_INODE_CHANGED')
 finally:os.close(fd)
 ownership=process_ownership(dbmeta,locked,uid);after=service_status();sidecars={suffix:file_metadata(pathlib.Path(str(DB)+suffix),uid,True)for suffix in['-wal','-shm','-journal']};status=json.loads(read_regular(PUBLIC,4096,uid,0o644));need(status.get('accountId')==ACCOUNT and status.get('inceptionAt')==INCEPTION_ISO,'ORIGINAL_PUBLIC_IDENTITY_MISMATCH');safe_public={key:status.get(key)for key in['accountId','inceptionAt','release','strategy','generatedAt','entriesDisabled','flowVerified','reportingConfigured']}
 print(json.dumps({'schemaVersion':1,'kind':'POE_ORIGINAL_ACCOUNT_READ_ONLY_AUDIT','auditedAt':int(time.time()*1000),'ledgerPath':str(DB),'financial':result,'databaseMetadata':dbmeta,'walJournalMetadata':sidecars,'financialOwnerLockHeld':owner_held,'processOwnership':ownership,'serviceBefore':before,'serviceAfter':after,'serviceUnchanged':before==after,'publicStatus':safe_public,'financialWrites':0,'serviceChanges':0,'credentialReads':0,'providerRequests':0,'snapshotMeaning':'Consistent SQLite read-only transaction includes current WAL. Active observer may advance after this exact revision; physical DB hash is intentionally not claimed while writable. No original records are copied or reseeded.'},separators=(',',':')))
if __name__=='__main__':
 try:main()
 except(Refused,OSError,ValueError,sqlite3.Error,subprocess.SubprocessError)as e:print(json.dumps({'kind':'POE_ORIGINAL_ACCOUNT_AUDIT_REFUSED','reason':str(e)if isinstance(e,Refused)else'PRIVILEGED_READ_OR_SCHEMA_UNAVAILABLE','financialWrites':0,'serviceChanges':0,'credentialReads':0}),flush=True);raise SystemExit(1)
