# Profiling-Guided Optimization

> Take a deliberately slow Go service, put it under real load, and make it fast
> the *disciplined* way: measure first, find the one bottleneck that actually
> matters, fix it, prove the win with `benchstat` and a re-profile. No guessing.
> The deliverable is not a faster service — it's a chain of evidence.

| | |
|---|---|
| **Tier** | Load-testing (perf craft) |
| **Primary domain** | Profiling / performance engineering |
| **Skills exercised** | `pprof` (CPU/heap/block/mutex), flame graphs, `go tool pprof` (top/list/web/diff), `runtime/trace`, continuous profiling, the profile→hypothesis→change→benchstat→re-profile loop, Amdahl's law, profiling under load |
| **Interview sections** | 17 (performance engineering), 1 (go), 18 (observability) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You've inherited a Go HTTP service — call it `enrich` — that takes a batch of
events, looks each one up against an in-memory index, decorates it, and returns
JSON. It is **correct** and it is **slow**: p99 sits near 400 ms at a modest
1.5k RPS and the box is pegged. The previous owner already "optimized" it twice —
once by adding a `sync.Mutex` around a map (made it worse), once by switching JSON
libraries (no measurable change) — because they tuned by intuition and never
measured. You will not repeat that.

Your job is to drive this service to a stated SLO by **profiling under load**,
naming the dominant cost, changing exactly that, and proving each step moved the
number. Every optimization in your findings note must be backed by a before/after
profile or a `benchstat` table. An optimization with no measurement attached is a
guess, and guesses don't count.

## 2. Goals / Non-goals

**Goals**
- Stand up the slow `enrich` service plus a load harness that holds a defined,
  open-model request rate (so a profile is taken *while the queue is real*).
- Master the **four profiles** — CPU, heap (alloc & inuse), block, mutex — and
  state precisely what each one can and cannot tell you.
- Run the optimize loop end to end: profile → hypothesis → one change →
  `benchstat` (micro) and re-profile (macro) → keep or revert.
- Distinguish the **four bottleneck regimes** — CPU-bound, lock-bound,
  alloc/GC-bound, IO-bound — from profile shape alone, and prove which one you're in.
- Apply **Amdahl's law**: refuse to optimize a 2% line; find the part whose
  fraction of total time makes the fix worth it.
- Use `runtime/trace` to explain scheduler latency, GC pauses, and goroutine
  blocking that the aggregate profiles flatten away.

**Non-goals**
- Rewriting the service in another language. The point is to optimize *this* Go code.
- Chasing a leaderboard number. The target is a *defended* p99/throughput win, not
  the lowest possible nanosecond.
- Premature `unsafe`/assembly micro-tricks. You earn those only after the profile
  says the hot loop is genuinely CPU-bound and algorithmically minimal.

## 3. Functional requirements

1. The service (`cmd/enrich`) exposes `POST /enrich` taking a JSON batch of N
   events; for each event it does a lookup against an in-memory index, enriches it,
   and returns the batch. Behavior is fixed and verified by a golden test — *speed
   must never change correctness*.
2. `net/http/pprof` is mounted (on a **separate** admin port, not the hot path) so
   `/debug/pprof/{profile,heap,block,mutex,trace,goroutine}` are reachable live.
3. `runtime.SetBlockProfileRate` and `runtime.SetMutexProfileFraction` are wired to
   flags (default off — they have overhead) so block/mutex profiles can be enabled
   for a measurement window.
4. A `make profile RPS=… DUR=…` target drives load **and** captures all four
   profiles + a 5 s trace during the steady-state window, into a timestamped dir.
5. A microbenchmark suite (`*_test.go`, `testing.B`) covers each hot function you
   touch, so every change has a `benchstat`-able A/B at the function level.
6. The slow version is preserved (tag/branch) as the **baseline control** so every
   later number is a delta against a fixed reference.

## 4. Load & data profile

- **Index size:** the lookup index holds **50M entries** (≈ the "big data" axis).
  Key distribution is **Zipfian** (s≈1.1) so a few keys are hot — this is what makes
  the heap/inuse profile and cache behavior interesting.
