# Go Runtime Architecture — Find the Bug

Fourteen architecture-level traps. Each one assumes the Go runtime works like a "normal" program runtime — a single boot order, fork-safe processes, OS-managed threads, panics that stay local, GC you can turn off. The runtime is none of those things: it has its own scheduler bolted on top of the OS, its own signal discipline (SIGURG for async preemption), a cgo boundary that flips between Go and C stacks, and a scavenger that returns memory to the OS lazily. When code violates one of those invariants, the symptom usually appears far from the cause — a container that uses 1/8 of the CPUs, a binary that's 30 MB bigger than expected, a child process that hangs after fork.

Read each snippet, form a hypothesis about which runtime subsystem is being abused, then open the hint and diagnosis.

---

### Bug 1: Goroutine spawned from `init()` blocks on a channel

**Difficulty:** Mid
**Skills:** Boot order, package initialization, scheduler readiness

```go
package main

import "fmt"

var ready = make(chan struct{})
var result int

func init() {
    go func() {
        // wait for main to signal
        <-ready
        result = 42
    }()
    // main hasn't started yet; we expect it to close `ready`
    <-ready // BUG: init() blocks waiting for itself
    fmt.Println("init done:", result)
}

func main() {
    close(ready)
}
```

**Observed behavior:** Program hangs at startup with `fatal error: all goroutines are asleep - deadlock!` before `main` ever runs.

<details><summary>Hint</summary>

When does `main` get called relative to `init()`? Can `main` run while *any* `init` is still executing?

</details>

**Diagnosis:** The Go runtime boot sequence is strict: `runtime.main` runs all package `init` functions sequentially on the main goroutine, *then* calls `main.main`. While `init()` is blocked on `<-ready`, `main.main` has not been invoked yet, so nothing will ever `close(ready)`. The goroutine spawned inside `init` is scheduled but also blocked on the same channel. The scheduler sees every goroutine parked and panics with deadlock.

This is a misunderstanding of the runtime's bootstrap: `init` is not "code that runs in parallel with main" — it's a phase that must complete before `main` exists as a runnable goroutine. Spawning goroutines from `init` is fine, but `init` itself must return promptly.

**Fix:** Don't block in `init`. Either do the work synchronously, or move the rendezvous into `main`.

```go
func init() {
    go func() {
        <-ready
        result = 42
    }()
}

func main() {
    close(ready)
    // ... wait for result via another signal if needed
}
```

---

### Bug 2: Package-level variable initialized using `runtime.NumCPU()` under `-buildmode=plugin`

**Difficulty:** Senior
**Skills:** Package init ordering, plugin loading, runtime singleton

```go
package worker

import "runtime"

// computed once at package init in the *host* process
var workerCount = runtime.NumCPU()

func Pool() int { return workerCount }
```

Built as a plugin and loaded later:

```go
// host
import "plugin"

func main() {
    runtime.GOMAXPROCS(2) // host pins itself to 2 cores
    p, _ := plugin.Open("worker.so")
    sym, _ := p.Lookup("Pool")
    n := sym.(func() int)()
    fmt.Println("workers:", n) // prints 16 on a 16-core box, not 2
}
```

**Observed behavior:** Plugin spawns 16 workers even though the host explicitly limited itself to 2 cores. On a containerized 2-CPU host, the plugin still sees the underlying physical 16.

<details><summary>Hint</summary>

When does the plugin's package-level variable get evaluated — at host startup, at `plugin.Open`, or at first call? And whose `runtime` does it use?

</details>

**Diagnosis:** Go plugins share the *host's* runtime — there's only one `runtime` package per process — but the plugin's package `init` runs at `plugin.Open` time, not at host startup. The expression `runtime.NumCPU()` evaluates at that moment, returning the kernel's view of CPU count, which is unaffected by the host's `GOMAXPROCS` setting (`NumCPU` reports physical/cgroup CPUs, `GOMAXPROCS` is the scheduler's P count).

Worse, package-level initializers assuming a particular call order break under plugins because the plugin's init phase happens *after* the host's `main` has already started. Anything that depends on host runtime state established in `main` (like a custom `GOMAXPROCS`) is invisible to the plugin's package-level expressions if evaluation precedes the host setting it — and equally fragile if the host changes the setting later.

**Fix:** Don't bake runtime-derived constants into package-level variables. Compute them lazily, and read `GOMAXPROCS` (the scheduler-visible count) not `NumCPU`:

```go
var (
    once         sync.Once
    workerCount  int
)

func Pool() int {
    once.Do(func() {
        workerCount = runtime.GOMAXPROCS(0)
    })
    return workerCount
}
```

---

### Bug 3: Cgo callback running on a non-Go thread crashes

**Difficulty:** Senior
**Skills:** Cgo boundary, thread state, `cgocallback`

```go
package main

/*
#include <pthread.h>
extern void goCallback(int);

static void* worker(void* arg) {
    goCallback(42);   // called from a pthread the Go runtime never saw
    return NULL;
}

static void start_thread() {
    pthread_t t;
    pthread_create(&t, NULL, worker, NULL);
    pthread_join(t, NULL);
}
*/
import "C"
import "fmt"

//export goCallback
func goCallback(v C.int) {
    fmt.Println("got", v)
}

func main() {
    C.start_thread()
}
```

**Observed behavior:** Random crash, often `runtime: g0 stack [...] not in usable range`, or a SIGSEGV inside `runtime.asmcgocall`. Sometimes "fatal error: bad g in cgocallback".

<details><summary>Hint</summary>

Go callbacks expect to enter the runtime through a specific assembly trampoline. What does that trampoline assume about the thread it's running on?

</details>

**Diagnosis:** When C code calls back into Go via an `//export`'d function, the runtime needs an `m` (machine, i.e. OS-thread descriptor) and a `g0` (system goroutine) attached to that thread. On a thread Go knows about (one it created, or one that previously entered Go), this is set up via thread-local storage. The C thread created by raw `pthread_create` was never touched by Go — it has no TLS slot, no `m`, no `g0`. The cgo callback trampoline (`crosscall2` → `cgocallback`) dereferences these and segfaults.

The runtime *does* support callbacks from foreign threads, but only when the thread enters via `cgocallback`'s "needm" path, which is triggered when the runtime detects no `g` is attached. This works for threads spawned indirectly through Go (e.g. a Go call that called into C that called back). It does *not* work reliably when C spawns a thread completely on its own and that thread's first runtime contact is a Go callback — the symptoms here suggest a runtime that didn't establish an `m` in time, or did but lost state across the join.

**Fix:** Either make the thread enter Go first (so `needm` runs and an `m` is allocated for it), or marshal the work back through a channel from a goroutine that already owns a runtime thread:

```go
var work = make(chan int, 64)

//export postWork
func postWork(v C.int) {
    select {
    case work <- int(v):
    default:
    }
}

func main() {
    go func() {
        for v := range work {
            fmt.Println("got", v)
        }
    }()
    C.start_thread()
}
```

C now calls `postWork` only after entering Go through a normal cgo call site at least once, and the heavy work happens on a goroutine the scheduler owns.

---

### Bug 4: Signal handler in C code clobbers SIGURG

**Difficulty:** Senior
**Skills:** Signal handling, async preemption, runtime/C interop

```go
package main

/*
#include <signal.h>
#include <stdio.h>

static void my_handler(int sig) {
    printf("caught %d\n", sig);
}

static void install() {
    struct sigaction sa = {0};
    sa.sa_handler = my_handler;
    sigfillset(&sa.sa_mask);
    sigaction(SIGURG, &sa, NULL);   // BUG: SIGURG is Go's preemption signal
}
*/
import "C"

func main() {
    C.install()
    busyLoop()
}

func busyLoop() {
    for {
        // tight loop with no function calls
        _ = 1
    }
}
```

**Observed behavior:** Goroutines doing tight loops never yield. `runtime.GC()` triggered from another goroutine hangs. With Go 1.14+'s async preemption disabled implicitly, scheduling becomes cooperative again, latency spikes appear.

<details><summary>Hint</summary>

Since Go 1.14, the runtime preempts tight loops by sending a signal to the goroutine's thread. Which signal does it use, and what happens when a C library installs its own handler for it?

</details>

**Diagnosis:** Go 1.14 added asynchronous preemption: when a goroutine has been running too long without a safepoint (e.g. an inlined tight loop with no function-call preemption check), the sysmon thread sends `SIGURG` to the target's OS thread. The Go signal handler injects a synthetic call to `asyncPreempt`, which saves register state and returns to the scheduler.

The reason `SIGURG` was chosen: it's almost never used by anything else on modern systems (out-of-band TCP data is rare and goes elsewhere). But "almost never" is not "never." When C code installs its own `sigaction` for `SIGURG`, it overwrites the Go handler's entry. The kernel now delivers `SIGURG` to `my_handler`, which prints a message and returns. The goroutine is never preempted. Long tight loops monopolize the P, blocking GC stop-the-world phases (which need every P to reach a safepoint).

