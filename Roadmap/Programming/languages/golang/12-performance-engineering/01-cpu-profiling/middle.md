# CPU Profiling in Go — Middle

## 1. The everyday workflow

A working engineer's CPU profiling loop has five steps. Memorize this shape; everything else is detail.

1. **Reproduce** the workload that exhibits the problem (benchmark, load generator, replay).
2. **Capture** a CPU profile while that workload runs.
3. **Read** the profile top-down: `top`, then `list` the worst function, then `web` for context.
4. **Hypothesize** a fix and apply it.
5. **Re-capture** and compare with `-base` or `benchstat`.

Skipping step 1 or step 5 is the most common mistake. Without reproducible load, you're profiling noise. Without a before/after comparison, you're guessing.

---

## 2. Capturing profiles in code

Three ways, depending on context:

**From `main`:**

```go
import "runtime/pprof"
import "os"

func main() {
    f, _ := os.Create("cpu.pprof")
    defer f.Close()
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()

    runBatch()
}
```

**From a test or benchmark:**

```bash
go test -bench=. -cpuprofile=cpu.out -run=^$
```

The `-run=^$` skips ordinary tests so only benchmarks run. Critical: without it, `Test*` functions also execute and pollute the profile.

**From a running service:**

```bash
curl -o cpu.pprof http://localhost:6060/debug/pprof/profile?seconds=30
```

Always specify `seconds`. The default is 30, but be explicit so the next engineer reading your scripts knows.

---

## 3. Pprof interactive commands you'll actually use

```
(pprof) top                # top 10 by flat
(pprof) top 20             # top 20
(pprof) top -cum           # sort by cumulative
(pprof) list parseToken    # source view of any function matching /parseToken/
(pprof) web                # SVG call graph
(pprof) peek encoding/json # what calls it, what it calls
(pprof) tree               # indented caller/callee tree
(pprof) traces             # raw sample stacks (verbose; useful with -focus)
(pprof) disasm parseToken  # assembly with sample weights
(pprof) help               # full list
```

`top` is the entry point. `list` confirms. `web` or `-http` provides the context. Almost every profile session is exactly those three in that order.

---

## 4. The web UI

```bash
go tool pprof -http=:8080 cpu.pprof
```

The browser opens five tabs:

| View | Use |
|------|-----|
| **Top** | Sorted table of flat/cum time |
| **Graph** | The Graphviz call graph |
| **Flame Graph** | Stack-up: width = CPU, depth = call depth |
| **Peek** | One function's callers and callees |
| **Source** | Source listing for any function |

The flame graph is the single most efficient view. Wide boxes are expensive; tall stacks are deep call chains. Read it left-to-right (call order is **not** preserved — width is everything).

There's also an "Inverted flame graph" (icicle) which groups by leaf: useful when one helper is called from many places.

---

## 5. Reading flat vs cumulative correctly

```
      flat  flat%   sum%        cum   cum%
     1.85s 30.83%  30.83%      1.85s 30.83%  runtime.memmove
     1.20s 20.00%  50.83%      1.20s 20.00%  encoding/json.(*decodeState).literalStore
     0.00s     0% 50.83%      4.80s 80.00%  net/http.HandlerFunc.ServeHTTP
```

- `runtime.memmove`: high flat, leaf — copying is genuinely expensive. Look at who calls it.
- `json.literalStore`: high flat — actual JSON parsing work.
- `HandlerFunc.ServeHTTP`: zero flat, high cum — it's just a wrapper. Ignore.

Ask of every entry: **does this function do work, or just call work?** Only the first answer is interesting.

---

## 6. Following the call chain

After `top` finds `runtime.memmove`, you want to know who calls it. `peek` works:

```
(pprof) peek runtime.memmove
   1.85s   100%  100%      1.85s   100%  runtime.memmove
                              1.20s 64.86% |   encoding/json.(*decodeState).literalStore
                              0.65s 35.14% |   bytes.(*Buffer).Write
```

Or `web` / the graph view shows arrows weighted by sample count.

A pattern you'll see often: many small callers of a generic helper (`memmove`, `mallocgc`, `mapaccess1`). The fix is usually at the caller, not the helper.

---

## 7. Filtering the noise

```
(pprof) -ignore=runtime\.findrunnable|runtime\.mcall
(pprof) -focus=mypackage
```

- `findrunnable` is the scheduler idling — strip it if you only care about real work.
- `-focus` restricts to samples that pass through a matching function. Useful when one subsystem is what you care about.

Run-time filters:

```bash
go tool pprof -focus=encoding/json -nodecount=20 cpu.pprof
```

---

## 8. Comparing two profiles

This is the single most powerful technique for verifying an optimization.

```bash
go tool pprof -http=:8080 -base=before.pprof after.pprof
```

The graph now shows **deltas**. Functions that got faster are green; functions that got slower are red. If your fix worked, the function you targeted is bright green, and nothing else moved noticeably.

For benchmarks the equivalent is `benchstat`:

```bash
go test -bench=. -cpuprofile=before.pprof -run=^$ -count=10 > before.txt
# ... make changes ...
go test -bench=. -cpuprofile=after.pprof  -run=^$ -count=10 > after.txt
benchstat before.txt after.txt
```