- **Request shape:** batches of 100 events; event keys drawn from the same Zipfian.
  Two request mixes: **fat-batch** (big-data regime, 1k events/batch, low RPS) and
  **thin-batch** (high-RPS regime, 1 event/batch, very high request count).
- **Traffic model:** **open model** (fixed arrival rate, not closed-loop), so the
  service's own slowdown shows up as a growing queue and tail latency — a
  closed-loop "as fast as it drains" test hides exactly the contention you're hunting.
  Beware coordinated omission in the harness (see `load-testing/01`).
- **Generator:** `cmd/gen` builds the 50M-entry index and the request corpus
  deterministically from a seed.
- **The cardinal rule:** **profile under load, never at idle.** An idle profile of
  this service is a lie — at idle there is no lock contention, the GC barely runs,
  and the scheduler never queues. The interesting profile only exists while the
  open-model load is applied.

## 5. Non-functional requirements / SLOs

Targets are stated as **before → after**. "Before" is the baseline control; "after"
is what you must reach *and prove with a re-profile*.

| Metric | Before (baseline) | After (target) |
|--------|-------------------|----------------|
| p99 latency, thin-batch @ 1.5k RPS | ~400 ms | **< 40 ms** |
| Sustained throughput before p99 > 100 ms | ~1.5k RPS | **≥ 15k RPS** |
| Allocations per request (heap alloc profile) | report it | **≥ 5× reduction** on the hot path |
| GC CPU fraction (`runtime/trace` / `GODEBUG=gctrace=1`) | report it | **< 5%** of CPU |
| Mutex wait time (mutex profile, high-RPS run) | report it | **near-zero** after sharding/lock fix |
| Correctness | golden test passes | **identical** golden output, every step |

> The numbers are a forcing function, not the grade. The grade is: for **each**
> target, can you point at the profile that said *this* was the bottleneck, the one
> change you made, and the re-profile that proved it moved — and can you show the
> next bottleneck the win exposed?

## 6. Architecture constraints & guidance

- **Two ports.** Keep `pprof` and the admin/metrics server on a port distinct from
  `/enrich`. Profiling endpoints under the hot path skew the very thing you measure.
- **Block & mutex profiling cost.** They sample on every block/contention event.
  Leave the rates at 0 in production; enable them only for the measurement window,
  and note that enabling them slightly perturbs latency (acknowledge the observer effect).
- **Symbolize correctly.** Build with full symbols; capture profiles from the *same*
  binary you load-test so `list`/`web` map to real source lines. A stripped binary
  gives you useless flame graphs.
- **One change at a time.** Each commit on the optimization branch is a single
  hypothesis. Two changes in one commit means you can't attribute the delta.
- **Instrument** request rate, in-flight requests, p50/p99/p999 (HdrHistogram), and
  the four `runtime` gauges (heap inuse, goroutines, GC pauses) via Prometheus, so
  the macro picture lines up with the micro profile.

## 7. Data model

```
index entry:  { key uint64, payload [48]byte }      // 50M of these, the "big data"
request:      { batch []Event }                       // Event = { key uint64, attrs map[string]string }
profile bundle (per measurement run):
  cpu.pprof  heap.pprof  block.pprof  mutex.pprof  trace.out  hist.json  meta.json
                                                                ^ rate, duration, commit, GOMAXPROCS
```

Each measurement run writes a self-describing bundle: the four profiles, a trace,
the latency histogram, and a `meta.json` recording the input rate, duration, git
commit, `GOMAXPROCS`, `GOGC`/`GOMEMLIMIT`, and the load model. A profile without
its capture conditions is unattributable.

## 8. Interface contract

- `POST /enrich` → `{ "results": [ {enriched event}, … ] }` (golden-verified).
- Admin port: `/debug/pprof/*` (CPU `?seconds=30`, `heap`, `block`, `mutex`,
  `trace?seconds=5`, `goroutine?debug=2`), and `/metrics` (Prometheus).
