# Interface Internals — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Production debugging via runtime fields](#production-debugging-via-runtime-fields)
3. [Observability: tracing interface allocations](#observability-tracing-interface-allocations)
4. [Code that triggers boxing — find it, fix it](#code-that-triggers-boxing-find-it-fix-it)
5. [Reducing itabTable pressure](#reducing-itabtable-pressure)
6. [FFI/cgo — interface values across the boundary](#fficgo-interface-values-across-the-boundary)
7. [Plugin systems and itab churn](#plugin-systems-and-itab-churn)
8. [Migrating an API from any to typed interfaces](#migrating-an-api-from-any-to-typed-interfaces)
9. [Stable typed-nil hygiene at the team level](#stable-typed-nil-hygiene-at-the-team-level)
10. [Linters and CI gates](#linters-and-ci-gates)
11. [Memory and GC budgeting](#memory-and-gc-budgeting)
12. [Deployment-time inspection checklist](#deployment-time-inspection-checklist)
13. [Summary](#summary)

---

## Introduction

In production you do not ask "what is an iface?" any more — you ask: "Why did our 99th percentile p99 latency rise 30% after the refactor?" Then you discover the refactor introduced a generic event handler taking `any` for payload, and three popular event types now box on every emit. This file walks the diagnostic, mitigation, and prevention loop for interface-related issues at scale.

---

## Production debugging via runtime fields

### Read the headers from a core dump

`delve` can print interface internals:

```
(dlv) print req.Body
io.ReadCloser{
    tab:  *runtime.itab(0x4f2160),
    data: 0xc0000a4000,
}
```

If `tab` is non-nil and `data` is `0x0` you have a typed nil — a strong signal the surrounding code returned a concrete nil.

### Inspect itab via gdb

```
(gdb) p ((struct runtime__itab *)0x4f2160)->_type
$1 = (struct runtime___type *) 0x4d4ee0    # *os.File
```

Knowing how to read these in a production debugger is the difference between hours and minutes when triaging.

### Print interface info from inside the program

```go
import "reflect"

func describe(i any) {
    if i == nil {
        fmt.Println("interface value is nil")
        return
    }
    rv := reflect.ValueOf(i)
    fmt.Printf("dynamic type=%v kind=%v ptr=%v\n", rv.Type(), rv.Kind(), rv.Pointer())
}
```

Embed this in error logs when you suspect typed-nil regressions; the `dynamic type` printed reveals whether the value is "typed nil" before you reach the comparison.

---

## Observability: tracing interface allocations

### Continuous profiling

Run `pprof` periodically; aggregate `runtime.convT*` samples per service. A sudden uptick after a deployment is almost always a boxing regression.

```bash
go test -bench=. -benchmem -cpuprofile=cpu.out -memprofile=mem.out
go tool pprof -top mem.out | grep convT
```

Typical output:

```
flat  flat%   sum%        cum   cum%
 0.5MB 12%  12%       0.5MB 12%  runtime.convT64
 0.4MB 10%  22%       0.4MB 10%  runtime.convTstring
```

### Tracing assertions

`runtime.assertE2I` calls indicate dynamic interface conversions. They are cached — usually fine — but in certain plugin paths each call site sees new (interface, type) pairs and pays first-time cost.

### Build tag for verbose tracing

```go
//go:build dbgiface

func boxAlert(name string) { log.Printf("box: %s\n", name) }
```

Wrap conversions in helpers that call `boxAlert` only in debug builds:

```go
func emit(payload any) {
    if traceEnabled {
        boxAlert(reflect.TypeOf(payload).String())
    }
    queue <- payload
}
```

---

## Code that triggers boxing — find it, fix it

### Symptom 1 — methods accepting `any`

```go
func (l *Logger) WithField(k string, v any) *Logger { ... }
```

Every call boxes the value. If callers tend to pass scalar types, throughput drops. Mitigation:

```go
type Field struct {
    Key string
    Int int64
    Str string
    Tag fieldKind
}
func (l *Logger) WithInt(k string, v int64) *Logger    { ... }
func (l *Logger) WithStr(k string, v string) *Logger   { ... }
```

`zap` and `zerolog` use this technique.

### Symptom 2 — slices of interface

```go
events := []any{1, "two", true}
```

Each insert boxes. If the events have a fixed shape, prefer a tagged union struct:

```go
type Event struct {
    Kind   EventKind
    IntVal int64
    Str    string
}
```

### Symptom 3 — map values typed as `any`

```go
cache := map[string]any{}
cache["count"] = 42
```

Same boxing cost on every store; even worse, the GC has to scan all values pessimistically. Migrate to a typed cache where possible (`map[string]int64`).

### Symptom 4 — interface conversion inside a hot loop

```go
for _, v := range vals {
    if x, ok := v.(io.Reader); ok { _ = x.Read(buf) }
}
```

`v.(io.Reader)` requires `getitab(io.Reader, dynamic)` once per dynamic type — usually once per loop. Fine. But:

```go
for _, v := range vals {
    var r io.Reader = v.(io.Reader) // panics on miss
}
```

Each iteration creates a fresh iface header; it's still cheap, but allocation may sneak in if the result escapes the loop. Profile `convI2I` to see.

---

## Reducing itabTable pressure

Long-running servers that load many plugin types (rare) can grow `itabTable` unboundedly. Guidelines:

1. Prefer **interface** parameters with the same set of types you already use elsewhere — pairs you have are already cached.
2. Avoid synthesizing fresh interfaces inside hot paths (`var i interface{ M() } = x`).
3. If you do code generation, reuse named interfaces across generated code rather than emitting new ones per package.

To audit:

```bash
go tool nm ./mybin | awk '$3 ~ /^go:itab\./' | wc -l
```

Compare across releases. Numbers in the low thousands are normal; sudden jumps indicate generated code introducing new interfaces.

---

## FFI/cgo — interface values across the boundary

cgo passes scalars and pointers; it cannot pass Go interface headers (they are not C-stable). Patterns:

### Pass a handle, not the interface

```go
type handle uintptr

var (
    handles   = map[handle]any{}
    handlesMu sync.Mutex
    nextID    handle
)

//export RegisterCallback
func RegisterCallback(cb C.callback_t) C.uintptr_t {
    handlesMu.Lock(); defer handlesMu.Unlock()
    nextID++
    handles[nextID] = cb
    return C.uintptr_t(nextID)
}
```

C-side stores the integer handle, Go-side resolves it back through the map. Interface header stays inside Go.

### Avoid passing `any` to a goroutine that will hand it to cgo

Boxing inside `any` makes the data heap-allocated; if cgo retains the pointer beyond the call, the GC may move or collect it. Always copy out the concrete value before crossing the boundary.

### `runtime.Pinner` (Go 1.21+)

```go
var pinner runtime.Pinner
pinner.Pin(buf)
defer pinner.Unpin()
C.consume(unsafe.Pointer(&buf[0]))
```

This pins the underlying memory regardless of how it was obtained — useful when the data came from an interface boxing path.

---

## Plugin systems and itab churn

`plugin.Open` loads a `.so` and resolves symbols. New types arrive at runtime; the runtime calls `getitab` for each `(I, T)` pair you assert, creating fresh `itab`s. The cost is paid on first use; subsequent calls are cached.

Hot-reloading plugins is **not** safe in Go: itabs are never freed and they reference the type's method pointers. Unloading a plugin would dangle those pointers. Treat plugin types as permanent.

---

## Migrating an API from any to typed interfaces

A common refactor: a public API initially exposes `any` and later hardens to a typed interface.

### Step 1 — introduce the typed interface

```go
type Payload interface {
    Kind() string
    Marshal() ([]byte, error)
}
```

### Step 2 — accept both temporarily

```go
func Send(p any) error {
    if pv, ok := p.(Payload); ok {
        return sendTyped(pv)
    }
    // legacy path
    return sendAny(p)
}
```

### Step 3 — migrate callers

Add a deprecation note: `// Deprecated: pass a Payload to Send.`

### Step 4 — drop `any`

```go
func Send(p Payload) error { ... }
```

Migration cost: each call site must adapt. The pay-off is fewer allocations, no typed-nil ambiguity (the interface is opinionated), and easier reflection.

---

## Stable typed-nil hygiene at the team level

A team can prevent typed-nil bugs by making the patterns visible:

### Rule 1 — never `return e` when `e` is a typed pointer

```go
// BAD
func find() error {
    var e *MyErr
    return e
}

// GOOD
func find() error {
    var e *MyErr
    if e == nil {
        return nil
    }
    return e
}
```

### Rule 2 — short-circuit at API boundaries

```go
func handler(...) error {
    err := pkg.Find()
    if err == nil {
        return nil
    }
    if errors.Is(err, ErrNotFound) { ... }
    return err
}
```

A typed-nil that leaks through `pkg.Find()` will be caught here (the wrapping function returns nil cleanly).

### Rule 3 — review checklist

> "Every function returning `error` returns either a real error or the literal `nil`."

Add this line to the code-review template.

### Lint with `nilness`

```bash
go vet -vettool=$(which nilness) ./...
```

`golang.org/x/tools/go/analysis/passes/nilness` is the canonical analyzer. It catches a subset of typed-nil bugs.

---

## Linters and CI gates

| Linter | What it catches |
|--------|-----------------|
| `nilness` | Typed-nil returns and dereferences. |
| `staticcheck SA4023` | "Comparing impossible types" — interface holding uncomparable type. |
| `gocritic` `interfaceparam` | Functions that accept `any` where a typed interface would do. |
| `interfacer` (legacy) | Suggests narrower interfaces. |
| `revive` `unused-parameter` | Helps remove `any` parameters that no caller uses. |

CI gate idea:

```yaml
- name: vet
  run: go vet ./...
- name: staticcheck
  run: staticcheck ./...
- name: nilness
  run: go vet -vettool=$(which nilness) ./...
```

Add a custom check that bumps a counter on every new `go:itab.*` symbol; fail the build if the count grew faster than expected.

---

## Memory and GC budgeting

Each interface conversion that boxes contributes:

- ~16 bytes for the heap copy of small primitives (rounded up to allocation class).
- 32 bytes for strings (`*string` header + 16-byte string header).
- One pointer scan per interface value during GC.

For a service that emits 100k events/sec, replacing `any` payload with a tagged union frequently saves ~MB/s of allocation rate, reducing GC frequency proportionally. Measure with `runtime.ReadMemStats`:

```go
var s runtime.MemStats
runtime.ReadMemStats(&s)
fmt.Println("alloc/s:", s.Mallocs)
```

Compare before/after the refactor.

---

## Deployment-time inspection checklist

- [ ] `pprof` heap shows no `runtime.convT*` in top-10 unless intentional.
- [ ] Total `go:itab.*` symbols are stable release over release.
- [ ] No typed-nil patterns flagged by `nilness`.
- [ ] All public APIs returning `error` are clean by spot-checking with `grep -nE 'return [a-zA-Z]+\s*$' | head` and reviewing.
- [ ] Hot-path benchmarks run with `-benchmem` and show 0 allocs/op for interface-free fast paths.
- [ ] cgo interfaces use handle pattern, not raw interface pointers.

---

## Summary

In production, interface internals matter most when something measurable changes: latency, allocation rate, GC pause, binary size. The toolkit:

- Read the headers (delve, gdb, reflect-based logging) to spot typed-nils and unexpected dynamic types.
- Profile `convT*` and `assertE2I` to find boxing and assertion hotspots.
- Audit `go:itab.*` symbol count per release.
- Migrate `any` parameters to typed interfaces; introduce tagged unions.
- Lint with `nilness`, `staticcheck SA4023`, `gocritic interfaceparam`.
- Pin memory at the cgo boundary; never let interface-boxed data cross naively.

A team that internalises these practices spends fewer hours debugging "weird" interface behaviour and more hours building features.
