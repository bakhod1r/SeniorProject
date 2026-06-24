# Fan-Out / Fan-In Pipeline

> Split one unit of work into N parallel sub-tasks, process them concurrently
> under a **fixed resource ceiling**, then join the results. The whole trick is
> not the fan-out — it's keeping goroutines, memory, and deadlines bounded while
> one slow or failing branch tries to take the rest down with it.

| | |
|---|---|
| **Tier** | Distributed-patterns |
| **Primary domain** | Parallel processing pipeline / Go concurrency |
| **Skills exercised** | Channels, worker pools, `errgroup`, semaphore-bounded concurrency, `context` cancellation, backpressure, partial-failure policy, goroutine-leak avoidance, deadline budgets |
| **Interview sections** | 2 (concurrency), 13 (distributed systems), 17 (performance) |
| **Est. effort** | 2–4 focused days |

---

## 1. Context

You own a request that *internally* explodes. A single `GET /product/{id}`
needs price, inventory, reviews summary, recommendations, and shipping
estimate — five downstream calls. A single batch row needs three enrichment
lookups. The naive code does them sequentially and the p99 is the *sum* of all
branches. The "obvious" fix — `go` each branch — works in the demo and then, at
2,000 RPS where each request fans out to 5 branches, the service is running
10,000+ goroutines, every downstream is being hammered with uncoordinated
concurrency, one slow branch holds the whole join open, and a client timeout
leaks every in-flight goroutine because nobody told them to stop.

This brief is the discipline that turns "spawn goroutines and hope" into a
pipeline you can defend: **fan out, bound the concurrency, propagate
cancellation to every branch, apply an explicit partial-failure policy, and join
without leaking.** You will produce numbers — goroutine counts, memory ceilings,
p99 under injected slow branches — not opinions.

## 2. Goals / Non-goals

**Goals**
- Implement the Go fan-out/fan-in idiom three ways and know when each fits:
  raw channels + worker pool, `golang.org/x/sync/errgroup`, and a
  semaphore-bounded variant.
- Make fan-out **bounded**: a hard ceiling on concurrent sub-tasks regardless of
  work-set size or request rate. Prove unbounded fan-out OOMs.
- Propagate `context` cancellation (deadline, client-disconnect, sibling
  failure) to **every** branch, and prove **zero goroutine leak** on early
  return.
- Implement and contrast three partial-failure policies: **fail-fast**,
  **collect-all-errors**, **best-effort/partial-result**.
- Decide ordering: does fan-in preserve input order, and what does preserving it
  cost in latency and memory.
- Distinguish **in-process** fan-out (goroutines + channels) from **distributed**
  fan-out (across services or queues) — same shape, different failure model.

