# runtime Package Deep — Practice Tasks

Twenty exercises to build muscle memory around the Go `runtime`, `runtime/debug`, `runtime/pprof`, `runtime/trace`, and `runtime/metrics` packages — the surface area you reach for when something goes wrong in production and the only artifact you have is a process. The goal is not to memorise every function; it is to learn which dial answers which question, what each one costs to read, and when reading it is the wrong move because the question is "the system is sick, why".

Each task gives a Goal, Difficulty, Skills, Setup, Steps, Acceptance criteria, folded Hints and a folded Reference solution with runnable Go 1.22+ code. Difficulty: **J**unior, **M**iddle, **S**enior, **Staff**. Read the section README and `senior.md` first — most tasks below assume you already know that `MemStats` stops the world, that `runtime/metrics` does not, that finalizers run on a single dedicated goroutine, and that `LockOSThread` is the only correct answer to "cgo with thread-local state".

---

### Task 1: Runtime snapshot function

**Goal.** Write a `Snapshot()` function that returns a struct with everything an operator wants from the process in one call: live goroutine count, CPU count, current `GOMAXPROCS`, and a curated slice of `MemStats` fields. Print it as one line so it can be tailed in a log.

**Difficulty.** Junior.

**Skills.** `runtime.NumGoroutine`, `runtime.NumCPU`, `runtime.GOMAXPROCS`, `runtime.ReadMemStats`, the cost of `ReadMemStats`.

**Setup.** Empty `main` package. No dependencies.

**Steps.**

1. Define a `Snapshot` struct with `Goroutines`, `CPUs`, `GOMAXPROCS`, `HeapAllocMB`, `HeapInUseMB`, `NumGC`, `GCPauseTotalMs`.
2. Implement `Take() Snapshot` that fills it.
3. Implement `String() string` returning a single line with `key=value` pairs.
4. From `main`, spawn 1000 goroutines that block on a channel, then print the snapshot every 200ms three times.

**Acceptance criteria.**

- `Take()` reads `MemStats` only once per call.
- The goroutine count reflects the spawned blockers (1000 + main + GC + sysmon).
- `GOMAXPROCS(0)` is used to *read* the current value, never `GOMAXPROCS(n)` with a non-zero arg unless you actually want to change it.

<details><summary>Hints</summary>

- `runtime.GOMAXPROCS(0)` returns the current value without changing it. Passing any other number sets it — easy way to wreck a benchmark.
- `runtime.ReadMemStats` is a stop-the-world call. Fine for a snapshot, not fine to call from a hot path.
- Divide `HeapAlloc` by `1024*1024` for MB. Cast to `float64` first if you want one decimal place.
- `GCPauseTotalNs` is the cumulative pause time across all GCs since process start. For a per-cycle view see `PauseNs[(NumGC+255)%256]` — the ring buffer trick is in `senior.md`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

// Senior decision: keep the struct small and operator-readable. Forty
// MemStats fields are a debugging buffet; a snapshot is for at-a-glance
// triage. Anything beyond seven fields and the eye glazes over.
type Snapshot struct {
    Goroutines      int
    CPUs            int
    GOMAXPROCS      int
    HeapAllocMB     float64
    HeapInUseMB     float64
    NumGC           uint32
    GCPauseTotalMs  float64
}

func Take() Snapshot {
    var m runtime.MemStats
    // Senior decision: ReadMemStats stops the world. We pay it ONCE per
    // snapshot and never inline it into a hot loop. If you need
    // continuous metrics, runtime/metrics is the right tool (Task 11).
    runtime.ReadMemStats(&m)
    return Snapshot{
        Goroutines:     runtime.NumGoroutine(),
        CPUs:           runtime.NumCPU(),
        GOMAXPROCS:     runtime.GOMAXPROCS(0), // read-only when arg <= 0
        HeapAllocMB:    float64(m.HeapAlloc) / (1024 * 1024),
        HeapInUseMB:    float64(m.HeapInuse) / (1024 * 1024),
        NumGC:          m.NumGC,
        GCPauseTotalMs: float64(m.PauseTotalNs) / 1e6,
    }
}

func (s Snapshot) String() string {
    return fmt.Sprintf(
        "goroutines=%d cpus=%d gomaxprocs=%d heap_alloc_mb=%.2f heap_inuse_mb=%.2f num_gc=%d gc_pause_total_ms=%.2f",
        s.Goroutines, s.CPUs, s.GOMAXPROCS,
        s.HeapAllocMB, s.HeapInUseMB,
        s.NumGC, s.GCPauseTotalMs,
    )
}

func main() {
    block := make(chan struct{})
    for i := 0; i < 1000; i++ {
        go func() { <-block }()
    }
    // Give the scheduler a beat to actually start the goroutines.
    time.Sleep(10 * time.Millisecond)

    for i := 0; i < 3; i++ {
        fmt.Println(Take())
        time.Sleep(200 * time.Millisecond)
    }
    close(block)
}
```

The discipline: one stop-the-world per snapshot, never inside a loop. The structured String() is for log shippers — once it lands in Elasticsearch or Loki you can extract any field by name. Avoid the temptation to dump all of `MemStats`; a thousand-byte log line per snapshot is line-rate-killer at 1 Hz across a fleet.

</details>

**Extension.** Add a `PerCPU` field that holds `GOMAXPROCS` values: number of goroutines locally runnable on each P. This requires `runtime/metrics` with `/sched/goroutines/runnable:goroutines` — preview Task 11.

---

### Task 2: Walk the call stack with runtime.Caller

**Goal.** Write a `WhoCalledMe()` helper that prints the file, line, and function name of (a) itself, (b) its caller, and (c) its caller's caller. Use only `runtime.Caller`. Then write a `WhoCalledMeAll()` that walks the entire stack up to depth 32 using a loop.

**Difficulty.** Junior.

**Skills.** `runtime.Caller`, `runtime.FuncForPC`, frame depth conventions.

**Setup.** A small package with three nested functions `a -> b -> c` where `c` calls `WhoCalledMe()`.

**Steps.**

1. Implement `WhoCalledMe()`. Call `runtime.Caller(0)`, `runtime.Caller(1)`, `runtime.Caller(2)` and print results.
2. Resolve `pc` to a name with `runtime.FuncForPC(pc).Name()`.
3. Implement `WhoCalledMeAll(maxDepth int)` looping `runtime.Caller(i)` until `ok == false`.
4. Test from `c()`. Print the resulting stack.

**Acceptance criteria.**

- `Caller(0)` shows the line of the call itself (inside the helper).
- `Caller(1)` shows the direct caller (`c`).
- `Caller(2)` shows `b`.
- The walking loop terminates cleanly at the bottom of the stack (typically at `runtime.main`).

<details><summary>Hints</summary>

- `runtime.Caller` returns `(pc uintptr, file string, line int, ok bool)`. The `ok` is your loop exit.
- `runtime.FuncForPC(pc).Name()` returns the fully qualified name (`pkg.func`). Trim the prefix yourself if you want short form.
- A skip value of 0 means "the frame calling Caller". Skip 1 is the parent. Off-by-one mistakes are the #1 source of wrong stack traces.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
)

// Senior decision: name the parameter `skip` everywhere it appears.
// Reading "Caller(1)" with no context is harder than reading "Caller(skip)"
// where skip is a named local — the latter survives the inevitable
// refactor that adds a wrapper layer and shifts every depth by one.
func describe(skip int) string {
    pc, file, line, ok := runtime.Caller(skip)
    if !ok {
        return fmt.Sprintf("skip=%d: unknown", skip)
    }
    fn := runtime.FuncForPC(pc)
    name := "unknown"
    if fn != nil {
        name = fn.Name()
    }
    return fmt.Sprintf("skip=%d %s:%d %s", skip, file, line, name)
}

func WhoCalledMe() {
    // Senior decision: add 1 to every skip because describe() is ITSELF
    // a frame we want to skip. If you forget this offset, every stack
    // dump in the codebase points one frame too deep.
    fmt.Println(describe(1)) // the call site of WhoCalledMe
    fmt.Println(describe(2)) // parent
    fmt.Println(describe(3)) // grandparent
}

func WhoCalledMeAll(maxDepth int) {
    for i := 1; i <= maxDepth; i++ {
        pc, file, line, ok := runtime.Caller(i)
        if !ok {
            return
        }
        name := "unknown"
        if fn := runtime.FuncForPC(pc); fn != nil {
            name = fn.Name()
        }
        fmt.Printf("  [%d] %s:%d %s\n", i, file, line, name)
    }
}

func c() {
    fmt.Println("--- WhoCalledMe ---")
    WhoCalledMe()
    fmt.Println("--- WhoCalledMeAll ---")
    WhoCalledMeAll(32)
}

func b() { c() }
func a() { b() }

func main() { a() }
```

The convention: skip=0 from the helper points at the helper itself. Skip=1 is the direct caller. If you wrap `runtime.Caller` in another helper, every recorded skip in the codebase must increment by one — this is the most common bug in handwritten logging frameworks. The newer `runtime.Callers` + `runtime.CallersFrames` API (Task 15) avoids the loop and gives inlined-frame information; use it whenever you need more than three levels.

</details>

**Extension.** Reimplement `WhoCalledMeAll` using `runtime.Callers` + `runtime.CallersFrames`. Notice how it correctly attributes inlined frames where the `Caller` loop does not.

---

### Task 3: Dump goroutines with runtime.Stack

**Goal.** Write `DumpSelf()` and `DumpAll()`. The first prints the current goroutine's stack only; the second prints every goroutine in the process. Confirm the difference experimentally by spawning ten blocked goroutines and counting `goroutine ` occurrences in each output.

**Difficulty.** Junior.

**Skills.** `runtime.Stack`, buffer sizing, the `goroutine N [state]:` header format.

**Setup.** Empty `main`, ten goroutines blocking on a channel.

**Steps.**

1. Allocate a 64 KiB buffer.
2. Call `runtime.Stack(buf, false)` for self only, print the returned slice.
3. Call `runtime.Stack(buf, true)` for all, print the returned slice.
4. Count `goroutine ` occurrences in each (use `strings.Count`).

**Acceptance criteria.**

- Self dump contains exactly one `goroutine ` line.
- All dump contains at least 11 (10 blocked + main + sometimes GC/sysmon).
- A 64 KiB buffer suffices for this toy example; you note in a comment when it would not.

<details><summary>Hints</summary>

- `runtime.Stack` *truncates* if the buffer is too small. There is no error. The truncation point is silent — production code grows the buffer in a loop until the returned length is less than the buffer size.
- The header `goroutine 1 [running]:` always starts at column 0. Count those, not stack frame lines.
- Don't use this in production for fleet-wide dumps. Use the `runtime/pprof` goroutine profile (Task 6) — it's structured and dedup-friendly.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
    "strings"
    "time"
)

// Senior decision: production-grade Stack helper grows the buffer until
// the dump fits. Calling Stack with a too-small buffer silently truncates
// — the worst possible failure mode in a debugging tool, because you'll
// never know your stack trace was cut off mid-frame.
func DumpSelf() []byte {
    buf := make([]byte, 64*1024)
    for {
        n := runtime.Stack(buf, false)
        if n < len(buf) {
            return buf[:n]
        }
        buf = make([]byte, 2*len(buf))
        if len(buf) > 64*1024*1024 {
            // Senior decision: cap at 64 MiB. A single goroutine with a
            // larger stack is almost certainly a runaway recursion; better
            // to truncate than to OOM the debugger.
            return buf[:n]
        }
    }
}

func DumpAll() []byte {
    buf := make([]byte, 64*1024)
    for {
        n := runtime.Stack(buf, true)
        if n < len(buf) {
            return buf[:n]
        }
        buf = make([]byte, 2*len(buf))
        if len(buf) > 256*1024*1024 {
            // For thousand-goroutine processes, the all-goroutine dump
            // can exceed 100 MiB. Cap is necessary.
            return buf[:n]
        }
    }
}

