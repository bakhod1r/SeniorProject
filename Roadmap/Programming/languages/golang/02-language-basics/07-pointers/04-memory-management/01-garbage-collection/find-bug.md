# Go Garbage Collection — Find the Bug

## Bug 1 🟢 — Manual GC in Loop

```go
for i := 0; i < 1000; i++ {
    process()
    runtime.GC()
}
```

<details>
<summary>Solution</summary>

**Bug**: Forcing GC every iteration adds massive CPU overhead. Trust the runtime.

**Fix**: remove `runtime.GC()`.
</details>

---

## Bug 2 🟢 — `GOGC=off` in Production

```bash
GOGC=off ./service
```

<details>
<summary>Solution</summary>

**Bug**: GC disabled. Heap grows forever; eventually OOM.

**Fix**: never disable in production.
</details>

---

## Bug 3 🟡 — No GOMEMLIMIT in Container

```bash
# 2 GiB container, no GOMEMLIMIT set
./service
```

<details>
<summary>Solution</summary>

**Bug**: GC may let heap grow until OS kills the container. Aggressive growth can OOM-kill before GC catches up.

**Fix**: set `GOMEMLIMIT=1900MiB` (~95% of container).
</details>

---

## Bug 4 🟡 — Sub-Slice Leak

```go
big := make([]byte, 1<<20)
small := big[:10]
big = nil
runtime.GC()
// 1 MB still alive via small
```

<details>
<summary>Solution</summary>

**Bug**: subslice keeps backing array alive.

**Fix**: copy out:
```go
small := make([]byte, 10)
copy(small, big[:10])
big = nil
runtime.GC() // now 1 MB collectable
```
</details>

---

## Bug 5 🟡 — `sync.Pool` Holds State Beyond GC

```go
state := pool.Get()
// expect state to have previous instance's data
```

<details>
<summary>Solution</summary>

**Bug**: Pool may discard entries at GC. `Get` may return a fresh `New()`.

**Fix**: don't rely on Pool for state retention.
</details>

---

## Bug 6 🟡 — `sync.Pool` Without Reset

```go
b := pool.Get().(*Buffer)
defer pool.Put(b)
// b has previous user's data
```

<details>
<summary>Solution</summary>

**Bug**: previous user's data leaks to next.

**Fix**:
```go
defer func() { b.Reset(); pool.Put(b) }()
```
</details>

---

## Bug 7 🔴 — Goroutine Leak Pinning Memory

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

**Bug**: Goroutine never exits. `req.Body` pinned forever. Memory grows linearly.

**Fix**: context cancellation:
```go
func process(ctx context.Context, req *Request) {
    go func() {
        for {
            select {
            case <-ctx.Done(): return
            case <-time.After(time.Hour): _ = req.Body
            }
        }
    }()
}
```
</details>

---

## Bug 8 🔴 — Map Doesn't Shrink

```go
cache := map[int]string{}
for i := 0; i < 10_000_000; i++ { cache[i] = "x" }
for i := 0; i < 10_000_000; i++ { delete(cache, i) }
// Memory stays high
```

<details>
<summary>Solution</summary>

**Bug**: map's bucket array stays at peak size.

**Fix**: rebuild the map periodically:
```go
newCache := make(map[int]string, len(cache))
for k, v := range cache { newCache[k] = v }
cache = newCache
runtime.GC()
```
</details>

---

## Bug 9 🔴 — Excessive Mark Assist From Allocation Burst

```go
// 1M goroutines each allocating 10 KB
for i := 0; i < 1_000_000; i++ {
    go func() {
        _ = make([]byte, 10*1024)
    }()
}
```

<details>
<summary>Solution</summary>

**Bug**: Massive allocation burst triggers heavy mark assist. Goroutines throttled; latency spikes.

**Fix**: throttle the burst:
```go
// Worker pool + bounded channel
sem := make(chan struct{}, 100)
for i := 0; i < 1_000_000; i++ {
    sem <- struct{}{}
    go func() {
        defer func() { <-sem }()
        _ = make([]byte, 10*1024)
    }()
}
```

Or pre-allocate with sync.Pool.
</details>

---

## Bug 10 🔴 — `debug.FreeOSMemory` in Hot Path

```go
for i := 0; i < 1000; i++ {
    process()
    runtime.GC()
    debug.FreeOSMemory()
}
```

<details>
<summary>Solution</summary>

**Bug**: `FreeOSMemory` is expensive (scavenges, returns pages). Per-iteration calls cripple performance.

**Fix**: call rarely (e.g., once after a known large drop, or never). Trust the runtime.
</details>
