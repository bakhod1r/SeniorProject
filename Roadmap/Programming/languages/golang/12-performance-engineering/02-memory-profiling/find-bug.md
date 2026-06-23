# Memory Profiling in Go — Find the Bug

A collection of realistic memory bugs, framed by what their profile looks like. For each: the profile signature, the symptom in production, the root cause, and the fix. Reading these in order trains the pattern matching you need to triage memory issues from a single pprof dump.

---

## Bug 1: The subslice that retains a 50 MiB file

```go
func header(path string) []byte {
    raw, _ := os.ReadFile(path)
    return raw[:100]
}
```

**Profile signature.** `pprof -inuse_space` shows `os.ReadFile` near the top with a large `inuse_space`, even though the program only "kept" 100-byte slices. Each call retains the entire backing array.

**Symptom.** RSS rises by ~50 MiB per call. `runtime.MemStats.HeapAlloc` climbs without bound.

**Cause.** A subslice shares the underlying array. The runtime can't free the array as long as any subslice references it. The 100-byte return value pins the full 50 MiB.

**Fix.**

```go
return slices.Clone(raw[:100])    // or copy into a fresh make([]byte, 100)
```

---

## Bug 2: The map that never shrinks

```go
var cache = make(map[string]*Entry)

func set(k string, v *Entry) { cache[k] = v }
func del(k string)           { delete(cache, k) }
```

**Profile signature.** `pprof -inuse_space` shows `runtime.makebucket` and `runtime.hashGrow` retaining bytes that don't correspond to current `len(cache)`. `inuse_objects` for the map's buckets stays high even after mass deletion.

**Symptom.** After a burst of inserts followed by deletes, `HeapInuse` stays large. The map's `len` is small; the backing buckets are not.

**Cause.** Go maps grow on inserts and **never shrink on deletes**. Once the bucket array reaches N entries' worth of capacity, it stays there.

**Fix.** Periodically rebuild the map:

```go
fresh := make(map[string]*Entry, len(cache))
for k, v := range cache { fresh[k] = v }
cache = fresh
```

Or use an explicit eviction-supporting cache (`ristretto`, `freecache`, `groupcache`).

---

## Bug 3: The leaked goroutine pinning a request

```go
func handle(req *Request) {
    out := make(chan Result, 0)
    go func() {
        out <- compute(req)    // sender blocks forever if no one reads
    }()
    select {
    case r := <-out:
        respond(r)
    case <-time.After(100 * time.Millisecond):
        respondTimeout()
    }
}
```

**Profile signature.** `runtime.NumGoroutine()` climbs monotonically. `/debug/pprof/goroutine?debug=2` shows N goroutines blocked on `out <-`. The heap profile shows growing `*Request` retention via the captured variable.

**Symptom.** Heap grows in proportion to goroutine count. Each leaked goroutine holds its `req` (and everything `req` reaches).

**Cause.** The `select` returns on timeout but doesn't drain `out`. The goroutine remains blocked on send.

**Fix.** Use a buffered channel of capacity 1, so the send always succeeds:

```go
out := make(chan Result, 1)
```

Or pass a context and have the goroutine check it before sending.

---

## Bug 4: The `defer` in a loop that holds files open

```go
func processAll(paths []string) {
    for _, p := range paths {
        f, _ := os.Open(p)
        defer f.Close()
        // ... process(f) ...
    }
}
```

**Profile signature.** `inuse_objects` shows N `*os.File` retained, where N = `len(paths)`. The flame graph's tallest stack ends at `os.Open`.

**Symptom.** File descriptors leak; `too many open files` after a few thousand. The associated `*os.File` structs (with their read buffers) all stay live.

**Cause.** `defer` runs at function exit, not at scope exit. None of the `Close` calls happen until `processAll` returns.

**Fix.** Wrap each iteration in an IIFE:

```go
for _, p := range paths {
    func() {
        f, _ := os.Open(p)
        defer f.Close()
        // ... process(f) ...
    }()
}
```

Or close explicitly at the end of the loop body.

---

## Bug 5: The closure pinning a heavy object

```go
var handlers []func()

for _, p := range bigPayloads {
    handlers = append(handlers, func() { send(p.ID) })
}
```

**Profile signature.** `pprof -inuse_space` shows large retention of `*Payload` objects. The closures themselves are tiny, but each holds a full `*Payload` via capture.

**Symptom.** Memory is N× larger than expected. After "discarding" the payloads (you think), they're still alive — pinned by the closures.

**Cause.** The closure captures `p`, not `p.ID`. The closure retains the whole struct until the closure is unreachable.

**Fix.** Capture only what's needed:

```go
for _, p := range bigPayloads {
    id := p.ID
    handlers = append(handlers, func() { send(id) })
}
```

---

## Bug 6: The interface boxing in a hot loop

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

