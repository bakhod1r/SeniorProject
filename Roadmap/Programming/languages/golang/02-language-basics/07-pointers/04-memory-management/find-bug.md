# Go Memory Management — Find the Bug

## Bug 1 🟢 — Sub-Slice Pinning

```go
big := make([]byte, 1<<20)
small := big[:10]
big = nil
// 1 MB still alive
```

<details>
<summary>Solution</summary>

**Bug**: subslice keeps backing array alive.

**Fix** — copy:
```go
small := make([]byte, 10)
copy(small, big[:10])
big = nil
```
</details>

---

## Bug 2 🟢 — `sync.Pool` Without Reset

```go
var pool = sync.Pool{New: func() any { return new(Buffer) }}

func use() {
    b := pool.Get().(*Buffer)
    defer pool.Put(b)
    // use b; pool.Put without reset → next user sees old data
}
```

<details>
<summary>Solution</summary>

**Bug**: previous user's data leaks to next user.

**Fix**:
```go
defer func() { b.Reset(); pool.Put(b) }()
```
</details>

---

## Bug 3 🟡 — Goroutine Leak

```go
func process(req *Request) {
    go func() {
        for {
            time.Sleep(time.Hour)
            _ = req.Body
        }
    }()
}
```

<details>
<summary>Solution</summary>

**Bug**: goroutine never exits; pins `req.Body` forever. Memory grows linearly with request count.

**Fix** — context cancellation:
```go
func process(ctx context.Context, req *Request) {
    go func() {
        for {
            select {
            case <-ctx.Done(): return
            case <-time.After(time.Hour):
                _ = req.Body
            }
        }
    }()
}
```
</details>

---

## Bug 4 🟡 — Map Doesn't Shrink

```go
cache := map[int]string{}
for i := 0; i < 10_000_000; i++ {
    cache[i] = "..."
}
for i := 0; i < 10_000_000; i++ {
    delete(cache, i)
}
// Memory stays high; bucket array doesn't shrink
```

<details>
<summary>Solution</summary>

**Bug**: deleted entries free their values but bucket array stays at peak size.

**Fix** — recreate:
```go
newCache := make(map[int]string)
cache = newCache
runtime.GC()
```
</details>

---

## Bug 5 🟡 — Manually Triggering GC

```go
for i := 0; i < 1000; i++ {
    process()
    runtime.GC() // BUG?
}
```

<details>
<summary>Solution</summary>

**Bug** (kind of): unnecessary. The runtime decides. Forcing GC adds CPU overhead without benefit.

**Fix**: remove `runtime.GC()`. Trust the runtime.

Exception: deterministic testing or before sensitive measurements.
</details>

---

## Bug 6 🔴 — Memory Limit Not Set in Container

```go
// Container limit: 1 GiB
// No GOMEMLIMIT set
// Service may OOM before GC runs aggressively
```

<details>
<summary>Solution</summary>

**Bug**: GC default behavior may allow heap to grow until OS kills the container.

**Fix** — set GOMEMLIMIT:
```bash
GOMEMLIMIT=900MiB ./service
```

Or programmatically:
```go
debug.SetMemoryLimit(900 * 1024 * 1024)
```

GC runs more aggressively as heap approaches the limit.
</details>

---

## Bug 7 🔴 — Pool Holds State Beyond GC

```go
var statePool = sync.Pool{New: ...}
state := statePool.Get()
// expecting state to be the previous instance
```

<details>
<summary>Solution</summary>

**Bug**: `sync.Pool` may discard entries at GC. `Get` may return a fresh `New()` even if you Put one moments ago.

**Fix**: don't rely on Pool for state retention. Use it only for ephemeral object reuse.
</details>

---

## Bug 8 🔴 — Heap Profile Without Sampling

```go
runtime.MemProfileRate = 1 // record every allocation
```

<details>
<summary>Solution</summary>

**Bug**: setting to 1 records EVERY allocation. Massive overhead. Profile becomes useless under load.

**Fix**: use default (`512 * 1024` = 512 KB sampling) or `runtime.MemProfileRate = 0` to disable profiling temporarily.
</details>

---

## Bug 9 🔴 — Stack Overflow from Deep Recursion

```go
func recurse(n int) {
    var local [1024]int
    if n > 0 { recurse(n - 1) }
    _ = local
}

recurse(10_000_000)
```

<details>
<summary>Solution</summary>

**Bug**: each call uses 8 KB of stack. 10M calls = 80 GB. Exceeds 1 GiB default stack limit. Crash.

**Fix** — convert to iterative:
```go
for i := 0; i < 10_000_000; i++ {
    process()
}
```
</details>

---

## Bug 10 🔴 — `runtime.GC()` Doesn't Reduce RSS

```go
runtime.GC()
// Expected: RSS drops
// Actual: RSS may stay same
```

<details>
<summary>Solution</summary>

**Bug**: GC frees heap memory but doesn't necessarily return it to the OS.

**Fix** — explicit scavenging:
```go
runtime.GC()
debug.FreeOSMemory()
```

`FreeOSMemory` returns unused pages to the OS. Use sparingly; can hurt performance.
</details>
