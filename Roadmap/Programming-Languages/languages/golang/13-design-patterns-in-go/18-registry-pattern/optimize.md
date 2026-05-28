# Registry — Optimization

## 1. How to use this file

Twelve scenarios where Registry code is slower, allocates more, or scales worse than it should. Each entry has a **Before** (code + benchmark) and a collapsible **After** (optimized code + benchmark + why + trade-offs + when NOT).

Anchored at Go 1.23, amd64. Numbers are reproducible-shape — run `go test -bench=. -benchmem` on your hardware before quoting them. Registry cost is dominated by four things: lock contention on the read path, map key hashing, interface boxing, and reflect-based key construction. Most wins remove one of those four from the hot path.

Reading order: Exercise 1 (RWMutex → sync.Map), 3 (atomic.Pointer), 5 (typed generic), then the rest in any order. Exercises 7, 8, 10 are the ones most senior code reviews flag.

---

## 2. Exercise 1 — RWMutex contention on a hot read path

A codec registry guards `map[string]Codec` with `sync.RWMutex`. At startup it's fine. Under sustained read load on a hot path (handler resolves a codec per request), `RLock`/`RUnlock` pays two atomic RMW ops per call. Above ~1M reads/sec across cores, the RWMutex's internal `readerCount` becomes a cache-line ping.

**Before:**

```go
type Registry struct {
    mu sync.RWMutex
    m  map[string]Codec
}
func (r *Registry) Get(name string) (Codec, bool) {
    r.mu.RLock(); c, ok := r.m[name]; r.mu.RUnlock()
    return c, ok
}
```

```
BenchmarkRWMutexGet-8           20000000      78 ns/op    0 B/op  0 allocs/op
BenchmarkRWMutexGet_Parallel-8  10000000     180 ns/op    0 B/op  0 allocs/op  // 8 cores
```

<details><summary>After</summary>

`sync.Map` for read-mostly, scattered-write workloads. Reads on a stable key skip the mutex entirely after the first store.

```go
type Registry struct{ m sync.Map } // map[string]Codec

func (r *Registry) Register(name string, c Codec) { r.m.Store(name, c) }

func (r *Registry) Get(name string) (Codec, bool) {
    v, ok := r.m.Load(name)
    if !ok { return nil, false }
    return v.(Codec), true
}
```

```
BenchmarkSyncMapGet-8           50000000      28 ns/op    0 B/op  0 allocs/op
BenchmarkSyncMapGet_Parallel-8  40000000      35 ns/op    0 B/op  0 allocs/op
```

~2.8× faster single-thread, ~5× contended.

**Why faster:** `sync.Map.Load` on a key in its `read` half is a single atomic pointer load of the read-only snapshot, then a plain map lookup — no per-call atomic write. RWMutex always pays `readerCount` add/sub even when uncontended.

**Trade-off:** ~80 B per entry (vs ~16 B in `map`); awkward `Range`-only iteration; type assertion per `Load`.

**When NOT:** Write-heavy registries (hot-swap per request). Ordered iteration needed. Tiny entry counts (≤16) where `RWMutex+map` is smaller in cache footprint.
</details>

---

## 3. Exercise 2 — String key hash on the hot path

Every `Get("postgres")` hashes the string. Go's map uses AES-NI string hash where available — fast, but O(len(key)). For 24-char keys called millions of times per second, hash plus equality adds up.

**Before:**

```go
var codecs = map[string]Codec{}
func Get(name string) (Codec, bool) {
    c, ok := codecs[name] // hash + memcmp
    return c, ok
}
// Hot path: Get("application/vnd.company.v3+json") per request
```

```
BenchmarkStringKeyGet-8       40000000     34 ns/op    0 B/op  0 allocs/op  // 32-char key
```

<details><summary>After</summary>

For closed, compile-time-known sets, assign each value a small integer ID and key by ID. Resolve name→ID once at the parse boundary.

