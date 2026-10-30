#!/usr/bin/env python3
"""Meaningful read-only/WAL/privacy/upgrade diagnostics regressions."""
import importlib.util
import json
import pathlib
import sqlite3
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('diag',pathlib.Path(__file__).with_name('export-operational-diagnostics.py'))
diag=importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)

class ReadOnlyDiagnostics(unittest.TestCase):
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

if __name__=='__main__':
    unittest.main()