- Toolchain the reviewer must be able to re-run from your committed commands:
  - `go tool pprof -http=:0 cpu.pprof` (flame graph), `top`, `list <func>`, `web`.
  - `go tool pprof -base old.pprof new.pprof` (the **diff** — proves a delta).
  - `go tool trace trace.out` (scheduler/GC/latency view).
  - `benchstat old.txt new.txt` (statistical A/B at the function level).

## 9. Key technical challenges

- **Reading flame width, not flame height.** Width = total time in a call subtree;
  height = call depth. People optimize a tall-but-thin tower and gain nothing.
  Find the **widest** frame whose work is yours to remove.
- **Knowing which profile to open first.** A latency problem can be CPU, GC, locks,
  or IO — four different profiles. Opening the wrong one wastes the run. The trace
  and the `runtime` gauges tell you which regime you're in *before* you guess.
- **alloc vs inuse.** `alloc_space` (everything ever allocated → GC pressure) and
  `inuse_space` (live now → footprint/leaks) answer different questions. Confusing
  them sends you optimizing the wrong thing.
- **Amdahl's law in practice.** If a function is 2% of CPU, making it free buys you
  2%. The profile's `top` cumulative column is your Amdahl calculator — fix the line
  whose *fraction* makes the speedup worth the complexity.
- **The bottleneck moves.** Fix the lock and the CPU profile reshapes; fix the CPU
  and allocation becomes dominant. You must re-profile after every change, because
  the *next* binding constraint is rarely the one you expected.

## 10. Experiments to run (each tied to a profile)

Record before/after for every one. Name the profile that drove it.

1. **Baseline bundle (control).** Capture all four profiles + trace + histogram on
   the unmodified service under steady load. This is the reference every later
   number diffs against. Read the CPU flame graph and write down the top-3 widest frames.
2. **CPU-bound fix (CPU profile).** Use `top` then `list` on the widest user frame.
   Likely culprit: per-request JSON (re)marshal or a redundant sort/scan in the hot
   loop. Change it; confirm with `go tool pprof -base` that the frame shrank and with
   `benchstat` that the micro-bench improved with significance (p < 0.05).
3. **Alloc/GC-bound fix (heap `alloc_space` + trace).** Find the allocation hot spot
   (per-request map, `[]byte` churn, `fmt.Sprintf`). Cut it with a `sync.Pool`,
   pre-sized buffers, or by hoisting the allocation. Prove: allocs/op down ≥ 5× in
   `benchstat`, GC CPU fraction down in the trace.
4. **Lock-bound fix (mutex + block profiles).** Enable mutex/block profiling under
   the *high-RPS* run. The single mutex around the index will dominate. Shard it
   (striped locks / `sync.Map` / sharded map) or make reads lock-free. Prove the
   mutex-wait frame collapses and throughput climbs.
5. **IO-bound check (trace + block profile).** Add a downstream call (or DB lookup);
   show in the trace that goroutines park on the network, not on CPU — and that
   throwing CPU/locks at it does nothing. The fix here is concurrency/batching, not
   micro-optimization. This teaches you to *not* CPU-optimize an IO wait.
6. **Amdahl discipline (CPU `top` cumulative).** Deliberately optimize a 2% frame to
   completion; show the end-to-end p99 barely moves. Then optimize the widest frame;
   show it moves a lot. Same effort, different fraction — that's the lesson.
7. **Regime shift (big-data vs high-RPS).** Run the *same* service under fat-batch
   (big-data) and thin-batch (high-RPS). Show the dominant profile **changes**:
   heap/CPU dominate under big-data; mutex/block dominate under high-RPS. One service,
   two bottlenecks, two different profiles to open.
8. **End-to-end proof (`-base` diff + histogram).** Stack all kept changes; produce a
   single `go tool pprof -base baseline new` and a before/after latency histogram that
   show the SLO met. Revert any change whose diff doesn't justify its complexity.

## 11. Milestones

1. Slow service + `cmd/gen` (50M index) + open-model load harness + Prometheus board;
   capture the **baseline bundle**.