**Fix:** Don't install handlers for `SIGURG` from C. If you must intercept it, use `sigaction` to *chain* to Go's handler by saving the old action and calling it from yours. The safest path is to use the `os/signal.Notify` API entirely on the Go side.

```c
static struct sigaction old_urg;

static void my_handler(int sig, siginfo_t *info, void *ctx) {
    // chain to Go's handler
    if (old_urg.sa_flags & SA_SIGINFO) {
        old_urg.sa_sigaction(sig, info, ctx);
    } else if (old_urg.sa_handler != SIG_DFL && old_urg.sa_handler != SIG_IGN) {
        old_urg.sa_handler(sig);
    }
}
```

Better: pick a different signal (`SIGRTMIN+n`) for your own purposes.

---

### Bug 5: `os.Exec` replacement of binary doesn't trigger Go runtime cleanup

**Difficulty:** Mid
**Skills:** Process lifecycle, runtime teardown, file descriptors

```go
package main

import (
    "os"
    "syscall"
)

func main() {
    // open a bunch of files
    for i := 0; i < 100; i++ {
        f, _ := os.Open("/etc/hosts")
        _ = f // no close — relying on "exit cleans up"
    }

    // re-exec ourselves with a flag, expecting cleanup
    syscall.Exec(os.Args[0], append(os.Args, "--restarted"), os.Environ())
}
```

**Observed behavior:** After `syscall.Exec`, the new process image still holds 100 open file descriptors against `/etc/hosts`. `lsof -p $PID` shows them. Eventually `Open` returns `EMFILE`.

<details><summary>Hint</summary>

What's the difference between `os.Exit`, the program returning from `main`, and `syscall.Exec`? Which of these run finalizers, deferred functions, or GC?

</details>

**Diagnosis:** `syscall.Exec` is a raw wrapper over the `execve(2)` syscall. It replaces the process image in-place — same PID, same open file descriptors (unless they have `FD_CLOEXEC` set), same memory mappings (briefly, before being overwritten). It does *not* unwind the Go stack, *not* run deferred functions, *not* run finalizers, *not* close `*os.File` objects, *not* invoke `runtime.GC`.

Go's `*os.File` close happens in two places: explicit `f.Close()` and a `runtime.SetFinalizer` on garbage collection. Neither runs across `execve`. The kernel preserves open FDs across exec by design (it's how shells pass stdio to children). The new process image starts with all of them still open, with no Go-side ownership — they're leaked file descriptors with no way to recover.

The general principle: the Go runtime's teardown logic (finalizers, `os.File` close, network poller cleanup) runs on *normal* exit paths (`os.Exit`, `return from main`, panic-to-`runtime.exit`). `syscall.Exec` bypasses all of them.

**Fix:** Either close FDs explicitly before exec, or set `O_CLOEXEC` on every open and let the kernel close them at exec time. Go's `os.Open` sets `O_CLOEXEC` by default on modern platforms — but if you opened via raw `syscall.Open` without `O_CLOEXEC`, those FDs survive. If you must exec, audit every FD path:

```go
// before exec:
for _, f := range openFiles {
    f.Close()
}
syscall.Exec(...)
```

---

### Bug 6: Static linking with cgo creates a massive binary

**Difficulty:** Mid
**Skills:** Linker modes, cgo, static vs dynamic linking

```go
package main

/*
#include <openssl/sha.h>
*/
import "C"
import "fmt"

func main() {
    var h [C.SHA256_DIGEST_LENGTH]C.uchar
    data := []byte("hi")
    C.SHA256((*C.uchar)(&data[0]), C.size_t(len(data)), &h[0])
    fmt.Printf("%x\n", h)
}
```

Built with:

```
go build -ldflags '-linkmode external -extldflags "-static"' -o app
```

Expecting: a small static binary like a pure-Go program.
Reality: 25 MB binary, complains about missing static libssl, or pulls glibc statically and won't run on a musl host.

**Observed behavior:** Build either fails (`cannot find -lssl`, `libpthread.a not found`), or succeeds with a binary several times larger than expected. Distributing the binary to a slightly different Linux fails with "version `GLIBC_2.34' not found" or NSS-related runtime errors.

<details><summary>Hint</summary>

When cgo is involved, who does the final link? What does "statically linked" mean for a glibc-based binary?

</details>