func main() {
    block := make(chan struct{})
    for i := 0; i < 10; i++ {
        go func() { <-block }()
    }
    time.Sleep(50 * time.Millisecond) // let them park

    self := DumpSelf()
    all := DumpAll()

    fmt.Printf("self dump: %d bytes, %d goroutine headers\n",
        len(self), strings.Count(string(self), "goroutine "))
    fmt.Printf("all dump:  %d bytes, %d goroutine headers\n",
        len(all), strings.Count(string(all), "goroutine "))

    close(block)
}
```

`runtime.Stack(buf, true)` stops the world while it walks every goroutine. On a 10k-goroutine server the pause is hundreds of milliseconds; never tie it to a request path. The goroutine profile from `pprof.Lookup("goroutine")` (Task 6) is the production-safe alternative — it groups identical stacks and writes them in pprof format, which is both smaller and machine-readable.

</details>

**Extension.** Build `CountByState(dump []byte) map[string]int` that parses the `[state]:` portion of each header and returns counts. Useful for "I have 9000 goroutines, what are they doing?" triage.

---

### Task 4: Force GC and observe NumGC

**Goal.** Read `NumGC` before and after `runtime.GC()` and confirm the counter increments by exactly one per forced call. Run a small allocation loop in between to make the GC actually have work to do.

**Difficulty.** Junior.

**Skills.** `runtime.GC`, `runtime.ReadMemStats`, the meaning of `NumGC`, when forcing GC is OK and when it is not.

**Setup.** Empty `main`.

**Steps.**

1. Read `NumGC` -> `before`.
2. Allocate ~50 MiB in chunks and drop references.
3. Call `runtime.GC()`.
4. Read `NumGC` -> `after`.
5. Print `after - before`.
6. Repeat the cycle three times.

**Acceptance criteria.**

- Each `runtime.GC()` increments `NumGC` by at least 1.
- You document in a comment that calling `runtime.GC()` in production is almost always wrong — it disrupts the GC pacer.

<details><summary>Hints</summary>

- `NumGC` is a uint32 counter that wraps after 4 billion cycles. For any realistic process this is fine.
- `runtime.GC()` blocks until the cycle completes. Useful for tests that need a deterministic GC point, dangerous in hot paths.
- `runtime/debug.SetGCPercent(-1)` disables GC; `runtime.GC()` still runs but no automatic cycles occur. Useful for benchmarks; pair with `defer debug.SetGCPercent(100)` to restore.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
)

func main() {
    var m runtime.MemStats

    for cycle := 1; cycle <= 3; cycle++ {
        runtime.ReadMemStats(&m)
        before := m.NumGC
        beforeHeapMB := float64(m.HeapAlloc) / (1024 * 1024)

        // Allocate ~50 MiB, then drop the reference so it's collectable.
        garbage := make([][]byte, 0, 50)
        for i := 0; i < 50; i++ {
            garbage = append(garbage, make([]byte, 1024*1024))
        }
        runtime.ReadMemStats(&m)
        peakHeapMB := float64(m.HeapAlloc) / (1024 * 1024)
        garbage = nil //nolint: ineffassign // intentional: drop reference

        // Senior decision: runtime.GC() in production code is almost
        // always a mistake. It overrides the GC pacer's careful trade-off
        // between CPU and memory. The only legitimate uses are
        // (a) deterministic test setup, (b) immediately before taking a
        // memory profile, (c) right before exec() in a long-lived shell
        // that wants to release RSS. Outside those, leave the pacer alone.
        runtime.GC()

        runtime.ReadMemStats(&m)
        after := m.NumGC
        afterHeapMB := float64(m.HeapAlloc) / (1024 * 1024)

        fmt.Printf(
            "cycle=%d NumGC: %d -> %d (delta=%d) heap: %.1f -> %.1f -> %.1f MiB\n",
            cycle, before, after, after-before,
            beforeHeapMB, peakHeapMB, afterHeapMB,
        )
    }
}
```

The output shows `NumGC` incrementing by 1 each cycle (sometimes 2 if the allocation phase tripped the pacer too). The heap fall from `peak` to `after` is the actual collection — proof that `runtime.GC()` ran. The fact that you can demonstrate this from a six-line `main` is itself the lesson: the runtime exposes the levers, and the only price is knowing when to pull them. In a real service that "knowing" reduces to "almost never".

</details>

**Extension.** Run the same loop with `debug.SetGCPercent(-1)` set at startup. Observe that `NumGC` only ever increments from your explicit `runtime.GC()` calls — never automatically. Restore with `debug.SetGCPercent(100)` and confirm automatic GCs resume.

---

### Task 5: pprof HTTP endpoint with CPU profile

**Goal.** Wire `net/http/pprof` into a server, generate sustained CPU load on a worker, capture a 10-second CPU profile via `go tool pprof`, and identify the hot function in `top` output.

**Difficulty.** Middle.

**Skills.** `net/http/pprof` side-effect import, `go tool pprof`, reading a flamegraph, why pprof endpoints should never be on the public mux.

**Setup.** A `main` that runs an HTTP server on `:6060` and a worker goroutine doing CPU-bound work (e.g., busy-loop SHA-256 hashing).

**Steps.**

1. Import `_ "net/http/pprof"` to register handlers on `http.DefaultServeMux`.
2. Start an HTTP server on `:6060` using `http.DefaultServeMux`.
3. Spawn a worker that loops forever computing SHA-256 of random data.
4. From a shell: `go tool pprof -seconds=10 http://localhost:6060/debug/pprof/profile`.
5. In the interactive pprof shell, run `top` and `list <funcname>`.

**Acceptance criteria.**

- `top` shows your busy function at or near the top by cumulative CPU.
- You note that exposing `/debug/pprof/*` on `:0.0.0.0:6060` is a remote-code-execution vector (`/debug/pprof/cmdline` reveals the binary, and the labels endpoint can be abused). Production needs Task 12.

<details><summary>Hints</summary>

- The `pprof` package init registers handlers on `http.DefaultServeMux`. If you use a custom mux, you must register them manually.
- CPU profile is *sampled*, not exhaustive. Default rate is 100 Hz. Functions that finish in under 10 ms may not appear.
- `go tool pprof -http=:8080 <profile>` opens a flamegraph in your browser. Use it.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "crypto/sha256"
    "log"
    "math/rand"
    "net/http"
    _ "net/http/pprof" // registers handlers on http.DefaultServeMux
)

// Senior decision: in production the side-effect import is wrong. It
// blanket-registers debug routes on whatever mux happens to be Default,
// which is often the same mux the app listens on. Best practice is a
// SEPARATE mux on a SEPARATE listener bound to localhost or a private
// interface. See Task 12 for the production-grade version.
func main() {
    go busyWorker()
    log.Println("pprof at http://localhost:6060/debug/pprof/")
    log.Fatal(http.ListenAndServe("localhost:6060", nil))
}

func busyWorker() {
    buf := make([]byte, 4096)
    h := sha256.New()
    for {
        rand.Read(buf)
        h.Reset()
        h.Write(buf)
        _ = h.Sum(nil)
    }
}

// Capture a profile from your shell:
//
//   go tool pprof -seconds=10 http://localhost:6060/debug/pprof/profile
//
// Inside the pprof interactive shell:
//
//   (pprof) top
//   Showing nodes accounting for 9.50s, 96.94% of 9.80s total
//         flat  flat%   sum%        cum   cum%
//        4.20s 42.86% 42.86%      4.20s 42.86%  crypto/sha256.block
//        2.10s 21.43% 64.29%      2.10s 21.43%  runtime.memmove
//        ...
//
//   (pprof) list busyWorker
//      ...
//      11    .          .   func busyWorker() {
//      12    .          .       buf := make([]byte, 4096)
//      13    .          .       h := sha256.New()
//      14    .          .       for {
//      15    .       50ms          rand.Read(buf)
//      16    .       30ms          h.Reset()
//      17    .      4.20s          h.Write(buf)
//      18    .       70ms          _ = h.Sum(nil)
//      19    .          .       }
//      20    .          .   }
//
// Or open a flamegraph:
//
//   go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=10
```

The lesson: `top` ranks by `flat` (samples in this function alone) and `cum` (this function plus everything it called). For a hot function like `sha256.block` the two are nearly equal because the function does its own work. For an orchestrator function (like `busyWorker` here) the `cum` is high but `flat` is near zero. Reading both columns is the difference between "this function is slow" and "this function calls a slow function".

</details>

**Extension.** Profile with `?seconds=30&hz=500` (override sample rate via the URL? — actually you cannot via the URL, change it via `runtime.SetCPUProfileRate` before starting the profile). Compare at 100 Hz vs 500 Hz — note that higher rates capture short functions but inflate overhead.

---

### Task 6: Goroutine profile via pprof.Lookup

**Goal.** Snapshot the current set of goroutines with `pprof.Lookup("goroutine").WriteTo(w, 0)` and `WriteTo(w, 1)`. The first is the binary pprof format; the second is human-readable text. Identify a leaked goroutine in the dump.

**Difficulty.** Middle.

**Skills.** `runtime/pprof.Lookup`, profile debug levels, reading the text format.

**Setup.** Spawn 100 goroutines that block on a channel never closed. Then dump.

**Steps.**

1. Spawn 100 blocked goroutines.
2. Open a file `goroutine.pb.gz`. Call `pprof.Lookup("goroutine").WriteTo(f, 0)`.
3. Open a file `goroutine.txt`. Call `pprof.Lookup("goroutine").WriteTo(f, 1)`.
4. Open `goroutine.pb.gz` with `go tool pprof goroutine.pb.gz`. Run `top` and `traces`.
5. Cat `goroutine.txt` — note the `100 @` line indicating 100 goroutines share that stack.

**Acceptance criteria.**

- `goroutine.txt` shows a stanza like `100 @ ...` for the leaked function.
- The binary profile opens in `go tool pprof` and `top` shows the leak function.
- You explain in a comment that debug level 2 is fmt-Stack-like and rarely useful for analysis.

<details><summary>Hints</summary>

- `WriteTo(w, 0)` = binary pprof, the standard input to `go tool pprof`.
- `WriteTo(w, 1)` = legacy text, deduplicated by stack — perfect for "how many goroutines are stuck here".
- `WriteTo(w, 2)` = full per-goroutine dump (like `runtime.Stack(buf, true)`). Almost never what you want.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "os"
    "runtime/pprof"
    "time"
)

func leakedWorker(block <-chan struct{}) {
    <-block // never closed -> leak
}

func main() {
    block := make(chan struct{})
    for i := 0; i < 100; i++ {
        go leakedWorker(block)
    }
    time.Sleep(100 * time.Millisecond) // let them park

    // Senior decision: write BOTH formats. The binary one for tooling,
    // the text one for a human eye when you have only ssh and cat.
    binF, err := os.Create("goroutine.pb.gz")
    must(err)
    defer binF.Close()
    if err := pprof.Lookup("goroutine").WriteTo(binF, 0); err != nil {
        panic(err)
    }

    txtF, err := os.Create("goroutine.txt")
    must(err)
    defer txtF.Close()
    // Debug level 1: deduplicated text. Reads like:
    //   100 @ 0x... 0x... 0x...
    //   #   0x...  main.leakedWorker+0x... /path/main.go:7
    // That "100 @" is the headline of every leak hunt — 100 goroutines
    // share one stack. If you saw "1 @ 100 times" instead, you'd have
    // 100 different leaks, which is a different problem.
    if err := pprof.Lookup("goroutine").WriteTo(txtF, 1); err != nil {
        panic(err)
    }

    fmt.Println("wrote goroutine.pb.gz and goroutine.txt")
    fmt.Println("inspect: go tool pprof goroutine.pb.gz  (then: top, traces)")
    fmt.Println("inspect: less goroutine.txt")

    close(block)
}

func must(err error) {
    if err != nil {
        panic(err)
    }
}
```

The `goroutine.txt` snippet matters most for triage. A line `100 @ 0x...` means 100 goroutines park at the exact same program counter — almost certainly a leak. A line `1 @ ...` repeated 100 times means 100 distinct goroutines that happen to be alive, which is normal for a busy server. Conflating the two is the most common new-engineer mistake when reading goroutine dumps. The binary profile shines once you have it open in `go tool pprof -http=:8080 goroutine.pb.gz` — the flamegraph clusters the leak by stack and makes the wedge of 100 unmistakable.

</details>

**Extension.** Also dump `pprof.Lookup("heap")` and `pprof.Lookup("allocs")`. Note the difference: `heap` is in-use objects at the moment of sampling, `allocs` is the cumulative allocation count since process start.

---

### Task 7: runtime/trace for a 100ms window

**Goal.** Record a `runtime/trace` for a 100 ms window in which a worker pool processes 100 jobs. Open the trace in `go tool trace`, find the per-goroutine timeline, and identify the longest-running job.

**Difficulty.** Middle.

**Skills.** `runtime/trace.Start`, `runtime/trace.Stop`, `go tool trace`.

**Setup.** A worker pool with 4 workers consuming from a channel. Jobs sleep a random 0–5 ms.

**Steps.**

1. Create `trace.out`.
2. Call `trace.Start(f)`.
3. Submit 100 jobs to the pool. Wait for them to finish.
4. Call `trace.Stop()`.
5. Run `go tool trace trace.out`. Click the link printed. Explore the "Goroutines" and "Scheduler" tabs.

**Acceptance criteria.**

- `trace.out` is non-empty.
- `go tool trace` opens a browser UI.
- You can point at a single job's execution span on the goroutine timeline.

<details><summary>Hints</summary>

- `runtime/trace` has measurable overhead (5–15% CPU). Production-safe in short bursts; never leave it on.
- The `go tool trace` UI requires a browser. SSH from a server: copy the file off-box and open locally.
- The "Scheduler latency profile" tab is the gold mine for "why is my goroutine starving" investigations.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "math/rand"
    "os"
    "runtime/trace"
    "sync"
    "time"
)

func main() {
    f, err := os.Create("trace.out")
    if err != nil {
        panic(err)
    }
    defer f.Close()

    // Senior decision: start the trace BEFORE the workload begins so we
    // capture the worker pool spinup too. The first millisecond of any
    // trace is the most informative — that's where laziness in init,
    // unexpected goroutine spawns, and GC warmup show up.
    if err := trace.Start(f); err != nil {
        panic(err)
    }
    defer trace.Stop()

    jobs := make(chan int, 100)
    var wg sync.WaitGroup
    for w := 0; w < 4; w++ {
        wg.Add(1)
        go func(workerID int) {
            defer wg.Done()
            for j := range jobs {
                doJob(workerID, j)
            }
        }(w)
    }
    for j := 0; j < 100; j++ {
        jobs <- j
    }
    close(jobs)
    wg.Wait()

    fmt.Println("wrote trace.out")
    fmt.Println("open with: go tool trace trace.out")
}

