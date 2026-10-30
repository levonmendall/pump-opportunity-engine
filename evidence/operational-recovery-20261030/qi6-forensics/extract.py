import json,pathlib,datetime,re
KEY='qi6wtTo9jZhkGcokNrjNNnBSjt12sUxgNyhWuUUpump'
points={}; matching=[]; rawfacts=[]
def walk(d,path,ctx=None):
 if isinstance(d,dict):
  positions=d.get('positions');times=d.get('times') or {};at=d.get('sourceAt') or times.get('generatedAt') or d.get('generatedAt') or d.get('at')
  if isinstance(positions,list):
   ps=[p for p in positions if isinstance(p,dict) and p.get('mint')==KEY]
   if ps:
    item={'at':at,'file':str(path),'positions':ps,'status':d.get('status'),'balances':d.get('balances'),'source':d.get('source') or d.get('release'),'protection':d.get('protection') or d.get('intelligence',{}).get('protection'),'limitations':(d.get('quality') or d.get('intelligence',{}).get('quality',{})).get('limitations')}
    points[json.dumps([at,ps],sort_keys=True)]=item
  if d.get('mint')==KEY and any(k in d for k in ['quote','quoteLamports','netLamports','inputUnits','pool','reserves','baseDecimals','decimals','features']):rawfacts.append({'file':str(path),'fact':d})
  for v in d.values():walk(v,path,d)
 elif isinstance(d,list):
  for v in d:walk(v,path,ctx)
for p in pathlib.Path('/workspace/poe-active/evidence').rglob('*'):
 if not p.is_file() or p.suffix not in ['.json','.ndjson','.jsonl']:continue
 try:
  txt=p.read_text()
  if KEY not in txt:continue
  matching.append(str(p))
  if p.suffix in ['.ndjson','.jsonl']:
   for line in txt.splitlines():
    try:walk(json.loads(line),p)
    except ValueError:pass
  else:walk(json.loads(txt),p)
 except (OSError,UnicodeError,ValueError):pass
rows=sorted(points.values(),key=lambda r:str(r['at']))
json.dump({'files':matching,'points':rows,'rawfacts':rawfacts},open('/workspace/poe-audit/qi6-forensics/retained-extraction.json','w'),indent=2)
print('files',len(matching),'points',len(rows),'rawfacts',len(rawfacts))
for r in rows[::max(1,len(rows)//30)]:print(r['at'],json.dumps(r['positions']),r['status'])
print('LATEST',rows[-1] if rows else None)
print('RAW',json.dumps(rawfacts)[:5000])
