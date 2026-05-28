# runtime Package Deep — Professional

> Focus: a guided walkthrough of the exported `runtime` package source as it ships in go1.22+. Every function in `runtime` is a thin Go-level shim over machine-level operations — `LockOSThread` flips three fields, `Gosched` invokes `mcall`, `GC` posts a trigger and waits on a semaphore, `KeepAlive` compiles to nothing at all. The professional value is knowing exactly which lines of which file implement each user-visible function, what synchronization they imply, and which back channels (`//go:linkname`, intrinsics, runtime-internal funcs) other parts of the standard library use to reach the same machinery without going through the public API. Reading order matters: start in `extern.go`, follow the `mcall` arrows into the scheduler, then the `gcStart` arrow into the collector. Once those three files are familiar, everything else in the package is variations on the same shapes.

---

## 1. Reading-order recommendation

`runtime` is ~80 source files and ~70 KLOC. Read in this order; resist the urge to dive into `proc.go` (the scheduler) until the surface API is clear.

| Step | File(s) | What you learn |
|---|---|---|
| 1 | `runtime/extern.go` | Every documented exported function lives here as a stub or thin wrapper |
| 2 | `runtime/symtab.go` | `FuncForPC`, `Frames`, `CallersFrames` — how stack walking presents itself |
| 3 | `runtime/mfinal.go` | `SetFinalizer`, `KeepAlive` — finalizer queue + compiler intrinsic |
| 4 | `runtime/mgc.go` | `GC`, `gcStart`, GC trigger types; how user calls reach the collector |
| 5 | `runtime/mstats.go` | `ReadMemStats`, `MemStats`; STW for stat snapshot |
| 6 | `runtime/proc.go` | `Gosched`, `LockOSThread`, `Goexit`, `NumGoroutine`; the `g`/`m`/`p` triple |
| 7 | `runtime/debug.go` | `Stack`, `SetMaxThreads`, `SetPanicOnFault` |
| 8 | `runtime/metrics/` | Public read-only metrics; the `metrics` map in `runtime/metrics.go` |
| 9 | `runtime/pprof/` | CPU/heap/goroutine profile production; SIGPROF wiring |
| 10 | `runtime/trace/` | Event tracing; `Start`, `NewTask`, `WithRegion` |
| 11 | `runtime/cgo/` | `callbacks.go`, the cgo round-trip |
| 12 | `runtime/debug/` | `SetGCPercent`, `Stack`, `BuildInfo` — `//go:linkname` back-channel |

Read each file once linearly before chasing references. The exported API forms a frontage; the scheduler, GC, and allocator are the rooms behind it.

---

## 2. `runtime/extern.go` — the surface

`extern.go` is where the package's documentation lives, and where almost every documented exported function is declared. It is mostly thin Go that delegates to runtime-internal functions or compiler intrinsics. The file opens with the package doc comment (`GOGC`, `GODEBUG`, `GOMAXPROCS`, `GORACE`, `GOTRACEBACK` — read it in full; it is the canonical reference).

### 2.1 `Caller`, `Callers`, `FuncForPC`

```go
// from runtime/extern.go, simplified
func Caller(skip int) (pc uintptr, file string, line int, ok bool) {
    rpc := make([]uintptr, 1)
    n := callers(skip+1, rpc)
    if n < 1 { return }
    frame, _ := CallersFrames(rpc).Next()
    return frame.PC, frame.File, frame.Line, frame.PC != 0
}

func Callers(skip int, pc []uintptr) int {
    if len(pc) == 0 { return 0 }
    return callers(skip, pc)
}
```

`callers` (lower-case, internal) walks the goroutine's stack using `gentraceback`. `Caller` is convenience: ask for one frame, materialise via `CallersFrames`. `Callers` is the primitive that profilers, loggers, and `errors.Wrap`-style libraries call into.

`FuncForPC` lives in `symtab.go`:

```go
// from runtime/symtab.go, simplified
func FuncForPC(pc uintptr) *Func {
    f := findfunc(pc); if !f.valid() { return nil }
    return f._Func()
}
```

`findfunc` does a binary search over the moduledata's function table (`pclntab`). `*Func` is an opaque pointer; methods like `Name`, `FileLine`, `Entry` walk the same tables.

