---
layout: default
title: Optimize
parent: Method Sets Deep
grand_parent: Methods & Interfaces
nav_order: 9
---

# Method Sets Deep — Optimize

← Back

This file focuses on performance and cleaner code through the lens of **method sets**. Every example revolves around four levers: the `T` vs `*T` method set split, addressability, embedding propagation, and the Go 1.22 per-iteration loop variable. Each section shows how a method-set decision changes escape analysis, devirtualization, allocation count, or readability.

---

## 1. Receiver choice drives the method set — and the cost model

Once you write `func (b *Buffer) Write(...)`, the method set of `Buffer` (the value) excludes `Write`. That is not just a typing rule — it determines whether callers must take an address, whether values can be stored in maps and used directly, and whether the compiler can devirtualize the call site.

```go
type Buffer struct{ data [4096]byte; pos int }

func (b *Buffer) Write(p []byte) { /* ... */ }   // *Buffer only
func (b Buffer)  Len() int       { return b.pos } // both T and *T
```

Cost model:

| Decision | Method set of `T` | Method set of `*T` | Allocation pressure |
| --- | --- | --- | --- |
| All value receivers | full | full | low (copies are cheap if `T` is small) |
| All pointer receivers | empty for pointer methods | full | callers often need addressable storage |
| Mixed | partial | full | unpredictable for embedding/interface boxing |

Picking pointer receivers for a small `Point` "to be safe" expands the cost surface: every interface assignment now needs an addressable `Point`, which forces it to escape. Pick by **size and mutation**, not habit.

---

## 2. Interface boxing turns "*T method set" into a heap allocation

A `T` value placed into an interface variable does **not** carry the `*T` method set, because the boxed value is not addressable. When the compiler has to satisfy a pointer-receiver interface, it must allocate a `*T` on the heap.

```go
type Stringer interface{ String() string }

type Tag struct{ Name string }
func (t *Tag) String() string { return t.Name }   // pointer receiver only

func describe(s Stringer) { _ = s.String() }

func hot() {
    t := Tag{Name: "x"}
    describe(&t)   // explicit address — *Tag in the interface, no extra alloc
    // describe(t) // would not even compile: Tag has no String method
}
```

Now compare to a value receiver:

```go
func (t Tag) String() string { return t.Name }   // value receiver

func hot() {
    t := Tag{Name: "x"}
    describe(t)   // boxed — t is copied into the interface word; usually no escape if small
}
```

The escape analyzer prints this clearly:

```bash
go build -gcflags='-m=2' ./...
# ./main.go:NN: &t escapes to heap
# ./main.go:NN: moved to heap: t
```

Rule: if a method has a pointer receiver, prefer to pass `&t` explicitly — do not rely on the compiler to "do the right thing" through a value, because it cannot.

---

## 3. Addressability of map elements and the hidden copy

Map elements are **not addressable**. A pointer-receiver method cannot be called on `m[k]` directly. The idiomatic workaround copies, mutates, and writes back — and that copy is the cost.

```go
type Counter struct{ n int }
func (c *Counter) Inc() { c.n++ }

m := map[string]Counter{"a": {}}
// m["a"].Inc()           // compile error — addressability
c := m["a"]               // copy 1: read out of map
c.Inc()                   // pointer receiver works on local
m["a"] = c                // copy 2: write back into map
```

Two copies per update. For hot counters this is wasteful. Two cleaner alternatives:

```go
// Option A — store *Counter; one allocation, zero copies on update
mp := map[string]*Counter{"a": {}}
mp["a"].Inc()             // *Counter is addressable through the map word

// Option B — keep value receiver and return new value
func (c Counter) Inc() Counter { c.n++; return c }
m["a"] = m["a"].Inc()
```

Option A is faster on hot paths. Option B is allocation-free but requires the explicit assignment.

---

## 4. Slice element addressability — free pointer methods

Unlike map elements, slice elements **are** addressable: `s[i]` yields an addressable location. Pointer-receiver methods can be invoked directly without copying.

