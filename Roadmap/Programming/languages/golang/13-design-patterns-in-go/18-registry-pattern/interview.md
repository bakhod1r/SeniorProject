# Registry Pattern — Interview

## 1. How to use this file

25 questions in interview order — junior to staff — plus three live-coding prompts, a concept-check list, and signals interviewers grade on. Each question has a **short answer** (two to five sentences, the length you'd give in the room) and where it matters a **follow-up to expect**. Read top to bottom on first pass; on revision skim and re-read only the ones you stumbled on. Type the live-coding solutions out at least once. The Registry pattern in Go is unusual because it pretends to be a Map but is really a contract about *when* writes are allowed (`init()`) and *how* the wiring happens (`import _`). Naming that contract precisely is what separates senior from junior.

---

## 2. Junior questions (Q1–Q7)

### Q1. What is the Registry pattern?

**Short answer:** A Registry is a global lookup table: a map of `name → implementation` (or `name → factory`, or `pattern → handler`). New implementations *register themselves* at startup; consumers *look up* by name at use time. The pattern decouples the consumer from the concrete implementation — code that calls `Get("postgres")` does not import the postgres driver. The simplest mental model is "a `map[string]Thing` with `Register` and `Get` methods, plus a mutex".

**Follow-up:** What is it not? Answer: not Service Locator (Locator returns instances on demand, Registry returns *the same* registered instance), not Dependency Injection (DI passes dependencies as arguments, Registry hides them behind a name).

---

### Q2. Why use a global Registry instead of just passing dependencies around?

**Short answer:** Two reasons. (1) **Plugin discovery without explicit wiring.** A user enables a Postgres driver by writing `import _ "github.com/lib/pq"` — no constructor call, no factory. The driver's `init()` registers itself; `database/sql` finds it. This is the only way to add capability to a binary without modifying its `main` package. (2) **Type-name-driven serialization.** `gob`, `json.RawMessage` dispatch, RPC handler tables — all need "given this name string, return the type/handler". A Map keyed by name is the natural shape.

**Follow-up:** When is DI better? Answer: whenever the dependency is known at compile time and changes per test or per environment. Globals are hard to test, hard to scope per-tenant, hard to swap. Pick Registry only when you need plugin-style discovery or name-based dispatch.

---

### Q3. What role does `init()` play in the Registry pattern?

**Short answer:** `init()` is the "register myself" hook. Each package that provides an implementation declares an `init()` that calls `parent.Register(name, impl)`. Because `init()` runs exactly once, before `main()`, and after every imported package has been initialised, by the time `main` runs the Registry is fully populated. No explicit wiring code is needed — importing the package is the wiring.

```go
// In github.com/lib/pq:
func init() {
    sql.Register("postgres", &Driver{})
}
```

**Follow-up:** What if I have multiple `init()`s in one package? Answer: legal and useful — they run in source-file alphabetical order, then in declaration order within a file. Useful for splitting registration across files (`drivers_aws.go`, `drivers_gcp.go`, each with its own `init()`).

---

### Q4. What is `import _` ("blank import") and why does the Registry pattern need it?

**Short answer:** `import _ "path/to/pkg"` imports a package solely for its side effects — the `init()` runs but you don't reference any exported symbol. The Registry pattern needs it because the consumer code calls `sql.Open("postgres", ...)` by name; it has no symbol from `pq` to import the normal way. Without the blank import, `pq` is never linked, its `init()` never runs, and `sql.Open("postgres")` fails with "unknown driver".

```go
import (
    "database/sql"
    _ "github.com/lib/pq" // side-effect import: registers "postgres"
)
```

**Follow-up:** What's the downside? Answer: dead code looks like a bug. A maintainer deletes the blank import "because it's unused" and the binary breaks at runtime. Mitigation: comment explicitly, lint rules that whitelist known side-effect packages.

---

### Q5. Walk through `sql.Register` as a Registry example.

**Short answer:** `database/sql` exposes:

```go
func Register(name string, driver driver.Driver) {
    driversMu.Lock()
    defer driversMu.Unlock()
    if driver == nil { panic("sql: Register driver is nil") }
    if _, dup := drivers[name]; dup {
        panic("sql: Register called twice for driver " + name)
    }
    drivers[name] = driver
}
```

A driver package's `init()` calls `sql.Register("postgres", &pq.Driver{})`. Later, `sql.Open("postgres", dsn)` looks up the name in the same map. The pattern: package-level map + mutex + `Register(name, impl)` + `Lookup`/`Open`/`Get`. The two `panic` cases — nil driver, duplicate name — are the canonical defensive checks.

**Follow-up:** Why panic instead of return error? Answer: `Register` is called from `init()`, which has no useful place to return an error. A duplicate or nil registration is a programming bug; failing loudly at startup is better than failing silently and dispatching to the wrong driver hours later.

---

### Q6. How does Registry compare to Dependency Injection?

**Short answer:** They solve overlapping problems differently. Registry: globals plus name-based lookup, wired by `import _`, opaque to the compiler. DI: explicit constructor arguments, wired by the call graph, type-checked by the compiler. Registry wins on plugin-style extensibility ("anyone can add a driver without touching `database/sql`"). DI wins on testability and scoping ("each test gets its own dependency set"). Most production codebases use both: DI inside the application, Registry where a named-dispatch boundary exists (drivers, codecs, HTTP handlers).

**Follow-up:** Can you fake DI on top of a Registry? Answer: yes — scoped (non-global) registries are essentially DI containers keyed by name. The line blurs once you stop using a package-level map.

---

### Q7. What's the duplicate-panic convention and why does Go use it?

**Short answer:** When two packages try to register under the same name, `sql.Register`, `gob.Register`, `prometheus.MustRegister` all *panic*. The reasoning: the binary cannot decide which implementation wins, the conflict is almost always a packaging mistake (two transitive deps pulling the same plugin), and silently picking one would cause hours of debugging. Panic at startup is the loudest possible error, while no one is depending on the wrong answer yet.

```go
if _, dup := drivers[name]; dup {
    panic("sql: Register called twice for driver " + name)
}
```

**Follow-up:** When *should* a Registry tolerate duplicates? Answer: hot-swap registries (last-write-wins is the intent), or test fakes that explicitly override a real implementation. In those cases the API exposes `Replace(name, impl)` distinct from `Register(name, impl)` — never silently overwrite.

---

## 3. Middle questions (Q8–Q15)

### Q8. What are the three forms of Registry and when do you reach for each?

**Short answer:** The three forms share a `map[Key]Value` shape but differ in what they store.

| Form | Key | Value | Example |
|------|-----|-------|---------|
| **Implementation** | string | Interface satisfier | `sql.Register("postgres", driver)` |
| **Factory** | string | Constructor function | `stores.New("redis", cfg)` |
| **Handler** | route/pattern | Handler function | `mux.HandleFunc("/users", h)` |

Implementation when the registered value is ready to use as-is (drivers, codecs). Factory when construction needs config supplied at lookup time (clients, stores with credentials). Handler when lookup is per-event and matches against a pattern (HTTP routes, gRPC services, message subscribers).

**Follow-up:** Can one Registry hold multiple forms? Answer: technically yes (`map[string]any`), in practice no — you lose the type safety that makes Registries usable. Keep them separate; mix them at the call site.

---

### Q9. `sync.RWMutex` vs `sync.Map` for a Registry — which do you choose?

**Short answer:** Default to `sync.RWMutex` for a Registry because writes are rare (`init()` only) and reads are often slow paths anyway. `sync.RWMutex` plus a plain map is simpler, debuggable, and supports `Names()`/`Range` cleanly. Reach for `sync.Map` only when the read path is genuinely hot (per-request lookup on a multi-million-RPS service) and profiling shows mutex contention. `sync.Map`'s API is awkward (`Load`, `Store`, `LoadOrStore`, `Range`) and its memory model is two backing maps — overkill for a startup-time Registry.

**Follow-up:** When is `sync.Map` strictly better? Answer: when (a) keys are written once and read many times, or (b) keys are disjoint across goroutines. Both match its internal optimizations. A startup-only Registry matches (a) — and `RWMutex` is still simpler.

---

### Q10. State the `init()` ordering rules precisely.

**Short answer:** Four rules.

1. **Package-level `var` initialisers run first**, in dependency order within the package.
2. **`init()` functions run after vars**, in source-file alphabetical order; within a file, in declaration order.
3. **Imports are fully initialised before the importer's vars or `init()`s**. If A imports B, all of B's vars and `init()`s run before A touches anything.
4. **Each package is initialised exactly once**, even if imported by N packages.

Practical consequences for Registry code: a consumer that calls `Lookup` in `main` is guaranteed to see every `Register` from every imported package. A consumer that calls `Lookup` *from within another `init()`* sees only registrations from packages it *transitively imports* — sibling-import `init()`s have no defined relative order.

**Follow-up:** How to handle the sibling-`init()` problem? Answer: don't depend on it. If package A's `init()` needs B's registration, A must import B. Never rely on "they both happen to be imported by main".

---

### Q11. Why prefer a scoped Registry over a global one in libraries you write?

**Short answer:** Globals are convenient (`Register("foo", impl)` from any `init()`) but they bind tests together. Two tests cannot register conflicting impls in parallel; mocks leak across test files; per-tenant or per-request configuration is impossible. A scoped Registry is an instance — `registry := New(); registry.Register(...)` — passed via DI. Tests get their own. Production might still expose a `Default` package-level variable for convenience, but library consumers can always construct their own.

```go
type Registry struct { mu sync.RWMutex; m map[string]Codec }
var Default = New()
```

**Follow-up:** What's the migration path from global to scoped? Answer: introduce the `Registry` struct first; move the package-level functions to thin wrappers over `Default.Method()`; later, deprecate the wrappers. Same as the stdlib's `http.DefaultServeMux` story.

---

### Q12. Why is `Names() []string` important on a Registry?

**Short answer:** Without an enumeration method, a failed `Get("posgres")` gives no hint about what's available — the consumer sees "unknown driver" and the operator wastes ten minutes wondering if their typo is the bug or the import. `Names()` exposes the current set of keys: log them at startup, include them in error messages, surface them in `/debug` endpoints. This single method turns a Registry from a black box into a debuggable component.

```go
func (r *Registry) Names() []string {
    r.mu.RLock(); defer r.mu.RUnlock()
    out := make([]string, 0, len(r.m))
    for k := range r.m { out = append(out, k) }
    sort.Strings(out) // determinism makes diffs and logs readable
    return out
}
```

**Follow-up:** Sorted or insertion-order? Answer: sorted. Insertion order depends on `init()` ordering which depends on import graph — non-deterministic across builds. Sorted output makes startup logs diffable.

---

### Q13. What are the risks of using `reflect.Type` as the Registry key?

**Short answer:** A `map[reflect.Type]Handler` keyed registry buys compile-time safety on the registration side but loses three things. (1) **Stability across renames** — rename the struct and every registration breaks; downstream consumers may have persisted the name. (2) **Serializability** — `reflect.Type` cannot be sent over a wire or stored in a config file; you eventually need a string anyway. (3) **Multiple impls per type** — you cannot register two handlers for `*UserEvent` under different names. The trade is favourable for purely in-memory dispatch (visitor patterns, in-process event buses) and unfavourable when registrations cross persistence or process boundaries.

**Follow-up:** `gob.Register` uses `reflect.TypeOf` internally — why does it work? Answer: `gob` derives a *string name* from the type (`pkg.TypeName`) and uses that as the wire identifier. The map is `map[string]reflect.Type` internally, not `map[reflect.Type]anything`. Same lesson: strings on the wire.

---

### Q14. What are the three Registry lifecycle policies?

**Short answer:**

1. **Startup-only.** All `Register` calls happen in `init()` or early `main()`. After that the Registry is effectively read-only. Lock is defensive. Easiest correctness story; covers 95% of cases.
2. **Lazy registration.** Code calling `Get(name)` may register if missing — common in deserialization where you discover types as you go. Lock is hot in both directions; needs care.
3. **Hot-swap.** A running server reloads plugins (signal-driven config reload, blue-green inside one process). Needs versioning, drain semantics, and ideally `atomic.Pointer` over a copy-on-write map. Consumers must be tolerant of "the impl swapped between Get and Use".

Most Go Registries should be startup-only. Reach for the others only when you have a concrete requirement.

**Follow-up:** Why is hot-swap so much harder? Answer: read-while-write semantics, in-flight consumers holding old impls, and ordering across goroutines. The cheapest correct implementation is `atomic.Pointer[map[string]Impl]` — readers atomic-load the map and use it freely; writers atomic-store a brand-new map. Old readers see the old map until they finish.

---

### Q15. What's special about `gob.Register`?

**Short answer:** `gob` encodes Go values for the wire and needs to know how to decode `interface{}` fields — the wire only carries data, not the concrete type. `gob.Register(MyType{})` records `(typeName → reflect.Type)` so the decoder can construct the right concrete type when it hits an interface slot. Two consequences. (1) Both encoder and decoder processes must `gob.Register` the same types under the same names, or decode panics with "type not registered". (2) The type name is `pkg.TypeName` derived from the registered value — moving a type to a different package silently breaks the wire format. Use `gob.RegisterName(name, value)` if you want stable names independent of package paths.

**Follow-up:** Why does `encoding/json` not need a `Register`? Answer: `json` uses type-switch and `Unmarshaler` interfaces, not name-based dispatch. The cost: you must explicitly write `UnmarshalJSON` for each polymorphic field. The trade: no global registry, but more boilerplate per type.

---

## 4. Senior questions (Q16–Q22)

### Q16. Design a Registry that supports hot-reload of implementations.

**Short answer:** Use `atomic.Pointer[map[string]Impl]` so reads are lock-free and writes swap a fresh map atomically. Three pieces.

```go
type Registry struct{ m atomic.Pointer[map[string]Impl] }

func New() *Registry {
    r := &Registry{}
    empty := map[string]Impl{}
    r.m.Store(&empty)
    return r
}

func (r *Registry) Get(name string) (Impl, bool) {
    m := *r.m.Load()
    v, ok := m[name]
    return v, ok
}

func (r *Registry) Reload(next map[string]Impl) {
    cp := make(map[string]Impl, len(next))
    for k, v := range next { cp[k] = v }
    r.m.Store(&cp)
}
```

Senior moves: (a) writers always store a *brand-new* map — never mutate the live one; (b) readers `Load` once and use the snapshot, so a mid-call swap doesn't tear; (c) old impls remain reachable from old goroutines until they finish — `Reload` is a publish, not a deletion. Pair with a drain signal if old impls hold resources you must release.

**Follow-up:** What if an in-flight request started with the old impl and a downstream is now in the new impl's world? Answer: orthogonal problem — request-scoped impls must be resolved once at request entry and held in `context.Context`, not re-Looked-up mid-handler. Hot-swap fixes "new requests see new impl", not "in-flight requests see new impl".

---

### Q17. Show a generic `Registry[T]` with `Register`/`Get`/`Names` and explain the design choices.

**Short answer:** See Live-Coding Prompt 1 for the implementation. Design choices: (1) generics over `any` to avoid boxing and preserve type-safety at call sites; (2) `sync.RWMutex` for cheap concurrent reads; (3) `Register` panics on nil and duplicate (junior would return error; senior matches stdlib convention); (4) `Names()` returns sorted output for deterministic startup logs; (5) `Get` returns `(T, bool)` like a map read, not `(T, error)` — absence is not an error, it's a state the caller may handle.

**Follow-up:** Why panic in `Register` rather than return error? Answer: `Register` runs in `init()` which has no useful place for an error. The conventions of `sql.Register`, `gob.Register`, `prometheus.MustRegister` all agree. The cost of "wrong" registration is unambiguously catastrophic, so failing loud is right.

---

### Q18. How does Prometheus's collector registration work and what does it teach about Registries?

**Short answer:** `prometheus.MustRegister(collector)` adds a collector to the default `Registry`; on scrape, the Registry iterates collectors and calls `Collect(chan<- Metric)`. Three Registry lessons.

1. **Two-phase enumeration.** The Registry doesn't store metrics directly; it stores *producers* (collectors) that yield metrics on demand. Lazy materialization keeps memory bounded.
2. **Validation at register time.** `Register` checks for label-name conflicts across collectors and returns `AlreadyRegisteredError` — same-fingerprint collectors are de-duped, conflicting ones rejected. Catches double-registration bugs.
3. **Pluggable scoping.** `NewRegistry()` exists for testing and per-tenant exposition; the global `DefaultRegisterer` is convenience. Production Prometheus integrations almost always use scoped registries.

**Follow-up:** Why expose `MustRegister` *and* `Register`? Answer: `Register` returns an error so library code can recover; `MustRegister` panics so application code can stay short. Same pairing as `template.Must`, `regexp.MustCompile`.

---

### Q19. Design an etcd-backed service discovery Registry.

**Short answer:** Replace the in-memory map with an etcd-watched view. Five pieces.

1. **Write path.** Service instance puts `services/{name}/{instance_id} → addr` with a lease (TTL ~30s); renews the lease every 10s. Crash = lease expires = key disappears.
2. **Read path.** Consumers `Watch(prefix=services/)` to receive create/delete events; build an in-memory map locally so lookups are O(1) and don't hit etcd per call.
3. **Local cache invariant.** On reconnect, do a `Get(prefix=services/)` to resync, then resume watching from the returned revision. Lost events lead to stale routing — resync is mandatory.
4. **Read API.** `Get(name) -> []Addr` returns the current snapshot; consumers pick one (round-robin, least-loaded, consistent-hash) according to local policy. Registry doesn't choose for them.
5. **Observability.** Expose `watch_lag_seconds`, `instances_by_service`, `reconnect_count` — etcd issues are silent without these.

**Follow-up:** Why not query etcd per lookup? Answer: per-RPC latency budget + etcd quorum cost. Local cache + watch is the standard pattern; the few-millisecond replication lag is acceptable for service discovery (rare topology changes).

---

### Q20. How does `hashicorp/go-plugin` use the Registry pattern?

**Short answer:** `go-plugin` runs plugins as out-of-process binaries communicating over gRPC. Three registries are involved.

1. **Plugin set** on the host: `plugin.PluginSet{"greeter": &GreeterPlugin{}}` — host's map of `name → plugin definition`, telling the framework how to construct client and server sides.
2. **Handshake config**: host and plugin agree on a magic cookie and protocol version; mismatch aborts before any RPC. Effectively a registry of compatible protocol versions.
3. **Inside the plugin process**: the plugin binary calls `plugin.Serve(&plugin.ServeConfig{Plugins: plugin.PluginSet{...}})` registering which plugins this process implements.

The host's `Client.Dispense("greeter")` looks up by name in the plugin set, returning a typed RPC stub. Pattern lesson: when plugins live out-of-process, the Registry is still string-keyed but the value is a *protocol description* (how to construct a gRPC client/server), not the implementation itself.

**Follow-up:** Why not use Go's built-in `plugin` package? Answer: `plugin.Open` (in-process `.so` loading) has brittle constraints — same Go version, same module versions, Linux/macOS only, no Windows, hard to unload. `hashicorp/go-plugin` trades in-process speed for portability and isolation. Almost every real Go plugin system picks the out-of-process route.

---

### Q21. A service's `init()` is hanging — registration never completes and `main()` never runs. How do you diagnose?

**Short answer:** Six steps.

1. **Confirm the symptom.** Add `runtime/pprof` to dump goroutines on SIGQUIT; you'll see goroutines parked in `init`-related frames.
2. **Identify the package.** Stack frames from `init.0`/`init.1` name the package and source file.
3. **Read the `init()` body.** Common culprits: synchronous network calls (DNS lookup, config fetch), channel sends without a receiver yet, `sync.Once` inside a circular dependency, blocking `os.Open` on a pipe.
4. **Look for circular initialization.** Package A's `init()` calls into B; B's `init()` waits for A to finish. Go detects most cycles at compile time, but cycles via reflection or function pointers slip through.
5. **Check for goroutine-launching `init()`s.** Spawning a goroutine that the consumer of the Registry must wait on is a deadlock waiting to happen — `init()` returns, `main()` runs, but the registration never lands because the goroutine is still working.
6. **Bisect by build tags.** If the offending package isn't obvious, build with a subset of imports until the hang disappears.

**Follow-up:** The cardinal rule? Answer: `init()` does *no I/O and no blocking calls*. It populates a Registry, sets defaults, validates constants. Anything else belongs in `main` or a constructor.

---

### Q22. How do you support removing a registration?

**Short answer:** Most stdlib Registries don't support it — `sql.Register` and `gob.Register` are append-only by design, because removal implies "a previous Get may now see a different value", and the lifecycle policy doesn't permit that. When you *do* need it (test cleanup, dynamic plugin unload), three rules.

1. **Expose `Unregister(name)`** as a separate method, not via `Register("name", nil)`. Explicit beats overloaded.
2. **Snapshot semantics for in-flight users.** A consumer that called `Get(name)` and is mid-use *cannot* be ripped away — they hold a reference, so the impl stays alive as long as someone uses it. Removal from the map is only "no new lookups will find it".
3. **Document the lifecycle policy.** "Removal does not stop in-flight users" is non-obvious; spell it out in the doc comment so callers don't assume hot unload semantics.

**Follow-up:** What about resource cleanup on removal? Answer: separate concern. The Registry can call `impl.Close()` after the remove if the interface defines it, but this *races* with in-flight users. Real solution: refcount the impl, decrement on caller release, close on zero. Most teams don't need it; if you do, you're building a plugin manager, not a Registry.

---

## 5. Staff/Architect questions (Q23–Q25)

### Q23. Design a plugin system for a Go platform from scratch — what's in scope?

**Short answer:** Seven decisions grounded in production constraints.

1. **Process boundary.** In-process plugins (`plugin.Open`) are brittle; out-of-process via gRPC (`hashicorp/go-plugin`) is the default. Pay the IPC tax to get isolation, version flexibility, and crash containment.
2. **Two-layer Registry.** A *plugin Registry* of `name → plugin descriptor` (binary path, protocol version, handshake) is the manifest. A *capability Registry* on the host maps `capability_name → (plugin_name, method)` — plugins advertise capabilities; host dispatches by capability, not by plugin identity.
3. **Versioning at the registration boundary.** Every plugin declares `api_version = "v1"`; host refuses to load unless versions match an allowlist. Breaking changes bump the version; old plugins stay supported until end-of-life.
4. **Lifecycle endpoints.** Plugins must implement `Init(ctx)`, `Shutdown(ctx)`, `Health() Status`. Host can drain (stop sending new work) before shutdown. No surprise SIGKILL.
5. **Observability.** Per-plugin metrics (`plugin_rpc_duration`, `plugin_restart_total`), structured logs with `plugin_name` label, traces propagated across the IPC boundary.
6. **Sandboxing.** Plugins run as separate users in containers; file-system and network access controlled by the host's policy, not the plugin's process privileges.
7. **Configuration as a Registry.** Plugin-specific config lives in `config.plugins.{name}` — a Registry of `name → config blob` parsed against the plugin's declared schema at load time.

Staff move: name what's **not** in scope — durable cross-restart plugin state, multi-tenant isolation inside one plugin process, and dynamic schema migration belong to layers above the plugin runtime.

**Follow-up:** Why two-layer Registry? Answer: one plugin can advertise multiple capabilities, and one capability can be served by multiple plugins (failover, A/B). Collapsing into a single name → impl map loses that flexibility, and you'll need to re-design the day a customer asks for capability-level routing.

---

### Q24. Design multi-region replication of a Registry that's read on every RPC.

**Short answer:** A Registry that drives request routing must be replicated with bounded staleness and an explicit consistency model. Three architectures, picked by the cost of being wrong.

1. **Eventually consistent fan-out.** A control plane writes to a region-local KV (etcd, Consul); a replication agent pushes changes to other regions asynchronously. Reads are always local; staleness window is measured in seconds. Use when "old impl runs for 10 seconds after deploy" is fine — typical for codec or feature-flag Registries.
2. **Strongly consistent global store.** Use Spanner, CockroachDB, or DynamoDB Global Tables; every read is local but writes are quorum across regions, ~100ms. Use when Registry state drives correctness — e.g. tenant → shard mapping. Region failure = degraded writes, reads continue.
3. **Region-affine Registry.** Each tenant or namespace lives in one region; the Registry of "where does X live" is small and globally replicated, but the *content* Registries (codecs, handlers, plugins) are region-local. Tenant failover is an operation; cross-region routing is rare. Best blast-radius story.

Staff move: build a `replication_lag_seconds` gauge per region pair + alert at 30s; practice region failover quarterly; document the staleness SLO so application teams design around it.

**Follow-up:** What if a Registry update is "remove dangerous impl X immediately"? Answer: eventual-consistency replication is too slow. Push the kill signal via a separate fast path (control-plane RPC to each region's runtime), then update the Registry. Same pattern as feature-flag kill switches — slow path for state, fast path for revocation.

---

### Q25. Observability for runtime-loaded handlers — what do you build before deploying?

**Short answer:** Five signals, all required.

1. **`registry_size{registry_name}`** gauge — current number of registered impls. Drops to zero on misconfigured deploy.
2. **`registry_register_total{registry_name, name, outcome=success|duplicate|invalid}`** counter — proves registrations happen and exposes duplicates as a separate bucket.
3. **`registry_lookup_total{registry_name, name, outcome=hit|miss}`** counter — `miss` should be near-zero; spikes indicate a typo in caller code, a missing import, or a hot-reload that dropped a key.
4. **`registry_reload_total{registry_name, outcome}`** counter + **`registry_reload_duration_seconds`** histogram — hot-reload health: slow reloads imply lock contention; failed reloads imply config bugs.
5. **`runtime_loaded_handlers`** structured-log line at each load, with `handler_name`, `handler_version`, `source` (binary, plugin, config). Log-driven discovery beats reading the source when debugging an incident.

Plus: a `/debug/registry/{name}` HTTP endpoint that dumps `Names()` and basic metadata of every registered impl. When an on-call says "I don't know what's loaded", they shouldn't need a binary rebuild to find out.

**Follow-up:** Most useful single signal in an incident? Answer: `registry_lookup_total{outcome=miss}` paired with the handler name. Spike = either a deploy dropped an impl or a client typo'd a name. Find the lookup site in code and you've localized the bug in under a minute. Without this metric, you're grepping logs.

---

## 6. Live-coding prompts

### Prompt 1: Generic `Registry[T]` with `Register`, `Get`, and `Names`

**Problem.** Implement `Registry[T any]` with `Register(name string, v T)`, `Get(name string) (T, bool)`, and `Names() []string`. `Register` must panic on duplicate name and on the zero value of `T`. Reads must be concurrent-safe; `Names` must return sorted output for log determinism.

**Answer.**

```go
package registry

import (
    "fmt"
    "reflect"
    "sort"
    "sync"
)

type Registry[T any] struct {
    mu sync.RWMutex
    m  map[string]T
}

func New[T any]() *Registry[T] {
    return &Registry[T]{m: make(map[string]T)}
}

func (r *Registry[T]) Register(name string, v T) {
    // Zero-value check: generic-safe equivalent of "v == nil" for interfaces.
    if reflect.ValueOf(&v).Elem().IsZero() {
        panic(fmt.Sprintf("registry: Register zero value for %q", name))
    }
    r.mu.Lock()
    defer r.mu.Unlock()
    if _, dup := r.m[name]; dup {
        panic(fmt.Sprintf("registry: Register called twice for %q", name))
    }
    r.m[name] = v
}

func (r *Registry[T]) Get(name string) (T, bool) {
    r.mu.RLock()
    defer r.mu.RUnlock()
    v, ok := r.m[name]
    return v, ok
}

func (r *Registry[T]) Names() []string {
    r.mu.RLock()
    defer r.mu.RUnlock()
    out := make([]string, 0, len(r.m))
    for k := range r.m { out = append(out, k) }
    sort.Strings(out)
    return out
}
```

Senior moves: (a) `reflect.ValueOf(&v).Elem().IsZero()` is the generic-safe nil/zero check — `v == nil` doesn't compile for unconstrained `T`; (b) panic on duplicate matches stdlib convention; (c) `RWMutex` for cheap reads; (d) sorted `Names()` is deterministic across builds.

---

### Prompt 2: HTTP router as a Registry with wildcard match

**Problem.** Implement `Router` whose `Handle(pattern, handler)` registers a route and whose `ServeHTTP` looks up the handler by the request's URL path. Support exact matches (`/users`) and one trailing wildcard segment (`/users/:id`). Wildcards bind a single path segment and pass it to the handler via `r.Context()`.

**Answer.**

```go
package router

import (
    "context"
    "net/http"
    "strings"
    "sync"
)

type ctxKey string
const ParamKey ctxKey = "param"

type route struct {
    parts   []string // ["users", ":id"]
    handler http.Handler
}

type Router struct {
    mu     sync.RWMutex
    routes []route
}

func New() *Router { return &Router{} }

func (r *Router) Handle(pattern string, h http.Handler) {
    parts := splitPath(pattern)
    r.mu.Lock()
    defer r.mu.Unlock()
    r.routes = append(r.routes, route{parts: parts, handler: h})
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    parts := splitPath(req.URL.Path)
    r.mu.RLock()
    defer r.mu.RUnlock()
    for _, rt := range r.routes {
        if len(rt.parts) != len(parts) { continue }
        params := map[string]string{}
        match := true
        for i, p := range rt.parts {
            if strings.HasPrefix(p, ":") {
                params[p[1:]] = parts[i] // bind wildcard segment
            } else if p != parts[i] {
                match = false
                break
            }
        }
        if match {
            ctx := context.WithValue(req.Context(), ParamKey, params)
            rt.handler.ServeHTTP(w, req.WithContext(ctx))
            return
        }
    }
    http.NotFound(w, req)
}

func splitPath(p string) []string {
    p = strings.Trim(p, "/")
    if p == "" { return nil }
    return strings.Split(p, "/")
}
```

Senior moves: (a) a Router *is* a Registry of `pattern → handler` — naming it that way clarifies the design; (b) `RWMutex` so dispatch is concurrent under typical add-rarely workloads; (c) wildcard binding via path-segment match — predictable, no regex surprises; (d) params land in `context.Context`, not on the request — standard idiom; (e) linear scan is fine until you measure otherwise — premature trie optimization adds bugs.

---

### Prompt 3: Hot-reload Registry with `atomic.Pointer`

**Problem.** Implement `HotRegistry[T]` where readers are completely lock-free and writers can atomically replace the entire set of registrations. Provide `Get(name) (T, bool)`, `Names() []string`, and `Reload(map[string]T)`. Concurrent calls to `Reload` are allowed; the last one wins.

**Answer.**

```go
package registry

import (
    "sort"
    "sync/atomic"
)

type HotRegistry[T any] struct {
    snap atomic.Pointer[map[string]T]
}

func NewHot[T any]() *HotRegistry[T] {
    r := &HotRegistry[T]{}
    empty := map[string]T{}
    r.snap.Store(&empty)
    return r
}

// Reload publishes a brand-new snapshot. Callers must not mutate
// the input map after passing it in.
func (r *HotRegistry[T]) Reload(next map[string]T) {
    cp := make(map[string]T, len(next))
    for k, v := range next { cp[k] = v }
    r.snap.Store(&cp)
}

func (r *HotRegistry[T]) Get(name string) (T, bool) {
    m := *r.snap.Load()
    v, ok := m[name]
    return v, ok
}

func (r *HotRegistry[T]) Names() []string {
    m := *r.snap.Load()
    out := make([]string, 0, len(m))
    for k := range m { out = append(out, k) }
    sort.Strings(out)
    return out
}
```

Senior moves: (a) `atomic.Pointer[map[string]T]` makes the read path lock-free — no contention, perfect for hot dispatch loops; (b) `Reload` copies the input before storing, so the caller can't mutate the live snapshot under us; (c) concurrent readers see the old snapshot until their next `Load` — no torn reads, no half-applied updates; (d) old snapshots are garbage-collected when no goroutine holds them — automatic memory reclamation; (e) no per-call locking means dispatch latency is the same whether or not a reload is in flight.

---

## 7. Concept checks

If you cannot answer any of these in one breath, study more before the interview.

- What is the Registry pattern? (A global lookup table from `name` to implementation, factory, or handler, populated at `init()` time and consulted at use time.)
- Why does `database/sql` use a Registry? (To let driver packages plug in via `import _` without modifying the `sql` package or `main`.)
- What does `import _ "path"` mean? (Side-effect import — runs the package's `init()` but exposes no symbols; required for blank-import Registry patterns.)
- Name the three forms of Registry. (Implementation: name → ready impl. Factory: name → constructor. Handler: pattern → callback.)
- Why does `sql.Register` panic on duplicate? (`init()` has no useful place to return an error; duplicate registration is unambiguously a bug; fail loud at startup before harm.)
- `sync.RWMutex` vs `sync.Map` for a startup-only Registry — pick one. (`sync.RWMutex` — simpler, supports `Names()`, contention is not the bottleneck for startup-only writes.)
- In what order do `init()` functions run? (Var inits first; then `init()`s in source-file alphabetical order; imports finish before importer; each package init runs exactly once.)
- Why is `Names() []string` important? (Debuggability — a `Get(name)` miss with no enumeration leaves operators guessing; logging registered names at startup is a baseline.)
- Why is `reflect.Type` a risky Registry key? (Not stable across renames, not serializable, can't carry multiple impls per type — use strings when registrations cross persistence or process boundaries.)
- When do you reach for hot-swap over startup-only? (Long-running servers with runtime plugin reload, signal-driven config reload, blue-green inside one process. Most code does not need it.)
- Why does `gob.Register` exist but `json` does not? (`gob` dispatches polymorphic decode by name → type; `json` uses type-switches and `Unmarshaler` interfaces.)
- What goes wrong if `init()` does I/O? (Hangs deploy, fails before observability is up, no recovery path — `init()` must be pure-CPU registration and validation.)
- Why pass a scoped `*Registry` instead of using globals in libraries? (Testability, per-tenant scoping, parallel test isolation, swappable mocks.)
- Most useful single Registry metric? (`registry_lookup_total{outcome=miss}` — spikes localize misconfigurations to a name and a call site.)
- When can you `Unregister`? (When you have explicitly opted in to a removable-lifecycle policy, with snapshot semantics for in-flight users; not in append-only stdlib-style Registries.)

---

## 8. Red flags for interviewers

These signal a weak candidate.

- **No mention of `init()` or `import _`.** Treats Registry as just "a global map"; cannot explain why blank imports exist.
- **Doesn't panic on duplicate or nil registration.** Hand-rolls a Registry that silently overwrites; has not been bitten by a same-name-collision bug.
- **Uses a plain map without a mutex.** Says "registration only happens at startup, so it's fine" — until two `init()`s run in parallel goroutines and the race detector fires.
- **No `Names()` method.** Doesn't think about debuggability; can't explain how an operator would diagnose a missing impl.
- **Confuses Registry with Service Locator or DI.** Cannot articulate the lifecycle and discovery differences.
- **Suggests `reflect.Type` keys uncritically.** Doesn't see the renaming and serialization pitfalls.
- **Puts I/O in `init()`.** Talks about fetching plugin metadata from the network during init; has never debugged a hung startup.
- **Uses `sync.Map` by default.** Reaches for it for every map-with-mutex scenario without knowing its API or constraints.
- **No mention of lifecycle policy.** Cannot say whether the Registry is startup-only, lazy, or hot-swap; doesn't realize the choice constrains everything else.
- **Treats hot-reload as "just call `Register` again".** Doesn't recognize the in-flight-consumer problem; thinks delete-then-add is the solution.

---

## 9. Strong-candidate signals

These signal a strong candidate.

- **Names the three forms (implementation, factory, handler) unprompted.** Explains when to pick each.
- **`init()` plus `import _` story without prompting.** Knows exactly why blank imports exist and gives `database/sql` as the canonical example.
- **Panic-on-duplicate/nil reflexively.** Cites stdlib precedent (`sql.Register`, `gob.Register`, `prometheus.MustRegister`).
- **`Names()` for debuggability.** Adds enumeration before being asked; explains how it helps operators diagnose misconfiguration.
- **Distinguishes scoped from global Registries.** Argues for scoped in library code; pairs with `Default` for ergonomics.
- **Knows the three lifecycle policies.** Startup-only / lazy / hot-swap — picks the simplest that fits the requirement.
- **`atomic.Pointer` for hot-reload without prompting.** Knows the copy-on-write trick and the GC-cleans-old-snapshots invariant.
- **Observability before deployment.** Wires size, lookup-miss, and reload metrics into the design.
- **Honest about when Registry is wrong.** Recommends DI for in-process, compile-time-known dependencies; reaches for Registry only when plugin-style discovery or name-based dispatch is needed.
- **Knows the `init()` rules cold.** Var first, then sources alphabetically; can explain why sibling-`init()` ordering is undefined and what to do about it.

---

## 10. Further reading

- **`database/sql` source code**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/database/sql/sql.go> — read `Register`, the `drivers` map, and the `Open` lookup. The canonical Go Registry; sub-100 lines of pattern.
- **`encoding/gob` `Register` and `RegisterName`**: <https://cs.opensource.google/go/go/+/refs/heads/master:src/encoding/gob/type.go> — Registry for `interface{}` polymorphic decode. Read once to internalize the name-vs-type story.
- **`hashicorp/go-plugin`**: <https://github.com/hashicorp/go-plugin> — production-grade out-of-process plugin Registry. Read the `PluginSet`, handshake, and dispense code to see how Registries scale to multi-process plugin systems.
- **Prometheus `Registry`**: <https://pkg.go.dev/github.com/prometheus/client_golang/prometheus#Registry> — collector Registry with duplicate detection, scoping, and pluggable exposition. Best in-the-wild example of a non-trivial Go Registry.
- **Go spec, package initialization**: <https://go.dev/ref/spec#Package_initialization> — the rules for var and `init()` ordering, in plain language. Five minutes to read; saves hours of "why didn't my Registry populate" debugging.