**Diagnosis:** Pure Go binaries are statically linked by default — the Go toolchain emits machine code and links it with its own runtime; no external linker needed. Once cgo is in play, the *external* linker (system `ld`) is invoked to combine Go's objects with C objects and external libraries. Now you're subject to all of C's linker realities:

1. `-static` against glibc is technically possible but glibc's NSS subsystem (`getaddrinfo`, user/group lookups) loads `.so` plugins at runtime — statically linking glibc breaks DNS and produces warnings like "statically linked applications requires at runtime the shared libraries from the glibc version used for linking."
2. OpenSSL's static libraries are often not shipped by distros; you get link failures.
3. Even when it works, you pull in C runtime initialization, glibc internals, and ssl, ballooning the binary.

The assumption "Go binaries are always statically linked" is a half-truth. It holds for *pure Go*. The moment any cgo call sneaks in — via `net` resolving names through cgo (the default unless `netgo` build tag is set), via `os/user`, via any C dependency — the binary is dynamically linked against libc.

**Fix:** If you need a truly static binary, build with the pure-Go alternatives:

```
CGO_ENABLED=0 go build -tags 'netgo osusergo' -o app
```

If cgo is required (you need OpenSSL), accept dynamic linking or build against musl (e.g. via an Alpine builder):

```
CC=musl-gcc go build -ldflags '-linkmode external -extldflags "-static"' -o app
```

---

### Bug 7: `runtime.GOMAXPROCS` set in `init()` before parsing cgroup limits

**Difficulty:** Senior
**Skills:** GOMAXPROCS, cgroup CPU quotas, init ordering

```go
package main

import (
    "runtime"
    "fmt"
)

func init() {
    // "use all CPUs we can see"
    runtime.GOMAXPROCS(runtime.NumCPU())
}

func main() {
    fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
    // ...heavy work
}
```

Running in a Kubernetes pod with `resources.limits.cpu: "2"` on a 64-core host.

**Observed behavior:** Process runs with `GOMAXPROCS=64`, creating 64 schedulable Ps, but the kernel's CFS quota throttles the process to 2 CPUs' worth of time. Result: massive lock contention on the runqueue, p99 latency spikes, throttling visible in `/sys/fs/cgroup/cpu.stat`.

<details><summary>Hint</summary>

What does `runtime.NumCPU()` return inside a container — the host's CPUs or the cgroup's quota? And does Go 1.5+'s default `GOMAXPROCS = NumCPU` know about cgroups?

</details>

**Diagnosis:** `runtime.NumCPU()` calls `sched_getaffinity` (Linux) or equivalent — it returns the set of CPUs the process is *allowed* to run on, not the CPU *quota*. CPU pinning (`cpuset`) is reflected; CPU bandwidth (`cpu.cfs_quota_us`/`cpu.cfs_period_us`) is not. In Kubernetes, `limits.cpu: 2` translates to a CFS quota (200ms / 100ms period = 2 CPUs of throughput) but leaves the cpuset wide open. So `NumCPU` returns 64, but the kernel only lets your process accumulate 2 CPUs of runtime per 100ms.

The Go scheduler with 64 Ps believes it has 64 cores. It oversubscribes mercilessly: 64 goroutines run in parallel for the first part of each quota period, then the kernel throttles the entire process, freezing all 64 OS threads simultaneously. GC stop-the-world phases that need every P to acknowledge can stall through a full throttle window.

The historical fix was Uber's `automaxprocs`, which reads cgroup files at startup and sets `GOMAXPROCS` accordingly. Go 1.25 made this behavior built-in (cgroup-aware `GOMAXPROCS` default).

**Fix:** Either import `go.uber.org/automaxprocs` (Go ≤ 1.24) or rely on the Go ≥ 1.25 default. Don't set `GOMAXPROCS` manually in `init` based on `NumCPU`:

```go
import _ "go.uber.org/automaxprocs"

func main() {
    // GOMAXPROCS now matches the cgroup quota
}
```

Setting `GOMAXPROCS` in `init` is also fragile because `automaxprocs` runs in *its own* init — the ordering between two `init`s in different packages is determined by import-graph topological order, and you can easily run yours first by accident.

---

### Bug 8: Panic in a goroutine with no `recover` crashes the whole program

**Difficulty:** Junior/Mid
**Skills:** Panic propagation, goroutine isolation myths

```go
package main

import (
    "fmt"
    "time"
)

func handle(req int) {
    if req == 0 {
        panic("bad request") // assumed: only kills this goroutine
    }
    fmt.Println("ok", req)
}

func main() {
    for i := 0; i < 5; i++ {
        go handle(i)
    }
    time.Sleep(time.Second)
    fmt.Println("served")
}
```

