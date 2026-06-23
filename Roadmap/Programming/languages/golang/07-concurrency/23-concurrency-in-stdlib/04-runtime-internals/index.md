---
layout: default
title: Runtime Internals Used by Stdlib
parent: Concurrency in Stdlib
grand_parent: Concurrency
ancestor: Go
nav_order: 4
has_children: false
permalink: /roadmap/programming-languages/golang/07-concurrency/23-concurrency-in-stdlib/04-runtime-internals/
---

# Runtime Internals Used by Stdlib

[← Back](../)

Almost every concurrent primitive you import from the standard library — `sync.Mutex`, `sync.WaitGroup`, `time.Timer`, `net.Conn`, `os/signal`, `runtime/pprof`, even `fmt.Println` when it locks `os.Stdout` — is built on a small set of low-level helpers that live in the `runtime` package. Some of these helpers are *exported*: you can call `runtime.Gosched`, `runtime.LockOSThread`, `runtime.SetFinalizer`, `runtime.NumGoroutine`, `runtime.GC`, `runtime.Stack`. Others are *unexported* but documented through their consumers: `gopark` / `goready` (how a goroutine sleeps and wakes), `notesleep` / `notewakeup` (note-based signalling used by mutex slow paths), `semacquire` / `semrelease` (the semaphore that backs `sync.Mutex` and `sync.WaitGroup`), `runtime.lock` / `runtime.unlock` (runtime-internal mutexes), `runtime.procPin` / `runtime.procUnpin` (used by `sync.Pool`).

This subsection walks through that lower layer. We are not re-explaining the scheduler — section 10 already does that. We are explaining the stdlib-visible side: which `runtime` primitive does each stdlib package call into, what guarantees does it provide, and how do you reach for the right one when you are writing code that has to cooperate with the runtime (cgo callbacks, signal handlers, finalizers, profilers, real-time threads).

## Sub-pages

- [junior.md](junior.md) — What the `runtime` package is, the small set of exported helpers (`Gosched`, `LockOSThread`, `SetFinalizer`, `NumGoroutine`, `Goexit`, `GC`), and simple examples of when stdlib uses them under the hood
- [middle.md](middle.md) — Internal runtime primitives walked through with source references: `note`, `sema`, `gopark` / `goready`, `runtime.lock`, `procPin`. How `sync.Mutex.Lock`, `sync.WaitGroup.Wait`, and `sync.Pool.Get` actually reach the runtime
- [senior.md](senior.md) — `netpoll` integration with stdlib `net`, the per-P timer wheel used by `time.Sleep` / `time.After` / `time.Timer`, the race detector shim points (`racefuncenter`, `raceread`, `raceacquire`), the CPU profiler signal-handling goroutine, runtime/trace event emission
- [professional.md](professional.md) — Production debugging recipes: `SetBlockProfileRate`, `SetMutexProfileFraction`, `/debug/pprof/goroutine`, `runtime.Stack` for crash dumps, reading the goroutine dump format, sysmon-driven preemption diagnostics
- [specification.md](specification.md) — Normative excerpts from `runtime` package godoc, `runtime/race` documentation, `runtime/trace` event format, Go memory model statements about runtime helpers
- [interview.md](interview.md) — 30+ interview questions about runtime concurrency primitives from junior to staff
- [tasks.md](tasks.md) — Hands-on exercises: write a cgo-friendly goroutine with `LockOSThread`, profile a deadlock with the block profile, dump all goroutines on `SIGUSR1`
- [find-bug.md](find-bug.md) — 8-10 buggy snippets: `SetFinalizer` with a capturing closure, `LockOSThread` without `UnlockOSThread`, deadlock from `runtime.Gosched` misuse
- [optimize.md](optimize.md) — When `LockOSThread` helps and when it hurts, profiling overhead tuning, runtime knobs (`GOGC`, `GOMEMLIMIT`, `GODEBUG`) that affect concurrency behaviour
