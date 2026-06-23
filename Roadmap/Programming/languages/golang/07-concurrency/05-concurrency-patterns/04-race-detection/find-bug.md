# Race Detection — Find the Bug

> Each snippet contains a real-world race or race-related bug. Find it, explain it, fix it. Every entry follows the same structure: **Problem / Before / After / Gain / Caveat**. Every code sample compiles and (without the fix) reliably fires the race detector. All Go 1.22+.

---

## Bug 1 — Closure over loop variable (pre-1.22 semantics)

**Problem:** A goroutine captures the loop variable and races with the loop itself, while also printing the wrong value.

**Before:**

```go
package main

import (
    "fmt"
    "sync"
)

func main() {
    var wg sync.WaitGroup
    items := []string{"alpha", "beta", "gamma"}
    for i := 0; i < len(items); i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            fmt.Println(i, items[i]) // race: i is read here, written by main
        }()
    }
    wg.Wait()
}
```

Compiled with Go 1.21 or earlier (or with explicit shared-var semantics), `-race` reports:

```
WARNING: DATA RACE
Read at 0x... by goroutine 7:
  main.main.func1()  ...:13
Previous write at 0x... by goroutine 1:
  main.main()        ...:11
```

The single backing variable for `i` is written by the loop and read by goroutines without synchronisation. Logic-wise, all goroutines often print the same `i == 3` and panic on `items[3]`.

**After:**

```go
for i := 0; i < len(items); i++ {
    i := i // shadow per iteration
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(i, items[i])
    }()
}
```

Or in Go 1.22+, the bug is fixed by language semantics — each iteration creates a fresh `i`.

**Gain:** No race; correct values printed.

**Caveat:** In codebases that target multiple Go versions, prefer the explicit shadow for clarity and forward compatibility.

---

## Bug 2 — Missing mutex on a shared map

**Problem:** Concurrent writes and reads on a plain Go map. Even without `-race`, the runtime panics with `concurrent map writes`.

**Before:**

```go
package main

import (
    "fmt"
    "sync"
)

var prices = map[string]int{}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            prices[fmt.Sprintf("item-%d", i)] = i * 100
        }(i)
    }
    wg.Wait()
    fmt.Println(prices)
}
```

`-race` quickly reports a write-write race. Without `-race`, you may see:

```
fatal error: concurrent map writes
```

**After:**

```go
var (
    prices = map[string]int{}
    mu     sync.Mutex
)

go func(i int) {
    defer wg.Done()
    mu.Lock()
    prices[fmt.Sprintf("item-%d", i)] = i * 100
    mu.Unlock()
}(i)
```

For high-fanout reads with rare writes, use `sync.RWMutex` and `RLock`/`RUnlock` on read paths.

**Gain:** Race-free map mutation.

**Caveat:** Wrap **every** access — read and write — in the locking protocol. A single missed read undoes the protection.

---

## Bug 3 — Double-checked locking on `init` flag

**Problem:** A "fast path" reads an init flag without synchronisation. The Go memory model gives no guarantee that, when the flag is observed true, the rest of the struct is also fully constructed.

**Before:**

```go
type Cache struct {
    mu     sync.Mutex
    inited bool
    m      map[string]string
}

func (c *Cache) Get(k string) string {
    if !c.inited {                  // race: unsynchronised read
        c.mu.Lock()
        if !c.inited {
            c.m = make(map[string]string)
            c.inited = true
        }
        c.mu.Unlock()
    }
    return c.m[k]                   // may read c.m while another goroutine still initialises
}
```

Two failure modes:

1. The `inited` read is a data race; `-race` reports it.
2. Even on architectures where the flag read is "atomic enough", the writes to `c.m` and `c.inited` may be reordered: a reader can see `inited == true` while `c.m` is still nil (panic on map read).

**After (use `sync.Once`):**

