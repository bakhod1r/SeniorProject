# Registry — Find the Bug

## 1. How to use this file

Fifteen buggy snippets of Registry-pattern code: blank imports, init-time registration, `sync.RWMutex`-guarded maps, plugin loading, and lifecycle. Read each in 30-60 seconds, decide where the defect is, then expand `<details>` for the answer. Every bug here has been seen in real Go production code.

Registry bugs almost never crash on the happy path. They silently overwrite a previously-registered driver, race during `init()` because someone fired a `go func()`, key on the wrong type so `Get` always returns `nil`, or leak fixture state between tests. The skill is asking three questions on every snippet:

1. *When does `Register` run, and is `Get` guaranteed to see the result?*
2. *Who owns the map, and how is concurrent mutation handled?*
3. *What happens on duplicate keys, missing keys, or nil values?*

If a snippet can't answer all three, there's a bug.

---

## Bug 1 — Missing blank import: `Get` returns nil

```go
// package main
package main

import (
    "database/sql"
    "log"
    // "github.com/lib/pq"   <- author forgot the blank import
)

func main() {
    db, err := sql.Open("postgres", "host=localhost user=app")
    if err != nil {
        log.Fatal(err)
    }
    if err := db.Ping(); err != nil {
        log.Fatal(err)        // "sql: unknown driver \"postgres\" (forgotten import?)"
    }
}
```

<details><summary>Answer</summary>

**Bug:** Driver registries are populated by `init()` functions inside the driver package. Without `import _ "github.com/lib/pq"`, the driver's `init()` never runs and `sql.Register("postgres", ...)` is never called. `sql.Open("postgres", ...)` succeeds (it just stores the DSN), but the first real call returns `sql: unknown driver "postgres" (forgotten import?)`.

**Why subtle:** `sql.Open` is deferred — it doesn't validate the driver name. The error appears at first usage, far from where the import is missing.

**Spot:** Any `sql.Open`, `image.Decode`, or other registry lookup that fails with "unknown" / "no driver" / "no decoder". Grep for `import _ "..."` in the binary's main file; if absent, the registry is empty.

**Fix:** Add the blank import to a file in the binary's import graph (`main.go` is safest). A *library* package should not blank-import a driver; that forces a choice onto its users.

**Why common:** `go fmt` and `goimports` happily delete unused imports. A blank import looks unused — only humans know it's needed for side effects.
</details>

---

## Bug 2 — Duplicate registration silently overwrites

```go
package codec

var codecs = map[string]Codec{}

func Register(name string, c Codec) {
    codecs[name] = c            // BUG: overwrites without complaint
}

// driverA/init.go
func init() { codec.Register("json", &v1JSONCodec{}) }

// driverB/init.go (added later, different team)
func init() { codec.Register("json", &v2JSONCodec{}) }
```

<details><summary>Answer</summary>

**Bug:** `Register` overwrites whichever entry already exists. Which `init()` runs last decides which `Codec` wins, and `init()` order across sibling imports is "the order they appear in the import list" — a brittle invariant. Worst case: both versions handle "json" but with different schemas. Marshal works; unmarshal silently parses against the wrong shape.

**Why subtle:** Tests pass. The error surfaces as "schema mismatch" in the data — not at the registry.

**Spot:** Any `Register` whose body is a bare `m[name] = v` without a duplicate check.

**Fix:** Panic on duplicate registration, matching `database/sql`:

```go
func Register(name string, c Codec) {
    if _, dup := codecs[name]; dup {
        panic("codec: Register called twice for " + name)
    }
    codecs[name] = c
}
```

If two implementations genuinely need to coexist, give them different names ("json-v1", "json-v2"). Silent overwrite is never the right behavior for a registry whose keys are *user-facing identifiers*.

**Why common:** Map assignment is the most natural Go expression. "Just put it in the map" is what the code does. Failure-loud guards feel paranoid until you've debugged the silent-overwrite bug once.
</details>

---