```go
type Item struct{ Tally int }
func (it *Item) Bump() { it.Tally++ }

xs := make([]Item, 1024)
for i := range xs {
    xs[i].Bump()   // addressable — no copy, no extra allocation
}
```

Compare to placing the same data behind an interface slice:

```go
type Bumper interface{ Bump() }
ifaces := make([]Bumper, len(xs))
for i := range xs {
    ifaces[i] = &xs[i]   // addresses are stable for the slice lifetime
}
for _, b := range ifaces {
    b.Bump()             // dynamic dispatch
}
```

The first loop is statically dispatched and inlinable. The second pays an itab indirection per call. If you can choose between "slice of concrete type" and "slice of interface", the concrete slice keeps the `*T` method set in play without boxing.

---

## 5. Devirtualization and the static-type win

Recent Go compilers can devirtualize an interface call when the concrete type is provable at the call site. The decisive factor is method-set membership of the **static** type, not the dynamic one.

```go
type Reader interface{ Read([]byte) (int, error) }

type fileReader struct{ /* ... */ }
func (f *fileReader) Read(p []byte) (int, error) { /* ... */ }

func copyFrom(r Reader, p []byte) { _, _ = r.Read(p) } // dynamic

func copyFromFile(f *fileReader, p []byte) { _, _ = f.Read(p) } // static
```

`copyFromFile` lets the compiler resolve `Read` at compile time. The body can be inlined, the receiver stays in a register, and there is no itab lookup. When you write helpers around a known concrete type, type the parameter as `*T` rather than as the interface — you keep the API readable and the compiler's optimization options open.

---

## 6. Embedding propagation: T-embed vs *T-embed

Embedding changes the method set of the outer struct based on whether the embedded field is `T` or `*T`. This affects both correctness and allocation.

```go
type Logger struct{ prefix string }
func (l Logger)  Info(msg string)  { /* value receiver */ }
func (l *Logger) Reset()           { /* pointer receiver */ }

// Embed by value
type Service struct{ Logger }

// Embed by pointer
type ServiceP struct{ *Logger }
```

Method sets:

| Outer | Inherited methods on outer value | Inherited methods on `*outer` |
| --- | --- | --- |
| `Service` (T-embed) | `Info` only | `Info`, `Reset` |
| `ServiceP` (*T-embed) | `Info`, `Reset` | `Info`, `Reset` |

Performance consequences:

```go
func use(s Service)  { s.Info("hi") }   // copies the whole Logger inside Service
func useP(s ServiceP) { s.Info("hi") }  // copies a pointer; underlying Logger shared
```

For wide loggers, configurations, or anything that contains a `sync.Mutex`, embed by pointer to keep the outer struct cheap to copy and to expose the full method set on both `T` and `*T`.

Watch out for the inverse trap: embedding by value puts a `*Logger` method like `Reset` out of reach of `Service` values stored in interfaces (Section 2 again).

---

## 7. The `&T{}` literal pattern for pointer-method types

A composite literal `T{}` is not addressable, and `&T{}` is the canonical way to obtain the full method set without a temporary variable. This matters in initializer lists, registries, and dispatch tables.

```go
type Handler struct{ name string }
func (h *Handler) Serve() { /* ... */ }

// Compile error — composite literal not addressable for pointer method
// _ = (Handler{name: "x"}).Serve

var registry = map[string]interface{ Serve() }{
    "a": &Handler{name: "a"}, // *Handler — full method set, single alloc
    "b": &Handler{name: "b"},
}
```

The `&T{}` form allocates once at registry-build time. Avoid the alternative of copying a `Handler` into a local just to take its address — it adds a redundant copy and confuses readers about ownership.

---

## 8. Method values, method expressions, and per-iteration cost

`s.M` (method value) captures the receiver into a closure — a heap allocation in most cases. `T.M` or `(*T).M` (method expression) is a plain function pointer; the receiver is passed as the first argument. In hot loops this difference dominates.