```go
type Cache struct {
    once sync.Once
    m    map[string]string
}

func (c *Cache) Get(k string) string {
    c.once.Do(func() {
        c.m = make(map[string]string)
    })
    return c.m[k]
}
```

`sync.Once.Do` provides happens-before: writes inside `f` are visible after `Do` returns.

**Gain:** Correct lazy initialisation with no data race and no torn-state visibility.

**Caveat:** `sync.Once` runs `f` exactly once even if it panics. If init can fail and you want retries, you need a custom retry-Once (or a state machine on `atomic.Int32`).

---

## Bug 4 — Atomic write paired with non-atomic read

**Problem:** One side uses `atomic.Store`; the other side reads the variable directly. The Go memory model only guarantees ordering when *both* sides use atomics on the same variable.

**Before:**

```go
var stop int32

func worker() {
    for {
        if stop == 1 {           // race: non-atomic read
            return
        }
        // do work
    }
}

func main() {
    go worker()
    time.Sleep(time.Second)
    atomic.StoreInt32(&stop, 1)  // atomic write
    time.Sleep(100 * time.Millisecond)
}
```

`-race` reports a race on `stop`. The compiler may also hoist `if stop == 1` out of the loop because, from the worker goroutine's local view, `stop` is never written — turning the check into an infinite loop that never exits.

**After:**

```go
func worker() {
    for {
        if atomic.LoadInt32(&stop) == 1 {
            return
        }
        // do work
    }
}
```

Both sides now use atomics. Better still, use a `context.Context` for cancellation:

```go
func worker(ctx context.Context) {
    for {
        select {
        case <-ctx.Done():
            return
        default:
        }
        // do work
    }
}
```

**Gain:** Predictable shutdown semantics; no race; no compiler-induced infinite loop.

**Caveat:** Mixing atomic and non-atomic on the same variable is *always* a race — even if the variable is "just a flag." There is no "single byte is naturally atomic" loophole in Go.

---

## Bug 5 — Partial-update race on a multi-field struct

**Problem:** Two writes to two fields of the same struct under one mutex; one read of both fields without the mutex. The reader can observe an inconsistent snapshot.

**Before:**

```go
type Stats struct {
    mu    sync.Mutex
    Total int
    OK    int
}

func (s *Stats) Record(success bool) {
    s.mu.Lock()
    s.Total++
    if success {
        s.OK++
    }
    s.mu.Unlock()
}

func (s *Stats) Print() {
    fmt.Printf("Total=%d OK=%d\n", s.Total, s.OK) // race: unsynchronised reads
}
```

`-race` reports two races (one per field). Logically, `Print` may print `Total=5 OK=4` while the writer is mid-update, even if the final state would be `Total=5 OK=5`.

**After:**

```go
func (s *Stats) Snapshot() (total, ok int) {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.Total, s.OK
}

func (s *Stats) Print() {
    total, ok := s.Snapshot()
    fmt.Printf("Total=%d OK=%d\n", total, ok)
}
```

The snapshot copies both fields under the lock; the printing happens outside.

**Gain:** Consistent reads; no race.

**Caveat:** Returning slices or maps from a snapshot is *not* sufficient — the reader can still mutate the returned reference. Return defensive copies if the caller might mutate.

---

## Bug 6 — `time.Time` race

**Problem:** A `time.Time` is a struct of three fields (`wall`, `ext`, `loc`). Concurrent assignment and read of a shared `time.Time` races on multiple words.

**Before:**

```go
type Server struct {
    lastReq time.Time
}

func (s *Server) Handle() {
    s.lastReq = time.Now()       // race
}

func (s *Server) Stat() time.Time {
    return s.lastReq             // race
}
```

`-race` reports races; the reader may observe a time with mismatched `wall` and `ext` fields, or with a stale `loc` pointer — yielding wildly wrong times (e.g., year 1754 or year 9999).

**After (mutex):**