```go
type CodecID uint16

const (
    CodecJSON CodecID = iota
    CodecMsgpack
    CodecProtobuf
    CodecYAML
)

var codecsByID [256]Codec // dense array

func Register(id CodecID, c Codec) { codecsByID[id] = c }
func Get(id CodecID) (Codec, bool) {
    if int(id) >= len(codecsByID) { return nil, false }
    c := codecsByID[id]
    return c, c != nil
}
func ResolveID(name string) (CodecID, bool) { id, ok := nameToID[name]; return id, ok }
```

```
BenchmarkIDKeyGet-8         500000000    2.1 ns/op    0 B/op  0 allocs/op
```

~16× faster.

**Why faster:** Array indexing is one bounds check + one load. No hash, no equality, no map bucket walk. 256-entry pointer array fits in 2 KB.

**Trade-off:** Closed set — new codec needs an enum constant. Name→ID map still exists, but called once per request, not per encode loop.

**When NOT:** Open registries where third-party packages register by string via `init()`. Unbounded key alphabet (tenant names, dynamic plugin IDs).
</details>

---

## 4. Exercise 3 — Mutex per Get for a read-mostly registry

A registry mutated at startup and read forever after still pays a mutex on every read "just in case". For startup-only registries, the read should be lock-free.

**Before:**

```go
type Registry struct {
    mu sync.Mutex
    m  map[string]Handler
}
func (r *Registry) Get(name string) (Handler, bool) {
    r.mu.Lock(); defer r.mu.Unlock()
    h, ok := r.m[name]
    return h, ok
}
```

```
BenchmarkMutexGet-8           30000000     45 ns/op   0 B/op  0 allocs/op
BenchmarkMutexGet_Parallel-8   5000000    280 ns/op   0 B/op  0 allocs/op  // serialized
```

<details><summary>After</summary>

Copy-on-write via `atomic.Pointer[map]`. Writes build a new map and CAS-publish. Reads do a single atomic pointer load — no lock, no contention scaling problem.

```go
type Registry struct {
    m       atomic.Pointer[map[string]Handler]
    writeMu sync.Mutex // serialize writers only
}

func NewRegistry() *Registry {
    r := &Registry{}
    empty := map[string]Handler{}
    r.m.Store(&empty)
    return r
}
func (r *Registry) Register(name string, h Handler) {
    r.writeMu.Lock(); defer r.writeMu.Unlock()
    old := r.m.Load()
    next := make(map[string]Handler, len(*old)+1)
    for k, v := range *old { next[k] = v }
    next[name] = h
    r.m.Store(&next)
}
func (r *Registry) Get(name string) (Handler, bool) {
    h, ok := (*r.m.Load())[name]
    return h, ok
}
```

```
BenchmarkAtomicMapGet-8           100000000     11 ns/op   0 B/op  0 allocs/op
BenchmarkAtomicMapGet_Parallel-8  100000000     12 ns/op   0 B/op  0 allocs/op  // scales perfectly
```

~4× faster single-thread, ~23× contended.

**Why faster:** `atomic.Pointer.Load` is a single MOV on amd64 — no atomic RMW. Readers never block writers or each other. Pointer's cache line is shared-read.

**Trade-off:** Every `Register` copies the entire map (O(N) work and garbage). For 1000-entry registries with 10 startup registrations, that's 10× the steady-state allocated and freed — acceptable. For continuous registration, see Ex. 9.

**When NOT:** Write-heavy registries. Huge maps (10k+) with non-startup registration. When `Delete` reclaim semantics matter — COW keeps old maps alive until no reader holds them.
</details>

---

## 5. Exercise 4 — Linear scan to match a key

A pattern-matching router scans a slice of `(prefix, handler)` to find the longest prefix match. O(N) per request — 50 routes × 10k QPS is 500k comparisons/sec.

**Before:**

