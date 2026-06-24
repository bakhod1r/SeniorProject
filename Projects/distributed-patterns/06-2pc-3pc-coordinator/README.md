# Two-Phase & Three-Phase Commit Coordinator

> Build a 2PC coordinator that commits atomically across N participants — and
> feel, in your own latency numbers and lock-wait graphs, *why* it is correct
> but operationally toxic. Then add 3PC's pre-commit phase, watch it reduce
> blocking, and watch it break under a network partition. Leave knowing exactly
> when **not** to reach for atomic commit.

| | |
|---|---|
| **Tier** | Distributed-patterns (distributed transactions) |
| **Primary domain** | Atomic commit across services / databases |
| **Skills exercised** | 2PC voting & commit phases, coordinator recovery log, participant prepared-state durability, in-doubt resolution, the blocking problem, 3PC pre-commit, FLP intuition, lock-hold-time analysis, Go (`database/sql`, gRPC, Postgres `PREPARE TRANSACTION`) |
| **Interview sections** | 13 (distributed systems), 5 (postgres/transactions), 15 (testing) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

You run the platform team. Two services — `accounts` and `inventory` — each own
their own Postgres, and product wants a "reserve-and-charge" operation that must
be **all-or-nothing** across both: either the money moves *and* the stock is
reserved, or neither happens. No partial states, ever.

Someone suggests "just do two-phase commit, it's the textbook answer." You agree
to build it — but as the engineer, your real job is to find out what that
sentence *costs*. You will implement a real 2PC coordinator, run it under
concurrent load, and produce the numbers that explain why every senior
distributed-systems engineer treats 2PC as a last resort: the lock-hold time
across round-trips, the throughput collapse under contention, and the
catastrophe where the coordinator dies after everyone votes "yes" and the
participants block — holding locks — until a human intervenes.

Then you'll add 3PC, measure how its extra phase narrows the blocking window,
and demonstrate the case it still cannot survive: an asymmetric network
partition. You finish able to defend, with evidence, *when* atomic commit is
acceptable and when sagas/TCC/consensus are the correct answer.

This is not a toy. You produce numbers, not opinions.

## 2. Goals / Non-goals

**Goals**
- Implement a correct **2PC coordinator**: a voting/prepare phase, then a
  commit/abort phase, across ≥ 2 independent participants (separate Postgres
  instances or separate in-process resource managers — state which).
- Make recovery real: a **coordinator write-ahead log** that records the global
  decision, and **durable participant prepared-state** so a crashed-and-restarted
  participant can finish a transaction it had voted "yes" on.
- Reproduce and *measure* the **blocking problem**: kill the coordinator after
  participants vote "yes"; show participants stuck holding locks indefinitely.
- Build the **recovery / in-doubt resolution** path: on restart the coordinator
  replays its log and tells participants the global outcome.
- Quantify **why 2PC kills throughput**: lock-hold time = sum of round-trips, and
  one slow/dead participant stalls everyone. Measure the tax vs a single local
  transaction.
- Add **3PC** (a pre-commit phase) and measure how it reduces blocking — then
  demonstrate it failing under a partition.

**Non-goals**
- Using XA / a managed distributed-transaction manager (Atomikos, Narayana). The
  point is to *build* the protocol so you see every round-trip and every lock.
- Implementing Paxos/Raft here — that's `staff/03-raft-metadata-kv-store/`. You
  may *contrast* with consensus-based commit in your findings, not build it.
- Solving the partition case "properly." 3PC's failure under partition is a
  *result* you must demonstrate, not a bug to fix.
- Production-grade RPC ergonomics. A thin gRPC or HTTP transport is fine.

## 3. Functional requirements

1. A **coordinator** (`cmd/coordinator`) exposes `Begin → Commit(txnID)` and
   internally drives the protocol:
   - **Phase 1 (prepare/vote):** send `Prepare(txnID, op)` to every participant;
     collect `VoteYes` / `VoteNo`.
   - **Phase 2 (commit/abort):** if *all* voted yes, durably record `COMMIT` in
     the coordinator log **before** sending `Commit` to participants; if any
     voted no (or timed out), record `ABORT` and send `Abort`.
