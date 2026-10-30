"""Offline indexed minute ranges. No connecting/interpolated price path or fills."""
from pathlib import Path
import json,datetime
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as dates
from matplotlib.lines import Line2D
from matplotlib.patches import Patch
root=Path('evidence/opportunity-coverage-20261027')
periods=json.load(open(root/'reference-current-indexed-cohort.json'))['recordedPeriods']
fig,axes=plt.subplots(2,1,figsize=(12,7.5),layout='constrained')
for ax,file,title,elig_start,elig_end in [
 (axes[0],'si-minute-ohlcv.json','SI: major rally precedes the 21:19 view','2026-10-27T20:26:11+00:00','2026-10-27T22:21:11+00:00'),
 (axes[1],'frongus-minute-ohlcv.json','FRONGUS: major rally overlaps the 22:08–22:29 research interval','2026-10-27T21:18:41+00:00','2026-10-27T23:13:41+00:00')]:
 bars=sorted(json.load(open(root/'reference-raw'/file))['data']['attributes']['ohlcv_list'])
 for p in periods:
  a=datetime.datetime.fromtimestamp(p['startedAt']/1000,datetime.timezone.utc);b=datetime.datetime.fromtimestamp(p['endedAt']/1000,datetime.timezone.utc)
  ax.axvspan(a,b,color='#1b9e77',alpha=.12,zorder=0)
 for t,o,h,l,c,v in bars:
  mid=datetime.datetime.fromtimestamp(t+30,datetime.timezone.utc);close=datetime.datetime.fromtimestamp(t+60,datetime.timezone.utc)
  ax.vlines(mid,l,h,color='#455a64',linewidth=1)
  ax.scatter(close,c,s=9,color='#1565c0',zorder=3)
 for x in [elig_start,elig_end]:ax.axvline(datetime.datetime.fromisoformat(x),color='#ab47bc',linestyle='--',linewidth=.9)
 ax.set_yscale('log');ax.set_ylabel('Indexed USD price (log)');ax.set_title(title,fontsize=11,loc='left');ax.grid(True,alpha=.16)
 ax.set_xlim(datetime.datetime.fromtimestamp(bars[0][0]-120,datetime.timezone.utc),datetime.datetime.fromtimestamp(bars[-1][0]+180,datetime.timezone.utc));ax.xaxis.set_major_locator(dates.MinuteLocator(byminute=[0,20,40]));ax.xaxis.set_major_formatter(dates.DateFormatter('%H:%M',tz=datetime.timezone.utc));ax.set_xlabel('2026-10-27 UTC')
axes[0].axvline(datetime.datetime.fromisoformat('2026-10-27T21:19:30+00:00'),color='#c62828',linewidth=1)
axes[0].text(.37,.94,'21:19:30 view',transform=axes[0].transAxes,color='#c62828',fontsize=8)
fig.legend(handles=[Patch(facecolor='#1b9e77',alpha=.15,label='Research runtime active (not proof this token was selected)'),Line2D([0],[0],marker='o',color='#1565c0',linestyle='None',markersize=4,label='Reported minute close'),Line2D([0],[0],color='#455a64',label='Reported minute low–high range'),Line2D([0],[0],color='#ab47bc',linestyle='--',label='Provisional 5 min–2 h eligibility')],loc='outside lower center',ncols=2,fontsize=8)
fig.suptitle('Independent historical price/activity leads — not executable quotes or modeled profit',fontsize=12)
fig.savefig(root/'independent-history-timing.png',dpi=160)
print(root/'independent-history-timing.png')