**Observed behavior:** Program crashes with `panic: bad request` and a stack trace from the goroutine that panicked. The other four goroutines never finish; "served" is never printed.

<details><summary>Hint</summary>

Goroutines look isolated — they have their own stacks, their own scheduling. Does that isolation extend to error/panic propagation? What's special about an unrecovered panic in *any* goroutine?

</details>

**Diagnosis:** Goroutines share an address space and a runtime. An unrecovered panic walks up the goroutine's stack running deferred functions; when it reaches the top (the goroutine's entry function) with nothing recovering it, `runtime.fatalpanic` is called. `fatalpanic` does not "kill the goroutine" — it calls `runtime.exit(2)`, terminating the whole process.

There is no concept in Go of a per-goroutine fault domain. Erlang has it (process isolation, "let it crash"); Go deliberately does not. The design reasoning: shared memory between goroutines means an inconsistent state caused by a panicking goroutine could corrupt others; better to abort.

This is one of the most common misunderstandings of the runtime. "Goroutines are isolated" is true for stack memory and scheduling, false for fatal errors. Every goroutine that can panic must recover at its top frame — or the process dies.

**Fix:** Wrap every goroutine entry point in a `recover`:

```go
func safeHandle(req int) {
    defer func() {
        if r := recover(); r != nil {
            log.Printf("handler panic: %v", r)
        }
    }()
    handle(req)
}

func main() {
    for i := 0; i < 5; i++ {
        go safeHandle(i)
    }
    time.Sleep(time.Second)
}
```

In real codebases, factor this into a helper (`go safe(func() { ... })`) and use it everywhere.

---

### Bug 9: `runtime/debug.SetGCPercent(-1)` disables GC in a long-running process

**Difficulty:** Mid
**Skills:** GC tuning, scavenger, long-running processes

```go
package main

import (
    "runtime/debug"
    "time"
)

func main() {
    // "disable GC during the hot startup phase"
    debug.SetGCPercent(-1)

    loadCaches()        // allocates 2 GB
    serveForever()      // runs for days
}
```

**Observed behavior:** Process steadily grows; RSS climbs past system memory; OOM-killed after a few hours. The "hot startup phase" was meant to be 30 seconds.

<details><summary>Hint</summary>

What's the contract of `SetGCPercent(-1)`? Does the GC come back on its own when "the hot phase" ends? Who's responsible for re-enabling it?

</details>

**Diagnosis:** `SetGCPercent(-1)` permanently disables the garbage collector for the lifetime of the process. There is no automatic re-enable, no timeout, no "once the heap reaches X." The GC is *off*. Allocations keep going to the heap; reachable and unreachable objects accumulate indistinguishably; the heap monotonically grows.

This is sometimes used legitimately during a known-bounded startup phase to avoid GC pauses interfering with cache loading — but it requires explicitly re-enabling GC afterward:

```go
debug.SetGCPercent(-1)
loadCaches()
debug.SetGCPercent(100)   // re-enable with default ratio
runtime.GC()              // force a cycle now to reclaim what's dead
```

There's a deeper architectural point here: even when GC *is* on, the heap's *virtual* size is not the same as RSS. Reclaimed memory is returned to the OS lazily by the *scavenger* (a background runtime goroutine that `madvise(MADV_DONTNEED)`s idle pages). Disabling GC also stops the scavenger's input — there's nothing to scavenge if everything is "live."

Related symptom: even with GC enabled, RSS can stay high for minutes after a workload drops, because the scavenger is conservative about returning memory. Forcing `debug.FreeOSMemory()` can speed this up at the cost of fragmentation.

**Fix:** Always re-enable GC after the bounded phase, and don't assume GC-off is reversible by "doing nothing":

```go
defer debug.SetGCPercent(100)
debug.SetGCPercent(-1)
loadCaches()
```

---

### Bug 10: Building with `-trimpath` then expecting source paths in stack traces

**Difficulty:** Mid
**Skills:** Build flags, debug info, stack traces

```go
package main

import "runtime/debug"

func main() {
    debug.PrintStack()
}
```

Built with:

```
go build -trimpath -o app
```

Expecting: `/home/dev/project/main.go:7 +0x...`
Reality: `command-line-arguments/main.go:7 +0x...` or `main.go:7` with no useful prefix.

