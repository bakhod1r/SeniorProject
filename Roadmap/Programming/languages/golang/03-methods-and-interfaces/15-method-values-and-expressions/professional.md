# Method Values and Method Expressions — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [API Design with Method-Value Callbacks](#api-design-with-method-value-callbacks)
3. [Lifecycle Hooks via Method Values](#lifecycle-hooks-via-method-values)
4. [Plugin and Strategy Registries](#plugin-and-strategy-registries)
5. [Middleware Chains and Method Expressions](#middleware-chains-and-method-expressions)
6. [Versioning and the Public API](#versioning-and-the-public-api)
7. [Testing Strategies for Method-Value APIs](#testing-strategies-for-method-value-apis)
8. [Production Pitfalls and Memory Leaks](#production-pitfalls-and-memory-leaks)
9. [Code-Review Checklist](#code-review-checklist)
10. [Tooling and Linters](#tooling-and-linters)
11. [Real-World Stack-Library Audit](#real-world-stack-library-audit)
12. [Migration Stories](#migration-stories)
13. [Summary](#summary)

---

## Introduction

At the professional level, method values and method expressions stop being syntactic sugar and become **API design choices**. Every place a library accepts a callback or builds a dispatch table is a place where these forms shape:

- The user's mental model ("I just pass `service.Handle`")
- The lifetime of objects (callbacks pin receivers in memory)
- Test ergonomics (hard to mock a method value vs a function value)
- Backwards compatibility (changing receiver types is breaking)

This file covers production-grade usage with concrete code, conventions, and the lessons the standard library has already learned.

---

## API Design with Method-Value Callbacks

### Convention 1 — Accept `func(...)`, not interfaces, for one-shot callbacks

`net/http`, `sort`, `sync.Once`, and `flag` all do this. A `func(...)` parameter is dual-purpose: callers can pass either a closure or a method value, with the same syntax. An interface forces a type definition.

```go
// Idiomatic
func RegisterHandler(name string, fn func(Event)) { /* ... */ }

// Caller picks:
RegisterHandler("login", svc.HandleLogin)             // method value
RegisterHandler("login", func(e Event) { /* ... */ }) // closure
```

If you accept an interface, callers cannot pass a method value alone — they must define a wrapper type with the right method.

### Convention 2 — Document the receiver lifetime

If your API stores the callback in a registry, the receiver becomes pinned in memory:

```go
// Subscribe registers fn to be called on every event.
// fn is held until the returned token is canceled.
//
// If fn is a method value bound to a heavy object, that object will be
// retained until cancellation.
func (b *Bus) Subscribe(fn func(Event)) Token { /* ... */ }
```

This single sentence will save users many "why is my service not garbage-collected?" investigations.

### Convention 3 — Provide both bound and unbound entry points where it matters

```go
// Convenience for "this object's handler"
func (s *Server) Handler() http.HandlerFunc { return s.serve }

// Free-standing reusable form
func ServeWith(s *Server, w http.ResponseWriter, r *http.Request) {
    s.serve(w, r)
}
```

The first returns a method value; the second is essentially a method expression in disguise.

---

## Lifecycle Hooks via Method Values

A common production pattern is wiring lifecycle methods (Init, Start, Stop, Close) into a generic supervisor:

```go
type Lifecycle struct {
    Name  string
    Start func(context.Context) error
    Stop  func(context.Context) error
}

type Supervisor struct{ items []Lifecycle }

func (s *Supervisor) Add(l Lifecycle) { s.items = append(s.items, l) }

func (s *Supervisor) Run(ctx context.Context) error {
    for _, it := range s.items {
        if err := it.Start(ctx); err != nil {
            return fmt.Errorf("%s: start: %w", it.Name, err)
        }
    }
    <-ctx.Done()
    // Reverse order shutdown.
    for i := len(s.items) - 1; i >= 0; i-- {
        _ = s.items[i].Stop(context.Background())
    }
    return nil
}
```

User registration:

```go
sup.Add(Lifecycle{
    Name:  "db",
    Start: db.Connect,    // method values
    Stop:  db.Close,
})
sup.Add(Lifecycle{
    Name:  "http",
    Start: srv.ListenAndServe,
    Stop:  srv.Shutdown,
})
```

This is one of the cleanest applications of method values: dependency-injected behavior, no interfaces required, easy to mock (just supply a different `func`).

### Why method values, not method expressions, here

Each entry has a *specific* db, server, etc. The receiver is fixed at registration time. This is exactly the bound-callback case.

### Why interfaces would be worse

```go
type StartStopper interface { Start(ctx) error; Stop(ctx) error }
sup.Add(db)        // forces db to satisfy this exact shape
```

Multiple methods, naming collisions, lifecycle ordering — all work better with `func` fields. The `Lifecycle` struct can also evolve without breaking implementations.

---

## Plugin and Strategy Registries

The strategy pattern in Go is usually *one map of method expressions*:

```go
type cmdContext struct {
    user  *User
    state *State
}

type Command func(*cmdContext, []string) error

var commands = map[string]Command{
    "set":     (*cmdContext).cmdSet,
    "get":     (*cmdContext).cmdGet,
    "delete":  (*cmdContext).cmdDelete,
    "exit":    (*cmdContext).cmdExit,
}

func (c *cmdContext) Execute(line string) error {
    name, args := parse(line)
    if cmd, ok := commands[name]; ok {
        return cmd(c, args)
    }
    return ErrUnknownCommand
}
```

Notes for production:

- Keep `commands` package-private and built at init time.
- Each method receives the receiver explicitly (no closure allocation).
- Adding a new command is a one-line entry plus a method definition.
- This pattern outperforms a giant `switch` only at very high command counts; choose for clarity.

### Plugin variant — runtime registration

```go
type Plugin interface {
    Name() string
    Register(*Registry)
}

type Registry struct{ commands map[string]Command }

func (r *Registry) On(name string, cmd Command) { r.commands[name] = cmd }
```

Plugin authors then register method expressions:

```go
func (p *AuthPlugin) Register(r *Registry) {
    r.On("login",  (*AuthPlugin).Login)
    r.On("logout", (*AuthPlugin).Logout)
}
```

But here the receiver isn't supplied at the lookup point. If you need a per-plugin instance, use method values instead:

```go
func (p *AuthPlugin) Register(r *Registry) {
    r.On("login",  p.Login)    // method values — receiver bound to this plugin instance
    r.On("logout", p.Logout)
}

type Command func([]string) error
```

The choice is: **expression** for stateless or context-supplied; **value** for instance-bound.

---

## Middleware Chains and Method Expressions

Standard `net/http` middleware:

```go
type Middleware func(http.Handler) http.Handler

func Chain(h http.Handler, mws ...Middleware) http.Handler {
    for i := len(mws) - 1; i >= 0; i-- {
        h = mws[i](h)
    }
    return h
}
```

A common production pattern wraps a handler **method**:

```go
type API struct{ /* deps */ }
func (a *API) ServeUser(w http.ResponseWriter, r *http.Request) { /* ... */ }

a := &API{}
h := Chain(http.HandlerFunc(a.ServeUser),  // method value adapted to HandlerFunc
    Logging,
    RateLimit,
    Auth,
)
```

`http.HandlerFunc(a.ServeUser)` does an implicit conversion: a method value of type `func(w, r)` becomes a `HandlerFunc` (which has a `ServeHTTP` method satisfying `http.Handler`).

This is one of Go's "everything just lines up" moments — but only because method values are first-class function values.

---

## Versioning and the Public API

### Adding a method — non-breaking

A new method on a public type is additive — existing method values and expressions continue to compile.

### Renaming a method — breaking

If users have `t.M` saved as a method value, renaming `M` breaks them. Provide a deprecated alias:

```go
// Deprecated: use NewName instead.
func (t T) OldName() { t.NewName() }
```

### Changing receiver type (value→pointer or vice versa) — breaking

`Type.Method` form changes type:

```go
// Before
func (t T) M()  // method expression: func(T)

// After
func (t *T) M() // method expression: func(*T)
```

User code with `T.M` no longer compiles. This is one of the **silent** breakages — even if you didn't intend method expressions to be a public surface, they are.

### Changing argument list — breaking, obviously

The method value/expression type changes; user code breaks at compile time.

### Best practice

If you publish a callback-style API:
- Stabilize the function signature first (`type EventHandler func(Event) error`).
- Internally adapt your method to that type (often via method value conversion at registration).
- Then your method's exact signature is free to evolve as long as the adapted function value still fits.

---

## Testing Strategies for Method-Value APIs

### Test 1 — Direct call

The cheapest. Just call the method.

```go
func TestServeUser(t *testing.T) {
    api := &API{}
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/", nil)
    api.ServeUser(rec, req)
    // assertions
}
```

### Test 2 — Through the registered method value

If a router or registry is involved, exercise the registration path:

```go
func TestRouter(t *testing.T) {
    api := &API{}
    mux := http.NewServeMux()
    mux.HandleFunc("/u", api.ServeUser)
    rec := httptest.NewRecorder()
    req := httptest.NewRequest("GET", "/u", nil)
    mux.ServeHTTP(rec, req)
    // assertions
}
```

### Test 3 — Mock the dependency, not the method value

```go
type fakeRepo struct{ users map[string]*User }
func (f *fakeRepo) Find(id string) (*User, error) { return f.users[id], nil }

api := &API{repo: &fakeRepo{users: ...}}
api.ServeUser(rec, req)   // method value flows through automatically
```

The method value form is **compatible** with mocking via interfaces — that's its strength.

### What you cannot easily do

You cannot replace a method value at runtime once registered. Do not design APIs that require swapping a callback's receiver after registration. Provide a `Resubscribe` API instead.

---

## Production Pitfalls and Memory Leaks

### Pitfall 1 — Forever-pinned receivers

```go
func init() {
    bus.On("evt", svc.Handle)   // svc lives forever
}
```

If `bus` is global and never cleaned, the receiver `svc` (and everything it holds — DBs, channels, large caches) is held forever. In long-running servers this is a slow leak.

Provide a cancellation token:

```go
token := bus.On("evt", svc.Handle)
defer token.Cancel()
```

### Pitfall 2 — Unbounded callback growth

Each `bus.On(...)` adds one closure. If the producer of `On` calls is buggy (e.g., re-registers on every reconnect), you get unbounded list growth.

```go
// Defensive
func (b *Bus) On(event string, fn func(Event)) Token {
    if len(b.subs[event]) > maxSubsPerEvent {
        log.Warn("too many subs", "event", event, "count", len(b.subs[event]))
    }
    // ...
}
```

### Pitfall 3 — Goroutine + method value capture

Older Go versions:

```go
for _, w := range workers {
    go func() { w.Run() }()       // captures shared loop var — bug
}
```

Method-value form sidesteps it:

```go
for _, w := range workers {
    go w.Run()                    // each w.Run captures the current w right here
}
```

### Pitfall 4 — Stale receiver in a long-lived registry

```go
type Cache struct{ /* large */ }
func (c *Cache) Lookup(k string) any { ... }

c := makeCache()
registry["lookup"] = c.Lookup    // captures c
c = makeCache()                   // local variable rebound, but registry still holds the old one
```

Easy to miss in code review. The registry holds the original `c`, not the new one. Be explicit when "rebinding" is intended.

### Pitfall 5 — Profiling shows allocations from "main.func.Handler"

Anonymous-looking closure names in pprof output are often method values. The compiler names them `<pkg>.<Type>.<Method>-fm` (the "function method" suffix). If your hot path shows lots of these, look for method-value creations in loops.

---

## Code-Review Checklist

- [ ] Is the method value/expression form chosen deliberately, not by accident?
- [ ] Is the receiver's lifetime understood (when does it become collectible)?
- [ ] If it's a goroutine entry point — does the receiver have what it needs?
- [ ] Is the receiver mutable, and is that intentional?
- [ ] Does the registry support cancellation/unsubscription?
- [ ] In hot paths, would a direct call or method expression be cheaper?
- [ ] Does the public API hide its method-value form behind a typed `func` or `interface` so it can evolve?
- [ ] Are method expressions used to feed dispatch tables that require zero allocations?
- [ ] Does test coverage exercise the registration path, not only the method directly?
- [ ] Does deprecation path keep old method names available as aliases?

---

## Tooling and Linters

### `go vet`

`vet` warns on `passes lock by value` — applicable to method values too: a value-receiver method on a sync-bearing struct, captured into a method value, will copy the mutex.

### `staticcheck`

- `SA4006` — unused variable; will flag a method value created and not used.
- `SA1029` — context not as first arg; hits methods used as context-bearing callbacks.

### `revive`

- `unused-receiver` — the receiver isn't used inside a method that's being captured as a method value. Fine sometimes, suspicious other times.

### `gocritic`

- `paramTypeCombine` — irrelevant here, but `methodExprCall` warns on questionable method-expression usage (e.g., `(*T).M(x)` where `x.M()` would be clearer).

### `go build -gcflags='-m'`

Manual run; shows escape decisions. Method values that don't need to escape ought to stay on the stack — if `-m` says they leak, investigate.

### `go test -benchmem`

Shows allocations per op. Method-value creations in hot paths show up as 1+ allocs per iteration.

---

## Real-World Stack-Library Audit

A short tour of where these forms appear in the standard library:

| Library | Form | Purpose |
|---------|------|---------|
| `net/http` | method value | `mux.HandleFunc(path, api.Handler)` |
| `sort` | method value | `sort.Slice(s, s.Less)` (often) |
| `sync.Once` | method value | `once.Do(svc.init)` |
| `flag` | method value | `flag.Func(name, usage, parser.Set)` |
| `runtime/pprof` | method value | profile labels and callbacks |
| `database/sql` | method value via `Driver` | each driver registers via package init |
| `context.AfterFunc` (Go 1.21+) | method value | hook callbacks for context cancellation |
| `text/template` | method expression | template function maps; receiver-less by convention |

Notice: bound (method value) dominates because most callbacks are tied to a concrete object. Unbound (method expression) appears mostly inside dispatch tables built once and reused.

---

## Migration Stories

### Story 1 — `http.Handler` interface to `http.HandlerFunc`

Many Go codebases used to define a custom `Handler` interface and wrap concrete implementations:

```go
type oldHandler interface { Serve(w, r) }
```

Migrating to `http.HandlerFunc` (a function type):

```go
mux.Handle("/x", http.HandlerFunc(api.Serve))   // method value
```

Smaller surface, more flexible callers. Method values made the migration trivial.

### Story 2 — Deprecating an old method by routing to a new one

```go
// Deprecated: use NewName.
func (t *T) OldName() { t.NewName() }
```

Method values created against `t.OldName` continue to work — they call into the new method. No registry change needed.

### Story 3 — Splitting a god-method into smaller ones

```go
// Old single registration
bus.On("evt", svc.HandleAll)

// New: one method per sub-event
bus.On("evt.created", svc.HandleCreated)
bus.On("evt.updated", svc.HandleUpdated)
bus.On("evt.deleted", svc.HandleDeleted)
```

Each new registration is a fresh method value; the old method value can be deprecated by leaving `HandleAll` to call into the right sub-method or removed entirely.

---

## Summary

For production Go:

1. **Method values** are the idiomatic shape for object-bound callbacks. They make `func(...)` parameters work seamlessly with object behavior.
2. **Method expressions** are the idiomatic shape for static dispatch tables and zero-allocation plumbing.
3. **Public APIs** should accept `func(...)` types, not interfaces, when one method suffices — this lets users pass either method values or closures.
4. **Lifecycle hooks**, **plugin registries**, **strategy maps**, and **middleware chains** are the four big production patterns.
5. **Receiver lifetime** is the single most important runtime concern: a registered method value pins its receiver. Document this, and provide cancellation.
6. **Versioning**: changing the receiver type or argument list of a method that's used as a method value/expression is breaking — be explicit about it.
7. **Tooling**: `vet`, `staticcheck`, and `-gcflags='-m'` catch most issues; profile output shows `-fm` suffixes for method-value closures.

The two forms are deceptively simple, but their effects on lifetime, memory, and API stability are exactly what a senior or principal engineer is paid to think about. Treat them as first-class architectural primitives, not as a syntax curiosity.
