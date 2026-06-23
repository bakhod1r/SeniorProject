# Syscall Handling — Optimisation

## Table of Contents
1. [How to Use This Page](#how-to-use-this-page)
2. [Where the Costs Live](#where-the-costs-live)
3. [Reducing Handoff Cost](#reducing-handoff-cost)
4. [Bounding Cgo for Predictable M Footprint](#bounding-cgo-for-predictable-m-footprint)
5. [Batching to Cut Syscall Count](#batching-to-cut-syscall-count)
6. [Buffered I/O Wins](#buffered-io-wins)
7. [Choosing Netpoller-Backed Primitives](#choosing-netpoller-backed-primitives)
8. [VDSO Awareness in Hot Paths](#vdso-awareness-in-hot-paths)
9. [Connection Pooling and Reuse](#connection-pooling-and-reuse)
10. [Tuning the M Pool](#tuning-the-m-pool)
11. [Locking the OS Thread for Hot Cgo Loops](#locking-the-os-thread-for-hot-cgo-loops)
12. [Reducing Sysmon Pressure](#reducing-sysmon-pressure)
13. [Profile-Driven Pool Sizing](#profile-driven-pool-sizing)
14. [Diminishing Returns and Anti-Optimisations](#diminishing-returns-and-anti-optimisations)
15. [Summary](#summary)

---

## How to Use This Page

Each optimisation:

- Has a baseline scenario (what is slow now).
- Has a target (how much can you improve).
- Comes with code or instructions.
- Has a "when not to apply" caveat.

Pick optimisations that target *your* bottleneck. Profile first. Do not blindly apply.

---

## Where the Costs Live

Order-of-magnitude costs for syscall-related operations (Linux, x86-64, Go 1.22+):

| Operation | Cost |
|---|---|
| User-space function call | ~1 ns |
| VDSO `clock_gettime` | ~20 ns |
| `entersyscall`/`exitsyscall` bookkeeping | ~100 ns |
| Real syscall (fast, no I/O) | ~200 ns |
| Real syscall (with kernel work) | 1 µs–1 ms |
| Cgo call overhead | ~100 ns |
| Sysmon handoff | ~5–50 µs |
| M creation (`clone(2)`) | ~5–50 µs |
| Goroutine creation | ~1 µs |
| `epoll_wait` per event | ~50 ns amortised |
| Buffered read of 4 KB (one syscall) | ~1 µs |
| Unbuffered read of 4 KB byte-by-byte | ~4 ms (4096 syscalls × 1 µs) |

The biggest wins come from:

1. **Reducing syscall count** (batching, buffering).
2. **Reducing M creation** (bounding concurrency, pooling).
3. **Avoiding the handoff path** (netpoller-friendly designs, VDSO).

---

## Reducing Handoff Cost

The handoff itself is unavoidable for slow syscalls. But you can reduce the *number* of handoffs.

**Strategy 1: Larger reads.**

```go
// Slow: 1 syscall per byte
for {
    var b [1]byte
    n, err := f.Read(b[:])
    if n == 0 || err != nil { break }
    process(b[0])
}

// Fast: 1 syscall per 4 KB
buf := make([]byte, 4096)
for {
    n, err := f.Read(buf)
    if n > 0 { process(buf[:n]) }
    if err != nil { break }
}
```

Reduces syscalls by ~4096×. For a 1 MB file: 256 vs 1 048 576. The savings are ~4 seconds vs ~1 ms.

**Strategy 2: `readv` / `writev` for scatter-gather.**

```go
// Multiple buffers in one syscall
var iov []syscall.Iovec
for _, b := range buffers {
    iov = append(iov, syscall.Iovec{Base: &b[0], Len: uint64(len(b))})
}
syscall.Syscall(syscall.SYS_WRITEV, fd, uintptr(unsafe.Pointer(&iov[0])), uintptr(len(iov)))
```

One syscall instead of N writes. Useful for emitting structured messages with headers + body + trailer.

**Strategy 3: `sendfile` for file-to-socket copies.**

```go
// Linux: zero-copy file -> socket
n, err := syscall.Sendfile(socketFd, fileFd, &offset, count)
```

Avoids userspace buffer entirely. Used by `net/http`'s `ServeFile` automatically.

**When not to apply**: micro-optimisation for already-fast paths. Profile first.

---

## Bounding Cgo for Predictable M Footprint

The single biggest optimisation for cgo-heavy services. Already covered in [middle.md](middle.md) and [senior.md](senior.md); the pattern:

```go
var sem = make(chan struct{}, runtime.NumCPU()*2)

func processCgo(input []byte) ([]byte, error) {
    sem <- struct{}{}
    defer func() { <-sem }()
    return cgoCall(input), nil
}
```

**Tuning the bound**:

- For CPU-bound C work: `NumCPU` (more wastes CPU on context switches).
- For I/O-bound C work: experiment; 2× to 4× `NumCPU` often best.
- For thread-affine C libraries: stick with pinned worker pool.

**Measure with**:

```bash
# Throughput
ab -n 100000 -c 1000 http://localhost:8080/cgo-endpoint

# Latency p50/p99
hey -n 100000 -c 1000 http://localhost:8080/cgo-endpoint

# Thread count peak
cat /proc/$(pgrep service)/status | grep Threads
```

**Target**: 80% of unbounded throughput at 10% of the thread count.

---

## Batching to Cut Syscall Count

Many small syscalls are worse than one large one. Examples:

**`log.Println` in tight loops.**

```go
// Slow: 1 write per call
for _, item := range items {
    log.Printf("processed %v\n", item)
}

// Fast: batch
var buf strings.Builder
for _, item := range items {
    fmt.Fprintf(&buf, "processed %v\n", item)
}
log.Print(buf.String())
```

**Multiple `conn.Write` calls.**

```go
// Slow
conn.Write(header)
conn.Write(body)
conn.Write(trailer)

// Fast
conn.Write(append(append(header, body...), trailer...))

// Even faster (zero-allocation)
buffers := net.Buffers{header, body, trailer}
buffers.WriteTo(conn) // uses writev
```

`net.Buffers.WriteTo` uses `writev(2)` internally — one syscall instead of three.

**Database queries.**

```go
// Slow
for _, id := range ids {
    db.Query("SELECT ... WHERE id = ?", id)
}

// Fast
db.Query("SELECT ... WHERE id IN (?, ?, ?, ...)", ids...)
```

Each `Query` is at least one network round trip. Batch.

---

## Buffered I/O Wins

`bufio` is essentially free and often quadruples throughput on I/O-heavy paths.

**Reading**:

```go
// Bad
f, _ := os.Open("data.txt")
defer f.Close()
scanner := bufio.NewScanner(f)
for scanner.Scan() {
    process(scanner.Text())
}
```

Wait — that *is* buffered. The bad version would be:

```go
// Truly bad: no buffer
f, _ := os.Open("data.txt")
defer f.Close()
var b [1]byte
var line []byte
for {
    n, err := f.Read(b[:])
    if n == 0 || err != nil { break }
    if b[0] == '\n' {
        process(string(line))
        line = line[:0]
    } else {
        line = append(line, b[0])
    }
}
```

Avoid the second form. Use `bufio.Scanner` or `bufio.Reader`.

**Writing**:

```go
w := bufio.NewWriter(file)
defer w.Flush()
for _, line := range lines {
    w.WriteString(line)
    w.WriteByte('\n')
}
```

One `write(2)` per ~4 KB of accumulated output. Without `bufio.Writer`, one per `WriteString` call.

**For sockets**:

```go
conn, _ := net.Dial("tcp", "...")
defer conn.Close()
w := bufio.NewWriter(conn)
defer w.Flush()
// many small writes via w...
```

Reduces packet count. Caveat: latency. The writer accumulates until flush; if you need bytes on the wire immediately, flush explicitly.

---

## Choosing Netpoller-Backed Primitives

Whenever possible, use APIs that route through the netpoller.

| Replace this | With this | Benefit |
|---|---|---|
| `os.NewFile(fd, ...).Read` on a pipe | `net.FileConn(file)` then `Read` | Goes through netpoller if fd is non-blocking. |
| Polling a flag with `time.Sleep` loop | `<-channel` | Netpoller integration via timers. |
| `os/exec.Cmd` with `Stdout` to `*os.File` | `Stdout` to `io.Pipe()` | The pipe is reader-side parked in netpoller. |
| `syscall.Recvmsg` direct | `net.UnixConn.ReadMsgUnix` | Netpoller-integrated. |

Standard library is usually already netpoller-friendly. Be cautious when you reach for `syscall` directly.

---

## VDSO Awareness in Hot Paths

`time.Now()` on Linux is ~20 ns. People sometimes try to "optimise" by:

- Caching `time.Now()` in a variable and updating it on a timer.
- Using `time.Time` arithmetic instead of `time.Since`.

These are usually anti-optimisations. The caching costs more than the calls saved.

**Verify VDSO is active**:

```bash
LD_DEBUG=libs ./your-program 2>&1 | grep vdso
# should show "linux-vdso.so.1 => ..."
```

**Containers without VDSO**: some hardened containers strip VDSO. `time.Now()` becomes a real syscall (~300 ns). Detect:

```go
start := time.Now()
for i := 0; i < 1_000_000; i++ {
    _ = time.Now()
}
elapsed := time.Since(start)
// expect ~20–50 ms (= 20–50 ns per call) if VDSO active
// expect ~300 ms if not
```

If you confirm VDSO is missing, either fix the container config or accept the cost (it is rarely the bottleneck).

---

## Connection Pooling and Reuse

Each new connection costs:

- TCP handshake: 1 RTT.
- TLS handshake (if HTTPS): 1–2 RTTs.
- Local: `socket(2)` + `connect(2)` syscalls.

For a service making frequent outbound calls, reuse is huge:

```go
client := &http.Client{
    Transport: &http.Transport{
        MaxIdleConns:        100,
        MaxIdleConnsPerHost: 10,
        IdleConnTimeout:     90 * time.Second,
    },
}
```

`http.Client`'s default pool reuses connections, but the default `MaxIdleConnsPerHost` is 2 — usually too low for high-throughput services. Bump it.

For databases:

```go
db, _ := sql.Open("postgres", "...")
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(10)
db.SetConnMaxLifetime(5 * time.Minute)
```

Without these limits, you get either too few connections (queuing) or too many (resource waste).

**Measure with `netstat -ant | wc -l`** for active TCP connections. If it climbs with load and never drops, your pool is undersized.

---

## Tuning the M Pool

The runtime keeps parked Ms in a pool. You cannot directly tune the size, but you can influence it:

- **`runtime.SetMaxThreads(n)`**: hard cap. Default 10000. Raise if you legitimately need more (and have container `pids.max` headroom).
- **`debug.SetGCPercent`**: indirectly affects M usage by changing GC pause behaviour.
- **`GOGC=off`**: disables GC; sometimes used in latency-critical batch jobs.

```go
import "runtime/debug"

func init() {
    debug.SetMaxThreads(20000)
}
```

**When not to apply**: if you are hitting the 10000-thread limit, fix the unbounded concurrency. Raising the cap delays the inevitable.

---

## Locking the OS Thread for Hot Cgo Loops

If you have a tight loop calling cgo, pinning to a thread can save the per-call overhead (no M-state churn):

```go
// Without pinning: each C call goes through full entersyscall/exitsyscall
for _, item := range items {
    C.process(item) // ~100 ns overhead each
}

// With pinning: the M stays bound to this goroutine; some overhead is amortised
runtime.LockOSThread()
defer runtime.UnlockOSThread()
for _, item := range items {
    C.process(item) // still has overhead, but consistent M
}
```

In practice the saving is small (~10–20%); the main benefit of pinning is thread-affine C code, not raw throughput.

**Better**: batch into one C call:

```go
C.process_batch((*C.item)(unsafe.Pointer(&items[0])), C.size_t(len(items)))
```

100× fewer C calls = 100× less overhead.

---

## Reducing Sysmon Pressure

Sysmon runs at ~50 Hz under load. It is cheap but visible in profiles. Reducing pressure:

- **Fewer Ps in `_Psyscall` at once.** Each one is checked by sysmon every 20 µs. Bounded I/O helps.
- **Fewer long-running goroutines.** Sysmon checks for preemption. With short-lived gs, it has less to do.
- **`GODEBUG=asyncpreemptoff=1`** disables async preemption — *not recommended*. Sysmon still runs but does less.

For 99% of services, sysmon is invisible. Worry only if profiling shows >1% time in sysmon.

---

## Profile-Driven Pool Sizing

The right semaphore / pool size depends on workload and hardware. Methodology:

1. **Pick a starting size**: `NumCPU` for CPU-bound; `disk parallelism` for I/O.
2. **Measure baseline**: throughput, p50, p99 latency at the start.
3. **Increase**: double the size; remeasure.
4. **Continue** until throughput plateaus or latency degrades.
5. **Back off** to the last good size.

For example, disk pool sizing:

| Pool size | Throughput | p99 latency | Threads |
|---|---|---|---|
| 1 | 100 ops/s | 10 ms | 5 |
| 4 | 400 ops/s | 10 ms | 8 |
| 8 | 600 ops/s | 15 ms | 12 |
| 16 | 700 ops/s | 30 ms | 20 |
| 32 | 720 ops/s | 80 ms | 36 |
| 64 | 720 ops/s | 200 ms | 70 |

At 8, throughput is 600 ops/s with good latency. At 16, throughput rises to 700 but latency doubles. At 32, throughput is flat but latency triples. Sweet spot: 8 (good balance) or 16 (more throughput, tolerable latency). 32+ is a regression.

Re-run this analysis when:

- Hardware changes (new disk, new node).
- Workload changes (larger objects, different access pattern).
- Go version changes (rare but possible).

---

## Diminishing Returns and Anti-Optimisations

Some "optimisations" that often backfire:

**Caching `time.Now()` globally.**

```go
var now atomic.Int64
func init() {
    go func() {
        for {
            now.Store(time.Now().UnixNano())
            time.Sleep(time.Millisecond)
        }
    }()
}
```

VDSO `time.Now()` is ~20 ns. The cache costs more (atomic load is ~5 ns, but you also have stale time and a goroutine running forever). Skip.

**Disabling async preemption.**

```bash
GODEBUG=asyncpreemptoff=1
```

Removes preemption overhead but breaks long-running CPU loops. Almost always wrong.

**`runtime.Gosched()` in hot loops.**

```go
for i := 0; i < N; i++ {
    work(i)
    runtime.Gosched() // unnecessary in Go 1.14+
}
```

Async preemption handles fairness. `Gosched` adds overhead.

**Bumping `GOMAXPROCS` above `NumCPU`.**

```go
runtime.GOMAXPROCS(64) // on a 16-core machine
```

More Ps than cores means some are idle. Context-switch cost rises. Almost always a regression.

**Pinning every goroutine.**

```go
go func() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    doWork()
}()
```

Locks more Ms than necessary, prevents migration, may deadlock under `GOMAXPROCS` pressure. Pin only goroutines that need thread affinity.

**Calling `runtime.GC()` periodically to "smooth" pauses.**

Forces full GC at the wrong time. Trust the runtime's adaptive triggering.

**Avoiding the netpoller "to reduce overhead".**

The netpoller has lower overhead than any alternative for many fds. Always prefer it.

---

## Summary

Optimisation of syscall handling is mostly **bounding** and **batching**:

1. **Bound concurrency** for syscalls and cgo — semaphores or worker pools. The single highest-impact optimisation.
2. **Batch syscalls** — large reads instead of many small ones; `writev` for multi-buffer writes; `sendfile` for file-to-socket.
3. **Buffer I/O** — `bufio.Reader`/`bufio.Writer` everywhere.
4. **Prefer netpoller-backed primitives** — sockets over pipes, `<-time.After` over `time.Sleep` loops.
5. **Pool connections** — `http.Transport`, `sql.DB` settings.
6. **Trust VDSO** — `time.Now()` is fast.
7. **Avoid anti-optimisations** — don't disable preemption, don't pin everything, don't cache time.
8. **Profile-driven sizing** — measure throughput and latency at multiple sizes; pick the knee.

These together reduce CPU usage, latency, and thread count by 5–10× in typical Go services. Most are one-line changes.

The next page (specification) and the rest of this section's documents (interview, tasks, find-bug) tie this material into interview prep, hands-on exercises, and production debugging. Read across all of them; the same patterns recur.
