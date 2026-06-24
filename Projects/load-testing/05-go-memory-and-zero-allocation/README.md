# Go Memory Management & Zero-Allocation

> Take one hot request handler in a high-RPS Go service and drive it toward
> **zero allocations per request** — then learn exactly what the garbage
> collector costs you when you can't. Find where memory comes from, bound the
> GC's CPU and pause budget, and prove the p99 improvement across a fleet.

| | |
|---|---|
| **Tier** | Load-testing (perf craft) |
| **Primary domain** | Go runtime / memory & GC |
| **Skills exercised** | Escape analysis, `sync.Pool`, `GOGC`/`GOMEMLIMIT`, tricolor GC + write barriers + assist, struct packing, off-heap/arenas/`mmap`, `runtime/metrics`, `pprof -alloc_objects`, `gctrace` |
| **Interview sections** | 1 (Go language & runtime), 17 (performance engineering), 2 (concurrency) |
| **Est. effort** | 3–5 focused days |

---

## 1. Context

You own the hottest endpoint in a Go service: a request handler that looks up an
item in an in-memory index and serializes a response. At ~5k RPS per pod it's
fine. At 60k RPS across the fleet, the **p99 latency develops a sawtooth** — a
spike every few hundred milliseconds — and CPU sits 25% higher than the handler's
own work explains. The flame graph blames `runtime.mallocgc`, `runtime.gcBgMarkWorker`,
and `runtime.gcAssistAlloc`. Translation: you are allocating too much, the GC is
running constantly, and request goroutines are being *conscripted* to help it.

Separately, the team that runs the in-memory index has the **opposite** problem.
Their pod holds a 40 GB live working set at a trickle of requests, and every GC
cycle scans the whole heap — a single mark phase stalls the world long enough to
trip the readiness probe, and the pod gets killed during what should be a quiet
period.

Your job is to *characterize* where memory comes from in Go, drive the hot path's
allocations toward **zero**, bound the GC's cost on both a churn-heavy and a
huge-heap workload, and produce numbers — allocs/op, GC pause p99, GC CPU% — that
you can defend. You will produce evidence, not vibes about "GC pressure."

## 2. Goals / Non-goals

**Goals**
- Account for **every allocation** on the hot path and explain why each one
  escapes to the heap (`go build -gcflags=-m`), then eliminate the ones you can.
- Drive a representative hot handler to **≤ 1 alloc/op** (ideally 0) and show the
  GC-CPU and p99 effect of getting there.
- Bound GC behavior on two opposite workloads: a **huge live heap** (pause
  duration, `GOMEMLIMIT` near the ceiling) and a **high-churn** small heap (GC CPU%,
  assist, `sync.Pool` win).
- Explain the tricolor mark-sweep GC, write barriers, and assist *well enough to
  predict* what a given workload will do to pause and CPU before you measure it.
- Use `sync.Pool` correctly — and demonstrate at least one case where it *loses*.

**Non-goals**
- Rewriting the service in another language or going full off-heap as the default.
  Off-heap/arenas are a *measured experiment*, not the recommendation.
- Tuning the allocator's size classes or patching the runtime. You tune behavior
  through `GOGC`, `GOMEMLIMIT`, allocation shape, and pooling — not runtime forks.
