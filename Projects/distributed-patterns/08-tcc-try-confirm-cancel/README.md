# TCC — Try-Confirm-Cancel

> Give a multi-service money flow saga-like atomicity *without* a plain saga's
> dirty reads. Split every participant into **Try** (reserve), **Confirm**
> (commit the reservation), and **Cancel** (release it) — then earn it by getting
> the brutal edge cases right: empty-confirm, empty-cancel, the hanging
> Cancel-before-Try reorder, and idempotency under retry storms. Zero
> double-spend, zero leaked reservation.

| | |
|---|---|
| **Tier** | Distributed-patterns (distributed transactions) |
| **Primary domain** | Reservation-based distributed transactions |
| **Skills exercised** | TCC protocol, reservation isolation, idempotency, anti-hanging / null-compensation, timeout-driven cancellation, payment authorize/capture/void mapping, Go (transaction coordinator + participants over gRPC/HTTP) |
| **Interview sections** | 13 (distributed systems), 11 (messaging / event streaming), 16 (security & correctness) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You own the checkout transaction at a payments-and-marketplace company. A single
"place order" touches three services that each guard a scarce resource:

- **Wallet** — debit the buyer's balance.
- **Inventory** — decrement stock for the SKU.
- **Payment / PSP** — authorize and capture the buyer's card.

There is no shared database and no XA driver, so a 2PC across them is off the
table — and even if you had one, you will not hold prepare locks across a PSP
round-trip that can take seconds. The current code is a **plain saga**: each
service commits immediately, and on failure you fire compensations. It works,
but it has a problem finance keeps escalating: between "stock decremented" and
"payment failed → restock," the item shows as **sold** to everyone else. Two
buyers race for the last unit, both pass the stock check, one's payment fails,
and you've oversold. The saga has no isolation — it exposes intermediate state.

Your job is to rebuild this flow as **TCC**. Each participant exposes three
operations instead of one. **Try** *reserves* the resource (holds funds, holds
stock, authorizes the card) **without finalizing**. The coordinator only calls
**Confirm** on every participant once *all* Tries succeed; otherwise it calls
**Cancel** on every participant to release the holds. A held reservation is
invisible to other transactions' Tries — that's the isolation a saga lacks.

This buys correctness but it costs you: three times the surface area per service,
and a set of failure interleavings that *will* corrupt money if you wave your
hands at them. You will produce numbers and proofs, not opinions.

## 2. Goals / Non-goals

**Goals**
- Implement the **three-operation contract** (Try / Confirm / Cancel) for a wallet
  participant and an inventory participant, driven by a TCC **coordinator**.
- Make Confirm and Cancel **idempotent** and **commutative-with-retries**: any
  operation may be delivered 0, 1, or many times and the resource state must be
  identical to exactly-once.
- Handle every hard interleaving explicitly: **empty-confirm**, **empty-cancel**,
  the **hanging** Cancel-before-Try reorder (null compensation + anti-hanging
  guard), and **Confirm-after-timed-out-Cancel**.
- Implement **timeout-driven auto-cancel**: a reservation left in `TRY` state past
  its TTL is released without the coordinator asking.
- Prove **reservation isolation**: a held reservation is not double-allocated to a
  second concurrent transaction (no oversell, no double-spend).
- Quantify TCC vs **saga** (more isolation, more code per service) and vs **2PC**
  (no central blocking, app-level, but no global atomicity guarantee for free).

**Non-goals**
- A general-purpose XA / 2PC coordinator — that's [`06-2pc-3pc-coordinator`](../06-2pc-3pc-coordinator/).
- A choreography saga comparison build — that's [`07-saga-orchestration-vs-choreography`](../07-saga-orchestration-vs-choreography/).
- A real PSP integration — model the card leg as a local authorize/capture/void
  state machine with injectable latency and failure.
- Cross-region / consensus on the reservation store — single-region is fine; the
  hard part here is the protocol, not the replication.

## 3. Functional requirements

