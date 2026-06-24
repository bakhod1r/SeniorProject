# Performance Engineering

> Senior-level Go performance engineering for high-throughput, low-latency microservices: methodology, profiling, benchmarking, allocation reduction, tail-latency control, concurrency, I/O, and load testing.

**35 questions** across **10 topics** · Level: senior

## Topics

- [Methodology](#methodology) (4)
- [Go Profiling](#go-profiling) (4)
- [Benchmarking](#benchmarking) (3)
- [Allocation Reduction](#allocation-reduction) (4)
- [Latency Optimization](#latency-optimization) (3)
- [Concurrency for Throughput](#concurrency-for-throughput) (4)
- [I/O & DB Performance](#io-db-performance) (3)
- [Network & Serialization](#network-serialization) (3)
- [Load & Stress Testing](#load-stress-testing) (3)
- [Common Go Performance Bugs](#common-go-performance-bugs) (4)

---

## Methodology

#### 1. A teammate proposes rewriting a JSON parser in assembly to 'make the service faster.' How do you push back methodically?

*Difficulty:* 🟡 medium  ·  *Tags:* `methodology`, `amdahl`, `profiling-strategy`

Start with **measure, don't guess**. The first question is whether parsing is even on the critical path. I'd capture a CPU profile under production-like load and check what fraction of wall time and CPU the parser consumes. **Amdahl's law** caps the win: if parsing is 4% of request latency, an infinite speedup yields at most a 4% improvement, and assembly is a maintenance and portability liability for marginal gains. I'd also separate latency from throughput goals: assembly might cut CPU per op (helping throughput/cost) without touching p99 if the tail is dominated by GC pauses or lock contention. The disciplined order is: define the SLO, profile to find the real bottleneck, estimate the ceiling, then pick the cheapest change that moves the metric we actually care about.

**Key points**
- Profile before optimizing; never optimize on intuition
- Amdahl's law bounds the win by the fraction of time spent in the component
- Distinguish whether the goal is latency, throughput, or cost
- Cheapest effective change wins over heroic micro-optimizations

**Follow-ups**
- How would you estimate the Amdahl ceiling from a CPU profile?
- When IS hand-tuned assembly or SIMD justified in a Go service?

---

#### 2. Explain the USE and RED methods and when you reach for each while debugging a slow service.

*Difficulty:* 🟡 medium  ·  *Tags:* `methodology`, `use`, `red`, `observability`

**USE** (Utilization, Saturation, Errors) is a resource-centric checklist from Brendan Gregg: for every resource (CPU, memory, disk, network, connection pool), ask how busy it is, whether work is queuing, and whether it's erroring. It's how you find a saturated resource — e.g., a DB connection pool at 100% utilization with a growing wait queue. **RED** (Rate, Errors, Duration) is request-centric: for each service, track request rate, error rate, and duration distribution. RED tells you *that* a service is slow and for whom; USE tells you *which resource* is the constraint. In practice I start with RED dashboards to localize the slow endpoint and confirm it's not just elevated error retries, then drop into USE on that service's resources to find the saturated component. They're complementary: RED is the symptom view, USE is the cause view.

**Key points**
- USE = Utilization, Saturation, Errors — per resource (cause view)
- RED = Rate, Errors, Duration — per service/request (symptom view)
- Saturation (queueing) is the early-warning signal USE catches
- Start RED to localize, then USE to find the constrained resource

**Follow-ups**
- What does saturation look like for a Go connection pool specifically?
- How do these map onto the four golden signals?

---

#### 3. Why do averages lie about latency, and how do you reason about p50/p99/p999?

*Difficulty:* 🟢 warm-up  ·  *Tags:* `methodology`, `percentiles`, `tail-latency`

Latency distributions are right-skewed and multi-modal, so the **mean** is dragged by a few slow requests and represents almost no real user. A service can have a 5ms mean while 1% of requests take 500ms. Percentiles describe the *experience*: p50 is the typical request, p99 is what your heaviest or unluckiest 1% see, p999 captures rare but real tail events. Tail percentiles matter more than they look because of **fan-out**: if a page makes 100 backend calls, the chance all 100 beat p99 is 0.99^100 ≈ 37%, so the page's effective latency is governed by p999-class events. Also beware: you cannot average percentiles across instances — p99 of p99s is meaningless; you must aggregate the underlying histograms (e.g., HDR/Prometheus buckets) and recompute.

**Key points**
- Means are skewed by the tail and describe no real user
- p99/p999 capture the experience of fan-out and retries
- 100 fan-out calls turn p99 into the effective common case
- Never average percentiles; merge histograms then recompute

**Follow-ups**
- How does coordinated omission corrupt latency measurements?
- Why is a Prometheus histogram preferable to a summary for p99 across pods?

---

#### 4. What is coordinated omission and how does it make a load test report latencies that are too good?

*Difficulty:* 🟠 hard  ·  *Tags:* `methodology`, `load-testing`, `coordinated-omission`

Coordinated omission happens when a load generator waits for the previous request to finish before sending the next one. When the server stalls, the generator *also* stalls and simply doesn't send the requests that would have been slow — it omits exactly the samples that should be worst. The result is a wildly optimistic tail: you see a clean p99 because the queue that built up during the stall was never measured. The fix is **open-model / constant-arrival-rate** load: requests are scheduled on a fixed timeline regardless of server response, and a late response is charged its full *intended* start-to-finish latency (the stall time is added back). Tools like wrk2, k6 (constant-arrival-rate executor), and HdrHistogram's correction address this. Practically: never use a closed-loop generator with fixed virtual users to validate an SLO; use a fixed request-rate generator that models real arrival.

**Key points**
- Closed-loop generators stop sending during stalls, omitting worst samples
- Symptom: suspiciously clean p99 under load that users still complain about
- Fix: open-model constant-arrival-rate scheduling
- Charge late requests their intended latency (wrk2/k6 CARR/HdrHistogram)

**Follow-ups**
- Which k6 executor avoids coordinated omission and why?
- How would you detect coordinated omission in an existing test rig?

---

## Go Profiling

#### 5. Walk through the pprof profile types and what each one is good for.

*Difficulty:* 🟡 medium  ·  *Tags:* `pprof`, `profiling`, `memory`, `contention`

Go ships several pprof profiles via `net/http/pprof` or `runtime/pprof`. **cpu**: sampling profiler (~100Hz) showing where on-CPU time goes — your first stop for compute-bound work. **heap**: a sampling profile of live allocations; `inuse_space`/`inuse_objects` show current retention (memory-leak hunting), `alloc_space`/`alloc_objects` show cumulative allocation (GC-pressure hunting). **allocs** is an alias defaulting to the alloc_space view. **block**: time goroutines spend blocked on synchronization (channels, mutex wait) — must enable via `runtime.SetBlockProfileRate`. **mutex**: contention profile showing where lock holders cause waiting — enable via `runtime.SetMutexProfileFraction`. **goroutine**: a snapshot of every goroutine's stack — invaluable for goroutine leaks and deadlocks. The mental model: CPU/heap for compute and memory; block/mutex for latency caused by waiting; goroutine for leaks and concurrency bugs.

**Key points**
- cpu: on-CPU sampling for compute-bound hotspots
- heap inuse_* for leaks; alloc_* for GC pressure
- block/mutex isolate latency from waiting; must be explicitly enabled
- goroutine dump for leaks and deadlock diagnosis


```go
import _ "net/http/pprof"

func main() {
    runtime.SetBlockProfileRate(1)        // 1 = sample every block event
    runtime.SetMutexProfileFraction(1)    // 1 = sample every contention event
    go func() { _ = http.ListenAndServe("localhost:6060", nil) }()
    // go tool pprof http://localhost:6060/debug/pprof/heap
    // go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
}
```

**Follow-ups**
- Why are block/mutex profiles off by default, and what's the overhead of rate=1?
- How do you diff two heap profiles to find a leak between two timestamps?

---

#### 6. How do you read a flame graph, and what does a wide vs. tall frame tell you?

*Difficulty:* 🟡 medium  ·  *Tags:* `pprof`, `flame-graph`, `profiling`

In a flame graph the x-axis is *proportion of samples*, not time order — frame **width** equals the share of CPU (or allocations) attributed to that call subtree. **Wide** frames are where the cost lives; that's where to optimize. The y-axis is call-stack depth, so **tall** stacks just mean deep call chains and aren't inherently bad. The technique: scan the top edge (leaf frames doing actual work) for wide plateaus, then trace down to understand the call path that drives them. A surprisingly wide `runtime.mallocgc`, `runtime.gcBgMarkWorker`, or `runtime.scanobject` signals GC pressure → pivot to an allocs profile. Wide `runtime.futex`/`sync.(*Mutex).Lock` signals contention → pivot to mutex/block profiles. I prefer the `pprof -http` interactive flame graph and the differential ('top' with `-diff_base`) view to compare before/after a change.

**Key points**
- Width = fraction of cost; that's the optimization target
- Height = stack depth, not a problem by itself
- Read top-edge leaf frames for actual work
- Wide runtime.mallocgc/scanobject ⇒ GC pressure; wide lock frames ⇒ contention

**Follow-ups**
- What's the difference between a flame graph and an icicle/inverted view?
- How do you use a differential flame graph to validate an optimization?

---

#### 7. When does runtime/trace tell you something pprof cannot?

*Difficulty:* 🟠 hard  ·  *Tags:* `runtime-trace`, `profiling`, `scheduling`, `latency`

pprof aggregates samples into 'where time/allocations go'; it has no notion of *time ordering or scheduling*. `runtime/trace` records actual events with timestamps — goroutine create/start/block/unblock, GC start/stop and STW phases, syscalls, processor (P) handoffs, and network/channel waits — so it answers *why a specific request was slow*, not just where aggregate cost is. Use it when latency is dominated by waiting and scheduling: head-of-line blocking, a goroutine stuck waiting on a channel while a P sits idle, GC assist stealing time from request goroutines, or a single goroutine monopolizing a P and starving others. The trace viewer shows per-P timelines and lets you see, for one slow request, the exact stall. You can also add `trace.WithRegion`/`trace.Log` and `runtime/trace` task spans to tie trace events to logical request boundaries. The cost is high data volume, so capture short windows (a few seconds) around the bad behavior.

**Key points**
- Trace is event-ordered with timestamps; pprof is aggregated samples
- Reveals scheduling, GC STW/assist, blocking, P-handoffs per request
- Best for latency caused by waiting and goroutine starvation
- Annotate with regions/tasks; capture short windows (volume is high)


```go
import "runtime/trace"

f, _ := os.Create("trace.out")
trace.Start(f)
defer trace.Stop()
// ... run the slow workload ...
// go tool trace trace.out
```

**Follow-ups**
- What do GC assist events in a trace indicate about your allocation rate?
- How do trace regions/tasks help correlate to a distributed trace span?

---

#### 8. Why deploy continuous profiling (Parca/Pyroscope) when you already have on-demand pprof?

*Difficulty:* 🟡 medium  ·  *Tags:* `continuous-profiling`, `parca`, `pyroscope`, `observability`

On-demand pprof is reactive: you must reproduce the problem *while* attached, which fails for intermittent regressions, incidents that already ended, or 'it got 5% slower after the last release' questions. Continuous profiling samples every instance at low overhead (typically <1–2% CPU) and stores time-stamped profiles, so you can pull a flame graph for any past window and **diff across deploys** — invaluable for catching gradual regressions and attributing CPU/memory cost to specific functions for capacity and FinOps. Parca and Pyroscope (and Go's `runtime/pprof` labels) let you tag profiles by service, version, and request labels, so you can slice 'which endpoint burns CPU' fleet-wide. The trade-off is added infra and storage, but for a high-performance microservice fleet the ability to answer 'what changed between v123 and v124' without reproducing locally is worth it.

**Key points**
- Always-on, low-overhead sampling vs. reactive attach-and-reproduce
- Time-stamped profiles enable deploy-over-deploy diffs
- pprof labels tag by service/version/endpoint for fleet slicing
- Catches intermittent and gradual regressions; aids cost attribution

**Follow-ups**
- How do pprof.Labels propagate and what's their overhead?
- What sampling rate keeps continuous CPU profiling under ~1% overhead?

---

## Benchmarking

#### 9. Write a correct Go benchmark and explain the anatomy: b.N, b.ResetTimer, b.ReportAllocs.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `benchmarking`, `testing`, `benchstat`

A Go benchmark is a `func BenchmarkX(b *testing.B)` that runs the code under test `b.N` times; the framework auto-tunes `b.N` upward until the timing is statistically stable. **b.ResetTimer()** discards setup cost (building inputs) so it isn't amortized into the measurement. **b.ReportAllocs()** adds bytes/op and allocs/op to the output, which for Go is often more actionable than ns/op because allocations drive GC. **b.RunParallel** measures contended throughput. Always benchmark a representative input size and avoid measuring trivial constant-folded work. Run with `-benchmem -count=10` and feed results to `benchstat` so you compare distributions with confidence intervals, not single noisy numbers. Pin CPU frequency / disable turbo if you need reproducibility.

**Key points**
- b.N is auto-tuned; never hardcode iteration counts
- ResetTimer excludes setup; StopTimer/StartTimer bracket per-iter setup
- ReportAllocs surfaces allocs/op — often the key metric in Go
- Run -count=10 and use benchstat for statistical comparison


```go
func BenchmarkEncode(b *testing.B) {
    payload := buildLargePayload() // setup
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        _, _ = json.Marshal(payload)
    }
}
// go test -bench=Encode -benchmem -count=10 | tee new.txt
// benchstat old.txt new.txt
```

**Follow-ups**
- When do you use b.StopTimer/StartTimer instead of ResetTimer?
- Why is allocs/op often a better optimization target than ns/op in Go?

---

#### 10. Your benchmark reports 0.3 ns/op for a function that clearly does real work. What happened and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `benchmarking`, `compiler`, `dead-code-elimination`

The compiler eliminated the work via **dead-code elimination**: since the result is unused and the function is inlinable with no side effects, the call is optimized away, so you're timing an empty loop. The fix is to make the result observable so the optimizer can't prove it's dead. The classic technique is to assign to a package-level sink variable (often via an exported result), or in modern Go use **`b.Loop()`** (Go 1.24+), which is specifically designed to prevent this elision and keeps inputs/results alive across iterations. Avoid passing compile-time constants too, since constant folding can precompute the answer. Verify the fix by checking that ns/op scales with input size and that a heap/CPU profile of the benchmark shows the expected work. Rule of thumb: any sub-nanosecond ns/op is a measurement bug, not a fast function.

**Key points**
- Dead-code elimination removes unused, side-effect-free results
- Sub-ns/op is a red flag, not a real result
- Consume the result via a package-level sink or use b.Loop() (Go 1.24+)
- Avoid constant inputs that enable constant folding


```go
var sink uint64

func BenchmarkHash(b *testing.B) {
    var acc uint64
    for i := 0; i < b.N; i++ {
        acc += hash(inputs[i%len(inputs)])
    }
    sink = acc // observable side effect defeats DCE
}

// Go 1.24+: b.Loop() handles keep-alive automatically
func BenchmarkHash2(b *testing.B) {
    for b.Loop() {
        _ = hash(inputs[0])
    }
}
```

**Follow-ups**
- What other guarantees does b.Loop() give over the for-b.N loop?
- How does function inlining interact with this elision?

---

#### 11. List the microbenchmark pitfalls that make a green benchmark misleading in production.

*Difficulty:* 🟡 medium  ·  *Tags:* `benchmarking`, `microbenchmark`, `pitfalls`

Microbenchmarks isolate code from reality, so several effects flatter them: (1) **Warm caches and small working sets** — the benchmark fits in L1/L2 while production thrashes LLC and TLB, so real latency is far worse. (2) **No GC pressure** — a benchmark allocating in a tight loop may show low ns/op but in production its allocations trigger GC that stalls *other* requests. (3) **No contention** — single-goroutine benchmarks hide lock and false-sharing costs that explode under `RunParallel`. (4) **Branch predictor / data locality** trained on repeated identical inputs that production won't match. (5) **Compiler over-optimization** (DCE/constant folding) as discussed. (6) **Noisy environment** — turbo boost, neighbor processes, thermal throttling; mitigate with `-count`, benchstat, and a quiet pinned machine. The remedy is to also measure with realistic inputs, realistic concurrency (RunParallel), realistic memory footprint, and to validate the microbench win against an end-to-end load test.

**Key points**
- Warm small working sets hide cache/TLB and LLC misses
- GC pressure's cost lands on other requests, not the benchmark itself
- Single-goroutine benches hide contention and false sharing
- Always confirm a microbench win with an end-to-end load test

**Follow-ups**
- How would you make a benchmark exhibit realistic GC pressure?
- Why can RunParallel results differ wildly from serial ones for the same code?

---

## Allocation Reduction

#### 12. Explain Go escape analysis and how you determine whether a value escapes to the heap.

*Difficulty:* 🟡 medium  ·  *Tags:* `escape-analysis`, `allocation`, `gc`

Escape analysis is a compile-time pass that decides whether a value can live on the stack (cheap, reclaimed on return, no GC involvement) or must be **heap-allocated** because its lifetime exceeds the function. Common escape causes: returning a pointer to a local, storing a pointer in something that outlives the call, passing a value to an `interface{}` (boxing), capturing a variable in a closure that escapes, or a slice/map whose size the compiler can't bound. You inspect the decisions with `go build -gcflags='-m'` (add `-m -m` for more detail), which prints lines like `moved to heap: x` and `... escapes to heap`. The senior move is to read these to find unnecessary escapes — e.g., a method taking `io.Writer` forcing a buffer to escape — and refactor to keep hot-path values on the stack. Fewer heap allocations means less GC work and better cache locality, which often matters more than raw CPU.

**Key points**
- Stack allocation is free of GC and cache-friendly; heap isn't
- Escapes: returned pointers, interface boxing, escaping closures, unbounded sizes
- Inspect with go build -gcflags='-m' (use -m -m for detail)
- Removing escapes cuts GC pressure, often the bigger win than CPU


```go
// go build -gcflags='-m' ./...
func bad() *int { x := 42; return &x }   // moved to heap: x
func boxed(v int) { fmt.Println(v) }       // v escapes (interface{})
func good(buf *[64]byte) { /* stays on stack if buf doesn't escape */ }
```

**Follow-ups**
- Why does passing a concrete type to an interface parameter usually allocate?
- How can returning a value (not a pointer) avoid an escape?

---

#### 13. How and when do you use sync.Pool correctly, and what are its sharp edges?

*Difficulty:* 🟠 hard  ·  *Tags:* `sync-pool`, `allocation`, `gc`

`sync.Pool` amortizes allocation of expensive, reusable objects (e.g., large `[]byte` buffers, `bytes.Buffer`, parser state) across goroutines, cutting GC pressure on hot paths. Use it when objects are short-lived, frequently allocated, and reset-able. Sharp edges: (1) **Pooled objects can be collected at any GC**, so a Pool is a cache, not a free list — never rely on retention. (2) You **must reset** state before reuse or you leak data/bugs across requests (a classic info-leak vector). (3) Don't pool objects with pointers to large retained graphs — you can keep memory alive longer than expected. (4) Pooling tiny objects is counterproductive; the Pool's per-P bookkeeping and interface boxing of `Put` can cost more than the allocation saved. (5) Mismatched Get/Put sizing (variable-length buffers) can bloat memory — guard with a max size. Always validate with a `-benchmem` benchmark and a heap profile; if allocs/op doesn't drop, remove it.

**Key points**
- Cache, not a free list — GC may drain it anytime
- Reset state on reuse to avoid cross-request data leaks
- Only worthwhile for sizeable, frequently churned objects
- Guard variable-size buffers against pool-driven memory bloat


```go
var bufPool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func handle(w io.Writer, data []byte) error {
    b := bufPool.Get().(*bytes.Buffer)
    b.Reset()                 // critical: clear prior state
    defer bufPool.Put(b)
    b.Write(data)
    _, err := w.Write(b.Bytes())
    return err
}
```

**Follow-ups**
- Why does sync.Pool keep a per-P shard, and how does that affect Get/Put cost?
- How would you cap pooled buffer growth for variable payload sizes?

---

#### 14. What concrete allocation-reduction techniques do you apply to a hot request path?

*Difficulty:* 🟡 medium  ·  *Tags:* `allocation`, `strings-builder`, `preallocation`

The toolkit, roughly in order of impact: **Preallocate** slices/maps with `make([]T, 0, n)` / `make(map[K]V, n)` when the size is known, to avoid repeated growth/rehash and copying. **Reuse buffers** with `sync.Pool` or by passing a caller-owned scratch buffer. Use **`strings.Builder`** (and its `Grow`) instead of `+=` concatenation, which allocates a new string each step. Avoid the **`[]byte`↔`string` copy**: use `bytes`/`strconv` APIs that take/return the form you already have; in tight spots an unsafe zero-copy conversion (with strict lifetime rules) avoids the copy. Avoid **interface boxing** in hot loops (don't pass concrete numbers to `interface{}`/`fmt`). Prefer value types and indices over pointer-heavy graphs to keep things on the stack and cache-local. Replace `fmt.Sprintf` with `strconv.AppendInt`/append-style builders. Validate every change with `-benchmem` and confirm allocs/op actually dropped.

**Key points**
- Preallocate with known capacity to avoid growth/rehash copies
- strings.Builder + Grow over string concatenation
- Avoid []byte↔string copies and interface boxing in hot loops
- Append-style (strconv.Append*) over fmt.Sprintf; verify allocs/op


```go
// Bad: grows + copies repeatedly
var s string
for _, p := range parts { s += p }

// Good: single backing buffer
var b strings.Builder
b.Grow(estLen)
for _, p := range parts { b.WriteString(p) }
s := b.String()

ids := make([]int64, 0, len(rows)) // preallocate
```

**Follow-ups**
- When is the unsafe zero-copy string/[]byte conversion actually safe?
- Why does map preallocation help even though maps grow automatically?

---

#### 15. How do GOGC and GOMEMLIMIT work, and how do you tune them for a latency-sensitive service?

*Difficulty:* 🟠 hard  ·  *Tags:* `gc`, `gogc`, `gomemlimit`, `tuning`

Go's GC is triggered by heap growth: **GOGC** (default 100) means GC runs when the live heap doubles since the last collection — higher GOGC trades more memory for fewer, less frequent GCs (good for throughput/CPU); lower GOGC trades memory for more frequent GCs. **GOMEMLIMIT** (Go 1.19+) sets a soft total-memory ceiling: the GC becomes more aggressive as you approach it, preventing OOM kills under load spikes — essential in containers with a hard cgroup limit. The recommended pattern for a containerized service is to set GOMEMLIMIT to ~90% of the container limit (leaving headroom for stacks/off-heap) and often raise or even disable GOGC (`GOGC=off`) so GC frequency is governed by the memory limit, not heap-doubling. Caveat: GOMEMLIMIT is *soft* — if live heap genuinely exceeds it, GC will thrash (spin trying to free memory it can't), so it's a guardrail, not a substitute for fixing a real leak. Validate via GC trace (`GODEBUG=gctrace=1`) and p99 under load.

**Key points**
- GOGC=100 ⇒ GC at 2× live heap; higher = fewer GCs, more memory
- GOMEMLIMIT is a soft memory ceiling that makes GC more aggressive
- Container pattern: GOMEMLIMIT≈90% of limit, raise/disable GOGC
- Soft limit can thrash if heap truly exceeds it — fix real leaks


```go
// env: GOMEMLIMIT=1800MiB GOGC=off GODEBUG=gctrace=1
import "runtime/debug"
func init() {
    debug.SetMemoryLimit(1800 << 20) // ~1.8 GiB soft limit
    debug.SetGCPercent(-1)            // disable heap-growth trigger; rely on memlimit
}
```

**Follow-ups**
- Why can GOGC=off be dangerous without GOMEMLIMIT set?
- How do you read gctrace output to confirm GC isn't thrashing?

---

## Latency Optimization

#### 16. Your service has a great p50 but an ugly p99. Enumerate the usual tail-latency causes in a Go service and how you'd confirm each.

*Difficulty:* 🟠 hard  ·  *Tags:* `latency`, `tail-latency`, `p99`, `gc`, `contention`

Tail latency comes from things that hit *some* requests, not all: (1) **GC pauses / assist** — even Go's sub-ms STW, plus GC assist stealing CPU from request goroutines; confirm with `gctrace`, trace viewer, and correlating spikes to GC. (2) **Lock contention** — a hot mutex serializes requests; confirm with the mutex/block profiles. (3) **Head-of-line blocking** — a slow item stuck ahead in a single queue, channel, or HTTP/1.1 connection; confirm via trace and per-stage timing. (4) **Connection-pool saturation** — requests queue waiting for a DB connection; confirm via pool wait metrics (USE). (5) **Noisy neighbor / CPU throttling** — cgroup CPU quota throttling under bursty load; confirm with `nr_throttled`/cpu.stat. (6) **Cold caches** — cache misses, JIT-less but cold code/data paths, or cold DB buffer pool after deploy. (7) **Scheduler latency / GOMAXPROCS mismatch** in containers. The disciplined approach: capture a trace during a slow request and read exactly what it waited on, rather than guessing.

**Key points**
- Tail = per-request hazards: GC, locks, HOL blocking, pool waits
- cgroup CPU throttling and noisy neighbors inflate p99
- Cold caches/buffer pools spike latency right after deploys
- Capture a trace of a slow request to see the actual stall

**Follow-ups**
- How does GC assist specifically hurt request latency vs. STW?
- How do you detect cgroup CPU throttling on a Go pod?

---

#### 17. What is the GOMAXPROCS-in-containers problem and why does it wreck latency?

*Difficulty:* 🟠 hard  ·  *Tags:* `latency`, `gomaxprocs`, `containers`, `cgroups`

By default Go sets `GOMAXPROCS` to the number of OS-visible CPUs (`runtime.NumCPU()`), which reports the *node's* core count — not the container's **CPU quota**. So a pod with a 2-core CPU limit on a 64-core node starts 64 runnable P's. The runtime schedules far more goroutines on-CPU than the cgroup quota allows, the kernel CFS scheduler **throttles** the process at quota exhaustion, and goroutines get parked mid-work for the rest of the scheduling period — causing large, bursty tail-latency spikes and wasted context-switching. The fix is to align GOMAXPROCS with the cgroup CPU quota: use `automaxprocs` (Uber's library) or set GOMAXPROCS explicitly to the ceiling of the quota. Go 1.25+ makes the runtime cgroup-aware and sets this automatically. Confirm by reading `cpu.stat` (`nr_throttled`, `throttled_time`) and checking that latency spikes correlate with throttling windows.

**Key points**
- Default GOMAXPROCS = node cores, ignoring the cgroup CPU quota
- Over-subscription ⇒ CFS throttling ⇒ bursty p99 spikes
- Fix: automaxprocs, explicit GOMAXPROCS, or Go 1.25+ cgroup-awareness
- Confirm via cpu.stat nr_throttled/throttled_time


```
import _ "go.uber.org/automaxprocs" // sets GOMAXPROCS from the cgroup quota at init
// or explicitly:
// runtime.GOMAXPROCS(2) // matches a 2-core limit
```

**Follow-ups**
- Why does throttling produce bursty rather than uniform slowdown?
- How does this interact with GOMEMLIMIT in the same container?

---

#### 18. Beyond tuning GC frequency, what techniques reduce the latency impact of garbage collection?

*Difficulty:* 🟡 medium  ·  *Tags:* `latency`, `gc`, `allocation`

The most durable fix is to **allocate less**, because GC cost scales with allocation rate and live-set size — escape-analysis cleanups, sync.Pool, preallocation, and avoiding pointer-heavy graphs all directly shrink GC work (fewer objects to mark). Reducing the **pointer density** of your live data helps the mark phase scan less. **GOMEMLIMIT** plus a higher/off GOGC lets you trade memory for fewer collections when you have RAM headroom. For predictable workloads you can pre-warm and keep long-lived buffers off-heap-ish (large arenas/slices you own and recycle). **`debug.FreeOSMemory()`** can be triggered during idle windows to return memory without affecting hot paths. Finally, design to keep the request path's working set small and cache-resident so a GC that does fire scans less and evicts less. Always confirm with `gctrace` and a trace that GC assist time on request goroutines actually dropped.

**Key points**
- Allocate less: GC cost scales with allocation rate and live set
- Lower pointer density ⇒ cheaper mark phase
- GOMEMLIMIT + higher GOGC trades RAM for fewer GCs
- Recycle owned buffers; verify reduced GC-assist via trace

**Follow-ups**
- Why does pointer density specifically affect mark-phase cost?
- When is debug.FreeOSMemory() helpful vs. harmful?

---

## Concurrency for Throughput

#### 19. Why prefer a bounded worker pool over spawning a goroutine per task, and how do you size it?

*Difficulty:* 🟡 medium  ·  *Tags:* `concurrency`, `worker-pool`, `backpressure`, `throughput`

Goroutines are cheap (~2KB initial stack) but not free: unbounded spawning causes **goroutine explosion** — memory blows up, the scheduler thrashes, and you lose backpressure, so a downstream slowdown turns into an OOM or a thundering herd on a database. A **bounded pool** caps in-flight work, providing backpressure (the queue fills and you shed or block at the edge) and predictable resource use. Sizing depends on the work profile: for **CPU-bound** work, ~GOMAXPROCS workers (more just adds context-switching). For **I/O-bound** work, size to keep the bottleneck resource saturated — roughly Little's Law: `concurrency ≈ target_throughput × latency`; e.g., to do 1000 rps at 50ms each you need ~50 concurrent workers, but never more than the downstream (DB pool) can absorb. The pattern is a fixed set of workers reading from a buffered channel; the buffer length is your queue depth / backpressure knob.

**Key points**
- Unbounded goroutines lose backpressure → OOM / downstream overload
- Bounded pool gives predictable resources and shed/queue control
- CPU-bound: ~GOMAXPROCS; I/O-bound: Little's Law sizing
- Cap to what the slowest downstream (DB pool) can absorb


```go
func pool(n int, jobs <-chan Job) {
    var wg sync.WaitGroup
    for i := 0; i < n; i++ {
        wg.Add(1)
        go func() { defer wg.Done(); for j := range jobs { process(j) } }()
    }
    wg.Wait()
}
// semaphore variant: sem := make(chan struct{}, n); sem<-struct{}{}; ...; <-sem
```

**Follow-ups**
- How does the channel buffer length act as a backpressure knob?
- How do you apply Little's Law to right-size workers against a DB pool?

---

#### 20. How do batching and pipelining improve throughput, and what's the latency trade-off?

*Difficulty:* 🟡 medium  ·  *Tags:* `concurrency`, `batching`, `pipelining`, `throughput`

**Batching** amortizes per-operation fixed costs (syscalls, network round-trips, lock acquisitions, transaction overhead) over many items — e.g., one `INSERT ... VALUES (...),(...)` of 500 rows instead of 500 round-trips, or one flush of an accumulated write buffer. Throughput rises because the constant per-call overhead is paid once. **Pipelining** overlaps stages so the bottleneck stage stays busy: stage N processes item i while stage N+1 processes item i-1 (Go channels between stages), turning latency into throughput. The trade-off is **added latency from waiting to fill a batch**: you must bound it with a max-batch-size *and* a max-wait timer (flush when either fires), so a slow trickle of requests doesn't sit waiting indefinitely. For latency-sensitive paths, keep batches small and timers tight; for bulk/async paths, prefer larger batches. Always measure: batching can *reduce* p99 by cutting contention, or *raise* it via fill delay, depending on tuning.

**Key points**
- Batching amortizes fixed per-op cost (RTTs, syscalls, txn overhead)
- Pipelining overlaps stages to keep the bottleneck saturated
- Bound batch fill with max-size AND max-wait timer (flush on either)
- Measure: batching can lower or raise p99 depending on fill delay


```go
func batcher(in <-chan Item, flush func([]Item)) {
    buf := make([]Item, 0, 256)
    t := time.NewTicker(5 * time.Millisecond)
    for {
        select {
        case it := <-in:
            buf = append(buf, it)
            if len(buf) >= 256 { flush(buf); buf = buf[:0] }
        case <-t.C:
            if len(buf) > 0 { flush(buf); buf = buf[:0] }
        }
    }
}
```

**Follow-ups**
- How do you pick the max-wait timer relative to your latency SLO?
- Where does pipelining add memory cost via in-flight buffering?

---

#### 21. Walk through reducing lock contention: lock sharding, atomics, and lock-free approaches in Go.

*Difficulty:* 🟠 hard  ·  *Tags:* `concurrency`, `lock-contention`, `atomics`, `sharding`

A single mutex around a hot shared map serializes all goroutines and shows up as a wide frame in the mutex/block profile. Escalation ladder: (1) **Shrink the critical section** — do work outside the lock, hold it only for the mutation. (2) **RWMutex** if reads vastly outnumber writes (but it has its own write-starvation and cache-line costs; don't assume it's faster — benchmark). (3) **Shard the lock** — partition state into N stripes each with its own mutex, keyed by hash of the key, so unrelated keys don't contend; `sync.Map` is a built-in option for append-mostly / disjoint-key workloads. (4) **Atomics** (`sync/atomic`, `atomic.Int64`, `atomic.Pointer[T]`) for simple counters/flags/pointer swaps — no lock at all, just a CAS or atomic add. (5) **Per-P / per-goroutine local state** that you reconcile periodically (e.g., sharded counters summed on read) eliminates contention entirely. Always drive the choice from a contention profile and a `RunParallel` benchmark; lock-free code is subtle and only worth it when the profile proves contention is the bottleneck.

**Key points**
- First shrink the critical section; do work outside the lock
- Shard locks by key hash; sync.Map for disjoint-key workloads
- Atomics for counters/flags/pointer swaps avoid locking entirely
- Per-P local state reconciled on read removes hot-path contention


```go
type ShardedMap struct {
    shards [256]struct {
        mu sync.RWMutex
        m  map[string]int
    }
}
func (s *ShardedMap) shard(k string) *struct{ mu sync.RWMutex; m map[string]int } {
    return &s.shards[fnv32(k)&255]
}
// counter without a lock:
var hits atomic.Int64
hits.Add(1)
```

**Follow-ups**
- When is RWMutex actually slower than a plain Mutex?
- What workloads is sync.Map designed for, and when does it lose to a sharded map?

---

#### 22. What is false sharing, how does it show up in Go, and how do you fix it?

*Difficulty:* 🔴 staff  ·  *Tags:* `concurrency`, `false-sharing`, `cache-lines`, `atomics`

False sharing happens when two goroutines on different CPU cores mutate *different* variables that happen to live on the **same 64-byte cache line**. Even though there's no logical contention, the cache-coherency protocol (MESI) forces the line to ping-pong between cores' caches on every write — invalidations and re-fetches that can slow a hot loop by an order of magnitude. In Go it bites arrays of per-shard counters or per-worker structs packed tightly: e.g., `var counters [N]int64` updated by N goroutines, where several counters share a line. Diagnose by suspicion (great single-thread, poor scaling under RunParallel) plus `perf c2c`/cache-miss counters. Fix by **padding** each hot element to a full cache line (or to its own line) so independently-written values don't co-reside. Go offers no built-in alignment attribute, so you pad structs manually (e.g., embed a `[64]byte` filler, or use `[8]int64` per logical counter). Only pad what the profile shows is hot — padding wastes memory and cache otherwise.

**Key points**
- Distinct variables on one 64-byte line cause coherency ping-pong
- Symptom: poor scaling under RunParallel despite no logical contention
- Common in tightly-packed per-shard/per-worker arrays
- Fix by padding hot elements to a full cache line; pad only proven hotspots


```
// Bad: adjacent counters share cache lines
type Stats struct{ a, b, c int64 }

// Padded: each counter owns a 64-byte line
type PaddedCounter struct {
    v   atomic.Int64
    _   [56]byte // pad to 64 bytes (8 + 56)
}
var counters [N]PaddedCounter
```

**Follow-ups**
- How would you confirm false sharing with perf c2c?
- Why is manual padding fragile across struct-layout changes?

---

## I/O & DB Performance

#### 23. How do you configure database/sql connection pooling in Go for a high-throughput service, and what goes wrong if you don't?

*Difficulty:* 🟡 medium  ·  *Tags:* `database`, `connection-pool`, `io`

`*sql.DB` is a pool, not a connection — you tune it with `SetMaxOpenConns`, `SetMaxIdleConns`, `SetConnMaxLifetime`, and `SetConnMaxIdleTime`. **MaxOpenConns** caps concurrency against the DB; the default is unlimited, which under load opens hundreds of connections and exhausts the database's `max_connections` (Postgres especially), causing the DB to refuse or thrash. Set it to a value the DB can sustain and that matches your worker concurrency — often pooling many app pods behind something like PgBouncer. **MaxIdleConns** should be close to MaxOpenConns to avoid churning connections under steady load (default 2 is too low and causes constant reconnect). **ConnMaxLifetime** (e.g., 5–30 min) rotates connections so load balancers and DB failovers redistribute and stale connections get recycled; pair with **ConnMaxIdleTime** to release excess. Symptoms of misconfiguration: connection-wait latency in your USE metrics, p99 spikes from queueing on `db.Conn`, or DB-side 'too many connections'. Monitor `db.Stats()` (WaitCount, WaitDuration, InUse).

**Key points**
- *sql.DB is a pool; tune MaxOpen/MaxIdle/ConnMaxLifetime/IdleTime
- Unlimited MaxOpenConns exhausts DB max_connections under load
- MaxIdleConns≈MaxOpenConns to avoid reconnect churn (default 2 too low)
- Watch db.Stats() WaitCount/WaitDuration for pool saturation


```
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(50)
db.SetConnMaxLifetime(15 * time.Minute)
db.SetConnMaxIdleTime(5 * time.Minute)
// expose db.Stats().WaitCount / WaitDuration as metrics
```

**Follow-ups**
- How does PgBouncer in transaction mode change your Go pool sizing?
- Why does ConnMaxLifetime matter for DB failover and load rebalancing?

---

#### 24. Diagnose and fix the N+1 query problem in a Go service.

*Difficulty:* 🟢 warm-up  ·  *Tags:* `database`, `n-plus-1`, `batching`

N+1 is running one query to fetch a list of N parent rows, then issuing one additional query per parent to fetch its children — 1 + N round-trips. Each round-trip pays network latency and pool-checkout cost, so even fast queries add up; it's a classic hidden p99 killer that benchmarks miss because local DBs have ~0 latency. Detect it by counting queries per request (query logging, an APM/trace showing a fan of identical SQL, or a test that asserts query count). Fixes: (1) **Batch with `IN`** — collect parent IDs and fetch all children in one `WHERE child.parent_id IN ($1,...)` query, then group in memory. (2) **JOIN** when you want parents and children together (watch for row multiplication/cartesian blowup). (3) **Dataloader pattern** — coalesce per-item lookups within a request window into one batched query (common with GraphQL). The principle: turn N round-trips into 1 or 2. Always assert query counts in integration tests so N+1 can't regress back in.

**Key points**
- 1 + N round-trips; round-trip cost dominates, not query time
- Hidden in local benchmarks (zero network latency)
- Fix via IN-batching, JOINs, or a dataloader/coalescing layer
- Add query-count assertions to integration tests to prevent regressions


```go
// Bad: N+1
for _, u := range users {
    db.Query("SELECT * FROM orders WHERE user_id = $1", u.ID)
}
// Good: one batched query
ids := userIDs(users)
rows, _ := db.Query("SELECT * FROM orders WHERE user_id = ANY($1)", pq.Array(ids))
// then group orders by user_id in memory
```

**Follow-ups**
- When does a JOIN cause row multiplication that makes IN-batching better?
- How does a dataloader batch lookups across concurrent goroutines safely?

---

#### 25. What do prepared statements and caching layers buy you, and what are the caching pitfalls?

*Difficulty:* 🟡 medium  ·  *Tags:* `database`, `prepared-statements`, `caching`, `stampede`

**Prepared statements** let the DB parse and plan a query once and reuse the plan, saving CPU on repeated queries and preventing SQL injection by separating code from data. In Go, `db.Prepare` ties a statement to the pool; with PgBouncer in transaction mode, server-side prepared statements can break, so many teams use the protocol-level prepare in `pgx` or disable statement caching accordingly. **Caching layers** (in-process LRU, Redis) cut read latency and DB load for hot, read-heavy keys — often the single biggest latency win. Pitfalls: (1) **Stale data / invalidation** — the hard problem; choose TTLs, write-through, or explicit invalidation deliberately. (2) **Cache stampede / thundering herd** — when a hot key expires, many requests hit the DB at once; mitigate with single-flight (`golang.org/x/sync/singleflight`), jittered TTLs, or probabilistic early refresh. (3) **Cache penetration** for missing keys — cache negative results. (4) Serialization cost of the cache itself. Measure hit ratio and ensure the cache actually reduces tail latency, not just mean.

**Key points**
- Prepared statements: parse/plan once, reuse; inherent injection safety
- PgBouncer transaction mode can break server-side prepares — use pgx accordingly
- Caches: invalidation, stampede (single-flight/jitter), negative caching
- Track hit ratio and confirm tail (not just mean) latency improves


```go
import "golang.org/x/sync/singleflight"
var g singleflight.Group
func getUser(id string) (*User, error) {
    v, err, _ := g.Do(id, func() (any, error) { return loadFromDB(id) })
    if err != nil { return nil, err }
    return v.(*User), nil
}
```

**Follow-ups**
- How does singleflight prevent a cache stampede mechanically?
- Why do prepared statements interact badly with connection poolers?

---

## Network & Serialization

#### 26. Compare JSON and protobuf for a high-throughput internal microservice. When does serialization actually matter?

*Difficulty:* 🟡 medium  ·  *Tags:* `serialization`, `json`, `protobuf`, `network`

JSON is text: human-readable, schema-flexible, but expensive — it allocates heavily (reflection in `encoding/json`, string parsing, escaping) and produces larger payloads. **Protobuf** is a compact binary, schema-first format: smaller on the wire, far cheaper to (de)serialize, and with generated code it allocates less and avoids reflection. For internal service-to-service traffic at high QPS, protobuf (usually over gRPC/HTTP2) typically cuts CPU and bandwidth meaningfully, and the schema gives you forward/backward compatibility and codegen. *But* serialization only matters if a profile shows it's a real cost — for many services the DB or downstream calls dominate, and JSON is fine. When JSON is required (public APIs), faster codecs (`json-iterator`, `goccy/go-json`, or `encoding/json/v2`) and avoiding re-marshal/re-parse cycles help. The senior answer: choose protobuf for internal hot paths backed by a profile, keep JSON at the public edge for ergonomics, and don't migrate formats on a hunch.

**Key points**
- JSON: reflection-heavy, allocates, larger payloads; flexible/readable
- Protobuf: compact binary, codegen, low-alloc, schema evolution
- Profile first — serialization often isn't the bottleneck
- Internal hot paths → protobuf/gRPC; public edge → JSON (faster codecs if needed)

**Follow-ups**
- How does encoding/json's use of reflection drive allocations?
- When would you reach for flatbuffers/capnproto over protobuf?

---

#### 27. How do HTTP keep-alive, HTTP/2, and connection reuse affect Go client/server performance, and what's the common footgun?

*Difficulty:* 🟠 hard  ·  *Tags:* `network`, `http2`, `keep-alive`, `connection-reuse`

Establishing a TCP+TLS connection costs round-trips and CPU; **keep-alive** reuses connections so you amortize that over many requests — essential for any hot client. **HTTP/2** adds multiplexing: many concurrent streams over one connection, eliminating head-of-line blocking at the HTTP layer and reducing connection count (though HOL blocking can still occur at the TCP layer under loss). The classic Go footgun: using `http.DefaultClient` / `http.DefaultTransport` with default `MaxIdleConnsPerHost = 2`, or — worse — **not draining and closing response bodies**, which prevents connection reuse and silently leaks connections, so every request opens a fresh TCP+TLS handshake. Under load this exhausts ephemeral ports and tanks latency. Fixes: always `io.Copy(io.Discard, resp.Body)` then `resp.Body.Close()`; configure a tuned `http.Transport` with adequate `MaxIdleConns`, `MaxIdleConnsPerHost`, and `IdleConnTimeout`; reuse one client (don't create per request). Server-side, tune `ReadTimeout`/`WriteTimeout`/`IdleTimeout` and enable HTTP/2 (automatic with TLS).

**Key points**
- Keep-alive amortizes TCP+TLS setup; HTTP/2 multiplexes streams
- Footgun: default MaxIdleConnsPerHost=2 limits reuse
- Not draining/closing Body prevents reuse → handshake per request, port exhaustion
- Reuse one tuned client; never create a new client per request


```go
tr := &http.Transport{
    MaxIdleConns:        200,
    MaxIdleConnsPerHost: 100,
    IdleConnTimeout:     90 * time.Second,
}
client := &http.Client{Transport: tr, Timeout: 5 * time.Second}
// per request:
resp, _ := client.Get(url)
defer resp.Body.Close()
_, _ = io.Copy(io.Discard, resp.Body) // drain to enable reuse
```

**Follow-ups**
- Why does failing to drain the body specifically block connection reuse?
- When does HTTP/2 TCP-level HOL blocking push you toward HTTP/3?

---

#### 28. When is compression a net win on a service's network path, and when does it hurt?

*Difficulty:* 🟡 medium  ·  *Tags:* `network`, `compression`, `serialization`

Compression (gzip, or faster zstd/snappy) trades CPU for bandwidth. It's a **win** when payloads are large and compressible (JSON, text, logs) and the link is the bottleneck or you pay egress — smaller bytes mean lower transfer time and cost, often improving tail latency on constrained links. It **hurts** when: payloads are tiny (compression overhead and header cost exceed savings — many servers set a min-size threshold like 1KB), data is already compressed/binary (images, protobuf, encrypted blobs — you spend CPU for ~0 gain), or you're CPU-bound and latency-sensitive on a fast internal network where the CPU spent compressing adds more latency than the bytes saved. Choose the algorithm by the CPU/ratio trade-off: gzip is ubiquitous but slower; **zstd** gives a much better ratio-per-CPU and tunable levels; **snappy/lz4** are very fast with modest ratios for internal RPC. Always measure end-to-end: compression can lower mean throughput cost while raising p99 if it lands on the request CPU path.

**Key points**
- Trades CPU for bytes; win on large, compressible payloads / costly egress
- Skip tiny payloads (min-size threshold) and already-compressed/binary data
- zstd: best ratio-per-CPU; snappy/lz4: fast, modest ratio for internal RPC
- Measure end-to-end — can help cost/throughput but raise p99 if CPU-bound

**Follow-ups**
- How do you pick a min-size threshold for response compression?
- Why might zstd at a low level beat gzip on both speed and ratio?

---

## Load & Stress Testing

#### 29. Compare wrk, vegeta, and k6, and explain how you'd choose for validating an SLO.

*Difficulty:* 🟡 medium  ·  *Tags:* `load-testing`, `k6`, `vegeta`, `wrk`

**wrk/wrk2**: a C-based, extremely high-throughput HTTP benchmarker; wrk2 specifically fixes coordinated omission with a constant request rate and accurate latency reporting. Great for raw single-endpoint throughput/latency ceilings, scriptable in Lua. **vegeta**: a Go tool/library built around a **constant arrival rate** (`-rate`), which is exactly the open-model you want for SLO validation; it produces clean latency histograms and can be embedded in Go tests. **k6**: JavaScript-scripted, supports complex scenarios, multiple executors (including `constant-arrival-rate` which avoids coordinated omission), thresholds for pass/fail in CI, and rich metrics — best for realistic multi-step user journeys and SLO gating. Choice: for a single-endpoint capacity ceiling, wrk2 or vegeta; for scenario-based SLO validation in CI with pass/fail thresholds, k6. The non-negotiable in all cases is an **open/arrival-rate model**, not fixed virtual users, so you don't fall into coordinated omission and you actually find the throughput knee.

**Key points**
- wrk2: ultra-high-throughput, fixes coordinated omission with fixed rate
- vegeta: Go, constant-arrival-rate, embeddable, clean histograms
- k6: scenario scripting, executors, CI thresholds for SLO gating
- Always use an open/arrival-rate model, not fixed VUs

**Follow-ups**
- What's the difference between k6's constant-vus and constant-arrival-rate executors?
- How do you embed a vegeta attack inside a Go integration test?

---

#### 30. How do you find the 'knee' of a service's load curve and use it for capacity planning?

*Difficulty:* 🟠 hard  ·  *Tags:* `load-testing`, `capacity-planning`, `knee`, `slo`

Run an **open-model ramp**: steadily increase the arrival rate and plot throughput (completed rps) and latency percentiles against offered load. At low load, throughput tracks offered load and latency is flat. As you approach saturation a resource becomes the bottleneck; the **knee** is the point where latency starts climbing sharply while throughput growth flattens — beyond it, queues build (saturation in USE terms), p99 explodes, and additional load yields little extra throughput but huge latency. That knee defines your **safe operating capacity per instance**: pick a target below it (commonly ~60–70% of the knee) to leave headroom for spikes, GC, and noisy neighbors. Capacity planning then is: required_rps / safe_per_instance_rps = instance count, with margin for failures and growth. Confirm what the bottleneck is at the knee (CPU saturation? pool waits? GC?) via USE, because that tells you what to scale or fix. Re-measure after every significant change since the knee moves.

**Key points**
- Ramp offered load (open model); plot throughput and p99 vs. load
- Knee = latency turns sharply up while throughput flattens (saturation)
- Operate below the knee (~60–70%) for spike/GC/failure headroom
- Identify the bottleneck at the knee via USE to know what to scale/fix

**Follow-ups**
- Why does latency explode past the knee even as throughput plateaus?
- How does Little's Law relate offered load, latency, and concurrency at the knee?

---

#### 31. How do you define meaningful SLOs and use them to drive performance work?

*Difficulty:* 🟡 medium  ·  *Tags:* `load-testing`, `slo`, `error-budget`, `methodology`

An SLO is a target on a Service Level Indicator (SLI) measured from the *user's* perspective over a window — e.g., 'p99 latency < 200ms and success rate ≥ 99.9% over 30 days.' Good SLIs are request-centric (RED-style: latency distribution and error rate), measured at the edge the user experiences, and expressed as percentiles plus an error/availability ratio — never as averages. The SLO yields an **error budget** (the allowed 0.1% of failures/slow requests), which becomes the decision lever: when you're burning budget too fast, performance/reliability work is prioritized over features; when you have budget, you can ship faster. This turns 'is it fast enough?' into a measurable, agreed contract rather than opinion. For perf work specifically, SLOs tell you *which* percentile and endpoint to optimize and define done — you stop optimizing when you're comfortably under the SLO with headroom, avoiding gold-plating. Pair SLOs with burn-rate alerts (fast and slow windows) so you react before the budget is exhausted.

**Key points**
- SLI from the user's view; SLO = target over a window (percentile + error ratio)
- Error budget turns reliability into a prioritization lever
- SLOs define which percentile/endpoint to optimize and when to stop
- Use multi-window burn-rate alerts to react before budget exhaustion

**Follow-ups**
- How do multi-window burn-rate alerts reduce false pages?
- Why express the SLO as a percentile + budget rather than an average?

---

## Common Go Performance Bugs

#### 32. Why is defer in a hot loop a performance bug, and what's the correct pattern?

*Difficulty:* 🟡 medium  ·  *Tags:* `go-bugs`, `defer`, `resource-leak`

`defer` has gotten much cheaper since Go 1.14 (open-coded defers), but two problems remain in hot loops. First, deferring *inside* a loop means the deferred calls accumulate and **don't run until the function returns** — so resources (file handles, locks, rows) pile up for the whole loop instead of being released each iteration, which can exhaust handles or hold a lock far too long. Second, in the hottest inner loops the small per-defer overhead still shows up versus a direct call. The fix depends on intent: if you need per-iteration cleanup, **wrap the body in its own function** (or closure) so the defer fires each iteration, or release explicitly without defer; if you're just releasing a lock around a tiny critical section in a tight loop, call `Unlock()` directly. The canonical bug is `for ... { row := db.Query(...); defer row.Close() }` leaking rows until the function ends. Confirm with a CPU profile if you suspect overhead, but the resource-lifetime bug is usually the real issue.

**Key points**
- Deferred calls run at function return, not loop-iteration end
- In-loop defer leaks handles/locks/rows across the whole loop
- Fix: per-iteration helper func/closure, or explicit release
- Defer overhead is minor post-1.14; lifetime is the real bug


```go
// Bug: rows leak until function returns
for _, id := range ids {
    r, _ := db.Query(q, id)
    defer r.Close() // accumulates!
}
// Fix: scope the defer per iteration
for _, id := range ids {
    func() {
        r, _ := db.Query(q, id)
        defer r.Close()
        // use r
    }()
}
```

**Follow-ups**
- What changed with open-coded defers in Go 1.14?
- When does the loop-closure fix add its own allocation cost?

---

#### 33. What's wrong with compiling a regexp or doing reflection inside a request handler, and how do you fix it?

*Difficulty:* 🟡 medium  ·  *Tags:* `go-bugs`, `regexp`, `reflection`

**`regexp.MustCompile` inside a handler/loop** recompiles the regex automaton on every call — that's CPU- and allocation-heavy and entirely wasted work, since the pattern is constant. The fix is to compile **once** at package init into a package-level var (`var re = regexp.MustCompile(...)`) and reuse it; compiled `*regexp.Regexp` is safe for concurrent use. Even better, if the pattern is simple, replace regex with `strings`/`bytes` functions (`HasPrefix`, `Contains`, `IndexByte`) which are far faster. **Reflection** (`reflect`, and APIs built on it like `encoding/json`'s reflective path or `fmt`) is convenient but slow and allocation-heavy because it can't be inlined and boxes values; in hot paths prefer code generation (protobuf, easyjson/ffjson, or `encoding/json/v2`), type switches, or hand-written marshaling. The senior instinct: anything constant or schema-known should be precomputed at init or generated at build time, not recomputed per request. Confirm with a CPU+allocs profile showing `regexp.compile`/`reflect.*` frames.

**Key points**
- regexp.MustCompile per call recompiles the automaton — hoist to package init
- Compiled *regexp.Regexp is concurrency-safe and reusable
- Prefer strings/bytes funcs over regex for simple patterns
- Reflection can't inline and boxes — use codegen/type switches in hot paths


```go
// Bug: recompiles every call
func valid(s string) bool { return regexp.MustCompile(`^[a-z]+$`).MatchString(s) }
// Fix: compile once
var nameRe = regexp.MustCompile(`^[a-z]+$`)
func valid2(s string) bool { return nameRe.MatchString(s) }
```

**Follow-ups**
- Why can't the Go compiler hoist the MustCompile for you?
- How does codegen-based JSON avoid reflection's allocations?

---

#### 34. Explain the performance cost of a map with large value types and a goroutine that can explode in count.

*Difficulty:* 🟠 hard  ·  *Tags:* `go-bugs`, `maps`, `goroutine-explosion`

**Map of large values** (`map[K]BigStruct` where BigStruct is, say, 200 bytes): Go maps store values inline in buckets, so every insert, lookup-by-value, and especially **rehash on growth copies the whole struct**, and you cannot take a stable pointer to a map value (`&m[k]` is illegal). This means large copies on the hot path and extra memory churn. Fix: store `map[K]*BigStruct` (pointer values) so the map holds 8-byte pointers — cheaper rehash, mutable in place, fewer copies — at the cost of an extra indirection and heap allocation per value (so for tiny values, inline is better). **Goroutine explosion**: spawning an unbounded goroutine per inbound request/item (e.g., `go handle(x)` in an accept loop with no limit) lets a traffic spike or a slow downstream balloon goroutine count into the hundreds of thousands — each ~2KB+ stack, scheduler overhead, and no backpressure, ending in OOM or collapse. Fix with a bounded worker pool or a semaphore, plus context cancellation and timeouts so stuck goroutines don't accumulate. Detect via the goroutine profile (count and stuck stacks).

**Key points**
- Map values are inline: large structs cause big copies on insert/rehash; no &m[k]
- Use map[K]*T for large values; inline for tiny ones
- Unbounded go-per-request explodes under spikes/slow downstreams → OOM
- Bound with pools/semaphores + context timeouts; watch the goroutine profile


```go
// Large values: prefer pointers
type Big struct{ buf [256]byte; /* ... */ }
m := make(map[string]*Big) // 8-byte values, mutable in place

// Bound goroutines with a semaphore
sem := make(chan struct{}, 1000)
for req := range reqs {
    sem <- struct{}{}
    go func(r Req) { defer func(){ <-sem }(); handle(r) }(req)
}
```

**Follow-ups**
- Why is &m[key] illegal in Go and how does that constrain your design?
- How do context deadlines prevent slow-downstream goroutine accumulation?

---

#### 35. Why can synchronous logging in the hot path become your worst latency bug, and how do you fix it?

*Difficulty:* 🟠 hard  ·  *Tags:* `go-bugs`, `logging`, `latency`, `allocation`

Naive logging hurts in several ways. **Synchronous I/O**: writing each log line directly to stdout/file/syscall blocks the request goroutine on the write; under load these writes serialize (a single `os.Stderr` write lock) and inject latency right on the request path — a top hidden cause of p99 spikes. **Allocation/formatting cost**: `log.Printf`/`fmt`-style logging uses reflection and allocates per call, adding GC pressure; debug logs that build expensive strings even when the level is disabled waste CPU. Fixes: use a **structured, zero-allocation logger** (`zerolog`, `zap`) that avoids reflection and reuses buffers; **guard expensive log construction** behind level checks (or use the logger's lazy field APIs); and **decouple I/O** by writing to a buffered/async sink (batched flush) so the request goroutine isn't blocked on the syscall — accepting that an async buffer can drop logs on crash. Also sample high-volume debug logs. Confirm via a CPU/block profile showing the write lock or `fmt`/`reflect` frames on the request path.

**Key points**
- Synchronous writes block on a shared os.Stderr lock → p99 spikes
- fmt/reflection logging allocates and burns CPU per call
- Use zerolog/zap (zero-alloc, structured); guard expensive log building
- Decouple I/O via buffered/async sink + sampling; watch block profile


```
// Bug: synchronous, allocating, builds string even if discarded
log.Printf("user=%+v payload=%s", bigStruct, expensive())
// Better (zap): structured, lazy, low-alloc; level-gated
logger.Debug("processed", zap.Int("id", id), zap.Int("n", n))
// + async/buffered writer so the syscall doesn't block the request
```

**Follow-ups**
- What's the durability trade-off of an async/buffered log sink?
- How do zap/zerolog avoid the reflection cost of fmt-based logging?

---