- CPU-bound algorithmic optimization (that's the profiling-guided lab). Here the
  enemy is **memory traffic and the GC**, not the math.

## 3. Functional requirements

1. A **hot handler** (`cmd/svc`) serves `GET /lookup?key=…`: find a record in an
   in-memory index and write a JSON (and a binary) response. This is the path you
   drive to zero allocations.
2. An **index loader** (`cmd/loadindex`) builds the in-memory working set from
   generated data, sized by a flag so the same binary runs Stage 0 (MB) and
   Stage 1/3 (tens of GB).
3. The handler exposes **two serialization paths**, switchable by flag: a naive
   one (`encoding/json` into fresh buffers, `fmt`, string concatenation) and an
   **optimized** one (pooled buffers, `[]byte` APIs, no interface boxing,
   `strconv.AppendInt`-style append). State which is active in every result.
4. An **alloc-accounting endpoint** (`GET /debug/allocs`) reads `runtime/metrics`
   and reports live heap, total bytes allocated, GC cycle count, GC CPU fraction,
   and last/p99 pause — so the harness can read GC state without parsing logs.
5. A **knob surface**: `GOGC`, `GOMEMLIMIT`, pool on/off, serialization path, and
   index size are all configurable per run and recorded in the findings.

## 4. Load & data profile

- **Index dataset:** `cmd/gen` produces records keyed by `uint64` id with a
  payload (a struct of ~8 fields + a small `[]byte`). Sizes: **64 MB** (Stage 0),
  **40 GB live** (Stage 1/3). Deterministic given a seed.
- **Record shape matters:** the struct is *deliberately mis-packed* in the
  baseline (a `bool` between two `int64`s, etc.) so field reordering is a real,
  measurable win. Report `unsafe.Sizeof` before/after.
- **Key distribution:** lookups are **Zipfian (s≈1.1)** over the id space, so a
  hot subset dominates — this keeps the *resident* working set small even when the
  *live* heap is huge, which is exactly what stresses the GC's scan cost vs. the
  cache.
- **String/interface bait:** the naive path forces `interface{}` boxing (e.g.
  logging `any`, `fmt.Sprintf`) and `string(b)`/`[]byte(s)` round-trips, so you can
  show the copy and the escape they cause.
- **Traffic model:** **open-model** load (fixed send rate, not closed-loop), so
  GC-induced stalls show up as a *latency* signal — coordinated-omission-correct —
  rather than silently throttling the offered rate.

## 5. Non-functional requirements / SLOs

Measured on the **optimized** path unless stated; baseline is the control.

| Metric | Target |
|--------|--------|
| Hot-handler allocations | **≤ 1 alloc/op** (0 is the goal) on the optimized path, proven by `testing.B` `-benchmem` *and* a steady-state `pprof -alloc_objects` |
| GC CPU fraction at Stage 2 | **< 5%** of CPU (`/gc/cpu:cores` vs. `GOMAXPROCS`); baseline will be much higher — report the delta |
| GC pause p99 (STW) at Stage 1 (40 GB live) | **< 5 ms** with tuned `GOGC`/`GOMEMLIMIT`; report what the *untuned* default does |
| Request p99 inflation attributable to GC | Isolate it: p99(GC on) − p99(`GOGC=off` for a window). Drive the GC-attributable component **< 2 ms** at Stage 2 |
| `GOMEMLIMIT` behavior near the ceiling | At 90% of limit, throughput degrades **gracefully** (GC works harder), it does **not** enter a death spiral or OOM — proven |
| Reproducibility | Every alloc/op and pause number comes with the exact command, `GOGC`/`GOMEMLIMIT`, and commit |

> The point is not to hit "zero" as a trophy — it's to know **which** allocations
> you removed, **what** each one bought in GC CPU and p99, and **when** removing
> the next one stops being worth the code complexity.

## 6. Architecture constraints & guidance

- **Pin the toolchain.** Go's GC, escape analysis, and `GOMEMLIMIT` semantics
  change between releases — record `go version` in every result. Use a recent Go
  (≥ 1.21 so `GOMEMLIMIT` is stable; note that the `arena` experiment needs
  `GOEXPERIMENT=arenas` and may be gated/removed — treat it as a *probe*, not a
  load-bearing dependency).
- **Measure allocations three ways** and reconcile them: `testing.B` with
  `-benchmem` (per-op, microbench), `pprof -alloc_objects`/`-alloc_space` (where
  in the code), and `runtime/metrics` `/gc/heap/allocs:bytes` (whole-process rate
  under load). If they disagree, you're measuring the wrong scope.
- **Turn the GC off to attribute its cost.** Run a short window with `GOGC=off`
  (or a huge `GOMEMLIMIT`) at fixed load; the p99 delta vs. GC-on is the
  GC-attributable tail. Don't ship `GOGC=off` — it's a *measurement tool*.
- **`sync.Pool` is per-P and cleared every GC.** Pool *buffers/large transient
  objects*, never things with a finalizer-like lifecycle; always reset before
  `Put`; never retain a pointer into a pooled buffer after `Put`. Show the race
  detector / a deliberate use-after-Put bug as a cautionary result.
- **Profiling has overhead.** `-alloc_*` profiling samples; `gctrace` is cheap;
  `runtime/trace` is heavy. Use the cheapest tool that answers the question and
  state which was on during each measured run.

## 7. Data model & hot-path shape

```
record (baseline, mis-packed):           record (packed):
  type Rec struct {                         type Rec struct {
    A int64                                   A, B, C int64
    Hot bool         // padding hole          Payload []byte   // 24B header
    B   int64                                 Hot     bool     // tail, 1B
    Active bool      // padding hole          Active  bool
    C   int64                               }                  // 8B-aligned, smaller
    Payload []byte
  }                                        // report unsafe.Sizeof both
in-memory index:
  map[uint64]*Rec   (Stage 1/3: tens of GB live — this is what the GC must scan)
hot path (optimized):
  buf := bufPool.Get().(*bytes.Buffer); buf.Reset()
  appendJSON(buf.Bytes()[:0], rec)        // []byte API, no interface boxing
  w.Write(buf.Bytes()); bufPool.Put(buf)  // reset-before-Put, no retained alias
```
The map-of-pointers index is deliberate: pointer-heavy heaps cost the GC more to
*scan* than flat `[]Rec` or off-heap layouts. Comparing them is an experiment (§10).

## 8. Interface contract

- `GET /lookup?key=N&fmt=json|bin` → the record; the path under test.
- `GET /debug/allocs` → `{ live_heap, total_alloc, gc_cycles, gc_cpu_fraction, pause_p99_ms, next_gc }` from `runtime/metrics`.
- `GET /debug/pprof/{heap,allocs,...}` → standard `net/http/pprof`.
- `GET /metrics` → Prometheus: request p50/p99/p999, GC CPU fraction, pause histogram, live heap, allocs/sec.
- Run knobs via env/flags: `GOGC`, `GOMEMLIMIT`, `-pool=on|off`, `-path=naive|opt`, `-index-size`, `-seed`.

## 9. Key technical challenges

- **Reading escape analysis honestly.** `-gcflags=-m` is noisy and lies by
  omission (inlining changes everything). You must tie each "escapes to heap" line
  to an actual allocation in the profile — not just trust the compiler's chatter.
- **Pooling that helps vs. pooling that hurts.** `sync.Pool` wins on
  high-churn transient buffers and *loses* on small/cheap objects (its own
  bookkeeping + the GC-clears-it-each-cycle cost exceed the saved alloc). Find
  both regimes.
- **The GC death spiral.** Set `GOMEMLIMIT` too tight for the live set and the GC
  runs back-to-back trying to stay under the limit, burning ~all CPU and starving
  request work — throughput collapses without an OOM. Reproduce it on purpose,
  then show the limit that degrades gracefully instead.
- **Pointer-heavy heaps and scan cost.** A 40 GB heap of `map[uint64]*Rec` makes
  the *mark* phase expensive (every pointer is a scan edge); the same data as a
  flat slice or off-heap blob marks far faster. The win isn't fewer allocs — it's
  less for the GC to *trace*.
- **Attributing the tail.** Some of your p99 is GC pause, some is assist (request
  goroutines doing mark work), some is unrelated. Separating them needs `gctrace`
  + `runtime/trace`, not guesswork.

## Stages (0 simple → 1 big data → 2 high RPS → 3 both)

Build Stage 0 correct first — it's the control every later number is measured
against. Then push each axis alone, then both. The two axes fail differently:
big-heap stresses **GC pause/scan**, high-RPS stresses **allocation churn/assist**.

| Stage | Live heap | Rate / concurrency | Bottleneck this stage exposes | Pass criterion |
|-------|-----------|--------------------|-------------------------------|----------------|
| **0 · Simple** | 64 MB | ~500 RPS, 8 conns | Baseline correctness: what the handler *actually* allocs/op and how often the GC runs at rest | Optimized path proven **≤ 1 alloc/op** (`-benchmem`); GC runs predictably; baseline alloc/op recorded as the control |
| **1 · Big data** | **40 GB live** | ~500 RPS (low) | **GC pause & scan cost.** A whole-heap mark stalls the world; default `GOGC` over-collects a huge heap; `GOMEMLIMIT` must cap RSS | Tuned **GC pause p99 < 5 ms**; `GOMEMLIMIT` holds RSS without a death spiral; report untuned-default pause for contrast |
| **2 · High RPS** | 64 MB (small) | **60k+ RPS**, 512 conns | **Allocation churn → GC CPU% and p99 sawtooth.** assist conscription; the `sync.Pool` win is largest here | **GC CPU < 5%**, GC-attributable p99 **< 2 ms**; quantified `sync.Pool` win (allocs/op, GC CPU, p99 before/after) |
| **3 · Both** | **40 GB live** | **60k+ RPS** | **Worst case.** Huge heap *and* high churn: long marks overlap heavy assist; hot Zipfian keys keep churn high while the cold tail bloats scan cost | Full SLOs hold simultaneously: p99 under a **stated SLO (e.g. < 25 ms)** with GC pause p99 < 5 ms and GC CPU < 8% — defended with `gctrace`+trace evidence |

> Stage 1 and Stage 2 can be passed independently and *still* fail Stage 3,
> because long marks (heap) and heavy assist (churn) compound: a request that
> hits an assist *during* a long mark eats both. Stage 3 is the production boss.

## 10. Experiments to run (break it / tune it)

Record before/after allocs/op, GC CPU%, pause p99, and request p99 for each:

1. **Escape-analysis sweep.** `go build -gcflags='-m -m'` the hot path; for the
   top 5 escaping allocations, fix each (avoid pointer-return, `[]byte` API, drop
   `interface{}`) and record the alloc/op drop per fix. Some won't move the
   needle — note which.
2. **Interface boxing & string↔[]byte.** Replace `fmt.Sprintf`/`any` logging and
   `string(b)`/`[]byte(s)` round-trips with `[]byte`/`strconv.Append*` paths.
   Measure allocs/op and bytes/op.
3. **`sync.Pool` on/off, both regimes.** Pool the response buffer (big transient)
   vs. pool a tiny struct (cheap). Show the buffer pool wins and the tiny pool
   *loses* — with numbers.
4. **Pool footguns.** Add a deliberate use-after-`Put` and a missing-`Reset`;
   show the corruption / data leak and the race detector output. Then fix.
5. **`GOGC` sweep.** `GOGC=50,100,200,400,off` at fixed Stage-2 load. Plot GC
   CPU% vs. live-heap-ceiling vs. p99. Find the knee.
6. **`GOMEMLIMIT` near the ceiling.** Stage 1: set `GOMEMLIMIT` to 110%, 105%,
   101% of the live set. Find where it goes from "GC works harder" to **death
   spiral** (GC CPU → ~100%, throughput → 0). Report the safe margin.
7. **Struct packing.** Reorder fields per §7; report `unsafe.Sizeof` and the
   total-heap / GC-scan-time delta at Stage 1.
8. **Pointer-heavy vs. flat vs. off-heap.** Hold the 40 GB set as
   `map[uint64]*Rec`, as a flat `[]Rec` + index, and off-heap via `mmap`/arena.
   Measure mark time and pause for each — the scan-cost story.
9. **Attribute the GC tail.** At fixed Stage-2 load, run a window with `GOGC=off`;
   p99(on) − p99(off) is the GC-attributable tail. Corroborate with
   `GODEBUG=gctrace=1` pause sum and a `runtime/trace` assist view.
10. **String interning.** Intern the repeated string fields (or use a `[]byte`
    dictionary). Measure live-heap reduction and any lookup-CPU cost it adds.

## 11. Milestones

1. `cmd/svc` + `cmd/gen` + `/debug/allocs` up; Stage 0 baseline allocs/op and a
   Grafana board for p99 / GC CPU / pause / live heap.
2. Escape-analysis pass + optimized path; hit ≤ 1 alloc/op on the microbench
   (experiments 1–2).
3. `sync.Pool` (and its footguns) under Stage-2 load; the churn/CPU/p99 win
   (experiments 3–4).
4. Stage 1 huge-heap run: `GOGC`/`GOMEMLIMIT` tuning, pause p99, the death-spiral
   reproduction and the safe margin (experiments 5–6).
5. Layout + Stage 3: struct packing, pointer-heavy vs. flat vs. off-heap, tail
   attribution; findings note (experiments 7–10).

## 12. Acceptance criteria (definition of done)

- [ ] Optimized hot path proven **≤ 1 alloc/op** by `-benchmem` *and* a
      steady-state `pprof -alloc_objects` (no hidden allocs under load).
- [ ] Stage 2: **GC CPU < 5%** and GC-attributable p99 **< 2 ms**, with the
      `GOGC=off`-window attribution shown.
- [ ] Stage 1: **GC pause p99 < 5 ms** at 40 GB live under a tuned
      `GOGC`/`GOMEMLIMIT`, with the untuned-default pause reported for contrast.
- [ ] `GOMEMLIMIT` **death spiral reproduced on purpose** and the graceful-degrade
      margin stated, with the `gctrace` evidence for both.
- [ ] `sync.Pool` win **and** a documented loss case, both with numbers; plus the
      use-after-`Put` footgun shown and fixed.
- [ ] Stage 3: full SLOs hold simultaneously under a stated request-p99 SLO,
      defended with `gctrace` + `runtime/trace`.
- [ ] Every number reproducible from a committed command + `GOGC`/`GOMEMLIMIT` + commit.

## 13. Stretch goals

- **GC pacer model.** From `gctrace` numbers, predict the next cycle's trigger
  heap and CPU; compare your prediction to the runtime's actual pacing.
- **Generational illusion.** Go's GC isn't generational — show why a high-churn
  short-lived-object workload that a generational GC would love still costs Go,
  and how `sync.Pool` partly fills that gap.
- **Region/arena allocation** under `GOEXPERIMENT=arenas`: bulk-free a
  per-request arena and measure the GC-scan savings vs. the safety cost.
- **`madvise` tuning.** Compare `GODEBUG=madvdontneed` vs. default on RSS return
  to the OS after a load spike subsides.
- **Container reality.** Run with a cgroup memory limit and `GOMEMLIMIT` set from
  it; show the OOM-kill you avoid vs. leaving `GOMEMLIMIT` unset.

## 14. Evaluation rubric

| Dimension | Senior bar | Staff bar |
|-----------|-----------|-----------|
| Allocation accounting | Reduces allocs/op with `-benchmem` | Accounts for *every* remaining alloc, ties each to an escape line, knows which to leave |
| GC cost model | Knows GC uses CPU and pauses | Predicts pause/CPU from heap shape & churn *before* measuring; explains assist & write barriers |
| `sync.Pool` | Uses it to cut allocs | Shows where it loses; avoids the reset/use-after-Put footguns and proves correctness |
| `GOGC`/`GOMEMLIMIT` | Tunes them and sees the effect | Reproduces the death spiral, states the safe margin, recommends settings per SLO |
| Heap layout | Packs structs | Quantifies pointer-scan cost; chooses flat/off-heap with mark-time evidence |
| Tail attribution | Reports p99 | Isolates the GC-attributable component and proves cause with trace |
| Communication | Clear findings note | Could defend every alloc/op and pause curve to a staff panel |

## 15. References

- Go runtime: "A Guide to the Go Garbage Collector" (the `GOGC`/`GOMEMLIMIT` +
  pacer doc), `runtime/metrics` package docs, `GODEBUG=gctrace=1` format.
- Escape analysis: `go build -gcflags='-m -m'`; the compiler's escape-analysis notes.
- `sync.Pool` docs + the "pool is cleared every GC, per-P" semantics.
- *The Go Programming Language* (Donovan & Kernighan) — memory & profiling chapters.
- pprof: `go tool pprof -alloc_objects/-alloc_space`; `net/http/pprof`.
- See also: `Interview Question/01-golang-language-and-runtime/` (runtime, GC,
  escape analysis) and `Interview Question/17-performance-engineering/`
  (allocation reduction, profiling, tail latency).