## Bug 3 — Mutating the registry from a goroutine without lock

```go
package store

var stores = map[string]Store{}      // no mutex

func Register(name string, s Store) {
    stores[name] = s
}

func init() {
    go func() {
        cfg := loadConfigSlow()       // 200ms file read + parse
        Register("default", newFromConfig(cfg))
    }()
}

// elsewhere:
func Get(name string) Store { return stores[name] }
```

<details><summary>Answer</summary>

**Bug:** Concurrent map access without a lock is undefined behaviour in Go — `go test -race` reports a data race, and under stress the runtime fatals with `concurrent map writes`. Even with one writer, a reader on another goroutine racing the write is still a race.

**Why subtle:** "Only one goroutine writes" feels safe; Go's memory model doesn't grant that. The race is schedule-dependent — fine on cold start, crashes under load.

**Spot:** Any `var m = map[...]...{}` accessed from a goroutine, especially from `init()`'s `go func() { ... }()`.

**Fix:** Wrap with `sync.RWMutex` and don't register from a background goroutine. If the work is slow, register a stub that lazy-loads on first `Get`, or block `init()` until done.

**Why common:** `init()` "wants to be fast", so someone spawns a goroutine to push slow work out of startup. They forget that `Register` is then no longer happening before `main()`.
</details>

---

## Bug 4 — `init()` that registers from `go func()` (races vs `main`)

```go
package metrics

func init() {
    go func() {
        cs := buildAllCollectors()        // takes ~50ms
        for name, c := range cs {
            prometheus.MustRegister(c)
            registered[name] = c
        }
    }()
}

// main.go
func main() {
    h := prometheus.Handler()
    http.ListenAndServe(":9090", h)        // may serve /metrics before init goroutine finishes
}
```

<details><summary>Answer</summary>

**Bug:** `init()` spawns a goroutine and returns immediately. Go considers `init()` "done" the moment the function returns — the goroutine is *not* awaited. `main()` runs and a scrape that arrives before the goroutine finishes sees zero collectors. If two goroutines hit `MustRegister` concurrently for the same name, you get a duplicate-register panic at random.

**Why subtle:** The system "warms up" — after the first 100ms everything works. CI is fast enough to miss it.

**Spot:** Any `init()` whose body is `go func() { ... }()` and whose effect is supposed to be observable by `main()`.

**Fix:** Register synchronously inside `init()`. If it's truly too slow, make it lazy — wrap `buildAllCollectors` in a `sync.Once` triggered on first `Get`.

**Why common:** `init()` feels like a constructor — fire-and-forget. The Go runtime's contract is the opposite: `init()` is the one place where synchronous matters.
</details>

---

## Bug 5 — Registry keyed by `reflect.Type` but consumer passes pointer

```go
package events

var handlers = map[reflect.Type]Handler{}

func Register(payload any, h Handler) {
    handlers[reflect.TypeOf(payload)] = h
}

// init:
events.Register(UserCreated{}, handleUserCreated)

// consumer:
func Dispatch(ev any) error {
    h, ok := handlers[reflect.TypeOf(ev)]
    if !ok { return fmt.Errorf("no handler for %T", ev) }
    return h(ev)
}

// caller:
events.Dispatch(&UserCreated{ID: "u1"})       // returns "no handler for *events.UserCreated"
```

<details><summary>Answer</summary>

**Bug:** `reflect.TypeOf(UserCreated{})` and `reflect.TypeOf(&UserCreated{})` are *different* types — `events.UserCreated` vs `*events.UserCreated`. Register uses the value type; dispatch uses the pointer type. The lookup misses every time.

**Why subtle:** "no handler for *events.UserCreated" reads like a forgotten registration, not a key-type mismatch. The fix-by-instinct is to register *both* — doubling the surface area instead of fixing the contract.

**Spot:** Any `reflect.TypeOf` key used as a map index, where producer and consumer don't have a documented convention about value vs pointer.