```go
type Server struct {
    mu      sync.Mutex
    lastReq time.Time
}

func (s *Server) Handle() {
    t := time.Now()
    s.mu.Lock()
    s.lastReq = t
    s.mu.Unlock()
}

func (s *Server) Stat() time.Time {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.lastReq
}
```

Or, store `time.Now().UnixNano()` as `atomic.Int64` and convert to `time.Time` on read:

```go
type Server struct { lastReq atomic.Int64 }

func (s *Server) Handle()   { s.lastReq.Store(time.Now().UnixNano()) }
func (s *Server) Stat() time.Time {
    return time.Unix(0, s.lastReq.Load())
}
```

**Gain:** Race-free time tracking; no torn struct.

**Caveat:** `time.Time` looks like a value type, but its internal layout makes concurrent unsynchronised access dangerous. The same caveat applies to *any* multi-word struct: strings (header), slices (header), interfaces (type+data words).

---

## Bug 7 — `append` on a shared slice

**Problem:** Two goroutines append to the same slice. `append` is multi-step (read len/cap, decide if realloc, write), and concurrent appends race on the slice header *and* the backing array.

**Before:**

```go
var logs []string

func record(msg string) {
    logs = append(logs, msg) // race
}

func main() {
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func(i int) {
            defer wg.Done()
            record(fmt.Sprintf("msg %d", i))
        }(i)
    }
    wg.Wait()
    fmt.Println(len(logs)) // often less than 100
}
```

Two failure modes: lost writes (one goroutine's append is overwritten by another's) and torn header reads (`len > cap`, panic on next access).

**After (mutex):**

```go
var (
    mu   sync.Mutex
    logs []string
)

func record(msg string) {
    mu.Lock()
    logs = append(logs, msg)
    mu.Unlock()
}
```

Or, use a channel:

```go
ch := make(chan string, 1024)
go func() {
    for msg := range ch {
        logs = append(logs, msg) // single owner; no race
    }
}()
```

**Gain:** All entries recorded; no torn slice.

**Caveat:** Even after the writes finish and you `wg.Wait`, you must establish an edge before reading `logs` from the main goroutine. `wg.Wait` provides that edge automatically. Without it, the read would still race.

---

## Bug 8 — Concurrent log writer without lock

**Problem:** Two goroutines call a custom logger that appends to a `bytes.Buffer`. The buffer is not safe for concurrent use; `-race` reports races on internal fields, and output is interleaved or corrupt.

**Before:**

```go
type Logger struct {
    buf bytes.Buffer
}

func (l *Logger) Log(line string) {
    l.buf.WriteString(line)
    l.buf.WriteString("\n")
}

func (l *Logger) Dump() string {
    return l.buf.String()
}
```

`Log` called from many goroutines races on the buffer's internal pointer/length fields; one log line may overwrite another mid-write.

**After:**

```go
type Logger struct {
    mu  sync.Mutex
    buf bytes.Buffer
}

func (l *Logger) Log(line string) {
    l.mu.Lock()
    defer l.mu.Unlock()
    l.buf.WriteString(line)
    l.buf.WriteString("\n")
}

func (l *Logger) Dump() string {
    l.mu.Lock()
    defer l.mu.Unlock()
    return l.buf.String()
}
```

For high-throughput logging, prefer a channel-based logger or a battle-tested library (`zap`, `slog`).

**Gain:** Atomic write of each line; no interleaved output; no races.

**Caveat:** `log.Logger` from the standard library *is* safe for concurrent use — its internal Mutex protects every Output call. Custom loggers usually are not.

---

## Bug 9 — `sync.Once` not used for one-time init

**Problem:** Two goroutines may both observe `singleton == nil` and both create the singleton, racing on the assignment and constructing two different instances.

**Before:**

```go
var singleton *DB

func GetDB() *DB {
    if singleton == nil {
        singleton = newDB() // race: many goroutines may enter
    }
    return singleton
}
```

`-race` reports races on `singleton`. Worse, two `newDB()` calls may open two pools, leak connections, or violate "exactly one DB" invariant.