**Observed behavior:** Stack traces in logs no longer point to a file system path — they show package-relative paths. Crash reports become hard to triangulate against a specific build of the source tree. Debuggers can't find source files.

<details><summary>Hint</summary>

What does `-trimpath` do — and why does it exist?

</details>

**Diagnosis:** `-trimpath` strips absolute paths from the compiled binary's debug info and symbol table. The purpose is *reproducible builds* — two developers building the same source tree from `/home/alice/project` and `/home/bob/work/project` produce byte-identical binaries because the build directory is replaced by a canonical form (`command-line-arguments/...` for the main package, `<modulepath>@<version>/...` for dependencies).

This is a deliberate tradeoff: you get reproducibility and you don't leak the build host's filesystem layout (a small security win), but you lose the ability to debug from a stack trace directly. The runtime's stack-walking and symbolization code reads from the binary's debug info, so what's stripped at build time is gone at runtime.

The misunderstanding is treating `-trimpath` as "always good." It's good for *distribution* builds (binaries shipped to users) and *reproducible* builds (verifying provenance). It's bad for *development* builds where you need stack traces to point at your editor's source paths.

**Fix:** Use `-trimpath` only in release builds. For dev/debug, omit it:

```
# dev build
go build -o app

# release build
go build -trimpath -ldflags '-s -w' -o app
```

If you need to symbolicate a stripped binary, ship the unstripped debug binary separately and use `go tool addr2line` or `delve` against it.

---

### Bug 11: Forking a Go process with `syscall.ForkExec` corrupts the child

**Difficulty:** Senior
**Skills:** Fork safety, runtime threads, scheduler invariants

```go
package main

import (
    "syscall"
    "os"
)

func main() {
    pid, err := syscall.ForkExec(
        "/bin/echo",
        []string{"echo", "hello"},
        &syscall.ProcAttr{Files: []uintptr{0, 1, 2}},
    )
    _, _, _ = pid, err, os.Args
}
```

Now consider a variant: someone calls `syscall.Syscall(syscall.SYS_FORK, ...)` directly (no exec), expecting a Go-style "fork" they can keep running in the child.

**Observed behavior:** With `ForkExec` to a non-Go binary: works fine. With a bare `fork` (no `exec` after), the child process hangs, deadlocks, or crashes with `fatal error: schedule: holding locks` or similar runtime panic.

<details><summary>Hint</summary>

When the kernel forks a multithreaded process, what happens to threads other than the one that called fork? Now apply that to a Go program — where are the goroutines, where is the scheduler, where is the GC worker?

</details>

**Diagnosis:** `fork(2)` in a multithreaded process duplicates only the calling thread in the child. All other OS threads (and the data structures associated with them) are *gone* in the child, but any memory they were modifying is preserved in whatever state it was in at the moment of fork — locks held, queues mid-update, freelists partially modified.

A Go program *always* runs multithreaded: the runtime spawns `m`s for the scheduler (`g0`s), the GC has worker threads, the sysmon thread runs in the background, the timer thread on some platforms. After `fork`, the child has *one* OS thread but the runtime's data structures (scheduler state, GC state, mutex states, network poller state) reflect a multithreaded snapshot mid-flight. The scheduler tries to find an `m` that no longer exists; a mutex was held by a goroutine on a now-vanished `m` and can never be released.

This is why `ForkExec` is the *only* safe fork pattern: it forks, then immediately execs, so the runtime state in the child is overwritten before any of it is read. The "no exec" variant — bare fork — is fundamentally incompatible with the Go runtime. There is no fix; Go is not fork-safe.

POSIX has `pthread_atfork` handlers that can re-initialize state in the child, but Go doesn't expose hooks for the runtime's internals, and even if it did, the freelist/scheduler invariants are too tangled to reset cleanly.

**Fix:** Use `os/exec.Cmd` (which wraps `forkExec` correctly) for spawning child processes. Never call bare `fork` and expect the Go runtime to function in the child:

```go
cmd := exec.Command("echo", "hello")
cmd.Stdout = os.Stdout
cmd.Run()
```

If you need a "checkpoint" semantic, look at `re-exec` patterns: serialize state, exec a fresh copy of yourself, deserialize.

---

### Bug 12: Using `runtime.GC()` to "free memory" in a long-running process

**Difficulty:** Mid
**Skills:** GC vs scavenger, RSS vs heap, memory return to OS

```go
package main

import (
    "runtime"
    "time"
)

func processBatch() {
    data := make([][]byte, 1_000_000)
    for i := range data {
        data[i] = make([]byte, 1024)
    }
    // ... use data ...
    data = nil
    runtime.GC()  // expected: RSS drops
}

func main() {
    for {
        processBatch()
        time.Sleep(time.Minute)
    }
}
```