func reportAll(items []Counter, log func(any)) {
    for _, c := range items {
        log(c)   // each call boxes c into interface{}
    }
}
```

**Profile signature.** `alloc_objects` shows `runtime.convT` or `runtime.convT16` near the top, allocating one small object per loop iteration.

**Symptom.** A function that should allocate nothing allocates millions of times. GC CPU climbs.

**Cause.** Passing `c` (a value) to `log(any)` boxes it. Each box is a fresh allocation.

**Fix.** Pass a pointer, which the interface can store directly:

```go
for i := range items {
    log(&items[i])
}
```

Or change `log` to a generic function (`func[T any](T)`), which avoids boxing entirely for concrete types.

---

## Bug 7: The `fmt.Sprintf` in the hot path

```go
func cacheKey(userID, productID int) string {
    return fmt.Sprintf("u%d/p%d", userID, productID)
}
```

**Profile signature.** `fmt.Sprintf`, `runtime.convT64`, `fmt.(*pp).doPrintf` appear at the top of `alloc_objects`.

**Symptom.** GC pressure in a request hot path that the team thought was "just a string concat".

**Cause.** `Sprintf` allocates the format args slice (`[]any{userID, productID}`), boxes each integer, allocates intermediate buffers, and allocates the result string. Six to eight allocations per call.

**Fix.**

```go
func cacheKey(userID, productID int) string {
    var b strings.Builder
    b.Grow(24)
    b.WriteByte('u')
    b.WriteString(strconv.Itoa(userID))
    b.WriteString("/p")
    b.WriteString(strconv.Itoa(productID))
    return b.String()
}
```

Now one allocation: the result string.

---

## Bug 8: The `time.After` that piles up timers

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

**Profile signature.** `time.NewTimer` and `runtime.startTimer` show growing `inuse_*`. Goroutine profile shows hidden runtime timer goroutines.

**Symptom.** When `ch` is busy, memory creeps. Pre-Go-1.23, the leak was unbounded.

**Cause.** Every iteration creates a fresh timer. If `ch` fires first, the timer object isn't collected until its deadline elapses.

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

Go 1.23+ fixed the unbounded leak, but the explicit reuse is still more efficient.

---

## Bug 9: The append in a loop without preallocation

```go
func merge(parts [][]int) []int {
    var out []int
    for _, p := range parts {
        out = append(out, p...)
    }
    return out
}
```

**Profile signature.** `runtime.growslice` dominates `alloc_space`. Total bytes allocated is roughly 2N — the geometric growth's cumulative copying.

**Symptom.** A function that should be a memcpy spends 30% of its time in `growslice`. GC pressure spikes during the call.

**Cause.** Each capacity doubling allocates a new backing array and copies. For large N, you do this ~log₂(N) times, with a total work proportional to N.

**Fix.**

```go
total := 0
for _, p := range parts { total += len(p) }
out := make([]int, 0, total)
for _, p := range parts {
    out = append(out, p...)
}
return out
```

One allocation, one copy per source slice.

---

## Bug 10: The pool with no Reset (correctness + memory)

```go
var pool = sync.Pool{New: func() any { return new(bytes.Buffer) }}

func render(req *Request) string {
    b := pool.Get().(*bytes.Buffer)
    defer pool.Put(b)
    fmt.Fprintf(b, "user=%s\n", req.User)
    return b.String()
}
```

**Profile signature.** `bytes.(*Buffer).grow` allocates progressively larger backing arrays. Output of `render` accumulates content from previous calls.

**Symptom.** Two bugs: stale content in output (data corruption), and pooled buffers growing without bound (memory).

**Cause.** `b` is reused without resetting. Each call appends to whatever was left from the previous use, so the buffer's length grows and growslice triggers.

**Fix.**

```go
defer func() {
    if b.Cap() < 64<<10 {
        b.Reset()
        pool.Put(b)
    }
}()
```

The cap check prevents one huge request from inflating every future pooled buffer indefinitely.

---

## Bug 11: The retained channel reference

```go
type Worker struct {
    in  chan Job
    out chan Result
    res []Result   // accumulates here
}