func doJob(workerID, jobID int) {
    // Senior decision: the trace UI shows you what each goroutine was
    // doing. If your jobs are all "Sleep" you'll see Sleep blocks; if
    // they're all "channel recv" you'll see those. The richer your
    // workload, the more informative the trace.
    time.Sleep(time.Duration(rand.Intn(5)) * time.Millisecond)
    _ = workerID
    _ = jobID
}
```

The big insight `go tool trace` gives you that pprof never can: *temporal* relationships. pprof tells you "function X consumed 30% of CPU". Trace tells you "function X consumed 30% of CPU but in three 100-ms bursts that all happened within a 2-second window where the GC was also running". Latency mysteries — "why does p99 spike every minute" — are trace questions, not pprof questions.

A 100 ms trace is small. Real production traces are 1–5 seconds; longer and the trace.out file becomes hundreds of MB and `go tool trace` chokes parsing it. Bounded windows, captured on demand via an HTTP endpoint (`/debug/pprof/trace?seconds=5`), are the production pattern.

</details>

**Extension.** Add a `trace.WithRegion` (see Task 16) around each job. Now the trace UI shows named regions in the goroutine timeline — much easier to spot "job 73 took 4.8 ms" than to eyeball coloured bars.

---

### Task 8: SetFinalizer logs when objects collect

**Goal.** Attach a finalizer to a struct that prints "collected: name=...". Allocate 10 of them in a loop, drop references, force GC, and observe the finalizer messages. Then create a *chain* (object A holds B, B holds C) and document the collection order across two GC cycles.

**Difficulty.** Middle.

**Skills.** `runtime.SetFinalizer`, why finalizers fire on a separate goroutine, ordering across GCs.

**Setup.** Empty `main`.

**Steps.**

1. Define `type Item struct { Name string }`.
2. `runtime.SetFinalizer(&item, func(i *Item) { fmt.Println("collected:", i.Name) })`.
3. Create 10 items in a loop. Drop the slice.
4. `runtime.GC()`, then `runtime.GC()` (yes, twice — see Hints).
5. Sleep 100 ms to let finalizer goroutine drain.
6. Create three items `A -> B -> C` where each `Next` field points to the next. Drop A. Force GC. Observe ordering.

**Acceptance criteria.**

- 10 "collected: ..." lines appear after the GCs.
- For the chain, you observe (and document) that the chain is collected in REVERSE order or all-at-once depending on cycle scheduling. The exact order is not guaranteed.

<details><summary>Hints</summary>

- A finalizer is run on a *dedicated* goroutine. It must never block; if it does, all subsequent finalizers stall.
- The object becomes collectable only AFTER its finalizer runs and the next GC cycle finds it unreachable. That's why you need *two* GCs: the first runs the finalizer (and resurrects the object briefly), the second actually frees it.
- Never finalize the receiver of a method that's still being called. Race city.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

type Item struct {
    Name string
    Next *Item
}

func makeItem(name string) *Item {
    it := &Item{Name: name}
    runtime.SetFinalizer(it, func(i *Item) {
        fmt.Println("collected:", i.Name)
    })
    return it
}

func main() {
    // Round 1: ten independent items.
    items := make([]*Item, 0, 10)
    for i := 0; i < 10; i++ {
        items = append(items, makeItem(fmt.Sprintf("item-%d", i)))
    }
    items = nil // drop refs

    // Senior decision: TWO runtime.GC() calls. Finalizers run AFTER an
    // object is found unreachable, and the runtime "resurrects" the
    // object briefly so the finalizer can touch it. Only the SECOND GC
    // can actually free it (assuming the finalizer didn't stash a
    // reference somewhere). Forgetting the second GC is the #1 source
    // of "my finalizer ran but memory wasn't freed".
    runtime.GC()
    runtime.GC()
    time.Sleep(100 * time.Millisecond) // let finalizer goroutine drain

    fmt.Println("--- chain ---")
    // Round 2: A -> B -> C.
    a := makeItem("A")
    b := makeItem("B")
    c := makeItem("C")
    a.Next = b
    b.Next = c
    a = nil
    _ = b
    _ = c

    // Senior decision: with the chain we'd LIKE to see C-then-B-then-A
    // (deepest first). The actual order depends on the GC implementation
    // — it may collect them all in one cycle. The Go spec gives no
    // ordering guarantee. If you NEED ordering, don't use finalizers;
    // use explicit Close() methods or runtime.AddCleanup (Task 20).
    b = nil
    c = nil
    runtime.GC()
    runtime.GC()
    time.Sleep(100 * time.Millisecond)
}
```

The output will look something like:

```
collected: item-7
collected: item-3
collected: item-9
... (in some order)
collected: item-5
--- chain ---
collected: C
collected: B
collected: A
```

(or A first, or all interleaved — the GC chooses). The lesson is dual: (1) finalizers WORK for the "log when GC'd" use case but (2) you cannot rely on order. Anything that needs deterministic teardown — close a file, return a connection to a pool, decrement a refcount — must be done with an explicit `Close()` and `defer`, not a finalizer. Finalizers are a *safety net*, not a primary mechanism. The newer `runtime.AddCleanup` (Go 1.24+, Task 20) fixes some of these sharp edges but the architectural lesson is the same.

</details>

**Extension.** Add a finalizer that *resurrects* the object by stashing the pointer in a global. Demonstrate that the object then survives the next GC. Use this only to understand the failure mode — never in real code.

---

### Task 9: KeepAlive prevents premature finalization

**Goal.** Write code where a finalizer fires *while the object is still being used*, leading to incorrect behaviour. Then fix it with `runtime.KeepAlive` and confirm the bug disappears.

**Difficulty.** Middle.

**Skills.** `runtime.KeepAlive`, the GC's eagerness to collect unreferenced objects, why `cgo` wrappers especially need this.

**Setup.** Simulate a "resource" that prints "in use: ID=N" while alive and "freed: ID=N" from its finalizer. Use the resource in a loop AFTER the last syntactic reference.

**Steps.**

1. Define `type Resource struct { ID int; Handle uintptr }`.
2. Allocate one. Set a finalizer that prints "freed".
3. In a loop, call a method that prints "in use" — but extract the `Handle` first and use the local copy in the loop. The original `*Resource` becomes unreachable.
4. Run with GC pressure (allocate aggressively in the loop). Observe "freed" printed *before* "in use" finishes.
5. Add `runtime.KeepAlive(r)` after the loop. Re-run. Confirm "freed" prints last.

**Acceptance criteria.**

- Without `KeepAlive`, "freed: ID=1" appears before some "in use: ID=1" lines under GC pressure.
- With `KeepAlive`, "freed" appears only after the loop completes.
- You document the cgo angle: any cgo function holding a pointer derived from a Go object needs `KeepAlive(obj)` after the call.

<details><summary>Hints</summary>

- The compiler may decide a variable is dead earlier than you expect — the GC follows. `KeepAlive(r)` is a no-op at runtime but tells the compiler "treat r as live up to this point".
- Force GC pressure with a tight allocation loop. Without pressure, the bug may not reproduce on every run.
- Real-world bug: `os.File.Fd()` returns a `uintptr` and the `*File` can be collected before you use the fd. The stdlib doc literally says "call runtime.KeepAlive(f)".

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "runtime"
    "time"
)

type Resource struct {
    ID     int
    Handle uintptr // pretend this is a cgo handle
}

func newResource(id int) *Resource {
    r := &Resource{ID: id, Handle: uintptr(id) * 0x1000}
    runtime.SetFinalizer(r, func(rr *Resource) {
        fmt.Printf("freed:  ID=%d Handle=0x%x\n", rr.ID, rr.Handle)
    })
    return r
}

func useHandle(handle uintptr, iter int) {
    fmt.Printf("in use: handle=0x%x iter=%d\n", handle, iter)
}

func brokenDemo() {
    fmt.Println("--- BROKEN (no KeepAlive) ---")
    r := newResource(1)
    // Senior decision: this is the trap. After we extract Handle, the
    // *Resource itself has no more uses in the function. The compiler
    // marks r as dead; the GC collects it; the finalizer fires; the
    // Handle we're holding is now a dangling reference. In cgo this
    // would be a use-after-free.
    handle := r.Handle
    for i := 0; i < 50; i++ {
        useHandle(handle, i)
        // Force GC pressure.
        _ = make([]byte, 1<<20)
        runtime.GC()
        time.Sleep(time.Millisecond)
    }
    fmt.Println("brokenDemo done")
}

func fixedDemo() {
    fmt.Println("--- FIXED (with KeepAlive) ---")
    r := newResource(2)
    handle := r.Handle
    for i := 0; i < 50; i++ {
        useHandle(handle, i)
        _ = make([]byte, 1<<20)
        runtime.GC()
        time.Sleep(time.Millisecond)
    }
    // Senior decision: KeepAlive is a compile-time signal, not a
    // runtime operation. It compiles to nothing — but it stops the
    // compiler from marking r as dead before this line. Placement
    // matters: KeepAlive must be AFTER the last use of the derived
    // value (handle) you want to protect.
    runtime.KeepAlive(r)
    fmt.Println("fixedDemo done")
}

func main() {
    brokenDemo()
    time.Sleep(100 * time.Millisecond)
    fixedDemo()
    time.Sleep(100 * time.Millisecond)
}
```

In `brokenDemo` you will see `freed: ID=1` interleaved with `in use:` lines — the finalizer ran while the loop was still iterating. In `fixedDemo` you'll see all the `in use:` lines first, then `freed: ID=2` at the very end (or after `main` returns).

The cgo connection is the most important takeaway. Any time you have:

```go
file := os.NewFile(fd, "x")
syscall.Write(int(file.Fd()), buf) // file may be collected here
runtime.KeepAlive(file)            // <- required
```

…the `KeepAlive` is not a stylistic flourish; it's correctness. The stdlib docs for `Fd()` say so explicitly. Same applies to `unsafe.Pointer` -> `uintptr` conversions in any cgo wrapper — the moment you have a `uintptr`, the GC no longer tracks it. `KeepAlive` is the bridge that keeps the original Go pointer alive while the unsafe handle is in use.

</details>

**Extension.** Find one place in the Go stdlib (try `os` or `crypto/rand`) where `runtime.KeepAlive` is used. Read the comment. Note that almost every use is at a syscall or cgo boundary — those are the only places it's commonly correct.

---

### Task 10: pprof.Do labels for hot-path attribution

**Goal.** Tag a CPU-bound function with `pprof.Do(ctx, pprof.Labels("tenant", "acme", "endpoint", "/checkout"), fn)`. Take a CPU profile. In `go tool pprof`, filter by label to show only the work tagged for `tenant=acme`.

**Difficulty.** Middle.

**Skills.** `pprof.Do`, `pprof.Labels`, `tagfocus` in `go tool pprof`, why labels beat hand-rolled bookkeeping.

**Setup.** Two CPU-bound functions, one tagged with `tenant=acme`, one with `tenant=globex`. Both run in parallel.

**Steps.**

1. Wire `net/http/pprof` (as Task 5).
2. Launch one goroutine per tenant. Wrap the workload in `pprof.Do(ctx, pprof.Labels("tenant", "acme"), func(ctx context.Context) { busyWork() })`.
3. Capture a 10s CPU profile.
4. In the pprof shell: `tagfocus=tenant=acme` then `top`. Compare against `tagfocus=tenant=globex`.
5. Open the flamegraph (`-http=:8080`) and use the label dropdown.

**Acceptance criteria.**

- `top` with `tagfocus=tenant=acme` shows only the work attributable to `acme`.
- The two tenants' CPU shares roughly match their respective workload sizes.
- You document that labels propagate via `ctx` — child goroutines launched with that ctx inherit labels.

<details><summary>Hints</summary>

- Labels are attached to the *goroutine* via `pprof.SetGoroutineLabels`. `pprof.Do` is the safe wrapper that restores the prior labels on exit.
- Child goroutines do NOT inherit labels automatically — you must pass the labelled `ctx` and call `pprof.SetGoroutineLabels(ctx)` from the child. `pprof.Do` does this for you.
- `tagfocus` is a pprof shell command; the flamegraph UI exposes the same filter via dropdowns.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "crypto/sha256"
    "log"
    "math/rand"
    "net/http"
    _ "net/http/pprof"
    "runtime/pprof"
    "sync"
)

func busyWork(iters int) {
    buf := make([]byte, 4096)
    h := sha256.New()
    for i := 0; i < iters; i++ {
        rand.Read(buf)
        h.Reset()
        h.Write(buf)
        _ = h.Sum(nil)
    }
}

func main() {
    go func() {
        log.Println("pprof at http://localhost:6060/debug/pprof/")
        log.Fatal(http.ListenAndServe("localhost:6060", nil))
    }()

    var wg sync.WaitGroup
    // Senior decision: the LABELS are the schema for slicing your CPU
    // profile after the fact. Pick them ONCE up front and use them
    // everywhere — tenant, endpoint, request_class. Inconsistent label
    // keys ("user" here, "userid" there) destroy the analysis.
    tenants := []string{"acme", "globex", "acme", "acme"} // acme triple-loaded
    for i, t := range tenants {
        wg.Add(1)
        go func(tenant string, idx int) {
            defer wg.Done()
            ctx := context.Background()
            pprof.Do(ctx, pprof.Labels(
                "tenant", tenant,
                "worker_id", fmtInt(idx),
            ), func(ctx context.Context) {
                // Senior decision: the work happens INSIDE pprof.Do.
                // Anything before/after the Do is unattributed in the
                // profile. Wrap the whole hot path, not just the
                // innermost call.
                busyWork(1_000_000)
            })
        }(t, i)
    }
    wg.Wait()
    log.Println("done")
}

func fmtInt(i int) string {
    const digits = "0123456789"
    if i == 0 {
        return "0"
    }
    buf := [16]byte{}
    pos := len(buf)
    for i > 0 {
        pos--
        buf[pos] = digits[i%10]
        i /= 10
    }
    return string(buf[pos:])
}

// Capture and inspect:
//
//   go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10
//   (pprof) tagfocus=tenant=acme
//   (pprof) top
//          flat  flat%        cum   cum%
//         5.20s 75.36%      5.20s 75.36%  crypto/sha256.block
//
//   (pprof) tagfocus=tenant=globex
//   (pprof) top
//          flat  flat%        cum   cum%
//         1.80s 25.71%      1.80s 25.71%  crypto/sha256.block
//
//   acme's three workers took ~75%, globex's one worker took ~25%.
//   That's the per-tenant CPU split, derived from the profile alone.
```

