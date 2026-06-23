# pprof — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is pprof and what does it measure?**
pprof is Go's built-in **sampling profiler**. It can measure CPU time, memory (heap and total allocations), goroutine stacks, blocking events, mutex contention, and OS thread creation. It samples — it does not trace every event.

**Q2. Name three ways to collect a CPU profile.**
1. `go test -bench=. -cpuprofile=cpu.prof` from a benchmark.
2. `curl http://host/debug/pprof/profile?seconds=30` against a server with `_ "net/http/pprof"` imported.
3. `pprof.StartCPUProfile(f)` / `defer pprof.StopCPUProfile()` from code.

**Q3. How do you open a profile?**
`go tool pprof cpu.prof` for the terminal UI, or `go tool pprof -http=:8080 cpu.prof` for the browser UI with flame graphs.

**Q4. Why does the import look like `_ "net/http/pprof"`?**
The blank import runs the package's `init()`, which registers handlers under `/debug/pprof/` on `http.DefaultServeMux`. Without `_`, the import is unused and dropped, so no handlers register.

---

## Middle

**Q5. What is the difference between `heap` and `allocs` profiles?**
`allocs` is the cumulative total of every object/byte allocated since program start (including freed). `heap` is what is **currently live**. Use `heap` to find leaks and `allocs` to find allocation churn that pressures the GC.

**Q6. The CPU profile shows almost nothing useful — `top` is dominated by one or two samples. What is wrong?**
The capture window is too short for the default 100 Hz rate. Capture longer (`?seconds=30`), raise the rate with `runtime.SetCPUProfileRate(500)`, or run a workload that exercises the code for more than a fraction of a second.

**Q7. How do you compare two profiles to find a regression?**
`go tool pprof -http=:8080 -base=before.prof after.prof`. The delta view shows positive samples where `after` got worse and negative where it got better.

**Q8. What does `flat` vs `cum` mean in `top`?**
`flat` is samples in the function itself, excluding callees. `cum` is samples in the function plus everything it calls. A leaf hot function has high flat. A dispatcher has high cum and low flat.

**Q9. Your service is slow but CPU is near zero. Which profile do you reach for?**
`block` and `mutex`. The CPU profile only sees on-CPU time; blocked goroutines are invisible there. Enable with `runtime.SetBlockProfileRate(10000)` and `runtime.SetMutexProfileFraction(1)`.

---

## Senior

**Q10. Why might `runtime.gcBgMarkWorker` dominate a CPU profile, and what should you do?**
That worker is the garbage collector. Its dominance means your code allocates faster than the GC can reclaim, so the GC tax shows up as CPU. The fix is in the **heap/allocs** profile — find what allocates the most and reduce it (pooling, buffer reuse, fewer interface boxings). Do not micro-optimize the CPU profile.

**Q11. Why is profiling with `-N -l` a bad idea?**
Those flags disable optimization and inlining. The resulting profile reflects a binary nobody runs. Inlining and escape analysis materially change hot paths, so optimizations applied based on that profile may not move the needle on the real binary.

**Q12. How do you safely run pprof in production?**
Bind `net/http/pprof` handlers to an admin listener on a private port (e.g., `127.0.0.1:6060`) or behind authentication. Never expose them on a public LB. Overhead of dormant handlers is negligible; the value during an incident is enormous.

**Q13. What does `pprof.Do` do and when do you use it?**
It attaches labels (key/value tags) to samples taken during the function it wraps. In the pprof UI you can `tagfocus=op:checkout` to view only samples from that labeled work. Use it when one operation or one tenant is suspected of causing a spike and you need to slice the profile.

---

## Professional

**Q14. What is the on-disk format of a pprof file?**
A gzipped protobuf described by `profile.proto` (in the `google/pprof` repo). It contains samples (each is a stack + value vector + labels), locations, functions, mappings, and a deduplicated string table. Any language can produce this format; `go tool pprof` reads them all.

**Q15. How does the Go runtime collect CPU samples?**
On POSIX, it installs a SIGPROF handler and uses `setitimer(ITIMER_PROF)` to deliver the signal at the configured rate (default 100 Hz). The handler unwinds the current goroutine's stack and writes the sample to a lock-free buffer. A separate goroutine drains and serializes. On Windows, `GetThreadTimes` + polling is used. Source: `runtime/cpuprof.go`, `runtime/proc.go`.

**Q16. A teammate sends you a profile from a different binary than yours. The function names are garbage. Why?**
Symbols in a Go profile are resolved at write time via `runtime.FuncForPC`, so a Go profile is usually self-symbolized. If it is **not** (e.g., a foreign profile or cgo frames), pprof needs the original binary to symbolize, found via `PPROF_BINARY_PATH`. A mismatched binary gives wrong names because PCs do not correspond to the same functions.

---

## Common traps

- Importing `net/http/pprof` without the blank `_` — the import is dropped, handlers never register.
- Exposing `/debug/pprof/` on a public listener — instant DoS and info leak.
- Capturing for 1 second and expecting meaningful output — too few samples.
- Confusing `heap` (live) with `allocs` (total since start).
- Forgetting `defer pprof.StopCPUProfile()` — profile file is truncated/empty.
- Reading a flame graph as a timeline. The x-axis is sample count, not time order.
- Optimizing the wrong profile kind for the symptom (CPU work on a GC-bound program).
- Comparing profiles from different binaries with `-base` — symbol mismatch.
- Trusting a profile captured during program warm-up or under no load.
- Treating inlined hot functions as if they had their own frames in the flame graph.
- Forgetting to set `runtime.SetBlockProfileRate` before trying to read a `block` profile (it's off by default).