2. CPU + alloc passes (experiments 2–3); first p99 drop, with `-base` diffs and
   `benchstat` tables committed.
3. Lock pass under high-RPS (experiment 4); mutex-wait collapses, throughput climbs.
4. Regime + Amdahl studies (experiments 5–7); the "which profile, which regime" note.
5. End-to-end proof (experiment 8); findings note with the full evidence chain.

## 12. Acceptance criteria (definition of done)

- [ ] SLO table met: p99 < 40 ms @ 1.5k RPS and ≥ 15k RPS before p99 > 100 ms, each
      **with the profile that drove the fix attached**.
- [ ] For every kept optimization: a `go tool pprof -base` diff (macro) **and** a
      `benchstat` table with statistical significance (micro).
- [ ] Allocs/op reduced ≥ 5× on the hot path; GC CPU fraction < 5% shown in the trace.
- [ ] Mutex-wait near-zero in the high-RPS mutex profile after the lock fix.
- [ ] A written demonstration of Amdahl's law (the 2%-vs-widest-frame experiment).
- [ ] A regime note showing the dominant profile differs between big-data and high-RPS.
- [ ] Golden output **byte-identical** across every step (correctness never traded).
- [ ] Every number reproducible from a committed command + the `meta.json` bundle.

## 13. Stretch goals

- **Continuous profiling.** Wire Pyroscope/Parca (or Go's pprof labels +
  `pprof.Do`) so profiles are tagged by endpoint/tenant and collected continuously;
  find a bottleneck that only shows up in production-shaped traffic, not in the lab.
- **pprof labels for attribution.** Tag goroutines with `runtime/pprof` labels and
  show a CPU profile split by request type — attributing cost to a code path you
  couldn't otherwise isolate.
- **PGO (profile-guided optimization).** Feed a representative CPU profile to the Go
  compiler (`-pgo`) and measure the inlining/devirtualization win on top of your manual fixes.
- **Escape-analysis pass.** Use `-gcflags=-m` to confirm an allocation moved to the
  stack after your fix; cross-check against `load-testing/05`.
- **Flame-graph diff in CI.** Gate a PR on a regression in the CPU profile's hottest
  frame, not just wall-clock — extending the benchstat gate from `load-testing/06`.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Method | Profiles before changing code | **Never guesses** — every change traces to a profile and is proven by a re-profile; reverts changes the diff doesn't justify |
| Profile literacy | Reads a CPU flame graph | Picks the *right* profile per regime; distinguishes alloc vs inuse, block vs mutex, CPU vs IO from shape alone |
| Amdahl's law | Knows not to micro-optimize | Uses cumulative `top` to target the frame whose fraction pays; can predict the ceiling a fix can reach |
| Under-load discipline | Profiles a running service | Knows an idle profile lies; captures during steady-state open-model load and records the conditions |
| Tracing | Can open `go tool trace` | Explains scheduler latency, GC pauses, and goroutine blocking the aggregate profiles hide |
| Proof | Shows a faster number | `benchstat` significance + `-base` diff + histogram; the next exposed bottleneck named |
| Communication | Clear findings note | Could walk a staff panel through the evidence chain and defend why each fix was the right one to make |

## 15. References

- Go blog: "Profiling Go Programs"; `runtime/pprof`, `net/http/pprof`,
  `runtime/trace` package docs.
- `go tool pprof` README (`top`, `list`, `web`, `-base`, `-diff_base`) and the Go
  diagnostics guide.
- Brendan Gregg — *Flame Graphs* (reading width vs height) and the USE method.
- Amdahl's law — and *Systems Performance* (Gregg) on choosing what to optimize.
- Go PGO docs (`-pgo`); Pyroscope / Parca continuous-profiling docs.
- Builds on `load-testing/06-microbenchmarking-and-benchstat` (the micro A/B that
  proves each function-level change) and `load-testing/03-soak-and-leak-hunting`
  (profiling over time to separate a leak from a hot path).
- See also: `Interview Question/17-performance-engineering/` and
  `Interview Question/18-observability/`.