**Observed behavior:** `runtime.GC()` clears the Go heap — `runtime.MemStats.HeapInuse` drops — but `RSS` measured by `ps`/`top` stays high for many minutes, sometimes never returning to the pre-batch level on Linux.

<details><summary>Hint</summary>

The GC reclaims memory inside the *Go heap*. Who returns memory from the Go heap back to the OS? Is it the same goroutine?

</details>

**Diagnosis:** The Go runtime has two distinct memory-management subsystems:

1. **The garbage collector** — finds unreachable objects, marks their span pages as free *within Go's heap*. After `runtime.GC()`, the heap's free list grew, but Go's heap allocation (the virtual address range) didn't shrink.

2. **The scavenger** — a separate background goroutine that periodically walks free spans and tells the kernel "you can reclaim these pages" via `madvise(MADV_DONTNEED)` (Linux) or equivalent. *This* is what reduces RSS.

The scavenger is intentionally conservative. It has a pacing model: it doesn't immediately return all free memory because that would cause page faults when the next allocation needs them back. It returns memory based on a smoothed heap-growth target. After Go 1.16 the scavenger runs continuously; before that it ran periodically. Either way: `runtime.GC()` doesn't trigger scavenging directly.

If you really need to push memory back to the OS aggressively (e.g. before a fork, or to make container limits happy), call `debug.FreeOSMemory()`:

```go
runtime.GC()
debug.FreeOSMemory()  // force the scavenger to release everything reclaimable
```

But this is expensive (full heap walk, full `madvise` of free spans) and disrupts the scavenger's pacing.

The misunderstanding is conflating "GC ran" with "memory was returned to the OS." Those are independent operations performed by separate runtime subsystems with different cadences.

**Fix:** Don't expect `runtime.GC()` to lower RSS. If RSS matters (container OOM-killer), either accept the scavenger's pace, set `GOMEMLIMIT` (Go 1.19+) so the runtime keeps the heap under a target, or use `debug.FreeOSMemory()` at known idle moments.

```go
// in main, once
debug.SetMemoryLimit(2 << 30) // 2 GB soft cap; GC and scavenger work harder to honor it
```

---

### Bug 13: Linking Go and C with mismatched glibc versions

**Difficulty:** Senior
**Skills:** Cgo, linker, glibc symbol versioning

```go
package main

/*
#include <stdlib.h>
*/
import "C"
import "fmt"

func main() {
    p := C.malloc(64)
    defer C.free(p)
    fmt.Println("allocated")
}
```

Built on Ubuntu 22.04 (glibc 2.35), deployed to Ubuntu 20.04 (glibc 2.31).

**Observed behavior:** On the deployment host, the binary fails to start: `./app: /lib/x86_64-linux-gnu/libc.so.6: version GLIBC_2.34 not found (required by ./app)`. Or, more subtly, the program runs but crashes inside a libc call with an `R_X86_64_GLOB_DAT` relocation error or odd `getauxval` behavior.

<details><summary>Hint</summary>

When a cgo binary calls `malloc`, where does that symbol come from at runtime? How does the dynamic linker decide which version of `malloc` to use?

</details>

**Diagnosis:** glibc uses *symbol versioning*: each exported symbol has a version tag (`malloc@GLIBC_2.2.5`, `dlopen@GLIBC_2.34`, etc.). At link time, the linker binds against the highest version of each symbol available in the build host's libc and stamps the required version into the binary's `.gnu.version_r` section. At runtime, the dynamic linker checks that the host's libc provides at least that version; if not, the load fails.

A Go binary with `cgo` enabled is dynamically linked against libc (see Bug 6). Building on a host with glibc 2.35 binds against `GLIBC_2.34` (or whichever version provides each function) and the binary refuses to run on glibc 2.31 because those symbol versions don't exist there.

This is not a Go problem — it's a fundamental property of any cgo-enabled binary. Pure-Go binaries with `CGO_ENABLED=0` make their own syscalls directly and don't depend on libc at all.

The misunderstanding is the assumption that "Go binaries are portable across Linux distributions." Pure Go: yes. Cgo Go: only across distributions with libc ≥ your build host's libc. The forward direction works (newer libc supports older symbol versions), the backward does not.

**Fix:** Either build with `CGO_ENABLED=0` for portability, or build on (or against) the oldest libc you intend to support — usually a CentOS 7 / Debian oldstable / Alpine builder image:

