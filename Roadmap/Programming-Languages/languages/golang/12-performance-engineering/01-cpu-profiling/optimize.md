# CPU Profiling in Go — Optimization Patterns

A profile is only the diagnosis. This document is the prescription: a catalog of the optimizations you'll apply, the profile shapes that justify each, and the expected speedup. Apply only what the profile points at — premature optimization is rooting around without a map.

---

## 1. The optimization mindset

Three rules, applied in order:

1. **Measure first.** Without a profile, you don't know what's slow.
2. **Optimize what dominates.** A 50% speedup on a function that's 2% of CPU is a 1% win.
3. **Measure again.** Compare with `-base` or `benchstat`. Confirm the fix did what you think.

Skipping any of the three turns optimization into folklore. The cycle takes 15 minutes; do it 50 times in a year and you ship a substantially faster service.

---

## 2. Compile regexes once

**Profile sign:** `regexp.(*Regexp).doMatch`, `regexp.Compile`, `regexp/syntax.Parse` all hot.

```go
// Slow: compiles every call
func isEmail(s string) bool {
    re := regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)
    return re.MatchString(s)
}

// Fast: compile once at package init
var emailRE = regexp.MustCompile(`^[^@]+@[^@]+\.[^@]+$`)

func isEmail(s string) bool {
    return emailRE.MatchString(s)
}
```

Regex compilation can be 1000× slower than matching. Typical speedup: **10–100×** on hot validators.

If the regex is simple, replace it with `strings.Contains`, `strings.HasPrefix`, or hand-written parsing — usually another 5–10× on top.

---

## 3. Pre-size slices and maps

**Profile sign:** `runtime.growslice`, `runtime.mapassign_*` heavy.

```go
// Slow: 0 → 1 → 2 → 4 → 8 → 16 → ... → N (log₂N copies)
var out []int
for _, v := range src {
    out = append(out, transform(v))
}

// Fast: one allocation
out := make([]int, 0, len(src))
for _, v := range src {
    out = append(out, transform(v))
}
```

Same for maps: `make(map[string]int, len(src))`. Typical speedup: **20–40%** on the function that allocates.

---

## 4. Avoid `fmt` in hot paths

**Profile sign:** `fmt.Sprintf`, `fmt.Fprintf`, `runtime.convT*` (interface boxing).

```go
// Slow
key := fmt.Sprintf("user:%d:session:%s", userID, sessionID)

// Fast
var sb strings.Builder
sb.WriteString("user:")
sb.WriteString(strconv.FormatInt(userID, 10))
sb.WriteString(":session:")
sb.WriteString(sessionID)
key := sb.String()
```

Or for fixed shapes:

```go
key := "user:" + strconv.FormatInt(userID, 10) + ":session:" + sessionID
```

`fmt.Sprintf` has to parse the format, box each argument into `interface{}`, and dispatch through a reflection-driven loop. Typical speedup: **3–10×** for short format strings.

For logging, prefer structured loggers (`slog`, `zap`, `zerolog`) that avoid interface conversion at call sites.

---

## 5. Replace map lookups with slice indices

**Profile sign:** `runtime.mapaccess1_*`, `runtime.mapaccess2_*` taking >5% of CPU.

```go
// Slow: hash + bucket walk every lookup
state := map[string]int{"start": 0, "mid": 1, "end": 2}

// Fast: enum + slice
type State int
const (StateStart State = iota; StateMid; StateEnd)
weights := [3]int{0, 1, 2}
```

A map lookup is ~30 ns; a slice index is ~1 ns. Typical speedup: **20–30×** for the lookup itself.

Tradeoff: you lose dynamic keys. Apply only where the key set is fixed and small.

---

## 6. Reduce interface allocations

**Profile sign:** `runtime.convT16`, `runtime.convTslice`, `runtime.convT64` heavy.

Each conversion of a non-pointer value into an `interface{}` allocates. In hot loops:

