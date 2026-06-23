# Registry — Professional

> Focus: staff/principal-level decisions. A Registry is a name-to-implementation map with a registration ritual — trivial in isolation, load-bearing at scale. The hard parts are not `Register` and `Lookup`. They are: who owns the lifetime of a registered thing, what `dlopen` does to your address space, and what happens at 03:00 when one tenant's misconfigured `init()` brings down the global registry. Opinionated where the field agrees, explicit about trade-offs where it does not.

---

## 1. Registry as a system primitive

A Registry is *late binding by name*. The producer (registrant) and the consumer (looker-upper) share a string, not a type. That single decision is what differentiates the Registry from every adjacent pattern.

| Primitive | Binding time | Failure model | Typical use |
|---|---|---|---|
| Registry | Runtime, by name | Lookup miss = error or panic | "Pick a driver from config: `postgres`" |
| Service Locator | Runtime, by interface | Misses hide compile errors | "Give me whatever logger you have" |
| DI container | Construction time, by graph | Cycle = startup panic | "Inject `*UserSvc` into `*OrderSvc`" |
| Constructor injection | Compile time, explicit args | None — compile-time check | "`NewOrderSvc(userSvc, logger)`" |
| Plugin (`.so`/`.dll`) | Load time, by symbol | Missing symbol = `dlopen` error | "Load `auth_oidc.so` at boot" |
| Factory function | Compile time, generic | Compile-time | "`NewStore(cfg) *Redis`" |

Four distinctions matter:

1. **Type safety.** Constructor injection has it; Registry trades it for flexibility. A `Lookup("postgres")` returning the wrong interface is found at runtime, not by `go vet`.
2. **Discoverability.** A Registry permits `import _ "github.com/lib/pq"` — consumer doesn't know `pq` exists at compile time. This is the killer feature and the killer footgun.
3. **Lifetime.** Constructor injection lifetimes are lexical. Registry entries live for process lifetime — usually. Hot-reloadable registries break this and require versioning (§5).
4. **Multiplicity.** A DI container builds one graph. A Registry holds N implementations behind one namespace and selects per call.

The rule: **Registry when the choice is data-driven (config string, plugin file, tenant flag); constructor injection when the choice is code-driven.** Mixing the two — a DI container that resolves by string name — is a service locator, the anti-pattern of record.

---

## 2. Quantitative cost analysis

Go 1.22, amd64, Linux 6.6, 16-core box. Registry lookups appear in hot paths — every HTTP request, every gRPC call, every codec roundtrip.

### 2.1 Map lookup primitives

```
map[string]X read (hit)                    ~10 ns    (hash + 1 probe)
map[string]X read (miss)                   ~12 ns    (hash + bucket walk)
sync.RWMutex RLock + RUnlock (uncontended) ~20 ns
sync.RWMutex RLock contended (8 readers)   ~150 ns   (CAS retries)
sync.Map.Load (read-mostly hit)            ~8 ns     (atomic read of read map)
sync.Map.Load (in dirty map)               ~50 ns    (mutex; promotion)
sync.Map.Store (new key)                   ~200 ns   (locking + promotion)
atomic.Pointer[map] swap                   ~5 ns     (read); ~80 ns (CAS write)
```

A bare `map[string]X` lookup is **~10 ns**. Add `RWMutex` and you pay **~30 ns** uncontended, **~150 ns** with 8 concurrent readers. Noise against a 10 µs database query. But in a router consulted per request at 100 k req/s, the mutex traffic alone shows up on a flame graph.

### 2.2 sync.Map vs RWMutex

`sync.Map` is *not* a drop-in replacement. It's a specialised data structure with two costs:

| Workload | RWMutex+map | sync.Map | Winner |
|---|---|---|---|
| Write-heavy (50/50 read/write) | 50 ns/op | 400 ns/op | RWMutex |
| Read-mostly (100:1 reads) | 30 ns/op | 10 ns/op | sync.Map |
| Append-only (write once, read forever) | 20 ns/op | 8 ns/op | sync.Map |
| Many goroutines reading same key | RWLock contention | Atomic-free reads | sync.Map |
| `Range` over all entries | Cheap (single map iter) | Expensive (two maps + mutex) | RWMutex |
| `Len()` | Free | O(N) — `Range` and count | RWMutex |

