# 2026-09-18 paid-submit cascade root-cause audit

## Incident

The locked Feishu batch stopped on product 21/21 with 10/20 main images. Fixed slots 1-10 retained genuine Cloudflare 524 submit responses, while provider billing logs proved that all 20 image tasks had been accepted and billed.

## Root cause

All five prompt rounds were started concurrently. Paid POSTs passed through a concurrency-2 gate, but acceptance ambiguity was evaluated only after all concurrent work settled. When the first pair returned 524, the gate released queued work before the parent could stop the product, allowing the same provider outage to accumulate ten billed tasks whose public task IDs were absent from the HTTP responses.

The model generation path was healthy. The failure was in irreversible-request admission and recovery: multiple paid POSTs could be in the ambiguity window, and billed-log evidence did not yet automatically recover public task IDs from the authenticated provider task list.

## Systemic correction

- The paid POST acceptance window is now single-flight for the whole product. This serializes only the short request/acknowledgement boundary; accepted tasks still generate, poll and download concurrently.
- A shared circuit opens inside the admission lock on the first ambiguous response. Queued requests observe the open circuit before POST and are recorded as not accepted.
- Strict billing reconciliation automatically enters a persistent headed provider session. If login expires, the visible login page remains open and the flow waits without replay.
- The read-only task query spans a bounded 15-minute window around billing because provider `submit_time` can precede `created_at` by minutes. Final matching remains strict: task creation and billing must agree within five seconds and form a one-to-one full set.
- Recovered task IDs are individually verified against the task API before their original ledger slots move from `ambiguous` to `submitted`.

## Real recovery evidence

For batch `bc78d342821fa2911eb95ed5`, record `recvvnf59pA83R`, all ten billed tasks were recovered without a paid POST replay. The run advanced from 10/20 to 20/20 main images and entered Doudian publishing at `2026-09-18T01:37:38Z`.