```go
type Service struct{ /* ... */ }
func (s *Service) Handle(x int) { /* ... */ }

func hotValue(s *Service, xs []int) {
    for _, x := range xs {
        f := s.Handle   // method value — closure alloc per iteration
        f(x)
    }
}

func hotExpr(s *Service, xs []int) {
    f := (*Service).Handle   // method expression — one assignment, no closure
    for _, x := range xs {
        f(s, x)
    }
}

func hotDirect(s *Service, xs []int) {
    for _, x := range xs {
        s.Handle(x)   // best — devirtualizable, inlinable
    }
}
```

Confirm with `-gcflags='-m=2'`:

```bash
go build -gcflags='-m=2' ./...
# main.go:NN: s.Handle escapes to heap
# main.go:NN: func literal escapes to heap
```

Direct call wins when possible. When you must store a callback, prefer the method expression — it does not capture state, so the GC never sees it.

---

## 9. Go 1.22 loop scoping — method values stop sharing receivers

Before Go 1.22, a method value `s.M` taken inside `for _, s := range items` captured the **single** loop variable. All callbacks ended up bound to the last element. Go 1.22 makes the loop variable per-iteration, fixing the shared-receiver bug at the cost of one fresh stack slot per iteration.

```go
type Worker struct{ id int }
func (w *Worker) Run() { fmt.Println(w.id) }

workers := []Worker{{1}, {2}, {3}}

var fns []func()
for _, w := range workers {
    fns = append(fns, w.Run)   // method value — receiver captured
}
for _, f := range fns { f() }
```

Pre-1.22 output: `3 3 3` (all closures share `w`).
Go 1.22+ output: `1 2 3` (each iteration gets its own `w`).

That correctness win has a method-set angle: `w.Run` is a `*Worker` method, so the closure must keep an addressable copy. The 1.22 model allocates a per-iteration `Worker` (or its address) — a small but real cost. If the loop is hot and you do not need a per-iteration closure, hoist:

```go
// Hot-loop variant — index by pointer into the slice
for i := range workers {
    fns = append(fns, workers[i].Run) // &workers[i] — single backing array
}
```

Slice-element addressability (Section 4) avoids the per-iteration allocation entirely.

For writers of libraries: do not rely on the **old** loop semantics in documented examples. Recommend `&xs[i]` or method expressions explicitly, so behaviour is identical on every Go version.

---

## 10. `range` over channels and pointer receivers

The Go 1.22 fix applies to `for range` loops broadly, including `for v := range ch`. Each received value gets its own slot. If the channel carries pointer types, the method set is unaffected; if it carries values with pointer-receiver methods, beware:

```go
type Job struct{ ID int }
func (j *Job) Run() { /* ... */ }

ch := make(chan Job, 16)

go func() {
    for j := range ch {
        // j is addressable as a local — pointer methods OK
        j.Run()
    }
}()
```

`j` is a local variable; `j.Run()` takes its address implicitly (Section 11). No additional allocation, even though `Run` has a pointer receiver. Compare to:

```go
for j := range ch {
    go (&j).Run() // explicit; j escapes — heap alloc per iteration
}
```

Each goroutine outlives the loop iteration, so the address must escape. This is the kind of cost that disappears when you switch the channel to `chan *Job` and let the producer pay the allocation once.

---

## 11. Implicit `&x` and `*x` in selectors — when the compiler does it for you

For an addressable value `x`, Go automatically takes the address when calling a pointer-receiver method (`x.M()` becomes `(&x).M()`), and dereferences a pointer when calling a value-receiver method (`p.M()` becomes `(*p).M()`). This is purely syntactic — there is no allocation.

```go
type Box struct{ n int }
func (b *Box) Inc() { b.n++ }

func ok() {
    var b Box
    b.Inc()              // compiler rewrites to (&b).Inc(); b is on the stack
}

func wrong() {
    Box{}.Inc()          // compile error — Box{} is not addressable
}
```

Knowing this rule lets you keep code free of explicit `&` noise:

```go
// Verbose
counter := Counter{}
(&counter).Inc()

// Idiomatic — same machine code
counter := Counter{}
counter.Inc()
```

If you find yourself writing `&x` in front of every method call, the type probably wants a pointer-receiver-only design **and** the storage should already be `*T`.

---

## 12. Cleaner-code patterns rooted in method sets