### 2.2 Version and platform constants

```go
// from runtime/extern.go, simplified
const GOOS string = goos.GOOS
const GOARCH string = goarch.GOARCH

func Version() string { return buildVersion }
```

`buildVersion` is set during the toolchain build (`-X runtime.buildVersion=go1.22.3`). `GOOS`/`GOARCH` are constants that the compiler folds — code like `if runtime.GOOS == "linux"` becomes dead-code-eliminated on non-linux builds.

### 2.3 `NumCPU`, `NumGoroutine`, `NumCgoCall`

```go
// from runtime/extern.go, simplified
func NumCPU() int       { return int(ncpu) }
func NumGoroutine() int { return int(gcount()) }
func NumCgoCall() int64 { return int64(ncgocall) + cgocallsdone() }
```

`ncpu` is read from `/proc/cpuinfo`-equivalent at startup. `gcount` walks all `P`s summing their local goroutine counts. `ncgocall` is a global counter incremented on every cgo call.

### 2.4 `GOMAXPROCS`

```go
// from runtime/proc.go, simplified
func GOMAXPROCS(n int) int {
    if n < 1 { return int(gomaxprocs) }
    lock(&sched.lock)
    ret := int(gomaxprocs)
    unlock(&sched.lock)
    if n == ret { return ret }
    stopTheWorld(stwGOMAXPROCS)
    newprocs = int32(n)
    startTheWorld()
    return ret
}
```

Resizing the `P` count requires STW — the scheduler must allocate or release `P`s while no goroutines run user code. Calling `GOMAXPROCS` in a hot path is a latency landmine.

---

## 3. `runtime.LockOSThread()` walkthrough

The OS-thread lock is one of the most-misunderstood APIs. Source is short and worth memorising.

```go
// from runtime/proc.go, simplified
func LockOSThread() {
    if atomic.Load(&newmHandoff.haveTemplateThread) == 0 && GOOS != "plan9" {
        startTemplateThread()
    }
    gp := getg()
    gp.m.lockedExt++
    if gp.m.lockedExt == 0 { gp.m.lockedExt--; panic("LockOSThread nesting overflow") }
    dolockOSThread()
}

func dolockOSThread() {
    if GOARCH == "wasm" { return }
    gp := getg()
    gp.m.lockedg.set(gp)
    gp.lockedm.set(gp.m)
}

func UnlockOSThread() {
    gp := getg()
    if gp.m.lockedExt == 0 { return }
    gp.m.lockedExt--
    dounlockOSThread(false)
}

func dounlockOSThread() {
    gp := getg()
    if gp.m.lockedInt != 0 || gp.m.lockedExt != 0 { return }
    gp.m.lockedg = 0
    gp.lockedm = 0
}
```

Key invariants:

1. `m.lockedg` and `g.lockedm` form a *bidirectional* binding. Once set, the scheduler refuses to run this `G` on any other `M`, and refuses to release this `M` for reuse on any other `G`.
2. `lockedExt` is the user-callable counter; `lockedInt` is the runtime's own counter used for cgo and signal handling. Both must reach zero for the binding to release.
3. The lock survives across `Gosched` and channel ops — they only switch goroutines, never `M`s. It does *not* survive across goroutine exit; the `G` dies, the `M` is unlocked.
4. When a locked `G` exits without unlocking, the `M` is *terminated* (not pooled). This is intentional: the user grabbed thread-local state we cannot safely reuse.

Use cases the design supports: OpenGL contexts (per-thread state), some syscall families (`setuid`, `unshare` on Linux), CGO libraries that store data in `pthread_setspecific`, locked goroutines that must observe a specific `os.Geteuid()`.

---

## 4. `runtime.Gosched()` walkthrough

```go
// from runtime/proc.go, simplified
func Gosched() {
    checkTimeouts()
    mcall(gosched_m)
}

func gosched_m(gp *g) {
    if trace.enabled { traceGoSched() }
    goschedImpl(gp)
}

func goschedImpl(gp *g) {
    status := readgstatus(gp)
    if status&^_Gscan != _Grunning { throw("bad g status") }
    casgstatus(gp, _Grunning, _Grunnable)
    dropg()
    lock(&sched.lock)
    globrunqput(gp)
    unlock(&sched.lock)
    schedule()
}
```