**Fix:** Pick one form and enforce it. Most event-bus libraries normalise to the *value* type by dereferencing pointers:

```go
func keyOf(v any) reflect.Type {
    t := reflect.TypeOf(v)
    if t.Kind() == reflect.Pointer { t = t.Elem() }
    return t
}
```

Even better: use a string discriminator (`"user.created"`) and serialize-friendly names. `reflect.Type` keys break the moment you split the type across packages, rename it, or marshal it.

**Why common:** "Use the type as the key" feels like the strongly-typed answer. It's strong but brittle. The pointer-vs-value asymmetry is the most common trap; `reflect.Type` keys carry several others (generic types, anonymous structs, interface-vs-concrete).
</details>

---

## Bug 6 — Storing concrete type instead of interface

```go
package codec

type JSONCodec struct{ /* ... */ }
type GobCodec  struct{ /* ... */ }

var codecs = map[string]*JSONCodec{}     // BUG: concrete type, not interface

func Register(name string, c *JSONCodec) {
    codecs[name] = c
}

func Get(name string) *JSONCodec { return codecs[name] }
```

<details><summary>Answer</summary>

**Bug:** The registry stores `*JSONCodec` — a single concrete type. Adding a `GobCodec` later requires touching every call site, or introducing a parallel registry, or wrapping `GobCodec` to look like `JSONCodec`. The registry's whole point — "plug in implementations by name" — is defeated by coupling to the concrete type at definition time.

**Why subtle:** It compiles, runs, and works fine for one implementation. The bug appears the moment you add a second codec and discover you can't, without rewriting the registry signature.

**Spot:** Any registry whose map value is a `*ConcreteStruct` rather than an interface. Same for function-pointer registries that hard-code one function signature where they should accept a small interface.

**Fix:** Define a small interface that captures only what consumers use, store that:

```go
type Codec interface {
    Encode(any) ([]byte, error)
    Decode([]byte) (any, error)
}
var codecs = map[string]Codec{}
func Register(name string, c Codec) { codecs[name] = c }
```

Now `JSONCodec`, `GobCodec`, and any future `MsgpackCodec` slot in identically. The interface is on the *consumer* side, not the producer side — keep it small (one or two methods).

**Why common:** First-pass code uses the only concrete type that exists. The registry pattern is *about* admitting new implementations — but the migration from "one impl" to "an interface" rarely happens proactively; it happens under pressure when implementation #2 arrives.
</details>

---

## Bug 7 — Returning the registry map directly

```go
package plugins

var registered = map[string]Plugin{}

func All() map[string]Plugin {
    return registered            // BUG: caller can mutate
}

// caller:
ps := plugins.All()
delete(ps, "auth")               // breaks every future lookup
ps["spy"] = &spyPlugin{}         // also writes into the package-level map
```

<details><summary>Answer</summary>

**Bug:** Returning the map hands the caller a reference to the package-level state. The caller can `delete`, mutate, or add entries — they mutate the registry itself. Even read-only callers iterating without a lock race against `Register`.

**Why subtle:** Most callers behave well. The damage comes from one `for k := range plugins.All() { ... delete(...) }` or a test that "cleans up" the returned map. The crash shows up far from the mutation.

**Spot:** Any accessor like `All()`, `List()`, `Map()` returning a package-scope map or slice without copying.

**Fix:** Return a copy, or return a read-only iterator. For a registry, a `[]string` of names is usually all the caller actually needs:

```go
func Names() []string {
    mu.RLock(); defer mu.RUnlock()
    out := make([]string, 0, len(registered))
    for n := range registered { out = append(out, n) }
    sort.Strings(out)
    return out
}
```

If you really need a map, return `maps.Clone(registered)` (Go 1.21+) under the read lock.

**Why common:** "Just expose the map" is the shortest implementation. The cost — losing encapsulation — isn't paid by the author, it's paid by whoever debugs the mysterious mutation six months later.
</details>

---