2. Each **participant** (`cmd/participant`) is a resource manager over its own
   Postgres:
   - On `Prepare`, it does the work, takes the needed locks, and **durably
     persists prepared state** (use Postgres `PREPARE TRANSACTION 'txnID'`, or an
     explicit prepared-ops table) such that it can survive a crash and still
     honor a later commit/abort. It must reply `VoteNo` if it cannot prepare.
   - On `Commit`/`Abort`, it finalizes (`COMMIT PREPARED` / `ROLLBACK PREPARED`)
     and releases locks. These handlers must be **idempotent** (the coordinator
     will retry).
3. **Recovery:** on coordinator restart, replay the log; for every txn with a
   recorded decision but unacknowledged participants, **re-send the decision**.
   For any participant restart, the participant must be able to ask the
   coordinator "what happened to txn X?" (in-doubt resolution).
4. A **chaos hook** (`cmd/chaos`) can: kill the coordinator at a chosen point
   (`after-vote`, `after-decision-logged`, `mid-phase-2`); kill or pause a
   participant; and inject a network partition between coordinator and a
   participant.
5. A **3PC mode** (flag) inserting a **pre-commit** phase between vote and commit,
   with participant-side timeouts that allow termination without the coordinator
   in the no-partition case.

## 4. Load & data profile

- **Participants:** test at **N = 2, 3, 5, and 8** participants. Throughput and
  lock-hold time degrade with N — show the curve.
- **Transaction rate:** drive **≥ 5,000 concurrent 2PC transactions** in a
  sustained run; for the high-RPS stage push the offered rate until commit
  latency or lock-wait blows past the SLO.
- **Contention model:** transactions touch a keyspace of configurable size so you
  can dial **conflict probability**. Two profiles: **low-contention** (1M keys,
  near-zero conflict) and **hot-contention** (1,000 keys, Zipfian s≈1.2, so the
  same rows are repeatedly locked). The hot profile is where 2PC dies — by
  design.
- **Work per participant:** a configurable simulated work/IO cost
  (`-participant-latency`) so you can model a slow participant.
- **Generator:** `cmd/gen` (or driver flags) is deterministic given a seed.
- **Baseline:** the same logical operation as a **single local Postgres
  transaction** (no coordinator) is the control you measure the 2PC tax against.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Atomic-commit correctness (all stages) | **Zero** partial outcomes: across all participants the txn is committed everywhere or aborted everywhere — verified by a cross-participant invariant check |
| Commit latency p99 (N=3, low-contention) | Measure & report; expect ≈ `2 × max(participant RTT) + 2 × log fsync` — name the dominant term |
| 2PC throughput vs local-txn baseline | Report the **tax**: 2PC commits/s as a fraction of the local baseline at the same rate; explain the gap (round-trips + lock-hold time) |
| Lock-hold time per txn | Measured (prepare → commit ack); show it grows with N and with participant latency |
| Blocking incidents | Kill coordinator after votes: report **how long** participants stay blocked (should be *until recovery* — i.e. unbounded without it) and how many locks are pinned |
| In-doubt recovery time | After coordinator restart, time to resolve all in-doubt txns and release every pinned lock |
| 3PC vs 2PC blocking window | Quantify the reduction in no-partition crashes; then show 3PC producing an **inconsistent** outcome under partition |

> The point is not a magic latency number. It's to **measure your own 2PC tax**,
> **prove** the blocking problem with locks you can see in `pg_locks`, and
> **explain** the trade every line of the curve represents.

## 6. Architecture constraints & guidance

- Postgres per participant via `docker-compose` (pin the version). Postgres'
  `PREPARE TRANSACTION` / `COMMIT PREPARED` / `ROLLBACK PREPARED` gives you real,
  durable prepared state and real held locks — use it; it's the whole point.
  (Set `max_prepared_transactions > 0`.)
- Coordinator and participants are **separate binaries** so you can kill them
  independently. Transport: gRPC or HTTP — keep it thin.
- The **coordinator log must be durable and fsynced before** the decision is
  acted on. The ordering invariant is sacred: *log the global COMMIT, fsync,
  then* send commits. If you send a commit before logging, a crash loses the
  decision and you can produce a split outcome — implement it correctly and add a
  test that fails if the order is wrong.
- Participant `Prepare` must persist enough to answer a commit *after a crash*
  with no coordinator help beyond "what was the decision."
- Instrument with Prometheus: per-phase latency, lock-hold time, in-flight
  prepared txns, blocked-participant count, `pg_locks` waiters, decision-log
  fsync time. Expose `pg_prepared_xacts` count — it's your in-doubt gauge.

## 7. Data model