**After:**

```go
var (
    singleton *DB
    once      sync.Once
)

func GetDB() *DB {
    once.Do(func() {
        singleton = newDB()
    })
    return singleton
}
```

`Once.Do` guarantees `f` runs exactly once across all callers, and the Store of `singleton` happens-before any later read from any goroutine.

**Gain:** Exactly one initialisation; race-free reads; lazy.

**Caveat:** If `newDB` can fail, `Once` won't retry. For a robust pattern, use `sync.OnceValues` (Go 1.21+) which captures error too, or build your own retry primitive.

---

## Bug 10 — Method on value receiver mutating shared state

**Problem:** A method takes a value receiver but assigns to a pointer field of the value, mutating the shared underlying data without synchronisation.

**Before:**

```go
type Counter struct {
    n *int
}

func (c Counter) Inc() {
    *c.n++ // shared int through the pointer; race across goroutines
}

func main() {
    n := 0
    c := Counter{n: &n}
    var wg sync.WaitGroup
    for i := 0; i < 100; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    fmt.Println(n) // not 100
}
```

The value receiver copies the `Counter` struct, but the `*int` inside still points to the original `n`. Concurrent `*c.n++` is a race on `n`.

**After:**

```go
type Counter struct {
    n atomic.Int64
}

func (c *Counter) Inc() { c.n.Add(1) }
```

Use a pointer receiver so callers share the same state, and use `atomic.Int64` (or a mutex) for the actual count.

**Gain:** Race-free, correct count.

**Caveat:** The value-receiver-with-pointer-field pattern is a classic source of confusion. As a rule: if a method mutates state, use a pointer receiver and document the locking discipline.

---

## Bug 11 — Race on a closed channel via reuse

**Problem:** A `done` channel is reused across requests. One goroutine closes it; another later tries to close it again. The second close panics, and the read of `done`'s state from another goroutine races.

**Before:**

```go
type Job struct {
    done chan struct{}
}

func (j *Job) Cancel() {
    close(j.done) // panics if already closed; races with another close
}
```

Two cancellations race on the channel's internal closed flag, and the second triggers `panic: close of closed channel`.

**After:**

```go
type Job struct {
    once sync.Once
    done chan struct{}
}

func (j *Job) Cancel() {
    j.once.Do(func() { close(j.done) })
}
```

`sync.Once.Do` makes `close` happen exactly once, race-free.

**Gain:** Idempotent cancellation; no panic; no race.

**Caveat:** Some teams use `context.Context` and `cancel` instead. `cancel()` is itself idempotent and safe; that is a cleaner solution if the cancellation can be expressed as a context.

---

## Bug 12 — `sync.WaitGroup.Add` called from inside a goroutine

**Problem:** `wg.Add` is called from within the goroutine, after the parent has already started waiting. `wg.Wait` may return before all `Add` calls happen.