```go
type Route struct{ Prefix string; H Handler }
var routes []Route

func Lookup(path string) (Handler, bool) {
    var best Route; var bestLen int
    for _, r := range routes {
        if strings.HasPrefix(path, r.Prefix) && len(r.Prefix) > bestLen {
            best, bestLen = r, len(r.Prefix)
        }
    }
    if bestLen == 0 { return nil, false }
    return best.H, true
}
```

```
BenchmarkLinearScan-8       2000000     680 ns/op   0 B/op   0 allocs/op  // 50 routes
```

<details><summary>After</summary>

For *exact* match, use a plain `map[string]Handler`. For *prefix* match, a trie or Go 1.22+ `ServeMux` (radix tree).

```go
var exact = map[string]Handler{}
func Lookup(path string) (Handler, bool) { h, ok := exact[path]; return h, ok }

// Or, for prefix routing in 1.22+:
mux := http.NewServeMux()
mux.HandleFunc("/api/v1/", v1Handler)
mux.HandleFunc("/api/v2/", v2Handler)
```

```
BenchmarkExactMap-8        40000000      30 ns/op   0 B/op   0 allocs/op
BenchmarkServeMux1_22-8    10000000     110 ns/op   0 B/op   0 allocs/op  // trie walk
```

~22× faster (exact) or ~6× (trie).

**Why faster:** Map lookup is O(1) amortized. Trie is O(len(path)). Linear scan is O(N×L).

**Trade-off:** Exact map requires caller-side path normalization (trailing slashes, case). Trie has higher construction cost — paid at startup.

**When NOT:** Sub-10 route count where linear scan fits a cache line and beats the map hash. Wildcard/regex routes need a compiled matcher, not a registry.
</details>

---

## 6. Exercise 5 — Interface boxing on every Get

A generic registry stores values as `any`. Every consumer asserts to a single concrete `Codec`, but every `Get` returns an iface header (16 B) and the consumer pays a type-assertion check.

**Before:**

```go
type Registry struct{ m sync.Map } // map[string]any
func (r *Registry) Get(name string) (Codec, bool) {
    v, ok := r.m.Load(name)
    if !ok { return nil, false }
    return v.(Codec), true
}
```

```
BenchmarkAnyRegistryGet-8     30000000     40 ns/op    0 B/op  0 allocs/op
```

<details><summary>After</summary>

Generic `Registry[T]`. Compiler monomorphizes — `Get` returns concrete `T`.

```go
type Registry[T any] struct{ m sync.Map } // map[string]T

func (r *Registry[T]) Register(name string, v T) { r.m.Store(name, v) }
func (r *Registry[T]) Get(name string) (T, bool) {
    v, ok := r.m.Load(name)
    if !ok { var z T; return z, false }
    return v.(T), true
}

var codecs = &Registry[Codec]{}
```

```
BenchmarkTypedRegistryGet-8   40000000     32 ns/op    0 B/op  0 allocs/op
```

~25% faster, and the assertion happens once per call site instead of every call.

**Why faster:** Direct return of `T` skips iface header materialization on the value side. Internal assertion is branch-predictor-friendly: one type per registry instance.

**Trade-off:** One `Registry[T]` instantiation per stored type. Five registries → ~10-30 KB binary growth. Negligible.

**When NOT:** Registries that genuinely store heterogeneous types (event dispatcher with one handler signature per event). There you need `any` plus a dispatch table.
</details>

---

## 7. Exercise 6 — `reflect.Type` key allocation per call

A handler registry keyed by `reflect.TypeOf(payload)`. The `reflect.Type` itself is interned, but the iface boxing of the payload (to call `TypeOf`) can escape it to heap. The hash of a `reflect.Type` is fast (pointer compare), but the indirection through `any` is the real cost.

**Before:**

```go
var handlers = map[reflect.Type]Handler{}
func Register(payload any, h Handler) { handlers[reflect.TypeOf(payload)] = h }
func Dispatch(payload any) error {
    h, ok := handlers[reflect.TypeOf(payload)]
    if !ok { return errNoHandler }
    return h(payload)
}
Dispatch(UserCreated{ID: 7}) // UserCreated escapes via 'any'
```