```
coordinator log (durable, append-only, fsynced):
  txn_log(txn_id PK, state TEXT, participants TEXT[], decided_at TIMESTAMPTZ)
    -- state: STARTED → PREPARING → COMMITTED | ABORTED
    -- the COMMITTED/ABORTED row MUST be fsynced before phase-2 messages go out

participant side (Postgres-native path):
  -- Phase 1: do the work inside a txn, then:
  PREPARE TRANSACTION 'txn_id';      -- durable, holds locks, survives crash
  -- Phase 2:
  COMMIT PREPARED 'txn_id';          -- or ROLLBACK PREPARED 'txn_id'
  -- in-doubt visible in pg_prepared_xacts until resolved

participant side (explicit path, if not using PREPARE TRANSACTION):
  prepared_ops(txn_id PK, payload JSONB, locks_held TEXT[], vote TEXT, prepared_at TIMESTAMPTZ)
  -- finalize step applies/discards the payload idempotently and releases locks
```

The application invariant (e.g. ledger balance + reserved stock) lives in the
participants' own tables; your correctness check reads **all** participants and
asserts they agree on every txn's outcome.

## 8. Interface contract

- `POST /txn` `{ ops: [{participant, op}...] }` → `{ txn_id, outcome: "committed"|"aborted" }`
- `GET /txn/{id}` → coordinator's recorded decision (this is the in-doubt
  resolution endpoint participants call after a crash).
- `GET /metrics` → Prometheus exposition (per-phase latency, lock-hold, blocked
  count, prepared-xact count).
- Coordinator/driver flags: `-participants`, `-mode={2pc,3pc}`,
  `-participant-latency`, `-contention={low,hot}`, `-keys`, `-rate`,
  `-crash-point={none,after-vote,after-decision,mid-phase2}`.

## 9. Key technical challenges

- **The fsync-before-act ordering.** The single most important correctness rule
  in 2PC: the coordinator must durably record the global decision *before* it
  tells anyone to commit. Get this wrong and a crash produces a split-brain
  commit. Make it explicit; test that reordering it breaks atomicity.
- **The blocking problem is structural, not a bug.** If the coordinator crashes
  after participants vote "yes" but before they hear the decision, participants
  are *correctly* stuck: they may not unilaterally commit (the decision might be
  abort) nor abort (it might be commit). They hold their locks and wait. You will
  see this in `pg_prepared_xacts` and `pg_locks` and it is 2PC working as
  designed — this is the headline result of the lab.
- **Lock-hold time = the throughput killer.** Locks are held from `Prepare`
  until the commit ack — i.e. across *two* network round-trips plus a coordinator
  fsync. Under contention, every other txn touching those rows waits. The tax
  compounds with N (slowest participant gates phase 1) and with any straggler.
- **In-doubt recovery.** A restarted coordinator must replay its log and a
  restarted participant must reconcile `pg_prepared_xacts` against the
  coordinator's recorded decisions — committing the ones decided COMMIT, rolling
  back the rest, idempotently, with no double-apply.
- **3PC's promise and its limit.** The pre-commit phase lets a participant that
  times out on a *crashed* coordinator reach a safe decision *with its peers* —
  reducing blocking. But 3PC assumes a synchronous network with bounded message
  delay; under an asymmetric partition, two halves can independently decide
  differently. You must demonstrate this inconsistency, not hand-wave it.
- **FLP, concretely.** No deterministic protocol guarantees both safety and
  liveness with a faulty process in an asynchronous network. 2PC chooses safety
  and *blocks* (sacrifices liveness). 3PC buys liveness back by assuming
  synchrony — and breaks when that assumption is violated. You should be able to
  point at the exact place in your code where each chose its side of FLP.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it is your control. Don't tune what isn't atomic.

- **Stage 0 · Simple — atomic commit is correct.** 2PC across **2–3
  participants**, low rate, no faults. Prove the invariant: every txn either
  commits on *all* participants or aborts on *all*. Inject a single `VoteNo` and
  show the global abort. Inject a crash at `after-decision` and show recovery
  resolving it the right way. No performance claims yet — just *correctness you
  can demonstrate with a cross-participant diff*.

- **Stage 1 · Big data — large/long transactions, many participants.** Push **N
  up to 8** and make transactions touch more rows / do more work per participant.
  Watch **lock-hold time** grow (phase 1 is gated by the slowest participant) and
  the **coordinator log** grow. Measure: commit latency vs N (it climbs with
  `max` participant RTT), log size and fsync cost over a long run, and how many
  rows sit locked across the prepared window. This is the *volume* axis — bigger
  txns and more participants stretch the window every lock is held.

