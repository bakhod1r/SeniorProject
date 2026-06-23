---
layout: default
title: Runtime Internals — Find the Bug
parent: Runtime Internals Used by Stdlib
grand_parent: Concurrency in Stdlib
ancestor: Go
nav_order: 9
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/find-bug/
---

# Runtime Internals Used by Stdlib — Find the Bug

[← Back](../)

> Each snippet uses a `runtime` primitive incorrectly. Find the bug, explain it, and fix it.

---

## Bug 1 — Finalizer that captures the object

```go
package main

import (
	"runtime"
	"sync/atomic"
)

type Conn struct {
	id  int
	hot atomic.Int32
}

func newConn(id int) *Conn {
	c := &Conn{id: id}
	runtime.SetFinalizer(c, func(_ *Conn) {
		// "Helpful" log
		println("finalizing", c.id)
	})
	return c
}
```

**Bug.** The closure references `c` from the enclosing scope (not the function parameter). This creates a hidden pointer from the finalizer table back to `c`, making `c` eternally reachable — the finalizer never runs and `c` is never freed.

**Fix.** Use the parameter:
```go
runtime.SetFinalizer(c, func(p *Conn) {
	println("finalizing", p.id)
})
```

Lesson: the finalizer's argument must be the only path to the object. Never close over the object itself or any field of it.

---

## Bug 2 — `LockOSThread` without paired `UnlockOSThread`

```go
func callOpenGL(ops []func()) {
	runtime.LockOSThread()
	for _, op := range ops {
		op() // OpenGL calls expecting thread affinity
	}
	// missing UnlockOSThread!
}
```

**Bug.** After `callOpenGL` returns, the goroutine remains pinned to that thread for the rest of its life. If `callOpenGL` is called from a worker goroutine in a pool, that worker can never run other goroutines — effectively reducing parallelism and possibly leaking the OS thread when the goroutine exits (the runtime destroys the M if the G ends while locked).

**Fix.** Use `defer`:
```go
runtime.LockOSThread()
defer runtime.UnlockOSThread()
```

Or, if you want the goroutine to die with the thread (e.g., a dedicated GL worker), document it and ensure the goroutine is short-lived.

---

## Bug 3 — Yielding while holding a mutex hoping to avoid contention

```go
var mu sync.Mutex

func doWork() {
	mu.Lock()
	for i := 0; i < 1000; i++ {
		heavyWork(i)
		runtime.Gosched() // "be polite"
	}
	mu.Unlock()
}
```

**Bug.** `Gosched` yields *while still holding the mutex*. Other goroutines waiting on `mu.Lock()` are blocked the whole time. Calling `Gosched` here only gives CPU to goroutines that do not need this mutex — not the ones contending for it.

**Fix.** Release the mutex before yielding, or batch the work outside the lock:
```go
for i := 0; i < 1000; i++ {
	mu.Lock()
	heavyWork(i)
	mu.Unlock()
}
```

If you specifically want the lock to be fair, use `sync.Mutex`'s built-in starvation mode (already automatic after 1 ms wait) — manual `Gosched` does not help.

---

## Bug 4 — Calling `runtime.GC()` in a hot loop "to be tidy"

```go
func batchProcess(items []Item) {
	for _, it := range items {
		process(it)
		runtime.GC() // free intermediate garbage
	}
}
```

**Bug.** `runtime.GC()` forces a full GC cycle, including stop-the-world phases. Calling it per item turns an O(n) loop into O(n) GC cycles, each costing O(heap) work — quadratic in practice. The GC is already smart enough to collect under memory pressure.

**Fix.** Remove the call. If you have a specific memory-bounded constraint (e.g., embedded device), set `GOMEMLIMIT` instead and let the GC schedule itself.

---

## Bug 5 — `runtime.Stack(buf, true)` in a periodic logger

```go
func logGoroutines() {
	t := time.NewTicker(1 * time.Second)
	defer t.Stop()
	buf := make([]byte, 1<<20)
	for range t.C {
		n := runtime.Stack(buf, true) // dump ALL goroutines
		log.Printf("goroutines:\n%s", buf[:n])
	}
}
```

**Bug.** `runtime.Stack(buf, true)` stops the world for the duration of the stack dump. On a busy server with 10k goroutines this can pause the program for tens of milliseconds — every second. Latency-sensitive endpoints will see periodic spikes.

**Fix.** Use the `runtime/pprof` package's `Lookup("goroutine").WriteTo(w, 2)` which is the same but with a single canonical call site, *or* use `runtime.NumGoroutine()` for a count (no STW), *or* trigger the dump on demand via a debug endpoint (e.g., `/debug/pprof/goroutine`).

---

## Bug 6 — Reusing a `note` without `noteclear`

```go
// (hypothetical, since note is internal — illustrative of the pattern)
var n note

func waitForEvent() {
	notesleep(&n)
	// process
}

func signalEvent() {
	notewakeup(&n)
}

func loop() {
	for {
		waitForEvent()
	}
}
```

**Bug.** A `note` is one-shot. After `notewakeup`, the next `notesleep` returns immediately without blocking unless `noteclear` is called first. The loop above will spin forever on the second iteration.