## Bug 8 — `nil`-check missing in `Register`; nil impl crashes `Get` later

```go
package codec

var codecs = map[string]Codec{}

func Register(name string, c Codec) {
    codecs[name] = c                  // BUG: c can be nil
}

// somewhere far away:
codec.Register("none", nil)            // probably from a config-driven loader

// later:
c, _ := codec.Get("none")
buf, err := c.Encode(payload)         // nil pointer dereference
```

<details><summary>Answer</summary>

**Bug:** `Register` accepts `nil`. The map stores it. `Get` returns the nil interface; the caller dereferences it and panics with `nil pointer dereference`. The stack points at `Encode`, not at the bogus `Register` that planted the nil.

**Why subtle:** The bad input usually comes from a factory that returned `nil, nil` on an error path. The distance from the bad `Register` to the eventual crash makes diagnosis painful.

**Spot:** Any `Register` that checks only `if name == ""` (or nothing) — it almost certainly forgot to check the value.

**Fix:** Reject `nil` at registration time with a panic; the registration site is by definition `init()` or early `main()`, so a panic surfaces immediately and clearly:

```go
func Register(name string, c Codec) {
    if c == nil {
        panic("codec: Register nil codec for " + name)
    }
    // ... rest as before
}
```

This mirrors `sql.Register`, `prometheus.MustRegister`, and `image.RegisterFormat`. Fail loud on the producer side.

**Why common:** "Defensive checks slow things down" / "the caller knows what they're doing". Registration is a one-shot startup path — the cost of one nil-check is zero compared to the cost of a NPE in production hours later.
</details>

---

## Bug 9 — Import cycle from registry importing its consumers

```go
// package registry
package registry

import (
    "myapp/drivers/postgres"           // BUG
    "myapp/drivers/mysql"
)

func init() {
    Register("postgres", postgres.New())
    Register("mysql", mysql.New())
}

// package drivers/postgres
package postgres

import "myapp/registry"                // and the consumer imports registry too
```

<details><summary>Answer</summary>

**Bug:** The registry imports the drivers; the drivers import the registry. Go does not allow import cycles — the build fails with `import cycle not allowed`. The instinct to "wire everything up centrally" is what causes it.

**Why subtle:** Beginners read the error path as "Go is broken" rather than "your dependency direction is backwards".

**Spot:** Any package whose imports contain packages that themselves import it. `go list -f '{{join .Imports "\n"}}' ./registry` is the manual check; in practice the build error catches it.

**Fix:** Invert the dependency. The registry package defines the interface and `Register`. Each driver package imports the *registry* (one direction) and calls `Register` in its own `init()`. The main binary then blank-imports each driver:

```go
// main.go
import (
    _ "myapp/drivers/postgres"
    _ "myapp/drivers/mysql"
)
```

The registry knows nothing about drivers; drivers know about the registry; the binary knows about both. One-direction-only.

**Why common:** "Central wiring" feels organised. It's the same instinct that produces god-objects in OOP. The blank-import idiom is the Go-shaped answer: each module wires itself in, and the binary picks which modules to include.
</details>

---

## Bug 10 — Lookup result not nil-checked: panic on `Get` of unknown name

```go
package handlers

func Dispatch(name string, req Request) Response {
    h := registry.Get(name)            // returns Handler (interface), nil if missing
    return h.Handle(req)               // BUG: nil deref if name unknown
}
```

<details><summary>Answer</summary>

**Bug:** `Get` returns the `Handler` interface, `nil` for unknown names. The caller dereferences with `h.Handle(req)` and panics. The stack points at `Handle`, not at the missing registration.

**Why subtle:** Tests only use names that exist. The panic fires on a typo, external input, or a stale config name — cases tests don't cover.

**Spot:** Any `x := reg.Get(name); x.Method(...)` without a nil-check or a `, ok` second return.

**Fix:** Return `(Handler, bool)` from `Get` so the caller has to acknowledge the missing case, the same way map indexing forces an `ok`:

```go
func Get(name string) (Handler, bool) {
    mu.RLock(); defer mu.RUnlock()
    h, ok := registered[name]; return h, ok
}

func Dispatch(name string, req Request) (Response, error) {
    h, ok := registry.Get(name)
    if !ok { return Response{}, fmt.Errorf("no handler: %s", name) }
    return h.Handle(req), nil
}
```

Two-value returns are the Go-idiomatic "may not exist" signal. They make the compiler help you.

**Why common:** "If it's registered, it's there" is true at design time and false at runtime. Single-return `Get` reads cleanly in the happy path and crashes silently in the missing path; two-return forces the question at the call site.
</details>

---

## Bug 11 — Hot-reload with non-atomic map swap (race during reload)

```go
package plugins

var (
    mu       sync.RWMutex
    plugins  = map[string]Plugin{}
)

func Reload(newSet map[string]Plugin) {
    mu.Lock()
    for k := range plugins { delete(plugins, k) }
    for k, v := range newSet { plugins[k] = v }
    mu.Unlock()
}

func Get(name string) (Plugin, bool) {
    mu.RLock(); defer mu.RUnlock()
    p, ok := plugins[name]; return p, ok
}
```

<details><summary>Answer</summary>

**Bug:** The lock makes operations safe, but "delete-then-add" leaves the registry in an inconsistent transient state — if you need atomic visibility ("everything in the new set, or everything in the old set, never mixed"), this isn't it. Reload of N entries also holds the write lock for O(N) work, blocking all readers.

**Why subtle:** With the lock, `go test -race` passes. Partial-visibility during reload only matters for invariants like "all v1 plugins or all v2 plugins" — invariants tests rarely check.

**Spot:** Any `Reload` / `Refresh` that mutates the existing map in place rather than swapping a pointer to a freshly-built map.

**Fix:** Build the new map outside the lock, then swap pointers using `atomic.Pointer[map[...]...]` for lock-free reads:

```go
var current atomic.Pointer[map[string]Plugin]
func Reload(newSet map[string]Plugin) {
    cp := maps.Clone(newSet)
    current.Store(&cp)
}
func Get(name string) (Plugin, bool) {
    m := *current.Load()
    p, ok := m[name]; return p, ok
}
```

Readers are lock-free and always see a consistent snapshot. Writers do all work outside the critical section; the swap is one pointer store.

**Why common:** "Just lock harder" is the default reflex. Atomic snapshot / copy-on-write is the standard idiom for hot-swap registries — it shows up after someone benchmarks reload latency or chases a mid-reload inconsistency.
</details>

---

## Bug 12 — Unbounded registration leak

```go
package metrics

var collectors = map[string]Collector{}
var mu sync.Mutex

// Called whenever a new tenant signs in.
func RegisterTenant(tenantID string) {
    mu.Lock(); defer mu.Unlock()
    collectors[tenantID] = newCollectorFor(tenantID)
}
```

<details><summary>Answer</summary>

**Bug:** Tenants get registered; nothing ever unregisters them. The registry grows monotonically — every tenant that ever signed in is still in memory, holding their `Collector` (backing histogram, label set, scrape state). After months, the map dominates process memory. No `Unregister`, no TTL, no LRU.

**Why subtle:** Memory grows slowly — looks like "normal growth". RSS plots show a linear ramp that crosses the OOM threshold weeks after deployment.

**Spot:** Any `Register*` API without a matching `Unregister*` / `Remove*` / TTL. Any registry keyed by unbounded user-derived values (tenant IDs, opaque tokens, session IDs).

**Fix:** Bound the cardinality at the source (collectors per *plan tier*, not per tenant) or add an `Unregister` wired to `tenant.OnDisabled` / `OnDelete`. For caches keyed by external input, use an explicit LRU like `hashicorp/golang-lru`.

**Why common:** "Register on first sight" is one line. "Unregister when no longer needed" requires owning the lifecycle, which is harder and easy to defer ("we'll add it later"). It rarely gets added later.
</details>

