# Memory Management in Depth — Find the Bug

A collection of realistic memory-bug scenarios. For each: the symptom, the (subtle) cause, and the fix. Reading them in order builds the intuition you need to diagnose memory issues in the wild.

---

## Bug 1: The slice that wouldn't be garbage collected

```go
func loadConfig(path string) []byte {
    raw, _ := os.ReadFile(path)         // 50 MiB
    return raw[:100]                     // we only want the header
}
```

**Symptom.** Process RSS climbs forever. Every call to `loadConfig` permanently adds ~50 MiB to live heap.

**Cause.** The returned slice's `Data` pointer is still inside the 50 MiB backing array. The runtime cannot free the array as long as any subslice references it.

**Fix.**

```go
header := raw[:100]
out := make([]byte, len(header))
copy(out, header)
return out
```

Or in Go 1.21+:

```go
return slices.Clone(raw[:100])
```

---

## Bug 2: The goroutine that lives forever

```go
func process(ch <-chan Job) {
    for j := range ch {
        result := work(j)
        out <- result          // package-level channel
    }
}

// caller forgets to close ch; out has no consumer
```

**Symptom.** `runtime.NumGoroutine()` grows monotonically; total live heap grows proportionally.

**Cause.** Two leaks at once: (a) the goroutine blocks forever on `out <-`, (b) `j` (and anything it referenced) is pinned by the goroutine's stack.

**Fix.** Always pair `range ch` with a `done` channel or `context`:

```go
func process(ctx context.Context, ch <-chan Job) {
    for {
        select {
        case <-ctx.Done():
            return
        case j, ok := <-ch:
            if !ok {
                return
            }
            select {
            case out <- work(j):
            case <-ctx.Done():
                return
            }
        }
    }
}
```

---

## Bug 3: The map that never shrinks

```go
var sessions = make(map[string]*Session)

func login(id string)  { sessions[id] = newSession() }
func logout(id string) { delete(sessions, id) }
```

**Symptom.** After a long usage period, `HeapInuse` is much larger than what `len(sessions)` would suggest.

**Cause.** Go maps don't shrink their bucket array on `delete`. Once the map reaches N entries, it keeps the storage for at least N entries forever.

**Fix.** Periodically replace the map:

```go
func compact() {
    fresh := make(map[string]*Session, len(sessions))
    for k, v := range sessions {
        fresh[k] = v
    }
    sessions = fresh
}
```

Or design around it: a typed cache (`groupcache`, `ristretto`) with eviction.

---

## Bug 4: The time.After that never returns

```go
for {
    select {
    case msg := <-ch:
        handle(msg)
    case <-time.After(5 * time.Second):
        heartbeat()
    }
}
```

**Symptom.** Memory creeps when `ch` is busy.

**Cause.** Every iteration creates a new timer. If `ch` fires first, the timer is **not collected** until it triggers (5 s later). With a fast `ch`, you accumulate thousands of pending timers.

**Fix.** Reuse a single timer:

```go
t := time.NewTimer(5 * time.Second)
defer t.Stop()
for {
    if !t.Stop() {
        select { case <-t.C: default: }
    }
    t.Reset(5 * time.Second)

    select {
    case msg := <-ch:
        handle(msg)
    case <-t.C:
        heartbeat()
    }
}
```

(Or upgrade to Go 1.23+, where `time.After` and `Timer` no longer leak after `Stop`.)

---

## Bug 5: The interface conversion that allocates per call

```go
type logger interface { Log(string) }

func handle(l logger) {
    for _, line := range lines {
        l.Log(line)
    }
}

func main() {
    var stdoutLogger stdoutLogger
    for {
        handle(stdoutLogger)   // every call: value passed to iface{} → escape → heap allocation
    }
}
```

**Symptom.** `pprof -alloc_objects` shows millions of small allocations from `runtime.convT*`.

**Cause.** `stdoutLogger` is a value type. Each conversion to the interface boxes it into a new heap object.

**Fix.** Pass a pointer (boxes once per handle call) or capture the interface outside the loop:

```go
var l logger = &stdoutLogger{}    // boxed once
for {
    handle(l)
}
```

---

## Bug 6: The mistaken `defer` in a loop

```go
func processAll(files []string) {
    for _, f := range files {
        fp, _ := os.Open(f)
        defer fp.Close()
        process(fp)
    }
}
```

**Symptom.** Open files climb; eventually `too many open files`. Even after fixing FDs, memory shows N file structs and N read buffers retained.

**Cause.** `defer` is **function-scoped**, not block-scoped. None of the `fp.Close()` runs until `processAll` returns.

**Fix.**

```go
for _, f := range files {
    func() {
        fp, _ := os.Open(f)
        defer fp.Close()
        process(fp)
    }()
}
```

Or just `fp.Close()` at the end of the loop body explicitly.

---

## Bug 7: The finalizer cycle that never collects

```go
type A struct { b *B }
type B struct { a *A }

a := &A{}; b := &B{}
a.b = b; b.a = a

runtime.SetFinalizer(a, func(_ *A) { /* ... */ })
runtime.SetFinalizer(b, func(_ *B) { /* ... */ })
```

**Symptom.** `a` and `b` never get collected. `HeapAlloc` shows a steadily growing "uncollectable" residue.

**Cause.** The GC won't run a finalizer if doing so might run another finalizer on a still-reachable object. Cycles among finalizer-bearing objects are excluded from collection forever.