```
BenchmarkReflectDispatch-8    8000000    180 ns/op    48 B/op   2 allocs/op
```

<details><summary>After</summary>

Key by a stable string name carried on the event itself.

```go
type Event interface{ EventName() string }
var handlers = map[string]Handler{}

func Register(name string, h Handler) { handlers[name] = h }
func Dispatch(e Event) error {
    h, ok := handlers[e.EventName()]
    if !ok { return errNoHandler }
    return h(e)
}
func (UserCreated) EventName() string { return "user.created" }
```

```
BenchmarkStringDispatch-8     20000000     58 ns/op    0 B/op   0 allocs/op
```

~3× faster, no allocations.

**Why faster:** No `reflect.TypeOf`, no iface boxing of the concrete payload via `any`. Wire-stable identifier survives struct renames.

**Trade-off:** Each event type carries a method. Stable names need a registration contract — usually a feature.

**When NOT:** In-process only, anonymous structs, or when consumers genuinely want reflect-type identity (a generic JSON decoder picking a constructor by Go type).
</details>

---

## 8. Exercise 7 — Per-call `Names()` rebuild

A debug endpoint hits `Registry.Names()` per request. Each call locks, iterates, allocates, sorts. 100 QPS on a 500-entry registry is 50k entries/sec of churn for a static answer.

**Before:**

```go
func (r *Registry) Names() []string {
    r.mu.RLock(); defer r.mu.RUnlock()
    out := make([]string, 0, len(r.m))
    for k := range r.m { out = append(out, k) }
    sort.Strings(out)
    return out
}
```

```
BenchmarkNamesRebuild-8     100000    14000 ns/op    8200 B/op   2 allocs/op  // 500 entries
```

<details><summary>After</summary>

Cache the sorted slice with a version counter. Invalidate on write, rebuild lazily on first read.

```go
type Registry struct {
    mu      sync.RWMutex
    m       map[string]Codec
    version atomic.Uint64
    cached  atomic.Pointer[cachedNames]
}
type cachedNames struct{ version uint64; names []string }

func (r *Registry) Register(name string, c Codec) {
    r.mu.Lock(); r.m[name] = c; r.version.Add(1); r.mu.Unlock()
}
func (r *Registry) Names() []string {
    v := r.version.Load()
    if c := r.cached.Load(); c != nil && c.version == v { return c.names }
    r.mu.RLock()
    out := make([]string, 0, len(r.m))
    for k := range r.m { out = append(out, k) }
    r.mu.RUnlock()
    sort.Strings(out)
    r.cached.Store(&cachedNames{version: v, names: out})
    return out
}
```

```
BenchmarkNamesCached-8             200000000     6 ns/op    0 B/op  0 allocs/op  // cache hit
BenchmarkNamesCached_AfterWrite-8     100000  14500 ns/op  8200 B/op  2 allocs/op
```

~2300× faster on cache hits.

**Why faster:** Steady state: a single atomic load + compare + return. No iteration, no sort, no allocation.

**Trade-off:** Returned slice is shared. Document "do not mutate" or return a defensive copy at sub-µs cost. Cached slice keeps strings alive — fine for registry names.

**When NOT:** Write-heavy registries where the cache is invalidated faster than it's used. Defensive-copy-per-call security boundaries.
</details>

---

## 9. Exercise 8 — Lookup repeated in a tight loop

A hot encoding loop calls `codecs.Get("json")` per item. Even at 30 ns/op, 1M items/sec spends 30 ms/sec in the registry. The codec doesn't change — the loop re-looks-up every iteration.

**Before:**

```go
for _, item := range items {
    c, ok := codecs.Get("json")
    if !ok { return errNoCodec }
    b, err := c.Encode(item)
    if err != nil { return err }
    out = append(out, b)
}
```

```
BenchmarkLookupInLoop-8     50000    24000 ns/op  // 1000 items, includes work
```