`mcall` is a special primitive that switches from the user goroutine's stack to the `M`'s `g0` (scheduler) stack and invokes `gosched_m` with the previous `G` as argument. From `g0`'s vantage point:

1. Transition the user `G` from `_Grunning` to `_Grunnable`.
2. `dropg`: detach the `G` from the current `P`/`M`.
3. Push the `G` onto the *global* run queue (not the local one — `Gosched` is a fairness primitive; local re-enqueue would let the same `G` run again immediately).
4. Call `schedule()` to pick the next `G`.

Cost: ~150 ns on modern x86. Mostly the lock + global queue manipulation. `runtime.Gosched()` is *cooperative* — preemption (since go1.14) is signal-driven and does not call `Gosched`.

---

## 5. `runtime.GC()` walkthrough

```go
// from runtime/mgc.go, simplified
func GC() {
    n := work.cycles.Load()
    gcWaitOnMark(n)
    gcStart(gcTrigger{kind: gcTriggerCycle, n: n + 1})
    gcWaitOnMark(n + 1)
    for work.cycles.Load() == n+1 && sweepone() != ^uintptr(0) {
        sweep.nbgsweep++
        Gosched()
    }
    for work.cycles.Load() == n+1 && !isSweepDone() { Gosched() }
    mp := acquirem()
    cycle := work.cycles.Load()
    if cycle == n+1 || (gcphase == _GCmark && cycle == n+2) { mProf_PostSweep() }
    releasem(mp)
}
```

`gcStart(gcTrigger{kind: gcTriggerCycle, n: ...})` requests a cycle if no other cycle has already started since we entered. `gcWaitOnMark` blocks on a semaphore that the background mark workers post when the mark phase completes. The loop after both waits performs the *user-assisted sweep* — the calling goroutine helps drain the sweep queue rather than returning while sweep work is still pending.

Net effect: `runtime.GC()` returns only when (a) a mark phase that started no earlier than the call has completed, and (b) all spans queued for sweep at that time have been swept. It is therefore a hard barrier: every pointer reachable at the call returned through mark; every dead object is either freed or queued for finalization.

Use cases: benchmarks (force a clean baseline before measuring), tests that assert finalizer behavior, long idle periods before snapshotting `MemStats`. Never in hot paths — a forced cycle costs the whole STW + mark.

---

## 6. `runtime.ReadMemStats` walkthrough

```go
// from runtime/mstats.go, simplified
func ReadMemStats(m *MemStats) {
    _ = m.Alloc // crash if m == nil before the STW
    stopTheWorld(stwReadMemStats)
    systemstack(func() { readmemstats_m(m) })
    startTheWorld()
}

func readmemstats_m(stats *MemStats) {
    updatememstats()
    stats.Alloc        = memstats.alloc
    stats.TotalAlloc   = memstats.total_alloc
    stats.Sys          = memstats.sys
    stats.Lookups      = memstats.nlookup
    stats.Mallocs      = memstats.nmalloc
    stats.Frees        = memstats.nfree
    stats.HeapAlloc    = memstats.heap_live
    // ... ~30 more fields, all simple field copies
    stats.NumGC        = memstats.numgc
    stats.NumForcedGC  = memstats.numforcedgc
    stats.GCCPUFraction = memstats.gc_cpu_fraction
    for i := range stats.BySize {
        stats.BySize[i].Size    = uint32(class_to_size[i])
        stats.BySize[i].Mallocs = memstats.by_size[i].nmalloc
        stats.BySize[i].Frees   = memstats.by_size[i].nfree
    }
}
```

STW is required because the per-`P` allocation caches must be flushed into the global counters; without STW the snapshot would double-count or skip. `updatememstats` rolls every `P`'s `mcache` deltas into the global. Cost: ~100 µs base + ~5 µs per `P`. Calling `ReadMemStats` once a second in a hot service is *visible* in latency p99.

`runtime/metrics` (§9) was introduced specifically because `ReadMemStats` is expensive and the field set is frozen. Prefer `metrics.Read` for new code.

---

## 7. `runtime.SetFinalizer` walkthrough