1. A **coordinator** (`cmd/coordinator`) exposes `POST /orders` (place order). It
   runs the TCC state machine: phase 1 calls `Try` on all participants; phase 2
   calls `Confirm` on all (if every Try succeeded) **or** `Cancel` on all
   (otherwise, or on timeout). It persists a **transaction log** so it can resume
   after a crash mid-protocol.
2. Each **participant** (`cmd/wallet`, `cmd/inventory`, and a PSP-style
   `cmd/payment`) exposes exactly three RPCs over gRPC or HTTP:
   - `Try(xid, biz_args)` → reserve; returns success/failure.
   - `Confirm(xid)` → finalize the reservation made by `Try(xid)`.
   - `Cancel(xid)` → release the reservation made by `Try(xid)`.
3. Every `Confirm(xid)` and `Cancel(xid)` is **idempotent** keyed by `xid`:
   repeated delivery is a no-op after the first effect.
4. **Empty-confirm / empty-cancel** are handled: a `Confirm`/`Cancel` may arrive
   for an `xid` whose `Try` never executed at that participant (it failed, was
   skipped, or was reordered). The participant must record a terminal decision and
   **not** later let a late `Try` reserve anything.
5. **Anti-hanging guard:** if `Cancel(xid)` arrives **before** `Try(xid)` (network
   reorder), the participant writes a "null compensation" / cancel-tombstone for
   `xid`. A subsequent `Try(xid)` must see the tombstone and **refuse to reserve**
   (return a benign "already cancelled" result), not silently hold a resource that
   nobody will ever confirm.
6. **Timeout-driven auto-cancel:** a reservation stuck in `TRY` past its TTL (e.g.
   30 s) is auto-released by a background sweeper; a later `Confirm` for an
   auto-cancelled `xid` must be rejected/no-op, never resurrect the hold.
7. A **chaos hook** (`cmd/chaos`) can: drop/delay/reorder phase-2 messages, kill a
   participant between Try and Confirm, kill the coordinator after Try, and
   duplicate any phase-2 call N times.

## 4. Load & data profile

- **Volume:** drive **≥ 50M** completed transactions across runs; a single
  sustained run ≥ 30 minutes at target rate. The **reservation store** must hold
  millions of *live* `TRY` rows at peak (open holds awaiting phase 2) plus the
  terminal history.
- **Resource cardinality:** 5M wallets and 1M SKUs. The SKU access is **Zipfian**
  (s≈1.2) so a handful of hot SKUs take most of the reservation traffic — this is
  deliberate and exposes reservation contention on hot rows.
- **Reservation lifetime:** model a realistic short hold — phase-1→phase-2 gap of
  50 ms–2 s in the happy path, and a long tail of abandoned carts that must be
  reclaimed by the TTL sweeper (so a steady fraction never reaches Confirm).
- **Generator:** `cmd/gen` (or a coordinator flag) is deterministic given a seed;
  it can dial the abandon rate, the reorder rate, and the duplicate rate.
- **Traffic model:** open-model load (fixed arrival rate, not closed-loop) so you
  can watch open-reservation count and sweeper backlog build under stress.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Place-order end-to-end (Try→all-Confirm) p99 | < 250 ms at 80% of sustained ceiling (PSP leg mocked at a fixed 20 ms) |
| **Reservation-leak rate** | **0** — no `TRY` reservation may outlive its txn without being either confirmed or cancelled (auto or explicit) |
| **Double-spend / oversell** | **0** — `Σ confirmed debits ≤ balance`; `Σ confirmed stock ≤ on-hand`; proven after chaos |
| Confirm/Cancel idempotency | Final resource state identical under 1× vs N× delivery (N ≥ 10) of every phase-2 call |
| Anti-hanging correctness | Every Cancel-before-Try `xid` ends terminal-cancelled; the late Try reserves **nothing** |
| TTL auto-cancel latency | Stale `TRY` row released within TTL + 1 sweep interval; reported |
| Sustained throughput (txn/s) | Find & report the ceiling; compare against the saga and 2PC baselines on the same hardware |

> The point isn't a magic txn/s number — it's that **money and stock are exactly
> conserved** under every interleaving, and you can *prove* it with the ledger.

## 6. Architecture constraints & guidance

