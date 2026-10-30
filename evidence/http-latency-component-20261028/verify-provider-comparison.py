#!/usr/bin/env python3
"""Offline receipt reconciliation only. Never contacts a provider or a ledger."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORT = json.loads((ROOT / 'PROVIDER_FAILURE_COMPARISON.json').read_text())
DIRECTORIES = [
    'live-40776522997',
    'live-40777452497-page20',
    'live-40778700703-publicnode',
]
assert len(REPORT['rows']) == len(DIRECTORIES) == 3
for expected, directory in zip(REPORT['rows'], DIRECTORIES):
    path = ROOT / directory / 'records.json'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected['recordsSha256']
    component, host = json.loads(path.read_text())
    assert component['requests'] == len(component['rows']) == 9
    assert component['historyRequests'] == 6 and component['clockRequests'] == 3
    assert component['receivedResponseBytes'] == expected['measuredResponseBytes']
    assert component['uncertainResponseBytes'] == expected['uncertainResponseBytesRetained']
    assert not component['recovery']['unresolvedProviderCooldown']
    assert all(row['physicalSettlementConfirmed'] for row in component['rows'])
    assert all(row.get('httpStatus') not in (429, 503) for row in component['rows'])
    assert host['sourceGroupSettled'] and host['sourceExit'] == 0
    assert host['originalObserverUnchanged'] and host['metadataUnits'] == 2
    assert not host['financialFilesModified'] and not host['financialDatabaseRead']
    assert host['sourceSha256'] == expected['probeSha256']
    assert host['planSha256'] == expected['planSha256']
assert sum(row['physicalProviderRequests'] for row in REPORT['rows']) == 27
assert sum(row['measuredResponseBytes'] for row in REPORT['rows']) == 250238
assert sum(row['uncertainResponseBytesRetained'] for row in REPORT['rows']) == 12582912
assert REPORT['sourceBookBaselineUnits'] + 27 == REPORT['knownAggregateSolanaUnits'] == 8569
assert REPORT['oldSourceAccountedCumulativeResponseBytes'] + 12833150 == REPORT['knownCombinedAccountedResponseBytes']
assert REPORT['oldSourceUncertainResponseBytes'] + 12582912 == REPORT['knownCombinedUncertainResponseBytes']
print('PASS: 3 settled receipts;27 Solana starts;250238 measured and12582912 retained uncertain bytes; no network/ledger access')