---

## Bug 13 — `Names()` called concurrently with `Register` (map iteration race)

```go
package codec

var codecs = map[string]Codec{}
var mu sync.Mutex

func Register(name string, c Codec) {
    mu.Lock(); defer mu.Unlock()
    codecs[name] = c
}

func Names() []string {
    out := make([]string, 0, len(codecs))
    for n := range codecs {              // BUG: no lock; iterates while Register runs
        out = append(out, n)
    }
    sort.Strings(out)
    return out
}
```

<details><summary>Answer</summary>

**Bug:** `Names()` does not take the lock. If `Register` runs concurrently, iteration in `Names()` races the assignment in `Register`. Go's runtime fatals with `concurrent map iteration and map write` — an unrecoverable panic, even with `defer recover()`.

**Why subtle:** "It only reads" feels safe. Iteration counts as access; an unsynchronised write during iteration is a fatal race. Often surfaces from a `/debug/registry` endpoint listing names during background loading.

**Spot:** Any read accessor (`Names`, `List`, `Len`, `All`) on a map that another method mutates, without symmetric locking.

**Fix:** Switch to `sync.RWMutex` and take an `RLock` on every read path (including `Names`, `List`, `Len`). `RLock` is shareable across many concurrent readers and only blocks against the rare `Register`.

**Why common:** Reads "feel free". They aren't — map iteration is a runtime-checked operation. The fatal-on-race behaviour was added precisely because silent corruption was worse.
</details>

---

## Bug 14 — Tests register fixture but don't unregister (state leaks)

```go
package codec_test

func TestEncodeFixture(t *testing.T) {
    codec.Register("fixture", &fakeCodec{out: []byte("ok")})
    c, ok := codec.Get("fixture")
    if !ok { t.Fatal("not registered") }
    // ... test assertions
}

func TestRegistrySize(t *testing.T) {
    if len(codec.Names()) != 3 {
        t.Errorf("expected 3 codecs, got %d", len(codec.Names()))
        // FAILS: 4, because "fixture" from TestEncodeFixture is still there
    }
}
```

<details><summary>Answer</summary>

**Bug:** The first test registers "fixture" into the package-global registry and never unregisters. The second test sees the leftover. Tests pass individually but fail together, or — worse — only fail in a specific order (which `go test -shuffle=on` eventually finds).

**Why subtle:** Tests are correct in isolation. The leak is between tests. CI passes until order changes, then fails with no code change.

**Spot:** Any `Register*` call inside a `Test*` function without a matching `t.Cleanup(func() { Unregister(...) })`.

**Fix:** Pair every test-time `Register` with `t.Cleanup`:

```go
func TestEncodeFixture(t *testing.T) {
    codec.Register("fixture", &fakeCodec{out: []byte("ok")})
    t.Cleanup(func() { codec.Unregister("fixture") })
    // ...
}
```

Better: provide a scoped registry that tests can instantiate fresh per `t.Run`, sidestepping the global entirely. That's the middle-level reason for *scoped* registries.

**Why common:** The pattern's "register at init" framing makes registration feel one-shot. Tests inherit the framing — they `Register` and forget. The leak is invisible until a sibling test observes it, often after a refactor reorders the file.
</details>

---

## Bug 15 — `plugin.Open` returns Symbol of wrong type, unchecked cast panics

```go
package loader

func LoadPlugin(path string) error {
    p, err := plugin.Open(path)
    if err != nil { return err }
    sym, err := p.Lookup("New")
    if err != nil { return err }
    newFn := sym.(func() Plugin)            // BUG: type assertion without ,ok
    registry.Register(path, newFn())
    return nil
}
```

<details><summary>Answer</summary>

**Bug:** `plugin.Lookup` returns `plugin.Symbol`, which is `any`. The assertion `sym.(func() Plugin)` panics if the plugin exposed `New` with a different signature (e.g., `func() (Plugin, error)`). A panic during plugin load aborts the triggering request, or crashes before `main()` if the load runs in `init()`.