This is the feature that distinguishes "we have a CPU profile" from "we have observability". Before labels, attributing CPU to a tenant required custom counters maintained by every goroutine — duplicating work the runtime was already doing for the sampler. With labels, every sample already carries the tenant ID; you slice the profile after the fact. The same trick works for HTTP endpoint, RPC method, request priority class, customer tier — anything you can stuff into `pprof.Labels`. The discipline: pick your label keys up front, propagate via `ctx`, and never use unbounded values (don't label by request ID — labels are aggregated, not per-request).

</details>

**Extension.** Add `pprof.SetGoroutineLabels(ctx)` manually in a worker that the labelled `ctx` is passed to but `pprof.Do` is not. Confirm via profile that you can label without the `Do` wrapper, at the cost of having to restore old labels yourself (almost never worth it).

---

### Task 11: Prometheus exporter from runtime/metrics

**Goal.** Read `runtime/metrics` and expose five key metrics in Prometheus text format on `/metrics`. The five: heap allocated bytes, goroutine count, GC CPU fraction, GC pause percentile, and scheduler latency percentile.

**Difficulty.** Senior.

**Skills.** `runtime/metrics`, the `Float64Histogram` vs `Uint64` value types, Prometheus exposition format, why `runtime/metrics` is the right answer in 2024+.

**Setup.** `net/http` server. No external dependencies (write the exposition manually so you understand it).

**Steps.**

1. List the five metric names by reading `runtime/metrics.All()` and finding the ones you want by name match.
2. Create a `metrics.Sample` slice with those names.
3. In an HTTP handler, call `metrics.Read(samples)` and format each sample as a Prometheus line.
4. For histogram metrics, extract the p50/p99 by interpolating the cumulative bucket counts.
5. Curl `/metrics`. Confirm five `# HELP` and `# TYPE` lines plus values.

**Acceptance criteria.**

- `metrics.Read` is called per request, not at module init.
- Histograms are exposed as `_p50` and `_p99` derived values (or as full histograms — your choice).
- The handler completes in <1 ms on a healthy process (no stop-the-world).
- You explain in a comment why `runtime/metrics` is preferred over `runtime.ReadMemStats` for continuous monitoring.

<details><summary>Hints</summary>

- `runtime/metrics.All()` returns descriptions, including the metric kind. Use this to discover names; never hardcode without checking.
- `Float64Histogram` has `Counts []uint64` (cumulative) and `Buckets []float64` (upper edges). Percentile = "smallest bucket whose cumulative count >= total * p".
- `runtime/metrics` is sampled cheaply — most reads are non-blocking atomic loads. Safe at 1 Hz, OK at 10 Hz, expensive only if you read ALL metrics (200+).

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "log"
    "net/http"
    "runtime/metrics"
    "strings"
)

// Senior decision: declare the metrics list ONCE as a package-level
// variable. The Sample slice is allocated per-request inside the handler
// (cheap), but the schema (names + Prometheus mapping) is static — no
// reason to rebuild it every request.
var promMetrics = []struct {
    runtimeName string // runtime/metrics name
    promName    string // Prometheus metric name
    help        string
    kind        string // "gauge" | "counter" | "summary" (derived)
}{
    {"/memory/classes/heap/objects:bytes", "go_memstats_heap_alloc_bytes",
        "Bytes allocated and currently in use.", "gauge"},
    {"/sched/goroutines:goroutines", "go_goroutines",
        "Number of goroutines that currently exist.", "gauge"},
    {"/cpu/classes/gc/total:cpu-seconds", "go_gc_cpu_seconds_total",
        "Cumulative CPU time spent in GC.", "counter"},
    {"/gc/pauses:seconds", "go_gc_pause_seconds",
        "Distribution of GC pause durations.", "summary"},
    {"/sched/latencies:seconds", "go_sched_latencies_seconds",
        "Distribution of times goroutines spent on the scheduler queue.", "summary"},
}

// Senior decision: runtime/metrics is the right choice over MemStats
// for continuous monitoring because (a) most reads are lock-free atomic
// loads, no stop-the-world; (b) metrics are versioned and stable across
// Go releases; (c) histograms preserve the distribution (MemStats only
// gives totals). The migration cost is one-time; the operational win is
// permanent.
func metricsHandler(w http.ResponseWriter, r *http.Request) {
    samples := make([]metrics.Sample, len(promMetrics))
    for i, m := range promMetrics {
        samples[i].Name = m.runtimeName
    }
    metrics.Read(samples)

    var sb strings.Builder
    for i, m := range promMetrics {
        s := samples[i]
        if s.Value.Kind() == metrics.KindBad {
            // Metric doesn't exist on this Go version — skip with a
            // comment rather than erroring. The exporter must NEVER fail
            // closed on metric absence; that crashes alerting.
            fmt.Fprintf(&sb, "# %s not available on this Go version\n", m.runtimeName)
            continue
        }
        fmt.Fprintf(&sb, "# HELP %s %s\n", m.promName, m.help)
        fmt.Fprintf(&sb, "# TYPE %s %s\n", m.promName, m.kind)
        switch s.Value.Kind() {
        case metrics.KindUint64:
            fmt.Fprintf(&sb, "%s %d\n", m.promName, s.Value.Uint64())
        case metrics.KindFloat64:
            fmt.Fprintf(&sb, "%s %g\n", m.promName, s.Value.Float64())
        case metrics.KindFloat64Histogram:
            h := s.Value.Float64Histogram()
            p50 := percentile(h, 0.50)
            p99 := percentile(h, 0.99)
            fmt.Fprintf(&sb, "%s{quantile=\"0.50\"} %g\n", m.promName, p50)
            fmt.Fprintf(&sb, "%s{quantile=\"0.99\"} %g\n", m.promName, p99)
        }
    }
    w.Header().Set("Content-Type", "text/plain; version=0.0.4")
    w.Write([]byte(sb.String()))
}

// percentile interpolates the cumulative histogram for a given quantile.
// runtime/metrics histograms use OPEN buckets — h.Counts[i] is the count
// in the range (h.Buckets[i], h.Buckets[i+1]].
func percentile(h *metrics.Float64Histogram, q float64) float64 {
    var total uint64
    for _, c := range h.Counts {
        total += c
    }
    if total == 0 {
        return 0
    }
    target := uint64(float64(total) * q)
    var sum uint64
    for i, c := range h.Counts {
        sum += c
        if sum >= target {
            // Senior decision: return the upper edge of the bucket.
            // Linear interpolation across the bucket would be slightly
            // more accurate but require remembering the previous edge —
            // for a tail percentile (p99) the bucket is wide and the
            // interpolation isn't worth the code.
            return h.Buckets[i+1]
        }
    }
    return h.Buckets[len(h.Buckets)-1]
}

func main() {
    http.HandleFunc("/metrics", metricsHandler)
    log.Println("metrics at http://localhost:8080/metrics")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

A `curl localhost:8080/metrics` output looks like:

```
# HELP go_memstats_heap_alloc_bytes Bytes allocated and currently in use.
# TYPE go_memstats_heap_alloc_bytes gauge
go_memstats_heap_alloc_bytes 4218976
# HELP go_goroutines Number of goroutines that currently exist.
# TYPE go_goroutines gauge
go_goroutines 6
# HELP go_gc_cpu_seconds_total Cumulative CPU time spent in GC.
# TYPE go_gc_cpu_seconds_total counter
go_gc_cpu_seconds_total 0.001
# HELP go_gc_pause_seconds Distribution of GC pause durations.
# TYPE go_gc_pause_seconds summary
go_gc_pause_seconds{quantile="0.50"} 0.0001
go_gc_pause_seconds{quantile="0.99"} 0.0005
# HELP go_sched_latencies_seconds Distribution of times goroutines spent on the scheduler queue.
# TYPE go_sched_latencies_seconds summary
go_sched_latencies_seconds{quantile="0.50"} 1e-06
go_sched_latencies_seconds{quantile="0.99"} 2e-05
```

This is the shape the official `prometheus/client_golang` library produces for the same five metrics — confirm by reading its source. Writing it yourself once teaches you that the format is plain text and you understand what every line means; afterwards you can use the library without it being magic.

</details>

**Extension.** Add the *full* histogram bucketing for one of the histogram metrics (Prometheus `_bucket{le="..."}` series). The `le` values are `runtime/metrics` bucket upper edges. The cumulative `_count` and `_sum` complete the histogram contract.

---

### Task 12: Production-ready /debug/pprof handler

**Goal.** Build an HTTP handler that gates `/debug/pprof/*` behind HTTP basic auth AND an IP allowlist. Both must pass. The unauthenticated response is `401`; the wrong-IP response is `403`. Pprof handlers themselves must be unchanged behind the gate.

**Difficulty.** Senior.

**Skills.** `net/http/pprof` deep usage, `subtle.ConstantTimeCompare` for credentials, why basic-auth-with-static-creds beats nothing but isn't real security.

**Setup.** `net/http` server. Read username/password from env vars.

**Steps.**

1. Build the auth middleware: parse `Authorization: Basic`, decode, constant-time compare.
2. Build the IP-allowlist middleware: parse `r.RemoteAddr`, compare against CIDR list parsed at startup.
3. Compose: `allowlist -> auth -> pprofMux`.
4. Register on a SEPARATE mux on a SEPARATE listener (debug port only).
5. Test with `curl` (no auth -> 401), (bad IP -> 403), (correct -> profile bytes).

**Acceptance criteria.**

- A request from an allowlisted IP without basic auth gets 401.
- A request from a non-allowlisted IP gets 403 regardless of auth.
- Constant-time compare is used for the password (mitigates timing oracles).
- The debug listener binds to a non-default port and is documented as "do not expose to the internet".

<details><summary>Hints</summary>

- `subtle.ConstantTimeCompare` returns 1 if equal, 0 if not, and runs in time independent of input. Use it for every secret comparison.
- IP allowlist via `net.ParseCIDR` parsed once at startup; never per request.
- `r.RemoteAddr` is `host:port`. Strip the port with `net.SplitHostPort`. Also respect `X-Forwarded-For` if behind a trusted reverse proxy — but ONLY if you know it's trusted, otherwise IP-spoof city.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "crypto/subtle"
    "log"
    "net"
    "net/http"
    "net/http/pprof"
    "os"
    "strings"
)

// Senior decision: defence in depth. Either auth OR allowlist alone is
// flawed: auth on a public port still lets attackers probe with brute
// force; allowlist alone is bypassed by anyone inside the trusted network.
// Both together raise the bar enough that a misconfigured ingress
// firewall doesn't immediately leak a CPU profile.
type pprofGate struct {
    user, pass string
    nets       []*net.IPNet
    inner      http.Handler
}

func (g *pprofGate) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    // Check IP first — cheaper than basic auth, denies before we even
    // touch the password.
    host, _, err := net.SplitHostPort(r.RemoteAddr)
    if err != nil {
        http.Error(w, "bad RemoteAddr", http.StatusBadRequest)
        return
    }
    ip := net.ParseIP(host)
    if ip == nil {
        http.Error(w, "bad RemoteAddr", http.StatusBadRequest)
        return
    }
    allowed := false
    for _, n := range g.nets {
        if n.Contains(ip) {
            allowed = true
            break
        }
    }
    if !allowed {
        http.Error(w, "forbidden", http.StatusForbidden)
        return
    }

    // Basic auth.
    user, pass, ok := r.BasicAuth()
    if !ok {
        w.Header().Set("WWW-Authenticate", `Basic realm="pprof"`)
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }
    // Senior decision: constant-time compare on BOTH credentials. Using
    // == on the password leaks length and partial-prefix information via
    // timing. ConstantTimeCompare is the standard mitigation.
    userOK := subtle.ConstantTimeCompare([]byte(user), []byte(g.user)) == 1
    passOK := subtle.ConstantTimeCompare([]byte(pass), []byte(g.pass)) == 1
    if !userOK || !passOK {
        w.Header().Set("WWW-Authenticate", `Basic realm="pprof"`)
        http.Error(w, "unauthorized", http.StatusUnauthorized)
        return
    }

    g.inner.ServeHTTP(w, r)
}

func newPprofMux() *http.ServeMux {
    // Senior decision: build the pprof mux ourselves rather than using
    // http.DefaultServeMux. Registering on Default contaminates the
    // process-wide mux; explicit registration on a private mux keeps
    // pprof scoped to the debug listener only.
    mux := http.NewServeMux()
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
    mux.HandleFunc("/debug/pprof/trace", pprof.Trace)
    return mux
}

func parseAllowlist(cidrs []string) []*net.IPNet {
    out := make([]*net.IPNet, 0, len(cidrs))
    for _, c := range cidrs {
        _, n, err := net.ParseCIDR(c)
        if err != nil {
            log.Fatalf("bad CIDR %q: %v", c, err)
        }
        out = append(out, n)
    }
    return out
}

func main() {
    user := os.Getenv("PPROF_USER")
    pass := os.Getenv("PPROF_PASS")
    if user == "" || pass == "" {
        log.Fatal("PPROF_USER and PPROF_PASS must be set")
    }
    raw := os.Getenv("PPROF_ALLOW") // e.g. "10.0.0.0/8,127.0.0.1/32"
    if raw == "" {
        raw = "127.0.0.1/32,::1/128"
    }
    nets := parseAllowlist(strings.Split(raw, ","))

    gate := &pprofGate{
        user:  user,
        pass:  pass,
        nets:  nets,
        inner: newPprofMux(),
    }

    // Senior decision: bind the debug listener to localhost by default
    // and document that exposing it requires explicit ingress config.
    // The auth + allowlist are the second and third layers; "don't
    // expose at all" is the first.
    log.Println("pprof at https://127.0.0.1:6060/debug/pprof/")
    log.Fatal(http.ListenAndServe("127.0.0.1:6060", gate))
}

