# Go Specification: Garbage Collection

**Source:** https://go.dev/doc/gc-guide

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **GC Guide** | https://go.dev/doc/gc-guide |
| **Pacer Design** | https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md |
| **Memory Model** | https://go.dev/ref/mem |
| **Go Version** | Go 1.0+ (concurrent GC since Go 1.5) |

The Go Language Spec doesn't formally specify GC behavior; it's an implementation detail. The GC Guide and pacer design docs are the authoritative references.

---

## 2. Definition

Go uses a **concurrent, tri-color, mark-sweep, non-generational, non-moving** garbage collector with **write barriers**.

- **Concurrent**: most work happens while user code runs.
- **Tri-color**: marks objects white (unreachable), grey (reachable, children unprocessed), black (reachable, children processed).
- **Mark-sweep**: identifies live objects, then frees the rest.
- **Non-generational**: doesn't separate young/old objects.
- **Non-moving**: objects don't relocate during GC.
- **Write barriers**: maintain GC invariants during concurrent marking.

---

## 3. Core Concepts

### 3.1 Tri-Color Algorithm
- White: not yet visited.
- Grey: visited but children not yet visited.
- Black: visited and children visited.

Mark phase: roots → grey. Process grey → black; children become grey. Done when no grey objects remain.

### 3.2 Roots
- Goroutine stack frames.
- Package-level variables (globals).
- Pointers in CPU registers at safepoints.

### 3.3 GC Phases
1. **Sweep termination** (STW): finish prior sweep.
2. **Mark setup** (STW): enable write barriers, scan roots.
3. **Concurrent mark**: scan heap, follow pointers.
4. **Mark termination** (STW): drain workbufs, disable barriers.
5. **Concurrent sweep**: reclaim unreachable memory.

Modern Go: STW phases <1 ms typically.

### 3.4 Write Barriers
During concurrent marking, every pointer mutation in heap memory triggers a write barrier:
```go
heapObj.field = newPtr // → runtime.gcWriteBarrier
```

Maintains the tri-color invariant: a black object's pointers should not be unprocessed.

### 3.5 The Pacer
Decides when to start GC and how aggressively. Goal: keep CPU usage at ~25% while meeting heap target.

`GOGC` env var: trigger ratio (default 100, meaning GC when heap doubles).

`GOMEMLIMIT` (Go 1.19+): soft memory cap.

### 3.6 Sweep
After mark, the sweep phase iterates over heap spans, marking unreached objects as free.

Concurrent: runs alongside user code.

### 3.7 Scavenging
Background return of unused heap pages to the OS.

`debug.FreeOSMemory()` triggers explicit scavenge.

---

## 4. Tunables

| Var | Default | Effect |
|-----|---------|--------|
| `GOGC` | 100 | Trigger ratio (% growth before GC) |
| `GOMEMLIMIT` | unset | Soft memory cap (Go 1.19+) |
| `GOMAXPROCS` | NumCPU | # OS threads (affects GC parallelism) |
| `GODEBUG=gctrace=1` | off | Print GC trace |

---

## 5. Defined Behavior

| Situation | Behavior |
|-----------|----------|
| Allocation rate spikes | Pacer triggers GC sooner |
| Heap below target | GC delayed |
| Goroutine leak | Memory grows unbounded |
| `runtime.GC()` call | Forces a cycle |
| `debug.SetGCPercent(-1)` | Disables GC (DANGEROUS) |
| Nil pointer dereference | Panic; not a memory issue |

---

## 6. Spec Compliance Checklist

- [ ] Trust default GC for normal code
- [ ] Set `GOMEMLIMIT` in container deployments
- [ ] Profile with `pprof` and `gctrace`
- [ ] Use `sync.Pool` for high-throughput allocations
- [ ] Reduce pointer density for low-pause services
- [ ] Cancel long-running goroutines

---

## 7. Related Spec Sections

| Section | URL |
|---------|-----|
| GC Guide | https://go.dev/doc/gc-guide |
| Pacer redesign | https://go.googlesource.com/proposal/+/master/design/44167-gc-pacer-redesign.md |
| `runtime/debug` | https://pkg.go.dev/runtime/debug |
| `runtime` | https://pkg.go.dev/runtime |