**Before:**

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    go func() {
        wg.Add(1) // race with wg.Wait
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

`-race` reports a race on the WaitGroup counter. Worse, if `Wait` unblocks early (counter briefly zero), the program "completes" while goroutines are still running, then they call `Done` on a closed counter and panic.

**After:**

```go
var wg sync.WaitGroup
for i := 0; i < 10; i++ {
    wg.Add(1) // before the go statement
    go func() {
        defer wg.Done()
        work()
    }()
}
wg.Wait()
```

The rule from the `sync.WaitGroup` doc: calls with positive delta to `Add` must happen before `Wait`, and that ordering must be established by the caller — typically by calling `Add` before `go`.

**Gain:** Correct synchronisation; no race; no panic.

**Caveat:** Code reviews catch this often; CI rarely does — the bug is timing-sensitive. Treat the rule as inviolable.

---

## Bug 13 — Stale read after `wg.Wait` due to package-level write before goroutine

**Problem:** A goroutine reads a package-level variable; the parent writes that variable *after* starting the goroutine but *before* `wg.Wait`. The write is unsynchronised.

**Before:**

```go
var config string

func main() {
    var wg sync.WaitGroup
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(config) // race
    }()
    config = "ready"        // race
    wg.Wait()
}
```

The goroutine and the assignment to `config` race. The goroutine may see `""` or `"ready"` depending on scheduling.

**After (set the value before `go`):**

```go
func main() {
    var wg sync.WaitGroup
    config = "ready"
    wg.Add(1)
    go func() {
        defer wg.Done()
        fmt.Println(config) // sees "ready"
    }()
    wg.Wait()
}
```

Code before `go f()` happens-before `f` runs. Any write before `go` is visible inside the goroutine.

Or, pass the value as a parameter:

```go
go func(cfg string) {
    defer wg.Done()
    fmt.Println(cfg)
}(config)
```

**Gain:** Race-free; deterministic.

**Caveat:** Be careful with mutating values *while* goroutines are running. Use a mutex, an atomic, or restructure so writes happen before the spawn (or after `Wait`).

---

## Bug 14 — `sync.Pool` misuse: assuming exclusive ownership

**Problem:** `sync.Pool.Get` returns an item that was once put in by another goroutine. If the caller does not reset the item, leftover state from the previous user is observed — and concurrent modification of that state by another goroutine that *also* got the item from a stale reference races.

**Before:**

```go
var bufPool = sync.Pool{
    New: func() any { return new(bytes.Buffer) },
}

func handle(req string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.WriteString(req) // appends to leftover content from previous Get
    out := buf.String()
    bufPool.Put(buf)
    return out
}
```

Even without overlapping Gets, the leftover content is wrong. If a second goroutine somehow retains a pointer to the previously-Got buffer, races on the buffer ensue.

**After:**

```go
func handle(req string) string {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset() // clear leftover state
    defer bufPool.Put(buf)
    buf.WriteString(req)
    return buf.String()
}
```

Always Reset on Get; never retain a pointer past Put.

**Gain:** Correct content; no aliasing across goroutines.

**Caveat:** `sync.Pool` is a *cache of free objects*, not a concurrent container. Items are owned exclusively while between Get and Put; treat them as such.

---

## Bug 15 — Iterating a `sync.Map` while another goroutine writes

**Problem:** `sync.Map.Range` snapshots the read map but may include items written *during* the range. The user assumes a consistent snapshot and acts on it.

**Before:**

```go
var users sync.Map // map[int]*User

func sumAge() int {
    total := 0
    users.Range(func(_, v any) bool {
        u := v.(*User)
        total += u.Age // user may be mutated concurrently
        return true
    })
    return total
}
```

Other goroutines mutate `*User` instances while `Range` walks them. `-race` reports races on `Age`.

**After:**

Either lock each `User`, or store immutable copies and replace on update:

```go
type User struct {
    Name string
    Age  int
}

func updateAge(id int, age int) {
    if cur, ok := users.Load(id); ok {
        u := *cur.(*User) // copy
        u.Age = age
        users.Store(id, &u) // publish new pointer
    }
}

func sumAge() int {
    total := 0
    users.Range(func(_, v any) bool {
        total += v.(*User).Age // read-only, immutable User
        return true
    })
    return total
}
```

By treating `*User` as immutable after Store, readers only need an atomic-pointer-like load (which `sync.Map` provides).

**Gain:** Race-free aggregation.

**Caveat:** `sync.Map` makes the map structure thread-safe but not its values. The values you store in it must themselves be safe for concurrent use, or treated as immutable.

---

## Self-Check

For each bug, can you:

- [ ] Identify the racing memory access pair without running the program?
- [ ] Predict what `-race` would report (read at line X, write at line Y)?
- [ ] Choose the smallest fix that establishes a happens-before edge?
- [ ] Explain the underlying memory-model rule that the bug violates?

If a bug confused you, re-read junior.md and middle.md for the relevant pattern, then come back. Race detection mastery is built one bug at a time.