// Test:
//   curl -i http://127.0.0.1:6060/debug/pprof/      # 401
//   curl -i -u user:pass http://127.0.0.1:6060/debug/pprof/  # 200
//   (from a non-allowlisted IP) curl ... # 403
```

In a real fleet you would replace basic auth with an OIDC sidecar or an SPIFFE-validated mTLS connection — basic auth with static creds is a stop-gap, fine for internal-only access on a private network, never appropriate on the internet. The point of this task is the *layering*: pprof handlers are powerful (you can request a profile that pauses the runtime, a heap dump that leaks PII, a goroutine dump that reveals internal structure), so the gate has to be as tight as the surface deserves. The two-checks-pattern (IP first, auth second) is the same pattern your reverse proxy already does; replicating it in-process means a hardened build is one binary, no extra moving parts.

</details>

**Extension.** Add a third gate: rate-limit `/debug/pprof/profile` and `/debug/pprof/trace` to one request every 30 seconds per source IP. Both are expensive; an attacker who somehow got past auth+allowlist still shouldn't be able to DoS you by spamming profile requests.

---

### Task 13: SetMemoryLimit and allocation pressure

**Goal.** Set `runtime/debug.SetMemoryLimit` to 200 MiB at startup. Run an allocation loop that climbs above 200 MiB. Observe via `runtime/metrics` that the GC runs more aggressively to keep the runtime under the limit (higher `gc/cycles/total`, lower steady-state heap).

**Difficulty.** Senior.

**Skills.** `debug.SetMemoryLimit`, soft vs hard memory limits, why this is the modern replacement for `GOGC` tuning.

**Setup.** Empty `main`. Need `runtime/metrics` from Task 11.

**Steps.**

1. At startup, log the current memory limit (`debug.SetMemoryLimit(-1)` reads without setting).
2. Set to 200 MiB.
3. Run two phases: phase A with the limit, phase B with the limit removed (math.MaxInt64).
4. In each phase, allocate to ~400 MiB and drop refs slowly; sample `runtime/metrics` every 100 ms.
5. Print the GC cycle count delta per phase.

**Acceptance criteria.**

- Phase A shows significantly more GC cycles than Phase B (the runtime is GC'ing harder to honour the limit).
- Phase A's peak heap stays close to 200 MiB; Phase B's climbs above.
- You document that the limit is *soft* — Go will exceed it if the live working set cannot fit, but will exit with OOM rather than indefinitely violate.

<details><summary>Hints</summary>

- `debug.SetMemoryLimit(-1)` returns the current value without modification.
- The limit accounts for ALL Go runtime memory, not just heap (stacks, goroutine metadata, runtime state). Set it to ~80% of container limit, not 100%.
- `GOMEMLIMIT` env var sets the same thing at startup. Use both — env var as default, programmatic override for tests.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "math"
    "runtime"
    "runtime/debug"
    "runtime/metrics"
    "time"
)

func readGCCycles() uint64 {
    s := []metrics.Sample{{Name: "/gc/cycles/total:gc-cycles"}}
    metrics.Read(s)
    return s[0].Value.Uint64()
}

func readHeapInUse() float64 {
    s := []metrics.Sample{{Name: "/memory/classes/heap/objects:bytes"}}
    metrics.Read(s)
    return float64(s[0].Value.Uint64()) / (1024 * 1024)
}

func allocChurn(durationMs int) (peakMiB float64) {
    var keep [][]byte
    deadline := time.Now().Add(time.Duration(durationMs) * time.Millisecond)
    for time.Now().Before(deadline) {
        // Allocate 8 MiB chunks; keep up to 50 of them rotating.
        keep = append(keep, make([]byte, 8*1024*1024))
        if len(keep) > 50 {
            keep = keep[1:]
        }
        if mb := readHeapInUse(); mb > peakMiB {
            peakMiB = mb
        }
        time.Sleep(2 * time.Millisecond)
    }
    runtime.KeepAlive(keep)
    return
}

func main() {
    // Senior decision: read the current limit BEFORE setting one. In
    // containerised production the limit is typically set via the
    // GOMEMLIMIT env var; logging it on startup makes "what limit am I
    // running under" answerable from logs.
    current := debug.SetMemoryLimit(-1)
    fmt.Printf("startup memory limit: %d bytes (%.0f MiB)\n",
        current, float64(current)/(1024*1024))

    fmt.Println("--- Phase A: limit = 200 MiB ---")
    debug.SetMemoryLimit(200 * 1024 * 1024)
    gcBefore := readGCCycles()
    peakA := allocChurn(2000)
    gcAfter := readGCCycles()
    fmt.Printf("Phase A: %d GC cycles, peak heap %.1f MiB\n",
        gcAfter-gcBefore, peakA)

    fmt.Println("--- Phase B: limit = unlimited ---")
    debug.SetMemoryLimit(math.MaxInt64)
    gcBefore = readGCCycles()
    peakB := allocChurn(2000)
    gcAfter = readGCCycles()
    fmt.Printf("Phase B: %d GC cycles, peak heap %.1f MiB\n",
        gcAfter-gcBefore, peakB)

    // Senior decision: typical output —
    //   Phase A: 47 GC cycles, peak heap 215.4 MiB
    //   Phase B:  9 GC cycles, peak heap 401.8 MiB
    //
    // Phase A's pacer is FIGHTING to stay near 200 MiB by GCing 5x more
    // often. CPU goes up; memory stays bounded. Phase B's pacer is in
    // "GOGC=100" steady state — fewer cycles, but the heap floats up
    // to wherever the working set wants. The memory limit is the right
    // dial when you'd rather pay CPU than be OOM-killed.
}
```

This is the dial you should be reaching for in any container with a memory limit. Before `SetMemoryLimit` (Go 1.19), the only way to bound memory was to set `GOGC` low — which over-GCs in low-pressure cases and under-GCs in high-pressure ones. `GOMEMLIMIT` lets you say "I have 4 GiB of RAM; use up to 3.5 of it for heap, GC harder when you approach the limit, OOM gracefully if the working set genuinely doesn't fit". The trade-off is CPU — a tight memory limit on a workload that wants more memory costs you 10–30% extra CPU in GC. Most services would rather pay that than be killed.

</details>

**Extension.** Combine with `debug.SetGCPercent(-1)` to disable automatic GC while keeping the memory limit. The runtime still runs GC when approaching the limit ("conservative GC mode"). Use the same metrics to compare CPU and pause distribution.

---

### Task 14: LockOSThread with thread-local cgo state

**Goal.** Demonstrate why `runtime.LockOSThread` is necessary for cgo calls that depend on thread-local state. Use `errno` (set by libc) as the example: without `LockOSThread`, a goroutine that calls a libc function and then reads `errno` may read it from the wrong thread.

**Difficulty.** Senior.

**Skills.** `runtime.LockOSThread`, `runtime.UnlockOSThread`, cgo, the M:N scheduler's freedom to migrate goroutines between OS threads.

**Setup.** A small package using cgo. If cgo is unavailable in your env, simulate with `syscall.Gettid` (Linux) to prove the goroutine sometimes runs on a different OS thread per call.

**Steps.**

1. Write a function `currentThreadID() int` using a cgo `gettid()` call (Linux) or `syscall.SYS_GETTID`.
2. In a goroutine, call `currentThreadID()` 1000 times with a tiny `runtime.Gosched()` between each. Count distinct thread IDs.
3. Repeat WITH `runtime.LockOSThread()` at the start and `runtime.UnlockOSThread()` at the end. Confirm exactly one thread ID.
4. Document a real example: OpenGL contexts, X11, glibc locale, signal masks — anything pinned per-thread.

**Acceptance criteria.**

- Without lock: the goroutine observes 2+ distinct thread IDs across iterations.
- With lock: exactly one thread ID for the lifetime of the lock.
- You explain WHY (the runtime is free to park the goroutine and resume it on any P/M).

<details><summary>Hints</summary>

- `runtime.LockOSThread` is reentrant — N calls require N matching `UnlockOSThread` calls.
- A goroutine that exits while still locked terminates its OS thread. Useful for guaranteeing cleanup of thread-local C state; otherwise a leak.
- `init` functions of every Go program run on the *same* OS thread (the main thread). Useful for libraries that must initialise on the main thread, e.g. some GUI frameworks.

</details>

<details><summary>Reference solution</summary>

```go
//go:build linux

package main

import (
    "fmt"
    "runtime"
    "sync"
    "syscall"
)

// Senior decision: prefer syscall.Gettid over cgo for THIS demo because
// it's portable across Go versions and doesn't require a C toolchain.
// In production, the cgo equivalent applies to anything libc — OpenGL,
// X11, gettext, glibc locale, signal masks, OpenSSL thread-local error
// queues. The pattern is identical.
func currentTID() int {
    return syscall.Gettid()
}

func observeWithoutLock(iters int) map[int]int {
    counts := map[int]int{}
    var mu sync.Mutex
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < iters; i++ {
            tid := currentTID()
            mu.Lock()
            counts[tid]++
            mu.Unlock()
            // Give the runtime an opportunity to migrate us.
            runtime.Gosched()
        }
    }()
    wg.Wait()
    return counts
}

func observeWithLock(iters int) map[int]int {
    counts := map[int]int{}
    var mu sync.Mutex
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        // Senior decision: Lock BEFORE the first thread-local call,
        // Unlock AFTER the LAST. If you Lock too late, the first call
        // is on a random thread; if you forget to Unlock, the M is
        // pinned to this goroutine forever — which is what you want for
        // signal-handler init goroutines but a leak for ad-hoc workers.
        runtime.LockOSThread()
        defer runtime.UnlockOSThread()
        defer wg.Done()
        for i := 0; i < iters; i++ {
            tid := currentTID()
            mu.Lock()
            counts[tid]++
            mu.Unlock()
            runtime.Gosched()
        }
    }()
    wg.Wait()
    return counts
}

func main() {
    // Force a multi-P scheduler so goroutines can actually migrate.
    runtime.GOMAXPROCS(4)

    a := observeWithoutLock(10_000)
    fmt.Printf("without lock: %d distinct TIDs\n", len(a))
    for tid, n := range a {
        fmt.Printf("  tid=%d count=%d\n", tid, n)
    }

    b := observeWithLock(10_000)
    fmt.Printf("with lock: %d distinct TIDs\n", len(b))
    for tid, n := range b {
        fmt.Printf("  tid=%d count=%d\n", tid, n)
    }
}

// Typical output:
//   without lock: 3 distinct TIDs
//     tid=12345 count=4123
//     tid=12346 count=3210
//     tid=12347 count=2667
//   with lock: 1 distinct TIDs
//     tid=12348 count=10000
//
// The "3 distinct TIDs" is the bug for any cgo function that depends on
// thread-local state. errno read after a libc call may come from a
// thread that didn't make the call. OpenGL contexts will be "current"
// on a thread that's no longer running the goroutine. Signal masks set
// will affect the wrong thread.
```

The mental model: Go's runtime treats OS threads (`M`s) as interchangeable workers for goroutine execution. A goroutine that runs on M1 may yield (via channel op, `runtime.Gosched`, syscall, GC safepoint) and resume on M2 microseconds later. ANY state that's pinned to the OS thread — POSIX errno, signal masks, OpenGL/X11/Vulkan contexts, glibc locale settings, OpenSSL per-thread error queue, anything set with `pthread_setspecific` — must run on a goroutine that has called `LockOSThread`. There is no other correct way.

The corollary: don't sprinkle `LockOSThread` defensively. It pins an entire OS thread to one goroutine for the lock's duration — if you do this 1000 times concurrently you've effectively set `GOMAXPROCS` to 1000 + your real workload. Use it surgically, around the specific cgo call sequence that needs it, and unlock as soon as you're done.

</details>

**Extension.** Write a goroutine that does NOT call `UnlockOSThread` before returning. Observe (via `/sched/threads/total` or `top`) that the OS thread is destroyed when the goroutine exits — *that's the documented behaviour* and it's how you make sure thread-local C state is cleaned up rather than leaked into the runtime's M pool.

---

### Task 15: Goroutine leak detector by stack diff

**Goal.** Build a `LeakDetector` that snapshots the goroutine stack at intervals and reports any stacks that grow in count between snapshots. Run it against a deliberately leaky program (one goroutine per HTTP request, never exits).

**Difficulty.** Senior.

**Skills.** `runtime.Stack(buf, true)`, parsing the textual goroutine dump, diff-over-time.

**Setup.** A leaky HTTP handler that spawns a goroutine blocking on a channel never closed. A detector goroutine sampling every 5 seconds.

**Steps.**

1. Write a `parseStacks(buf []byte) map[string]int` that returns count per *normalised* stack (strip goroutine IDs and addresses).
2. Implement `Detector.Snapshot()` returning the map.
3. Implement `Detector.Diff(prev, curr)` returning stacks where `curr[s] > prev[s]`.
4. Wire a leaky HTTP handler. Hit it 100 times. Confirm the detector flags the leak.

**Acceptance criteria.**

- The detector identifies the leaky goroutine by its stack signature.
- It distinguishes "growing" from "fluctuating" — only flags if `curr - prev >= threshold`.
- It does NOT use `runtime.Stack(buf, true)` more than once per interval (it's stop-the-world).

<details><summary>Hints</summary>

- Goroutine dump format: each stanza starts with `goroutine NNN [state]:` then frames indented. The frame text (file:line, function name) is what you key on; the NNN and state vary per call.
- Normalise by stripping the first line (`goroutine NNN [state]:`) and any hex addresses (`0x...`).
- Real production leak detectors use `pprof.Lookup("goroutine")` instead and diff the pprof profiles — much faster, smaller, dedup'd. Building the textual version teaches the parsing; for production, prefer the structured one.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "bufio"
    "bytes"
    "fmt"
    "log"
    "net/http"
    "regexp"
    "runtime"
    "sort"
    "strings"
    "time"
)

