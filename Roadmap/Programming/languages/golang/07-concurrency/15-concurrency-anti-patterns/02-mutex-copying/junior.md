# Mutex Copying — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "I added a mutex but my data race is still there. Why?"

A `sync.Mutex` is a tiny struct — two integer fields. Its job is to be a *unique point of coordination* between goroutines: every goroutine that touches the protected data must lock the same mutex. The instant you copy that struct, you have two mutexes. Half your code locks one, half the other, and neither prevents anything.

This anti-pattern is so common that the standard `go vet` tool ships with a dedicated check named **copylocks** that runs on every `go build` triggered by most modern editors. It will flag the obvious cases. It will not flag every case. Understanding *why* mutex copying is a bug is the only reliable defence.

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func (c Counter) Inc() { // BAD — value receiver makes a copy
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

That single character — receiver `c` instead of `*c` — silently disables the mutex. Every call to `Inc` operates on a *copy* of the counter. The original `n` is never incremented and the original `mu` is never observed as locked.

After reading this file you will:

- Know what is inside `sync.Mutex` and why splitting it is fatal
- Recognise the five most common ways to accidentally copy a mutex
- Read and trust `go vet`'s `copylocks` diagnostic
- Know that the same rule applies to `RWMutex`, `WaitGroup`, `Once`, `Cond`
- Use pointer receivers and pointer fields by default for any type that holds a mutex
- Wrap a value with `noCopy` so that vet refuses to copy it even without a mutex field

You do not need to know the bit layout of the mutex state word, the futex syscall, or the starvation-mode hand-off here. Those are in the professional-level mutex file. This file is about *not corrupting your own locks*.

---

## Prerequisites

- **Required:** Comfort with `sync.Mutex` — what `Lock`/`Unlock` does and why a critical section exists. If you have not used a mutex yet, read `03-sync-package/01-mutexes/junior.md` first.
- **Required:** Familiarity with Go method receivers — the difference between `func (s State)` and `func (s *State)`.
- **Required:** Awareness that struct assignment in Go is a *byte-for-byte copy*. There is no copy constructor.
- **Helpful:** Having seen `go vet` output, even once. We will lean on it.
- **Helpful:** Read one short data-race story (a postmortem) before starting. Bugs in this category often look like "phantom" failures.

If you can write `mu.Lock()` and explain what it does, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`sync.Mutex`** | A mutual-exclusion lock. Internally `struct { state int32; sema uint32 }`. The zero value is unlocked. |
| **Copy** | Any operation in Go that assigns a struct value to a new location: `b := a`, passing `a` to a function with a value parameter, returning `a` from a function, ranging by value, capturing by value in a closure. |
| **Pointer receiver** | `func (s *State) M()`. Calls on `s` operate on the original struct. Required for any type that contains a mutex or other non-copyable state. |
| **Value receiver** | `func (s State) M()`. Calls on `s` receive a *copy* of the struct. Combined with a mutex field this is a silent bug. |
| **`copylocks`** | A `go vet` analyser that reports any value containing a `sync.Locker` being copied. Built into the standard toolchain. |
| **`sync.Locker`** | An interface with `Lock()` and `Unlock()`. `*Mutex`, `*RWMutex`, and `*RWMutex.RLocker()` satisfy it. The interface is how `copylocks` detects "this struct contains a mutex." |
| **`noCopy`** | An unexported zero-size struct that implements `Lock()` and `Unlock()` as no-ops. Embedding it in your type makes `go vet` refuse to copy it. Used by `sync.WaitGroup`, `sync.Cond`, `strings.Builder`, and others. |
| **Sema** | The runtime semaphore handle inside `sync.Mutex`. Goroutines waiting for the lock are parked on this handle. Copying the mutex creates two unrelated wait queues. |
| **Data race** | Two goroutines accessing the same memory without ordering, at least one of them writing. Undefined behaviour in Go. Copying a mutex turns a previously race-free program back into a racy one. |
| **Embedding** | `type S struct { sync.Mutex; n int }`. The mutex becomes a part of `S` and `s.Lock()` works directly. Convenient but reinforces the rule that `S` must never be copied. |

---

## Core Concepts

### A mutex is a piece of state, not a label

Beginners sometimes imagine a mutex as a *name* — "the counter mutex," "the user-table mutex." If you think of it as a name, copying the value seems harmless: the name is the same. The reality is the opposite. A mutex is **a piece of state in RAM**: a 32-bit `state` word and a 32-bit `sema` handle. The runtime decides "is this mutex locked?" by inspecting that exact memory. Two copies of the mutex are two separate questions, with two separate answers.

```go
type Mutex struct {
    state int32
    sema  uint32
}
```

When goroutine A calls `Lock()` on mutex *X* and goroutine B calls `Lock()` on a *copy* of *X*, B does not see A's lock. B succeeds immediately. Both goroutines are inside the critical section at the same time.

### Struct assignment in Go always copies

There is no copy constructor in Go. The line `b := a` reads every byte of `a` and writes those bytes into a fresh location for `b`. If `a` is a struct, this includes every field — including a `sync.Mutex` field. The compiler does not know "this struct is not meant to be copied"; it just copies bytes. The only thing standing between you and a silent bug is `go vet`.

Operations that copy a struct (each one a potential bug if the struct contains a mutex):

1. **Assignment:** `b := a`
2. **Function parameters by value:** `func f(s State)` — `s` is a copy.
3. **Function returns by value:** `func newState() State` — caller receives a copy.
4. **Method receivers by value:** `func (s State) Inc()` — `s` is a copy.
5. **Closure capture by value:** `s := State{...}; go func(s State){ s.Inc() }(s)`.
6. **Range loop:** `for _, s := range states { s.Inc() }` — `s` is a copy of each element.
7. **Map and slice element read:** `s := m["key"]` — `s` is a copy; modifying `s` does not modify the map's stored value.
8. **Interface boxing:** `var i Stringer = s` — copies `s` into the interface.

All eight are routine Go idioms. None of them is a bug *unless* the struct contains a mutex (or another non-copyable type). That is what makes this anti-pattern so easy to introduce by reflex.

### The `copylocks` vet check

`go vet` ships with an analyser called `copylocks` that recognises any type implementing `sync.Locker` and warns when it is copied. It runs automatically before `go test` and is integrated into `gopls` (so VS Code, Goland, and Neovim flag it as you type).

Sample diagnostic:

```
./main.go:14:6: Inc passes lock by value: main.Counter contains sync.Mutex
```

This message means: somewhere in `Inc`, a value of type `Counter` is being passed or copied even though it contains a mutex. Take the warning seriously. It almost never has false positives in practice.

### The same rule applies to every primitive that contains a mutex

`sync.RWMutex`, `sync.WaitGroup`, `sync.Once`, and `sync.Cond` all carry mutable internal state. None of them is safe to copy. The standard library marks `WaitGroup` and `Cond` with the `noCopy` pattern (see below) so vet can catch them; `RWMutex` and `Once` are caught because they embed or compose a `Mutex`.

If a struct contains any of these types directly, the same rule cascades: the *outer* struct must not be copied either, and any function returning it by value or passing it by value triggers `copylocks`.

### The fix: use pointers

The rules below are universal and boring on purpose:

- **Method receivers:** use `*T`, not `T`, for any type that contains a mutex.
- **Function parameters:** pass `*T`, not `T`.
- **Struct fields:** embed `sync.Mutex` directly (not by pointer — that has its own problems), but make sure the *outer* struct is always passed as a pointer.
- **Construction:** factories return `*T`, not `T`. `func NewCounter() *Counter`, not `func NewCounter() Counter`.
- **Slices/maps of structs with mutexes:** use `[]*T` or `map[K]*T`, not `[]T` / `map[K]T`. Ranging over a slice copies elements; ranging over pointers does not.

### `noCopy` — opting in to copy detection without a real mutex

Sometimes a type has invariants that forbid copying even though it has no `sync.Mutex` field. Examples in the standard library: `strings.Builder` (its internal byte slice would alias), `sync.WaitGroup` (internal counter). To get `copylocks` to flag copies of such a type, embed the `noCopy` marker:

```go
type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}
```

The struct has zero size and zero runtime effect. It exists only so that `go vet` recognises the outer type as a `Locker` and refuses to copy it. This pattern is used by half a dozen types in the standard library and is the standard idiom in production code.

---

## Real-World Analogies

### A mutex is the *physical key* to a server-room door

Imagine your data is behind a locked door and the only key is on a hook in the corridor. Anyone who wants to enter must grab the key. Two people cannot hold the key simultaneously, so they take turns. Now imagine you *photocopy* the key — making a perfect-looking copy that does not actually fit the lock. You hand the copy to a colleague. He waves it at the door and walks in. The original key is still on its hook, but the door is open because nobody is checking. That photocopy is what `c := counter` does to a `sync.Mutex`.

### A traffic light split into two

A single intersection has one traffic light. North-south and east-west drivers all watch it. Now build a second, identical traffic light in a parallel universe and connect each universe to half of the cars. North-south sees red in universe A; east-west sees red in universe B. Both report "I had a red light"; they still crashed. The lights look the same, but they are not the same physical signal.

### Mutex copying is a "ghost in the machine" bug

The bug is invisible to the eye: the field is there, the lock and unlock are there, the program compiles. The runtime never panics. Tests pass on a single goroutine. The only way to feel something is wrong is to read the receiver type carefully or to run `go vet`. The bug is in the *plumbing*, not in the visible logic.

---

## Mental Models

### Model 1: "A mutex is identified by its address"

The runtime cares about *where* in memory a mutex lives. `m1.Lock()` and `m2.Lock()` are independent operations *unless* `&m1 == &m2`. Whenever you write code that involves a mutex, mentally annotate it with the address: am I locking the original mutex at `0x1234`, or a copy at `0x5678`? If you cannot answer that confidently, your mutex use is suspect.

### Model 2: "Mutex-bearing types are objects, not values"

Go is pleasantly value-oriented: integers, strings, slices, and small structs flow through your program as values. Mutex-bearing types break this. They are *objects* in the C++/Java sense — they have identity. Once you accept that, the rules follow:

- Construct them with `New...` factories that return pointers.
- Pass them as pointers.
- Store them as pointers in collections.

Any time you find yourself writing `[]Counter`, ask: "should this be `[]*Counter`?" The answer is almost always yes when `Counter` has a mutex.

### Model 3: "vet is your seat belt; engineering is the road"

`go vet` catches the obvious cases: returning by value, value receivers. It does not catch every case. In particular, vet cannot follow values through interfaces or `reflect`. The mental model is: vet is a safety net, not a guarantee. You must still *think* about every place your mutex-bearing value lives.

### Model 4: "Embedding is a contract"

If you embed `sync.Mutex` in your struct, you have made an irreversible promise: "instances of this type live at a fixed address." That means every function that touches them must take `*T`. Embedding is convenient — `s.Lock()` reads beautifully — but it tightens the rules. If you do not want that obligation, do not embed.

---

## Pros & Cons

There are no pros to copying a mutex. The whole section exists to convince you of one rule: do not do it. But there are pros and cons to the *fixes*.

### Pros of using pointer receivers and pointer fields

- **Correctness.** The mutex protects what you think it protects.
- **Cheap.** A pointer is 8 bytes. A `Counter` with a mutex is at least 24 bytes. Pointer passing is often faster.
- **Identity-preserving.** Modifications through the pointer are visible to all holders. With value receivers, mutations vanish.
- **Compatible with interfaces.** `*Counter` satisfies `interface { Inc() }`; `Counter` may or may not, depending on which methods you wrote.

### Cons of pointer receivers and fields

- **One more `*`.** Trivial cost.
- **Nil pointers possible.** A `*Counter(nil)` will panic when methods touch the mutex. Constructors guard against this: always `&Counter{}`, never `var c *Counter`.
- **Escape to heap.** A `*Counter` is more likely to be heap-allocated than a `Counter` local variable. Usually irrelevant. For tight inner loops where you have *measured* a difference, you might keep a value `Mutex` local — but only if you can prove nothing copies it.

### Pros of `noCopy` marker

- **vet catches more bugs.** Even types with no mutex field but with invariants that forbid copying are protected.
- **Self-documenting.** Readers see `noCopy` and immediately understand "do not copy this."

### Cons of `noCopy` marker

- **Convention-only.** It is a comment in code form; nothing at runtime enforces it.
- **Vet warnings can be silenced.** A developer can copy the type and pass the linter check with `//nolint:copylocks`. Education matters.

---

## Use Cases

When this anti-pattern matters most:

1. **Stateful in-process services.** Any singleton-ish struct that holds a mutex protecting a map or counter. Returning it by value from a constructor is a common new-developer mistake.
2. **HTTP handlers and middlewares.** A handler often holds dependencies behind a mutex. If the handler struct is copied per request, you lose mutual exclusion.
3. **Caches and stores.** `Cache`, `Store`, `Registry`, `Pool` — all the usual names hide a `sync.Mutex` and a `map[K]V`. They must be passed as `*Cache` everywhere.
4. **Test fixtures.** Test helpers that build a "fake" struct often start with a value type for convenience. The moment a mutex is added, the helper becomes a bug factory.
5. **Refactoring legacy code.** Adding a mutex to a previously single-threaded type is a high-risk operation. Every existing pass-by-value site is now suspect.

---

## Code Examples

### Example 1 — The classic: value receiver makes a copy

```go
package main

import (
    "fmt"
    "sync"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

// BAD — value receiver. Every call to Inc operates on a copy.
func (c Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func main() {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    fmt.Println("final n =", c.n) // 0, every time
}
```

Output: `final n = 0`. The increments happened on 1000 separate `Counter` values. None of them was the original. `go vet` reports:

```
./main.go:13:6: Inc passes lock by value: main.Counter contains sync.Mutex
```

Fix: change the receiver to `*Counter`.

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

### Example 2 — Returning a struct by value from a constructor

```go
type Store struct {
    mu   sync.Mutex
    data map[string]string
}

// BAD — returns by value.
func NewStore() Store {
    return Store{data: make(map[string]string)}
}

func main() {
    s := NewStore() // s is a copy of the returned value
    // any pointer-based identity of s is already broken if anyone else also called NewStore
    // and worse, if you copy s further, every copy has its own mutex over the same map.
}
```

The map is shared (slices and maps are reference types in Go), but the mutex is not. Two copies of `Store` will race against each other on the same map. Fix:

```go
func NewStore() *Store {
    return &Store{data: make(map[string]string)}
}
```

### Example 3 — Passing a struct by value to a function

```go
type Stats struct {
    mu    sync.Mutex
    count int
}

// BAD — s is a copy.
func record(s Stats, n int) {
    s.mu.Lock()
    s.count += n
    s.mu.Unlock()
}

func main() {
    var s Stats
    record(s, 5)
    fmt.Println(s.count) // 0
}
```

`go vet`:

```
./main.go:11:6: record passes lock by value: main.Stats contains sync.Mutex
```

Fix: `func record(s *Stats, n int)` and call `record(&s, 5)`.

### Example 4 — Closure capturing by value via parameter

```go
type Job struct {
    mu   sync.Mutex
    done bool
}

func main() {
    j := Job{}
    // BAD — `j` passed by value to the goroutine function.
    go func(j Job) {
        j.mu.Lock()
        j.done = true
        j.mu.Unlock()
    }(j)
}
```

Inside the goroutine, `j` is a copy. The outer `j.done` never becomes `true`. Vet output:

```
./main.go:10:11: func passes lock by value: main.Job contains sync.Mutex
```

Fix: pass `&j`, and the function should take `*Job`. Or capture `&j` by reference in the closure.

### Example 5 — Range over a slice of structs

```go
type Worker struct {
    mu sync.Mutex
    n  int
}

func main() {
    workers := []Worker{{}, {}, {}}
    for _, w := range workers { // BAD — w is a copy of each element
        w.mu.Lock()
        w.n++
        w.mu.Unlock()
    }
    fmt.Println(workers[0].n) // 0
}
```

`w` is a fresh local variable each iteration, carrying its own mutex. The slice elements are never touched. `go vet` reports `range var w copies lock`. Fix:

```go
workers := []*Worker{{}, {}, {}}
for _, w := range workers {
    w.mu.Lock()
    w.n++
    w.mu.Unlock()
}
```

Or index: `for i := range workers { workers[i].mu.Lock(); ... }` if you must keep `[]Worker`.

### Example 6 — Map element copy

```go
type Account struct {
    mu      sync.Mutex
    balance int
}

func main() {
    accounts := map[string]Account{}
    accounts["alice"] = Account{}

    // BAD — m["alice"] returns a copy.
    a := accounts["alice"]
    a.mu.Lock()
    a.balance += 100
    a.mu.Unlock()
    // accounts["alice"].balance is still 0
}
```

Map values cannot be addressed in Go: `&accounts["alice"]` is a compile error. The only safe ways to store mutex-bearing types in a map are `map[string]*Account` or to take the lock on a wrapper:

```go
accounts := map[string]*Account{}
accounts["alice"] = &Account{}

a := accounts["alice"] // pointer copy — same Account
a.mu.Lock()
a.balance += 100
a.mu.Unlock()
```

### Example 7 — Interface boxing copies

```go
type Locker interface {
    Lock()
    Unlock()
}

func use(l Locker) {
    l.Lock()
    defer l.Unlock()
}

func main() {
    var m sync.Mutex
    use(m) // BAD — passes m by value, vet flags it
}
```

`use(m)` boxes a copy of `m` into the interface. Inside `use`, `l.Lock()` locks the copy. Fix: `use(&m)`. `*sync.Mutex` satisfies `sync.Locker`; `sync.Mutex` (the value type) technically also does, but vet warns.

### Example 8 — Embedding looks fine, then someone copies

```go
type Resource struct {
    sync.Mutex // embedded
    data       []byte
}

func clone(r Resource) Resource { // BAD — copies the embedded mutex
    out := r
    out.data = append([]byte(nil), r.data...)
    return out
}
```

Embedding makes `r.Lock()` look graceful but the embedded mutex still cannot be copied. `go vet` flags `clone`. Fix: return `*Resource` or, if cloning is truly needed, construct a fresh `&Resource{data: ...}` rather than copying the original.

### Example 9 — Using `noCopy` to forbid copying a custom type

```go
package main

import "sync"

// noCopy is the standard marker. Zero size, zero runtime cost.
type noCopy struct{}

func (*noCopy) Lock()   {}
func (*noCopy) Unlock() {}

type Pipeline struct {
    _    noCopy
    once sync.Once
    out  chan int
}

func newPipeline() *Pipeline {
    return &Pipeline{out: make(chan int)}
}

// vet will now flag any function like:
//   func bad(p Pipeline) { ... }   // passes Pipeline by value
//   func makeBad() Pipeline { ... } // returns Pipeline by value
```

Even though `Pipeline` does not own a `sync.Mutex` directly, it has invariants (the `once` initialisation, the channel identity) that forbid copying. The `noCopy` marker enlists vet for protection.

### Example 10 — Real-world: an HTTP handler

```go
type Service struct {
    mu       sync.Mutex
    sessions map[string]*Session
}

// BAD — value receiver. Every request operates on a copy.
func (s Service) HandleLogin(w http.ResponseWriter, r *http.Request) {
    s.mu.Lock()
    defer s.mu.Unlock()
    // ... mutate s.sessions ...
}

func main() {
    svc := &Service{sessions: map[string]*Session{}}
    http.HandleFunc("/login", svc.HandleLogin)
    http.ListenAndServe(":8080", nil)
}
```

Two bugs hide in the value receiver:

1. The `sessions` map *is* shared (maps are reference types), but it is being mutated without the original mutex.
2. Worse, if any future field of `Service` is a non-reference type (int, string, struct), changes will vanish.

Fix: `func (s *Service) HandleLogin(...)`. Always.

---

## Coding Patterns

### Pattern: Constructor returns a pointer

```go
type Cache struct {
    mu   sync.Mutex
    data map[string][]byte
}

func NewCache() *Cache {
    return &Cache{data: make(map[string][]byte)}
}
```

Never `func NewCache() Cache`. The factory shape dictates how downstream code uses the type. Make pointers the default and developers will mostly stay safe.

### Pattern: Pointer receivers everywhere or nowhere

For a single type, do not mix value and pointer receivers. If any method takes `*T`, all of them should. Reasons:

- Consistency reduces cognitive load.
- Interface satisfaction differs: `*T` satisfies a method set with pointer receivers; `T` does not.
- A type whose mutex makes pointer receivers mandatory should not also expose value-receiver methods that copy the value silently.

### Pattern: Slice and map types use pointers

```go
type Worker struct {
    mu sync.Mutex
    n  int
}

var workers []*Worker            // not []Worker
var byID  map[int]*Worker        // not map[int]Worker
```

The cost is one extra allocation per element. The reward is that no range loop and no map lookup ever copies the mutex.

### Pattern: Wrap with a private struct and expose methods

A library can hide the mutex-bearing struct entirely behind a pointer-returning constructor and method API:

```go
type Counter struct {
    mu sync.Mutex
    n  int
}

func NewCounter() *Counter { return &Counter{} }

func (c *Counter) Inc()        { c.mu.Lock(); c.n++; c.mu.Unlock() }
func (c *Counter) Value() int  { c.mu.Lock(); defer c.mu.Unlock(); return c.n }
```

Users can never see a value `Counter`. They cannot accidentally copy it because they never hold one.

### Pattern: `noCopy` for invariant-bearing types without mutexes

If your type has a channel, a `WaitGroup`, a `sync.Once`, or a precomputed pointer that aliases something else, copying it is a bug even though no `sync.Mutex` is present. Embed `noCopy`:

```go
type Snapshot struct {
    _    noCopy
    rows []row
    src  *sql.Rows // aliases an in-progress iterator
}
```

---

## Clean Code

- **Name your factories `New...` and have them return `*T`.** Don't write `Make...` returning `T` for mutex-bearing types.
- **Place the mutex field first** in the struct, typically named `mu`. Convention helps readers spot the constraint instantly.
- **Comment the rule for unfamiliar readers**: `// Cache is not safe to copy; use *Cache.` One short comment per such type pays for itself.
- **If you embed, embed with intent.** `sync.Mutex` embedded gives readers a clear signal. Consider naming `mu sync.Mutex` instead when you want to discourage callers from calling `Lock` on the type itself.
- **Avoid stuttering names.** `Counter.CounterMu` is noise; `Counter.mu` is enough.

---

## Product Use / Feature

Concrete features where this anti-pattern is the difference between "works" and "silently breaks":

- **Rate limiter per user.** A struct with a token-bucket state and a mutex. If your rate limiter is built into a value-receiver method on a value-typed wrapper, every request gets its own clean bucket and your "limit" never engages.
- **In-memory cache.** A `Cache` struct returning by value from a factory leaves you with multiple caches, each with its own mutex and shared (but unsynchronised) underlying map.
- **Session store.** Each handler that copies the session store fragments the lock; concurrent logins corrupt the shared map.
- **Worker pool.** A `Pool` value being copied means each copy thinks it owns "the workers." Status counters go out of sync.

In every case the symptom is "intermittent failure under load." The cure is mechanical: vet, then pointer everything.

---

## Error Handling

This anti-pattern produces *silent* errors. No panic, no return value, no log line. The error handling here is about *detection*:

- Run `go vet ./...` in CI on every commit. Fail the build if it reports anything.
- Run `-race` tests in CI. The race detector exposes the consequences of a missing lock.
- Code review: reject any new struct containing a `sync.Mutex` field unless all methods take `*T` and any factory returns `*T`.
- If you must accept untrusted code paths (plugins, generated code), wrap mutex-bearing values in a `noCopy` marker so vet warns even when the user has forgotten the receiver rule.

The one panic that is loosely related: calling `Unlock` on a `Mutex` that is not locked panics with `sync: unlock of unlocked mutex`. This sometimes happens when a copy has been locked but the original is unlocked, or vice versa. The panic message points at the wrong line; the cause is upstream.

---

## Security Considerations

A copied mutex is functionally equivalent to no mutex. Anything you thought was synchronised becomes a data race. Concrete security risks:

- **Token-of-the-day bypass.** A rate limiter whose internal state is racy can be bypassed by parallel requests.
- **Session fixation.** A session store that loses updates can re-issue an attacker's session ID to a victim.
- **Authentication checks.** A check-then-act pattern protected by a copied mutex is no longer atomic. An attacker who can race two requests slips through.
- **Audit log corruption.** Log buffers protected by copied mutexes interleave events from different requests. A forensic trail becomes unreliable.

The fix is the same as the correctness fix. Defensive measure: vet in CI is *the* most cost-effective security control you will ever add for this class of bug.

---

## Performance Tips

The performance tip is the same as the correctness tip: do not copy mutexes. But while we are here:

- **Pointer passing is usually cheaper than value passing for structs above 32 bytes.** A `sync.Mutex` is 8 bytes; a struct with a mutex and a map is at least 16. A pointer is 8. Pointer passing also avoids stack-to-stack copies inside the called function.
- **Embedding `sync.Mutex`** does not cost more than a `mu sync.Mutex` field. Both have the same layout.
- **`noCopy` is zero-size**, embedded for free.
- The cost of `Lock`/`Unlock` is unrelated to copying. A bigger optimisation lever is reducing critical section duration, not avoiding the mutex object itself.

---

## Best Practices

1. **Pointer receivers for every method on a mutex-bearing type.**
2. **Constructors return `*T`.**
3. **Slices and maps store `*T`.**
4. **Embed `noCopy` in non-mutex types whose copying violates invariants.**
5. **Run `go vet` in CI and fail on findings.**
6. **Run `-race` tests in CI.**
7. **Document non-copyability with a single comment line.**
8. **Never use `reflect.ValueOf(m).Elem()` to copy a `sync.Mutex` — vet cannot see it.**
9. **Avoid passing mutex-bearing values through `interface{}` parameters that are later type-asserted to non-pointer types.**
10. **When in doubt, take the address.**

---

## Edge Cases & Pitfalls

### Pitfall 1 — Embedded mutex makes copies look harmless

```go
type Buffer struct {
    sync.Mutex
    data []byte
}

b1 := Buffer{}
b2 := b1 // vet warns; readers might miss it
```

Embedding promotes the mutex's methods to the outer type. `b1.Lock()` works. So does `b2.Lock()` — but on a different mutex. Embedding is convenient; it is also a magnet for this bug.

### Pitfall 2 — Generic functions

```go
func compute[T any](v T) T { return v }
var c Counter
c2 := compute(c) // vet may or may not flag depending on version
```

Older Go versions had blind spots in vet for generics. Always run vet on the latest Go release and prefer `*T` even in generic helpers.

### Pitfall 3 — Struct literal copy in tests

```go
want := Counter{n: 0}
got := Counter{n: 0}
if want != got { ... } // compile error; Counter contains a non-comparable Mutex? Actually no, Mutex is comparable.
```

In fact `sync.Mutex` is comparable in Go (it is a struct of integers). The `==` would compile. The dangerous case is more subtle: storing `want` in a struct slice for test cases and ranging over it. Use pointer slices or build the value once and never duplicate it.

### Pitfall 4 — Defer captures by value of the *call*, not the *receiver*

```go
func (c *Counter) bad() {
    defer (*c).Unlock() // captures dereference; unusual but legal
}
```

Most `defer mu.Unlock()` usages are fine, but creative dereferencing can move the unlock target. Stick to `defer c.mu.Unlock()` and you will never hit this.

### Pitfall 5 — JSON encoding copies the struct

Encoders and reflection-heavy libraries make copies of values they receive. Marshaling a `Counter` by value sends a copy through the encoder. If the encoder were to take a lock during inspection (it does not, in `encoding/json`), the copied mutex would be the wrong one. Most encoders take values; pass them pointers, and use struct tags to hide the mutex from serialisation.

```go
type Counter struct {
    mu sync.Mutex `json:"-"`
    N  int        `json:"n"`
}
```

---

## Common Mistakes

1. **Forgetting the asterisk.** `func (c Counter) Inc()` instead of `func (c *Counter) Inc()`.
2. **Returning a struct from `NewX` instead of a pointer.** Tradition from textbooks where mutexes do not appear.
3. **Storing in `[]T` instead of `[]*T`.** Then ranging by value.
4. **Copying inside a method on the unrelated type.** `dst := *src` where `src` is `*Counter` makes a copy.
5. **Lock-copy-unlock sequences.** Locking, copying out a snapshot, unlocking, *then* mutating the snapshot — usually fine because the snapshot has no live mutex, but **deeply embedded mutexes in the snapshot still must not be re-used**.
6. **Calling a value-receiver method on a pointer.** `c.Inc()` where `c` is `*Counter` and `Inc` has value receiver compiles fine: Go dereferences and copies. Vet will warn.
7. **Suppressing vet warnings.** `//nolint:copylocks` is almost always wrong.
8. **Returning by value from interface implementations.** `func (s Storage) Get() Snapshot` where `Snapshot` has a mutex.
9. **Generic containers that copy values.** A naive `func push[T any](s []T, v T) []T { return append(s, v) }` copies `v`.
10. **Building tests with `[]struct{ name string; counter Counter }`.** Range copies the test case, including the mutex.

---

## Common Misconceptions

- **"The race detector will catch it."** Sometimes. The race detector catches *concurrent unsynchronised access*. If the bug is that both goroutines lock their own copy and there is no other unsynchronised path, you will see no race report — but the writes are still going to lost storage because the writes occur on different memory locations.
- **"The compiler will warn me."** No. The compiler does not analyse type semantics this way. Only `go vet` does.
- **"It's fine because the field is the same map underneath."** No. Maps are reference types and *will* be shared between copies. But the mutex is not. Two copies racing on the same map have no protection.
- **"My code passes tests."** Single-threaded test code rarely surfaces the bug. Add a `-race` flag and load.
- **"I read everywhere that Go is value-oriented."** True for plain data. Mutex-bearing types are objects with identity. Treat them as such.

---

## Tricky Points

- A `Mutex` *is* comparable (`==`). Two zero-value mutexes are `==`. This does not make copying safe; it merely means the language does not forbid the comparison.
- `&someValue.mu` returns a pointer that *outlives* the value if you store it. If `someValue` is on the stack and goes out of scope, the pointer dangles. In Go this triggers escape analysis to heap-allocate `someValue`; the bug becomes invisible but real. Just store the *value* by pointer instead.
- `defer mu.Unlock()` reads `mu` *at defer time*. If you reassign `mu` between defer and the function return — unlikely but possible — the original mutex is unlocked. Not a common bug but worth noting.
- `sync.Once.Do(f)` is safe to call concurrently, but `once` itself cannot be copied. Returning a struct containing an `Once` by value would discard prior calls.
- `sync.WaitGroup` has the most pernicious copy bug: `Add` and `Done` operate on the local copy and the original `Wait` never returns. We will see this in `find-bug.md`.

---

## Test

A test that exposes a copied mutex:

```go
package counter_test

import (
    "sync"
    "testing"
)

type Counter struct {
    mu sync.Mutex
    n  int
}

// BAD — value receiver.
func (c Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}

func TestIncRace(t *testing.T) {
    var c Counter
    var wg sync.WaitGroup
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Inc()
        }()
    }
    wg.Wait()
    if c.n != 1000 {
        t.Fatalf("got %d, want 1000", c.n)
    }
}
```

Running `go test -race`:

```
got 0, want 1000
```

The race detector does *not* report a race because each `Inc` goroutine locks its own copy. Yet the assertion fails. This is the diagnostic to remember: **a wrong final value combined with no race report often means mutex copying.**

Vet output:

```
./counter_test.go:14:6: Inc passes lock by value: counter_test.Counter contains sync.Mutex
```

Fix: pointer receiver.

```go
func (c *Counter) Inc() {
    c.mu.Lock()
    c.n++
    c.mu.Unlock()
}
```

Re-run: `got 1000, want 1000`. Pass.

---

## Tricky Questions

**Q1.** A function returns a struct by value, and the struct contains a `sync.Mutex`. The function is only called once at startup. Is this still a bug?

A. Yes. The single returned value is one copy of the mutex. If the caller then passes that value to other code by value as well, you have many copies. The bug is the *type signature*, not the call count.

**Q2.** I use `*sync.Mutex` instead of `sync.Mutex` as a field. Does that fix everything?

A. It eliminates the most common copy bug — copying the outer struct now duplicates the pointer, so both copies point at the same mutex. But it introduces a nil-pointer risk: forgetting to initialise the pointer in your constructor leaves callers with a `nil` mutex that panics on `Lock`. The standard advice is: embed `sync.Mutex` *by value*, return `*T` from constructors, take `*T` everywhere.

**Q3.** Does vet's `copylocks` catch every case?

A. No. It cannot trace values through `reflect` or `unsafe.Pointer`. It can miss generics in older versions. It does not flag function calls through interface methods that erase the type. Treat vet as 90% effective, not 100%.

**Q4.** If `sync.Mutex` is comparable, why is copying it dangerous?

A. Comparability is about syntactic equality of the byte contents. Copying duplicates the bytes, including the bytes of `state` and `sema`. The runtime, however, looks at *addresses* to coordinate goroutines: each address has its own wait queue inside the runtime's semaphore table. Two equal byte patterns at two different addresses are two different mutexes.

**Q5.** I want a value type with read-only methods that does not need a mutex. Can I have value receivers?

A. Yes, if the type is genuinely immutable after construction and contains no mutex. The moment you add a `sync.Mutex` field, every method must take `*T`.

---

## Cheat Sheet

```
Type holds a mutex?               -> All receivers are *T.
Constructor for mutex-bearing T?  -> return *T.
Slice of mutex-bearing T?         -> []*T.
Map of mutex-bearing T?           -> map[K]*T.
Passing through a function?       -> param is *T.
Closure captures the value?       -> capture *T or take &.
Range over slice of values?       -> iterate by index, or store *T.
Need vet to flag a non-mutex type? -> embed noCopy.
Type assertions on interface?     -> assert *T, not T.
Tests storing the type?           -> hold *T in the test table.
```

Commands:

```
go vet ./...                # runs copylocks among others
go test -race ./...         # exposes consequences of mutex copying
staticcheck ./...           # additional analyser, often catches more
```

---

## Self-Assessment Checklist

- [ ] I can explain why a `sync.Mutex` cannot be copied even though it is comparable.
- [ ] I can list at least five Go syntactic operations that copy a struct value.
- [ ] I can interpret a `copylocks` vet diagnostic.
- [ ] I know that `sync.RWMutex`, `WaitGroup`, `Once`, `Cond` follow the same rule.
- [ ] I write constructors that return `*T`, not `T`.
- [ ] I write pointer receivers for every method on a mutex-bearing type.
- [ ] I use `[]*T` and `map[K]*T` for collections of mutex-bearing types.
- [ ] I have used or read about the `noCopy` marker pattern.
- [ ] I configure CI to run `go vet` and fail on findings.
- [ ] I can write a tiny program that reproduces the bug and verify vet detects it.

---

## Summary

A `sync.Mutex` is a piece of state in RAM. Copying it splits that state into two independent locks, each blind to the other. Every Go operation that "looks like a value" — assignment, function parameters, returns, range loops, map lookups, interface boxing — is a potential copy. The standard defence is mechanical: pointer receivers everywhere, factories return `*T`, collections store `*T`. The `noCopy` marker enlists `go vet` to enforce the rule even for types without a real mutex. The same prohibition applies to `RWMutex`, `WaitGroup`, `Once`, and `Cond`. Run `go vet` in CI and treat findings as errors.

---

## What You Can Build

- A linter for your team's coding standards that detects "factory returns value of mutex-bearing type" patterns.
- A teaching tool: write five programs, each one demonstrating a different copying mistake. Show vet output and a fixed version side by side.
- A migration helper that walks your codebase, finds value receivers on mutex-bearing types, and proposes patches.
- A debugging story for your blog: take a real-world bug from a postmortem (RWMutex copy in a cache layer) and walk through how it was diagnosed.

---

## Further Reading

- The Go source for `sync/mutex.go` — read the file once, top to bottom. It is short.
- The vet `copylocks` source: `go/src/cmd/vendor/golang.org/x/tools/go/analysis/passes/copylock`.
- "Effective Go" — the section on receivers.
- `sync.WaitGroup` documentation — note the explicit "must not be copied" line.
- Russ Cox's notes on Go memory model.
- The CodeReviewComments wiki page on receiver types.

---

## Related Topics

- `03-sync-package/01-mutexes/` — what mutexes do correctly.
- `03-sync-package/02-rwmutex/` — same rule, same bug pattern.
- `03-sync-package/03-waitgroup/` — `WaitGroup` is the type that bites hardest when copied.
- `15-concurrency-anti-patterns/01-unlimited-goroutines/` — another silent-bug class.
- `08-deadlock-livelock-starvation/` — what corrupted lock state can degenerate into.
- `13-testing-concurrent-code/` — using `-race` and vet in CI.

---

## Diagrams & Visual Aids

```
Original mutex                    Copied mutex
+----------------+                +----------------+
| state = 0      |                | state = 0      |
| sema  = 0      |                | sema  = 0      |
+----------------+                +----------------+
        ^                                  ^
        | goroutine A                      | goroutine B
        | Lock() -> state=1                | Lock() -> state=1
        |                                  |
        v                                  v
Both critical sections enter simultaneously.
```

```
Address space view

0x1000  Counter{mu: state=0, sema=0, n: 0}      <- c (original)
0x2000  Counter{mu: state=0, sema=0, n: 0}      <- copy 1 from c
0x3000  Counter{mu: state=0, sema=0, n: 0}      <- copy 2 from c

Three mutexes. None of them locks the other two.
```

```
Decision tree

Has the type a sync.Mutex field, or composes one?
    yes -> All methods take *T
           Factory returns *T
           Collections are []*T / map[K]*T
           Vet must pass
    no  -> Does copying violate any invariant?
           yes -> embed noCopy
           no  -> value semantics are fine
```
