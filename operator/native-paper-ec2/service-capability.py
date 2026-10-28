#!/usr/bin/env python3
"""Bounded read-only startup capability inventory; never starts a service."""
import hashlib,json,os,pathlib,pwd,re,stat,subprocess,time
UID=994
FIELDS=('LoadState','ActiveState','SubState','MainPID','NRestarts','User','UnitFileState')
UNITS=('poe-runtime.service','poe-native-paper.service','poe-native-paper-reporting.service','user@994.service')
class Refusal(RuntimeError):pass
def need(value,code):
 if not value:raise Refusal(code)
def command(args,env=None):
 try:r=subprocess.run(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=3,env=env or {'PATH':'/usr/bin:/bin','LANG':'C'},check=False)
 except subprocess.TimeoutExpired:return {'exitCode':None,'timedOut':True,'stdoutBytes':0,'stderrBytes':0,'stdoutSha256':None,'stderrSha256':None},''
 out=r.stdout;err=r.stderr
 receipt={'exitCode':r.returncode,'timedOut':False,'stdoutBytes':len(out),'stderrBytes':len(err),'stdoutSha256':hashlib.sha256(out).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest()}
 need(len(out)<=16384 and len(err)<=4096,'CAPABILITY_RESPONSE_BOUND')
 return receipt,out.decode('utf8','replace')
def properties(text,allowed):
 rows={}
 for line in text.splitlines():
  key,sep,value=line.partition('=')
  if sep and key in allowed and len(value)<=256 and '\x00'not in value:rows[key]=value
 return rows
def path_status(path):
 try:s=path.lstat()
 except FileNotFoundError:return {'exists':False}
 return {'exists':True,'uid':s.st_uid,'mode':stat.S_IMODE(s.st_mode),'directory':stat.S_ISDIR(s.st_mode),'socket':stat.S_ISSOCK(s.st_mode),'symlink':stat.S_ISLNK(s.st_mode)}
def sudo_metadata(text):
 # Keep policy output private: only expose exact relevant capability booleans.
 nopass=[line.strip() for line in text.splitlines()if 'NOPASSWD:'in line]
 all_commands=any(re.search(r'NOPASSWD:\s*ALL\s*$',line)is not None for line in nopass)
 allowed_start=all_commands or any(re.search(r'NOPASSWD:.*(?:/usr/bin/)?systemctl\s+(?:start|restart|enable(?:\s+--now)?)\s+poe-native-paper(?:-reporting)?\.service(?:\s|$)',line)is not None for line in nopass)
 return {'passwordlessAllCommandsExplicit':all_commands,'passwordlessPoeNativePaperStartExplicit':allowed_start,'policyTextExported':False,'permissionsChanged':False}
def inspect():
 need(os.getuid()==UID and pwd.getpwuid(UID).pw_name=='mm-ec2-runner'and os.environ.get('ACTUAL_RUNNER')=='meme-machine-ec2-admin','FIXED_NONROOT_RUNNER_REQUIRED')
 began=time.monotonic();units={};receipts=[]
 for name in UNITS:
  r,text=command(['/usr/bin/systemctl','show',name,'--property='+','.join(FIELDS)]);receipts.append({'purpose':'system-unit:'+name,**r});units[name]=properties(text,FIELDS)
 r,text=command(['/usr/bin/loginctl','show-user','mm-ec2-runner','--property=Linger,State,RuntimePath']);receipts.append({'purpose':'user-session',**r});session=properties(text,('Linger','State','RuntimePath'))
 runtime=pathlib.Path('/run/user/994');runtime_status=path_status(runtime);bus_status=path_status(runtime/'bus');user_manager={'attempted':False,'properties':{}}
 if runtime_status.get('directory')and runtime_status.get('uid')==UID and not runtime_status.get('symlink')and runtime_status.get('mode',0)&0o077==0 and bus_status.get('socket')and bus_status.get('uid')==UID and not bus_status.get('symlink'):
  r,text=command(['/usr/bin/systemctl','--user','show','poe-native-paper.service','--property='+','.join(FIELDS)],{'PATH':'/usr/bin:/bin','LANG':'C','XDG_RUNTIME_DIR':'/run/user/994','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/994/bus'});receipts.append({'purpose':'existing-user-manager',**r});user_manager={'attempted':True,'querySucceeded':r['exitCode']==0,'properties':properties(text,FIELDS)}
 r,text=command(['/usr/bin/sudo','-n','-l']);receipts.append({'purpose':'read-only-sudo-policy',**r});sudo=sudo_metadata(text)if r['exitCode']==0 else {'policyAvailable':False,'policyTextExported':False,'permissionsChanged':False}
 r,text=command(['/usr/bin/systemctl','show','poe-runtime.service','--property='+','.join(FIELDS)]);receipts.append({'purpose':'original-service-after',**r});after=properties(text,FIELDS)
 return {'schemaVersion':1,'kind':'POE_PERSISTENT_STARTUP_CAPABILITIES','checkedAt':int(time.time()*1000),'uid':UID,'systemUnits':units,'userSession':session,'runtimeDirectory':runtime_status,'userBus':bus_status,'existingUserManager':user_manager,'sudoPolicy':sudo,'originalServiceBeforeAfterUnchanged':units['poe-runtime.service']==after,'originalServiceAfter':after,'receipts':receipts,'elapsedMs':round((time.monotonic()-began)*1000),'serviceStarts':0,'serviceChanges':0,'permissionChanges':0,'credentialReads':0,'financialFilesRead':False,'providerRequests':0,'ownerActionDetermined':False,'meaning':'Capability metadata only; a loaded unit or sudo-list entry is not proof of a successful install/start. No privileged mutation was attempted.'}
if __name__=='__main__':
 try:print(json.dumps(inspect(),separators=(',',':')),flush=True)
 except (Refusal,PermissionError,FileNotFoundError)as e:print(json.dumps({'kind':'POE_STARTUP_CAPABILITY_REFUSED','reason':str(e)if isinstance(e,Refusal)else'TOOL_OR_METADATA_UNAVAILABLE','serviceChanges':0,'credentialReads':0,'financialFilesRead':False}),flush=True);raise SystemExit(1)