- **Stage 2 · High RPS — many concurrent 2PC transactions.** Small txns, but fire
  **thousands per second**. Run the **hot-contention** profile (1,000 keys,
  Zipfian) so concurrent txns fight for the same rows held across the prepare
  window. Watch **throughput collapse**: commits/s plateaus and then falls as
  lock-wait queues build, even though no participant is "busy" — they're *waiting
  on held locks*. **Quantify the tax:** 2PC commits/s vs the single-local-txn
  baseline at the same offered rate, and p99 commit latency vs local p99. Name
  the dominant cost (round-trips + lock-hold across them).

- **Stage 3 · Both — high txn rate with a slow/crashing participant.** The
  production boss fight: high concurrency **and** failure. (a) Add one **slow
  participant** (`-participant-latency`) and show it stalls *everyone* — the whole
  system's throughput tracks the slowest node because locks are held until the
  slow node acks. (b) **Crash the coordinator after votes** under load and
  measure the **blocking incident**: how many txns freeze, how many locks pin,
  for how long (unbounded until recovery), and the recovery time once it
  restarts. (c) Run the same load through **3PC** and show the blocking window
  shrink in the no-partition crash — then inject a **partition** and catch 3PC
  producing an inconsistent outcome. (d) Re-run the workload's intent as a
  **saga** (`distributed-patterns/07-saga`) or **TCC**
  (`distributed-patterns/08-tcc`) and put their throughput/latency next to 2PC's.
  The deliverable is the side-by-side table that explains *why 2PC doesn't scale*
  and what you'd actually ship.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Correctness baseline.** N=3, low-contention, no faults: commit, abort (one
   `VoteNo`), and a clean recovery from `-crash-point=after-decision`. Show the
   cross-participant invariant holds in all three.
2. **The 2PC tax.** Same logical op as (a) a local Postgres txn and (b) 2PC over
   N=3. Report Δ throughput and Δ p99. Decompose the 2PC latency into RTTs +
   fsync + lock-wait.
3. **Scale with N.** N = 2,3,5,8 at fixed rate. Plot commit p99 and lock-hold
   time vs N. Confirm phase 1 is gated by the slowest participant.
4. **Contention collapse.** Low vs hot contention at rising RPS. Find the rate
   where commits/s peaks then falls; explain with lock-wait queue depth, not CPU.
5. **The blocking problem (headline).** `-crash-point=after-vote` under load.
   Show participants stuck: count rows in `pg_prepared_xacts`, locks pinned in
   `pg_locks`, and the duration (it does not self-resolve). This is the result.
6. **Recovery / in-doubt.** Restart the coordinator; time until every in-doubt
   txn is resolved and every pinned lock released. Then crash a *participant*
   mid-phase-2 and show it reconciles correctly on restart, idempotently.
7. **Slow participant stalls everyone.** Set one participant's latency to 200 ms
   while others are <5 ms; show system throughput collapse to the slow node's
   rate because locks wait on it.
8. **3PC reduces blocking — until it doesn't.** Same crash-after-vote scenario in
   3PC: show participants terminate without the coordinator (blocking window
   shrinks). Then partition the cluster mid-protocol and demonstrate two sides
   reaching *different* decisions — capture the inconsistent outcome.
9. **Contrast with the alternatives.** Run the workload as a saga and/or TCC;
   tabulate throughput, p99, and failure behavior next to 2PC/3PC. Conclude when
   each is the right tool.

## 11. Milestones

1. Compose up: coordinator + 2 participants over Postgres `PREPARE TRANSACTION`;
   happy-path 2PC commit/abort; cross-participant invariant check; Prometheus +
   a Grafana board for per-phase latency, lock-hold, prepared-xact count.
2. Durable coordinator log with the fsync-before-act ordering; recovery replay;
   a test that fails if the ordering is reversed (experiment 1).
3. Load driver + contention generator; the 2PC tax and N-scaling curves
   (experiments 2–4).
4. Chaos hook; the blocking problem and in-doubt recovery proven, with `pg_locks`
   / `pg_prepared_xacts` evidence (experiments 5–7).
5. 3PC mode; blocking-reduction and partition-inconsistency demos; saga/TCC
   contrast table; findings note (experiments 8–9).

