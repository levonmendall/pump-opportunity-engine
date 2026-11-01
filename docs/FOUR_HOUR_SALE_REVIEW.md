# Four-hour PAPER sale review

Reporting only. Higher token price at the checkpoint is BAD SALE; lower is GOOD SALE;
equal is UNCHANGED. The label does not change a strategy or authorize any transaction.

The independent lifetime-equity reporting process runs this companion when
`POE_SALE_REVIEWS_ENABLED=1`. It opens the original financial ledger read-only and
incrementally verifies completed sale receipts. The trader, financial journal,
snapshot schema, original account and accounting calculations are unchanged.

Each executed sale action, including separate partial fills, has one durable row in
`/var/lib/poe/lifetime-equity/sale-reviews.sqlite`. The row's due time is the actual
fill time plus four hours. A unique action-derived fill ID prevents duplicates.
A durable claim is committed before a request; interrupted claims become UNAVAILABLE
rather than being requested again after restart. Existing missed historical checkpoints
are UNAVAILABLE and do not make provider requests.

At the checkpoint one getMultipleAccounts request reads the canonical PumpSwap pool,
mint, possible token-program vaults and same-bank Clock using existing RPC/SDK code.
Only the current reserve-ratio token price is computed. No trade quote, holder audit,
volume, strategy, liquidity screening, subscription or intervening price history is
requested. Unsupported/missing pools and invalid/nonpositive reserves are unavailable.
The 24-hour discovery/entry age limit does not apply to retrospective reviews.

Timing: a request may complete from due time through due+60 seconds inclusive, allowing
scheduler and transport latency. A price must have a bank timestamp no older than
30 seconds and its actual receipt time is displayed. After that checkpoint window no
later spot price is substituted. Transport has a five-second limit and no retry.

Sale price is executed quote lamports divided by executed token base units, excluding
separate gas/refunds. The checkpoint uses the same quote and base units; direction is
compared with exact integer cross multiplication. Only the displayed percentage is
rounded. When verified token decimals are available both prices are displayed in
SOL per token; otherwise the pending sale baseline explicitly uses SOL per base unit.
This is a spot-price comparison, not a hypothetical executable resale or net-P&L estimate.

The authenticated `/api/sale-reviews` receiver is separate from financial ingestion.
It validates account, timestamps, the computed result and sale identity. The snapshot
response joins matching reviews into existing sale Explain panels without changing
financial snapshot validation. Receiver memory is refreshed every 30 seconds from the
durable EC2 store. All local review rows are retained; only the latest 50 are published,
matching the dashboard's existing bounded recent-trade presentation.

Focused validation: `node --import tsx --test test/sale-review*.test.ts`.
Deploy using the existing reviewed, hash-bound EC2 release workflow and matching Render
source. Deploying dashboard code alone does not enable checkpoint collection on EC2.