```go
// from runtime/mfinal.go, simplified
func SetFinalizer(obj interface{}, finalizer interface{}) {
    if debug.sbrk != 0 { return }
    e := efaceOf(&obj)
    etyp := e._type
    if etyp == nil { throw("runtime.SetFinalizer: first argument is nil") }
    if etyp.Kind_&kindMask != kindPtr { throw("first argument is not a pointer") }
    ot := (*ptrtype)(unsafe.Pointer(etyp))
    if ot.Elem == nil { throw("can't set finalizer on object with no type") }
    // ... validation: finalizer must be func with one arg compatible with obj
    systemstack(func() {
        if !addfinalizer(e.data, (*funcval)(f.data), nret, fint, ot) {
            throw("runtime.SetFinalizer: finalizer already set")
        }
    })
}
```

`addfinalizer` registers `(obj, fn, argtype)` in the per-`mspan` finalizer table — *not* a single global map. Lookup is by `(span, object-index-within-span)`, keeping the registration close to the object's memory. The flag bit `spc.hasFinalizer` is also set on the span.

### 7.1 The finalizer queue

```
+--------+   GC marks unreachable    +--------------+   queue (FIFO)
|  obj   |  -----------------------> | finalizer Q  |  ----------> finalizer goroutine
+--------+                           +--------------+              runs fn(obj)
   ^                                                                     |
   |                                                                     |
   |  fn keeps obj alive for one cycle                                   |
   +---------------------------------------------------------------------+
```

When GC determines an object with a finalizer is unreachable, it pushes the object onto the global `finq` queue *and resurrects it* (the finalizer needs a live reference). One goroutine, `runfinq`, drains the queue:

```go
// from runtime/mfinal.go, simplified
func runfinq() {
    for {
        lock(&finlock)
        fb := finq; finq = nil
        if fb == nil { fingwait = true; goparkunlock(&finlock, waitReasonFinalizerWait, ...); continue }
        unlock(&finlock)
        for fb != nil {
            for i := fb.cnt; i > 0; i-- {
                f := &fb.fin[i-1]
                reflectcall(nil, unsafe.Pointer(f.fn), frame, ...)
                f.fn = nil; f.arg = nil; f.ot = nil
            }
            fb.cnt = 0; fb = fb.next
        }
    }
}
```

After running, the object becomes truly unreachable on the *next* cycle. Implications:

1. Finalizers add at least one extra GC cycle of object lifetime.
2. They run on *one* goroutine. A slow finalizer blocks every subsequent finalizer.
3. They are not guaranteed to run at all (program exit may skip them).
4. They run before sweep, so the object's memory has not yet been returned.

Use sparingly — for closing OS handles tied to objects the user might forget. `os.File`'s `SetFinalizer(f, (*File).close)` is the canonical example.

---

## 8. `runtime.KeepAlive` walkthrough

```go
// from runtime/mfinal.go, simplified
// KeepAlive marks its argument as currently reachable.
// This ensures that the object is not freed, and its finalizer is not run,
// before the point in the program where KeepAlive is called.
func KeepAlive(x interface{}) {
    // Introduce a use of x that the compiler can't eliminate.
    // This makes sure x is alive on entry. We need x to be alive
    // on exit. Not sure if there is a way to do that.
    if cgoAlwaysFalse {
        println(x)
    }
}
```

That's the entire body. The function exists *because the compiler treats calls to it specially* — `KeepAlive` is an **intrinsic**. The compiler's escape and liveness analysis sees a call to `runtime.KeepAlive` and emits a use of the argument at the call site. The body is dead code (`cgoAlwaysFalse` is `false` and constant-propagated away), but the compiler-injected use is real.

Why this matters: without `KeepAlive`, a sequence like

```go
p := C.malloc(N)
f := os.NewFile(uintptr(p), "") // f wraps p
buf := unsafe.Slice((*byte)(p), N)
// ... use buf ...
// without KeepAlive(f) here, f could be GC'd, its finalizer freeing p,
// while buf is still being used.
```

is unsafe. `KeepAlive(f)` placed *after* the last use of `buf` forces the compiler to keep `f`'s reference live until at least that line.

---

## 9. `runtime/metrics` — the modern stats API