<details><summary>After</summary>

Hoist the lookup.

```go
c, ok := codecs.Get("json")
if !ok { return errNoCodec }
for _, item := range items {
    b, err := c.Encode(item)
    if err != nil { return err }
    out = append(out, b)
}
```

```
BenchmarkLookupHoisted-8    100000    14000 ns/op  // ~1.7× faster overall
```

In an HTTP server, hoist further: resolve at request parse time, stash on a parsed-request struct; handler never touches the registry.

**Why faster:** Trivial — one lookup instead of N. The point isn't the win but that registries are *easy to overuse* because they look free. Mid-level reviews catch loop-internal lookups.

**Trade-off:** If the key varies per iteration, you can't hoist. For loops where keys cluster (event types, batched routes), cache the prior result (`lastKey`, `lastCodec`) — 90%+ hit rate on clustered traffic.

**When NOT:** Per-iteration variable key with no clustering. Outside hot paths where one lookup amortizes over plenty of work.
</details>

---

## 10. Exercise 9 — Hot-reload copies O(N) per Register

A plugin manager re-registers all plugins every 30s. Each `Register` triggers a full COW (Ex. 3). 200 plugins × O(N) per call = O(N²) reload.

**Before:**

```go
func (r *Registry) Register(name string, p Plugin) {
    r.writeMu.Lock(); defer r.writeMu.Unlock()
    old := r.m.Load()
    next := make(map[string]Plugin, len(*old)+1)
    for k, v := range *old { next[k] = v }
    next[name] = p
    r.m.Store(&next)
}
for name, p := range newPlugins { registry.Register(name, p) } // reload
```

```
BenchmarkReloadNaive-8      // ~8 ms wall time for 200 plugins, 32 MB garbage
```

<details><summary>After</summary>

Diff-based merge. Build the next map once from `old + delta`, store once.

```go
func (r *Registry) RegisterAll(updates map[string]Plugin, removed []string) {
    r.writeMu.Lock(); defer r.writeMu.Unlock()
    old := r.m.Load()
    next := make(map[string]Plugin, len(*old)+len(updates))
    for k, v := range *old { next[k] = v }
    for _, k := range removed { delete(next, k) }
    for k, v := range updates { next[k] = v }
    r.m.Store(&next)
}
```

```
BenchmarkReloadBulk-8       // ~40 µs for 200 plugins, 160 KB garbage
```

~200× faster reload, ~200× less garbage.

**Why faster:** One base-map copy, one Store. Naive was N copies — quadratic for a linear logical change.