**Non-goals**
- Building a general workflow/DAG engine. This is one fan-out stage, not Airflow.
- Distributed-transaction semantics (that's 2PC/TCC/Saga). Branches here are
  independent reads or idempotent sub-tasks.
- Streaming windowing/stateful joins (that's the events tier). Fan-in here joins
  one work-unit's sub-results, not an unbounded stream.

## 3. Functional requirements

1. A **fan-out executor** (`pkg/fanout`) takes a slice of `Task` and a per-task
   `func(ctx, Task) (Result, error)`, runs them with a configurable concurrency
   limit, and returns joined results. Concurrency `0` must mean a sane default,
   never "unbounded".
2. Three **partial-failure policies**, selectable per call:
   - `FailFast` — first error cancels all siblings; return that error.
   - `CollectAll` — run every branch; return `[]Result` plus a joined
     `[]error` (use `errors.Join`).
   - `BestEffort` — run every branch; return successful results, drop failures,
     report a failure count/ratio. Caller decides if the partial result is good
     enough.
3. **Ordered** and **unordered** fan-in modes. Ordered returns results aligned to
   input index; unordered streams them as they complete.
4. A **streaming** variant (`FanOutStream`) for work-sets that don't fit in
   memory: read tasks from an `<-chan Task`, bound concurrency, emit to a
   `chan<- Result`, with backpressure (a slow consumer slows the producer).
5. A demo **HTTP service** (`cmd/gateway`) whose `GET /product/{id}` fans out to
   N simulated downstreams (latency + error injectable per branch) and joins.
6. A demo **batch job** (`cmd/enrich`) that fans a huge work-set across a bounded
   worker pool with a memory ceiling.

## 4. Load & data profile

- **Branches per unit:** fan-out width `F` configurable; test `F = 5`
  (request-fan-out) and `F = 1,000` (batch sub-tasks per unit).
- **Work-set size (batch):** generate **≥ 100M** tasks; a single run streams
  **≥ 50M** through the pipeline so the work-set cannot be held in memory.
- **Branch latency:** each simulated branch draws from a distribution, not a
  constant — base 5 ms, with a **p99 of 200 ms** and an injectable tail (one
  branch in 1,000 sleeps 2 s) to create stragglers.
- **Branch failure:** injectable error rate per branch (0%, 1%, 10%) and a
  "branch N always fails" mode for policy tests.
- **Request rate (service):** open-model driver, sweep 100 → 2,000 → 10,000 RPS,
  each request fanning out to `F=5`. Total in-flight sub-tasks = RPS × F × branch
  latency — this is the number that OOMs you.
- **Generator:** `cmd/gen` is deterministic given a seed; the same seed
  reproduces the same straggler/failure pattern.

## 5. Non-functional requirements / SLOs

| Metric | Target |
|--------|--------|
| Service p99 (`F=5`, all branches healthy) | ≈ slowest-branch p99, **not** the sum — fan-out must overlap |
| Service p99 with one injected 2 s straggler branch (BestEffort) | < (per-branch deadline + join overhead); the slow branch is cut at its deadline, not the whole request |
| Max goroutines, batch job, 50M tasks | **Bounded and flat** — a function of the concurrency limit, *not* the work-set size |
| Max RSS, batch job, 50M tasks | **Bounded** — streaming fan-in must hold a working set, not all results |
| Goroutine count after client cancels / deadline fires | Returns to the pre-request baseline within 1 s — **zero leak** |
| Total in-flight sub-tasks at 10k RPS | Capped by a global semaphore; downstream concurrency never exceeds the configured ceiling |
| Throughput under injected failures (10% branch errors) | Holds within 10% of the healthy baseline; failing branches must not stall the pool |

> The point is not a magic latency number — it's that goroutines and memory stay
> **flat** as you scale data and RPS, and that cancellation actually reaches
> every branch.

## 6. Architecture constraints & guidance

- **`errgroup.WithContext` + `SetLimit`** is the spine for fail-fast bounded
  fan-out: the first non-nil error cancels the shared context, `SetLimit(n)`
  bounds goroutines, and `Wait()` joins. Know its semantics cold — `Go` blocks
  when at the limit, which *is* your backpressure.
- For **CollectAll / BestEffort**, do **not** let one error cancel the group;
  capture per-branch results into a pre-sized `[]Result` (index = branch index,
  so no mutex on the slice) and join errors with `errors.Join`.
- **Bound everything.** A `chan struct{}` semaphore (or `golang.org/x/sync/semaphore`
  weighted for variable-cost tasks) caps concurrency. Unbounded `go f()` per task
  is the bug this whole brief exists to kill.
- **Cancellation is non-negotiable.** Every branch takes `ctx` as its first arg
  and must select on `ctx.Done()`. On early return, the deferred `cancel()` and
  draining of channels must let every goroutine exit. A blocked send on an
  unbuffered result channel after the reader has gone is the classic leak.
- **Deadline budget.** Derive each branch's deadline from the request's remaining
  budget (`context.WithTimeout`), not a fixed constant — a request with 50 ms
  left must not start a 200 ms branch.
- **In-process vs distributed.** The in-process executor is the reference. The
  distributed variant fans out over a queue/RPC: now "cancellation" means a
  best-effort cancel message a worker may never see, "backpressure" is queue
  depth, and partial failure includes *lost* sub-tasks, not just errored ones.
  Build in-process first; map each concept to its distributed cousin in the
  findings note.
- Instrument with Prometheus + `expvar`/`runtime`: live goroutine count,
  in-flight sub-tasks (semaphore occupancy), per-branch latency histogram,
  branch error rate, join wait time.

## 7. Data model

```
Task    { ID uint64; Kind string; Payload []byte }
Result  { TaskID uint64; Index int; Value []byte; Err error; Dur time.Duration }

// Ordered join: pre-sized, index = input position, no lock needed on the slice.
results := make([]Result, len(tasks))

// Policy is a value, not a flag soup:
type Policy int
const ( FailFast Policy = iota; CollectAll; BestEffort )

// Executor config — every knob that bounds resources lives here.
Config { Limit int; Policy Policy; Ordered bool; PerTaskTimeout time.Duration }
```

For the streaming variant, `Task` arrives on `<-chan Task` and `Result` leaves
on `chan<- Result`; the channel buffer sizes and the semaphore `Limit` are the
only memory the pipeline holds — never an `[]Result` of the whole work-set.

## 8. Interface contract

```go
// In-memory work-set (results joined and returned).
func FanOut(ctx context.Context, tasks []Task, fn TaskFunc, cfg Config) ([]Result, error)

// Streaming (bounded memory; backpressure via channel + semaphore).
func FanOutStream(ctx context.Context, in <-chan Task, fn TaskFunc, cfg Config) <-chan Result

type TaskFunc func(ctx context.Context, t Task) (Result, error)
```

- `FailFast`: returns on first error with a non-nil `error`; all siblings are
  cancelled; `[]Result` may be partial.
- `CollectAll`: runs all; `error` is `errors.Join(branchErrs...)` (nil if none).
- `BestEffort`: runs all; `error` is nil; failures are absent from `[]Result`
  and surfaced via a metric / the returned count.
- Service: `GET /product/{id}` → joined JSON; `?policy=besteffort` returns
  partial product with a `degraded: ["reviews"]` field when a branch is dropped.
- `GET /metrics` → Prometheus exposition (goroutines, in-flight, per-branch p99,
  drop rate).

## 9. Key technical challenges

- **Unbounded fan-out OOMs.** `for _, t := range tasks { go f(t) }` over 50M
  tasks spawns 50M goroutines (~8 KB stack each → ~400 GB) and floods every
  downstream. The fix — a fixed worker pool / semaphore — is the whole point.
  You must *show* the OOM, then *show* the flat curve after bounding.
- **The leak on early return.** When fail-fast or a client cancel returns early,
  any branch still trying to send on an unbuffered/full result channel blocks
  forever. Correct shutdown means cancelled context + buffered or `select`-on-`ctx`
  sends + draining. Verify with a goroutine snapshot before/after.
- **Ordering costs.** Unordered fan-in is cheap (emit as completed). Ordered
  fan-in either buffers out-of-order results until the head arrives (memory grows
  with the straggler gap) or writes into a pre-indexed slice (must hold the whole
  result set). Quantify the trade-off.
- **The straggler.** Fan-in waits for the slowest branch. Without a per-branch
  deadline and a partial-failure policy, one 2 s branch sets the request's p99.
  A deadline budget + BestEffort caps it at the branch deadline.
- **Backpressure.** In streaming mode, a slow downstream consumer must slow the
  producer, not silently buffer into OOM. `errgroup.SetLimit` blocking on `Go`,
  or a bounded result channel, is the backpressure mechanism — prove the producer
  actually blocks.
- **Distributed fan-out is not the same shape.** Cancellation becomes advisory,
  a sub-task can be lost (not just errored), and "join" needs a correlation key +
  timeout because some branches may never reply. The in-process intuitions that
  hold here quietly break across a network.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it's the control. Then push each axis alone, then
both. **Don't tune what isn't yet correct or leak-free.**

- **Stage 0 · Simple.** Fan out `F=5` branches for one request, join the results,
  return. Correct output, and a goroutine snapshot proving the pool returns to
  baseline after the call. No leak, no fancy policy yet — this is your baseline
  for everything below.
- **Stage 1 · Big data.** Fan out over **50M tasks** in the batch job. Switch to
  **streaming** fan-in: bounded worker pool, fixed memory ceiling, results emitted
  as they complete. Prove goroutine count and RSS are **flat** and a function of
  the concurrency limit, not the work-set size. Show the unbounded version OOMs
  for contrast.
- **Stage 2 · High RPS.** Drive the service at **2,000 → 10,000 RPS**, each
  request fanning to `F=5`. Now the danger is *aggregate* concurrency: RPS × F
  in-flight sub-tasks. Add a **global semaphore** across requests so total
  downstream concurrency is capped regardless of RPS. Tune the limit; show
  backpressure (request admission slows) instead of goroutine explosion. Hold p99.
- **Stage 3 · Both.** Big work-sets at high request rate, with **injected slow and
  failed branches** (1-in-1000 stragglers, 10% branch errors). Hold throughput and
  the deadline budget with bounded resources, and prove the partial-failure policy
  is correct: BestEffort returns degraded-but-useful results, cancellation reaches
  every branch, goroutines stay flat, zero leak. This is the production boss fight
  and the only "staff done" bar.

## 10. Experiments to run (break it / tune it)

Record before/after numbers (goroutines, RSS, p99, throughput, drop rate) for each:

1. **Unbounded vs bounded fan-out.** Run the batch job over 50M tasks with
   `go f(t)` per task vs a semaphore of `N=runtime.NumCPU()*k`. Plot peak
   goroutines and RSS for both. Find the `N` that maximizes throughput before
   downstream saturation; show the unbounded run OOMs (or thrashes).
2. **Cancellation leak test.** Fire a request, cancel the client (or let the
   deadline fire) while branches are mid-flight. Snapshot `runtime.NumGoroutine()`
   before, during, and 1 s after. **Must return to baseline.** Then deliberately
   break it (send on an unbuffered channel without `select`-on-`ctx`) and watch
   the count climb — that's the leak you're guarding against.
3. **Partial-failure policy sweep.** With 10% branch errors and a "branch 3 always
   fails" mode, run the same load under FailFast, CollectAll, BestEffort. Compare
   p99, completed-request rate, and result completeness. State which policy fits
   which SLO and why.
4. **Straggler vs deadline budget.** Inject a 2 s branch on 1-in-1000 requests.
   Measure request p99 with (a) no per-branch deadline, (b) a per-branch deadline
   derived from the remaining request budget + BestEffort. Show the budget caps
   p99 at the branch deadline.
5. **Ordered vs unordered fan-in.** Same work-set, both modes, with a wide
   straggler gap. Measure latency-to-first-result, total memory held, and
   time-to-complete. Quantify what ordering costs.
6. **Aggregate-concurrency cap (high RPS).** At 10k RPS × F=5, run with per-request
   bounding only vs a **global** semaphore. Show that per-request-only lets total
   in-flight sub-tasks and downstream load explode, while the global cap holds it
   flat and applies backpressure to admission.
7. **Backpressure proof (streaming).** Slow the result consumer to half the
   producer rate. Prove the producer **blocks** (bounded buffer / `SetLimit`) and
   memory stays flat — rather than buffering unboundedly into OOM.

## 11. Milestones

1. `pkg/fanout` with `FanOut` (FailFast, errgroup-based) + Stage-0 demo and a
   goroutine-baseline test.
2. Bounded streaming `FanOutStream`; batch job over 50M tasks; flat-goroutine /
   flat-RSS proof + the unbounded-OOM contrast (experiments 1, 7).
3. CollectAll + BestEffort policies; ordered/unordered fan-in; policy sweep
   (experiments 3, 5).
4. Deadline budget + straggler handling; cancellation-leak test wired into CI
   (experiments 2, 4).
5. Service at high RPS with global aggregate-concurrency cap; full Stage-3 run
   with injected stragglers + failures (experiment 6); findings note.

## 12. Acceptance criteria (definition of done)

- [ ] Batch job processes ≥ 50M tasks with **goroutines and RSS flat** and a
      function of the concurrency limit — dashboard screenshot attached.
- [ ] Unbounded fan-out demonstrably OOMs/thrashes; bounded version is shown
      next to it with peak-goroutine numbers.
- [ ] **Zero goroutine leak** on client cancel and deadline expiry, proven by a
      before/after `NumGoroutine()` snapshot; the leak test runs in CI.
- [ ] All three partial-failure policies implemented, with the policy sweep table
      (p99, completion rate, completeness) and a stated recommendation per SLO.
- [ ] Deadline budget caps p99 under an injected 2 s straggler branch; numbers shown.
- [ ] Service holds p99 and a capped total in-flight sub-task count at 10k RPS via
      a global semaphore; backpressure (not goroutine explosion) demonstrated.
- [ ] Ordered-vs-unordered fan-in trade-off quantified (latency + memory).
- [ ] Every number reproducible from a committed command + seed.

## 13. Stretch goals

- **Weighted semaphore** for heterogeneous task cost: a 4 KB task and a 4 MB task
  shouldn't count equally against the concurrency budget.
- **Adaptive concurrency:** drive the limit from observed latency (AIMD) instead
  of a fixed `N`; compare against the static cap (see `resilience/02`).
- **Hedged branches:** for read-only branches, fire a second copy at the p95 and
  take the first to return; measure the tail improvement vs the extra load.
- **Distributed fan-out** over a queue (sub-tasks to workers, fan-in by
  correlation key + timeout); show where in-process intuitions break — lost
  sub-tasks, advisory cancel, queue-depth as backpressure.
- **`sync.Pool`-backed result buffers** to cut allocations in the hot join path;
  measure with `benchstat`.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Resource bounding | Uses a worker pool / `SetLimit` | Bounds **every** axis (per-request *and* aggregate); proves goroutines/RSS flat vs work-set and RPS |
| Cancellation | Passes `ctx` to branches | Proves zero leak on early return + deadline; CI guards it; explains the blocked-send leak |
| Partial failure | Picks one policy | Implements all three; maps each to an SLO; defends the choice with numbers |
| Stragglers / deadlines | Sets a timeout | Derives per-branch deadline from the request budget; caps p99 at the branch deadline, proven |
| Ordering | Knows fan-in can reorder | Quantifies ordered-vs-unordered cost; picks deliberately |
| In-process vs distributed | Knows they differ | Maps cancellation/backpressure/partial-failure to the distributed model; knows what breaks across a network |
| Communication | Clear findings note | Could defend every goroutine/latency curve to a staff panel |

## 15. References

- `golang.org/x/sync/errgroup` — `WithContext`, `SetLimit`; `golang.org/x/sync/semaphore`.
- Go blog: "Pipelines and cancellation", "Go Concurrency Patterns".
- `context` package docs — deadline propagation and cancellation semantics.
- *Concurrency in Go* (Cox-Buday) — fan-out/fan-in, the done channel, leak avoidance.
- Related briefs: `senior/03-durable-job-queue` (bounded worker pool + retries
  in a durable setting) and `labs/08-streaming-backpressure` (backpressure and
  lag when the pipeline crosses a broker).
- See also: `Interview Question/02-concurrency/` (worker pools, channels,
  cancellation, leaks) and `Interview Question/13-distributed-systems/`
  (distributed fan-out, partial failure, deadline budgets).