```go
// from runtime/metrics/sample.go, simplified
type Sample struct {
    Name  string
    Value Value
}

func Read(m []Sample) {
    metricsLock()
    initMetrics()
    for i := range m {
        sample := &m[i]
        data, ok := metrics[sample.Name]
        if !ok { sample.Value.kind = KindBad; continue }
        data.compute(&statePtr, &sample.Value)
    }
    metricsUnlock()
}
```

The set of metric names is wired in `runtime/metrics.go`:

```go
// from runtime/metrics.go, simplified
var metrics = map[string]metricData{
    "/gc/cycles/total:gc-cycles":      {compute: compute_gc_cycles},
    "/gc/heap/allocs:bytes":           {compute: compute_heap_allocs},
    "/gc/heap/live:bytes":             {compute: compute_heap_live},
    "/sched/goroutines:goroutines":    {compute: compute_goroutines},
    "/memory/classes/heap/free:bytes": {compute: compute_heap_free},
    // ... ~70 entries
}
```

Crucially, `Read` does **not** stop the world. Each `compute` function reads its specific counter (often a single atomic load) and writes it into the sample. A user reading 5 metrics costs ~5 atomic loads + ~50 ns lock acquisition, vs `ReadMemStats`'s STW.

For new dashboards: use `runtime/metrics`. For backward compatibility with code that emits the full `MemStats`: keep `ReadMemStats`.

---

## 10. `runtime/pprof` — profiling and the runtime

### 10.1 CPU profile

```go
// from runtime/pprof/pprof.go, simplified
func StartCPUProfile(w io.Writer) error {
    const hz = 100
    cpu.Lock()
    defer cpu.Unlock()
    if cpu.profiling { return errors.New("cpu profiling already in use") }
    cpu.profiling = true
    runtime.SetCPUProfileRate(hz)
    go profileWriter(w)
    return nil
}
```

`runtime.SetCPUProfileRate(100)` does two things in the runtime:

1. Asks the OS to deliver SIGPROF at 100 Hz via `setitimer` (Linux) or platform equivalent (`thread_set_state` on Darwin, etc.).
2. On every SIGPROF, the runtime's signal handler walks the *current goroutine's* stack and pushes the PC list into a lock-free profile buffer.

`profileWriter` consumes the buffer and writes the pprof-format protobuf. CPU profiling adds ~3-5% overhead at 100 Hz on most workloads — the cost is signal handling + traceback per sample.

### 10.2 Heap profile

```go
// from runtime/mprof.go, simplified
func MemProfile(p []MemProfileRecord, inuseZero bool) (n int, ok bool) {
    lock(&proflock)
    head := mbuckets
    for b := head; b != nil; b = b.allnext {
        if inuseZero || b.mp().active.alloc_objects-b.mp().active.free_objects != 0 { n++ }
    }
    if n <= len(p) {
        ok = true
        for b := head; b != nil; b = b.allnext { /* copy stack + counts */ }
    }
    unlock(&proflock)
    return
}
```

Every Nth allocation (default N = 512 KB; `runtime.MemProfileRate`) is sampled: the call stack and size are stored in a per-stack-hash bucket. `pprof.WriteHeapProfile` calls `MemProfile` to get the records.

### 10.3 Goroutine profile

```go
// from runtime/mprof.go, simplified
func GoroutineProfile(p []StackRecord) (n int, ok bool) {
    return goroutineProfileInternal(p)
}
```

Captures the stack of *every* goroutine. Requires STW because goroutines' stacks are mutating. Cost is proportional to total goroutine count — a service with 100 000 goroutines pays ~10 ms of STW per goroutine-profile call. Useful for debugging leaks; dangerous in latency-sensitive code.

---

## 11. `runtime/trace` — execution tracing

```go
// from runtime/trace/trace.go, simplified
func Start(w io.Writer) error {
    tracing.Lock()
    defer tracing.Unlock()
    if err := runtime.StartTrace(); err != nil { return err }
    go func() {
        for {
            data := runtime.ReadTrace()
            if data == nil { break }
            w.Write(data)
        }
    }()
    return nil
}
```

`runtime.StartTrace` (in `runtime/trace.go`, lowercase package) flips a global flag. From that moment, every scheduler/GC/syscall event records itself into a per-`P` trace buffer:

```
goroutine create/start/end/block/unblock
GC start/end/STW/mark/sweep
syscall enter/exit/block
network poll
heap alloc events
user task/region/log events
```