```
# in CI, use an old-libc builder image
docker run --rm -v $PWD:/src debian:bullseye-slim sh -c '
  apt-get update && apt-get install -y golang gcc &&
  cd /src && go build -o app
'
```

Or statically link against musl (smaller, simpler ABI):

```
CC=musl-gcc go build -ldflags '-linkmode external -extldflags "-static"' -o app
```

---

### Bug 14: Building for ARM64 from amd64 host but using inline asm specific to amd64

**Difficulty:** Senior
**Skills:** Cross-compilation, inline assembly, GOARCH

```go
package main

/*
#include <stdint.h>

static inline uint64_t rdtsc(void) {
    uint32_t lo, hi;
    __asm__ __volatile__("rdtsc" : "=a"(lo), "=d"(hi));
    return ((uint64_t)hi << 32) | lo;
}
*/
import "C"
import "fmt"

func main() {
    fmt.Println("ts:", C.rdtsc())
}
```

Built on amd64 with:

```
GOOS=linux GOARCH=arm64 go build -o app
```

**Observed behavior:** Either the build fails (`Error: unknown mnemonic 'rdtsc'` from the ARM assembler), or — if cgo is silently disabled by cross-compilation — the build succeeds but the function returns garbage because the C code wasn't compiled at all and a stub was generated.

<details><summary>Hint</summary>

What does cross-compilation mean for cgo? Does `GOARCH=arm64` change which compiler builds the `.c` files?

</details>

**Diagnosis:** Cross-compiling Go-only code is trivial because the Go toolchain ships with code generators for every supported `GOOS`/`GOARCH` pair. Cross-compiling *cgo* code is not: cgo invokes the C compiler (`$CC`, defaulting to `gcc` or `cc`), and the host's `gcc` produces host-architecture code unless you explicitly use a cross-compiler.

By default, `GOARCH=arm64 go build` with cgo enabled either:

1. **Disables cgo silently** if `CGO_ENABLED` isn't explicitly set to 1 and no cross-compiler is configured — cgo functions become stubs that return zero values. Your `rdtsc` "returns" 0 with no error.
2. **Fails the build** if `CGO_ENABLED=1` is set and the host `gcc` can't produce arm64 output, with an error from `gcc` about unknown architecture or instruction.
3. **Builds amd64 C code and links it with arm64 Go code** in pathological misconfigurations — link fails or, worst case, succeeds and runs on neither architecture.

The deeper issue is that `rdtsc` is an x86 instruction. Even with a proper arm64 cross-compiler, `__asm__ ("rdtsc")` would fail because ARM has no such instruction (ARM uses `mrs x0, cntvct_el0` for the cycle counter equivalent).

The misunderstanding is that "Go is portable" means "any Go code is portable." Pure-Go arithmetic, slices, channels, the standard library — yes, portable across architectures. Cgo, especially cgo with inline asm or architecture-specific intrinsics — no.

**Fix:** For cross-compiling cgo, install an appropriate cross-compiler and point Go at it:

```
GOOS=linux GOARCH=arm64 \
CC=aarch64-linux-gnu-gcc \
CGO_ENABLED=1 \
go build -o app
```

And replace architecture-specific code with portable equivalents or `GOARCH`-gated build files. For `rdtsc`-style timestamping, use `time.Now()` or a Go-side `runtime/nanotime` and let the platform's runtime handle the cycle counter:

```go
import "time"

func ts() int64 { return time.Now().UnixNano() }
```

If you really need the x86 timestamp counter, put the C code in a file named `*_amd64.c` and provide an arm64 alternative in `*_arm64.c` with the platform's cycle-counter mnemonic. Go's build system will pick the right file by suffix.

---

The thread connecting all fourteen bugs: the Go runtime is an opinionated, complete program runtime — not a thin wrapper over the OS. It has its own scheduler with its own preemption signal, its own GC with its own scavenger, its own boot sequence that strictly orders package init before main, its own cgo trampoline that needs threads it controls, its own teardown logic that only runs on certain exit paths. When code violates an invariant of one of these subsystems — by spawning C threads the runtime doesn't know about, by forking without execing, by stripping debug info you need, by trusting `NumCPU` in a cgroup — the runtime doesn't politely fail. It hangs, leaks, or crashes far from the cause.

Whenever a Go program behaves strangely at startup, under load, in a container, or after a deploy, the first question worth asking is: *which runtime subsystem's invariant did we just violate?*
