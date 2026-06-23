# Mutex Copying — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [What `copylocks` actually inspects](#what-copylocks-actually-inspects)
3. [Anatomy of `sync.Locker` and why it matters](#anatomy-of-synclocker-and-why-it-matters)
4. [The `noCopy` marker in depth](#the-nocopy-marker-in-depth)
5. [`RWMutex`, `WaitGroup`, `Once`, `Cond` — same rule, different consequences](#rwmutex-waitgroup-once-cond--same-rule-different-consequences)
6. [Patterns that obscure copying](#patterns-that-obscure-copying)
7. [Interaction with interfaces and generics](#interaction-with-interfaces-and-generics)
8. [Pointer vs value receiver — the full rule set](#pointer-vs-value-receiver--the-full-rule-set)
9. [`go vet` integration in real projects](#go-vet-integration-in-real-projects)
10. [Refactoring a value-typed API safely](#refactoring-a-value-typed-api-safely)
11. [Summary](#summary)

---

## Introduction

The junior file convinced you that copying a mutex is wrong. The middle file shows *how* the standard tooling and the standard library protect against it, and what gaps remain. We will look at the analyser source, the `noCopy` idiom as the standard library uses it, the cases where `RWMutex`/`WaitGroup`/`Once`/`Cond` each fail differently, and the migration techniques that turn a value-typed API into a pointer-typed one without breaking everything.

After this file you will be able to: recognise *any* copy site by inspection, decide between embedding `sync.Mutex` directly versus storing it as `*sync.Mutex`, write your own `noCopy`-protected type, and migrate a legacy codebase safely.

---

## What `copylocks` actually inspects

The `copylocks` analyser lives in `cmd/vendor/golang.org/x/tools/go/analysis/passes/copylock/copylock.go`. Its rule is simple: it walks the AST and finds every value-typed location where a copy occurs (assignments, parameters, returns, range, struct/composite literals, `go` and `defer` statements, function arguments, type assertions). For each such expression it asks: does the type *contain* a `sync.Locker`?

"Contains" is recursive. A struct that has a field of a struct that has a field whose type implements `Lock()` and `Unlock()` is enough. The check uses the static type system, not runtime types, so:

```go
var x interface{ Lock(); Unlock() } = something
y := x // not flagged — vet does not know what `something` is
```

Interfaces erase enough information that vet cannot trace the underlying type. This is the main blind spot. Other blind spots:

- Values constructed via `reflect.New().Elem()` — vet does not analyse reflective code.
- `unsafe.Pointer` casts — vet refuses to follow.
- Channels carrying a struct-with-mutex by value: `ch <- counter` is a copy. Vet *does* warn here in recent versions.
- Generics: `func id[T any](v T) T { return v }`. Vet's instantiation-aware mode catches this for some types in Go 1.21+, but not always. Always pass `*T`.

The diagnostic message follows a pattern:

```
<position>: <function-or-context> passes lock by value: <type> contains sync.Mutex
```

The position points at the *copy site*, not the original mutex declaration. Reading the position correctly is half the skill.

---

## Anatomy of `sync.Locker` and why it matters

```go
type Locker interface {
    Lock()
    Unlock()
}
```

Anything that satisfies this interface is, from vet's perspective, a "lock." `*sync.Mutex`, `*sync.RWMutex`, and `(*sync.RWMutex).RLocker()` all do. So does any custom type you write with those two methods. That is *also* how the `noCopy` marker works: it has empty `Lock()` and `Unlock()` methods so vet treats it as a `Locker` even though nothing locks.

Vet does not run interface satisfaction checks at every assignment — that would be prohibitive. It works the other way around. It maintains an internal list of *concrete* `Locker` types it knows about (`sync.Mutex`, `sync.RWMutex`, custom types found in the package) and a set of marker types like `noCopy`. When a value containing one of these in its transitive field set is copied, the warning fires.

The practical consequence: if you write a custom locker (rare), vet does not automatically know about it. You can either embed `sync.Mutex` underneath, or add an embedded `noCopy` marker, or both.

---

## The `noCopy` marker in depth

The canonical definition:

```go
// noCopy may be embedded into structs which must not be copied
// after the first use.
//
// See https://golang.org/issues/8005#issuecomment-190753527
// for details.
type noCopy struct{}

// Lock is a no-op used by -copylocks checker from `go vet`.
func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

A few subtle properties:

- **Zero size.** `unsafe.Sizeof(noCopy{}) == 0`. Embedding it does not change struct size or alignment.
- **Pointer receivers.** The methods are defined on `*noCopy`. Otherwise, calling `noCopy{}.Lock()` would itself trigger vet, which is undesirable.
- **Unexported.** Each package that wants the protection declares its own `noCopy`. The convention is to copy these eight lines into the package.
- **Embedded blank.** Usually written as `_ noCopy` so the marker is invisible to user code but still part of the field set vet inspects.

Standard library types that use `noCopy`:

- `sync.WaitGroup`
- `sync.Cond`
- `sync.Pool`
- `strings.Builder`
- `sync.Once` (Go 1.21+)
- `atomic.Int32`, `atomic.Int64`, etc. (since Go 1.19, alignment requires non-copy)

Pattern in production code:

```go
package mypkg

type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type Session struct {
    _    noCopy
    id   string
    once sync.Once
    done chan struct{}
}
```

This costs nothing at runtime and prevents copying via vet.

---

## `RWMutex`, `WaitGroup`, `Once`, `Cond` — same rule, different consequences

### `sync.RWMutex`

Same shape as `Mutex` internally but with two waiter counts (readers and writers) plus their own semaphores. Copying detaches both wait queues. The most insidious bug: a reader holds the original; a writer locks the copy. Both proceed.

```go
type Cache struct {
    mu sync.RWMutex
    m  map[string][]byte
}

func (c Cache) Get(k string) []byte { // BAD
    c.mu.RLock()
    defer c.mu.RUnlock()
    return c.m[k]
}
```

Reads on the original happen unprotected; writes on a different copy happen unprotected; the map data races.

### `sync.WaitGroup`

`WaitGroup` has an internal counter encoded into a 64-bit word along with a waiter count. The crucial property: `Add` and `Wait` must operate on the *same* word. Copying creates a `WaitGroup` whose counter is independent. The classic bug:

```go
func startWorkers(wg sync.WaitGroup) { // BAD
    for i := 0; i < 10; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            doWork()
        }()
    }
}

func main() {
    var wg sync.WaitGroup
    startWorkers(wg)
    wg.Wait() // returns immediately — its counter is still 0
}
```

The original `wg`'s counter never increments. `Wait` returns instantly. The 10 goroutines run concurrently with `main`'s exit, and most never finish. Vet:

```
startWorkers passes lock by value: sync.WaitGroup contains sync.noCopy
```

Fix: `func startWorkers(wg *sync.WaitGroup)`.

### `sync.Once`

The mistake here is conceptually rich. `sync.Once.Do(f)` must run `f` *exactly once across all callers*. If a `Once` is copied, you get two independent "once" objects, and `f` runs twice. The internal state of `Once` is one `atomic.Uint32` (the "done" flag) plus a `sync.Mutex` for the slow path. Both get duplicated.

```go
type App struct {
    initOnce sync.Once
}

func setup(a App) { // BAD
    a.initOnce.Do(realInit)
}
```

If `setup` is called twice with the same `a`, `realInit` runs twice (each call has its own `Once`). Most often the symptom is "the database connection pool was created twice."

### `sync.Cond`

`sync.Cond` is even more dangerous because its semantics rely on the *exact* mutex passed at construction. The `Cond` holds a pointer to that mutex. If you copy the outer struct that contains the `Cond`, you get a `Cond` whose internal pointer still points at the *original* mutex but whose `noCopy` marker is now duplicated. `Signal` and `Broadcast` will wake the wrong waiters or none. Almost no code copies a `Cond`; if you see it, treat as critical.

---

## Patterns that obscure copying

### Channel sends with value types

```go
ch <- counter   // copies counter into the channel buffer
c := <-ch       // copies it out
```

Channels with value-typed element types necessarily copy. Recent vet catches the obvious cases; older versions miss them. Always send `*T` for mutex-bearing types.

### `append` to a typed slice

```go
counters := []Counter{}
counters = append(counters, *c) // copies *c into the slice
```

`append` is value-copying. Build slices of pointers.

### Struct literal in a return

```go
func snapshot() Counter {
    var c Counter
    c.n = 10
    return c // copy of c, including its mutex
}
```

Vet flags this. The fix is one of:

- Return `*Counter` from a fresh allocation: `return &Counter{n: 10}`.
- Return a *snapshot* type that has no mutex: `return Snapshot{n: 10}`.

The second is often cleaner. Snapshots are by-value-friendly because they have no synchronisation responsibilities.

### Implicit conversion in `fmt.Println`

```go
fmt.Println(*c) // copies into interface{}; vet flags
fmt.Println(c)  // boxes pointer; safe
```

The receiver of `Println` is `...interface{}`. Each argument is boxed. Boxing a value-typed mutex-bearing struct copies it. Vet warns at the call site:

```
call of Println copies lock value: pkg.Counter contains sync.Mutex
```

### Method value on a value

```go
inc := c.Inc          // captures a copy of c if Inc has value receiver
inc := (*Counter).Inc // method expression; takes *Counter at call time
```

Method values can secretly capture a struct value. Stick to pointer receivers, and method values become safe.

---

## Interaction with interfaces and generics

### Interface boxing

Boxing a value type into an interface copies. Once inside the interface, vet cannot reason further.

```go
type Inc interface{ Inc() }

var c Counter
var i Inc = c // requires Inc method set with value receiver -> already a problem
```

If `Inc` is defined as a pointer-receiver method, the conversion `var i Inc = c` fails to compile (the value `Counter` does not implement `Inc`). This is a *feature*: writing pointer receivers forces callers to handle the pointer explicitly, preventing the bug from compiling.

### Generics

```go
func wrap[T any](v T) T { return v }

var c Counter
c2 := wrap(c) // copies; vet may or may not warn
```

Generic functions with `T any` parameters are copy-friendly. Two defences:

- For mutex-bearing types, design generics over `*T` instead: `func wrap[T any](v *T) *T { return v }`.
- Constrain the type: `type NotCopyable interface{ noCopyMarker() }` to force callers to use pointers.

Neither is automatic. Vet has been improving generic awareness; treat it as best-effort.

---

## Pointer vs value receiver — the full rule set

The Go style guide lists six bullet points for choosing receivers. For mutex-bearing types, only one matters: **use a pointer receiver**. Beyond that, here is the complete decision matrix.

| Situation | Receiver |
|-----------|----------|
| Struct has a mutex field | `*T` always |
| Struct embeds a mutex | `*T` always |
| Struct embeds a type that has a mutex (transitively) | `*T` always |
| Struct has only immutable fields, no mutex | Either works; prefer `*T` for large structs (>32B), `T` for small immutable values (`time.Time`-like) |
| Method must modify the receiver | `*T` |
| Need to satisfy an interface that also `*T` satisfies | `*T` |

There is a related, less-known rule: **the method set of a type must be consistent**. If any method takes `*T`, all should. Mixing receivers means `T` satisfies one interface and `*T` satisfies a different one — a confusing footgun. Pick one and stick to it.

---

## `go vet` integration in real projects

### CI integration

Minimal CI step:

```yaml
- name: vet
  run: go vet ./...
```

`go vet` exits with non-zero status if it finds problems. Treat as a hard failure.

### Editor integration

`gopls` runs vet's analyses (including `copylocks`) as you type. The squiggly underline shows up in:

- VS Code (with the Go extension)
- Goland
- Neovim (with `nvim-lspconfig` + `gopls`)
- Emacs (with `lsp-mode` + `gopls`)

Configure your editor to surface them. Treat a `copylocks` warning the way you would treat a syntax error.

### Combining with other linters

`staticcheck` (part of the `golangci-lint` ecosystem) has additional checks that overlap with `copylocks` but go deeper into reflection and reflection-like patterns. Common configuration in `.golangci.yml`:

```yaml
linters:
  enable:
    - govet     # includes copylocks
    - staticcheck
    - copyloopvar
    - errcheck
```

Some teams use `revive` with the `unnecessary-stmt` and `early-return` rules to encourage idioms that *reduce* the surface area of mutex-bearing types.

### Suppression — when, if ever

You may, in extremely narrow circumstances, need to silence `copylocks`. Example: a zero-value `Mutex` being moved during package init before any concurrency starts. Even then, prefer the pointer fix. If you must, document why:

```go
//nolint:copylocks // safe: m is the zero value and only used before any goroutines start
src := dst
```

Reviewers should reject such comments unless the reasoning is airtight.

---

## Refactoring a value-typed API safely

Suppose you inherit a package with:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func NewCounter() Counter             { return Counter{} }
func (c Counter) Inc()                { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c Counter) Value() int          { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

Every method has a value receiver. Vet screams. You must migrate to pointer receivers without breaking callers.

### Step 1: change receivers, run tests

```go
func (c *Counter) Inc()       { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Value() int { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

Now callers like `c := NewCounter(); c.Inc()` need `c` to be addressable. Local `var c Counter` is addressable; `c := NewCounter()` is too. Most callers compile unchanged. The ones that break are those that *stored* a `Counter` in a slice or map by value, or passed it as a function argument by value.

### Step 2: change the constructor signature

```go
func NewCounter() *Counter { return &Counter{} }
```

Callers `c := NewCounter()` continue to compile; the type of `c` is now `*Counter`. Method calls `c.Inc()` work transparently.

The break: any caller that wrote `var c Counter` and used it directly is unaffected by step 2 but may have been the one passing `c` by value to other code. Run vet again.

### Step 3: change collections

```go
counters := []Counter{}   // before
counters := []*Counter{}  // after

byID := map[int]Counter{} // before
byID := map[int]*Counter{} // after
```

These changes propagate. Every read site that does `c := byID[k]` must understand that `c` is now `*Counter`.

### Step 4: search for `Counter{` literals

`Counter{}` is a value literal. Anywhere it appears (constructors, tests, fixtures), it must become `&Counter{}` or `*NewCounter()`.

### Step 5: add `noCopy` for belt and braces (optional)

If your type's identity must never be copied, even by future maintainers who add fields, embed a `noCopy` marker. Vet will then flag any future regression.

### Step 6: re-run all CI

Run vet, `-race` tests, and integration tests. The migration is mechanical. Each step is small and reviewable.

---

## Summary

`copylocks` catches the obvious cases. The middle level is about the *less obvious*: channel sends, interface boxing, generics, refactoring. The `noCopy` marker is a zero-cost way to opt any type into vet's protection. Mutex copying is one symptom of the broader rule: **types with identity must never travel by value**. Once your project has internalised that rule, you can build types with mutexes, channels, atomic counters, or any other identity-bearing state without worrying about a class of silent bugs.

Run vet. Use pointer receivers. Return `*T` from constructors. Store `*T` in collections. Embed `noCopy` when in doubt. Now you are ready for the senior file, which dives into what happens *inside* the runtime when a mutex is copied: the corrupted `sema` queue, the double-locked critical section, the panic messages that tell you the wrong line.
