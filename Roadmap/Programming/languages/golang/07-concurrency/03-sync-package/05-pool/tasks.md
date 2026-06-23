# sync.Pool — Hands-On Tasks

> Each task gives you a goal, scaffolding, the success metric, and a hidden-by-default solution. Tasks ramp from "first contact" to "design a production-grade pooled subsystem." Treat the solutions as last resort — try first, then peek.

---

## Easy

### Task 1 — Your first buffer pool

**Goal.** Pool `*bytes.Buffer` for a function that formats `"hello, %s"`.

**Scaffolding.**

```go
package main

import (
    "bytes"
    "fmt"
    "sync"
)

var bufPool = sync.Pool{
    // TODO: set New
}

func greet(name string) string {
    // TODO: Get a buffer, Reset it, write the greeting, return as string, Put it back.
}

func main() {
    fmt.Println(greet("ada"))
    fmt.Println(greet("alan"))
}
```

**Success.** Program prints two greetings. Use `defer Put` so the buffer is returned even on panic.

**Solution.**

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func greet(name string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    defer bufPool.Put(buf)
    buf.Reset()
    fmt.Fprintf(buf, "hello, %s", name)
    return buf.String()
}
```

---

### Task 2 — Benchmark pooled vs naive

**Goal.** Write benchmarks for `greet` (pooled) and `greetNaive` (allocates a fresh buffer every call) using `b.ReportAllocs()`.

**Success.** `go test -bench . -benchmem` shows the pooled version with strictly fewer allocations per op, or equal if escape analysis already stack-allocates.

**Solution.**

```go
func greetNaive(name string) string {
    var buf bytes.Buffer
    fmt.Fprintf(&buf, "hello, %s", name)
    return buf.String()
}

func BenchmarkGreet(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = greet("ada")
    }
}

func BenchmarkGreetNaive(b *testing.B) {
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _ = greetNaive("ada")
    }
}
```

Run: `go test -bench . -benchmem -run none`. Compare `allocs/op`.

---

### Task 3 — Add `testing.AllocsPerRun` assertion

**Goal.** Write a regular test (not a benchmark) that asserts the pooled path averages ≤ 1 allocation per call after warm-up.

**Success.** The test prints nothing on success, fails with a clear message if pooling regresses.

**Solution.**

```go
func TestGreetPoolIsTight(t *testing.T) {
    // Warm up the pool.
    bufPool.Put(bufPool.Get())

    avg := testing.AllocsPerRun(1000, func() {
        _ = greet("ada")
    })
    if avg > 1.1 {
        t.Fatalf("expected <= 1 alloc/op, got %.2f", avg)
    }
}
```

The warm-up `Put(Get())` matters: the first call calls `New`, which counts.

---

### Task 4 — Pool a JSON encoder

**Goal.** Build a pool of `*json.Encoder` wrappers that share a `*bytes.Buffer`.

**Scaffolding.**

```go
type encWrapper struct {
    buf *bytes.Buffer
    enc *json.Encoder
}

var encPool = sync.Pool{
    // TODO: New returns *encWrapper with a fresh buffer and encoder.
}

func toJSON(v any) ([]byte, error) {
    // TODO: Get, Reset buf, encode, copy bytes out (do not alias buf), Put.
}
```

**Success.** `toJSON(map[string]int{"x": 1})` returns `[]byte("{\"x\":1}\n")` (note the trailing newline from `Encoder`).

**Solution.**

```go
var encPool = sync.Pool{
    New: func() any {
        b := new(bytes.Buffer)
        return &encWrapper{buf: b, enc: json.NewEncoder(b)}
    },
}

func toJSON(v any) ([]byte, error) {
    e := encPool.Get().(*encWrapper)
    defer encPool.Put(e)
    e.buf.Reset()
    if err := e.enc.Encode(v); err != nil {
        return nil, err
    }
    out := make([]byte, e.buf.Len())
    copy(out, e.buf.Bytes())
    return out, nil
}
```

---

### Task 5 — Fix the type assertion crash

**Goal.** This program crashes on the second call. Fix it.

```go
var p sync.Pool