Decision rule: **`sync.Map` for startup-write/runtime-read; `RWMutex+map` for everything else.** A driver registry (one `Register` per `init`, then `Lookup` forever) is the canonical `sync.Map` workload.

### 2.3 Hidden costs

- **Interface boxing on lookup.** Returning `Codec` instead of `*JSONCodec` allocates an `iface` header (~16 bytes) per call if escaping. Profile with `-gcflags="-m"`.
- **String hashing.** Long keys (`"com.example.codec.protobuf.v3"`) cost more than short ones (`"protobuf"`). Don't use full URIs as keys.
- **Allocation on `Names()`.** Fine for `/debug/registry`, terrible for a metric exporter polling every 10 s.

Summary: ~10–150 ns per lookup; cost matters only in hot paths. `sync.Map` for read-mostly steady state, `RWMutex` for write-heavy or `Range`-heavy. Profile before optimising.

---

## 3. Plugin systems — beyond `init()`

`init()` + blank import is the smallest plugin system: plugin is a package, registration is its `init()`, "loading" is compiling. Works for statically linked code. For *dynamically* loaded plugins, Go has several options, each with sharp edges.

### 3.1 `plugin` package (stdlib)

```go
p, err := plugin.Open("/opt/plugins/auth_oidc.so")
if err != nil { return err }
sym, err := p.Lookup("Register")
if err != nil { return err }
sym.(func())()
```

The hard truth:

| Property | Status |
|---|---|
| Linux/macOS support | Yes |
| Windows support | No (never will) |
| Plugin must match host's Go version | Exactly. Toolchain, module graph, build tags |
| `Close()` to unload | Not implemented; cannot unload |
| Symbol versioning | None |
| Cross-platform builds | Painful — CGO toolchain alignment |

Acceptable when you control both sides of the build and never need Windows. The moment a third party ships a `.so` built against a different `runtime`, the host segfaults inside `plugin.Open` with no recoverable error. **Avoid for anything you don't build yourself.**

### 3.2 `hashicorp/go-plugin` — RPC plugins