**Trade-off:** Bulk reload is atomic — all-or-nothing visible. Per-Register made additions incrementally visible (a reader might see plugin #50 missing while #1-49 land). Usually a feature.

**When NOT:** When registrations genuinely arrive one at a time over a long period. When per-registration ordering matters for an audit log.
</details>

---

## 11. Exercise 10 — Mutex-guarded read in handler hot path

A request handler does `registry.Get(name)` under a mutex per request. p99 rises with concurrent requests because mutex acquisition serializes.

**Before:**

```go
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    name := r.Header.Get("X-Codec")
    h.registry.mu.RLock(); c, ok := h.registry.m[name]; h.registry.mu.RUnlock()
    if !ok { http.Error(w, "no codec", 400); return }
    // ... encode response with c
}
```

```
BenchmarkHandlerWithMutex-8       // p50 = 80 µs, p99 = 4 ms at 4000 QPS
```

<details><summary>After</summary>

Lock-free check via `atomic.Pointer[map]` (Ex. 3). One atomic load, one map lookup, no lock.

```go
// Registry uses atomic.Pointer[map[string]Codec] (Ex. 3)
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    name := r.Header.Get("X-Codec")
    c, ok := (*h.registry.m.Load())[name]
    if !ok { http.Error(w, "no codec", 400); return }
    // ... encode response with c
}
```

```
BenchmarkHandlerAtomic-8          // p50 = 65 µs, p99 = 220 µs at 4000 QPS
```

~18× better p99.

**Why faster:** Removes the serialization point. With 4000 concurrent goroutines, mutex acquisition is the bottleneck even when the critical section is < 100 ns — Amdahl's Law.

**Trade-off:** As in Ex. 3, writes copy the map. For startup-only registries, free. For mutating ones, reload window has higher write cost — acceptable since reloads are rare.

**When NOT:** Single-threaded handlers (rare). Genuinely write-heavy registries where reads are cold.
</details>

---

## 12. Exercise 11 — Init-time registration with N items

A vendored library calls `Register(name, impl)` once per plugin in `init()`. With 300 plugins, init runs 300 individual registrations — each takes the lock, each inserts into the map (with rehashes on growth). Startup is 30 ms when it should be 0.5 ms.

**Before:**

```go
func init() {
    plugin.Register("compress.gzip", &gzipPlugin{})
    plugin.Register("compress.snappy", &snappyPlugin{})
    plugin.Register("compress.zstd", &zstdPlugin{})
    // ... 297 more
}
```

```
// Startup profile: 30 ms in plugin.Register
```

<details><summary>After</summary>

Bulk register. Define entries as a slice/map literal, register once.

```go
var allPlugins = map[string]Plugin{
    "compress.gzip":   &gzipPlugin{},
    "compress.snappy": &snappyPlugin{},
    "compress.zstd":   &zstdPlugin{},
    // ...
}

func init() { plugin.RegisterAll(allPlugins, nil) }
```

```
// Startup profile: 400 µs in plugin.RegisterAll
```

~75× faster init.

**Why faster:** One lock, one map allocation sized for final count, one CAS-publish. Per-call Register is N locks, N rehashes on growth, N publishes.

**Trade-off:** Map literal must be statically constructible — no per-entry init-time validation (do it inside `RegisterAll`). Tools that scan `Register` calls lose grep-ability — name the bulk map well.

**When NOT:** Conditional registration (env vars, build tags). Per-entry `Register` is correct; cost paid only when conditions are met.
</details>

---

## 13. Exercise 12 — `plugin.Lookup` per call

Go's `plugin` package (Linux/macOS) loads `.so` files; each `Lookup` walks the plugin's symbol table — O(symbols) worst-case. A poorly-shaped wrapper calls `Lookup("DoWork")` on every invocation.

**Before:**

```go
func CallPlugin(p *plugin.Plugin, arg string) (string, error) {
    sym, err := p.Lookup("DoWork") // ~3 µs per call
    if err != nil { return "", err }
    return sym.(func(string) (string, error))(arg)
}
```

```
BenchmarkPluginLookup-8     300000     3800 ns/op    32 B/op   1 allocs/op
```

<details><summary>After</summary>

Lookup once at load, cache the typed function pointer.

```go
type LoadedPlugin struct {
    p      *plugin.Plugin
    DoWork func(string) (string, error)
}

func Load(path string) (*LoadedPlugin, error) {
    p, err := plugin.Open(path)
    if err != nil { return nil, err }
    sym, err := p.Lookup("DoWork")
    if err != nil { return nil, err }
    fn, ok := sym.(func(string) (string, error))
    if !ok { return nil, fmt.Errorf("plugin %s: DoWork wrong signature", path) }
    return &LoadedPlugin{p: p, DoWork: fn}, nil
}
func (lp *LoadedPlugin) Call(arg string) (string, error) { return lp.DoWork(arg) }
```

```
BenchmarkCachedFn-8       500000000     2.4 ns/op    0 B/op   0 allocs/op
```

~1600× faster.

**Why faster:** Cached function pointer is a direct (or single-indirect) call. `plugin.Lookup` walks a symbol table per call. Type assertion runs once.

**Trade-off:** `LoadedPlugin` must declare every symbol up front. Dynamic plugin APIs keep `Lookup` per discovery but cache results.

**When NOT:** Dynamic symbol sets discovered at runtime. Hot-reload where cached pointer becomes stale — rebuild `LoadedPlugin` on reload.
</details>

---

## 14. When NOT to optimize

Registry overhead dominates only when lookups land on the hot path of a high-QPS service. If your registry is read 100 times per minute, every optimization here is irrelevant — your time is in the work the registry routes to.

- Driver registry consulted once at process start — keep `RWMutex+map`.
- Image-format registry used once per uploaded file (kilobytes of work follow).
- Test-only registry for mocks — no production load, no scaling problem.

**Profile first.** Registry overhead has four signatures in a CPU profile:

- `sync.(*RWMutex).RLock/RUnlock` on a hot stack → Ex. 1 or 3.
- `runtime.mapaccess2_faststr` dominating → Ex. 2 (typed key) if keys are bounded.
- `runtime.convT*` on every `Get` → Ex. 5 (generics).
- `reflect.TypeOf` in a dispatch loop → Ex. 6 (string keys).

**Common premature optimizations:**

- `sync.Map` (Ex. 1) on a registry with < 100 reads/sec — `RWMutex+map` is fine.
- `atomic.Pointer[map]` (Ex. 3) with no measurable contention — write path gets worse for no win.
- Integer key IDs (Ex. 2) when string lookups don't show in profiles.
- Cached `Names()` (Ex. 7) when called once per minute.
- Plugin function caching (Ex. 12) when invocation latency is itself ms-scale.

**Correctness gaps disguised as optimizations:**

- Removing the nil-check from `Register` "to save 1 ns" — until a nil panics on first use, far from the registration site.
- `atomic.Pointer` swap without a write mutex — two concurrent registrations race; one loses silently.
- Caching `Names()` and letting callers mutate the slice — neighbors see corruption.
- Bulk `RegisterAll` overwriting without duplicate-check — hot-reload silently shadows old plugins.
- Hoisting a lookup out of a loop when the key varies — wrong result, slower to debug than the slow original.
- Replacing `reflect.Type` keys with string names without stable names — collisions across packages sharing a short name.
- Lock-free publish without a happens-before guarantee on the stored value's internal state (a `Codec` whose init is still in progress when stored).

---

## 15. Summary

**Always-ship wins** (apply by default in any new Registry code):

- Generic `Registry[T]` over `map[string]any` (Ex. 5).
- Bulk `RegisterAll` for known-static sets (Ex. 11).
- Hoist `Get` out of hot loops (Ex. 8).
- Cache `plugin.Lookup` results in typed function fields (Ex. 12).
- Stable string keys, not `reflect.Type` (Ex. 6).
- Nil-check on `Register` and duplicate-key panic — correctness, not performance.

**Wins behind a profile** (when measurements justify them):

- `sync.Map` for read-mostly contended registries (Ex. 1) — when `RWMutex.RLock` shows in profile.
- `atomic.Pointer[map]` COW (Ex. 3, 10) — read contention dominates, writes rare.
- Cached `Names()` with version counter (Ex. 7) — introspection on a hot path.
- Diff-based bulk merge for hot-reload (Ex. 9) — scheduled reloads.
- Exact-match map over linear scan (Ex. 4) — route count > 10.

**Specialty** (only when the design calls for it):

- Integer ID key with dense array backing (Ex. 2) — closed sets, sub-10-ns lookups.
- Radix tree / trie for prefix routing — wildcard semantics, large route sets.
- Reference-counted plugin handles for safe hot-swap — swap can race with an in-flight call.
- Per-tenant scoped registries via context — isolation matters more than convenience.

Registry cost is locks, hashes, ifaces, and reflect-type extraction. Strip those four from the read path by choosing the right primitive: `RWMutex+map` for startup-only and 99% of code; `atomic.Pointer[map]` when reads scale across cores; `sync.Map` for read-mostly with occasional writes; integer keys when the alphabet is closed. The Registry is rarely where time goes — but when it is, these are the levers.
