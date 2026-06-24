# Durable Job Queue & Scheduler

> Build a background-job system that runs each job *exactly once at a time*,
> never loses one across a worker crash, and drains a backlog of millions
> without a single double-run. Then find the throughput ceiling where claim
> contention — not your handlers — becomes the bottleneck, and prove it.

| | |
|---|---|
| **Tier** | Senior (own a service end-to-end) |
| **Primary domain** | Async task processing / messaging |
| **Skills exercised** | Worker pools, lease/claim semantics, idempotency, retries + backoff, scheduling, DLQ, graceful shutdown, Go (`pgx` `SKIP LOCKED` or `go-redis` streams) |
| **Interview sections** | 2 (concurrency), 11 (messaging), 15 (testing) |
| **Est. effort** | 4–6 focused days |

---

## 1. Context

Every product eventually grows a "do it later" pile: send the email, transcode
the video, charge the card, rebuild the search index, fan out the webhook. The
naive version is a goroutine and a `time.Sleep`, and it works until the process
restarts mid-job and the charge is silently lost — or runs twice. You're now the
engineer who owns the **job queue** that the whole company enqueues onto, and the
contract is brutal in its simplicity: *a job that was accepted gets run, and a
job that's running isn't also running somewhere else.*

In this project you build a durable, Postgres- or Redis-backed job system in Go
with worker pools, retries with backoff, scheduling/delays, priorities, and a
dead-letter queue — then you load it to **10k+ jobs/s** with a **backlog of
millions** and prove the guarantees hold while a worker is being killed under
load. You will produce numbers and a job-loss test, not a happy-path demo.

## 2. Goals / Non-goals

**Goals**
- Implement **reliable claim/lease semantics** so a queued job is run by exactly
  one worker at a time — `SELECT ... FOR UPDATE SKIP LOCKED` (Postgres) or Redis
  Streams consumer groups (`XREADGROUP` / `XCLAIM`).
- Deliver **at-least-once + idempotent handlers**, and articulate honestly why
  "exactly-once execution" is an aspiration the system approximates, not a
  guarantee it provides.
- Retries with **exponential backoff + jitter**, a `max_attempts` cap, and
  routing to a **dead-letter queue** on exhaustion.
- **Visibility timeout / lease renewal** so long jobs aren't stolen mid-run, and
  crashed-worker jobs *are* reclaimed.
- **Scheduled/delayed** jobs (`run_at`) and recurring **cron** jobs.
- **Priority** queues, **graceful shutdown** (drain in-flight, requeue nothing
  twice), and **poison-job** containment.
- Observability: queue depth, oldest-job age, throughput, retry rate, DLQ rate.

**Non-goals**
- A managed queue (SQS, Cloud Tasks, Temporal). Build it so you own the claim
  loop and see every knob.