- Coordinator + 3 participants as **separate binaries** (so you can kill them
  independently), wired over gRPC (recommended) or HTTP. `docker-compose` brings
  up Postgres (per-participant schema) and the services. Pin versions.
- **Coordinator transaction log** is the source of truth for protocol progress:
  `(xid, state, participants, decision, deadline)`. On restart the coordinator
  re-drives any txn not in a terminal state — re-issuing **Confirm** if the global
  decision was Confirm, else **Cancel**. Because phase 2 is idempotent, re-driving
  is safe.
- **Participant reservation store** is the source of truth for the resource:
  hold-rows plus a per-`xid` **decision row** (the idempotency + anti-hanging
  ledger). The decision row is what makes empty-confirm, empty-cancel, and
  Cancel-before-Try correct — see §7.
- A reservation **isolates** the held quantity: `available = on_hand − Σ active
  holds`. A second transaction's `Try` sees the reduced `available` and is
  rejected if it can't fit — *that* is the isolation a plain saga lacks (the saga
  would let it read the not-yet-compensated value).
- Instrument with Prometheus: open-reservation gauge, sweeper backlog, phase-1 and
  phase-2 latency, retry counts, and counters for each rare path
  (empty-confirm, empty-cancel, null-compensation, auto-cancel).

## 7. Data model

```
-- coordinator
txn(xid PK, state ENUM('TRYING','CONFIRMING','CANCELLING','CONFIRMED','CANCELLED'),
    decision ENUM('PENDING','CONFIRM','CANCEL'), deadline TIMESTAMPTZ, created_at)
txn_participant(xid, participant, try_ok BOOL, phase2_done BOOL, PRIMARY KEY(xid, participant))

-- each participant (wallet shown; inventory/payment analogous)
balance(account_id PK, available BIGINT, held BIGINT)              -- resource
reservation(xid PK, account_id, amount BIGINT,
            state ENUM('TRIED','CONFIRMED','CANCELLED'), expires_at TIMESTAMPTZ)
-- the decision/idempotency ledger — written FIRST on Confirm/Cancel, even with no Try:
decision(xid PK, kind ENUM('CONFIRM','CANCEL'), at TIMESTAMPTZ)    -- presence ⇒ terminal & idempotent
```

The three hard cases all reduce to **"check the `decision` row first, inside one
DB transaction"**:

- **Try:** if `decision(xid)` exists and kind=`CANCEL` → **refuse** (Cancel-before-Try
  / anti-hanging: do not reserve). Else insert `reservation` in `TRIED`, move
  `available → held`.
- **Confirm:** upsert `decision(xid, CONFIRM)`. If a `TRIED` reservation exists →
  finalize (drop `held`, keep the debit). If **no** reservation exists →
  **empty-confirm**: the decision row is recorded but there's nothing to finalize
  (and a future `Try` will refuse on the same rule). Idempotent: second Confirm
  sees the decision row and returns.
- **Cancel:** upsert `decision(xid, CANCEL)`. If a `TRIED` reservation exists →
  release (`held → available`). If **no** reservation exists → **empty-cancel /
  null-compensation**: just leave the tombstone so the racing `Try` will refuse.
  Idempotent on repeat.

## 8. Interface contract

- `POST /orders` → `{ "order_id": "...", "wallet": N, "sku": "...", "qty": M }`;
  returns `201 {xid, status:"CONFIRMED"}` or `409 {xid, status:"CANCELLED", reason}`.
- Participant RPCs (idempotent, `xid` is the idempotency key):
  - `Try(xid, biz_args)` → `OK | INSUFFICIENT | ALREADY_CANCELLED`
  - `Confirm(xid)` → `OK` (always, after first effect)
  - `Cancel(xid)` → `OK` (always, after first effect)
- `GET /txn/{xid}` → coordinator's view: state, decision, per-participant phase-2 status.
- `GET /metrics` → Prometheus exposition.
- **PSP mapping is explicit:** the payment participant's `Try = authorize`,
  `Confirm = capture`, `Cancel = void`. Document this mapping in the README — it's
  the canonical real-world TCC and the reason the pattern exists.

