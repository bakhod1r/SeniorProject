# CPU Profiling in Go — Find the Bug

A collection of realistic CPU-bug scenarios. For each: the symptom (what the profile shows), the (subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose CPU issues in the wild.

---

## Bug 1: The regex compiled per request

```go
func validateEmail(s string) bool {
    re := regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)
    return re.MatchString(s)
}
```

**Symptom.** `pprof top` for an HTTP service shows `regexp/syntax.Parse` and `regexp.compile` consuming 40% of CPU.

**Cause.** `regexp.MustCompile` runs the regex parser and DFA builder every call. Match itself is fast; compile is not.

**Fix.**

```go
var emailRE = regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)

func validateEmail(s string) bool {
    return emailRE.MatchString(s)
}
```

Compile once at package init. CPU drops to ~1%.

---

## Bug 2: The `fmt.Sprintf` log key

```go
for _, item := range items {
    cacheKey := fmt.Sprintf("item:%d:user:%d", item.ID, userID)
    process(cacheKey, item)
}
```

**Symptom.** Profile shows `fmt.Sprintf`, `runtime.convT64`, and `fmt.(*pp).doPrintf` together at 25%.

**Cause.** Every `Sprintf` parses the format, boxes both ints into `interface{}` (allocating), and assembles a result string. In a tight loop it dominates.

**Fix.**

```go
buf := make([]byte, 0, 64)
for _, item := range items {
    buf = buf[:0]
    buf = append(buf, "item:"...)
    buf = strconv.AppendInt(buf, item.ID, 10)
    buf = append(buf, ":user:"...)
    buf = strconv.AppendInt(buf, userID, 10)
    process(string(buf), item)
}
```

Or use `strings.Builder`. The `strconv.Append*` family writes directly to a buffer with no allocation.

---

## Bug 3: The map iteration that costs N²

```go
func findDuplicates(items []string) []string {
    var dups []string
    for i, a := range items {
        for j, b := range items {
            if i != j && a == b {
                dups = append(dups, a)
            }
        }
    }
    return dups
}
```

**Symptom.** With 50,000 items, the function dominates CPU. Profile attributes time uniformly to the inner loop and `runtime.eqstring`.

**Cause.** O(N²) string comparisons. For 50,000 items that's 2.5 billion comparisons.

**Fix.**

```go
func findDuplicates(items []string) []string {
    seen := make(map[string]struct{}, len(items))
    out := make([]string, 0)
    for _, s := range items {
        if _, ok := seen[s]; ok {
            out = append(out, s)
        }
        seen[s] = struct{}{}
    }
    return out
}
```

O(N) with one hash per item. The profile flattens; the function disappears from `top`.

---

## Bug 4: The goroutine pool that doesn't actually pool

```go
func handleBatch(items []Item) {
    var wg sync.WaitGroup
    for _, item := range items {
        wg.Add(1)
        go func(it Item) {
            defer wg.Done()
            process(it)
        }(item)
    }
    wg.Wait()
}
```

**Symptom.** Under load, profile shows huge time in `runtime.schedule`, `runtime.findrunnable`, `runtime.newproc`. Many tens of thousands of goroutines exist at once.

**Cause.** Each batch spawns one goroutine per item. The scheduler does more work coordinating than the workers do computing.

**Fix.** Use a fixed worker pool.

```go
const workers = 16
jobs := make(chan Item, len(items))
var wg sync.WaitGroup
for i := 0; i < workers; i++ {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for it := range jobs {
            process(it)
        }
    }()
}
for _, it := range items {
    jobs <- it
}
close(jobs)
wg.Wait()
```

Scheduler overhead disappears from the profile.

---

## Bug 5: The lock-everything cache

```go
type Cache struct {
    mu sync.Mutex
    m  map[string]*Entry
}

func (c *Cache) Get(k string) *Entry {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.m[k]
}
```

**Symptom.** Mutex profile shows `Cache.Get` as #1 contended. CPU profile shows `sync.(*Mutex).Lock` and `runtime.futex` at 20–30%.

**Cause.** Single mutex serializes all reads. Under high read concurrency, threads spend most of their time queuing.

**Fix (read-heavy):** `sync.RWMutex` is a partial win; an atomic-pointer COW pattern is the real fix:

```go
type Cache struct {
    p atomic.Pointer[map[string]*Entry]
}

func (c *Cache) Get(k string) *Entry {
    return (*c.p.Load())[k]
}

func (c *Cache) Set(k string, e *Entry) {
    for {
        old := c.p.Load()
        next := make(map[string]*Entry, len(*old)+1)
        for kk, vv := range *old {
            next[kk] = vv
        }
        next[k] = e
        if c.p.CompareAndSwap(old, &next) {
            return
        }
    }
}
```

Reads become lock-free; writes pay a copy. Profile drops to <1% on the read path.

---

## Bug 6: The `time.Now()` storm

```go
func handler(w http.ResponseWriter, r *http.Request) {
    log.Printf("[%s] received %s", time.Now().Format(time.RFC3339Nano), r.URL.Path)
    log.Printf("[%s] started", time.Now().Format(time.RFC3339Nano))
    process(r)
    log.Printf("[%s] finished", time.Now().Format(time.RFC3339Nano))
}
```

**Symptom.** Profile shows `time.Now`, `time.Time.Format`, `time.appendInt` together at 5–8%.

**Cause.** Each `time.Now` is a `vdso_clock_gettime` (~25 ns on Linux); each `Format` is an allocating string build. Multiply by request rate.

**Fix.** Capture once per request; let the logger format.

```go
import "log/slog"

func handler(w http.ResponseWriter, r *http.Request) {
    slog.Info("received", "path", r.URL.Path)
    process(r)
    slog.Info("finished", "path", r.URL.Path)
}
```

`slog` defers the timestamp to the handler and skips work entirely if the level is filtered.

---

## Bug 7: The interface-bound hot loop

```go
type Adder interface{ Add(int) }
type Counter struct{ n int }
func (c *Counter) Add(x int) { c.n += x }

func sumLoop(a Adder, n int) {
    for i := 0; i < n; i++ {
        a.Add(1)
    }
}
```

**Symptom.** `sumLoop` dominates the profile, with significant time in `runtime.assertI2I` or interface call dispatch.

**Cause.** Each iteration dispatches through the interface table. The compiler cannot inline `Add` because the concrete type is unknown at call site.

**Fix.** Either accept the concrete type:

```go
func sumLoop(c *Counter, n int) {
    for i := 0; i < n; i++ {
        c.Add(1)
    }
}
```

Or use PGO (Go 1.20+). With a representative profile, the compiler devirtualizes hot interface calls automatically. Expected speedup: 5–15%.

---

## Bug 8: The mistaken "wall-time" interpretation

```go
// Profile shows 60s total CPU for a 10s benchmark
```

**Symptom.** "I ran the benchmark for 10 seconds but the profile says 60 seconds of CPU. Something is wrong."

**Cause.** Nothing is wrong. CPU time is per-thread. With GOMAXPROCS=8 and a fully saturated benchmark, 10 wall seconds = up to 80 CPU seconds. The 60s figure means an average of 6 cores saturated.

**Fix.** No fix; correct your mental model. To compare to wall time, divide by the number of cores actively used. To see wall-time per request, use `go tool trace` instead.

---

## Bug 9: The empty profile

```bash
$ go tool pprof http://localhost:6060/debug/pprof/profile?seconds=30
$ # Top shows only runtime.findrunnable, runtime.mcall
```

**Symptom.** The profile is dominated by scheduler idle functions; almost no application code appears.

**Cause.** The service is idle — no CPU was being spent during the capture window. The profiler only sees what's on CPU.

**Fix.** Generate load during the capture. For a real service, capture during peak hours. For a benchmark, ensure it's actually running (`go test -bench=. -benchtime=10s`). If the service is supposed to be busy but isn't, the bottleneck is upstream (waiting on I/O, locks, or sleeping) — look at block/mutex/trace profiles.

---

## Bug 10: The CGo overhead surprise

```go
func bulkProcess(items []C.struct_item) {
    for i := range items {
        C.process_one(&items[i])
    }
}
```

**Symptom.** Profile shows `runtime.cgocall`, `runtime.exitsyscall`, `runtime.entersyscall` together at 30%.

**Cause.** Each cgo call costs ~200 ns of Go ↔ C transition overhead (saving/restoring stack, swapping G state). With N small calls, transition cost dwarfs the actual work.

**Fix.** Batch the C call.

```go
func bulkProcess(items []C.struct_item) {
    C.process_batch((*C.struct_item)(unsafe.Pointer(&items[0])), C.size_t(len(items)))
}
```

One transition, many items processed. CPU drops dramatically.

---

## Bug 11: The benchmark that profiled the wrong code

```go
func BenchmarkParse(b *testing.B) {
    data := generateLargeInput()  // expensive setup
    for i := 0; i < b.N; i++ {
        parse(data)
    }
}
```

**Symptom.** Profile shows `generateLargeInput` as the hotspot. But you wanted to profile `parse`.

**Cause.** `b.N` is variable — the benchmark may run with `N=1`, in which case setup time dominates. Or setup runs once but contributes to the profile.

**Fix.** Use `b.ResetTimer` after setup.

```go
func BenchmarkParse(b *testing.B) {
    data := generateLargeInput()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        parse(data)
    }
}
```

Now the profile is for `parse` only.

---

## Bug 12: The "regression" that was just inlining

```
v1.5: hotPath - 30%
v1.6: hotPath - 5%
v1.6: parentFunc - 25% (was 1% in v1.5)
```

**Symptom.** A function that previously dominated the profile is now small, but its parent ballooned. Total CPU is unchanged.

**Cause.** A compiler upgrade or code change made `hotPath` inline into `parentFunc`. The work didn't move; the attribution did.

**Fix.** Confirm with `go build -gcflags='-m=2' | grep hotPath` — you'll see "inlining call to hotPath". To analyze the function as a separate frame:

```bash
go build -gcflags='all=-l' .   # disable all inlining
```

Or mark just one function:

```go
//go:noinline
func hotPath(...) {...}
```

Then re-profile. Remove the directive before shipping.

---

## Bug 13: The flame graph that lies about a leaf

```
runtime.mapaccess1_faststr — 18%
↑ business.LookupUser — 1%
```

**Symptom.** A leaf is hot; the only direct caller is barely visible. The fix shouldn't be in the leaf.

**Cause.** `mapaccess1_faststr` is called from many places via inlining and generic dispatch. The "1% caller" reflects only one path; the rest of the calls come from elsewhere.

**Fix.** Use the call graph (`web`) or `peek`:

```
(pprof) peek runtime.mapaccess1_faststr
```

This shows **all** callers weighted. The real owner might be a hot config lookup or a session map you didn't realize was on the path. Fix the heaviest caller — sometimes by caching the lookup, sometimes by switching from `map` to a `sync.Map`, sometimes by replacing the map entirely with a slice index.

---

## 14. Summary

CPU bugs in Go cluster into a few archetypes: repeated expensive setup (regex compile, time formatting), suboptimal algorithms (O(N²) loops, naive caches), contention (single mutex, channel storms), interface and reflection overhead, and misattribution (inlining, profile setup pollution, empty-profile idleness). Recognizing the profile *shape* — what's at the top, what's at the leaves, how cumulative time flows — is what turns each scenario from "mystery" into "obvious".

---

## Further reading
- pprof README: https://github.com/google/pprof/blob/main/doc/README.md
- "Profiling Go Programs" (Go blog): https://go.dev/blog/pprof
- High Performance Go workshop: https://dave.cheney.net/high-performance-go-workshop/
- "100 Go Mistakes" — performance chapter