```go
// Slow: each call allocates a new interface{} for n
func log(n int) { logger.Println(n) }

// Fast: log directly with a typed call, or accept the interface once
type IntLogger interface{ LogInt(int) }
```

Or pass pointers:

```go
// Slow: value boxed each call
var v Value
process(v) // process takes interface{}

// Fast: pointer is one word, no copy into iface struct
process(&v)
```

Typical speedup: depends entirely on call frequency. For million-calls-per-second loops, **2–5×**.

---

## 7. Cache cgo and reflection calls

**Profile sign:** `runtime.cgocall`, `reflect.Value.MethodByName`, `reflect.Type.FieldByName`.

```go
// Slow: looks up the field by name every call
v := reflect.ValueOf(obj).FieldByName("Score")

// Fast: cache the StructField at init
type scoreAccessor struct { idx int }
var scoreField scoreAccessor
func init() {
    t := reflect.TypeOf(Foo{})
    f, _ := t.FieldByName("Score")
    scoreField.idx = f.Index[0]
}

func getScore(obj Foo) int {
    return reflect.ValueOf(obj).Field(scoreField.idx).Int()
}
```

`FieldByName` is a linear search of struct fields plus string comparison. `Field(i)` is O(1). Typical speedup: **5–20×** depending on struct width.

For cgo: batch calls. Each crossing of the Go/C boundary costs ~200 ns of overhead. One call doing 1000 operations beats 1000 calls doing one operation.

---

## 8. Avoid copying in hot kernels

**Profile sign:** `runtime.memmove`, `runtime.duffcopy` heavy.

```go
// Slow: copies the whole struct on every call
func process(p Point) Point { ... }

// Fast: pass by pointer
func process(p *Point) { ... }
```

For very small structs (≤16 bytes), the value version may be just as fast due to register passing. Benchmark — there's no universal rule. Above 32 bytes, pointer-pass almost always wins.

For slice copies, prefer in-place ops:

```go
// Slow: allocates and copies
sorted := append([]int(nil), src...)
sort.Ints(sorted)

// Fast: sort in place, copy only if you must preserve src
sort.Ints(src)
```

---

## 9. Concurrent-friendly hot paths

**Profile sign:** `sync.(*Mutex).Lock`, `sync.(*RWMutex).Lock`, `runtime.futex` heavy. Cross-reference with the mutex profile.

```go
// Slow: every read locks
var mu sync.Mutex
var data map[string]int
func get(k string) int {
    mu.Lock(); defer mu.Unlock()
    return data[k]
}

// Fast: atomic pointer to immutable map
var data atomic.Pointer[map[string]int]
func get(k string) int {
    return (*data.Load())[k]
}
func update(newData map[string]int) {
    data.Store(&newData)   // copy-on-write
}
```

When the map is read-heavy and write-rare, the COW pattern eliminates lock contention entirely. Typical speedup under contention: **10–100×** on the lock.

For finer-grained: `sync.RWMutex` (small win), `sync.Map` (specialized), shard by hash (large win at the cost of code complexity).

---

## 10. Replace channels with simpler primitives

**Profile sign:** `runtime.chansend`, `runtime.chanrecv`, `runtime.send` heavy.

Channels are not free. Each operation involves a lock, a wakeup, and goroutine bookkeeping.

```go
// Slow: a goroutine + channel for one-shot result
ch := make(chan Result, 1)
go func() { ch <- compute() }()
result := <-ch

// Fast: just compute synchronously (or use sync.WaitGroup, sync.Once)
result := compute()
```

For fan-out: a fixed worker pool draining one input channel is typically 5–10× faster than spawning per-task goroutines.

For coordination: `sync.Mutex` + condition variable is often faster than `select` over multiple channels when the channels are unbuffered.

---

## 11. Cache expensive computations

**Profile sign:** the same function called many times with the same arguments, dominating CPU.