- Cross-region / multi-datacenter replication (that's a staff concern).
- A general workflow engine with DAGs and signals — single jobs only, no
  child-job orchestration beyond enqueue.

## 3. Functional requirements

1. An **enqueue API** (`Enqueue(ctx, job)`): accepts a job type, JSON payload,
   optional `run_at`, priority, and a caller-supplied **idempotency key**;
   returns a job ID. Enqueue is durable before it returns (committed row /
   `XADD` ack).
2. A **worker pool** (`cmd/worker`) with N goroutines per process and M processes,
   each claiming jobs, running the registered handler, and acking success or
   scheduling a retry.
3. A **handler registry**: `Register("send_email", fn)` where `fn` is
   `func(ctx, payload) error`. Returning `nil` acks; returning an error retries;
   returning a sentinel `ErrDrop` dead-letters immediately.
4. **Retries**: on failure, reschedule with exponential backoff + jitter up to
   `max_attempts`, then move to the DLQ with the last error recorded.
5. **Scheduler**: delayed jobs become visible at `run_at`; a **cron** registrar
   enqueues recurring jobs without double-firing across multiple worker
   processes (leader/lock or `INSERT ... ON CONFLICT`).
6. **Lease renewal**: a long-running job heartbeats to extend its lease; a worker
   that dies lets the lease expire and another worker reclaims the job.
7. **Graceful shutdown**: on SIGTERM, stop claiming, finish in-flight jobs within
   a drain deadline, and leave the rest cleanly claimable by others.
8. A **chaos hook** (`cmd/chaos`) can `kill -9` a worker mid-job, flap a
   downstream dependency, and inject poison payloads.

## 4. Load & data profile

- **Throughput:** sustain **≥ 10,000 jobs/s** enqueue + process end-to-end for
  ≥ 20 minutes; report the ceiling and what bounds it.
- **Backlog:** pre-seed **≥ 5,000,000 queued jobs** and measure drain time and
  drain throughput from a cold start.
- **Job mix:** deliberately heterogeneous — 70% fast (1–5 ms), 20% slow
  (200 ms–2 s, exercise lease renewal), 5% flapping (fail then succeed), 5%
  poison (always fail → DLQ).
- **Duration skew:** at least one job class runs **> visibility timeout** so you
  *must* implement lease renewal correctly or it gets double-run.
- **Concurrency:** ≥ 8 worker processes × ≥ 64 workers each (≥ 512 concurrent
  claimers) hitting one backend — this is where claim contention shows up.
- **Generator:** `cmd/gen` is deterministic given a seed; payloads carry an
  embedded `seq` so the harness can detect loss and duplication exactly.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Sustained processing throughput (mixed job mix, durable enqueue) | Find & report the ceiling; name the bound (claim contention? DB IOPS? handler CPU? lock waits?) |
| Claim latency p99 (worker asks for next job → has a leased job) | < 10 ms at 80% of throughput ceiling |
| Enqueue p99 (durably committed) | < 25 ms |
| At-least-once guarantee | **Zero lost jobs** after `kill -9` mid-process: every accepted `seq` is completed or in DLQ |
| Double-run rate under chaos | Effectively zero — with idempotent handlers, observed effect of each `seq` is applied **once**; raw re-deliveries are counted and bounded |
| Scheduled-job lateness p99 (fire delay past `run_at`) | < 1 s at 1M-deep backlog |
| Backlog drain throughput (5M cold backlog) | Report jobs/s and total drain time |
| DLQ correctness | Poison jobs land in DLQ after exactly `max_attempts`, never silently dropped |
| Graceful-shutdown drain | 100% of in-flight jobs finish or cleanly requeue; none lost, none acked twice |

> The point isn't a magic jobs/s number — it's to **find** your backend's ceiling,
> **explain** it, and prove the loss/double-run invariants hold around it.

## 6. Architecture constraints & guidance

- **Backend (pick one, justify it):**
  - *Postgres + `pgx`*: one `jobs` table, claim via
    `SELECT ... FOR UPDATE SKIP LOCKED LIMIT $batch`. `SKIP LOCKED` is the whole
    trick — concurrent claimers step over each other's locked rows instead of
    blocking. Watch index bloat and dead-tuple churn on a high-update table.
  - *Redis Streams + `go-redis`*: `XADD` to enqueue, consumer group via
    `XREADGROUP`, reclaim stuck entries with `XAUTOCLAIM`/`XPENDING`, `XACK` on
    success. Delayed jobs ride a ZSET keyed by `run_at`, swept into the stream.
- Worker is a **separate binary** from any enqueuer so you can scale and kill
  workers independently.
- **Batch claims** (e.g. 50–500 rows per claim) to amortize round-trips; this is
  the single biggest throughput lever and the source of the contention ceiling.
- Run the backend via `docker-compose`, version pinned. For Postgres, tune
  `autovacuum` aggressively — a hot job table dies without it.
- Instrument with Prometheus: enqueue rate, claim rate, ack rate, in-flight
  count, queue depth, oldest-job age, retry rate, DLQ rate, claim p99, lease
  renewals, reclaims.

## 7. Data model

**Postgres (`SKIP LOCKED`) variant:**

```
jobs(
  id            BIGSERIAL PK,
  queue         TEXT      NOT NULL,          -- e.g. 'default','email','critical'
  type          TEXT      NOT NULL,          -- handler key
  payload       JSONB     NOT NULL,
  idempotency_key TEXT,                      -- caller-supplied; UNIQUE per (queue,key)
  priority      INT       NOT NULL DEFAULT 0,-- higher runs first
  status        TEXT      NOT NULL DEFAULT 'ready', -- ready|running|done|dead
  run_at        TIMESTAMPTZ NOT NULL DEFAULT now(), -- delayed/scheduled visibility
  attempts      INT       NOT NULL DEFAULT 0,
  max_attempts  INT       NOT NULL DEFAULT 25,
  leased_until  TIMESTAMPTZ,                 -- visibility timeout / lease expiry
  locked_by     TEXT,                        -- worker id holding the lease
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)
-- claim hot path:
CREATE INDEX ON jobs (queue, priority DESC, run_at)
  WHERE status = 'ready';                    -- partial index: only claimable rows

dead_jobs(... same shape ..., died_at TIMESTAMPTZ, final_error TEXT)
cron(name PK, spec TEXT, type TEXT, payload JSONB, next_run TIMESTAMPTZ)
```

Claim query (the core of the whole system):
```sql
WITH cte AS (
  SELECT id FROM jobs
  WHERE status = 'ready' AND run_at <= now() AND queue = $1
  ORDER BY priority DESC, run_at
  FOR UPDATE SKIP LOCKED
  LIMIT $2
)
UPDATE jobs j SET status='running', attempts=attempts+1,
       leased_until=now()+$3, locked_by=$4
FROM cte WHERE j.id = cte.id
RETURNING j.id, j.type, j.payload, j.attempts;
```

**Redis Streams variant:** stream `jobs:{queue}` + consumer group `workers`;
`XADD` enqueue, `XREADGROUP ... COUNT n BLOCK`, `XACK` on done; `XAUTOCLAIM` for
idle > visibility-timeout entries; a `ZSET delayed:{queue}` swept by a ticker
into the stream when `run_at <= now()`; `dead:{queue}` stream for the DLQ.

## 8. Interface contract

**Client / handler API (Go):**
```go
type Job struct {
    Type           string
    Payload        []byte
    Queue          string        // default "default"
    Priority       int
    RunAt          time.Time     // zero = now
    MaxAttempts    int           // 0 = registry default
    IdempotencyKey string        // optional dedup on enqueue
}

func (c *Client) Enqueue(ctx context.Context, j Job) (id int64, err error)

type Handler func(ctx context.Context, payload []byte) error
func (w *Worker) Register(jobType string, h Handler)   // ErrDrop → straight to DLQ
func (w *Worker) Run(ctx context.Context) error        // blocks until ctx canceled, then drains
```

**Operational endpoints:**
- `GET /metrics` → Prometheus exposition (all gauges/counters from §6).
- `GET /stats?queue=default` → `{ ready, running, dead, oldest_age_s, attempts_p99 }`.
- `POST /dlq/{id}/requeue` → move a dead job back to `ready` with attempts reset.
- Worker flags/env: `-queues`, `-concurrency`, `-claim-batch`,
  `-visibility-timeout`, `-drain-timeout`, `-backend=pg|redis`.

## 9. Key technical challenges

- **One run at a time.** The claim must be atomic: select-and-lease in a single
  transaction, or two workers grab the same job. `SKIP LOCKED` gives you this
  without a global lock; Redis gives it via consumer-group ownership. Get this
  wrong and your double-run test fails immediately.
- **At-least-once is the real contract.** A worker can finish a job and die
  before acking — the job *will* be re-delivered. The only honest answer is
  **idempotent handlers** (dedup on idempotency key / `seq`). Treat
  "exactly-once execution" as a property of the *effect*, achieved by the
  handler, not the queue.
- **Lease renewal vs. visibility timeout.** Too short and long jobs get stolen
  and double-run; too long and a crashed worker's jobs sit dead for minutes.
  Heartbeating leases is the fix — and it must be correct under clock skew.
- **The claim-contention ceiling.** At 512 concurrent claimers on one Postgres
  table, throughput stops scaling with workers and starts being bound by row
  locks, index updates, and autovacuum. Bigger claim batches help — until they
  cause uneven work distribution and longer leases. Find the knee.
- **Poison jobs.** A job that always panics or always fails must not wedge a
  worker or spin the retry loop hot. Cap attempts, catch panics, route to DLQ,
  and rate-limit retry churn.
- **Graceful shutdown without double-acking.** Drain in-flight on SIGTERM, but a
  job whose lease you've already lost must not be acked by the dying worker.

## 10. Experiments to run (break it / tune it)

Record before/after numbers for each:

1. **Throughput vs. worker count:** sweep total concurrency 16 → 64 → 256 → 512 →
   1024. Plot processed jobs/s. Find where adding workers stops helping — that's
   the **claim-contention ceiling**. Name the bound (lock waits / IOPS / vacuum).
2. **Claim-batch sweep:** `claim-batch` = 1, 10, 50, 200, 1000 at fixed
   concurrency. Throughput and claim p99 vs batch size; find the knee and explain
   the latency/fairness cost of big batches.
3. **Job-loss test (the headline):** drive steady load, `kill -9` a worker
   mid-process repeatedly. Afterward prove **every accepted `seq` is `done` or in
   DLQ — zero lost**, and that idempotent handlers applied each effect once.
   Show the SQL/diff.
4. **Backlog drain:** pre-seed 5M jobs, start cold, measure drain throughput and
   total time. Compare to steady-state throughput — why is it different?
5. **Flapping dependency:** point 5% of jobs at a dependency that fails for 60 s
   then recovers. Show backoff+jitter spreading retries (no thundering herd) and
   jobs completing after recovery, none hitting DLQ prematurely.
6. **DLQ growth under poison:** inject 5% always-failing jobs. Confirm each lands
   in DLQ after exactly `max_attempts`, retry CPU stays bounded, and healthy
   throughput is unaffected.
7. **Scheduled-job latency at depth:** schedule jobs for `now()+5s` while a 1M
   backlog churns. Measure fire-delay p99 past `run_at` — does the scheduler
   starve behind the backlog?
8. **Graceful-shutdown correctness:** SIGTERM a worker with 200 in-flight jobs.
   Prove every in-flight job either completed or was cleanly reclaimed by another
   worker — none lost, none acked twice.
9. **Lease-renewal proof:** run jobs longer than the visibility timeout *without*
   renewal (expect double-runs), then *with* renewal (expect none). Show the
   delta.

## 11. Milestones

1. Backend up via compose; `jobs` table / stream; enqueue + single-worker claim
   loop with `SKIP LOCKED`; Prometheus + a Grafana board for depth/throughput/age.
2. Worker pool + handler registry + retries with backoff + jitter + DLQ.
3. Visibility timeout + lease renewal + reclaim of crashed-worker jobs
   (experiment 9).
4. Scheduler (`run_at`) + cron without double-fire; priorities; graceful drain.
5. Load harness: 10k+ jobs/s, 5M backlog seed, chaos hooks. Run the headline
   job-loss and contention experiments (1, 3, 4); write the findings note.
6. Remaining experiments (2, 5–8); ceiling curve with the bottleneck proven.

## 12. Acceptance criteria (definition of done)

- [ ] Sustained ≥ 20-min run at ≥ 10k jobs/s with **bounded, flat** queue depth;
      dashboard screenshot attached.
- [ ] Throughput ceiling reported **with the bottleneck named and proven**
      (pg lock-wait stats / `pg_stat_activity` / pprof / IOPS evidence).
- [ ] **Job-loss test passes:** after repeated `kill -9` mid-process under load,
      every accepted `seq` is `done` or in DLQ — zero lost (show the SQL/diff).
- [ ] **No double-run effect:** idempotency proven — each `seq`'s effect applied
      once despite re-deliveries; raw re-delivery count reported.
- [ ] Lease renewal proven on jobs longer than the visibility timeout (experiment 9).
- [ ] Retries follow exponential backoff + jitter; poison jobs reach DLQ after
      exactly `max_attempts`.
- [ ] Scheduled-job lateness p99 < 1 s at 1M backlog; cron never double-fires.
- [ ] Graceful shutdown drains in-flight with zero loss and zero double-ack.
- [ ] 5M-job backlog drain throughput + time reported.
- [ ] Every number reproducible from a committed command + config + seed.

## 13. Stretch goals

- **Both backends:** implement Postgres *and* Redis Streams behind the same
  interface; compare throughput ceiling, claim p99, and operational pain.
- **Fairness / weighted queues:** prevent one tenant's flood from starving others
  (per-queue concurrency caps or weighted claiming); measure tail fairness.
- **Adaptive backoff:** circuit-break a job *type* whose dependency is down
  instead of retrying every instance; measure retry-CPU saved.
- **Batched acks / claims pipelining** to push the ceiling higher; quantify the
  gain and any correctness cost.
- **Unique jobs:** dedup enqueue so an identical pending job isn't queued twice
  (`ON CONFLICT` on idempotency key); prove under concurrent enqueuers.
- **Exactly-once *aspiration* writeup:** consume-process-produce with the ack and
  the side effect in one transaction; document precisely where it still can't be
  exactly-once and why at-least-once + idempotency is the right model.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Claim/lease correctness | One-run-at-a-time holds in the happy path | Holds through `kill -9`, lease expiry, and clock skew; explains *why* `SKIP LOCKED` / consumer-group ownership is correct |
| Delivery semantics | Knows it's at-least-once; handlers are idempotent | Articulates the exactly-once boundary precisely; proves no observable double-effect |
| Throughput analysis | Reports a jobs/s ceiling | Names and **proves** the claim-contention bottleneck; knows the next one and how to push past it |
| Retries & DLQ | Backoff + jitter + max-attempts + DLQ work | Tunes backoff for a flapping dependency without herds; contains poison without hurting healthy throughput |
| Long jobs | Implements visibility timeout | Lease renewal correct; demonstrates the double-run it prevents |
| Scheduling | Delayed + cron jobs fire | No double-fire across processes; bounded lateness under deep backlog |
| Shutdown | Drains in-flight on SIGTERM | Zero loss and zero double-ack proven under chaos |
| Communication | Clear findings note | Could defend every curve and the loss-test to a staff panel |

## 15. References

- Postgres: `FOR UPDATE SKIP LOCKED` semantics; partial indexes; autovacuum
  tuning for high-churn tables.
- `jackc/pgx` docs; prior art: `riverqueue/river`, `contribsys/faktory`,
  `vgarvardt/gue` (Postgres `SKIP LOCKED` job queues in Go).
- Redis: Streams + consumer groups (`XADD`/`XREADGROUP`/`XACK`/`XAUTOCLAIM`),
  `go-redis` (`redis/go-redis`); prior art: `hibiken/asynq`.
- *Designing Data-Intensive Applications* — Ch. 11 (message brokers, delivery
  guarantees), Ch. 8 (process pauses, leases, clock skew).
- Retry backoff: AWS "Exponential Backoff and Jitter" (full-jitter).
- See also: `Interview Question/02-concurrency/`,
  `Interview Question/11-messaging-and-event-streaming/`, and
  `Interview Question/15-testing-and-quality/` (loss/idempotency test design).