func use() {
    buf := p.Get().(*bytes.Buffer) // panics on miss
    buf.WriteString("x")
    p.Put(buf)
}
```

**Success.** No panic on any call.

**Solution.** Set `New`:

```go
var p = sync.Pool{New: func() any { return new(bytes.Buffer) }}
```

Or handle the nil case:

```go
v := p.Get()
buf, ok := v.(*bytes.Buffer)
if !ok || buf == nil {
    buf = new(bytes.Buffer)
}
```

Prefer the first fix; the second is for special cases.

---

## Medium

### Task 6 — Capacity-bound a pool

**Goal.** Modify your buffer pool so that buffers grown beyond 64 KB are discarded on `Put` instead of pooled. This prevents memory bloat from outlier requests.

**Scaffolding.**

```go
func putBuf(buf *bytes.Buffer) {
    // TODO: check cap; only Put if < 64 KB.
}
```

**Success.** Add a test that:

1. Gets a buffer.
2. Writes 100 KB into it.
3. Calls `putBuf`.
4. Then `Get`s again and asserts capacity is small (≤ 64 KB).

**Solution.**

```go
const maxBufCap = 64 << 10

func putBuf(buf *bytes.Buffer) {
    if buf.Cap() > maxBufCap {
        return
    }
    bufPool.Put(buf)
}
```

Test:

```go
func TestPutBufDropsLarge(t *testing.T) {
    big := new(bytes.Buffer)
    big.Grow(200 << 10)
    big.Write(make([]byte, 100<<10))
    putBuf(big)
    // The next Get may not return big (it was dropped). The point is the pool
    // doesn't grow. Harder to assert directly; can use a wrapper that counts
    // Puts that actually inserted.
}
```

Real assertion requires instrumentation (Task 8).

---

### Task 7 — Generic pool wrapper

**Goal.** Implement a generic `Pool[T any]` that hides the type assertion. Reuse it for both `*bytes.Buffer` and a custom struct.

**Scaffolding.**

```go
package gpool

import "sync"

type Pool[T any] struct {
    p sync.Pool
}

func New[T any](newFn func() T) *Pool[T] {
    // TODO
}

func (p *Pool[T]) Get() T { /* TODO */ }
func (p *Pool[T]) Put(v T) { /* TODO */ }
```

**Success.** Two usage examples compile and run:

```go
bufPool := gpool.New(func() *bytes.Buffer { return new(bytes.Buffer) })
type Decoder struct{ /* ... */ }
decPool := gpool.New(func() *Decoder { return new(Decoder) })
```

**Solution.**

```go
func New[T any](newFn func() T) *Pool[T] {
    return &Pool[T]{
        p: sync.Pool{New: func() any { return newFn() }},
    }
}

func (p *Pool[T]) Get() T  { return p.p.Get().(T) }
func (p *Pool[T]) Put(v T) { p.p.Put(v) }
```

---

### Task 8 — Instrument a pool with counters

**Goal.** Wrap a `sync.Pool` so you can observe `Gets`, `Puts`, and `Misses` (calls to `New`). Add the metrics as `expvar.Int`.

**Scaffolding.**

```go
var (
    poolGets  = expvar.NewInt("pool.gets")
    poolPuts  = expvar.NewInt("pool.puts")
    poolMisses = expvar.NewInt("pool.misses")
)

type CountingPool struct {
    inner sync.Pool
}

func NewCountingPool(newFn func() any) *CountingPool {
    // TODO: set inner.New to wrap newFn so it increments poolMisses
}

func (p *CountingPool) Get() any { /* TODO: increment, return */ }
func (p *CountingPool) Put(v any) { /* TODO */ }
```

**Success.** A small test that calls `Get`/`Put` 100 times and inspects the counters.

**Solution.**

```go
func NewCountingPool(newFn func() any) *CountingPool {
    return &CountingPool{
        inner: sync.Pool{
            New: func() any {
                poolMisses.Add(1)
                return newFn()
            },
        },
    }
}

