#!/usr/bin/env python3
"""Reproduce one natural PAPER round trip using frozen original collector files.

No network, private ledger, new exporter, control command or synthetic trade.
"""
import datetime
from decimal import Decimal
import hashlib
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BRACKET = ROOT / 'evidence/coherent-protection-recovery-20261029/post-install/supervision/sustained-forward-69/two-held-live-0230'
ACCOUNT = 'poe-3123e352-4581-455b-85db-acd7e825e99e'
SOURCE = '69aa1ef214a8c79524a25a8aca79299ccaad93dc'
MINT = '8r7gzXUXgqy4PaKfQ4bKUadUcVfZuFafMRJyJiEYpump'
ORIGINAL_HELD = 'qi6wtTo9jZhkGcokNrjNNnBSjt12sUxgNyhWuUUpump'
BUY_ORDER = 'buy:68919:1793327386466'
SELL_ORDER = 'sell:69032:1793327601701'
inputs = {}


def read(path):
    data = path.read_bytes()
    inputs[str(path.relative_to(ROOT))] = hashlib.sha256(data).hexdigest()
    return data


def millis(value):
    return int(datetime.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp() * 1000)


def number(value):
    return Decimal(str(value))


def lamports(value):
    result = number(value) * 1000000000
    assert result == result.to_integral_value()
    return int(result)


def position(frame, mint):
    return next((p for p in frame['positions'] if p['mint'] == mint), None)


rows = {}
for name in ['observations.ndjson', 'exit-observations.ndjson']:
    for line in read(BRACKET / name).decode().splitlines():
        row = json.loads(line)
        assert row['httpStatus'] == 200 and row['account']['id'] == ACCOUNT
        assert row['account']['inceptionAt'] == '2026-10-26T22:07:36.212Z' and row['account']['initialUsd'] == 1000
        assert row['source']['release'] == SOURCE and row['source']['strategy'] == 'adaptive-momentum-v2-paper-v1'
        assert row['intelligence']['run']['id'] == 'native-paper-20261030021230118'
        assert row['intelligence']['run']['mode'] == 'persistent-paper'
        rows[row['sequence']] = row
frames = sorted(rows.values(), key=lambda r: millis(r['times']['generatedAt']))
before, pending, filled, last_held, exited = [rows[key] for key in ['11361', '11362', '11363', '11376', '11377']]
for name, sequence in [('pending-buy-source.json', '11362'), ('first-two-held-source.json', '11363'), ('last-held-source.json', '11376'), ('first-exited-source.json', '11377')]:
    frozen = json.loads(read(BRACKET / name))
    assert frozen == rows[sequence]

order = next(o for o in pending['intelligence']['pendingOrders'] if o['id'] == BUY_ORDER)
buy = next(t for t in exited['trades'] if t['mint'] == MINT and t['side'] == 'buy')
sell = next(t for t in exited['trades'] if t['mint'] == MINT and t['side'] == 'sell')
assert buy['id'] == 'paper-fill:3212aa854b30998a52be4bf7c8331016'
assert sell['id'] == 'paper-fill:97844fecbc7122d16fd5803963f4709b'
assert buy['status'] == sell['status'] == 'PAPER filled'
assert BUY_ORDER in buy['reason'] and SELL_ORDER in sell['reason']
assert buy['quantity'] == sell['quantity'] == '4987415586352'
assert int(buy['quantity']) >= int(order['quantityMinimum'])
assert millis(order['decidedAt']) < millis(order['executeAt']) <= millis(buy['at']) < millis(order['expiresAt'])
assert position(pending, MINT) is None
assert position(filled, MINT)['quantity'] == buy['quantity']
assert position(filled, MINT)['enteredAt'] == buy['at']
assert position(last_held, MINT)['quantity'] == buy['quantity']
assert position(exited, MINT) is None and not exited['intelligence']['pendingOrders']
assert not filled['intelligence']['pendingOrders']