var addrRE = regexp.MustCompile(`0x[0-9a-fA-F]+`)

// parseStacks returns count per normalised stack signature.
// Senior decision: the goroutine ID and any hex addresses are
// per-instance noise. Strip them BEFORE counting so that 100 goroutines
// stuck on the same channel collapse to one entry with count=100 —
// which is the entire point of the diff.
func parseStacks(buf []byte) map[string]int {
    counts := map[string]int{}
    sc := bufio.NewScanner(bytes.NewReader(buf))
    sc.Buffer(make([]byte, 1024*1024), 16*1024*1024)
    var current []string
    flush := func() {
        if len(current) == 0 {
            return
        }
        sig := normalise(current)
        counts[sig]++
        current = current[:0]
    }
    for sc.Scan() {
        line := sc.Text()
        if strings.HasPrefix(line, "goroutine ") {
            flush()
            current = append(current, "<header>") // drop the variable part
            continue
        }
        current = append(current, line)
    }
    flush()
    return counts
}

func normalise(lines []string) string {
    var sb strings.Builder
    for _, l := range lines {
        clean := addrRE.ReplaceAllString(l, "0x?")
        sb.WriteString(clean)
        sb.WriteByte('\n')
    }
    return sb.String()
}

type Detector struct {
    Threshold int
    prev      map[string]int
}

func (d *Detector) Snapshot() map[string]int {
    buf := make([]byte, 1<<20)
    for {
        n := runtime.Stack(buf, true)
        if n < len(buf) {
            return parseStacks(buf[:n])
        }
        buf = make([]byte, 2*len(buf))
        if len(buf) > 64<<20 {
            return parseStacks(buf[:n])
        }
    }
}

type Growth struct {
    Sig       string
    PrevCount int
    CurrCount int
}

func (d *Detector) Tick() []Growth {
    curr := d.Snapshot()
    var growths []Growth
    if d.prev != nil {
        for sig, c := range curr {
            p := d.prev[sig]
            if c-p >= d.Threshold {
                growths = append(growths, Growth{Sig: sig, PrevCount: p, CurrCount: c})
            }
        }
        sort.Slice(growths, func(i, j int) bool {
            return (growths[i].CurrCount - growths[i].PrevCount) >
                (growths[j].CurrCount - growths[j].PrevCount)
        })
    }
    d.prev = curr
    return growths
}

// --- leaky workload ---

var leak = make(chan struct{}) // never closed

func leakyHandler(w http.ResponseWriter, r *http.Request) {
    go func() {
        <-leak // forever
    }()
    w.Write([]byte("ok"))
}

func main() {
    http.HandleFunc("/leak", leakyHandler)

    go func() {
        // Detector loop.
        d := &Detector{Threshold: 10}
        // Seed.
        d.Tick()
        for {
            time.Sleep(5 * time.Second)
            growths := d.Tick()
            if len(growths) == 0 {
                continue
            }
            log.Printf("--- LEAK DETECTOR: %d growing stacks ---", len(growths))
            for _, g := range growths {
                log.Printf("count %d -> %d (delta=%d):\n%s",
                    g.PrevCount, g.CurrCount, g.CurrCount-g.PrevCount,
                    truncate(g.Sig, 400))
            }
        }
    }()

    // Self-traffic to drive the leak.
    go func() {
        time.Sleep(time.Second)
        for i := 0; i < 1000; i++ {
            resp, err := http.Get("http://127.0.0.1:7777/leak")
            if err == nil {
                resp.Body.Close()
            }
            time.Sleep(50 * time.Millisecond)
        }
    }()

    log.Fatal(http.ListenAndServe("127.0.0.1:7777", nil))
}

func truncate(s string, n int) string {
    if len(s) <= n {
        return s
    }
    return s[:n] + "...(truncated)"
}
```

Sample detector output after a minute of /leak hits:

```
--- LEAK DETECTOR: 1 growing stacks ---
count 12 -> 73 (delta=61):
<header>
main.leakyHandler.func1()
        /Users/.../main.go:114 +0x?
created by main.leakyHandler in goroutine 0x?
        /Users/.../main.go:113 +0x?
```

The stack signature is the smoking gun — `main.leakyHandler.func1` accumulates 60+ instances per minute. The diff approach is what makes this practical: a one-shot dump of "9000 goroutines" tells you nothing; "this specific stack signature went from 12 to 73 in five seconds" tells you exactly which line to fix.

Production refinements omitted here: (a) parse `pprof.Lookup("goroutine")` instead of textual `runtime.Stack` — same logic, faster, smaller, deduplicated by the runtime; (b) suppress known-noisy stacks (sysmon, GC workers) with an allowlist; (c) export the detector output as metrics so an alert can fire on "any stack growing > 10/min for 5 minutes". The skeleton above gets the control flow right.

</details>

**Extension.** Replace the textual parser with `pprof.Lookup("goroutine").WriteTo(buf, 0)` and read the resulting protobuf with `github.com/google/pprof/profile`. Faster, smaller, and gives you exact line numbers without regex.

---

### Task 16: trace.WithRegion times a critical section

**Goal.** Use `runtime/trace.WithRegion` to mark a critical section inside a worker. Open the trace in `go tool trace` and confirm the region appears as a named span on the goroutine timeline.

**Difficulty.** Senior.

**Skills.** `runtime/trace.WithRegion`, `runtime/trace.StartRegion` (lower-level), correlating regions with task IDs.

**Setup.** Worker pool from Task 7 with WithRegion calls wrapped around each job's "phase 1" and "phase 2".

**Steps.**

1. Start a trace (Task 7).
2. In each worker, call `trace.WithRegion(ctx, "phase1", func() { phase1() })`.
3. Same for `phase2`.
4. Stop the trace. Open in `go tool trace`. Navigate to "User-defined regions" view.
5. Sort by max duration. Confirm you see "phase1" and "phase2" entries with per-instance timings.

**Acceptance criteria.**

- The trace contains a "User-defined regions" tab populated with your region names.
- Each invocation appears as a separate row with start/end timing.
- Worker A's phase1 and worker B's phase1 are distinguishable (the tool shows the parent goroutine).

<details><summary>Hints</summary>

- `trace.WithRegion` requires a `context.Context`. Use `context.Background()` if you have nothing else.
- Regions cost ~100 ns each. Cheap enough for "phase boundaries inside a request", too expensive for a tight inner loop.
- For tasks that span multiple goroutines, use `trace.NewTask` to get a parent task ID and pass the ctx around.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "context"
    "fmt"
    "math/rand"
    "os"
    "runtime/trace"
    "sync"
    "time"
)

func phase1() { time.Sleep(time.Duration(rand.Intn(3)) * time.Millisecond) }
func phase2() { time.Sleep(time.Duration(rand.Intn(5)) * time.Millisecond) }

func main() {
    f, err := os.Create("trace-regions.out")
    if err != nil {
        panic(err)
    }
    defer f.Close()
    if err := trace.Start(f); err != nil {
        panic(err)
    }
    defer trace.Stop()

    jobs := make(chan int, 50)
    var wg sync.WaitGroup
    for w := 0; w < 4; w++ {
        wg.Add(1)
        go func(wid int) {
            defer wg.Done()
            for j := range jobs {
                ctx := context.Background()
                // Senior decision: NewTask gives this job a parent ID
                // that links its regions across any goroutines we spawn
                // for it. Even if phase1 spawns a helper goroutine, its
                // region inherits the same task.
                taskCtx, task := trace.NewTask(ctx,
                    fmt.Sprintf("job-%d", j))
                trace.WithRegion(taskCtx, "phase1", func() {
                    phase1()
                })
                trace.WithRegion(taskCtx, "phase2", func() {
                    phase2()
                })
                task.End()
                _ = wid
            }
        }(w)
    }
    for j := 0; j < 50; j++ {
        jobs <- j
    }
    close(jobs)
    wg.Wait()

    fmt.Println("wrote trace-regions.out")
    fmt.Println("open: go tool trace trace-regions.out")
    fmt.Println("navigate to: 'User-defined tasks' and 'User-defined regions'")
}
```

In `go tool trace`, the "User-defined regions" tab lists every region with its parent goroutine, parent task, start time, and duration. Sorting by max duration immediately surfaces the longest phase1 or phase2 instance. The "User-defined tasks" tab shows the full task tree — invaluable when a request spawns helper goroutines and you want "give me everything that happened on behalf of job-37".

The cost: each region is ~100 ns of overhead at runtime AND ~100 bytes per occurrence in the trace file. For a 10-second trace with 10k regions, that's 1 MB of trace file just for regions — comparable to the rest of the trace. Fine for occasional diagnostic captures; do NOT leave WithRegion wrapping production code paths permanently.

The Task vs Region split: Tasks are spans that *cross* goroutines (a request). Regions are spans WITHIN a goroutine (a phase). Use both layered: a Task per request, Regions per phase inside the request. This matches how OpenTelemetry's spans-and-events work — Tasks are spans, Regions are events.

</details>

**Extension.** Wrap each region with `trace.Log(ctx, "category", "message")` to add structured log entries that show up in the trace timeline. Useful for "what was the request ID when this region fired".

---

### Task 17: Block profile finds a contended mutex

**Goal.** Enable block profiling with `runtime.SetBlockProfileRate(1)`. Construct a workload with deliberate mutex contention. Capture the block profile via `pprof.Lookup("block")` and identify the contended mutex in `go tool pprof`.

**Difficulty.** Senior.

**Skills.** `runtime.SetBlockProfileRate`, block profile semantics (it counts time blocked, not function CPU), why block profiling is off by default.

**Setup.** A struct with a `sync.Mutex` guarding a counter. Spawn 8 goroutines that hammer it.

**Steps.**

1. At startup: `runtime.SetBlockProfileRate(1)` — sample every blocking event of any duration.
2. Spawn 8 goroutines incrementing a shared mutex-guarded counter for 5 seconds.
3. After workload: `pprof.Lookup("block").WriteTo(file, 0)`.
4. Open with `go tool pprof block.pb.gz`. Run `top`. Identify `sync.(*Mutex).Lock`.
5. Disable: `runtime.SetBlockProfileRate(0)`.

**Acceptance criteria.**

- Block profile shows `sync.(*Mutex).Lock` (or the contended call site) at the top.
- You document that `SetBlockProfileRate(1)` has measurable overhead (every block event records a stack); production uses rate=10000 (1 in 10000 events).
- You also note the related `SetMutexProfileFraction` for mutex-specific profiling.

<details><summary>Hints</summary>

- `SetBlockProfileRate(rate)`: 1 = sample everything; 0 = disable; N = sample one event per N nanoseconds blocked. Tune to your workload.
- The block profile shows *cumulative time blocked*, not *number of blocks*. A single 1-second block at a rare contention point ranks above a million 1-microsecond contended calls.
- For mutex-specific profiling (which mutex was contended, not just "where blocked"), use `runtime.SetMutexProfileFraction(N)` and `pprof.Lookup("mutex")`.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "log"
    "os"
    "runtime"
    "runtime/pprof"
    "sync"
    "time"
)

type Counter struct {
    mu sync.Mutex
    n  int64
}

func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func main() {
    // Senior decision: SetBlockProfileRate(1) records EVERY blocking
    // event. The overhead is bearable for a benchmark but unacceptable
    // for production. In production prefer a sampled rate
    // (rate=10000 ns means "one in ten microseconds of blocking time
    // gets a sample"). Same trade-off as CPU profile sampling rate.
    runtime.SetBlockProfileRate(1)
    runtime.SetMutexProfileFraction(1)
    defer func() {
        runtime.SetBlockProfileRate(0)
        runtime.SetMutexProfileFraction(0)
    }()

    var c Counter
    var wg sync.WaitGroup
    deadline := time.Now().Add(5 * time.Second)
    for g := 0; g < 8; g++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            for time.Now().Before(deadline) {
                for i := 0; i < 1000; i++ {
                    c.Inc()
                }
            }
        }()
    }
    wg.Wait()
    log.Printf("counter = %d", c.n)

    write("block.pb.gz", "block")
    write("mutex.pb.gz", "mutex")

    fmt.Println()
    fmt.Println("inspect block (where goroutines waited):")
    fmt.Println("  go tool pprof block.pb.gz   # then 'top'")
    fmt.Println("inspect mutex (which mutex was contended):")
    fmt.Println("  go tool pprof mutex.pb.gz   # then 'top'")
}

func write(path, name string) {
    f, err := os.Create(path)
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    if err := pprof.Lookup(name).WriteTo(f, 0); err != nil {
        log.Fatal(err)
    }
}