func (p *CountingPool) Get() any {
    poolGets.Add(1)
    return p.inner.Get()
}

func (p *CountingPool) Put(v any) {
    poolPuts.Add(1)
    p.inner.Put(v)
}
```

Caveat: the miss counter increments inside `New`, which runs in the calling goroutine. No race; the atomic `expvar.Int.Add` is safe.

---

### Task 9 — Detect a "use after Put" bug

**Goal.** Write a test that catches this bug:

```go
func bug() *bytes.Buffer {
    buf := bufPool.Get().(*bytes.Buffer)
    bufPool.Put(buf)
    return buf
}
```

**Success.** Running `go test -race` against your test surfaces a data race when two goroutines call `bug()` concurrently and write through the returned `*bytes.Buffer`.

**Solution.**

```go
func TestUseAfterPut(t *testing.T) {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            b := bug()
            b.WriteString(strconv.Itoa(i))
        }(i)
    }
    wg.Wait()
}
```

Run `go test -race`. The race detector will report concurrent writes to the same `*bytes.Buffer` from different goroutines — proving the bug.

---

### Task 10 — Compare `sync.Pool` to a channel-backed bounded pool

**Goal.** Implement a channel-backed pool of `*bytes.Buffer` with capacity 32. Benchmark it against `sync.Pool` for 1, 8, and 64 concurrent goroutines.

**Scaffolding.**

```go
type ChanPool struct {
    ch chan *bytes.Buffer
}

func NewChanPool(size int) *ChanPool { /* TODO */ }
func (p *ChanPool) Get() *bytes.Buffer { /* TODO */ }
func (p *ChanPool) Put(b *bytes.Buffer) { /* TODO */ }
```

**Success.** Benchmarks show `sync.Pool` is faster at every concurrency level, but the channel pool memory is strictly bounded.

**Solution.**

```go
type ChanPool struct {
    ch chan *bytes.Buffer
}

func NewChanPool(size int) *ChanPool {
    return &ChanPool{ch: make(chan *bytes.Buffer, size)}
}

func (p *ChanPool) Get() *bytes.Buffer {
    select {
    case b := <-p.ch:
        return b
    default:
        return new(bytes.Buffer)
    }
}

func (p *ChanPool) Put(b *bytes.Buffer) {
    b.Reset()
    select {
    case p.ch <- b:
    default:
        // full; drop
    }
}
```

Benchmark with `b.RunParallel`:

```go
func BenchmarkSyncPool(b *testing.B) {
    b.RunParallel(func(pb *testing.PB) {
        for pb.Next() {
            buf := bufPool.Get().(*bytes.Buffer)
            buf.Reset()
            buf.WriteString("x")
            bufPool.Put(buf)
        }
    })
}
```

`go test -bench . -cpu 1,8,64`.

---

## Hard

### Task 11 — Pool that survives GC for tests

**Goal.** Demonstrate the victim cache. Write a test that:

1. Gets and Puts a buffer.
2. Forces a GC.
3. Gets again — likely the same buffer (victim cache hit).
4. Forces a second GC.
5. Gets — likely a fresh buffer (victim was dropped).

**Hint.** Use `runtime.GC()` to force collection. Identity is hard to assert (`Get` returns `any`); use a uniquely-tagged buffer (write a specific marker before `Put`) and look for it after.

**Solution.**

```go
func TestVictimCacheBehaviour(t *testing.T) {
    var p = sync.Pool{New: func() any { return new(bytes.Buffer) }}

    b := p.Get().(*bytes.Buffer)
    b.WriteString("UNIQUE-MARKER-12345")
    p.Put(b)

    runtime.GC() // moves live -> victim

    // High chance of getting our marker back via victim.
    b2 := p.Get().(*bytes.Buffer)
    if strings.Contains(b2.String(), "UNIQUE-MARKER-12345") {
        t.Log("victim cache hit after 1 GC")
    }
    p.Put(b2)

    runtime.GC() // first GC: previous live -> victim, victim dropped
    runtime.GC() // second GC: previous victim dropped

    b3 := p.Get().(*bytes.Buffer)
    if strings.Contains(b3.String(), "UNIQUE-MARKER-12345") {
        t.Errorf("expected marker to be lost after 2 GCs")
    }
}
```

This test is intrinsically a bit timing-dependent (the runtime may keep things differently). Run it several times; the behaviour should be consistent across modern Go versions.

---

### Task 12 — Pool a `*gzip.Writer`

**Goal.** Build a pool of `*gzip.Writer` for compressing response bodies. The constructor is expensive; the pool should make a real difference.

**Scaffolding.**

```go
var gzPool = sync.Pool{
    // TODO: New returns gzip.NewWriter(io.Discard); we'll Reset(real) on use
}

