#!/usr/bin/env python3
"""Meaningful read-only/WAL/privacy/upgrade diagnostics regressions."""
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('diag',pathlib.Path(__file__).with_name('export-operational-diagnostics.py'))
diag=importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)

class ReadOnlyDiagnostics(unittest.TestCase):
    def event_file(self,root,name,kind,times):
        p=root/name
        p.write_text(''.join(json.dumps({'receivedAt':at,'kind':kind,
                                        'data':{'at':at,'usable':True}})+'\n' for at in times))
        return p

    def test_committed_wal_state_is_seen_without_mutating_or_checkpointing(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            (root/'state').mkdir()
            p=root/'state/ledger.sqlite'
            db=sqlite3.connect(p)
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA wal_autocheckpoint=0')
            db.executescript('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT); CREATE TABLE actions(id TEXT PRIMARY KEY,payload_hash TEXT,result TEXT); CREATE TABLE journal(revision INTEGER PRIMARY KEY,action_id TEXT,at INTEGER,kind TEXT,detail TEXT);')
            state={'accountId':diag.ACCOUNT,'inceptionAt':diag.INCEPTION,'mode':'PAPER',
                   'revision':9,'positions':{},'pending':{},'lockedDeposits':{},
                   'controls':{'entriesEnabled':False,'reason':'TOKEN=https://private/?secret=VALUE'},
                   'daily':{'lossPaused':True,'paused':True}}
            db.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps(state),))
            db.execute("INSERT INTO journal VALUES(9,'sample',100,'pause',?)",(json.dumps({'reason':'http://secret/token'}),))
            db.commit()
            before_wal=(p.with_name(p.name+'-wal')).read_bytes()
            # A separate uncommitted writer is not observed, and is not blocked
            # or implicitly committed by the diagnostic read transaction.
            db.execute("UPDATE financial_state SET body=?",(json.dumps(dict(state,revision=10)),))
            value=diag.ledger_projection(p,0,200)
            self.assertEqual(value['revision'],9)
            self.assertEqual(value['journalRows'],1)
            self.assertTrue(value['daily']['lossPaused'])
            self.assertEqual(before_wal,p.with_name(p.name+'-wal').read_bytes())
            self.assertTrue(db.in_transaction)
            self.assertNotIn('secret',json.dumps(value))
            db.rollback()
            db.close()

    def test_unknown_source_upgrade_does_not_hide_timestamped_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            p=pathlib.Path(directory)/'essential-000000000001.ndjson'
            rows=[{'receivedAt':'2026-10-30T14:00:00.000Z','kind':'trader-held-evaluation',
                   'data':{'usable':False,'reasonCode':'HELD_PRICING_DISPATCH_UNAVAILABLE',
                           'sourceCommit':'unknown-new-release','endpoint':'https://credential.invalid'}}]
            p.write_bytes((json.dumps(rows[0])+'\n'+ '{incomplete').encode())
            at=1793368800000
            value=diag.event_projection([p],at,at+1)
            self.assertEqual(value['kindCounts'],{'trader-held-evaluation':1})
            self.assertEqual(value['partialTrailingRecords'],1)
            self.assertEqual(value['records'][0]['data']['reasonCode'],'HELD_PRICING_DISPATCH_UNAVAILABLE')
            self.assertNotIn('credential',json.dumps(value))
            self.assertNotIn('endpoint',json.dumps(value))

    def test_symlink_and_foreign_financial_identity_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            p=root/'ledger.sqlite'
            db=sqlite3.connect(p)
            db.execute('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT)')
            db.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps({'accountId':'different'}),))
            db.commit()
            db.close()
            with self.assertRaises(ValueError):
                diag.ledger_projection(p,0,1)
            alias=root/'alias.sqlite'
            alias.symlink_to(p)
            with self.assertRaises(ValueError):
                diag.ledger_projection(alias,0,1)

    def test_financial_actions_survive_a_recent_reconciliation_flood(self):
        with tempfile.TemporaryDirectory() as directory:
            p=pathlib.Path(directory)/'ledger.sqlite'
            db=sqlite3.connect(p)
            db.executescript('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT); CREATE TABLE actions(id TEXT PRIMARY KEY,payload_hash TEXT,result TEXT); CREATE TABLE journal(revision INTEGER PRIMARY KEY,action_id TEXT,at INTEGER,kind TEXT,detail TEXT);')
            state={'accountId':diag.ACCOUNT,'inceptionAt':diag.INCEPTION,'mode':'PAPER',
                   'revision':25,'positions':{},'pending':{},'lockedDeposits':{},'controls':{},'daily':{}}
            db.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps(state),))
            rows=[('order',{'input':{'side':'sell','maxSpend':'427174632727','gas':'7000'}}),
                  ('attempt',{'orderId':'original-order-1','quote':{'receiveUnits':'103643848','pricedBaseUnits':'427174632727'}}),
                  ('pause',{'reasonCode':'EXAMPLE_RISK_PAUSE'})]
            rows.extend(('reconcile',{}) for _ in range(20))
            for at,(kind,detail) in enumerate(rows,1):
                db.execute('INSERT INTO journal VALUES(?,?,?,?,?)',(at,str(at),at,kind,json.dumps(detail)))
            db.commit()
            before=p.read_bytes()
            with patch.object(diag,'MAX_RECORDS',3):
                value=diag.ledger_projection(p,0,100)
            self.assertEqual([row['kind'] for row in value['records']],['order','attempt','pause'])
            self.assertEqual(value['records'][0]['data']['input']['maxSpend'],'427174632727')
            self.assertEqual(value['records'][1]['data']['quote']['receiveUnits'],'103643848')
            self.assertEqual(value['intervalKindCounts']['reconcile'],20)
            self.assertEqual(value['omittedKindCounts'],{'reconcile':20})
            self.assertEqual(value['omittedRecords'],20)
            self.assertEqual(before,p.read_bytes())
            db.close()

    def test_diagnostic_byte_flood_cannot_starve_essential_and_newest_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            paths=[self.event_file(root,'diagnostic-'+str(i).zfill(12)+'.ndjson',
                                   'provider-timing',[i]) for i in range(1,5)]
            essential=self.event_file(root,'essential-000000000001.ndjson','trader-held-evaluation',[10])
            paths.append(essential)
            # Exactly one essential plus two diagnostic segments fit. The former
            # implementation scans diagnostics first and never reaches essential.
            limit=essential.stat().st_size+sum(p.stat().st_size for p in paths[2:4])
            with patch.object(diag,'MAX_SCAN',limit):
                value=diag.event_projection(sorted(paths),0,100)
            self.assertEqual(value['kindCounts']['trader-held-evaluation'],1)
            self.assertEqual([r['at'] for r in value['records'] if r['kind']=='provider-timing'],[3,4])
            self.assertTrue(value['scanBoundReached'])
            self.assertLessEqual(value['bytesScanned'],limit)
            self.assertTrue(any(f.get('reasonCode')=='SCAN_BYTE_BUDGET' for f in value['files']))

    def test_record_flood_keeps_essential_samples_and_optional_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            paths=[self.event_file(root,'diagnostic-000000000001.ndjson','provider-timing',range(100,110)),
                   self.event_file(root,'essential-000000000001.ndjson','trader-held-evaluation',range(10))]
            with patch.object(diag,'MAX_RECORDS',4):
                value=diag.event_projection(paths,0,200)
            self.assertEqual([r['at'] for r in value['records']],[7,8,9,109])
            self.assertEqual(value['omittedMatchingRecords'],16)
            self.assertEqual(value['retainedKindCounts'],{'trader-held-evaluation':3,'provider-timing':1})

    def test_unused_optional_scan_capacity_is_reused_for_essential(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            essential=[self.event_file(root,'essential-'+str(i).zfill(12)+'.ndjson',
                                       'trader-held-evaluation',[i]) for i in range(1,6)]
            diagnostic=self.event_file(root,'diagnostic-000000000001.ndjson','provider-timing',[10])
            all_paths=sorted(essential+[diagnostic])
            limit=sum(p.stat().st_size for p in all_paths)
            with patch.object(diag,'MAX_SCAN',limit):
                value=diag.event_projection(all_paths,0,100)
            self.assertEqual(len(value['records']),6)
            self.assertEqual(value['bytesScanned'],limit)
            self.assertFalse(value['scanBoundReached'])

    def test_unused_optional_projected_bytes_are_reused_for_essential(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            essential=self.event_file(root,'essential-000000000001.ndjson','trader-held-evaluation',range(6))
            diagnostic=self.event_file(root,'diagnostic-000000000001.ndjson','provider-timing',[10])
            full=diag.event_projection([diagnostic,essential],0,100)
            exact=sum(diag.record_bytes(r) for r in full['records'])
            with patch.object(diag,'MAX_PROJECTED_RECORD_BYTES',exact):
                value=diag.event_projection([diagnostic,essential],0,100)
            self.assertEqual(len(value['records']),7)
            self.assertEqual(value['projectedRecordBytes'],exact)
            self.assertFalse(value['projectedRecordByteBoundReached'])

    def test_newer_segment_samples_are_not_evicted_when_older_segment_is_scanned(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            old=self.event_file(root,'essential-000000000001.ndjson','trader-held-evaluation',[1,2])
            new=self.event_file(root,'essential-000000000002.ndjson','trader-held-evaluation',[9,10])
            with patch.object(diag,'MAX_RECORDS',2):
                value=diag.event_projection([old,new],0,100)
            self.assertEqual([r['at'] for r in value['records']],[9,10])

    def test_exact_numeric_strings_and_receipt_hashes_preserve_privacy(self):
        source={'units':'427174632727','realizedLamports':'-425555968',
                'quote':{'spendLamports':'497073320','receiveUnits':'103643848',
                         'pricedBaseUnits':'427174632727','evidence':'https://secret.invalid/?token=PRIVATE'},
                'input':{'maxSpend':'https://secret.invalid','gas':'007000','deposit':'1e4',
                         'minReceive':str(1<<127),'reserved':-5},
                'orderId':'arbitrary-private-order-id','endpoint':'https://secret.invalid',
                'policySha256':'a'*64,'intentSha256':'https://secret.invalid'}
        result=diag.public_fields(source)
        self.assertEqual(result['units'],'427174632727')
        self.assertEqual(result['realizedLamports'],'-425555968')
        self.assertEqual(result['quote']['receiveUnits'],'103643848')
        self.assertEqual(result['input'],{})
        self.assertEqual(result['policySha256'],'a'*64)
        self.assertEqual(result['orderIdSha256'],diag.digest(source['orderId'].encode()))
        self.assertEqual(result['quote']['evidenceSha256'],diag.digest(source['quote']['evidence'].encode()))
        self.assertNotIn('secret',json.dumps(result))
        self.assertNotIn('PRIVATE',json.dumps(result))
        self.assertNotIn('arbitrary-private',json.dumps(result))

    def test_audit_gap_projection_keeps_typed_signatures_fences_and_generation(self):
        signature='1'*64
        mint='1'*32
        row={'signature':signature,'slot':463340124,'success':True,
             'blockTime':1793375040,'confirmationStatus':'finalized',
             'rawLogs':['secret'], 'endpoint':'https://secret.invalid'}
        source={'result':{'status':'unusable','reason':'NATIVE_AUDIT_HISTORY_SIGNATURE_NOT_OBSERVED',
                         'target':{'startAt':1000,'endAt':61000},
                         'strictInteriorSlots':{'lower':10,'upper':100},
                         'contextFences':{'upper':{'slot':100,'bankClockAt':61000,'availableAt':61010}},
                         'missingSuccessfulNotifications':[row],
                         'requiredSignatures':[signature,'https://secret.invalid'],
                         'notificationSnapshot':{'capturedAt':62000,'rows':22,'requiredRows':9},
                         'postSnapshotTail':{'generation':{'mint':mint,'pool':mint,'openedAt':500,
                                                           'connectionId':4,'subscriptionId':8},
                                             'addedPackets':[dict(row,rawHash='b'*64,receivedAt=62001,availableAt=62002)],
                                             'matchedInteriorSignatures':[signature]}}}
        result=diag.public_fields(source)['result']
        self.assertEqual(result['missingSuccessfulNotifications'][0]['signature'],signature)
        self.assertEqual(result['strictInteriorSlots'],{'lower':10,'upper':100})
        self.assertEqual(result['postSnapshotTail']['generation']['subscriptionId'],8)
        self.assertEqual(result['postSnapshotTail']['addedPackets'][0]['rawHash'],'b'*64)
        self.assertEqual(result['requiredSignaturesProjection'],{'sourceItems':2,'retainedItems':1,'omittedItems':1})
        self.assertNotIn('secret',json.dumps(result))
        many=diag.public_fields({'comparedSignatures':[signature]*(diag.MAX_TYPED_ROWS+2)})
        self.assertEqual(len(many['comparedSignatures']),diag.MAX_TYPED_ROWS)
        self.assertEqual(many['comparedSignaturesProjection']['omittedItems'],2)
        self.assertEqual(diag.public_fields({'signature':'1'*63,'pool':'1'*33}),{})

    def test_expanded_typed_projections_still_obey_record_byte_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory)
            p=root/'essential-000000000001.ndjson'
            rows=[{'receivedAt':1,'kind':'native-candidate-window-audit',
                   'data':{'result':{'requiredSignatures':['1'*64]*128}}},
                  {'receivedAt':2,'kind':'trader-held-evaluation','data':{'usable':True,'quoteAt':2}}]
            p.write_text(''.join(json.dumps(row)+'\n' for row in rows))
            with patch.object(diag,'MAX_PROJECTED_RECORD_BYTES',1000):
                value=diag.event_projection([p],0,10)
            self.assertEqual([r['kind'] for r in value['records']],['trader-held-evaluation'])
            self.assertLessEqual(value['projectedRecordBytes'],1000)
            self.assertTrue(value['projectedRecordByteBoundReached'])
            self.assertEqual(value['omittedKindCounts'],{'native-candidate-window-audit':1})

    def test_compact_full_export_obeys_actual_installed_eight_mib_read_bound(self):
        def section(kind,stream):
            rows=[{'at':i,'kind':kind,'stream':stream,
                   'data':{'requiredSignatures':['1'*64]*128}} for i in range(230)]
            self.assertLess(sum(diag.record_bytes(row) for row in rows),diag.MAX_PROJECTED_RECORD_BYTES)
            return {'records':rows,'kindCounts':{kind:len(rows)},'retainedKindCounts':{kind:len(rows)},
                    'omittedKindCounts':{},'omittedMatchingRecords':0}
        value={'schemaVersion':1,'kind':'POE_RELEASE_INDEPENDENT_READ_ONLY_DIAGNOSTICS',
               'financialWrites':0,'credentialReads':0,'serviceChanges':0,'providerRequests':0,
               'supervisorEvents':section('supervisor-sample','other'),
               'retainedEvents':section('trader-held-evaluation','essential'),
               'financial':section('order','financial')}
        value['financial']['intervalKindCounts']=value['financial'].pop('kindCounts')
        value['financial']['omittedRecords']=value['financial'].pop('omittedMatchingRecords')
        # Many small retained segments can add significant metadata even when
        # record bytes in all three sections obey their individual2MiB bounds.
        value['retainedEvents']['files']=[{'name':'essential-'+str(i).zfill(12)+'.ndjson',
                                         'sha256':'a'*64,'bytes':100,'changedDuringRead':False,
                                         'stream':'essential'} for i in range(15000)]
        self.assertGreater(diag.record_bytes(value)+1,8*1024*1024)
        result=diag.enforce_export_bound(value)
        self.assertLessEqual(diag.record_bytes(result)+1,8*1024*1024)
        self.assertEqual(len(result['financial']['records']),230,'financial actions are retained ahead of optional supervision')
        removed=result['supervisorEvents'].get('exportBoundOmittedRecords',0)
        self.assertGreater(removed,0)
        self.assertEqual(result['supervisorEvents']['omittedMatchingRecords'],removed)
        self.assertEqual(result['supervisorEvents']['omittedKindCounts']['supervisor-sample'],removed)

    def test_v3_scalar_financial_policy_and_epoch_do_not_hide_historical_latch_or_expose_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            p=pathlib.Path(directory)/'ledger.sqlite'
            db=sqlite3.connect(p)
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA wal_autocheckpoint=0')
            db.executescript('CREATE TABLE financial_state(singleton INTEGER PRIMARY KEY,body TEXT); CREATE TABLE actions(id TEXT PRIMARY KEY,payload_hash TEXT,result TEXT); CREATE TABLE journal(revision INTEGER PRIMARY KEY,action_id TEXT,at INTEGER,kind TEXT,detail TEXT);')
            state={'accountId':diag.ACCOUNT,'inceptionAt':diag.INCEPTION,'mode':'PAPER','revision':10,
                   'positions':{},'pending':{},'lockedDeposits':{'closed-token-account':'990'},
                   'lamports':'10000000000','realizedLamports':'-1116818003','executionCosts':'77000',
                   'controls':{'entriesEnabled':False,'reason':'https://private/?secret=SECRET'},
                   'daily':{'lossPaused':True,'paused':True},
                   'paperEpoch':{'id':'poe-paper-10sol-v3-20261030','version':'poe-paper-epoch-v3',
                                 'startedAt':100,'transitionRevision':10,'initialLamports':'10000000000','contributionLamports':'10000000000'},
                   'equityRisk':{'version':'paper-equity-risk-v3-no-daily-stop-v1',
                                 'daily':{'highWaterMicroUsd':'1000000000','lossPaused':False}}}
            db.execute('INSERT INTO financial_state VALUES(1,?)',(json.dumps(state),))
            db.execute("INSERT INTO journal VALUES(10,'v3',100,'paper-epoch-transition',?)",(json.dumps({'epoch':state['paperEpoch']}),))
            db.commit();before=p.with_name(p.name+'-wal').read_bytes()
            value=diag.ledger_projection(p,0,200)
            self.assertEqual(value['activeEpoch']['id'],'poe-paper-10sol-v3-20261030')
            self.assertEqual(value['activeEpoch']['transitionRevision'],10)
            self.assertFalse(value['riskPolicy']['dailyLossStopEnabled'])
            self.assertEqual(value['riskPolicy']['entryConsumedCostBps'],500)
            self.assertTrue(value['daily']['lossPaused'],'raw latch remains visible; diagnostics cannot rewrite it')
            self.assertEqual(value['balances']['cashLamports'],'10000000000')
            self.assertEqual(value['balances']['reservedLamports'],'0')
            self.assertEqual(value['balances']['lockedDepositLamports'],'990')
            self.assertEqual(value['balances']['realizedLamports'],'-1116818003')
            self.assertNotIn('SECRET',json.dumps(value));self.assertEqual(before,p.with_name(p.name+'-wal').read_bytes())
            db.close()

    def test_v3_capital_weighted_metrics_preserve_fractional_values_but_not_provider_payloads(self):
        value=diag.public_fields({'v3':{'components':{'rawBuyerCount':151,'effectiveBuyerCount':2.39,
            'top5BuyerBps':9415,'dustBuyVolumeBps':16,'scenarioNetSurplusLamports':'-12001',
            'providerUrl':'https://private/?secret=SECRET'}}})
        self.assertEqual(value['v3']['components']['effectiveBuyerCount'],2.39)
        self.assertEqual(value['v3']['components']['scenarioNetSurplusLamports'],'-12001')
        self.assertNotIn('SECRET',json.dumps(value))
        scenarios=diag.public_fields({'scenarios':[
            {'name':'historical-largest-executed-sell-repeat-diagnostic','requiredForAdmission':False,
             'assumedExternalSellBaseUnits':'500','netLamports':'1','providerUrl':'SECRET'},
            {'name':'https://private/?SECRET','netLamports':'1'}]})
        self.assertFalse(scenarios['scenarios'][0]['requiredForAdmission'])
        self.assertEqual(scenarios['scenariosProjection']['omittedItems'],1)
        self.assertNotIn('SECRET',json.dumps(scenarios))

if __name__=='__main__':
    unittest.main()