// Typical output:
//   $ go tool pprof block.pb.gz
//   (pprof) top
//   Showing nodes accounting for 38.50s, 99.74% of 38.60s total
//         flat  flat%   sum%        cum   cum%
//        38.50s 99.74% 99.74%     38.50s 99.74%  sync.(*Mutex).Lock
//
//   38.5 seconds of CUMULATIVE blocking time across all 8 goroutines
//   over a 5-second wall clock. That's a 7.7x contention factor — the
//   workload is mostly waiting on the mutex.
//
//   $ go tool pprof mutex.pb.gz
//   (pprof) top
//         flat  flat%   sum%        cum   cum%
//        38.50s 99.74% 99.74%     38.50s 99.74%  main.(*Counter).Inc
//
//   The mutex profile shows the contended OWNER. block profile shows
//   the WAITERS. Both useful, different angles.
```

The fix to this contention is well-known: use `sync/atomic.AddInt64` instead of mutex+int. After that change, both profiles go quiet. The lesson isn't the fix though — it's the *diagnostic*. Without block/mutex profiling, you'd watch a CPU profile see `sync.(*Mutex).Lock` at the top and have to guess whether it's contention or just a lot of cheap locks. The block profile tells you "the cumulative wait was 38 seconds across 5 wall-clock seconds" — that's unambiguous.

Production usage pattern: keep `SetBlockProfileRate` and `SetMutexProfileFraction` set to a non-zero sampled rate (e.g. 10000) all the time, expose the resulting profiles via `/debug/pprof/block` and `/debug/pprof/mutex`, and capture them ad-hoc when latency spikes appear. The overhead of sampled rates is negligible (single-digit percent); the diagnostic value when something goes wrong is enormous.

</details>

**Extension.** Add a `sync.RWMutex` to the workload with 7 readers and 1 writer. Compare the block profile to the original. RLocks contending against the writer should dominate; the writer's Lock should appear with low count but high cumulative time.

---

### Task 18: Markdown table of all runtime/metrics

**Goal.** Read `runtime/metrics.All()` on Go 1.22+ and emit a Markdown table with columns: Name, Kind, Cumulative, Description. Save the output as `metrics.md`. Use it as your local reference next time you build an exporter.

**Difficulty.** Staff.

**Skills.** `runtime/metrics.All`, `metrics.Description`, programmatic discovery vs hardcoding.

**Setup.** Empty `main`. Output to a file.

**Steps.**

1. Call `metrics.All()`.
2. For each `Description`, render as one Markdown table row.
3. Sort alphabetically by name.
4. Save to `metrics.md`. Open it; confirm it renders.
5. Note in a comment that this is the *only* source of truth — the runtime/metrics doc.go is generated from these descriptions.

**Acceptance criteria.**

- The table has one row per metric.
- Long descriptions wrap or are escaped properly for Markdown (newlines become `<br>` or are collapsed).
- The exact metric set will vary by Go version — your script will reproduce the correct table for whatever toolchain runs it.

<details><summary>Hints</summary>

- Each `Description` has `Name`, `Description`, `Kind`, `Cumulative`. The kind values are `KindUint64`, `KindFloat64`, `KindFloat64Histogram`.
- Descriptions contain newlines and pipes (`|`). Escape pipes for Markdown table syntax.
- This script doubles as a CI check: emit the table, diff against a committed `metrics.md`, fail if changed without intent. That's how you keep your exporter (Task 11) in sync with new metrics shipped in Go releases.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "fmt"
    "os"
    "runtime/metrics"
    "sort"
    "strings"
)

func kindStr(k metrics.ValueKind) string {
    switch k {
    case metrics.KindUint64:
        return "uint64"
    case metrics.KindFloat64:
        return "float64"
    case metrics.KindFloat64Histogram:
        return "float64 histogram"
    case metrics.KindBad:
        return "bad"
    }
    return "unknown"
}

// Senior decision: escape exactly THREE characters for Markdown table
// safety — `|`, newlines, and `<`. Anything else (asterisks, underscores,
// brackets) renders correctly inside cells. Over-escaping makes the
// file hard to read for the human consumer; under-escaping breaks the
// table layout. This list is the minimum.
func mdEscape(s string) string {
    s = strings.ReplaceAll(s, "|", "\\|")
    s = strings.ReplaceAll(s, "\n", " ")
    s = strings.ReplaceAll(s, "<", "&lt;")
    return s
}

func main() {
    descs := metrics.All()
    sort.Slice(descs, func(i, j int) bool {
        return descs[i].Name < descs[j].Name
    })

    out, err := os.Create("metrics.md")
    if err != nil {
        panic(err)
    }
    defer out.Close()

    fmt.Fprintln(out, "# Go runtime/metrics catalogue")
    fmt.Fprintln(out)
    fmt.Fprintf(out, "Generated from `runtime/metrics.All()` on %s\n",
        "this Go toolchain — your output may differ by version.\n")
    fmt.Fprintln(out)
    fmt.Fprintln(out, "| Name | Kind | Cumulative | Description |")
    fmt.Fprintln(out, "|------|------|------------|-------------|")
    for _, d := range descs {
        fmt.Fprintf(out, "| `%s` | %s | %t | %s |\n",
            mdEscape(d.Name),
            kindStr(d.Kind),
            d.Cumulative,
            mdEscape(d.Description),
        )
    }
    fmt.Println("wrote metrics.md with", len(descs), "rows")
}

// Sample output (Go 1.22+):
//
//   | Name | Kind | Cumulative | Description |
//   |------|------|------------|-------------|
//   | `/cpu/classes/gc/mark/assist:cpu-seconds` | float64 | true | Estimated total CPU time goroutines spent performing GC tasks to assist the GC. |
//   | `/cpu/classes/gc/mark/dedicated:cpu-seconds` | float64 | true | Estimated total CPU time spent performing GC tasks on processors dedicated to GC. |
//   | `/cpu/classes/gc/total:cpu-seconds` | float64 | true | Estimated total CPU time spent on GC. |
//   ... (200+ rows)
```

The full table on Go 1.22 has ~150 entries; on 1.24 closer to 200. Memorising names is futile; bookmarking THIS table in your repo is realistic.

Operational use: run this script in CI as part of the toolchain-upgrade workflow. When a Go release adds new metrics (1.20 added `/sync/mutex/wait/total`, 1.21 added `/godebug/non-default-behavior/*`), the diff in `metrics.md` flags the addition. Then you decide whether to expose the new metric in your exporter (Task 11). Without this discipline, your exporter silently lags behind the runtime — by the time you notice you're missing `/cpu/classes/scavenge` it's been two Go releases and you're investigating a memory mystery the metric would have answered.

</details>

**Extension.** Group the table by prefix (`/cpu/...`, `/memory/...`, `/sched/...`, etc.) with section headers. The grouping reveals the runtime's internal taxonomy of what it measures and makes the table navigable. ~12 sections cover all metrics.

---

### Task 19: Cluster-wide goroutine dump aggregator

**Goal.** Build a small command-line tool that fans out across N hosts (read from a file), fetches each host's `/debug/pprof/goroutine?debug=1`, parses the stacks, and aggregates them into a single ranking: "the top 10 goroutine stacks across the cluster, with per-host breakdown". This is the tool you reach for when a service is misbehaving across a fleet and you need to know whether 50 hosts share one symptom or have 50 different ones.

**Difficulty.** Staff.

**Skills.** Concurrent fetch, parsing the debug=1 text format, cross-host aggregation, presenting the result.

**Setup.** Three or more processes running the leaky service from Task 15 on different ports. A hosts file listing them.

**Steps.**

1. Read `hosts.txt`, one `host:port` per line.
2. Fetch `/debug/pprof/goroutine?debug=1` from each concurrently with a 5-second timeout per host.
3. Parse each response: the `N @ ...` header gives count + stack signature.
4. Aggregate: `map[stackSignature]map[host]int`.
5. Sort by total count. Print top 10 with per-host breakdown.

**Acceptance criteria.**

- Fetches are concurrent.
- Per-host failures are logged but do not abort the run.
- The output names each stack signature, gives total count, and breaks it down by host.
- You document an enhancement: in real fleets, run this as a cron and emit metrics; "cluster-wide growth of any one signature > 10x baseline" is an early-warning alert for distributed leaks.

<details><summary>Hints</summary>

- The `?debug=1` query string returns the text format `100 @ 0x... 0x...` followed by `# 0x...  func+0x...  file:line`. Parse the `N @ ...` line for the count.
- Normalise: drop the hex addresses, keep only the func+file:line. Identical code on identical Go version produces identical signatures across hosts — that's the cross-host invariant.
- Wrap the fetch in `context.WithTimeout` — a hung pprof endpoint should not stall the whole report.

</details>

<details><summary>Reference solution</summary>

```go
package main

import (
    "bufio"
    "context"
    "fmt"
    "io"
    "log"
    "net/http"
    "os"
    "regexp"
    "sort"
    "strconv"
    "strings"
    "sync"
    "time"
)

type Stack struct {
    Signature string
    Frames    []string
}

type HostReport struct {
    Host   string
    Counts map[string]int // signature -> count
    Frames map[string][]string
    Err    error
}

var (
    headRE = regexp.MustCompile(`^(\d+) @ `)
    addrRE = regexp.MustCompile(`0x[0-9a-fA-F]+`)
)

// Senior decision: build the signature from FUNCTION names only, not
// file paths. Cross-host comparisons across deploys with different
// /tmp paths still match — file paths can differ by build-id or
// container path, function names cannot.
func extractFunc(line string) string {
    // Line shape: "#\t0x...\tmain.leakyHandler.func1+0x...\t/path:line"
    fields := strings.Fields(line)
    if len(fields) < 3 {
        return ""
    }
    fn := fields[2]
    if i := strings.LastIndex(fn, "+0x"); i >= 0 {
        fn = fn[:i]
    }
    return fn
}

func parseDebug1(r io.Reader) (map[string]int, map[string][]string) {
    counts := map[string]int{}
    frames := map[string][]string{}
    sc := bufio.NewScanner(r)
    sc.Buffer(make([]byte, 1<<20), 16<<20)
    var pendingCount int
    var pendingFrames []string
    flush := func() {
        if pendingCount == 0 {
            return
        }
        sig := strings.Join(pendingFrames, " -> ")
        counts[sig] += pendingCount
        if _, ok := frames[sig]; !ok {
            cp := make([]string, len(pendingFrames))
            copy(cp, pendingFrames)
            frames[sig] = cp
        }
        pendingCount = 0
        pendingFrames = pendingFrames[:0]
    }
    for sc.Scan() {
        line := sc.Text()
        if m := headRE.FindStringSubmatch(line); m != nil {
            flush()
            n, _ := strconv.Atoi(m[1])
            pendingCount = n
            continue
        }
        if strings.HasPrefix(line, "#") {
            if fn := extractFunc(line); fn != "" {
                pendingFrames = append(pendingFrames, fn)
            }
        }
    }
    flush()
    _ = addrRE // kept import; in fuller version we'd strip addresses too
    return counts, frames
}

func fetch(ctx context.Context, host string) HostReport {
    url := fmt.Sprintf("http://%s/debug/pprof/goroutine?debug=1", host)
    req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return HostReport{Host: host, Err: err}
    }
    defer resp.Body.Close()
    if resp.StatusCode != 200 {
        return HostReport{Host: host, Err: fmt.Errorf("status %d", resp.StatusCode)}
    }
    counts, frames := parseDebug1(resp.Body)
    return HostReport{Host: host, Counts: counts, Frames: frames}
}

func readHosts(path string) []string {
    f, err := os.Open(path)
    if err != nil {
        log.Fatal(err)
    }
    defer f.Close()
    var hosts []string
    sc := bufio.NewScanner(f)
    for sc.Scan() {
        h := strings.TrimSpace(sc.Text())
        if h != "" && !strings.HasPrefix(h, "#") {
            hosts = append(hosts, h)
        }
    }
    return hosts
}

func main() {
    if len(os.Args) < 2 {
        log.Fatal("usage: cluster-dump <hosts.txt>")
    }
    hosts := readHosts(os.Args[1])

    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    // Senior decision: bounded concurrency. 1000-host fleets shouldn't
    // open 1000 simultaneous connections — that's a self-DoS via file
    // descriptor exhaustion. A semaphore of 64 is a sane default.
    sem := make(chan struct{}, 64)
    reports := make([]HostReport, len(hosts))
    var wg sync.WaitGroup
    for i, h := range hosts {
        wg.Add(1)
        sem <- struct{}{}
        go func(i int, h string) {
            defer wg.Done()
            defer func() { <-sem }()
            // Per-host timeout — much shorter than total.
            hctx, hcancel := context.WithTimeout(ctx, 5*time.Second)
            defer hcancel()
            reports[i] = fetch(hctx, h)
        }(i, h)
    }
    wg.Wait()

    // Aggregate.
    totals := map[string]int{}
    perHost := map[string]map[string]int{}
    frames := map[string][]string{}
    var failed int
    for _, r := range reports {
        if r.Err != nil {
            log.Printf("host %s: %v", r.Host, r.Err)
            failed++
            continue
        }
        for sig, n := range r.Counts {
            totals[sig] += n
            if perHost[sig] == nil {
                perHost[sig] = map[string]int{}
            }
            perHost[sig][r.Host] = n
            frames[sig] = r.Frames[sig]
        }
    }

    type entry struct {
        sig    string
        total  int
        frames []string
    }
    var sorted []entry
    for sig, n := range totals {
        sorted = append(sorted, entry{sig, n, frames[sig]})
    }
    sort.Slice(sorted, func(i, j int) bool {
        return sorted[i].total > sorted[j].total
    })

    fmt.Printf("--- Cluster goroutine summary (hosts=%d, failed=%d) ---\n",
        len(hosts), failed)
    top := len(sorted)
    if top > 10 {
        top = 10
    }
    for i := 0; i < top; i++ {
        e := sorted[i]
        fmt.Printf("\n[%d] total=%d %s\n", i+1, e.total,
            strings.Join(e.frames, " -> "))
        var hs []string
        for h := range perHost[e.sig] {
            hs = append(hs, h)
        }
        sort.Strings(hs)
        for _, h := range hs {
            fmt.Printf("    %s: %d\n", h, perHost[e.sig][h])
        }
    }
}
```

Typical output against three leaky hosts:

```
--- Cluster goroutine summary (hosts=3, failed=0) ---

[1] total=312 main.leakyHandler.func1 -> created by main.leakyHandler
    host-a:7777: 124
    host-b:7777: 98
    host-c:7777: 90

[2] total=12 net/http.(*conn).serve -> net/http.(*Server).Serve
    host-a:7777: 4
    host-b:7777: 4
    host-c:7777: 4

[3] total=3 main.main -> runtime.main
    host-a:7777: 1
    host-b:7777: 1
    host-c:7777: 1
```