func compressTo(w io.Writer, data []byte) error {
    // TODO: Get, Reset(w), Write data, Close, Put.
}
```

**Success.** Benchmark shows the pooled compression is significantly faster than constructing a fresh `*gzip.Writer` each call.

**Solution.**

```go
var gzPool = sync.Pool{
    New: func() any {
        return gzip.NewWriter(io.Discard)
    },
}

func compressTo(w io.Writer, data []byte) error {
    gz := gzPool.Get().(*gzip.Writer)
    gz.Reset(w)
    defer gzPool.Put(gz)

    if _, err := gz.Write(data); err != nil {
        return err
    }
    return gz.Close()
}
```

Benchmark:

```go
func BenchmarkCompressPooled(b *testing.B) {
    data := bytes.Repeat([]byte("hello world "), 1000)
    b.ReportAllocs()
    var out bytes.Buffer
    for i := 0; i < b.N; i++ {
        out.Reset()
        if err := compressTo(&out, data); err != nil {
            b.Fatal(err)
        }
    }
}
```

Compare to a `compressFresh` that builds a new `gzip.Writer` per call.

---

### Task 13 — Build a sharded bounded pool

**Goal.** Build a pool with strict size bound (200 items) sharded across `GOMAXPROCS` cores to reduce contention.

**Scaffolding.**

```go
type ShardedPool struct {
    shards []shard
}

type shard struct {
    _   [64]byte // padding
    mu  sync.Mutex
    buf []*bytes.Buffer
}

func NewShardedPool(maxPerShard int) *ShardedPool { /* TODO */ }
func (p *ShardedPool) Get() *bytes.Buffer { /* TODO */ }
func (p *ShardedPool) Put(b *bytes.Buffer) { /* TODO */ }
```

Use `runtime.GOMAXPROCS(0)` for shard count. Hash by goroutine ID — or use a counter / random shard.

**Success.** Benchmark at high concurrency (e.g. `-cpu 64`) shows the sharded pool with measurable contention reduction vs a single-mutex pool.

**Solution sketch.**

```go
func NewShardedPool(maxPerShard int) *ShardedPool {
    n := runtime.GOMAXPROCS(0)
    p := &ShardedPool{shards: make([]shard, n)}
    for i := range p.shards {
        p.shards[i].buf = make([]*bytes.Buffer, 0, maxPerShard)
    }
    return p
}

func (p *ShardedPool) Get() *bytes.Buffer {
    idx := int(time.Now().UnixNano()) % len(p.shards)
    s := &p.shards[idx]
    s.mu.Lock()
    defer s.mu.Unlock()
    if len(s.buf) == 0 {
        return new(bytes.Buffer)
    }
    b := s.buf[len(s.buf)-1]
    s.buf = s.buf[:len(s.buf)-1]
    return b
}