func (w *Worker) Run() {
    for j := range w.in {
        w.res = append(w.res, process(j))
    }
}
```

**Profile signature.** `pprof -inuse_space` shows `Worker.res` growing without bound. The flame graph leaf is `runtime.growslice` from `Worker.Run`.

**Symptom.** Each worker accumulates results forever, even after the consumer has read them.

**Cause.** Appending to `w.res` never frees old entries. The "consumer reading" was on a different field; `res` is a write-only log that nobody trims.

**Fix.** Either bound `res` with a ring buffer, or drain it explicitly:

```go
func (w *Worker) Drain() []Result {
    out := w.res
    w.res = nil          // or w.res[:0] if the slot is reused
    return out
}
```

---

## Bug 12: The `regexp.MustCompile` per request

```go
func validateEmail(s string) bool {
    return regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`).MatchString(s)
}
```

**Profile signature.** `regexp.Compile`, `regexp/syntax.Parse`, and friends appear in `alloc_space` with high counts.

**Symptom.** A trivial-looking validator allocates kilobytes per call. At 10k QPS, that's hundreds of MB of allocator churn.

**Cause.** Each call rebuilds the automaton.

**Fix.**

```go
var emailRe = regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)

func validateEmail(s string) bool {
    return emailRe.MatchString(s)
}
```

Compile once at package init.

---

## Bug 13: The "leak" that's just retained pages

```go
func ingest(path string) {
    raw, _ := os.ReadFile(path)   // 2 GiB
    process(raw)
    raw = nil
    runtime.GC()
}
// caller sees RSS stay at 2 GiB
```

**Profile signature.** `runtime.MemStats.HeapAlloc` is back to baseline. `pprof -inuse_space` total is small. But RSS is still 2 GiB.

**Symptom.** Operator thinks the program is leaking; the runtime numbers say it isn't.

**Cause.** On Linux, Go uses `MADV_FREE` by default. Pages are released back to the OS lazily — the kernel will reclaim them under pressure but reports them as RSS until then.

**Fix.** Either accept the cosmetic discrepancy, or:

```go
debug.FreeOSMemory()
```

forces an immediate sync to `MADV_DONTNEED`. Set `GODEBUG=madvdontneed=1` to make this the default. In containerized environments with `GOMEMLIMIT`, neither is usually necessary — the runtime accounts memory pressure itself.

---

## Bug 14: The profile that disagrees with `MemStats`

```
(pprof) top
Total: 800 MB

runtime.ReadMemStats says HeapAlloc = 80 MB
```

**Profile signature.** A 10× discrepancy between `pprof -inuse_space` total and `MemStats.HeapAlloc`.

**Symptom.** "pprof is lying!" — the most-asked Go memory question in office hours.

**Cause.** Almost always one of three things:

| Reason | Explanation |
|--------|-------------|
| You captured an `allocs` profile | `alloc_space` is cumulative, not live |
| `MemProfileRate` was lowered then raised | Old samples scaled at one rate, new at another |
| The profile was taken without `gc=1` | Includes garbage not yet swept |

**Fix.** For absolute heap size, trust `runtime.MemStats` or `runtime/metrics`. For the *distribution* of allocations across call sites, trust pprof. Don't expect them to match exactly; expect them to point in the same direction.

---

## Bug 15: The `MemProfileRate` set too late

```go
func main() {
    log.Println("starting")    // already allocates
    runtime.MemProfileRate = 1
    // ... heavy allocations ...
}
```

**Profile signature.** Allocations before `main` (init functions, log init) are missing from the profile, but allocations after appear. The numbers look "off" without an obvious reason.

**Symptom.** Microbenchmark results disagree with what you see when profiling a real binary.

**Cause.** `runtime.MemProfileRate` should be set in `init` (or via `go test -memprofilerate=1`) before any allocation. Setting it mid-run leaves earlier samples at the previous rate, which the scaler then mishandles.

**Fix.** Set it in the package's earliest `init`:

```go
func init() {
    runtime.MemProfileRate = 1
}
```

Or use the test flag instead of code.

---

## Bug 16: The goroutine profile that's right but misread

```
goroutine profile: 4523 goroutines
1234 @ runtime.gopark runtime.netpollblock ...
   net.(*conn).Read
   ...
```

**Profile signature.** Thousands of goroutines parked in `netpollblock`, going through `net.(*conn).Read`.

**Symptom.** Engineer concludes "goroutine leak in network code".

**Cause.** Usually not a leak. Long-poll handlers, idle keepalive connections, and gRPC streams all have goroutines parked in `netpollblock` — that's the *normal* state. A leak shows up as *growth*, not absolute number.

**Fix.** Compare snapshots over time, not absolute counts. If the count is rising during steady-state traffic, you have a leak. If it's flat at a high number, that's just the working set.

---

## 17. Summary

Most Go memory bugs fall into a small number of patterns: subslice retention, unbounded maps, leaked goroutines and timers, function-scoped `defer`, closure capture of heavy values, interface boxing, uncached regexes, and confusion between profile metrics. Each has a distinctive `pprof` signature you'll recognize on second sight. The remaining art is reading the profile carefully — which means capturing under load, diffing across time, and switching between `alloc_*` and `inuse_*` deliberately.

---

## Further reading
- 100 Go mistakes — memory chapter: https://100go.co
- The `pprof` reading guide: https://github.com/google/pprof/blob/main/doc/README.md
- Slice internals: https://go.dev/blog/slices-intro
- `runtime/pprof` source: https://github.com/golang/go/tree/master/src/runtime/pprof