**Why subtle:** The plugin compiled. The function exists. The signature is one parameter off. The assertion error is informative but easy to miss in a stack full of `runtime.panic`.

**Spot:** Any `sym.(SomeType)` without the comma-ok form, or any `plugin.Lookup` without a signature validation step.

**Fix:** Use the comma-ok form and convert the panic into an error you can surface:

```go
sym, err := p.Lookup("New")
if err != nil { return fmt.Errorf("plugin %q missing New: %w", path, err) }
newFn, ok := sym.(func() Plugin)
if !ok {
    return fmt.Errorf("plugin %q: New has wrong signature %T", path, sym)
}
registry.Register(path, newFn())
```

For richer contracts, define a small interface (`type PluginEntry interface { New() Plugin }`) and have plugins export a *variable* of that type rather than a function — interface assertions are easier to keep stable across versions.

**Why common:** Type assertions feel like casts. The single-return form is shorter and reads cleanly until it crashes. With `plugin.Open` specifically, the surface area (raw `any` from a separately-compiled binary) makes the comma-ok form mandatory, not optional.
</details>

---

## Summary

These bugs cluster into four families.

**Wiring and import discipline (1, 9, 15):** missing blank import so `init()` never runs, registry-importing-consumers cycles, unchecked type assertions from `plugin.Lookup`. Registries live or die by the import graph — one-direction-only, blank imports in the binary, and validate every symbol you load dynamically.

**Concurrency and locking (3, 4, 11, 13):** mutating without a lock, `init()` spawning a `go func()`, in-place reload instead of atomic swap, read-side methods skipping the lock. A registry is shared state; every access — including iteration — needs symmetric synchronisation, and `init()` must finish synchronously before `main()`.

**API contract clarity (2, 5, 6, 7, 8, 10):** silent overwrite on duplicate, `reflect.Type` keys mismatching pointer-vs-value, concrete-type coupling, returning the internal map, `nil` values accepted, single-return `Get` panicking on missing keys. The registry's external surface should fail loud on bad inputs (panic on duplicate, panic on nil) and force the caller to acknowledge "may not exist" (two-value `Get`).

**Lifecycle and tests (12, 14):** unbounded growth with no unregister, test fixtures leaking into sibling tests. Registries that admit new entries indefinitely without removal are memory leaks in slow motion; tests that touch the global registry must clean up or use a scoped instance.

Review checklist for any Registry / `init()` / blank-import / plugin-loading PR:

- [ ] Is every dynamic dependency wired up via a blank import in a file that's part of the binary, not a library package?
- [ ] Does `Register` panic on duplicate names (matching `sql.Register`) rather than silently overwriting?
- [ ] Does `Register` reject `nil` values at registration time?
- [ ] Is the registry map guarded by `sync.RWMutex` (or `atomic.Pointer` for hot-swap), with every read path — including `Names()` / `List()` — taking the read lock?
- [ ] Are all `init()` functions synchronous? No `go func() { Register(...) }()` from `init`?
- [ ] Is the registry's value type an interface, not a concrete struct — so a second implementation can slot in without touching call sites?
- [ ] Is the registry-import direction one-way: drivers import registry, never the reverse?
- [ ] Does `Get(name)` return `(T, bool)` instead of a single `T` that callers will dereference without checking?
- [ ] If the registry supports reload, does it swap pointers to a freshly-built map (atomic visibility) rather than mutating the existing map in place?
- [ ] Does every `Register` API have a documented lifecycle — either bounded cardinality, a paired `Unregister`, or a TTL/LRU eviction policy?
- [ ] Do tests that call `Register` pair the call with `t.Cleanup(Unregister)`, or use a scoped registry instance to avoid leaking state between tests?
- [ ] Are all `plugin.Lookup` results checked with the comma-ok form on the type assertion, and the failure converted into an error rather than a panic?