exit_decision = next(d for d in exited['intelligence']['decisions'] if d['mint'] == MINT and d['stage'] == 'exit-reserved')
assert exit_decision['reason'] == 'adaptive-net-liquidation-high-water-trailing-stop'
assert millis(exit_decision['at']) == int(SELL_ORDER.split(':')[-1]) < millis(sell['at'])
qualified = next(d for d in pending['intelligence']['decisions'] if d['mint'] == MINT and d['stage'] == 'qualified')

cash_before = lamports(before['balances']['cashSol'])
cash_pending = lamports(pending['balances']['cashSol'])
cash_filled = lamports(filled['balances']['cashSol'])
cash_exited = lamports(exited['balances']['cashSol'])
reserved = lamports(order['reservedSol'])
assert cash_before == cash_pending
assert cash_pending - cash_filled == reserved == 526343491
assert lamports(before['balances']['reservedSol']) == 0
assert lamports(pending['balances']['reservedSol']) == reserved
assert lamports(filled['balances']['reservedSol']) == lamports(exited['balances']['reservedSol']) == 0
sell_cash_credit = cash_exited - cash_filled
cash_round_trip = cash_exited - cash_before
assert sell_cash_credit == 456097543 and cash_round_trip == -70245948
assert number(filled['balances']['positionCostUsd']) == sum(number(p['entryCostUsd']) for p in filled['positions'])

net_trade_usd = number(sell['valueUsd']) - number(buy['valueUsd']) - number(sell['executionCostsUsd']) - number(buy['executionCostsUsd'])
assert pending['balances']['solPriceUsd'] == exited['balances']['solPriceUsd'] == 94.995
fx = number(exited['balances']['solPriceUsd'])
realized_delta_usd = number(exited['balances']['realizedUsd']) - number(pending['balances']['realizedUsd'])
assert abs(realized_delta_usd - net_trade_usd) <= Decimal('0.000004')
inferred_realized_sol = realized_delta_usd / fx
inferred_retained_deposit_sol = inferred_realized_sol - Decimal(cash_round_trip) / 1000000000
reported_sell_net_usd = number(sell['valueUsd']) - number(sell['executionCostsUsd'])
sell_cash_credit_usd = Decimal(sell_cash_credit) / 1000000000 * fx
assert abs(sell_cash_credit_usd - reported_sell_net_usd) <= Decimal('0.000002')

historical_rows = {t['id']: t for t in before['trades']}
after_rows = {t['id']: t for t in exited['trades']}
assert all(after_rows.get(key) == old for key, old in historical_rows.items())
buy_ids = {t['id'] for row in frames for t in row['trades'] if t['mint'] == MINT and t['side'] == 'buy'}
sell_ids = {t['id'] for row in frames for t in row['trades'] if t['mint'] == MINT and t['side'] == 'sell'}
assert len(buy_ids) == len(sell_ids) == 1
for row in frames:
    old = position(row, ORIGINAL_HELD)
    assert old and old['quantity'] == '65278155' and old['enteredAt'] == '2026-10-29T22:23:36.537Z'
    assert old['entryCostUsd'] == 49.708013
    assert row['intelligence']['protection']['breaches'] == 74
    assert row['intelligence']['protection']['unavailableChecks'] == 245
    assert row['intelligence']['candidates']['deepMaximum'] == 4

current_maxima = []
source_completion_ages = []
for row in frames:
    for note in row['intelligence']['quality']['limitations']:
        match = re.search(r'Current runtime observed completed protection maxima .*: gap ([0-9.]+) ms; quote age at use ([0-9.]+) ms', note)
        if match:
            current_maxima.append((number(match[1]), number(match[2])))
    completed = row['intelligence']['protection']['lastCompletedAt']
    if completed:
        source_completion_ages.append(millis(row['times']['generatedAt']) - millis(completed))


def summary(row):
    i = row['intelligence']
    return {'sequence': row['sequence'], 'sourceAt': row['times']['generatedAt'], 'responseSha256': row['responseSha256'],
            'times': row['times'], 'status': row['status'], 'balances': row['balances'], 'positions': row['positions'],
            'funnel': row['funnel'], 'candidates': i['candidates'],
            'quality': {k: i['quality'][k] for k in ['captureConnected', 'qualityGaps', 'auditUnavailable', 'auditUnusable', 'decisionDeadlineMisses']},
            'protection': i['protection'], 'provider': i['provider'], 'resources': i['resources'], 'admission': i['admission']}