The events are flushed to `w` via `ReadTrace`. The trace viewer (`go tool trace`) reconstructs the timeline.

User-level events live in `runtime/trace/annotation.go`:

```go
// from runtime/trace/annotation.go, simplified
func NewTask(pctx context.Context, taskType string) (context.Context, *Task) {
    pid := fromContext(pctx).id
    id := newID()
    userTaskCreate(id, pid, taskType)
    s := &Task{id: id}
    return context.WithValue(pctx, traceContextKey{}, s), s
}

func WithRegion(ctx context.Context, regionType string, fn func()) {
    id := fromContext(ctx).id
    userRegion(id, 0, regionType) // 0 = enter
    defer userRegion(id, 1, regionType) // 1 = exit
    fn()
}
```

`userTaskCreate` and `userRegion` are the bridge — they emit `EvUserTaskCreate`, `EvUserRegion` events into the same trace buffer the runtime uses. User events and runtime events appear on the same timeline in `go tool trace`.

---

## 12. `runtime/debug` — back-channels into the runtime

`runtime/debug` is a separate package that exposes a few additional knobs not in `runtime` itself. They are implemented via `//go:linkname` reaching into unexported `runtime` symbols.

### 12.1 `SetGCPercent`

```go
// from runtime/debug/garbage.go, simplified
//go:linkname setGCPercent runtime.setGCPercent
func setGCPercent(in int32) (out int32)

func SetGCPercent(percent int) int { return int(setGCPercent(int32(percent))) }
```

The actual function lives in `runtime/mgc.go`:

```go
// from runtime/mgc.go, simplified
//go:linkname setGCPercent
func setGCPercent(in int32) (out int32) {
    lock(&mheap_.lock)
    out = gcController.gcPercent.Load()
    gcController.setGCPercent(in)
    unlock(&mheap_.lock)
    gcControllerCommit() // recompute trigger ratio
    return out
}
```

The `//go:linkname` directive lets `runtime/debug` call an unexported `runtime` function as if it were a local declaration. This pattern repeats across the standard library.

### 12.2 `Stack`

```go
// from runtime/debug/stack.go, simplified
func Stack() []byte {
    buf := make([]byte, 1024)
    for {
        n := runtime.Stack(buf, false)
        if n < len(buf) { return buf[:n] }
        buf = make([]byte, 2*len(buf))
    }
}
```

A pure wrapper over `runtime.Stack`, which is itself a documented exported function in `runtime/mprof.go` that fills the buffer with a textual goroutine stack.

### 12.3 `BuildInfo`

```go
// from runtime/debug/mod.go, simplified
//go:linkname modinfo runtime.modinfo

func ReadBuildInfo() (*BuildInfo, bool) {
    data, ok := readBuildInfo(modinfo)
    if !ok { return nil, false }
    return data, true
}
```

`modinfo` is a string set by the linker containing the module graph; `readBuildInfo` parses it into the `BuildInfo` struct. The fact that this travels via `//go:linkname` rather than a regular export is historical — the runtime owns the string because the linker writes it there.

---

## 13. `runtime/cgo` — the cgo round-trip

```
   Go side                       boundary                  C side
+-----------+   cgocall      +---------------+         +---------+
|  goroutine|--------------->| g0 stack swap |-------->|  C fn   |
|  on M     |                | save P, mark  |         |         |
+-----------+                | thread in C   |         +---------+
                             +---------------+              |
                                                            | calls back to Go
                                                            v
                             +---------------+         +---------+
                             | cgocallback   |<--------|  C    fn|
                             | acquire M     |         |         |
                             | switch to g0  |         +---------+
                             | run Go fn     |
                             +---------------+
                                    |
                                    v
                             +---------------+
                             | return to C   |
                             +---------------+
```

```go
// from runtime/cgo/callbacks.go, simplified
//go:cgo_export_static _cgo_panic
//go:linkname _cgo_panic runtime.cgocallback

// _cgo_panic provides the C side a function pointer to call back into Go.
func _cgo_panic(a *struct{ cstr *byte }) {
    panicCString(a.cstr)
}
```

