# pprof Deep Dive — Junior

## 1. What pprof is, in one sentence

`pprof` is a sampling profiler reader: it loads a `.pb.gz` profile file (produced by your Go program) and lets you ask questions like "where did this run spend its CPU?", "what's allocating the most memory?", "which goroutines are stuck?".

The program produces the data. `go tool pprof` interprets it. The two halves are independent, which is why the same tool reads CPU, heap, goroutine, and custom profiles.

---

## 2. Your first profile

The fastest way to get a profile out of any HTTP service is to import the pprof handlers and hit them.

```go
package main

import (
    "log"
    "net/http"
    _ "net/http/pprof"   // registers /debug/pprof/* on http.DefaultServeMux
)

func main() {
    go func() {
        log.Println(http.ListenAndServe("localhost:6060", nil))
    }()

    // ... your real work ...
    work()
}
```

In a second terminal:

```
go tool pprof http://localhost:6060/debug/pprof/profile?seconds=10
```

This collects a **10-second CPU profile** and drops you into the `pprof` shell.

---

## 3. The first three commands you need

Inside the shell:

```
(pprof) top
Showing nodes accounting for 4.30s, 87.06% of 4.94s total
      flat  flat%   sum%        cum   cum%
     1.20s 24.29% 24.29%      1.20s 24.29%  runtime.mallocgc
     0.80s 16.19% 40.49%      2.10s 42.51%  main.parseLine
     0.60s 12.15% 52.63%      0.60s 12.15%  runtime.memmove
     ...
```

Read the columns:

- **flat** — time spent *inside* this function, not counting its callees.
- **cum** — time spent in this function *plus* anything it called.
- **flat%** / **cum%** — same numbers, as a percentage of the total.

`top -cum` re-sorts by `cum`. Use `flat` to find hotspots in leaf code; use `cum` to find expensive subtrees.

```
(pprof) list parseLine
Total: 4.94s
ROUTINE ======================== main.parseLine in /home/me/app/parse.go
     800ms      2.10s (flat, cum) 42.51% of Total
         .          .     12:func parseLine(s string) (Record, error) {
      90ms       90ms     13:    parts := strings.Split(s, ",")
     700ms      1.30s     14:    for _, p := range parts {
```

`list <regex>` shows the source with per-line cost. This is the single most useful command.

```
(pprof) web
```

`web` renders a call graph and opens it in your browser. You need `graphviz` installed (`brew install graphviz` or `apt install graphviz`).

---

## 4. The web UI

For most people, the better starting point is the built-in web UI:

```
go tool pprof -http=:8080 http://localhost:6060/debug/pprof/profile?seconds=10
```

A browser tab opens with a flame graph. Each box is a function; width = share of total CPU. Click a box to zoom in. Use the "View" menu in the top-left to switch between:

- **Top** — same as the shell `top`, but searchable.
- **Graph** — the call graph from `web`, but interactive.
- **Flame Graph** — the icicle view (root at top).
- **Source** — annotated source for whatever you clicked.
- **Peek** — callers and callees of a single function.

You can leave the shell entirely if `-http` does what you need.

---

## 5. The profile types you will use first

| Question | Endpoint | Default unit |
|----------|----------|--------------|
| Why is the CPU pegged? | `/debug/pprof/profile?seconds=30` | nanoseconds CPU |
| What's holding memory? | `/debug/pprof/heap` | bytes (in use) |
| Why are there 5000 goroutines? | `/debug/pprof/goroutine` | count |
| What allocates the most? | `/debug/pprof/allocs` | bytes (cumulative) |

Quick recipes:

```
# CPU
go tool pprof -http=: http://localhost:6060/debug/pprof/profile?seconds=30

# Live heap
go tool pprof -http=: http://localhost:6060/debug/pprof/heap

# Goroutines (text form is often enough)
curl -s http://localhost:6060/debug/pprof/goroutine?debug=2 | less
```

`?debug=2` on goroutine and heap gives a **human-readable text** dump instead of a binary profile — useful when you just want to see stacks.

---

## 6. Saving and re-opening profiles

A common mistake is collecting a profile, exploring it, then losing it. Always save:

```
curl -o cpu.pb.gz http://localhost:6060/debug/pprof/profile?seconds=30
go tool pprof -http=: cpu.pb.gz
```

Now you can re-open the same file later, share it with a colleague, or commit it to a debugging issue. Profiles are self-contained: they embed the function names and (with default Go builds) enough symbol info to render without the original binary.