## 9. Key technical challenges

- **The hanging problem (Cancel-before-Try).** Phase-2 messages can overtake
  phase-1 on a different connection/route. If `Cancel(xid)` lands first and you do
  nothing, the later `Try(xid)` reserves a resource that **no one will ever
  confirm** — a permanent leak. The fix is the **anti-hanging guard**: Cancel
  always writes a tombstone (null compensation) and Try always checks it. Get the
  ordering of the DB writes wrong and you reintroduce the leak.
- **Idempotency is non-negotiable.** Phase-2 is retried by the coordinator on
  every timeout, crash, and re-drive. Confirm/Cancel must be exactly-once *in
  effect* while being at-least-once *in delivery*. The `decision` row, written in
  the same transaction as the resource mutation, is the guard.
- **Confirm-after-timed-out-Cancel.** The TTL sweeper cancels a stale `TRY`, then
  a slow Confirm arrives. It must **not** resurrect the hold or double-apply.
  Decision-row precedence makes the first terminal write win.
- **Isolation vs. contention on hot rows.** Holding `available` down for the life
  of a reservation gives you saga-beating isolation — but on a hot SKU it
  serializes Tries and becomes your throughput wall. You'll feel the
  isolation/throughput trade-off directly (and compare it to 2PC's prepare locks).
- **Coordinator crash mid-protocol.** A coordinator that dies after some Tries but
  before deciding must, on restart, reach a *consistent global decision* and drive
  every participant to it — without a human and without double-applying.

## 10. Experiments to run (break it / tune it)

Record before/after numbers and the correctness proof for each:

1. **Cancel-before-Try reorder.** With the chaos hook, deliver `Cancel(xid)`
   ahead of `Try(xid)` for a controlled fraction of txns. Prove: every such `xid`
   ends terminal-cancelled, the late Try reserves **nothing**, and the
   open-reservation gauge returns to zero (no hang). Now *remove* the anti-hanging
   guard and show the leak reappear — that's your proof the guard is load-bearing.
2. **Duplicate Confirm / Cancel.** Deliver each phase-2 call N=1,10,100 times
   (interleaved). Show the resource ledger is byte-identical to N=1: no
   double-debit, no double-release. Report the dedup cost (extra decision-row
   reads/writes per duplicate).
3. **Timeout auto-cancel.** Inject abandoned carts (Try, never decide). Show the
   sweeper releases the hold within TTL + 1 interval, `held → available` returns,
   and a *late* Confirm for an auto-cancelled `xid` is rejected (no resurrection).
   Plot open-reservation count and sweeper backlog vs. abandon rate.
4. **Double-spend / oversell attempt.** On the last unit of a hot SKU (or the last
   dollar of a wallet), fire two concurrent orders. Prove exactly one Confirms and
   one is rejected at Try; `Σ confirmed ≤ capacity`. Repeat under the saga baseline
   and show it oversells.
5. **Coordinator crash + re-drive.** Kill the coordinator after all Tries, before
   the decision, during a 30-min run. On restart, prove every in-flight txn
   reaches a single global decision and every participant converges, with phase-2
   idempotency absorbing the re-drive.
6. **Throughput: TCC vs saga vs 2PC.** Same hardware, same flow. Report txn/s and
   p99 for: this TCC build, a plain saga (commit-then-compensate), and a 2PC
   coordinator. Quantify TCC's isolation tax vs the saga and its no-central-blocking
   win vs 2PC.

## 11. Milestones

1. Compose up; wallet + inventory participants with the three-op contract; a
   coordinator that does the happy-path Try→Confirm and the failure-path Try→Cancel
   for 2 participants. Prometheus + a Grafana board (open reservations, phase
   latencies, rare-path counters).
2. Add the `decision` ledger and make Confirm/Cancel idempotent + handle
   empty-confirm/empty-cancel. Add the PSP-style payment participant
   (authorize/capture/void).
3. Anti-hanging guard (Cancel-before-Try) + TTL sweeper auto-cancel; experiments
   1 and 3.
4. Coordinator transaction log + crash re-drive; chaos duplicate delivery;
   experiments 2 and 5.
5. Contention + bake-off: hot-SKU isolation proof and the TCC/saga/2PC throughput
   comparison (experiments 4, 6); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 30-min open-model run at a stated rate with the
      open-reservation gauge **bounded and returning to ~zero** (no monotonic
      leak); dashboard screenshot attached.
- [ ] **Reservation-leak rate = 0** demonstrated, including the
      Cancel-before-Try reorder path; the guard-removed counter-experiment shows
      the leak, proving the guard is what prevents it.
- [ ] **Zero double-spend / oversell** after chaos: show the SQL proving
      `Σ confirmed debits ≤ balance` and `Σ confirmed stock ≤ on_hand`.
- [ ] Confirm/Cancel **idempotency** proven: N×-delivery resource state equals
      1×-delivery state (show the diff).
- [ ] **Confirm-after-timed-out-Cancel** is a no-op (show the rejected late
      Confirm and the unchanged ledger).
- [ ] **TCC vs saga vs 2PC** throughput/latency table, with the isolation tax and
      the no-central-blocking win each quantified.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Nested / multi-level TCC:** a participant is itself a sub-coordinator
  (capture across two PSP rails). Show the contract composes.
- **Reservation-store sharding:** shard the hot SKUs to lift the contention
  ceiling; re-run experiment 4 and report the new throughput wall.
- **Try-less optimistic confirm** for cheap, non-contended resources (skip the
  hold, confirm directly) — show where it's safe and where it silently breaks
  isolation.
- **Coordinator-less (choreographed) TCC** over a message log: each participant
  reacts to Try/Confirm/Cancel events. Compare observability and failure handling
  to the orchestrated build (ties into [`07-saga`](../07-saga-orchestration-vs-choreography/)).
- Replace the per-`xid` decision row with a bounded **dedup window** + tombstone GC;
  measure the memory-vs-correctness-window trade-off.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Protocol correctness | Try/Confirm and Try/Cancel hold in the happy path | Empty-confirm, empty-cancel, **Cancel-before-Try** (anti-hanging / null compensation), and Confirm-after-timed-out-Cancel all handled and proven |
| Idempotency | Knows phase-2 must be idempotent | Implements it with a decision ledger; proves N×-delivery == 1× under chaos |
| Isolation | Notices a saga's dirty intermediate read | Shows TCC's held-reservation isolation prevents oversell; quantifies the contention cost on hot rows |
| Failure handling | Compensates on Try failure | Coordinator crash re-drives to a single global decision; TTL sweeper reclaims hangs; no resurrection |
| Pattern judgment | Can describe TCC | Knows **when to reach for TCC over a saga** (need isolation, can afford 3× code) **and over 2PC** (no central blocking, app-level, no free global atomicity); maps it to PSP authorize/capture/void |
| Communication | Clear findings note | Could defend every interleaving and the bake-off table to a staff panel |

## 15. References

- Pat Helland, *"Life Beyond Distributed Transactions"* — reservations and the
  case for activity-level compensation over 2PC.
- Seata **TCC** mode docs — the canonical empty-commit / empty-rollback /
  hanging-transaction treatment; mirror their guard logic.
- PSP semantics: card **authorize → capture → void** as the production face of
  Try → Confirm → Cancel.
- *Designing Data-Intensive Applications* — Ch. 9 (consistency & consensus) for
  why app-level atomicity beats holding XA prepare locks across services.
- See also: [`distributed-patterns/06-2pc-3pc-coordinator`](../06-2pc-3pc-coordinator/)
  (central-blocking commit), [`distributed-patterns/07-saga-orchestration-vs-choreography`](../07-saga-orchestration-vs-choreography/)
  (compensation without isolation), and [`staff/09-payment-core`](../../staff/09-payment-core/)
  (the money flow this protocol protects).
- Theory banks: [`Interview Question/13-distributed-systems/`](../../Interview%20Question/13-distributed-systems/)
  and [`Interview Question/11-messaging-and-event-streaming/`](../../Interview%20Question/11-messaging-and-event-streaming/).
