import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateFinancialEpochReport,type FinancialEpochReport} from '../src/financial-epoch-reporting.js';
import {epochOperatingPnlHistory} from '../src/pilot-reporting.js';
const at=Date.parse('2026-10-30T15:00:00.000Z'),iso=(n:number)=>new Date(n).toISOString();
function receipt():FinancialEpochReport{return {version:'poe-paper-epoch-v1',id:'poe-paper-10sol-20261030',activatedAt:iso(at),initialSol:'10.000000000',contributionSol:'10.000000000',initialUsd:950,solPriceUsd:95,priceAt:iso(at-100),priorEquitySol:'9.300000000',priorArchivedCashSol:'9.290000000',priorArchivedDepositsSol:'0.010000000',priorRealizedPnlSol:'-0.600000000',priorExecutionCostsSol:'0.000100000',capitalAdjustmentSol:'0.700000000',priorStateSha256:'a'.repeat(64),backupSha256:'b'.repeat(64)};}
test('source epoch receipt binds10SOL to observed conversion and prior archived assets',()=>{
 const r=receipt();assert.deepEqual(validateFinancialEpochReport(r,iso(at)),r);
 for(const invalid of [{...r,initialUsd:951},{...r,priorEquitySol:'9.4'},{...r,capitalAdjustmentSol:'10'},{...r,priorArchivedDepositsSol:'1'},{...r,priceAt:iso(at+1)},{...r,secret:'must-not-export'}])assert.throws(()=>validateFinancialEpochReport(invalid,iso(at)),/EPOCH_REPORT/);
});
test('reported P&L preserves old loss and explicitly breaks before the new zero capital baseline',()=>{
 const points=[{at:iso(at-30000),tradingUsd:-58.4,economicUsd:null},{at:iso(at+15000),tradingUsd:0,economicUsd:null}],before=structuredClone(points);
 const actual=epochOperatingPnlHistory(points,receipt());assert.deepEqual(actual,[points[0],{at:iso(at-1),tradingUsd:null,economicUsd:null},{at:iso(at),tradingUsd:0,economicUsd:null},points[1]]);assert.deepEqual(points,before);assert.equal(epochOperatingPnlHistory(points,undefined),points);
 assert.deepEqual(epochOperatingPnlHistory(actual,receipt()),actual,'retry cannot add another baseline or erase the historical loss');
});