`benchstat` does the statistical test for you — it tells you whether the change is significant given variance.

---

## 9. Common patterns you'll find

| Hotspot shape | Usual cause | First fix to try |
|---------------|-------------|------------------|
| `regexp.(*Regexp).doMatch` heavy | Recompiling regex each call | `var re = regexp.MustCompile(...)` at package init |
| `fmt.Sprintf` / `runtime.convT*` heavy | Boxing into `interface{}` for formatting | Hand-built string concat or `strconv` |
| `runtime.mallocgc` heavy | Lots of small allocations | Preallocate, pool, value receivers |
| `runtime.mapaccess2_faststr` heavy | Map keyed by string with many lookups | Cache the lookup, or switch to a slice index |
| `runtime.memmove` from `append` | Slice growing geometrically | Pre-size with `make([]T, 0, expected)` |
| `runtime.gcBgMarkWorker` heavy | Allocation rate high → GC saturating | Reduce allocations (see heap profile) |
| `syscall.Syscall6` heavy | Many small reads/writes | Larger buffers, batched I/O |
| `sync.(*Mutex).Lock` heavy | Lock contention | Sharding, RWMutex, lock-free structure |

Each of these has a "default move". You won't always be right on the first try, but the move is cheap to test.

---

## 10. CPU profile vs other profiles

| Profile | What it shows | Capture endpoint |
|---------|---------------|------------------|
| CPU | On-CPU time per function | `/debug/pprof/profile?seconds=N` |
| Heap (in-use) | Allocated but not yet freed bytes | `/debug/pprof/heap` |
| Allocs | Cumulative allocation count/bytes since start | `/debug/pprof/allocs` |
| Goroutine | Goroutine stacks (instant snapshot) | `/debug/pprof/goroutine` |
| Block | Goroutines blocked on sync primitives | `/debug/pprof/block` |
| Mutex | Contention on mutexes | `/debug/pprof/mutex` |
| Trace | Execution timeline (not pprof; `go tool trace`) | `/debug/pprof/trace?seconds=N` |

When your CPU profile is *empty* (mostly `runtime.findrunnable`), your program is waiting, not working. Switch to the block / mutex / trace profiles. CPU profile only catches on-CPU work.

---

## 11. Sampling rate in practice

100 Hz is right for almost everything. Two cases to deviate:

- **Microbenchmarks < 1 s.** Bump to `runtime.SetCPUProfileRate(500)` so you don't get 12 samples total.
- **Long production captures.** Stay at 100 Hz; the overhead is fine, and you'll have plenty of samples.

```go
import "runtime"

func init() {
    runtime.SetCPUProfileRate(500) // tests only — never in prod without measuring
}
```

You cannot change the rate while a profile is active. Set it before `StartCPUProfile`.

---

## 12. Tagging samples with labels

When one service handles many request types and you want to know "how much CPU does the `/api/search` endpoint use?":

```go
import (
    "context"
    "runtime/pprof"
)

func handleSearch(w http.ResponseWriter, r *http.Request) {
    ctx := r.Context()
    labels := pprof.Labels("endpoint", "/api/search", "method", r.Method)
    pprof.Do(ctx, labels, func(ctx context.Context) {
        doSearch(ctx, w, r)
    })
}
```

Then in pprof:

```
(pprof) tags endpoint
(pprof) -tagfocus=endpoint=/api/search
```

Now the profile shows only samples that ran under that label. Indispensable for multi-tenant services.

---

## 13. A real worked example

```bash
$ go test -bench=BenchmarkParse -cpuprofile=cpu.pprof -run=^$
$ go tool pprof -http=:8080 cpu.pprof
```

Top reveals:

```
3.20s  40%  encoding/json.(*decodeState).literalStore
1.10s  14%  runtime.mallocgc
0.80s  10%  runtime.mapassign_faststr
```

We expected JSON parsing to be heavy, but 14% allocation is suspicious. Open the heap profile:

```bash
go tool pprof -alloc_space http://localhost:6060/debug/pprof/allocs
```

Top of allocs shows the same `literalStore` calling `mallocgc` for every string field. The fix is to decode into a typed struct, not a `map[string]interface{}`. After the change:

- CPU: 3.20s → 1.10s
- `runtime.mallocgc`: 14% → 3%

That's a real session.

---

## 14. Summary

The middle-level CPU profiling loop is: reproduce, capture (`-cpuprofile` or `/debug/pprof/profile`), open with `pprof -http=:8080`, sort by flat, drill into hot functions with `list`, hypothesize a fix, capture again, diff with `-base`. Master `top`, `list`, `web`, `-focus`, `-base`, and the flame graph view, and you can solve most performance problems before reaching for more exotic tools.

---

## Further reading
- "Profiling Go Programs" (Go blog): https://go.dev/blog/pprof
- pprof user docs: https://github.com/google/pprof/blob/main/doc/README.md
- Brendan Gregg on flame graphs: https://www.brendangregg.com/flamegraphs.html
- `benchstat`: https://pkg.go.dev/golang.org/x/perf/cmd/benchstat