The cgo package mostly hosts the *plumbing*: a small set of exported C-callable functions (`_cgo_panic`, `_cgo_yield`, etc.) and `//go:linkname` declarations that wire them to runtime entry points. The heavy lifting — `cgocall` and `cgocallback` — lives in `runtime/cgocall.go`. Reading the linkname directives in `runtime/cgo/callbacks.go` tells you the *full set* of cross-language entry points.

Key invariants the cgo plumbing maintains:

1. While in C, the goroutine is in `_Gsyscall`-like state; the `P` is detached and may be acquired by another `M`.
2. A goroutine that called into C cannot be moved to another `M` (it has `lockedm` set implicitly during the call).
3. Callback into Go re-acquires a `P`, switches stacks to `g0`, then to a usable `G`'s stack to run the Go function.
4. The whole round-trip costs ~200 ns minimum on x86 — cgo is *not* free.

---

## 14. The `//go:linkname` back-channel

`//go:linkname localname remoteimportpath.remotename` lets one package call an unexported function in another. Used heavily inside the standard library to expose runtime internals to consumers without committing to a stable public API. The known list (go1.22) of inbound linknames *into* `runtime`:

| Caller package | Linkname target in `runtime` | Purpose |
|---|---|---|
| `sync` | `runtime_Semacquire`, `runtime_Semrelease` | Block/wake on semaphore |
| `sync` | `runtime_SemacquireMutex`, `runtime_canSpin` | Mutex slow-path coordination |
| `sync` | `runtime_notifyListAdd`, `runtime_notifyListWait`, `runtime_notifyListNotifyOne`, `runtime_notifyListNotifyAll` | `sync.Cond` |
| `sync` | `sync_runtime_doSpin`, `sync_runtime_nanotime` | Adaptive spin in `Mutex` |
| `sync/atomic` | (intrinsic, not linkname) | Compiled directly |
| `time` | `runtime_nanotime`, `time_now` | Monotonic + wall clock |
| `time` | `addtimer`, `deltimer`, `resettimer`, `modtimer` | Timer wheel |
| `os` | `runtime_beforeExit` | Run finalizers on `os.Exit` |
| `os/signal` | `signal_enable`, `signal_disable`, `signal_ignore`, `signal_recv`, `signalWaitUntilIdle` | Signal queue |
| `reflect` | `typedmemmove`, `typedmemclr`, `mapaccess`, `mapassign`, `mapdelete`, `mapiterinit` | Generic map/memory ops |
| `reflect` | `chansend`, `chanrecv`, `selectgo` | Generic channel ops |
| `runtime/debug` | `setGCPercent`, `setMaxThreads`, `setPanicOnFault`, `setMemoryLimit` | GC/runtime tuning |
| `runtime/pprof` | `runtime_expandFinalInlineFrame`, `runtime_cyclesPerSecond` | Profile post-processing |
| `runtime/trace` | `runtime_StartTrace`, `runtime_StopTrace`, `runtime_ReadTrace` | Tracing control |
| `runtime/metrics` | `runtime_readMetrics` | Public metrics surface |
| `internal/poll` | `runtime_pollServerInit`, `runtime_pollOpen`, `runtime_pollWait`, `runtime_pollSetDeadline`, etc. | Network poller |

What this list tells you: most of the standard library's "magic" — sync primitives, timers, signal handling, reflection, the network poller — sits on top of *runtime-internal* functions, accessed via this linkname back-channel rather than the public API. The public `runtime` package is intentionally narrow; the real plumbing is one `//go:linkname` away.

User code is *technically* allowed to use `//go:linkname` to reach the same symbols but should not — the Go team treats them as private and changes signatures between releases. The exception is the runtime's own ecosystem (`golang.org/x/...` modules sometimes use it).

---

## 15. The big picture — what `runtime` exposes vs hides