```go
// Slow: recomputes parse tree per request
func handle(query string) {
    tree := parse(query)
    eval(tree)
}

// Fast: cache by query string
var queryCache sync.Map // map[string]*Tree

func handle(query string) {
    var tree *Tree
    if v, ok := queryCache.Load(query); ok {
        tree = v.(*Tree)
    } else {
        tree = parse(query)
        queryCache.Store(query, tree)
    }
    eval(tree)
}
```

Caveats: the cache itself becomes a hotspot if `sync.Map` is the wrong fit (write-heavy workloads), and unbounded caches leak memory. For bounded LRU caches, use `groupcache`, `ristretto`, or `bigcache`.

---

## 12. Inline hot small functions

**Profile sign:** A small leaf function appears widely, called many times.

```go
//go:noinline   // remove this for the optimized build
func isUpper(c byte) bool { return c >= 'A' && c <= 'Z' }
```

The Go compiler inlines aggressively, but you can hint with `//go:inline` (1.21+) or by making the function smaller (the cost budget is 80 nodes by default).

For the reverse direction — *de-inlining for profile clarity* — use `//go:noinline` *during analysis only*, then remove.

PGO (Go 1.20+) adjusts the inlining budget based on profile data. Build with `-pgo=auto` and confirm the previously-not-inlined hot function is now inlined: `go build -gcflags='-m=2'`.

---

## 13. Algorithmic wins

The biggest CPU wins are not micro-optimizations — they are algorithmic.

| Old | New | Typical speedup |
|-----|-----|-----------------|
| Linear scan over sorted slice | Binary search (`sort.Search`) | O(N) → O(log N) |
| Nested loop set intersection | Hash set lookup | O(N²) → O(N) |
| Per-element regex match | Trie or DFA | O(NM) → O(N+M) |
| Repeated sort | Heap, partial sort, or `select_k` | O(N log N) → O(N) |
| Quadratic string concat | `strings.Builder` | O(N²) → O(N) |

If your profile shows uniform load across many functions and no clear leaf hotspot, the bottleneck is structural. No amount of micro-tuning beats fixing the algorithm.

---

## 14. The "do less work" lens

Two questions that pay off more than any compiler trick:

- **Is this work necessary?** Maybe the caller doesn't need the field you're computing. Maybe the result is the same as last time and can be cached. Maybe the validation passed three calls ago and doesn't need to repeat.
- **Can this be done at build time / startup?** Embedded files, precomputed tables, code-generated lookups. The cheapest CPU is the CPU you don't spend.

Famous example: `encoding/json` versus `easyjson`-style codegen — same correctness, often **3–5×** less CPU per request, because the codegen has no reflection or type-switch overhead.

---

## 15. Measure, every time

After every change, before claiming a win:

```bash
# Capture baseline
go test -bench=BenchmarkHot -count=10 -cpuprofile=before.pprof -run=^$ > before.txt

# Apply fix, capture again
go test -bench=BenchmarkHot -count=10 -cpuprofile=after.pprof  -run=^$ > after.txt

# Statistical comparison
benchstat before.txt after.txt

# Profile diff
go tool pprof -http=:8080 -base=before.pprof after.pprof
```

A "20% faster" claim with one run, no statistical test, is noise. `benchstat` reports p-values and per-run variance; trust nothing under p > 0.05 or with high CV.

---

## 16. Summary

CPU optimization in Go is a catalog of profile-shape → fix pairs, applied in order of size. Compile regexes once, pre-size slices and maps, avoid `fmt` and interface boxing in hot loops, replace map lookups with slice indices when keys are fixed, cache expensive computations, switch to lock-free or sharded structures under contention, and reach for algorithmic changes when uniform load resists micro-tuning. Each fix is small; the discipline is measuring before and after, every time, with `benchstat` and `pprof -base`.

---

## Further reading
- "Profiling Go Programs" (Go blog): https://go.dev/blog/pprof
- High Performance Go workshop (Dave Cheney): https://dave.cheney.net/high-performance-go-workshop/dotgo-paris.html
- "100 Go Mistakes" (Teiva Harsanyi) — performance chapter
- Go PGO guide: https://go.dev/doc/pgo