func (p *ShardedPool) Put(b *bytes.Buffer) {
    idx := int(time.Now().UnixNano()) % len(p.shards)
    s := &p.shards[idx]
    s.mu.Lock()
    defer s.mu.Unlock()
    if cap(s.buf) > len(s.buf) {
        b.Reset()
        s.buf = append(s.buf, b)
    }
}
```

(In production, use `runtime_procPin` or a stable goroutine-id heuristic for shard selection; `time.Now()` is just for the exercise.)

---

### Task 14 — Pool that integrates with `context.Context` cancellation

**Goal.** Wrap a pooled object's lifecycle in a context: if `ctx` is cancelled, the borrowed object is returned to the pool automatically.

**Use case.** Long-lived request handlers where the goroutine may be cancelled mid-borrow and you do not want to leak.

**Scaffolding.**

```go
func WithBuf(ctx context.Context, f func(*bytes.Buffer) error) error {
    // TODO: Get, Reset, run f. If ctx is cancelled, ensure Put still happens.
}
```

**Success.** Test that cancels the context mid-call; the buffer is returned to the pool (count via instrumentation).

**Solution.**

```go
func WithBuf(ctx context.Context, f func(*bytes.Buffer) error) error {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    done := make(chan error, 1)
    go func() { done <- f(buf) }()

    select {
    case err := <-done:
        return err
    case <-ctx.Done():
        // f may still be running; we cannot safely Put yet.
        // Wait for it to finish to avoid the use-after-Put race.
        <-done
        return ctx.Err()
    }
}
```

Subtle: we cannot return early before `f` finishes, because `f` still holds `buf`. The pool's `defer Put` will run after the wait. The exercise is to recognise this subtlety; a naive implementation has a race.

---

### Task 15 — Replace `sync.Pool` with `atomic.Pointer[T]` for a singleton

**Goal.** Someone misused `sync.Pool` to cache a single shared object. Replace with `atomic.Pointer[T]` for a clearer "one instance" semantic.

**Bad code:**

```go
var configPool = sync.Pool{New: func() any { return loadConfig() }}

func getConfig() *Config {
    return configPool.Get().(*Config) // never Put back!
}
```

**Issues.** Every `getConfig` may call `loadConfig` (expensive!) because nothing ever `Put`s. The pool's eviction means even if you did `Put`, it might be gone next GC.

**Goal.** Replace with `sync.Once` + `atomic.Pointer[Config]` or just `sync.Once` + plain global.

**Success.** Tests show `loadConfig` is called exactly once across many concurrent `getConfig` calls.

**Solution.**

```go
var (
    cfgOnce  sync.Once
    cfg      *Config
)

func getConfig() *Config {
    cfgOnce.Do(func() {
        cfg = loadConfig()
    })
    return cfg
}
```

Or for hot reloads:

```go
var cfg atomic.Pointer[Config]

func init() {
    cfg.Store(loadConfig())
}

func reloadConfig() {
    cfg.Store(loadConfig())
}

func getConfig() *Config {
    return cfg.Load()
}
```

Neither uses `sync.Pool`. The original misuse is fixed.

---

## Reflection Tasks

### Task 16 — Find a pool in the Go stdlib

**Goal.** Read the source of `fmt` or `encoding/json` or `net/http` and find a `sync.Pool`. Describe in 100 words:

- What is being pooled.
- What `Reset` looks like for that type.
- The capacity bound (if any).
- The traffic pattern that justifies pooling.

A good answer cites file and line numbers. Example targets:

- `src/fmt/print.go` — `ppFree` (formatters)
- `src/encoding/json/stream.go` — encode state pool
- `src/net/http/server.go` — buffer reader pool

---

### Task 17 — Audit a pool you wrote

**Goal.** For one `sync.Pool` you have written:

1. Does `New` allocate something non-trivial (> 100 B)?
2. Is `Reset` called immediately after `Get`?
3. Is `Put` deferred?
4. Is the borrowed object captured anywhere it could outlive `Put`?
5. Is there a capacity bound on `Put`?
6. Does the benchmark prove the pool helps?
7. Is there a comment explaining why the pool exists?

Score: 7/7 is excellent, 5/7 is acceptable, < 4/7 means the pool needs revision.

---

### Task 18 — Justify or kill

**Goal.** Pick one `sync.Pool` in your codebase that you suspect of being cargo-culted. Either:

1. Produce a benchmark showing > 20% win for the pool.
2. Or remove it and show that p99 latency, GC pause percentiles, and heap-growth rate are unchanged.

Document the decision in the commit message. Either outcome is a win.
