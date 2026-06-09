# Async Execution-Shape Anti-Patterns — Professional Level

> **Category:** [Async Anti-Patterns](../README.md) → **Execution Shape** — *code whose async control flow runs differently than it reads.*
> **Covers (collectively):** `await` in a Loop · Promise Chain Hell / Callback Pyramid · Mixing Callbacks and Promises

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Measure First: The Async Tooling Map](#measure-first-the-async-tooling-map)
4. [The Latency Math — Serial vs Parallel vs Bounded](#the-latency-math--serial-vs-parallel-vs-bounded)
5. [`await` in a Loop — When Serialization Is the Bug (and When It Isn't)](#await-in-a-loop--when-serialization-is-the-bug-and-when-it-isnt)
6. [Parallel Isn't Free — The Countervailing Cost of Unbounded `Promise.all`](#parallel-isnt-free--the-countervailing-cost-of-unbounded-promiseall)
7. [Bounded Concurrency — Little's Law and Optimal Pool Size](#bounded-concurrency--littles-law-and-optimal-pool-size)
8. [`Promise.all` vs `allSettled` vs `race` — Semantics and Memory](#promiseall-vs-allsettled-vs-race--semantics-and-memory)
9. [Promise Chain Hell — Microtask Scheduling Cost](#promise-chain-hell--microtask-scheduling-cost)
10. [Mixing Callbacks and Promises — Bridging Cost and Releasing Zalgo](#mixing-callbacks-and-promises--bridging-cost-and-releasing-zalgo)
11. [Streaming vs Buffering — Async Iterators and Backpressure](#streaming-vs-buffering--async-iterators-and-backpressure)
12. [A Combined Worked Example](#a-combined-worked-example)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **what does the *shape* of async control flow cost the runtime** — wall-clock latency, the event loop, the microtask queue, heap-resident promises, and the connection pool — and **how do you measure it** before you "just add `Promise.all`"?

[`junior.md`](junior.md) taught you to see that `for (const x of xs) await f(x)` runs one-at-a-time. [`middle.md`](middle.md) taught you to parallelize it correctly. [`senior.md`](senior.md) taught you to refactor a tangled chain at scale and instrument failures. This file goes one layer down — to the **event loop, the microtask queue, the heap, and the downstream system you are about to overload**.

The professional insight is twofold. First, the latency win from parallelism is *arithmetic* — you can compute it before you write a line, and it is often enormous (N×RTT collapses to ~1×RTT). Second, and this is the part that bites senior engineers: **parallel is not free, and unbounded parallel is a different bug than the one you fixed.** A naive `Promise.all` over 50,000 items doesn't just run fast — it materializes 50,000 in-flight promises, opens as many sockets as the pool allows (and queues the rest), and can knock over the very service you are calling. The fix for "too serial" is not "infinitely parallel." It is **bounded concurrency**, tuned with arithmetic (Little's law), not vibes.

Two disciplines define this level:

1. **Never argue from intuition about async latency or memory.** Every claim below comes with the tool that proves it on *your* workload. Illustrative numbers are labeled as such; your job is to produce the real ones with `clinic.js`, `--prof`, `perf_hooks`, heap snapshots, `asyncio` debug mode, `aiomonitor`.
2. **Parallelism has an optimum, not a maximum.** The naive ladder (serial → `Promise.all` → done) skips the most important rung. The senior move is to find the concurrency level that saturates throughput *without* exhausting memory, sockets, or the downstream — and to prove it with a measured throughput-vs-concurrency curve.

> **The mental model:** an async function is a *schedule*, not a thread. `await` yields the event loop; it does not start work in the background. `Promise.all` doesn't run anything — it *waits for things already running*. Concurrency comes from **how many promises are in flight at once**, which you control with the shape of your code. Get the shape wrong and you either serialize (slow) or flood (fragile).

---

## Prerequisites

- **Required:** Fluent with [`senior.md`](senior.md) — you can refactor a Promise chain and a callback API to `async/await` under production constraints.
- **Required:** A working model of the JS event loop: the **macrotask** queue (timers, I/O callbacks) vs the **microtask** queue (Promise reactions, `queueMicrotask`), and that the microtask queue is **drained to empty** between macrotasks. The analogous Python model: the `asyncio` event loop, coroutines, `Task`s, and `await` points.
- **Required:** You can read a flame graph, an event-loop-delay histogram, and a heap snapshot well enough to tell signal from noise.
- **Helpful:** Familiarity with TCP connection pooling, RTT, and how an HTTP client (`undici`, `aiohttp`, `http.Client`) limits concurrent sockets.
- **Helpful:** concurrency-patterns, connection-pooling, profiling-techniques, memory-leak-detection, rate-limiting-throttling skills for the vocabulary used throughout.

---

## Measure First: The Async Tooling Map

Before any claim about async latency or memory, reach for the right instrument. Async cost is *temporal* — it hides in wall-clock time and event-loop lag, not in CPU samples — so the tools differ from synchronous profiling.

| Concern | Node.js / TypeScript | Python (`asyncio`) | Go (contrast) |
|---|---|---|---|
| **Wall-clock latency** | `perf_hooks` (`performance.now`, `PerformanceObserver`), `console.time` | `time.perf_counter`, `loop.time()` | `time.Since`, `testing.B` |
| **Event-loop lag** | `perf_hooks.monitorEventLoopDelay()`, `clinic doctor` | `loop.slow_callback_duration`, debug mode warnings | (no shared loop; goroutines) |
| **Async call tree / blocking** | `clinic flame`, `clinic bubbleprof`, `--prof` + `--prof-process` | `py-spy` (native stacks), `yappi` (async-aware) | `pprof`, `go tool trace` |
| **In-flight tasks / hung awaits** | `async_hooks`, `why-is-node-running` | `aiomonitor` (live task list), `asyncio.all_tasks()` | `go tool trace`, goroutine dump |
| **Heap / resident promises** | `--heapsnapshot-signal`, Chrome DevTools heap snapshot, `process.memoryUsage()` | `tracemalloc`, `objgraph`, `memray` | `pprof -alloc_space` |
| **Unhandled rejections / loop stalls** | `process.on('unhandledRejection')`, `--trace-warnings` | `loop.set_debug(True)` ("coroutine was never awaited", slow-callback) | `-race`, deadlock detector |
| **Connection-pool saturation** | `undici` pool stats, agent `maxSockets`, socket counts (`ss -s`) | `aiohttp` connector limits, `ss -s` | `db.Stats()`, `ss -s` |

```bash
# Node: full async diagnosis — flame graph + event-loop-delay timeline
npx clinic doctor -- node server.js      # flags event-loop lag, GC, I/O
npx clinic flame  -- node server.js      # where wall-clock time goes
npx clinic bubbleprof -- node server.js  # async-operation latency by type

# Node: CPU profile via V8, then read it
node --prof server.js && node --prof-process isolate-*.v8.log > prof.txt

# Python: turn on asyncio debug — warns on slow callbacks & un-awaited coros
PYTHONASYNCIODEBUG=1 python -X dev app.py
# Live introspection of running tasks (attach a REPL into the loop):
python -m aiomonitor.cli   # or aiomonitor.start_monitor(loop) in code
```

```js
// Node: a 5-line event-loop-delay monitor you can ship to prod.
import { monitorEventLoopDelay } from 'node:perf_hooks';
const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
setInterval(() => {
  // p99 loop delay in ms — if this climbs, something is hogging a turn.
  console.log('loop p99(ms):', (h.percentile(99) / 1e6).toFixed(1));
  h.reset();
}, 1000);
```

> **Discipline:** if you cannot point at the tool that would falsify your latency or memory claim, you are guessing. Serial-vs-parallel is the one async decision you can also *predict* with arithmetic — but you still verify the prediction with `perf_hooks`.

---

## The Latency Math — Serial vs Parallel vs Bounded

This is the one place in performance work where the back-of-envelope number is reliable enough to act on *before* measuring. For N independent I/O operations each taking latency `L` (round-trip time, RTT):

| Shape | Wall-clock time | In-flight at once | Peak memory |
|---|---|---|---|
| **Serial** (`await` in loop) | `N × L` | 1 | O(1) — one result at a time |
| **Unbounded parallel** (`Promise.all`) | `≈ L` (max, not sum) | N | **O(N)** — all promises + all results resident |
| **Bounded** (concurrency `c`) | `≈ ⌈N / c⌉ × L` | c | O(c) in flight + O(N) results |

The serial case is `sum(latencies)`; the parallel case is `max(latencies)`. That difference is the whole game.

**Worked numbers (illustrative — reproduce with `perf_hooks`):** 200 HTTP calls, each `L = 50 ms`, downstream comfortably handles 20 concurrent.

- **Serial:** `200 × 50 ms = 10,000 ms` (10 s). Correct, simplest, far too slow.
- **Unbounded `Promise.all`:** `≈ 50 ms` *if the downstream and pool could take 200 at once* — but they can't. You open 200 sockets (or queue 180 behind the pool's `maxSockets`), spike memory with 200 in-flight promises, and likely trip the downstream's rate limiter → retries → *slower than serial and now flaky*.
- **Bounded at c = 20:** `⌈200 / 20⌉ × 50 ms = 10 × 50 = 500 ms`. **20× faster than serial**, 20 sockets, predictable memory, downstream stays healthy. This is almost always the right answer.

```mermaid
gantt
    title Serial vs Parallel vs Bounded (N=8 tasks, L=50ms, bound c=4) — illustrative
    dateFormat  X
    axisFormat %Lms
    section Serial (sum = 8x50 = 400ms)
    t1 :0, 50
    t2 :50, 100
    t3 :100, 150
    t4 :150, 200
    t5 :200, 250
    t6 :250, 300
    t7 :300, 350
    t8 :350, 400
    section Unbounded (max = 50ms, 8 sockets)
    t1..t8 all at once :0, 50
    section Bounded c=4 (2 waves = 100ms, 4 sockets)
    wave1 t1-t4 :0, 50
    wave2 t5-t8 :50, 100
```

> **The takeaway, in one line:** *serial sums the latencies; parallel takes the max; bounded takes the max of each wave. The job is to pick the smallest concurrency that hits your throughput target — not the largest your machine will tolerate.*

---

## `await` in a Loop — When Serialization Is the Bug (and When It Isn't)

```js
// ANTI-PATTERN: N independent fetches serialized — wall-clock = sum(L).
async function loadAll(ids) {
  const out = [];
  for (const id of ids) {
    out.push(await fetchUser(id)); // each await blocks the next iteration
  }
  return out;
}
```

Each `await` suspends the function until that one promise settles before the loop even *creates* the next one. The requests are independent, so this throws away all the available concurrency. The fix depends on N and on whether the operations are independent:

```js
// FIX 1 — small, trusted N, independent ops: fan out, then await the set.
async function loadAll(ids) {
  return Promise.all(ids.map(fetchUser)); // all in flight; wall-clock ≈ max(L)
}
```

But `await` in a loop is **not always wrong**. It is correct — and serial is the *point* — when:

- **Each iteration depends on the previous** (paginated API where the next cursor comes from this page's response). You cannot parallelize a data dependency.
- **You are deliberately rate-limiting** to one-at-a-time to be gentle to a fragile downstream.
- **Order-sensitive side effects** must happen in sequence (sequential writes to a ledger).

For these, `for await...of` over an async iterator (see the streaming section) is the *idiomatic* serial shape and is not an anti-pattern. The anti-pattern is serializing **independent** work.

```python
# Python equivalents.
# ANTI-PATTERN — serial:
results = []
for id_ in ids:
    results.append(await fetch_user(id_))   # sum(L)

# FIX — gather fans out all coroutines concurrently (≈ max(L)):
results = await asyncio.gather(*(fetch_user(i) for i in ids))
```

```go
// Go contrast — goroutines + WaitGroup; errgroup gives bounded + first-error.
func loadAll(ids []int) ([]User, error) {
    g, ctx := errgroup.WithContext(context.Background())
    g.SetLimit(20) // bounded concurrency, built in — no separate library
    out := make([]User, len(ids))
    for i, id := range ids {
        i, id := i, id
        g.Go(func() error {
            u, err := fetchUser(ctx, id)
            out[i] = u
            return err
        })
    }
    return out, g.Wait()
}
```

Go makes the *contrast* sharp: concurrency is goroutines (cheap, scheduled across OS threads), and `errgroup.SetLimit` makes **bounded** the one-liner default — the thing JS/Python make you reach for a library or semaphore to get.

> **Diagnose it:** `clinic bubbleprof` shows a staircase of sequential I/O where you expected a flat parallel block; `perf_hooks` timing the loop reveals `≈ N × L`. In Python, `yappi` in wall-clock mode shows the coroutine spending its time waiting serially.

---

## Parallel Isn't Free — The Countervailing Cost of Unbounded `Promise.all`

This is the rung senior engineers skip. Having learned "use `Promise.all`," they apply it to an unbounded N and create a *worse* bug than the serial loop they replaced.

```js
// ANTI-PATTERN: unbounded fan-out over a huge, externally-controlled N.
async function importAll(records) {            // records.length = 50,000
  return Promise.all(records.map(saveToDb));   // 50k promises, 50k queries at once
}
```

What this actually does, and how each cost shows up in tooling:

1. **Memory — O(N) resident.** `Promise.all` holds every promise *and*, on settle, an array of every result. 50,000 in-flight promises plus their closures, plus 50,000 result objects, are all live at once. A heap snapshot (`--heapsnapshot-signal=SIGUSR2`) shows the retained set; `process.memoryUsage().heapUsed` spikes. With large result payloads this is an OOM waiting to happen.

2. **Connection-pool / socket exhaustion.** Your HTTP client or DB driver caps concurrent connections (`undici` pool, `pg` pool, `aiohttp` connector). The first `c` requests grab connections; the other `N − c` **queue inside the pool**, holding promises and memory while making *zero* progress. You didn't get N-way parallelism — you got `c`-way parallelism plus a giant in-memory backlog. Worse, if the pool *isn't* capped, you exhaust ephemeral ports / file descriptors and start getting `EMFILE` / `ECONNRESET`.

3. **Downstream overload.** 50,000 simultaneous queries can saturate the database's own connection limit, blow its working set out of cache, or trip a rate limiter that responds `429` → your retry logic fires → you've *amplified* load. You DDoS your own backend.

4. **Head-of-line and tail-latency issues.** `Promise.all` rejects on the **first** rejection but does **not** cancel the rest — the other 49,999 keep running, wasting work, and you've already entered the `.catch`. And p99 latency is now governed by the single slowest of 50,000 calls (max of N samples drifts to the tail), so one slow shard makes the *whole* batch slow.

```python
# Python — the same trap. gather() with 50k coroutines schedules 50k Tasks;
# the connector limit (default 100 in aiohttp) silently queues the rest,
# and asyncio debug mode warns about the pile-up of pending tasks.
results = await asyncio.gather(*(save(r) for r in records))  # 50k Tasks resident
```

> **Diagnose it:** heap snapshot before/after shows O(N) retained promises/results; `ss -s` (or pool stats) shows sockets pinned at the cap with a queue behind them; the downstream's own metrics show a saturation cliff; `clinic doctor` flags the event-loop delay spike from scheduling N microtasks at once. **The serial loop was O(1) memory and gentle; unbounded parallel is O(N) memory and hostile. Neither is the answer — bounded is.**

---

## Bounded Concurrency — Little's Law and Optimal Pool Size

The right shape caps in-flight work at `c` and refills as each completes. The question is *what is `c`?* — and there's an arithmetic answer.

**Little's law:** in a stable system, `L = λ × W`, where `L` = average number of in-flight requests, `λ` = throughput (requests/sec), `W` = average latency (sec). Rearranged for *the concurrency you need to hit a target throughput*:

```
required concurrency  c  ≈  target_throughput (req/s)  ×  per-request latency (s)
```

**Worked example:** the downstream can sustain `λ = 400 req/s` and each call takes `W = 50 ms = 0.05 s`. Then `c ≈ 400 × 0.05 = 20`. Running more than ~20 in flight doesn't increase throughput (the downstream is the bottleneck) — it just grows queue depth and latency. Running fewer leaves throughput on the table. **20 is the optimum**, and you can compute it before writing code, then confirm with a throughput-vs-concurrency sweep.

```js
// Bounded fan-out with p-limit (or a hand-rolled semaphore). c = 20.
import pLimit from 'p-limit';
const limit = pLimit(20);                       // at most 20 in flight
async function importAll(records) {
  return Promise.all(records.map(r => limit(() => saveToDb(r))));
  // Promise.all over the *wrapped* tasks: still collects all results,
  // but only 20 run concurrently; the rest are scheduled as slots free up.
}
```

```python
# Python — a Semaphore is the idiomatic bound (no extra dependency).
sem = asyncio.Semaphore(20)
async def guarded(r):
    async with sem:                 # acquire a slot; release on exit
        return await save(r)
results = await asyncio.gather(*(guarded(r) for r in records))
```

A subtlety: even bounded `gather`/`Promise.all` still **buffers all N results** in memory. If results are large or N is unbounded (a stream), bound *and* stream — process each result as it lands instead of collecting (see the streaming section).

**Finding `c` empirically** when you can't compute it: sweep concurrency and watch the curve.

```
concurrency   throughput(req/s)   p99 latency(ms)
   1                 18                 55
   5                 88                 57
  10                170                 60
  20                330                 62     ← knee: throughput plateaus
  40                340                118     ← past knee: latency climbs, no gain
  80                335                240     ← saturated: pure queueing
```

The **knee** (here ~20) is your optimum: the largest concurrency before latency rises without throughput rising. Beyond it you are only adding queue. *This table is illustrative — generate yours with a load test plus `perf_hooks`/pool stats.*

> **Rule:** size the bound to `throughput × latency` (Little's law), validate with a concurrency sweep, and pick the knee. The pool, the downstream, or your memory budget — whichever is smallest — sets the ceiling. See connection-pooling and rate-limiting-throttling.

---

## `Promise.all` vs `allSettled` vs `race` — Semantics and Memory

Choosing the wrong combinator is an execution-shape bug with concrete runtime consequences.

| Combinator | Settles when | On rejection | Cancels losers? | Memory shape |
|---|---|---|---|---|
| `Promise.all` | all fulfill, or one rejects | rejects immediately with first error | **No** — others keep running | holds all promises; result array O(N) |
| `Promise.allSettled` | all settle (fulfill *or* reject) | never rejects; per-item status | No | holds all; result array of `{status,value/reason}` O(N) |
| `Promise.race` | first settles (either way) | rejects if the first to settle rejects | **No** — losers keep running, results discarded | holds all; one result, but **all N stay resident until GC** |
| `Promise.any` | first fulfillment | rejects only if *all* reject (`AggregateError`) | No | holds all; one result |

Three professional traps:

1. **`Promise.all` for a best-effort batch.** If you want "do all 200, tell me which failed," `all` is wrong — the first failure abandons the array (you lose the successes' results and the failures' reasons). Use `allSettled` and inspect statuses. The cost: `allSettled` keeps *every* outcome resident, so on huge N it's the same O(N) memory concern — bound it.

2. **`race`/`any` leak work, not memory-forever, but resources.** The losers are **not cancelled** — they run to completion (still hitting the DB, still holding sockets) and only then are their results discarded. For a timeout pattern, pair `race` with an `AbortController` so the loser is actually cancelled:

```js
// Timeout that actually cancels the slow request (not just ignores it).
async function withTimeout(fn, ms) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fn(ac.signal);          // fn passes signal to fetch/undici
  } finally {
    clearTimeout(timer);                 // race winner cleans up the loser
  }
}
```

3. **Forgetting that none of them cancel.** JS promises are not cancellable by themselves; `Promise` combinators only change *what you wait for*, never *what runs*. Cancellation is a separate concern (`AbortController` in JS, `task.cancel()` in `asyncio`, `context.Context` in Go).

```python
# Python parity: gather(..., return_exceptions=True) ≈ allSettled.
results = await asyncio.gather(*tasks, return_exceptions=True)  # never raises
# wait(FIRST_COMPLETED) ≈ race, and it RETURNS the pending set so you can cancel:
done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
for t in pending:
    t.cancel()        # asyncio CAN cancel — unlike bare JS promises
```

> **Diagnose it:** an `all` that "loses" failures shows up as missing error telemetry on a partial batch; uncancelled `race` losers show up as continued downstream traffic *after* the caller already returned — visible in `aiomonitor`'s live task list or `why-is-node-running` (the process won't exit because losers are still pending).

---

## Promise Chain Hell — Microtask Scheduling Cost

```js
// ANTI-PATTERN: deep .then chain mimics the callback pyramid, plus hidden cost.
function load(id) {
  return fetchUser(id)
    .then(u => fetchOrders(u.id)
      .then(os => enrich(os)
        .then(e => fetchPricing(e)
          .then(p => merge(u, os, e, p)))));   // closures nest, errors easy to drop
}
```

The readability problem is obvious. The professional addition is the **scheduling** cost. **Every `.then`/`await` schedules a microtask.** The microtask queue is drained to empty between macrotasks, so a long per-item chain means many microtask hops per item. On a hot path processing millions of items, those hops add up — and more importantly, a giant burst of microtasks (e.g. resolving a 50,000-wide `Promise.all`) runs the **entire** microtask queue before the event loop can service I/O or timers, **starving the loop** and spiking event-loop delay.

```js
// FLATTENED: async/await — same number of awaits, but linear, debuggable,
// and errors propagate via try/catch instead of nested .catch.
async function load(id) {
  const u  = await fetchUser(id);
  const os = await fetchOrders(u.id);
  const e  = await enrich(os);
  const p  = await fetchPricing(e);
  return merge(u, os, e, p);
}
```

Flattening doesn't remove the microtask hops (each `await` is still one) — but it makes the *number* visible and removes accidental serialization. The real win is spotting independent steps that shouldn't be chained at all:

```js
// If orders and pricing are independent of each other, run them concurrently
// instead of chaining — fewer sequential awaits, lower wall-clock latency.
async function load(id) {
  const u = await fetchUser(id);
  const [os, p] = await Promise.all([fetchOrders(u.id), fetchPricing(u.id)]);
  return merge(u, os, p);
}
```

**The microtask-starvation pitfall in practice:** a tight loop that `await`s nothing real but creates microtasks (e.g. recursive promise resolution, or `await null` per item) can monopolize the loop. If you must do CPU-bound work between awaits, yield deliberately:

```js
// Yield to the macrotask queue so I/O/timers aren't starved during a big batch.
for (let i = 0; i < huge.length; i++) {
  doSyncWork(huge[i]);
  if (i % 1000 === 0) await new Promise(r => setImmediate(r)); // give the loop a turn
}
```

> **Diagnose it:** `monitorEventLoopDelay()` p99 climbing during a batch means the loop is starved; `clinic doctor` labels it "event loop blocked." A flame graph that's all promise-machinery (`PromiseReactionJob`) and no real work points at microtask churn from over-chaining.

---

## Mixing Callbacks and Promises — Bridging Cost and Releasing Zalgo

Two async models in one API is an execution-shape bug because the *caller can't tell when their continuation runs*.

```js
// ANTI-PATTERN: a function that's sometimes sync, sometimes async — "Zalgo".
function getConfig(key, cb) {
  if (cache.has(key)) {
    cb(null, cache.get(key));          // SYNC — cb runs before getConfig returns
  } else {
    db.fetch(key, (err, val) => {       // ASYNC — cb runs on a later tick
      cache.set(key, val);
      cb(err, val);
    });
  }
}
```

This is **releasing Zalgo**: the callback fires *synchronously* on a cache hit and *asynchronously* on a miss. Callers who set up state after the call sometimes see it, sometimes don't — a Heisenbug that depends on cache state. **An async API must be async on every path**, even the fast one. The cure is to make the sync path defer:

```js
// Always-async: even the cache hit defers to the next microtask.
function getConfig(key) {
  if (cache.has(key)) return Promise.resolve(cache.get(key)); // async on a later tick
  return db.fetchAsync(key).then(val => { cache.set(key, val); return val; });
}
```

Returning a Promise *guarantees* the continuation runs on a microtask, never synchronously — Zalgo can't escape.

**Bridging cost and how to bridge correctly.** Hand-wrapping a Node-style callback API in `new Promise` is error-prone (forget to handle the error arg, call `resolve` twice, swallow a throw). Use the built-in bridge:

```js
import { promisify } from 'node:util';
const readFileAsync = promisify(fs.readFile);   // correct error handling, once-only resolve

// And the reverse, when a Promise must satisfy a callback contract:
import { callbackify } from 'node:util';
const getConfigCb = callbackify(getConfig);     // (key, (err, val) => ...)
```

```python
# Python: bridging a thread-blocking callback API into asyncio correctly.
# Wrong: calling blocking code directly in a coroutine blocks the whole loop.
# Right: hop it to a thread executor so the loop keeps running.
val = await loop.run_in_executor(None, blocking_legacy_fetch, key)
# Or wrap a callback-style API with a Future:
def fetch_async(key):
    fut = loop.create_future()
    legacy.fetch(key, lambda err, v: loop.call_soon_threadsafe(
        fut.set_exception(err) if err else fut.set_result, v))
    return fut
```

```go
// Go contrast: there are no callbacks-vs-promises — there are channels and
// goroutines. The "bridge" is wrapping a callback API in a channel once:
func fetchAsync(key string) <-chan result {
    ch := make(chan result, 1)
    legacy.Fetch(key, func(v string, err error) { ch <- result{v, err} })
    return ch
}
// The single concurrency model is why Go simply doesn't have this anti-pattern.
```

> **Diagnose it:** Zalgo shows up as flaky tests that pass or fail depending on cache warmth or timing; `asyncio` debug mode catches "coroutine was never awaited" when a Promise-returning function is called callback-style. The structural fix is **one model per API** — pick promises/async, bridge legacy callbacks once at the boundary with `promisify`/a `Future`, and never expose both.

---

## Streaming vs Buffering — Async Iterators and Backpressure

`Promise.all`/`gather` — even bounded — **buffers all results**. When N is large or unbounded (a paginated API, a Kafka topic, a 10 GB file), buffering is itself the anti-pattern: O(N) memory for data you process one item at a time. The fix is to **stream with backpressure** using async iterators.

```js
// ANTI-PATTERN: buffer the whole result set, then process — O(N) memory.
const all = await Promise.all(pages.map(fetchPage));   // all pages resident
for (const page of all) process(page);

// FIX: async generator + for await...of — O(1) memory, natural backpressure.
async function* paginate(start) {
  let cursor = start;
  do {
    const page = await fetchPage(cursor);  // one page in memory at a time
    yield page;                            // consumer pulls; producer waits
    cursor = page.next;
  } while (cursor);
}
for await (const page of paginate(0)) {
  await process(page);   // backpressure: next fetch waits until this finishes
}
```

`for await...of` is the **legitimate** serial loop — the producer doesn't run ahead of the consumer, so memory stays flat and a slow consumer naturally throttles a fast producer. This is the inverse of unbounded `Promise.all`: trade a little latency (you don't fetch page N+1 while processing page N) for bounded memory and built-in backpressure. For the middle ground — bounded concurrency *over* a stream — combine an async iterator with a `p-limit`/semaphore window.

```python
# Python — async generators + async for, same backpressure property.
async def paginate(start):
    cursor = start
    while cursor:
        page = await fetch_page(cursor)
        yield page
        cursor = page.next

async for page in paginate(0):
    await process(page)        # one page resident; producer awaits the consumer
```

```go
// Go contrast: a bounded channel IS backpressure. Buffer size = window.
ch := make(chan Page, 4)        // producer blocks when 4 pages are unconsumed
go func() { defer close(ch); for p := range fetchAll() { ch <- p } }()
for p := range ch { process(p) } // consumer pulls; full buffer throttles producer
```

> **Diagnose it:** the buffering anti-pattern shows up as memory proportional to dataset size in a heap snapshot (`tracemalloc`/`memray` in Python). Streaming flattens that to a constant. If memory grows with N, ask: *am I collecting when I could be streaming?*

---

## A Combined Worked Example

A real shape: a nightly job that "syncs 40,000 accounts." The first version was serial (too slow), someone "fixed" it with unbounded `Promise.all` (now it OOMs and rate-limits the partner API), and it's stitched together with a hand-wrapped callback API that releases Zalgo on cache hits.

**Before — every execution-shape sin:**

```js
// Serial origin, then "parallelized" to unbounded, mixed callback bridge.
async function sync(accounts) {                 // accounts.length = 40,000
  return Promise.all(accounts.map(async a => {  // 40k in flight → OOM + 429s
    const cfg = await new Promise((res) =>      // Zalgo bridge: sync on cache hit
      getConfig(a.region, (e, v) => res(v)));   // error arg dropped!
    return partnerApi.push(a, cfg)              // first reject abandons 39,999 results
      .then(r => r.ok)
      .then(ok => audit(a, ok));                // chain hell + no .catch
  }));
}
```

Runtime profile of *before*: heap snapshot shows ~40k resident promises + results; `ss -s` shows the socket pool pinned with a huge queue; the partner API returns `429` storms; dropped error arg means failures vanish; Zalgo makes the cache-warm test pass and the cache-cold prod run fail.

**After — shape fixed with arithmetic and the right combinator:**

```js
import pLimit from 'p-limit';
import { promisify } from 'node:util';

const getConfigAsync = promisify(getConfig);     // correct, once-only bridge
// Little's law: partner sustains ~600 req/s, push latency ~50ms → c ≈ 30.
const limit = pLimit(30);

async function sync(accounts) {
  // allSettled: best-effort batch — one failure doesn't abandon the rest.
  const results = await Promise.all(accounts.map(a => limit(async () => {
    try {
      const cfg = await getConfigAsync(a.region);   // always async, error-safe
      const r = await partnerApi.push(a, cfg);      // flat await, not a chain
      await audit(a, r.ok);
      return { id: a.id, ok: r.ok };
    } catch (err) {
      await audit(a, false, err);                   // failure is observed, not lost
      return { id: a.id, ok: false, err };
    }
  })));
  return summarize(results);                        // partial success is reportable
}
```

> **Illustrative combined impact:** bounded at c=30 the job ran in `⌈40000/30⌉ × 50 ms ≈ 67 s` (vs ~33 min serial, vs OOM unbounded), peak heap dropped from ~2.1 GB to ~180 MB (only 30 in flight, not 40k), the partner API stayed under its rate limit (zero `429`s), and the per-item `try/catch` surfaced 14 real failures that the old `Promise.all` had been silently abandoning. **Each lever was measured separately — wall-clock via `perf_hooks`, heap via snapshots, downstream `429` rate via partner metrics — so we knew which change paid off.**

---

## Common Mistakes

Professional-level mistakes — sophisticated, and therefore expensive:

1. **"Fixing" a serial loop with unbounded `Promise.all`.** You traded `O(N×L)` wall-clock for `O(N)` memory and downstream overload. The correct fix is *bounded* concurrency sized by Little's law, almost never unbounded.
2. **Sizing the bound by guesswork.** Picking `c = 100` "to be safe" overshoots the knee, adds queue and latency with no throughput gain. Compute `c ≈ throughput × latency`, then validate with a concurrency sweep and pick the knee.
3. **Using `Promise.all` for a best-effort batch.** First rejection abandons every other result (successes *and* other failures). Use `allSettled`/`gather(return_exceptions=True)` when you need a partial-success report — and remember it still buffers O(N).
4. **Assuming `race`/`any` cancels the losers.** They don't — losers run to completion, holding sockets and doing work whose result is discarded. Pair with `AbortController`/`task.cancel()`/`context` to actually cancel.
5. **Releasing Zalgo.** An API that's sync on the fast path and async otherwise produces timing-dependent Heisenbugs. Make every path async (return a Promise / `await` even the cache hit).
6. **Hand-wrapping callback APIs in `new Promise`.** Easy to drop the error arg or double-resolve. Use `promisify`/`callbackify` (Node) or a single `Future` bridge (Python); never expose both models from one function.
7. **Buffering when you could stream.** `Promise.all` over an unbounded/large N is O(N) memory for data you handle one item at a time. Use `for await...of` over an async generator for O(1) memory and built-in backpressure.
8. **Starving the event loop with microtask bursts.** Resolving a huge `Promise.all` or a long `.then` chain runs the whole microtask queue before I/O gets a turn — event-loop delay spikes. Bound the batch and yield (`setImmediate`) during long synchronous stretches.

---

## Test Yourself

1. You have 500 independent HTTP calls, each ~40 ms, and the downstream sustains ~250 req/s. Compute the wall-clock time for serial, for unbounded `Promise.all`, and for the *correct* bounded concurrency. Show the arithmetic.
2. A teammate replaced `await` in a loop with `Promise.all` over 100,000 DB writes and the service started OOMing and getting `429`s. Name the three distinct runtime costs of unbounded fan-out and the tool that confirms each.
3. Derive the optimal concurrency from Little's law for a downstream that sustains 800 req/s at 25 ms per call. What happens to throughput and latency above that number, and how would you find the knee empirically?
4. When is `await` in a loop **correct** rather than an anti-pattern? Give two concrete cases.
5. Explain "releasing Zalgo." Why is an API that's synchronous on a cache hit and asynchronous on a miss a bug, and what is the fix?
6. You use `Promise.race([slowFetch(), timeout(1000)])` and the timeout wins. Is `slowFetch` cancelled? What is the consequence, and how do you fix it?
7. Why does `for await...of` over an async generator use O(1) memory while `Promise.all` over the same source uses O(N) — and what do you trade for that?

<details>
<summary>Answers</summary>

1. **Serial:** `500 × 40 ms = 20,000 ms` (20 s). **Unbounded:** `≈ 40 ms` *in theory*, but you'd open 500 connections / queue most behind the pool and likely trip the 250 req/s limit → retries → slower and flaky. **Bounded** at `c ≈ 250 req/s × 0.04 s = 10`: `⌈500/10⌉ × 40 ms = 50 × 40 = 2,000 ms` (2 s) — 10× faster than serial, downstream healthy. Bounded wins.
2. (a) **Memory** — O(N) resident promises + result array; confirm with a heap snapshot / `process.memoryUsage`. (b) **Connection-pool/socket exhaustion** — first `c` get connections, the rest queue in the pool holding memory; confirm with pool stats / `ss -s`. (c) **Downstream overload** — N simultaneous queries saturate or rate-limit the backend (`429` → retries → amplification); confirm with the downstream's own metrics. (Also: head-of-line — first rejection abandons the rest, which keep running; tail latency = max of N.)
3. `c ≈ 800 × 0.025 = 20`. Above ~20, throughput plateaus (downstream is the bottleneck) while latency climbs as work just queues; below it you under-utilize. Find the knee empirically with a concurrency sweep (1, 5, 10, 20, 40, 80…) plotting throughput and p99 — the knee is the largest `c` before latency rises without throughput rising.
4. (a) **Data dependency** — each iteration needs the previous result (cursor-based pagination). (b) **Deliberate sequencing/rate-limiting** — order-sensitive side effects (sequential ledger writes) or being gentle to a fragile downstream. In both, `for await...of` is the idiomatic serial shape and is *not* an anti-pattern; serializing *independent* work is.
5. Releasing Zalgo = an API whose callback/continuation fires **synchronously on some paths and asynchronously on others**. It's a bug because callers who set up state after the call see it on the async path but not the sync path — a timing-dependent Heisenbug driven by cache state. Fix: make every path async (return `Promise.resolve(...)` on the cache hit, or defer with `queueMicrotask`), guaranteeing the continuation always runs on a later tick.
6. **No** — bare JS promises aren't cancellable, so `slowFetch` runs to completion, still holding a socket and hitting the downstream, then its result is discarded. Consequence: wasted work and a resource leak (the process may not exit; the downstream still gets the load). Fix: thread an `AbortController` signal into the fetch and `abort()` when the timeout wins, so the loser is actually cancelled.
7. The async generator yields **one item at a time** and the consumer pulls — the producer awaits the consumer (backpressure), so only one item (plus O(1) bookkeeping) is resident. `Promise.all` schedules all N at once and holds every promise and every result. The trade: streaming is slightly higher latency (you don't fetch item N+1 while processing N) and serial, in exchange for bounded, constant memory and natural throttling.

</details>

---

## Cheat Sheet

| Anti-pattern | Runtime cost | Measure with | Fix |
|---|---|---|---|
| **`await` in a loop** (independent work) | Wall-clock = `sum(L)` = `N × L`; throws away concurrency | `perf_hooks` timing, `clinic bubbleprof` (staircase) | `Promise.all`/`gather` for small N; **bounded** (`p-limit`/Semaphore) for large N |
| **Unbounded `Promise.all`** (huge N) | O(N) resident promises+results; socket/pool exhaustion; downstream overload; tail = max(N) | heap snapshot, `ss -s`/pool stats, downstream metrics, `clinic doctor` | Bound at `c ≈ throughput × latency` (Little's law); validate at the knee |
| **Wrong combinator** | `all` abandons results on first reject; `race`/`any` don't cancel losers | missing error telemetry; lingering tasks in `aiomonitor`/`why-is-node-running` | `allSettled` for best-effort; `race` + `AbortController`/`cancel()` for timeouts |
| **Promise chain hell** | Microtask hop per `.then`; giant burst starves the event loop | `monitorEventLoopDelay` p99, flame graph full of `PromiseReactionJob` | Flatten to `async/await`; run independent steps concurrently; `setImmediate`-yield long batches |
| **Mixing callbacks & promises (Zalgo)** | Timing-dependent Heisenbug; dropped error args | flaky cache-dependent tests; `asyncio` debug "never awaited" | One model per API; always-async; bridge once with `promisify`/`Future` |
| **Buffering vs streaming** | O(N) memory for one-at-a-time work | heap snapshot / `tracemalloc` growing with N | `for await...of` async generator → O(1) memory + backpressure |

**Three golden rules:**
- *Serial sums the latencies; parallel takes the max; bounded takes the max per wave. Compute it before you code, verify with `perf_hooks`.*
- *Parallel isn't free — bound it. Size the bound with Little's law (`c ≈ throughput × latency`) and pick the knee of the throughput-vs-concurrency curve, not the machine's maximum.*
- *Pick one async model per API, make every path async (no Zalgo), choose the combinator by its failure/cancellation semantics, and stream instead of buffer when N is large.*

---

## Summary

- Async execution shape is a **latency, memory, and downstream-load** decision, not just a style one — and it's the rare performance choice you can also *predict arithmetically* before measuring.
- **`await` in a loop** serializes independent work: wall-clock = `sum(latencies) = N × L`. Parallelizing collapses that to `≈ max(L)`. But serial is *correct* for data dependencies, deliberate sequencing, and streaming — the bug is serializing *independent* work.
- **Parallel isn't free.** Unbounded `Promise.all`/`gather` over huge N costs O(N) resident promises+results, exhausts the connection pool / sockets, overloads the downstream (`429` → retry amplification), and pushes tail latency to the max of N. It's a *different, worse* bug than the serial loop.
- **Bounded concurrency** is the answer. Size it with Little's law (`c ≈ throughput × latency`), validate with a concurrency sweep, and pick the **knee** — the largest `c` before latency climbs without throughput climbing. Use `p-limit`/Semaphore/`errgroup.SetLimit`.
- **Combinator semantics matter:** `all` rejects on first error and abandons the rest (which keep running); `allSettled` reports partial success but buffers O(N); `race`/`any` don't cancel losers (pair with `AbortController`/`task.cancel()`).
- **Promise chain hell** adds a microtask hop per `.then`; a giant burst starves the event loop. Flatten to `async/await`, run independent steps concurrently, and yield during long synchronous batches.
- **Mixing callbacks and promises** releases Zalgo (sync-or-async depending on path) — a timing Heisenbug. One model per API; always async; bridge legacy callbacks once with `promisify`/a `Future`. Go's single channel model is why it sidesteps this entirely.
- **Stream, don't buffer,** when N is large: `for await...of` over an async generator is O(1) memory with built-in backpressure, the principled inverse of unbounded `Promise.all`.
- **Measure first, always:** `perf_hooks`, `clinic.js`, `--prof`, heap snapshots (Node); `asyncio` debug, `aiomonitor`, `tracemalloc` (Python). Compute the prediction, then confirm it on your workload.
- This completes the level ladder for Execution Shape: [`junior.md`](junior.md) (see it) → [`middle.md`](middle.md) (parallelize correctly) → [`senior.md`](senior.md) (refactor at scale) → **professional.md** (event loop, latency, memory, pools). Next, drill with the practice files.

---

## Further Reading

- **Node.js docs — The event loop, timers, and `process.nextTick`** — the canonical model of macrotasks vs microtasks and how `await` schedules.
- **`perf_hooks` and `monitorEventLoopDelay`** — Node.js Performance Measurement APIs; the in-process way to quantify event-loop lag.
- **clinic.js docs** — `doctor`, `flame`, `bubbleprof`; the standard async-diagnosis toolkit for Node.
- **Python `asyncio` docs — Developing with asyncio (debug mode), `gather`, `wait`, `Semaphore`** — and **aiomonitor** for live task introspection.
- **"Designing Data-Intensive Applications"** — Martin Kleppmann (2017) — backpressure, queueing, and why unbounded fan-out overloads downstreams.
- **Little's Law** — any queueing-theory text; the `L = λW` relation that sizes concurrency and connection pools.
- **"Don't Release Zalgo!"** — Isaac Z. Schlueter — the original write-up of sync/async inconsistency in callback APIs.
- **Go `errgroup` and `context` docs** — bounded concurrency and cancellation as first-class language idioms (the contrast referenced throughout).

---

## Related Topics

- [Async → Error Handling](../01-error-handling/professional.md) — swallowed rejections and floating promises; the failure modes that hide *inside* a bad execution shape.
- [Async → Misuse](../README.md) — `async` without `await` and the Promise-constructor anti-pattern; sibling category at this level (see the chapter index).
- [Concurrency Anti-Patterns](../../03-concurrency/README.md) — the multi-thread sibling chapter; shared themes, different failure modes (real memory races).
- [Over-Engineering → Premature Optimization](../../01-development/03-over-engineering/professional.md) — the discipline of profiling before tuning concurrency; counterweight to "just add `Promise.all`."
- concurrency-patterns · connection-pooling · rate-limiting-throttling · profiling-techniques · memory-leak-detection — the measurement and concurrency toolkits referenced throughout.
- [Backend / Distributed Systems](../../../../../Backend/distributed-systems/README.md) — fan-out, retry, timeout, and backpressure at the network layer.