**Fix.** Break the cycle (e.g., `a.b` is a non-pointer key into a registry, not a direct pointer), or use `runtime.AddCleanup` (Go 1.24+), which has no resurrection semantics and tolerates the case.

---

## Bug 8: The huge slice `append` that re-allocates

```go
func merge(parts [][]int) []int {
    var out []int
    for _, p := range parts {
        out = append(out, p...)
    }
    return out
}
```

**Symptom.** Profile shows `runtime.growslice` taking 30% of CPU for what should be a memcpy.

**Cause.** Geometric growth means roughly log₂(N) reallocations and a total copy cost of ~2N. For large N, that's a lot of throwaway memory.

**Fix.** Pre-size:

```go
total := 0
for _, p := range parts {
    total += len(p)
}
out := make([]int, 0, total)
for _, p := range parts {
    out = append(out, p...)
}
return out
```

---

## Bug 9: The string→[]byte conversion in a hot loop

```go
func writeAll(w io.Writer, lines []string) {
    for _, l := range lines {
        w.Write([]byte(l))   // each conversion allocates and copies
    }
}
```

**Symptom.** `pprof -alloc_space` points at `runtime.stringtoslicebyte`.

**Cause.** `[]byte(s)` always copies. There's no way for the runtime to know nobody will mutate the bytes.

**Fix.** Use `io.WriteString` (which takes the `WriteString` fast path on writers that implement it) or a `*strings.Reader`:

```go
io.WriteString(w, l)
```

For read-only access with very high allocation pressure (and full review), `unsafe.StringData` (Go 1.20+) lets you alias without copy.

---

## Bug 10: The forgotten `Reset` in a pooled buffer

```go
var pool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func render(req *Request) string {
    b := pool.Get().(*bytes.Buffer)
    defer pool.Put(b)
    fmt.Fprintf(b, "user=%s\n", req.User)
    return b.String()
}
```

**Symptom.** Output gradually accumulates content from previous requests (correctness bug), and pooled buffers grow indefinitely (memory bug).

**Cause.** `b` is reused without resetting.

**Fix.**

```go
defer func() {
    if b.Cap() < 64<<10 {
        b.Reset()
        pool.Put(b)
    }
}()
```

The cap check prevents one giant request from inflating every future pooled buffer.

---

## Bug 11: The closure that captures the loop variable

```go
var results []func() int

for i := 0; i < 1000; i++ {
    obj := loadHeavyObject(i)
    results = append(results, func() int { return obj.Score() })
}
```

**Symptom.** RSS is way higher than expected. You expected the heavy objects to be freed once `loadHeavyObject` returns.

**Cause.** Each closure captures its own `obj`, which keeps the heavy object alive as long as the closure exists. (Pre-1.22 there was the extra bug of capturing the loop variable; that's fixed, but the captured `obj` is still pinned.)

**Fix.** If you don't need the full object, capture only what you need:

```go
score := obj.Score()
results = append(results, func() int { return score })
```

Or restructure so the closures don't outlive their objects.

---

## Bug 12: The "infinite" pprof heap profile

```bash
go tool pprof http://localhost:6060/debug/pprof/heap
(pprof) top
Showing nodes accounting for 250MB, 100% of 250MB total
      flat  flat%   sum%        cum   cum%
   250MB   100%   100%      250MB   100%  main.makeBigSlice
```

But `runtime.MemStats.HeapAlloc` says you're at 50 MiB.

**Symptom.** Profile says 250 MiB; runtime says 50 MiB. Which is right?

**Cause.** By default, `pprof` heap profile shows `inuse_space` *sampled* allocations. `runtime.MemProfileRate` defaults to 512 KiB; smaller allocations are sampled, not measured. The profile is statistically scaled — it can disagree with the exact live heap.

**Fix.** Trust `runtime.MemStats` for absolute numbers; trust `pprof` for the *shape* of allocations. For more precise profiles set `runtime.MemProfileRate = 1` in tests (don't do this in production — every alloc is recorded).

---

## Bug 13: The mysterious "RSS not dropping" after a one-shot job

```go
func ingest() {
    data := loadEverything()   // 4 GiB
    process(data)
    data = nil
    runtime.GC()
}
```

**Symptom.** After `ingest` returns, RSS stays at 4 GiB even though `runtime.MemStats.HeapAlloc` is back to baseline.

**Cause.** `runtime.GC()` reclaims memory; returning it to the OS is separate and happens lazily (on Linux, via `MADV_FREE`). The kernel will reclaim under pressure but reports RSS unchanged otherwise.

**Fix.**

```go
debug.FreeOSMemory()
```

Or set `GODEBUG=madvdontneed=1` to force `MADV_DONTNEED`. In container environments with `GOMEMLIMIT`, neither is usually needed: the runtime accounts memory pressure itself.

---

## 14. Summary

Memory bugs in Go fall into a few archetypes: retained references (slices, closures, finalizer cycles), unbounded growth (maps, pools, goroutines without exits), wasted allocations (boxing, copying, repeated regex compilation), and reporting artifacts (RSS vs. heap, sampled profiles). Each scenario above is a real one engineers hit; recognizing them quickly is most of memory debugging.

---

## Further reading
- `pprof` reading guide: https://github.com/google/pprof/blob/main/doc/README.md
- Common Go mistakes: https://100go.co
- Slice gotchas: https://go.dev/blog/slices-intro