## 12. Acceptance criteria (definition of done)

- [ ] Atomicity holds across all participants in every run: a committed script
      that asserts `committed-everywhere ∨ aborted-everywhere` for thousands of
      txns including chaos runs (show the diff/SQL).
- [ ] The fsync-before-act ordering is enforced and **tested** — a test proves
      that reordering it produces a split outcome.
- [ ] The 2PC tax is reported as a number: commits/s and p99 vs the local-txn
      baseline, with the latency decomposed.
- [ ] The blocking problem is demonstrated with evidence: post-coordinator-crash
      `pg_prepared_xacts` count, pinned `pg_locks`, and the unbounded wait until
      recovery.
- [ ] Recovery resolves every in-doubt txn and releases every pinned lock; a
      crashed participant reconciles idempotently on restart.
- [ ] 3PC mode shows a measured reduction in the crash-blocking window **and** a
      reproduced inconsistent outcome under partition.
- [ ] A findings note answers: what does 2PC cost, why doesn't it scale, and for
      this workload would you ship 2PC, a saga, or TCC — with numbers.
- [ ] Every number is reproducible from a committed command + config.

## 13. Stretch goals

- **Presumed-abort / presumed-commit** optimizations: cut log writes and ack
  messages for the common case; measure the throughput gain and re-verify
  correctness.
- **Cooperative termination protocol** for 3PC: let participants query each other
  (not just the coordinator) to reach a decision; show it narrows blocking
  further in the no-partition case.
- **Read-only participant optimization:** a participant with no writes can vote
  and *drop out* of phase 2 (release locks early). Measure the win.
- **Consensus-based commit:** sketch (or wire up against
  `staff/03-raft-metadata-kv-store/`) how replacing the single coordinator with a
  replicated log removes the single-point blocking — the modern answer — and
  contrast its latency.
- **Heuristic resolution:** simulate an operator force-resolving an in-doubt txn
  the "wrong" way and show the resulting inconsistency — why heuristic commits
  are dangerous.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Protocol correctness | 2PC commits/aborts atomically in the happy path | Atomicity holds through coordinator *and* participant crashes; can point at the fsync-before-act ordering and explain why it's load-bearing |
| The blocking problem | Knows the coordinator is a single point of failure | **Reproduces** it with `pg_locks` evidence; explains *why* participants must block (can't safely commit or abort) and what unblocks them |
| Throughput analysis | Reports 2PC is slower than a local txn | Quantifies the tax, decomposes it into RTTs + fsync + lock-hold, and shows it compounding with N and stragglers |
| 3PC understanding | Knows 3PC adds a pre-commit phase to reduce blocking | Demonstrates the reduction **and** the partition inconsistency; ties both to the synchrony assumption |
| FLP / theory | Has heard of FLP | Explains the safety-vs-liveness trade concretely; points at where 2PC chose safety+blocking and 3PC chose liveness+synchrony |
| Design judgment | Can implement 2PC when asked | Knows when **not** to: recommends saga/TCC/consensus for this workload with numbers, and states the narrow cases where 2PC is still right |
| Communication | Clear findings note | Could defend every curve and the "don't ship 2PC here" call to a staff panel |

## 15. References

- Gray & Lamport, *Consensus on Transaction Commit* (Paxos Commit; the
  single-coordinator vs replicated-coordinator framing).
- Fischer, Lynch & Paterson, *Impossibility of Distributed Consensus with One
  Faulty Process* (FLP).
- Skeen & Stonebraker on 3PC and non-blocking commit; and why it needs synchrony.
- *Designing Data-Intensive Applications* — Ch. 9 (2PC, distributed transactions,
  XA, the coordinator-failure blocking discussion).
- Bernstein, Hadzilacos & Goodman, *Concurrency Control and Recovery in Database
  Systems* — Ch. 7 (atomic commit protocols).
- Postgres docs: `PREPARE TRANSACTION`, `COMMIT PREPARED`, `pg_prepared_xacts`,
  `max_prepared_transactions`.
- Alternatives in this library: `distributed-patterns/07-saga-orchestration-vs-choreography/`
  and `distributed-patterns/08-tcc-try-confirm-cancel/`.
- See also: `Interview Question/13-distributed-systems/` and
  `Interview Question/05-postgresql-and-sql/`; testing the protocol →
  `Interview Question/15-testing/`.