def counter_delta(a, b, group, keys):
    return {key: b['intelligence'][group][key] - a['intelligence'][group][key] for key in keys}


result = {
    'kind': 'INDEPENDENT_NATURAL_PAPER_ROUND_TRIP_PUBLIC_RECONSTRUCTION',
    'account': before['account'], 'source': before['source'], 'run': before['intelligence']['run'],
    'inputSha256': inputs, 'mint': MINT, 'retainedOriginalHolding': ORIGINAL_HELD,
    'observationWindow': {'fromSourceAt': frames[0]['times']['generatedAt'], 'untilSourceAt': frames[-1]['times']['generatedAt'], 'uniqueSourceFrames': len(frames)},
    'timeline': {'preliminaryDecisions': [d for d in pending['intelligence']['decisions'] if d['mint'] == MINT and d['stage'] != 'qualified'],
                 'qualifiedDecision': qualified, 'pendingBuyOrder': order, 'buyFill': buy, 'exitDecision': exit_decision, 'sellFill': sell,
                 'decisionToBuyFillMs': millis(buy['at']) - millis(order['decidedAt']),
                 'buyEligibilityToFillMs': millis(buy['at']) - millis(order['executeAt']),
                 'exitDecisionToSellFillMs': millis(sell['at']) - millis(exit_decision['at']),
                 'positionHeldMsFromReportedFills': millis(sell['at']) - millis(buy['at']),
                 'sellPendingOrderCaptured': False, 'sellExecuteAtExpiresAtMinReceive': 'UNKNOWN_PUBLIC_SAMPLING_DID_NOT_CAPTURE_PENDING_SELL'},
    'exactPublicCashAccounting': {'cashBeforeAndPendingLamports': cash_before, 'reservedBuyLamports': reserved,
                                  'cashAfterBuyLamports': cash_filled, 'cashAfterExitLamports': cash_exited,
                                  'sellCashCreditLamports': sell_cash_credit, 'roundTripCashChangeLamports': cash_round_trip,
                                  'reservationEqualsBuyCashDebit': True, 'reservedClearedAfterFillAndExit': True,
                                  'originalHeldUnitsAndEntryUnchanged': True, 'observedBuyFillIds': sorted(buy_ids), 'observedSellFillIds': sorted(sell_ids),
                                  'retainedPriorTradeRowsUnchanged': len(historical_rows),
                                  'limits': 'Authoritative public financial projections and unique order/fill identities; this does not independently inspect the complete SQLite journal or prove future restart idempotency.'},
    'tradingResult': {'reportedBuyValueUsd': buy['valueUsd'], 'reportedSellValueUsd': sell['valueUsd'],
                      'reportedBuyCostUsd': buy['executionCostsUsd'], 'reportedSellCostUsd': sell['executionCostsUsd'],
                      'netFromRoundedFillRowsUsd': str(net_trade_usd), 'realizedPortfolioChangeAtSameFxUsd': str(realized_delta_usd),
                      'sameFxUsdPerSol': str(fx), 'roundingDifferenceUsd': str(realized_delta_usd - net_trade_usd),
                      'approximateRealizedTradingSol': str(inferred_realized_sol.quantize(Decimal('0.000001'))),
                      'approximateRetainedDepositSol': str(inferred_retained_deposit_sol.quantize(Decimal('0.00000001'))),
                      'exactLedgerPrincipalGasDepositLamports': 'UNKNOWN_NOT_EXPOSED_BY_PUBLIC_PROJECTION',
                      'cashCreditConsistentWithReportedSellMinusGasWithinMicroUsd': True,
                      'noDepositRefundObserved': True,
                      'meaning': 'Observed losing PAPER round trip. Exact cash change includes retained account-creation capital; it is not all trading loss. SOL result/deposit are approximate inferences from rounded USD at the same spot rate, not precise ledger exports. Pool fees are reported embedded; gas is reported separately. Passive SOL/USD movement and the still-open qi6 valuation are excluded from this per-trade realized comparison.'},
    'protectionAndCoverage': {'recordedNewBreaches': 0, 'recordedNewUnavailableChecks': 0,
                              'retainedHistoricalBreaches': 74, 'retainedHistoricalUnavailableChecks': 245,
                              'retainedHistoricalMaximumGapMs': 89426,
                              'sourceReportedCurrentRunMaximumGapMs': str(max(x[0] for x in current_maxima)),
                              'sourceReportedCurrentRunMaximumQuoteAgeMs': str(max(x[1] for x in current_maxima)),
                              'maximumCompletedAgeAtSampledSourceMs': max(source_completion_ages),
                              'twoHeldDiscoveryAndEvaluationDelta': counter_delta(filled, last_held, 'candidates', ['migrationsReceived', 'verifiedOrigins', 'auditedWindows', 'uniqueEvaluated', 'predictiveAssessments']),
                              'twoHeldQualityDelta': counter_delta(filled, last_held, 'quality', ['qualityGaps', 'auditUnavailable', 'auditUnusable', 'decisionDeadlineMisses']),
                              'entryTransitionDeadlineMissDelta': filled['intelligence']['quality']['decisionDeadlineMisses'] - pending['intelligence']['quality']['decisionDeadlineMisses'],
                              'providerDeltaEntireBracket': counter_delta(frames[0], frames[-1], 'provider', ['rpcRequests', 'httpTimeouts', 'httpErrors', 'throttles']),
                              'meaning': 'Sampled current source reports fresh all-held protection and unchanged failure counters through the natural two-held lifecycle. The public15s sampling does not independently reproduce every internal2s protection call. Candidate quality/audit/deadline failures remain real and unattributed; one successful lifecycle is not sustained acceptance.'},
    'financialFrames': {'before': summary(before), 'pendingBuy': summary(pending), 'firstTwoHeld': summary(filled), 'lastTwoHeld': summary(last_held), 'firstExited': summary(exited), 'lastRetained': summary(frames[-1])},
    'qualificationAndTradeQuality': {'reportedEntryQualified': True, 'reportedExitRule': exit_decision['reason'],
                                     'independentClassification': 'INCOMPLETE_OR_UNVERIFIED_DECISION_TIME_EVIDENCE',
                                     'unknowns': ['Token migration age and exact discovery/observation origin', 'Raw executed flow, buying pressure, independent buyer/concentration measures and six audited buckets', 'Independent audit certificate and complete qualification proof bytes', 'Exact entry/liquidation quote timestamps, reserves, actual-size price impact and quote contents behind the rpc-market digest', 'Exact decision-time financial reconciliation and quote freshness; available public snapshots occur after decisions', 'Exact sell pending minReceive/deadline/order metadata and execution/exit quote proof', 'Whether earlier exit timing or a different decision was warranted under the active strategy'],
                                     'meaning': 'The natural autonomous entry, second concurrent holding and full exit/accounting are observed. The source-reported qualification/exit reason is not an independent proof that the trade was a good entry, a valid loss, bad execution or adequately protected at every internal instant. A loss alone does not decide trade quality.'},
    'networkRequests': 0, 'financialDatabaseOpened': False, 'financialWrites': 0, 'serviceControlOperations': 0,
    'fundedExecution': False, 'syntheticTrade': False, 'operationalAcceptance': False, 'profitabilityClaim': False,
}
HERE.mkdir(parents=True, exist_ok=True)
output = HERE / 'analysis.json'
encoded = json.dumps(result, indent=2) + '\n'
if output.exists():
    assert output.read_text() == encoded, 'Never replace a frozen financial analysis with changed inputs'
else:
    output.write_text(encoded)
print(json.dumps({'buyAt': buy['at'], 'sellAt': sell['at'], 'heldMs': result['timeline']['positionHeldMsFromReportedFills'],
                  'cashChangeLamports': cash_round_trip, 'netRoundedFillRowsUsd': str(net_trade_usd),
                  'realizedSameFxDeltaUsd': str(realized_delta_usd), 'qualificationClassification': result['qualificationAndTradeQuality']['independentClassification'],
                  'output': str(output)}, indent=2))