The mature answer for Go-native dynamic plugins. The plugin is a **separate process** speaking gRPC (or `net/rpc`) over a Unix socket. Properties: process-level isolation (plugin crash doesn't crash host), ~50 µs/call latency, ~10 MB per plugin process, built-in `ProtocolVersion` negotiation, cross-platform, hot-reloadable by killing the subprocess.

Terraform, Vault, Consul, Nomad, Packer all use this. The cost is real — 50 µs RPC vs 10 ns interface call — but you get crash isolation and ABI stability. **Default to `go-plugin` for any plugin crossing an organisational boundary.**

### 3.3 WASM plugins — wazero, extism

The modern answer. The plugin compiles to WebAssembly; the host runs it in an in-process sandbox with explicit memory and capability limits.

| Property | wazero (pure Go) | extism (CGO wrapper) |
|---|---|---|
| Cold start | ~1 ms | ~5 ms |
| Per-call overhead | ~10 µs | ~20 µs |
| Memory cap | Per-instance | Per-instance |
| Wall-clock deadline | Yes (`runtime.Context`) | Yes |
| Syscall access | None unless explicitly granted (WASI) | None |
| Languages | Anything that compiles to WASM | Same |

WASM trades 1000x latency (10 ns vs 10 µs) for **proof-by-construction safety**: a malicious plugin can't escape memory, can't make syscalls you didn't grant, can't exceed its budget. For multi-tenant SaaS that runs customer code, the only sane choice.

### 3.4 Decision matrix

| Need | Mechanism |
|---|---|
| Compile-time plugins, same team | `init()` + blank import |
| Dynamic load, you build both sides, Linux only | `plugin` |
| Dynamic load, third party, all OSes | `hashicorp/go-plugin` |
| Customer-supplied code, multi-tenant | WASM (wazero) |
| Plugin must be revoked at runtime | `go-plugin` or WASM |

---

## 4. Distributed registries — service discovery

When the things being registered live in other processes, the Registry becomes a **service discovery system** — same pattern, networked storage.

### 4.1 etcd, Consul, Kubernetes

```go
// etcd: register self
lease, _ := cli.Grant(ctx, 10) // 10s TTL
cli.Put(ctx, "/services/orders/"+instanceID, addr, clientv3.WithLease(lease.ID))
ch, _ := cli.KeepAlive(ctx, lease.ID) // heartbeat
go func() { for range ch {} }()
```

Local semantics break in distributed form:

| Local Registry | Distributed Registry |
|---|---|
| Register is in-process write | Network write to consensus store |
| Lookup is map read | Network read (cached locally) |
| Deregister is `delete` | TTL expiry or explicit revoke |
| Process crash leaves entry | Lease expiry removes entry eventually |
| Atomic | Eventually consistent |

Three pitfalls:

- **Stale entries.** A crashed instance's entry survives until lease expiry (10–30 s). Consumers consulting the registry in that window get black-hole connections. Mitigate with health checks, fast retries, circuit breakers.
- **Thundering herd on TTL expiry.** All consumers cache the entry; all see it expire simultaneously; all re-resolve. Add jitter to refresh.
- **Split brain.** etcd partitions; a minority partition can't write but serves stale reads. Bound read staleness explicitly.

### 4.2 gRPC and Kubernetes

gRPC's resolver/balancer interface *is* a Registry with pluggable backends. Built-in resolvers — `dns:///`, `passthrough:///`, `xds:///` — are `init()`-registered factories keyed by URI scheme. Custom resolvers (Consul, etcd, Kubernetes EndpointSlice) plug in under their own scheme.

Kubernetes `Service` + `EndpointSlice` is the largest deployed Registry in production: `Pod` registers (kubelet posts to API server), `Service` selects, kube-proxy and CoreDNS expose the result. Three properties: resolution is DNS (cache 5–30 s), the consistency window is seconds (1–10 s before a new pod is reachable after `Ready`), and watch streams are the right primitive for hot consumers (long-poll, don't re-poll).

---

## 5. Version evolution

A Registry's contract is its set of names. Names age. Adding, deprecating, and renaming registrations are deployment hazards.

### 5.1 Adding a registration

Safe — provided consumers handle `Lookup` misses for the old name gracefully. Roll the producer first, then consumers. Old binaries continue to work because they don't know about the new name.

### 5.2 Deprecating a registration

Three-phase rollout, mandatory:

1. **Announce.** Log a `WARN` on every `Lookup("old_name")`. Stay here one release cycle minimum.
2. **Forward.** Make `old_name` an alias for the new implementation. Add a Prometheus counter.
3. **Remove.** Only when the counter has been zero for at least two release cycles across all environments.

Skipping any of these breaks a consumer you don't know about. Blast radius scales with the number of services consulting the registry.

### 5.3 Schema-bound registries

A flat `name → impl` namespace breaks under versioning. The key becomes `(name, version)`:

```go
func (r *Registry) Lookup(name string, constraint semver.Range) (Impl, error) {
    for _, c := range r.byName[name] {
        if constraint(c.Version) { return c.Impl, nil }
    }
    return nil, ErrNoSatisfyingVersion
}
```

Consumers say `Lookup("codec", "^2.0")` and the registry picks the highest compatible. This is how Protobuf, gRPC, and Kubernetes API groups evolve. Use `golang.org/x/mod/semver`; don't write the constraint solver yourself.

### 5.4 Schema-as-contract

For codec and serializer registries, the *schema* (Protobuf, Avro, JSON Schema) is the durable artifact. The registry stores `(schema_id) → schema` and `(message_type) → schema_id`. Confluent's Schema Registry is this pattern as a service. Schemas are immutable once published; new versions get new IDs.

---

## 6. Multi-tenancy

The textbook Registry is a singleton. A multi-tenant service cannot have a singleton.

### 6.1 Per-tenant registries

```go
type Registries struct {
    mu       sync.RWMutex
    byTenant map[TenantID]*Registry
}

func (rs *Registries) For(tenant TenantID) *Registry {
    rs.mu.RLock(); r, ok := rs.byTenant[tenant]; rs.mu.RUnlock()
    if ok { return r }
    rs.mu.Lock(); defer rs.mu.Unlock()
    if r, ok := rs.byTenant[tenant]; ok { return r }
    r = NewRegistry()
    rs.byTenant[tenant] = r
    return r
}
```

Hard cases:

- **Tenant ID propagation.** Every `Lookup` needs the tenant. Cleanest: tenant lives in `context.Context`, `Lookup` takes `ctx`. The smelly alternative — passing tenant as a parameter everywhere — turns every signature into a tenant-laundering operation.
- **Shared defaults.** Tenant overrides layered over a global default:

```go
func (r *TenantRegistry) Lookup(name string) (Impl, error) {
    if i, ok := r.overrides[name]; ok { return i, nil }
    return globalRegistry.Lookup(name)
}
```

- **Cleanup.** Tenants churn; without a deregistration policy, the per-tenant map grows monotonically. Tie tenant lifecycle to a closeable handle.

### 6.2 Namespace isolation & ACLs

For a Registry holding *user-supplied* names (webhook subscribers, FaaS functions), names must be namespaced and access-controlled:

| Concern | Mechanism |
|---|---|
| Namespace collision | Prefix with tenant ID: `tenant_123/handlers/onPayment` |
| Cross-tenant read | `Lookup` enforces tenant from `ctx` |
| Registration auth | `Register` requires a capability checked against ACL |
| Quota | Per-tenant entry count cap |
| Audit | Every `Register`/`Deregister` emits a structured log |

Mistakes here are bugs and exfiltration vectors simultaneously. **Lookup must be tenant-scoped or it's not multi-tenant; it's broken.**

---

## 7. Observability

A Registry is invisible until it isn't. The day you debug "why isn't this codec working" you'll wish you had logged registrations.

### 7.1 Audit log

Every mutation is a structured log line:

```go
func (r *Registry) Register(name string, impl Impl) error {
    r.mu.Lock(); defer r.mu.Unlock()
    if _, dup := r.entries[name]; dup {
        slog.Warn("registry.duplicate", "name", name, "caller", caller())
        return ErrDuplicate
    }
    r.entries[name] = impl
    slog.Info("registry.register", "name", name, "type", fmt.Sprintf("%T", impl))
    return nil
}
```

At startup, dump full contents at INFO. A 30-line "here are the 47 codecs loaded" has saved more hours than any test.

### 7.2 Prometheus metrics

| Metric | Type | Why |
|---|---|---|
| `registry_entries{registry,name}` | Gauge | Active registrations; alert on unexpected drop |
| `registry_lookup_total{registry,outcome}` | Counter | Hit/miss/error |
| `registry_lookup_duration_seconds` | Histogram | Slow-lookup detection |
| `registry_register_total{registry,outcome}` | Counter | Registrations over time; spike = bug |
| `registry_deprecated_lookup_total{name}` | Counter | Drives deprecation timeline |

Most actionable: `registry_lookup_total{outcome="miss"}`. A non-zero miss rate means a consumer is asking for something not registered — config bug or deploy ordering bug. Alert on it.

### 7.3 Slow-lookup detection

For hot-path registries, percentile latency catches contention before users do. A regression from p99=50 ns to p99=2 µs is invisible to the eye but loud in a histogram. Dump goroutine stacks when a single lookup exceeds 100 µs — that's not a lookup, that's a mutex queue.

---

## 8. Failure modes

The Registry's worst failure modes are not data-loss; they are process-loss.

### 8.1 Segfault in `plugin.Open`

A `.so` built against a different `runtime` package corrupts the host's memory layout. The host segfaults inside `plugin.Open` with no `error` returned — SIGSEGV bypasses Go's error path. Mitigation:

| Defence | Effect |
|---|---|
| Pin Go toolchain + module graph between host and plugin | Eliminates the cause |
| Wrap `plugin.Open` in a subprocess (a tiny "loader" binary) | Subprocess crashes; host survives |
| Use `go-plugin` instead | Process-level isolation by construction |
| Sign and verify plugin binary | Refuses unknown blobs |

**`plugin.Open` in the main binary is a foot-cannon. Never run it on untrusted input.**

### 8.2 Panic during `init()`

`init()` panics crash the program before `main()` runs. Common causes: `Register` panics on duplicate, missing config file, init-time probe of a dependent service.

```go
// BAD — init panics if env missing, blocks process on network
func init() {
    addr := os.Getenv("DB_URL")
    if addr == "" { panic("DB_URL required") }
    db := mustConnect(addr)            // network in init: disaster
    Register("primary", db)
}
```

Rules:

| Rule | Why |
|---|---|
| `init()` makes no network calls | Process must start when dependencies are down |
| `init()` reads no files (except embedded) | Same |
| `init()` does no work proportional to input | Startup time is a feature |
| `init()` panics only on programmer errors | Operational errors are runtime errors |
| Cross-package ordering goes in `main()` | `init()` order is fragile |

### 8.3 OOM from unbounded registrations

A registry that accepts user input as keys (subscriber, webhook target) grows without bound. 10 M entries × 200 bytes = 2 GB before you noticed. Defences: per-tenant quota (§6.1), TTL with a background sweeper, LRU eviction under memory pressure, byte-accounted hard cap.

### 8.4 Deadlock during hot reload

Hot reload looks like:

```go
func Reload() {
    r.mu.Lock(); defer r.mu.Unlock()
    newEntries := loadFromDisk()      // blocking I/O while holding write lock
    for _, e := range newEntries {
        if old, ok := r.entries[e.Name]; ok {
            old.Close()                // may re-enter r.mu → deadlock
        }
        r.entries[e.Name] = e.Impl
    }
}
```

Two patterns avoid this:

- **Copy-on-write.** Build the new map outside the lock; `atomic.Pointer[map[string]Impl]` swap. Old map garbage-collected when no reader holds a reference. Zero read contention, no deadlock.
- **Two-phase reload.** Phase 1 outside the lock: load and validate. Phase 2 under the lock: map mutations only — no `Close()`, no I/O. Close old impls after release.

---

## 9. Security

A Registry that loads code from disk is a malware ingestion vector if unguarded.

### 9.1 Plugin signing

Every plugin binary must be signed by a key the host trusts. Verify before `Open`:

```go
func loadPlugin(path string) (*plugin.Plugin, error) {
    if err := verifySignature(path, trustedKey); err != nil {
        return nil, fmt.Errorf("unsigned plugin %s: %w", path, err)
    }
    return plugin.Open(path)
}
```

Sigstore/cosign, OS code signing (Apple notarization, Windows Authenticode), or a private PKI with `crypto/ed25519` all work. The point: *some* cryptographic provenance check before loading executable code.

### 9.2 Sandboxing

For untrusted plugins, sandboxing is not optional. Choice follows threat model:

| Threat | Sandbox |
|---|---|
| Buggy plugin crashes host | `go-plugin` (process isolation) |
| Plugin exfiltrates secrets via syscalls | WASM with no WASI imports |
| Plugin consumes unbounded CPU | WASM with deadline; `go-plugin` with cgroup |
| Plugin reads filesystem | WASM with no FS; subprocess with chroot/landlock |
| Plugin makes outbound network | WASM with no sockets; subprocess with seccomp |

In-process Go offers *no* security boundary. A "plugin" that's a `func` registered via `init()` shares the host's trust domain. **Do not call this a sandbox.**

### 9.3 Supply-chain attacks via `init()`

The highest-leverage attack on the Registry pattern. A malicious module's `init()` runs the moment you `import _` it. It can hit a C2 server, replace registered implementations with backdoored ones, hook `os.Exit` to exfiltrate before shutdown, or tamper with `sql.Register` to intercept every database call.

Defences:

| Defence | What it stops |
|---|---|
| `go mod verify` + `go.sum` | Tampered module cache |
| Pin dependencies to commit SHAs | Surprise updates |
| `govulncheck` in CI | Known-vulnerable versions |
| Audit `init()` in third-party modules | Unexpected side effects |
| Static analysis: forbid network in `init()` | New side-effect introduction |

**Treat every `import _ "third/party/driver"` as a code-execution grant.** Audit accordingly.

---

## 10. Testing

Registries are global state. Global state is hostile to tests. The fix is to treat the registry as injectable.

### 10.1 Fixture registries

```go
// Instead of:
codec.Register("test", &fakeCodec{})    // pollutes global state across tests

// Do:
func TestEncoder(t *testing.T) {
    r := codec.NewRegistry()
    r.Register("test", &fakeCodec{})
    enc := NewEncoder(r)                // dependency injected
    // ...
}
```

When you can't refactor the global away (it's in a third-party package), `t.Cleanup` undoes the damage:

```go
codec.Register("test", &fakeCodec{})
t.Cleanup(func() { codec.Deregister("test") }) // requires Deregister; add it
```

### 10.2 Table-driven tests against registry contents

For a registry of policies, validators, or codecs, table-driven tests over every registered entry catch regressions:

```go
func TestEveryCodecRoundTrips(t *testing.T) {
    for _, name := range codec.Names() {
        t.Run(name, func(t *testing.T) {
            c, _ := codec.Get(name)
            payload := canonicalPayload(t, name)
            enc, err := c.Encode(payload); require.NoError(t, err)
            dec, err := c.Decode(enc);      require.NoError(t, err)
            require.Equal(t, payload, dec)
        })
    }
}
```

A codec added by another team automatically gets tested. The contract is enforced by the registry itself.

### 10.3 Golden files for registry contents

When registry contents *are* the public API (CLI subcommands, HTTP routes, gRPC services), a golden test catches accidental additions, removals, renames:

```go
func TestRoutesGolden(t *testing.T) {
    got := strings.Join(routes.Names(), "\n")
    if *update { os.WriteFile("testdata/routes.golden", []byte(got), 0644); return }
    want, _ := os.ReadFile("testdata/routes.golden")
    require.Equal(t, string(want), got)
}
```

Renaming a route becomes a deliberate, reviewable diff.

---

## 11. Anti-patterns at scale

| Anti-pattern | Symptom | Fix |
|---|---|---|
| God Registry: one global for everything | Test isolation impossible; lifetimes opaque | Per-domain registries; scoped instances |
| `init()` side effects beyond `Register` | Process won't start when DB is down | `init()` only mutates in-memory state |
| Registry as DI container | Service locator smell; deps invisible at call site | Constructor injection for code-driven choices |
| Dynamic registration in hot path | Mutex contention; latency spikes | Register at startup; lock-free reads after |
| `Lookup` returns `(impl, bool)` then panics on `false` | Production crashes on missing config | Return `(impl, error)`; callers handle |
| String keys with typos | Silent miss; wrong impl used | Constants in a single file; lint unknown keys |
| `sync.Map` for write-heavy workload | Worse than `RWMutex`; allocations | Benchmark; choose deliberately |
| Plugin `.so` from world-writable directory | Code execution by any local user | Path validation, signing, restrictive perms |
| Hot reload with `mu.Lock()` during I/O | Reads stall for seconds | Copy-on-write with atomic pointer |
| Cross-tenant lookup on shared registry | Data leak; tenant A sees tenant B's impls | Per-tenant scoping enforced at `Lookup` |
| Names without a versioning policy | Renaming a codec breaks persisted data | Treat names as wire protocol; deprecate, don't remove |
| Registry contents not logged at startup | "Why isn't X working" takes hours to debug | Dump contents at INFO on boot |
| `Lookup` returns mutable concrete struct | Caller mutates; surprises everyone | Return interface; treat result as immutable |

The deepest anti-pattern: **using Registry where constructor injection would do**. A package with one `Logger` doesn't need `logger.Register`/`logger.Lookup("default")`. It needs `NewService(logger)`. Registry is for cases where the *consumer cannot know* which implementation it will get. If the consumer always picks the same one, Registry is ceremony.

---

## 12. Closing principles

A Registry is *late binding by name*. The pattern is unavoidable in any plugin-shaped system. The defining trade is **static safety for runtime flexibility** — sometimes correct, often unnecessary.

1. **Make the trade deliberately.** Drivers, codecs, plugins, routes — yes. Services with one implementation — no. The `import _` line commits that the consumer cannot know which implementation it gets. If the consumer always picks the same one, you wanted constructor injection.

2. **`map[string]X` + `RWMutex` is the default.** ~30 ns/lookup uncontended. `sync.Map` only for read-mostly registries where benchmarks justify it. `atomic.Pointer[map]` swap for hot-reload to eliminate read contention. Profile; don't speculate.

3. **`init()` is for in-memory registration, nothing else.** No network, no disk, no panics except on programmer error. A process that won't start because etcd is down is unrecoverable; a process that starts and reports `Lookup` errors at runtime is debuggable.

4. **Lookup misses are errors, not panics.** Return `(impl, error)`. Panic on `Register` only for programmer errors (duplicate, nil); never on `Lookup`.

5. **Plugins cross trust boundaries; in-binary registries do not.** `init()` + blank import is a build-time decision. `plugin.Open` is a runtime code-execution grant. `go-plugin` and WASM exist because once code came from somewhere else, isolation is mandatory.

6. **Distributed registries are eventually consistent.** Stale entries between crash and lease expiry are guaranteed; consumer-side health checks and circuit breakers absorb the gap.

7. **Multi-tenant means scoped.** A global registry in a multi-tenant service is a data-leak primitive. Tenant lives in `ctx`; `Lookup` derives namespace from `ctx`.

8. **Observability is non-optional.** Startup dump, audit log per registration, metrics on entries/lookups/misses. Build this on day one.

9. **Versioning is the registry's contract.** Names are wire protocol. Renaming, removing, or repurposing a name breaks every consumer. Deprecate over three releases; remove only when telemetry shows zero use.

10. **Test against the registry, not around it.** Table-driven tests over `Names()` catch new entries automatically. Golden files lock the public surface. Fixture registries replace globals with injectable instances.

Get these right and the Registry is invisible: drivers register, consumers look up by name, plugins extend behavior without breaking the build. Get them wrong and the on-call incident is a customer plugin segfaulting in `plugin.Open`, an `init()` panicking because etcd is down, a hot-reload deadlocking under load, and a multi-tenant lookup returning the wrong tenant's webhook target. **Registry is the easiest pattern to write and one of the easiest to operate carelessly.** Late binding by name is power; treat names as the contract they are.

---

## Further reading

- `database/sql` source — canonical implementation registry in the standard library
- HashiCorp `go-plugin` source — production-grade RPC plugin host
- Tetrate `wazero` — pure-Go WebAssembly runtime for in-process sandboxed plugins
- gRPC-Go `resolver`/`balancer` — Registry as wire-protocol abstraction
- etcd `clientv3` lease and watch APIs — distributed registry primitives
- Kubernetes `client-go` Informer pattern — long-poll registry consumer
- Sigstore/cosign — code signing for plugin binaries
- Russ Cox, *Our Software Dependency Problem* — supply-chain attack surface of `import _`
- Mat Ryer, *Go programming patterns* — pluggable architectures and registries
- Sam Newman, *Building Microservices*, chapter on service discovery