**Fix.** Clear the note before re-arming:
```go
func waitForEvent() {
	notesleep(&n)
	noteclear(&n)
}
```

Lesson: notes are not reusable signals — they are one-shot binary semaphores. For repeated signalling, use a channel or a `sync.Cond`.

---

## Bug 7 — `SetFinalizer` on an already-finalized object

```go
type File struct{ fd int }

func Open(path string) *File {
	f := &File{fd: openSyscall(path)}
	runtime.SetFinalizer(f, func(f *File) { closeFd(f.fd) })
	return f
}

func (f *File) Reopen(path string) {
	closeFd(f.fd)
	f.fd = openSyscall(path)
	runtime.SetFinalizer(f, func(f *File) { closeFd(f.fd) })
}
```

**Bug.** Calling `SetFinalizer` twice on the same object replaces the previous finalizer — but more subtly, between the two calls the GC may run, see the old finalizer, and queue it. If the file descriptor is the same, double-close. Also, `Reopen` should first call `SetFinalizer(f, nil)` to clear, then re-set.

**Fix.**
```go
func (f *File) Reopen(path string) {
	runtime.SetFinalizer(f, nil) // clear first
	closeFd(f.fd)
	f.fd = openSyscall(path)
	runtime.SetFinalizer(f, func(f *File) { closeFd(f.fd) })
}
```

Even better: rely on explicit `Close` and only use the finalizer as a last-resort warning, not a primary cleanup path.

---

## Bug 8 — `runtime.Gosched` as a deadlock-breaker

```go
var mu sync.Mutex
var ready bool

func writer() {
	mu.Lock()
	defer mu.Unlock()
	ready = true
}

func reader() {
	for {
		mu.Lock()
		if ready {
			mu.Unlock()
			return
		}
		mu.Unlock()
		runtime.Gosched() // hoping writer gets in
	}
}
```

**Bug.** `Gosched` only matters if writer is runnable but starved for CPU. If writer is blocked on something else (e.g., waiting on a channel that depends on this loop), no amount of yielding helps. The pattern works but is fragile and busy-waits.

**Fix.** Use a `sync.Cond` or a channel:
```go
var (
	mu    sync.Mutex
	cond  = sync.NewCond(&mu)
	ready bool
)

func writer() {
	mu.Lock()
	ready = true
	cond.Broadcast()
	mu.Unlock()
}

func reader() {
	mu.Lock()
	for !ready {
		cond.Wait()
	}
	mu.Unlock()
}
```

---

## Bug 9 — `LockOSThread` in `init` for "thread-local config"

```go
func init() {
	runtime.LockOSThread() // pin the init goroutine?
	configureCThreadLocals()
}
```

**Bug.** `init` runs on whichever goroutine called the package — usually the main goroutine. Locking that goroutine to its thread for the rest of the program changes runtime semantics globally and may have surprising effects (other goroutines never run on this thread; signals delivered to this thread cannot be handled by Go's signal goroutine the same way).

**Fix.** If the C library needs per-thread setup, spawn a dedicated goroutine with `LockOSThread` and serve calls through a channel:
```go
func init() {
	reqs := make(chan request)
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		configureCThreadLocals()
		for r := range reqs {
			handle(r)
		}
	}()
	cWorker = reqs
}
```

---

## Bug 10 — `runtime.NumGoroutine` for leak detection without a barrier

```go
func TestNoLeak(t *testing.T) {
	before := runtime.NumGoroutine()
	doWork()
	after := runtime.NumGoroutine()
	if after != before {
		t.Fatal("leak")
	}
}
```

**Bug.** Spawned goroutines may not have exited yet when `after` is read. Also, the runtime keeps a small pool of dormant Ms which appear as goroutines transiently. Tests using this pattern flake.

**Fix.** Use `goleak.VerifyNone(t)` from `go.uber.org/goleak`, or `runtime.GC(); time.Sleep(50 * time.Millisecond); runtime.GC()` to give finalizers and exiting goroutines a chance, then compare. Even then, prefer explicit shutdown (`ctx.Cancel`, `wg.Wait`) over polling.

---

## Bonus Bug — Profile rate change during profiling

```go
func mainTest() {
	runtime.SetCPUProfileRate(100)
	go doProfiling()
	time.Sleep(10 * time.Second)
	runtime.SetCPUProfileRate(1000) // bump
	time.Sleep(10 * time.Second)
}
```

**Bug.** `SetCPUProfileRate` can only be called when no profile is active. If `doProfiling` started a profile already, the second call panics or silently fails. The kernel timer cannot be reconfigured mid-flight.

**Fix.** Stop the profile, change the rate, restart:
```go
pprof.StopCPUProfile()
runtime.SetCPUProfileRate(1000)
pprof.StartCPUProfile(w)
```

---

## Lessons distilled

- Finalizers must not capture the object — only receive it as a parameter.
- `LockOSThread` always pairs with `UnlockOSThread` (or with G exit by design).
- `Gosched` is a *yield*, not a *block*; it does not break deadlocks.
- `runtime.GC()` is a debugging tool, not a memory-management tactic.
- `runtime.Stack(buf, true)` stops the world — never put it in a hot path.
- Internal `note`s are one-shot; clear before reuse.
- Goroutine-count-based leak detection is flaky; use synchronisation barriers.