The headline — "main.leakyHandler.func1 has 312 instances across the cluster, evenly distributed" — tells you in one screen that the leak is in code, not a per-host config issue. The opposite pattern (300 instances on host-a, 0 on host-b/c) would point at a per-host config or workload imbalance. Either diagnosis takes seconds with this aggregation; without it you'd be SSH-ing one host at a time, eye-balling dumps, and trying to remember which signatures matched.

Production extensions: (a) auth via Task 12's gate per host; (b) save the raw profile bytes from each host for later detailed analysis; (c) export aggregate counts as Prometheus metrics so the alert "cluster-wide signature X grew 10x in 5 minutes" becomes a real-time alarm; (d) integrate with service-discovery instead of a static hosts file. The scaffold above gets the *aggregation* right — everything else is wiring.

</details>

**Extension.** Use the binary pprof format (`/debug/pprof/goroutine` without `debug=1`) and merge profiles using `github.com/google/pprof/profile.Merge`. The merged profile opens in `go tool pprof` directly with the cluster-wide flamegraph showing per-host attribution as labels.

---

### Task 20: SetFinalizer vs AddCleanup benchmark

**Goal.** Compare `runtime.SetFinalizer` with `runtime.AddCleanup` (Go 1.24+). Write a benchmark that creates 100k objects with each mechanism and measures (a) registration time, (b) GC-cycle time after dropping references, (c) whether the cleanup function ran. Conclude with a short note on when each is the right tool.

**Difficulty.** Staff.

**Skills.** `runtime.SetFinalizer`, `runtime.AddCleanup`, `testing.B`, designing a microbenchmark that doesn't lie.

**Setup.** Go 1.24 or newer. A `_test.go` file with two `Benchmark*` functions.

**Steps.**

1. `BenchmarkSetFinalizer`: each iteration creates a new struct, registers a finalizer, drops the reference. Measure b.ReportAllocs.
2. `BenchmarkAddCleanup`: same but with `runtime.AddCleanup` (signature: `runtime.AddCleanup(ptr, func(arg T) { ... }, arg)`).
3. Run with `go test -bench=. -benchmem`.
4. Compare allocations per op, ns/op, and the number of cleanup-callback invocations after `runtime.GC(); runtime.GC()`.
5. Write the conclusion as a comment.

**Acceptance criteria.**

- Both benchmarks compile on Go 1.24+.
- `b.ReportAllocs()` is called.
- The bench output shows AddCleanup is at least as fast as SetFinalizer (or you document otherwise).
- Your conclusion correctly identifies (a) AddCleanup avoids resurrection, (b) AddCleanup supports multiple cleanups per object, (c) SetFinalizer is still required if you must mutate the object itself in cleanup.

<details><summary>Hints</summary>

- `runtime.AddCleanup` signature: `AddCleanup[T, S any](ptr *T, cleanup func(S), arg S) Cleanup`. The `arg` is captured by value — no resurrection because the cleanup never gets a pointer to the original object.
- The returned `Cleanup` has a `Stop()` method — you can cancel a registered cleanup. Finalizers can be cancelled with `SetFinalizer(ptr, nil)`.
- Benchmark gotcha: ensure your benchmark doesn't accumulate garbage faster than the GC can clean — keep allocations small (a struct with one int) so the heap doesn't dominate runtime.

</details>

<details><summary>Reference solution</summary>

```go
package cleanupbench

import (
    "runtime"
    "sync/atomic"
    "testing"
)

type Item struct {
    ID int
}

// Senior decision: count callback invocations with an atomic.
// Visualising "did it run" via a global counter is the simplest sound
// way; printf inside finalizers serialises on stdout and skews the bench.
var (
    finCalls     atomic.Uint64
    cleanupCalls atomic.Uint64
)

func BenchmarkSetFinalizer(b *testing.B) {
    finCalls.Store(0)
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        it := &Item{ID: i}
        runtime.SetFinalizer(it, func(*Item) {
            finCalls.Add(1)
        })
        _ = it
    }
    b.StopTimer()
    // Force two GC cycles to drive finalizers to completion.
    runtime.GC()
    runtime.GC()
    b.Logf("finalizer callbacks fired: %d / %d",
        finCalls.Load(), b.N)
}

func BenchmarkAddCleanup(b *testing.B) {
    cleanupCalls.Store(0)
    b.ReportAllocs()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        it := &Item{ID: i}
        // Senior decision: pass `i` (or `it.ID`) as the cleanup argument,
        // NOT the *Item itself. AddCleanup's design intent is "no
        // pointer to the original object enters the cleanup closure" —
        // that's what eliminates resurrection. Passing the pointer back
        // defeats the design.
        runtime.AddCleanup(it, func(id int) {
            cleanupCalls.Add(1)
            _ = id
        }, it.ID)
        _ = it
    }
    b.StopTimer()
    runtime.GC()
    runtime.GC()
    b.Logf("cleanup callbacks fired: %d / %d",
        cleanupCalls.Load(), b.N)
}

// Run:
//   go test -bench=. -benchmem -benchtime=100000x
//
// Typical output (Go 1.24, M2 Pro):
//   BenchmarkSetFinalizer-10    100000   312 ns/op    16 B/op    1 allocs/op
//       finalizer callbacks fired: 100000 / 100000
//   BenchmarkAddCleanup-10      100000   189 ns/op    16 B/op    1 allocs/op
//       cleanup callbacks fired:  100000 / 100000
//
// AddCleanup is ~40% faster in registration and produces the same
// cleanup count.

// ----------------------------------------------------------------------
// CONCLUSION (the lesson the benchmark proves)
//
// Use runtime.AddCleanup when:
//   - You want cleanup associated with an object's GC but DO NOT need
//     to touch the object itself in the cleanup function.
//   - You need multiple independent cleanups attached to one object
//     (AddCleanup is additive; each call registers another cleanup).
//   - You want to be able to CANCEL the registration (the returned
//     Cleanup.Stop() does that). SetFinalizer cancellation is via
//     SetFinalizer(ptr, nil) and is "best effort" — racy with GC.
//   - You want better GC behaviour (no resurrection, faster reclaim).
//     SetFinalizer resurrects the object for one GC cycle so the
//     finalizer can touch it; that delays reclaim. AddCleanup never
//     resurrects.
//
// Use runtime.SetFinalizer when:
//   - The cleanup MUST be able to mutate the object itself (e.g. flush
//     its buffer, close its embedded file handle accessed via the
//     pointer). AddCleanup's cleanup gets only the captured args, by
//     design.
//   - You're on Go < 1.24 (AddCleanup unavailable).
//   - You're maintaining stdlib code that hooks into existing
//     finalizer chains — os.File, net.Conn, etc., still use
//     SetFinalizer internally as of 1.24.
//
// Neither should be your PRIMARY cleanup mechanism. Both are safety
// nets behind explicit Close() + defer. A finalizer or cleanup that
// fires in production means a caller forgot to Close — log that fact
// so you can find them. The right pattern is:
//
//   func (r *Resource) Close() error { ... clean up ... return nil }
//
//   func NewResource() *Resource {
//       r := &Resource{ ... }
//       runtime.AddCleanup(r, func(name string) {
//           log.Printf("WARNING: resource %q garbage collected without Close()", name)
//       }, r.Name)
//       return r
//   }
//
// — the cleanup is purely diagnostic. Real cleanup happens in Close().
// ----------------------------------------------------------------------
```

The benchmark is the load-bearing artifact; the conclusion paragraph is the actual deliverable. AddCleanup's design is shaped by three concrete pain points from a decade of `SetFinalizer` use: (1) object resurrection makes reclaim non-deterministic, (2) one finalizer per object is rarely enough for libraries that want to layer cleanups, (3) the cancellation story is racy. AddCleanup fixes all three at the cost of "you don't get a pointer to the original object" — which turns out to be a feature, not a limitation, because it forces the right design (close explicitly, use cleanup for diagnostics only).

In 2024+ codebases, you should be reaching for `AddCleanup` by default and using `SetFinalizer` only when you specifically need the resurrection behaviour (rare; mostly when wrapping cgo finalisers that must mutate the cgo handle). Even then, document the choice — future readers will assume `AddCleanup` was intentional.

</details>

**Extension.** Register five `AddCleanup` calls on one object and verify that all five fire on GC. Then call `Stop()` on two of them and verify the other three still fire. Compare to `SetFinalizer`, which only supports one finalizer per object — setting a second replaces the first silently.

---

## How to grade yourself

Score each task `0` (didn't try), `1` (got it with hints), `2` (got it unaided), `3` (got it AND can predict the runtime-cost of each call without looking it up). Sum:

| Score | What it means |
|-------|---------------|
| 0–15  | You know `runtime.NumGoroutine` exists. Redo Tasks 1–4 until reading `MemStats`, walking stacks, and forcing GC are reflex. The runtime is a toolbox; you can't reach for the right tool until you've held them all. |
| 16–30 | You can wire pprof, trace, and finalizers. Tasks 5–10. The key gap is connecting the diagnostic to the workload — `pprof.Do` labels (Task 10) are the single biggest force-multiplier here; if Task 10 didn't change how you think about CPU profiles, redo it. |
| 31–45 | Production-ready. Tasks 11–17 are the dials and meters of a long-running service: a real metrics exporter, a hardened debug endpoint, memory limits, LockOSThread for cgo, leak detection, region timing, block profiling. If you can ship these confidently you can run a Go service in production. |
| 46–60 | Senior-staff. Tasks 18–20 are about *system-level* observability and engineering. Generating the metrics catalogue, fanning out across a fleet, benchmarking finalizer-style APIs — these are the skills you reach for when the service has been running for a year and you're tuning the next 10x. |

The most important question after all 20 isn't "did you write the code" — it's "for any new symptom in a Go process, do you know which runtime knob to read first?" High goroutine count -> `pprof.Lookup("goroutine")` (Task 6). Latency spike -> `runtime/trace` (Tasks 7, 16). Memory growth -> heap profile + `runtime/metrics` (Task 11). Stuck process -> `runtime.Stack(buf, true)` (Task 3). Contended mutex -> block/mutex profile (Task 17). Slow startup -> CPU profile with `pprof.Do` labels (Tasks 5, 10). Mysterious thread issue -> `LockOSThread` (Task 14). If those mappings are reflex, the rest is reading docs.

Concrete checks worth running before declaring done:

- `go test -race ./...` clean across every task that has shared state (Tasks 15, 17, 19, 20 especially).
- For Task 9 (KeepAlive): does removing the `KeepAlive` actually reproduce the "freed too early" bug? If it doesn't, you don't have enough GC pressure.
- For Task 11 (Prometheus exporter): scrape it with `promtool check metrics http://localhost:8080/metrics`. If `promtool` accepts the output, you've got the format right.
- For Task 12 (production /debug/pprof): try every combination — no auth + allowlisted, auth + non-allowlisted, both correct, both wrong. All four should produce the right status code.
- For Task 13 (SetMemoryLimit): with `GODEBUG=gctrace=1` set, watch the GC trace lines as Phase A unfolds. The pacer's "trigger ratio" should adapt downward — proof that the limit is in effect.
- For Task 18 (metrics.md): re-run on the next Go toolchain you have access to (1.23 vs 1.22). Diff the outputs. Every new line is a new metric you may want to expose.

---

## Stretch challenges

**S1 — Continuous profiler with auto-capture.** Build a daemon that runs alongside your service. Every 30 seconds it reads `/sched/latencies:seconds`, `/gc/pauses:seconds`, and `/cpu/classes/user:cpu-seconds` from `runtime/metrics`. When ANY of those exceeds a per-metric threshold (e.g. p99 sched latency > 50 ms, gc pause p99 > 10 ms, CPU > 90% sustained for 60 s), automatically capture a 10-second CPU profile, a goroutine profile, and a 5-second trace. Save them to disk with timestamped filenames. Constraint: the captures must NOT themselves cause a threshold breach — sample lightly, only capture during a confirmed sustained anomaly. This is "always-on profiling" the way Google's profiler does it: most of the time you're free, when something is wrong you have profiles from the moment it went wrong.

**S2 — Multi-process Go GC coordinator.** Modern services often run N sidecar processes (envoy, otel-collector, your Go service). Each has its own GC pacer fighting for memory under a shared cgroup memory limit. Build a tiny supervisor that reads `runtime/metrics` from each Go process via gRPC, computes a "fair share" memory limit per process based on actual working-set demand, and pushes new `debug.SetMemoryLimit` values to each process. The processes accept the new limit via an admin gRPC. Constraint: no process should be OOM-killed; if total demand exceeds the cgroup limit, scale down the worst offenders' QoS (drop low-priority requests) rather than let the kernel reaper choose victims randomly. This is the runtime side of "vertical pod autoscaling done in-process".

**S3 — Reproducible heap profile differ for memory leak triage.** Given two heap profiles taken hours apart from the same process (via `/debug/pprof/heap`), write a tool that computes the *symbolic* delta — which call sites grew, by how much, both in bytes and in object count. Output should be a flamegraph where each cell is coloured by growth rate, not by absolute size — so a small but persistently-growing allocation stands out against a large but stable one. Use `github.com/google/pprof/profile` for the parsing. Constraint: false positives are the enemy. Allocations that grow and then are GC'd (transient peaks) must NOT appear in the diff — only objects that survived the GC at both snapshot points. This is the diagnostic that distinguishes "I have a leak" from "I have a healthy growing working set" — and getting it right means understanding both pprof's data model and the runtime's heap accounting deeply enough to know what each sample actually represents.
