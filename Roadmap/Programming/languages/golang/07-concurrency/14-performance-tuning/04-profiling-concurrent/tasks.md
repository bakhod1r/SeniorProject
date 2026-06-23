# Profiling Concurrent Go Code — Practical Tasks

## Table of Contents
1. [How to Use This Page](#how-to-use-this-page)
2. [Task 1 — Hello, Mutex Profile](#task-1--hello-mutex-profile)
3. [Task 2 — Reading a Block Profile](#task-2--reading-a-block-profile)
4. [Task 3 — Goroutine Snapshot Triage](#task-3--goroutine-snapshot-triage)
5. [Task 4 — Your First runtime/trace](#task-4--your-first-runtimetrace)
6. [Task 5 — Diff Two Mutex Profiles](#task-5--diff-two-mutex-profiles)
7. [Task 6 — Lines vs Functions](#task-6--lines-vs-functions)
8. [Task 7 — Goroutine Labels](#task-7--goroutine-labels)
9. [Task 8 — Trace Tasks and Regions](#task-8--trace-tasks-and-regions)
10. [Task 9 — Worker Pool Profile Slicing](#task-9--worker-pool-profile-slicing)
11. [Task 10 — Triage Script](#task-10--triage-script)
12. [Task 11 — Continuous Profiling Lab](#task-11--continuous-profiling-lab)
13. [Task 12 — Concurrency Health Dashboard](#task-12--concurrency-health-dashboard)
14. [Task 13 — Profile Capture in CI](#task-13--profile-capture-in-ci)
15. [Self-Assessment](#self-assessment)

---

## How to Use This Page

Each task is a small self-contained lab. Most run on a laptop with Go 1.22+ and `graphviz` installed (for the pprof web UI). Tasks marked "infra" want a docker daemon. Solutions are intentionally not provided — you should solve them.

```bash
go version            # 1.22 or newer
which dot             # for pprof web UI
docker version        # for tasks 11 and 12
```

---

## Task 1 — Hello, Mutex Profile

**Goal.** Capture your first mutex profile.

**Steps.**

1. Create `main.go`:

   ```go
   package main

   import (
       "fmt"
       "log"
       "net/http"
       _ "net/http/pprof"
       "runtime"
       "sync"
       "time"
   )

   type Counter struct {
       mu sync.Mutex
       n  int
   }

   func (c *Counter) Inc() {
       c.mu.Lock()
       defer c.mu.Unlock()
       time.Sleep(50 * time.Microsecond)
       c.n++
   }

   func main() {
       runtime.SetMutexProfileFraction(1)

       go func() { log.Println(http.ListenAndServe("127.0.0.1:6060", nil)) }()

       var c Counter
       var wg sync.WaitGroup
       for i := 0; i < 200; i++ {
           wg.Add(1)
           go func() {
               defer wg.Done()
               for j := 0; j < 500; j++ {
                   c.Inc()
               }
           }()
       }
       wg.Wait()
       fmt.Println(c.n)
       select {}
   }
   ```

2. `go run main.go &`
3. `curl -o mutex.prof http://127.0.0.1:6060/debug/pprof/mutex`
4. `go tool pprof mutex.prof`
5. `(pprof) top`

**Expected outcome.** `main.(*Counter).Inc` is at the top. The flat value is in seconds — that is the total wait time accumulated across goroutines during the window.

**Stretch.** Add `granularity=lines`. Confirm the Unlock line shows up.

---

## Task 2 — Reading a Block Profile

**Goal.** Use the block profile to find a slow channel.

**Steps.**

1. Write a producer/consumer where the consumer is the bottleneck:

   ```go
   ch := make(chan int) // unbuffered
   // producer: 100k sends
   // consumer: 10 ms per receive
   ```

2. Enable: `runtime.SetBlockProfileRate(1)`.
3. Capture `/debug/pprof/block`.
4. `go tool pprof -lines block.prof`, `top -cum`.

**Expected outcome.** `runtime.chansend1` at the producer's send line dominates.

**Questions to answer.**

- What does the cum column tell you?
- If you bump the channel capacity to 1000, how does the profile change?

---

## Task 3 — Goroutine Snapshot Triage

**Goal.** Use the goroutine profile to identify a leak.

**Steps.**

1. Write a function `leaky()` that starts a goroutine which blocks on a channel that is never closed and never sent to.
2. Call `leaky()` 1000 times in a loop.
3. After the loop, capture `/debug/pprof/goroutine?debug=1`.
4. Identify the stack with count ~1000.

**Stretch.** Capture `?debug=2` and find one of the leaked goroutines' wait reason and duration.

---

## Task 4 — Your First runtime/trace

**Goal.** Capture and explore a 3-second trace.

**Steps.**

1. Reuse the program from Task 1.
2. `curl -o trace.out 'http://127.0.0.1:6060/debug/pprof/trace?seconds=3'`
3. `go tool trace trace.out`
4. Open the browser. Click "View trace."
5. Zoom in on a 50 ms window. Identify your worker goroutines.

**Questions to answer.**

- Which goroutines are running concurrently?
- Where do you see `gopark` markers?
- Click "Goroutine analysis." Which function dominates `Sync block` time?

---

## Task 5 — Diff Two Mutex Profiles

**Goal.** Use `-base` to compare before/after.

**Steps.**

1. From Task 1, capture `before.prof`.
2. Modify the program: replace `c.mu.Lock()` with a sharded approach (e.g., 16 counters, hash to one).
3. Re-run, capture `after.prof`.
4. `go tool pprof -base before.prof after.prof`
5. `top`. Negative numbers should dominate.

**Stretch.** Plot the change as a flame graph: `go tool pprof -http=:9090 -base before.prof after.prof`.

---

## Task 6 — Lines vs Functions

**Goal.** Discover what `-lines` reveals on a mutex profile.

**Steps.**

1. Write a function that uses two different mutexes:

   ```go
   func op(a, b *sync.Mutex) {
       a.Lock()
       ...
       a.Unlock()
       b.Lock()
       ...
       b.Unlock()
   }
   ```

2. Spawn many goroutines calling `op` with shared `a` and `b`.
3. Capture the mutex profile.
4. Run `go tool pprof mutex.prof` and `top`. Then `granularity=lines` and `top` again.

**Expected outcome.** Without `-lines`, both unlocks merge. With `-lines`, you see two separate sites.

---

## Task 7 — Goroutine Labels

**Goal.** Slice a CPU profile by label.

**Steps.**

1. Write an HTTP server with two endpoints: `/fast` (1 ms work) and `/slow` (10 ms work).
2. Wrap each handler in `pprof.Do(ctx, pprof.Labels("endpoint", r.URL.Path), func(ctx context.Context) {...})`.
3. Drive load against both endpoints (e.g., `hey`).
4. Capture `/debug/pprof/profile?seconds=10`.
5. `go tool pprof profile`. `(pprof) tags`. Then `(pprof) tagfocus=endpoint=/slow` and `top`.

**Expected outcome.** Only `/slow` work appears.

---

## Task 8 — Trace Tasks and Regions

**Goal.** Add user-defined tasks/regions and see them in `go tool trace`.

**Steps.**

1. Pick an existing program (or write a small one with multi-step work).
2. Wrap each handler invocation in `trace.NewTask`.
3. Add `trace.StartRegion` around each logical step.
4. Capture a 3-second trace under load.
5. In `go tool trace`, open "User-defined tasks." Inspect one task's regions.

**Stretch.** Add `trace.Logf` to log a value at a specific point. Find it in the task's event timeline.

---

## Task 9 — Worker Pool Profile Slicing

**Goal.** Label a worker pool so profiles slice by pool.

**Steps.**

1. Build a worker pool: 4 workers consuming from a job channel.
2. At the top of each worker's run loop, call `pprof.SetGoroutineLabels(pprof.WithLabels(ctx, pprof.Labels("pool", "main", "worker", strconv.Itoa(i))))`.
3. Run the pool under load.
4. Capture mutex and block profiles.
5. Slice by `tagfocus=pool=main` and check the output.

**Stretch.** Add a second pool. Verify each pool's contention is separable.

---

## Task 10 — Triage Script

**Goal.** Write a reusable snapshot script.

**Steps.**

1. Write `go-snap` (bash or any language) that, given a host:port:
   - Captures CPU profile (15 s), heap, goroutine, mutex, block, and trace (5 s).
   - Writes all of them to a timestamped directory.
   - Runs `wait` so all curls run in parallel.
2. Run it against any service of yours.
3. Verify all six files are present and non-empty.

**Stretch.** Add automated post-processing: open each profile in pprof, dump `top 10` to a `summary.txt`.

---

## Task 11 — Continuous Profiling Lab (infra)

**Goal.** Run Pyroscope or Parca locally and feed it a Go service.

**Steps.**

1. `docker run -d -p 4040:4040 grafana/pyroscope` (or use Parca's docker image).
2. Build a small Go service that uses the Pyroscope agent (`github.com/grafana/pyroscope-go`) or exposes pprof for Parca to scrape.
3. Drive load.
4. Open Pyroscope/Parca UI. Navigate to your service's CPU flame graph.
5. Enable mutex profile in the service. Verify it appears in the UI.

**Stretch.** Add `pprof.Do` labels and confirm the UI's label filter shows them.

---

## Task 12 — Concurrency Health Dashboard (infra)

**Goal.** Wire `runtime/metrics` to Prometheus and Grafana.

**Steps.**

1. Use the `github.com/prometheus/client_golang` package.
2. Register a collector that polls these `runtime/metrics`:
   - `/sched/goroutines:goroutines`
   - `/sched/latencies:seconds`
   - `/gc/pauses:seconds`
   - `/memory/classes/heap/objects:bytes`
3. Expose `/metrics`. Run a Prometheus + Grafana docker stack locally.
4. Build a four-panel dashboard.

**Stretch.** Add an alert for goroutine count growing 3× over the last hour.

---

## Task 13 — Profile Capture in CI

**Goal.** Add automatic profile capture to a benchmark.

**Steps.**

1. Write a benchmark that exercises a concurrent data structure.
2. Run it with `-mutexprofile mu.prof -blockprofile bl.prof -cpuprofile cpu.prof`.
3. In CI, persist the profiles as artefacts.
4. Add a small Go program that compares the new mutex profile to a baseline (`-base`) and fails CI if contention rose by more than X%.

**Stretch.** Maintain the baseline in a separate branch updated by humans only.

---

## Self-Assessment

- [ ] I have captured all three concurrency profiles on at least one real program.
- [ ] I can open and navigate `go tool trace`.
- [ ] I have used `-base` to verify a fix.
- [ ] I have used `-lines` and seen the difference.
- [ ] I have instrumented a handler with labels and tasks.
- [ ] I have run a continuous profiler locally.
- [ ] I have a working snapshot script.
- [ ] I have a CI hook that captures mutex/block profiles for benchmarks.
