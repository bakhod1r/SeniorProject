# Syscall Handling — Find the Bug

## Table of Contents
1. [How to Use This Page](#how-to-use-this-page)
2. [Bug 1: Unbounded Cgo Concurrency](#bug-1-unbounded-cgo-concurrency)
3. [Bug 2: `LockOSThread` Without Unlock](#bug-2-lockosthread-without-unlock)
4. [Bug 3: File I/O Storm Under Burst Load](#bug-3-file-io-storm-under-burst-load)
5. [Bug 4: DNS Resolver Holding Threads](#bug-4-dns-resolver-holding-threads)
6. [Bug 5: A Panic in a Pinned Worker](#bug-5-a-panic-in-a-pinned-worker)
7. [Bug 6: Hung Goroutine on a Network Read](#bug-6-hung-goroutine-on-a-network-read)
8. [Bug 7: `GOMAXPROCS` Not Honouring Container Limit](#bug-7-gomaxprocs-not-honouring-container-limit)
9. [Bug 8: Stale Cached Time](#bug-8-stale-cached-time)
10. [Bug 9: `os/exec` Causing Visible Thread Spikes](#bug-9-osexec-causing-visible-thread-spikes)
11. [Bug 10: Signals Lost When All Ms Are in Syscalls](#bug-10-signals-lost-when-all-ms-are-in-syscalls)
12. [Bug 11: Crash on `pids.max` Exhaustion](#bug-11-crash-on-pidsmax-exhaustion)
13. [Bug 12: M Pool Growth from `LockOSThread` in Library Code](#bug-12-m-pool-growth-from-lockosthread-in-library-code)
14. [Common Patterns and Heuristics](#common-patterns-and-heuristics)

---

## How to Use This Page

Each bug is a real or realistic failure mode tied to the syscall path. Read the symptoms first; try to diagnose before reading the solution.

If you cannot diagnose: read the "what to look at" section, follow the steps, and arrive at the fix.

Each bug ends with a takeaway you can apply to your own code.

---

## Bug 1: Unbounded Cgo Concurrency

**Symptoms**:
- HTTP service backed by a cgo-using image processing library.
- Under burst load, thread count climbs from ~20 to ~800 in seconds.
- p99 latency spikes; some requests fail with "out of memory" or "thread limit exceeded".
- After load ends, threads slowly drop back to ~50, then plateau.

**Code**:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    body, _ := io.ReadAll(r.Body)
    out := C.process_image(unsafe.Pointer(&body[0]), C.int(len(body)))
    w.Write(C.GoBytes(unsafe.Pointer(out), C.int(C.outlen())))
}
```

**What to look at**:
- `/proc/<pid>/status` thread count during the spike.
- `pprof.threadcreate` showing many M creations.
- Goroutine dump showing many goroutines in `runtime.cgocall`.

**Diagnosis**:
Every concurrent HTTP request invokes a cgo call that holds an M for ~50 ms. At 1000 RPS sustained, ~50 Ms in flight at all times. Burst to 10× load: 500 Ms briefly. Plus M-pool retention. Plus container overhead.

**Fix**:

```go
var cgoSem = make(chan struct{}, 32)

func handle(w http.ResponseWriter, r *http.Request) {
    select {
    case cgoSem <- struct{}{}:
    case <-r.Context().Done():
        http.Error(w, "too busy", http.StatusServiceUnavailable)
        return
    }
    defer func() { <-cgoSem }()

    body, _ := io.ReadAll(r.Body)
    out := C.process_image(unsafe.Pointer(&body[0]), C.int(len(body)))
    w.Write(C.GoBytes(unsafe.Pointer(out), C.int(C.outlen())))
}
```

**Takeaway**: **Always bound cgo concurrency**. The semaphore is one of the most important patterns in production Go services.

---

## Bug 2: `LockOSThread` Without Unlock

**Symptoms**:
- Thread count grows linearly over hours, never drops.
- Service eventually OOMs or crashes with "thread exhaustion".
- Restart fixes it temporarily; bug returns.

**Code**:

```go
func renderFrame(scene *Scene) ([]byte, error) {
    runtime.LockOSThread() // bind to a GL context
    glContext.Use()
    output := glContext.Render(scene)
    return output, nil
    // missing UnlockOSThread
}
```

**What to look at**:
- `pprof.goroutine?debug=2` shows many goroutines blocked in `runtime.gopark` from `runtime.LockOSThread`-derived state — actually, the goroutines exit, but the Ms linger.
- `pprof.threadcreate` shows steady M creation.

**Diagnosis**:
Each call to `renderFrame` locks but never unlocks. When the goroutine exits (the function returns), the runtime detects the unmatched lock and *destroys* the M. The M is gone but a new one is created next time. Repeated `renderFrame` calls keep creating and destroying threads — a churn problem.

In a worse variant, if the runtime keeps the thread alive (e.g., it's in the pool but flagged as compromised), the threads accumulate.

**Fix**:

```go
func renderFrame(scene *Scene) ([]byte, error) {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    glContext.Use()
    return glContext.Render(scene), nil
}
```

**Takeaway**: **Every `LockOSThread` must have a matching `UnlockOSThread`**, almost always via `defer`. Code review should flag unmatched calls.

---

## Bug 3: File I/O Storm Under Burst Load

**Symptoms**:
- Log-processing service reads many files from disk.
- Under burst, latency p99 jumps from 50 ms to 5 s.
- Thread count climbs from 10 to ~150.
- Disk iostat shows queue depth of ~200.

**Code**:

```go
func processFiles(paths []string) {
    var wg sync.WaitGroup
    for _, p := range paths {
        wg.Add(1)
        go func(path string) {
            defer wg.Done()
            data, _ := os.ReadFile(path)
            process(data)
        }(p)
    }
    wg.Wait()
}
```

**What to look at**:
- iostat: disk queue depth growing.
- Goroutine dump: many in `syscall.Read`.
- `vmstat`: high context switches per second.

**Diagnosis**:
Each `os.ReadFile` opens, reads, closes — three syscalls, each potentially triggering handoff. With 1000 files in parallel, ~1000 in-flight reads, ~1000 Ms held in syscalls. The disk cannot service them in parallel anyway (HDD has ~1, SSD ~4–32). The result: massive M overhead with no throughput gain.

**Fix**:

```go
func processFiles(paths []string) {
    sem := make(chan struct{}, 8) // disk parallelism
    var wg sync.WaitGroup
    for _, p := range paths {
        wg.Add(1)
        sem <- struct{}{}
        go func(path string) {
            defer wg.Done()
            defer func() { <-sem }()
            data, _ := os.ReadFile(path)
            process(data)
        }(p)
    }
    wg.Wait()
}
```

**Takeaway**: **Bound file I/O to disk parallelism**. More goroutines doing I/O do not equal more throughput; they only inflate thread count.

---

## Bug 4: DNS Resolver Holding Threads

**Symptoms**:
- Service makes many outbound HTTP calls.
- Thread count is high (~100) for what looks like network-bound work.
- Removing one specific call site (a `http.Client.Get` to an external host) drops thread count to 20.

**What to look at**:
- Goroutine dump: many goroutines in `runtime.cgocall` → `internal/syscall/unix.Getaddrinfo`.
- Confirms: DNS lookups going through cgo (libc's `getaddrinfo`).

**Diagnosis**:
On macOS (and Linux in some configurations), Go's default DNS resolver uses cgo to call `getaddrinfo`. Each lookup holds an M. Under high concurrent outbound traffic, you get one M per simultaneous DNS lookup.

**Fix**:

Force the pure-Go resolver:

```bash
GODEBUG=netdns=go ./service
```

Or programmatically:

```go
import "net"

// At init:
net.DefaultResolver.PreferGo = true
```

The pure-Go resolver uses non-blocking socket reads via the netpoller — no Ms held.

**Takeaway**: **DNS can secretly use cgo**. Check with `GODEBUG=netdns=2` for verbose output. Set `netdns=go` for predictable behaviour.

---

## Bug 5: A Panic in a Pinned Worker

**Symptoms**:
- Pinned cgo worker pool occasionally panics.
- Service continues but slow degradation: each panic seems to leak resources.
- Thread count creeps up over days.

**Code**:

```go
func (w *worker) run() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for job := range w.jobs {
        result := C.process(job.input)
        w.results <- result
    }
}
```

The C code occasionally crashes (`SIGSEGV` from a bug in the library). The Go runtime turns it into a panic.

**What to look at**:
- Logs showing `runtime error: invalid memory address` or `cgo: bad result`.
- After each crash: thread count + 1 (the M is destroyed but replaced by a new worker spawn).

**Diagnosis**:
The `defer runtime.UnlockOSThread()` runs on panic, releasing the lock. But the M is now compromised: its `g0` stack was unwound through C code. The runtime usually destroys such Ms.

The supervisor (likely `errgroup` or similar) restarts the worker, which creates a new M. Repeated panics = repeated M creation/destruction = thread churn.

The real bug is the C library crash, but the symptom is thread state.

**Fix**:

1. **Fix the C library or wrap it defensively.**
2. **Do not let the goroutine panic to the top of `run()`.** Catch and recover:

```go
func (w *worker) run() {
    runtime.LockOSThread()
    defer runtime.UnlockOSThread()
    for job := range w.jobs {
        func() {
            defer func() {
                if r := recover(); r != nil {
                    log.Printf("worker panic: %v", r)
                    w.results <- ErrorResult{err: fmt.Errorf("crash")}
                }
            }()
            result := C.process(job.input)
            w.results <- result
        }()
    }
}
```

Now a single bad input does not destroy the M; the loop continues.

**Takeaway**: **Recover panics inside pinned workers**, especially around cgo calls.

---

## Bug 6: Hung Goroutine on a Network Read

**Symptoms**:
- Service has long-lived TCP connections to internal backends.
- Some connections appear "stuck": no read/write for hours.
- Goroutine count grows over weeks.

**Code**:

```go
func handleConn(c net.Conn) {
    defer c.Close()
    buf := make([]byte, 1024)
    for {
        n, err := c.Read(buf)
        if err != nil {
            return
        }
        process(buf[:n])
    }
}
```

**What to look at**:
- Goroutine dump shows many in `internal/poll.(*FD).Read`.
- `ss -ti` on the connections: sender died, no FIN sent.
- TCP keepalive disabled (default on Linux).

**Diagnosis**:
The peer disappeared without closing. No TCP segments arrive. The fd is "open" from the kernel's perspective; `epoll` will never report it ready. The goroutine parks forever in the netpoller.

This is *not* an M leak (the netpoller doesn't hold Ms). It is a goroutine leak.

**Fix**:

Add a read deadline:

```go
func handleConn(c net.Conn) {
    defer c.Close()
    buf := make([]byte, 1024)
    for {
        c.SetReadDeadline(time.Now().Add(30 * time.Second))
        n, err := c.Read(buf)
        if err != nil {
            return
        }
        process(buf[:n])
    }
}
```

Or enable TCP keepalive:

```go
if tc, ok := c.(*net.TCPConn); ok {
    tc.SetKeepAlive(true)
    tc.SetKeepAlivePeriod(30 * time.Second)
}
```

**Takeaway**: **Network reads can hang silently**. Always have a deadline strategy. Goroutines parked in the netpoller cost only memory but accumulate without bound if connections are abandoned.

---

## Bug 7: `GOMAXPROCS` Not Honouring Container Limit

**Symptoms**:
- Go service in Kubernetes pod with `cpu: 500m` (half a core).
- CPU usage spikes to 800% on a 16-core node.
- Latency erratic; throttled by k8s CFS.

**What to look at**:
- `runtime.GOMAXPROCS(0)` at startup logs.
- Pod CPU usage from `kubectl top pod`.
- Cgroup quota: `cat /sys/fs/cgroup/cpu.max`.

**Diagnosis**:
Pre-Go 1.16, the runtime ignored cgroups. `GOMAXPROCS` returned `runtime.NumCPU()` = 16. The pod was throttled hard by the kernel CFS quota, causing latency spikes.

**Fix**:

Upgrade to Go 1.16+ (Linux cgroup v2 support).

For older Go or non-Linux:

```go
import _ "go.uber.org/automaxprocs"
```

Reads cgroup at init time and sets `GOMAXPROCS` correctly.

**Takeaway**: **Always log `GOMAXPROCS` at startup**. It is the most common scheduler misconfiguration in containers.

---

## Bug 8: Stale Cached Time

**Symptoms**:
- Service logs show wall-clock times that occasionally jump by ~1 second.
- Two timestamps recorded a few µs apart can differ by 100 ms.
- Time-based metrics are unreliable.

**Code**:

```go
var lastTime time.Time
var mu sync.Mutex

func recordEvent(name string) {
    mu.Lock()
    lastTime = time.Now()
    mu.Unlock()
    log.Printf("%s at %v", name, lastTime)
}
```

**What to look at**:
- NTP / chrony logs: large clock corrections (e.g., `step` operations).
- Compare `time.Now()` (wall clock) vs `time.Now().UnixNano()` patterns.

**Diagnosis**:
`time.Now()` returns wall-clock time, which can step on NTP correction or when the system suspends/resumes. VDSO reads a shared kernel page that the kernel updates atomically, but the *underlying* wall clock can jump.

For interval measurement, you want monotonic time. Go's `time.Now()` carries a monotonic component (added in Go 1.9), but it's only used for `time.Since` and comparisons, not for printing.

**Fix**:

For intervals, use `time.Since`:

```go
start := time.Now()
// ... work ...
elapsed := time.Since(start) // uses monotonic component
```

For wall-clock logging, accept that NTP corrections happen; do not infer durations from wall-clock diffs.

For high-precision interval timing, use `runtime.nanotime()` (not public; access via `time.Now()` and `time.Since`).

**Takeaway**: **VDSO does not make time monotonic**. NTP correction can step wall time. Use `time.Since` for durations.

---

## Bug 9: `os/exec` Causing Visible Thread Spikes

**Symptoms**:
- Service does occasional `os/exec.Cmd.Run` (e.g., shelling out to a CLI).
- Thread count briefly spikes from 20 to ~50.
- `ps -L` shows many short-lived threads with the parent process's PID.

**What to look at**:
- `strace -f -e clone` on the parent: many `clone(2)` calls around exec time.
- `pprof.threadcreate` shows spikes near exec call sites.

**Diagnosis**:
`os.exec.Cmd.Run` calls `fork+exec` on Linux (more accurately, `clone` with specific flags then `execve`). Before exec replaces the child's image, the child briefly has all the parent's Ms (because `clone` shared memory; the parent's threads are part of the same memory). This shows briefly in `ps`.

Once the child execs, those "threads" are replaced. Mostly cosmetic.

The real cost is `clone` itself, which is ~50–500 µs.

**Fix**:

Usually no fix needed — it's cosmetic. If you exec heavily:

- Pool subprocesses with `os.exec.Cmd.Start` and reuse via pipes.
- Move work to in-process Go code if possible.

**Takeaway**: **`os/exec` is expensive but the visible thread spike is mostly harmless**. The real cost is fork latency. Avoid spawning in inner loops.

---

## Bug 10: Signals Lost When All Ms Are in Syscalls

**Symptoms**:
- Service registered `SIGTERM` handler for graceful shutdown.
- Under heavy load, `SIGTERM` is sometimes ignored for ~10 seconds before shutdown begins.

**Code**:

```go
func main() {
    sig := make(chan os.Signal, 1)
    signal.Notify(sig, syscall.SIGTERM)
    go func() {
        <-sig
        log.Println("shutting down")
        // ... shutdown logic ...
    }()
    runServer()
}
```

**What to look at**:
- Goroutine dump at the moment SIGTERM arrives.
- Many Ms in cgo or file I/O.

**Diagnosis**:
Linux delivers signals to *some* thread of the process. If all Ms are in syscalls or cgo, the signal handler runs only after a syscall returns. Under heavy load this can be ~milliseconds; under pathological load with all Ms in slow cgo, it can be seconds.

Additionally, the signal-handling goroutine itself needs an M and a P to receive from the channel. If no M is free, the goroutine cannot run.

**Fix**:

- Bound cgo and file I/O so that some Ms are usually free.
- Set `GOGC=off` during shutdown if GC is interfering.
- Use a separate dedicated signal-handling thread:

```go
go func() {
    runtime.LockOSThread()
    for {
        <-sig
        // handle
    }
}()
```

(In practice, the locked-thread approach is uncommon; usually bounding concurrency is enough.)

**Takeaway**: **Signal latency is a function of M availability**. Bound your syscall-holding work so signals can be delivered promptly.

---

## Bug 11: Crash on `pids.max` Exhaustion

**Symptoms**:
- Service runs fine for hours, then crashes:
  ```
  runtime: failed to create new OS thread (have 4096 already; errno=11)
  runtime: may need to increase max user processes (ulimit -u)
  fatal error: newosproc
  ```

**What to look at**:
- Container `pids.max`: `cat /sys/fs/cgroup/pids.max` (typically 4096 or similar).
- `runtime.NumGoroutine()` and thread count at crash time.

**Diagnosis**:
The container's `pids.max` is exhausted. Go is trying to `clone(2)` but the kernel returns `EAGAIN`. The runtime panics.

Root cause is almost always one of:

- Unbounded cgo concurrency.
- Unbounded `LockOSThread` use.
- A library spawning many threads via cgo.

**Fix**:

1. **Find the root cause**: use `pprof.threadcreate` to identify where Ms are spawned.
2. **Bound concurrency** at the call site.
3. **Temporarily raise** `pids.max` in the pod spec while you investigate.
4. **Possibly** raise `runtime.SetMaxThreads(N)` if you legitimately need more.

**Takeaway**: **`pids.max` panics are bound failures, not capacity failures**. Find the unbounded call site.

---

## Bug 12: M Pool Growth from `LockOSThread` in Library Code

**Symptoms**:
- Service uses a third-party library that uses `LockOSThread` internally.
- Thread count grows steadily over days.
- No obvious user code at fault.

**What to look at**:
- `pprof.threadcreate`: shows M-creation stack traces in `vendor/<library>/...`.
- Library source: search for `runtime.LockOSThread`.

**Diagnosis**:
Some libraries (e.g., older OpenGL bindings, GUI toolkits, certain database drivers) lock their internal goroutines. If those goroutines are created per-operation rather than pooled, each operation locks an M.

Common offenders:

- GUI libraries (gtk, qt bindings).
- Some game engines.
- Older versions of CGo wrappers around thread-affine C libraries.

**Fix**:

- File an issue with the library author.
- Wrap the library in a pooled worker pattern (you own a fixed number of locked workers; library calls are routed through them).
- If unfixable: bound the rate of operations that trigger the lock.

**Takeaway**: **Read library source for `LockOSThread`** if you suspect M leaks. It is not always your code.

---

## Common Patterns and Heuristics

After 12 bugs, these patterns emerge:

1. **Thread count climbing = unbounded syscall or cgo concurrency.** Bound it.
2. **Latency spikes under burst = no backpressure**. Either bound concurrency or shed load at the front.
3. **`SIGTERM` slow = no free Ms**. Same fix: bound the bulk consumers of Ms.
4. **DNS slow = cgo resolver**. Switch to pure-Go resolver.
5. **Hung connections = no read deadlines**. Always have a timeout strategy.
6. **`GOMAXPROCS` wrong = container misconfiguration**. Log it; use automaxprocs if needed.
7. **`LockOSThread` without unlock = M destruction**. Always defer the unlock.
8. **Panics in cgo workers = recover them**. The C library may misbehave; do not let it kill the M.
9. **`time.Now()` jumping = NTP step**. Use `time.Since` for durations.
10. **`pids.max` exhaustion = look at `pprof.threadcreate`**. Find the offender.

### Diagnostic toolkit

When in doubt, run these in order:

```bash
# 1. Current state
cat /proc/$(pgrep myprog)/status | grep -E '(Threads|VmRSS)'
GODEBUG=schedtrace=1000 ./myprog &  # if you can restart

# 2. Goroutine snapshot
curl localhost:6060/debug/pprof/goroutine?debug=2 > goroutines.txt

# 3. Thread create profile
curl localhost:6060/debug/pprof/threadcreate > threadcreate.pprof
go tool pprof -http=:8080 threadcreate.pprof

# 4. Strace (sparingly; expensive)
strace -p $(pgrep myprog) -c -e trace=clone,read,write,openat
```

These four steps catch ~90% of syscall-related production bugs.

### When to escalate

You should escalate to a Go-runtime expert when:

- Bug only reproduces in production, never in test.
- Profile shows unusual time in runtime internals (`runtime.findRunnable`, `runtime.schedule`).
- You suspect a kernel bug (`epoll` behaving weirdly, `clone` returning unexpected errors).

Most syscall bugs are *not* runtime bugs — they are bounded-concurrency bugs in user code. The fix is almost always: add a semaphore.