```
        +-------------------------------------------------+
        |                  Public API                     |
        |                                                 |
        |  GC, Gosched, LockOSThread, ReadMemStats,       |
        |  SetFinalizer, KeepAlive, Caller, FuncForPC,    |
        |  NumCPU, NumGoroutine, GOMAXPROCS, Stack,       |
        |  Version, GOOS, GOARCH                          |
        |                                                 |
        +-------------------------------------------------+
                              |
        +---------------------+---------------------------+
        |                                                 |
        v                                                 v
  +----------+                                    +-------------+
  | Wrappers |                                    | Intrinsics  |
  | over     |                                    | (KeepAlive, |
  | internal |                                    |  atomic.*)  |
  | funcs    |                                    +-------------+
  +----------+
       |
       v
+-----------------------------------------------------------+
|                Runtime-internal layer                     |
|                                                           |
|   schedule, mcall, gcStart, mallocgc, gentraceback,       |
|   stopTheWorld, startTheWorld, semacquire, ...            |
|                                                           |
|   (accessed by: sync, time, os, reflect, runtime/debug,   |
|    runtime/pprof, runtime/trace, runtime/metrics,         |
|    internal/poll — all via //go:linkname)                 |
+-----------------------------------------------------------+
       |
       v
+-----------------------------------------------------------+
|         Assembly + OS interface (per arch/OS)             |
|  asm_amd64.s, sys_linux_amd64.s, signal_unix.go, ...      |
+-----------------------------------------------------------+
```

The exported API is a thin frontage. Most of the file count and most of the LOC is the internal layer — code that other standard library packages reach via `//go:linkname`. Once this shape is clear, navigating the source becomes mechanical: every public function points at one or two internal entry points; every standard library "magic" (sync.Mutex's slow path, time.Sleep's wakeup, signal.Notify's queue) points back to the same internal layer.

---

## 16. Closing notes on reading the source

1. **`extern.go` first; everything else after.** Most user-visible names are declared there. Track the function from declaration to either an `mcall`, a `systemstack`, a `gcStart`, or an intrinsic — those four destinations cover ~80% of the surface.
2. **`mcall` and `systemstack` are punctuation marks.** They mean "switch to `g0`'s stack to do this safely". Anything inside an `mcall`/`systemstack` runs without preemption and cannot grow the caller's stack.
3. **`//go:linkname` directives map the standard library to the runtime.** When you see `sync.Cond.Wait` or `time.After`, the work happens via linkname into runtime. Greping `//go:linkname` across the stdlib yields the complete API surface the runtime *actually* exposes (much larger than `runtime`'s exported symbols).
4. **Intrinsics are documented by their absence.** `KeepAlive` is the canonical example — empty body, compiler-injected use. `atomic.*`, `math/bits.*`, parts of `unsafe`: same pattern.
5. **STW is the cost-of-doing-business operator.** `ReadMemStats`, `GoroutineProfile`, `GOMAXPROCS` resize, debug stack collection — each pauses every goroutine. Read these once; do not put them in hot paths.
6. **The `runtime` package version moves with the Go release.** Field names in `MemStats`, the set of `runtime/metrics` names, the `gcTrigger` kinds, the contents of `proc.go` — all change between minor releases. Pin reading material to the Go version your binary uses.

The exported `runtime` package is small precisely so the Go team can evolve the internals freely. The real machinery lives one layer down; the next four topics in this folder (`05` `runtime` deep is this one) are sibling deep-dives into the scheduler, GC, and allocator that sit beneath these dozen public functions.

---

## Further reading

- `runtime/extern.go` — package doc + Caller/Callers/Version/NumCPU/NumGoroutine
- `runtime/symtab.go` — `FuncForPC`, `CallersFrames`, pclntab walking
- `runtime/mfinal.go` — `SetFinalizer`, `KeepAlive`, finalizer goroutine
- `runtime/mgc.go` — `GC`, `gcStart`, `gcTrigger`, mark/sweep coordination
- `runtime/mstats.go` — `ReadMemStats`, STW snapshot logic
- `runtime/proc.go` — `Gosched`, `LockOSThread`, `GOMAXPROCS`, scheduler core
- `runtime/mprof.go` — `MemProfile`, `GoroutineProfile`, `Stack`
- `runtime/trace.go` — runtime-side tracing primitives
- `runtime/cgocall.go` + `runtime/cgo/callbacks.go` — cgo round-trip
- `runtime/metrics/*` + `runtime/metrics.go` — the modern metrics API
- `runtime/pprof/*` — CPU/heap/goroutine profile production
- `runtime/trace/*` — user-level trace annotations
- `runtime/debug/*` — `SetGCPercent`, `Stack`, `BuildInfo`, the linkname back-channel
- Go source tree at `src/runtime/` in the version matching your build — always read the version-matched source, not blog posts