### Pattern 1 — One receiver style per type

Mixed receivers leak addressability rules into every caller and break the "T and *T have a uniform method set" mental model.

```go
// Bad
func (b Buffer)  Len() int       { return len(b.data) }
func (b *Buffer) Reset()         { b.data = nil }
func (b Buffer)  String() string { return string(b.data) }

// Good — pick one
func (b *Buffer) Len() int       { return len(b.data) }
func (b *Buffer) Reset()         { b.data = nil }
func (b *Buffer) String() string { return string(b.data) }
```

`go vet` and `staticcheck` have lint rules for this; turn them on.

### Pattern 2 — Embed by pointer for shared state

If embedded state is shared (logger, config, registry), embed `*T`. The outer becomes cheap to copy and keeps the full method set on both forms.

```go
type App struct{ *Config; *Logger }
```

### Pattern 3 — Document the addressability requirement

When an API needs `*T` for its method set, make the parameter `*T`. Avoid taking an interface and "hoping" that callers pass an addressable value.

```go
// Bad — addressability is invisible at the call site
func Register(s fmt.Stringer)

// Good — the *T contract is explicit
func Register(s *Service)
```

### Pattern 4 — Prefer slices to maps for pointer-method values

Slice elements are addressable; map elements are not. When the value type has pointer methods, a slice keyed by a small struct or an index map (`map[K]int`) is faster than `map[K]V`.

---

## 13. Profiling commands you actually use

```bash
# Escape analysis — verify whether & and method values trigger heap moves
go build -gcflags='-m=2' ./...

# Inlining decisions — confirm pointer-receiver methods inline
go build -gcflags='-m=2' ./... 2>&1 | grep -i inline

# CPU profile — find the hot dispatch
go test -bench=. -cpuprofile=cpu.prof ./...
go tool pprof -list 'pkg\.\(\*T\)\.Method' cpu.prof

# Allocation profile — surface per-iteration method-value closures
go test -bench=. -benchmem -memprofile=mem.prof ./...
go tool pprof -alloc_objects mem.prof
```

The single most useful flag for this section is `-gcflags='-m=2'`. Run it after every receiver change, every interface refactor, and every loop-variable rewrite.

---

## 14. Cheat sheet

```
METHOD SET RULES
─────────────────────────────
T  has value methods only
*T has value + pointer methods
Interface boxing strips *T methods of T
Map elements: not addressable
Slice elements: addressable
Composite literals: not addressable

ALLOCATION TRIGGERS
─────────────────────────────
Method value s.M               → closure alloc
Pointer method on map value    → 2 copies + assign
&T{} in registry               → one heap object
Interface{ T value }           → boxing copy

DEVIRTUALIZATION
─────────────────────────────
Static type *T                 → can inline
Static type Iface              → itab lookup
Concrete-type helper           → keep it concrete

EMBEDDING
─────────────────────────────
Embed T   → *outer gets *T methods only via outer addressability
Embed *T  → both outer and *outer get full method set

GO 1.22 LOOPS
─────────────────────────────
Per-iteration loop variable
Method values bind to fresh receiver
Hot path → use index access or method expression
```

---

## Summary

Method sets are not just a language detail — they shape the cost surface of your program.

1. **Receiver choice** writes the method set; mixed receivers leak addressability into every caller.
2. **Interface boxing** loses the `*T` method set for `T` values; pass `&t` explicitly when the contract uses pointer receivers.
3. **Map elements are not addressable**; either store `*T` or design a value-returning method.
4. **Slice elements are addressable**, which gives you free pointer-method calls inside loops.
5. **Embedding by value** restricts the inherited method set; embedding by pointer preserves it and keeps the outer cheap to copy.
6. **Method values** allocate; method expressions and direct calls do not.
7. **Go 1.22** per-iteration loop variables fix the shared-receiver bug but introduce per-iteration storage — use `&xs[i]` for hot loops.
8. **`-gcflags='-m=2'`** is the only reliable confirmation; intuition is not enough.

Profile the receiver choice, write tests around addressability, and let the method set be the contract — not a surprise.
