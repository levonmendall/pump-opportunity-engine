#!/usr/bin/env python3
"""Finalize reviewed admission bookkeeping; no runtime or financial access."""
from pathlib import Path
import subprocess
base='81fd475449eb10502a9f2f18d2ff15491a7497f3'
p=Path('src/native-candidate-runner.ts');raw=p.read_bytes()
if raw!=subprocess.check_output(['git','show',base+':'+str(p)]):raise SystemExit('EXACT_REVIEWED_SOURCE_REQUIRED')
s=raw.decode()
def change(old,new):
 global s
 if s.count(old)!=1:raise ValueError('EXACT_ANCHOR_REQUIRED:'+old[:100])
 s=s.replace(old,new)
change(' private stopped=false;private working=false;',' private registryHousekeepingDeferred=false;\n private stopped=false;private working=false;')
change("  try{work();}catch(error){\n   if(!isMarketRegistryContention(error))throw error;\n   this.record('native-candidate-housekeeping-deferred',{at:this.now(),phase,reason:'MARKET_REGISTRY_CONTENTION',sqliteCode:error.sqliteCode,callbackStarted:false,providerPermissionGranted:false,financialPermission:false});", "  if(this.registryHousekeepingDeferred)return;\n  try{work();}catch(error){\n   if(!isMarketRegistryContention(error))throw error;\n   this.registryHousekeepingDeferred=true;\n   this.record('native-candidate-registry-contention',{at:this.now(),phase,reason:'MARKET_REGISTRY_CONTENTION',sqliteCode:error.sqliteCode,callbackStarted:false,providerRequestStarted:false,financialExposure:false,optionalHousekeepingDeferred:true});")
change("  if(!this.open()||this.working)return 'closed';this.working=true;", "  if(!this.open()||this.working)return 'closed';this.working=true;this.registryHousekeepingDeferred=false;")
p.write_text(s)
subprocess.run(['git','diff','--check'],check=True)
print('Preserved existing diagnostics and deferred later optional writer attempts for this turn.')