If you stripped symbols (`-ldflags="-s -w"`), keep the binary too and supply it:

```
go tool pprof -http=: ./myserver cpu.pb.gz
```

---

## 7. Files instead of HTTP

You don't need an HTTP server. From inside your program:

```go
package main

import (
    "os"
    "runtime/pprof"
)

func main() {
    f, _ := os.Create("cpu.pb.gz")
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()

    work()
}
```

Then:

```
go tool pprof -http=: cpu.pb.gz
```

Heap profiles are even easier — they're a snapshot, not a duration:

```go
f, _ := os.Create("heap.pb.gz")
pprof.Lookup("heap").WriteTo(f, 0)
```

For benchmarks, the test framework will produce profiles automatically:

```
go test -cpuprofile=cpu.pb.gz -memprofile=mem.pb.gz -bench=.
```

---

## 8. Reading a CPU profile, the first time

When you load a real CPU profile, the top of the list is rarely your code. Expect to see:

- `runtime.mallocgc` — allocation. The fix is to allocate less, not to "optimize malloc".
- `runtime.gcDrain`, `runtime.gcBgMarkWorker` — the GC running. High here means high allocation rate.
- `syscall.Syscall`, `runtime.netpollWait` — I/O. Often unavoidable.
- `runtime.memmove` — copies. Slice append, string concatenation, struct value pass.

Your code shows up further down. Use `-cum` to see which of *your* functions transitively drive the runtime cost:

```
(pprof) top -cum 20
```

Look for your top function, then `list` it.

---

## 9. Reading a heap profile, the first time

```
go tool pprof -http=: http://localhost:6060/debug/pprof/heap
```

The default view is **`inuse_space`** — bytes currently held by the heap. That's what you usually want.

In the "Sample" menu (top-right), switch between:

- `inuse_space` — live bytes (steady-state size).
- `inuse_objects` — live object count (struct churn).
- `alloc_space` — total bytes allocated since program start (allocation rate).
- `alloc_objects` — total objects allocated since start.

The two pairs answer different questions:

- "Why is my RSS 8 GiB?" → `inuse_space`.
- "Why is my GC burning 30% CPU?" → `alloc_space` or `alloc_objects`.

A function can be invisible in `inuse_space` (it allocates and frees immediately) but dominate `alloc_objects`. Switching the sample index is non-negotiable.

---

## 10. The smallest useful workflow

```
1. Reproduce a problem (slow endpoint, high RSS, climbing goroutines).
2. Collect the matching profile (cpu / heap / goroutine).
3. go tool pprof -http=:8080 <profile>
4. Flame graph → find the widest box that's your code.
5. Click → Source view → read the hot lines.
6. Form a hypothesis. Change one thing.
7. Re-collect. Diff with -base=old.pb.gz new.pb.gz.
```

Don't skip step 7. The whole point of profiling is to *measure* the change, not just convince yourself it was a win.

---

## 11. Common beginner mistakes

| Mistake | Why it fails |
|---------|--------------|
| Profiling for 1 second on a quiet service | Almost no samples; the profile is noise |
| Reading `alloc_space` to debug RSS | Allocation rate ≠ memory held |
| Optimizing `runtime.mallocgc` itself | You can't; reduce allocations instead |
| Forgetting `?seconds=N` | Default is 30 s — fine, but be sure your workload covers it |
| Looking only at `flat`, never `cum` | Misses subtree problems |
| Importing `net/http/pprof` into your public listener | Exposes source-level info; bind localhost only |

---

## 12. Two flags worth remembering

- `-seconds=N` — duration when fetching a duration-based profile.
- `-output=path` — save the fetched profile to a file (no implicit shell):

```
go tool pprof -seconds=60 -output=cpu.pb.gz http://localhost:6060/debug/pprof/profile
```

Useful in scripts and post-mortems.

---

## 13. Summary

`pprof` reads a sampled profile and lets you ask "where did the time/memory go?". The minimum viable workflow is: import `net/http/pprof`, hit `/debug/pprof/<kind>`, run `go tool pprof -http=:`, find the widest box that's yours, click to source. Save profiles to disk so you can diff them against a fix. Switch `sample_index` to match the question you're asking. Everything else in this directory is depth on top of these basics.

---

## Further reading
- `pprof` README: https://github.com/google/pprof/blob/main/doc/README.md
- Profiling Go programs: https://go.dev/blog/pprof
- `net/http/pprof`: https://pkg.go.dev/net/http/pprof
