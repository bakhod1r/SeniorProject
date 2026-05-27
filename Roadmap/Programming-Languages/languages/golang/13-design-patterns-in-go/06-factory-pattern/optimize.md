# Factory Pattern — Optimization

## 1. How to use this file

Twelve scenarios where factory code is slower than it needs to be. Each:

- **Scenario** — the inefficiency.
- **Before** — measured-slow code with realistic benchmark numbers.
- **After** (collapsible) — optimised version with benchmark comparison.
- **Why faster** — what changed at the runtime level.
- **Trade-offs** — what you lose by optimising.
- **When NOT to do this** — the cases where the optimisation isn't worth it.

The honest answer for most factory "optimisations": they don't matter. A factory call is typically 5-50 ns of overhead. Unless you're constructing >100k objects per second, the dispatch cost is below the noise. Benchmarks here are illustrative — qualitative direction (allocs vs no allocs) matters more than absolute ns/op. Go 1.22, amd64, GOMAXPROCS=8.

---

## 2. Table of Contents

1. [How to use this file](#1-how-to-use-this-file)
2. [Table of Contents](#2-table-of-contents)
3. [Exercise 1 — Factory called per-request when the result is cacheable](#exercise-1--factory-called-per-request-when-the-result-is-cacheable)
4. [Exercise 2 — Registry lookup per call instead of resolve-once-at-boot](#exercise-2--registry-lookup-per-call-instead-of-resolve-once-at-boot)
5. [Exercise 3 — Lazy init via mutex instead of sync.Once](#exercise-3--lazy-init-via-mutex-instead-of-synconce)
6. [Exercise 4 — Factory returning interface forces heap allocation](#exercise-4--factory-returning-interface-forces-heap-allocation)
7. [Exercise 5 — Reflect-based factory replaced by type-specific factories](#exercise-5--reflect-based-factory-replaced-by-type-specific-factories)
8. [Exercise 6 — Factory recompiling regex per call](#exercise-6--factory-recompiling-regex-per-call)
9. [Exercise 7 — Map-based dispatch in factory replaced by switch for small N](#exercise-7--map-based-dispatch-in-factory-replaced-by-switch-for-small-n)
10. [Exercise 8 — PGO devirtualization for factory call sites](#exercise-8--pgo-devirtualization-for-factory-call-sites)
11. [Exercise 9 — Factory using fmt.Sprintf in hot path](#exercise-9--factory-using-fmtsprintf-in-hot-path)
12. [Exercise 10 — Generic factory with closure list replaced by direct field setters](#exercise-10--generic-factory-with-closure-list-replaced-by-direct-field-setters)
13. [Exercise 11 — Factory pool with sync.Pool for transient objects](#exercise-11--factory-pool-with-syncpool-for-transient-objects)
14. [Exercise 12 — Pre-warmed factory cache vs cold-start](#exercise-12--pre-warmed-factory-cache-vs-cold-start)
15. [When NOT to optimize](#when-not-to-optimize)
16. [Summary](#summary)

---

## Exercise 1 — Factory called per-request when the result is cacheable

**Scenario:** A handler calls `NewParser(cfg)` on every request, but `cfg` is identical across requests. The constructor does non-trivial work (validation, schema build, child allocation).

**Before:**

```go
func NewParser(cfg Config) *Parser {
    p := &Parser{cfg: cfg}
    p.validate()              // checks 20 fields
    p.schema = buildSchema()  // allocates ~512 B
    return p
}

func handle(w http.ResponseWriter, r *http.Request) {
    p := NewParser(defaultCfg)  // same cfg every request
    p.Parse(r.Body)
}
```

Benchmark:

```
BenchmarkPerRequestFactory-8    1000000    1450 ns/op    864 B/op    9 allocs/op
```

At 50k QPS, that's ~45 MB/s of allocation pressure for an object that never changes.

<details><summary>After</summary>

Cache the parser at package init since the config is static:

```go
var defaultParser = NewParser(defaultCfg)

func handle(w http.ResponseWriter, r *http.Request) {
    defaultParser.Parse(r.Body)
}
```

If `Parser` is not concurrency-safe, pool it:

```go
var parserPool = sync.Pool{
    New: func() any { return NewParser(defaultCfg) },
}

func handle(w http.ResponseWriter, r *http.Request) {
    p := parserPool.Get().(*Parser)
    defer parserPool.Put(p)
    p.Parse(r.Body)
}
```

Benchmark with the cached singleton:

```
BenchmarkCachedFactory-8       50000000      24 ns/op      0 B/op    0 allocs/op
```

~60× speedup, zero allocations.

**Why faster:** Construction work happens once at init. The hot path is a pointer load and a method call. Heap pressure that drove GC is gone.

**Trade-offs:** Shared state. If the parser holds mutable per-request state, this breaks. The singleton must be safe for concurrent use, or you need a pool. Also: lifetime is now "forever" — leaks of memory rooted inside the parser are now visible to pprof as steady-state, not as churn.

**When NOT to do this:** When `cfg` actually varies per request (per-tenant config, per-user limits). Caching wrong keeps the same value for every request. Verify the inputs are stable before caching.

```bash
# Verify with pprof
go test -bench=. -cpuprofile=cpu.pprof -memprofile=mem.pprof
go tool pprof -top cpu.pprof   # confirm NewParser disappeared from top frames
go tool pprof -top mem.pprof   # confirm allocations dropped
```
</details>

---

## Exercise 2 — Registry lookup per call instead of resolve-once-at-boot

**Scenario:** A factory dispatches by string key from a registry. Each request hashes the key and traverses the bucket.

**Before:**

```go
var registry = map[string]func() Driver{
    "postgres": newPostgres,
    "mysql":    newMySQL,
    "sqlite":   newSQLite,
}

func Open(name string) Driver {
    fn, ok := registry[name]
    if !ok {
        panic("unknown driver: " + name)
    }
    return fn()
}

// Hot path:
func query() {
    d := Open("postgres")  // string hash + map lookup every call
    d.Exec(...)
}
```

```
BenchmarkRegistryLookup-8     20000000     72 ns/op    16 B/op   1 allocs/op
```

The cost: hash the 8-byte string, probe the map, return the function pointer, call it. The string `"postgres"` is constant — the lookup result will never change.

<details><summary>After</summary>

Resolve once at boot:

```go
var pgDriver = registry["postgres"]  // resolved at init

func query() {
    d := pgDriver()
    d.Exec(...)
}
```

Or, if you need configurability, resolve at handler construction:

```go
type Handler struct {
    newDriver func() Driver  // captured at New
}

func NewHandler(driverName string) *Handler {
    fn, ok := registry[driverName]
    if !ok {
        panic("unknown driver")
    }
    return &Handler{newDriver: fn}
}

func (h *Handler) Query() {
    d := h.newDriver()  // no map lookup
    d.Exec(...)
}
```

```
BenchmarkResolvedAtBoot-8    300000000      4 ns/op    0 B/op   0 allocs/op
```

~18× speedup.

**Why faster:** Map lookup hashes the key, walks the bucket chain, and dereferences. Calling a stored function pointer is one indirect call. Inlining sometimes removes that too.

**Trade-offs:** You lose the ability to swap drivers at runtime per-call. If you want runtime swapability (e.g., feature flag flipping mid-request), keep the lookup or use an `atomic.Value` holding the current driver.

**When NOT to do this:** When the driver name genuinely comes from per-request input (multi-tenant database router, plugin loader). Then the map lookup is unavoidable — but cache the resolved factory per tenant if tenants are small in number.

```bash
# Check map dispatch cost in your real workload
go tool pprof -list 'runtime\.mapaccess' cpu.pprof
```
</details>

---

## Exercise 3 — Lazy init via mutex instead of sync.Once

**Scenario:** A factory creates an expensive singleton lazily, guarded by a mutex.

**Before:**

```go
type ClientFactory struct {
    mu     sync.Mutex
    client *Client  // expensive: TLS handshake, DNS, pool warm-up
}

func (f *ClientFactory) Get() *Client {
    f.mu.Lock()
    defer f.mu.Unlock()
    if f.client == nil {
        f.client = newClient()  // 50 ms first call
    }
    return f.client
}
```

```
BenchmarkMutexLazyInit-8     50000000     25 ns/op    0 B/op   0 allocs/op
```

Every call acquires the mutex, even after `client` is set. Under contention from many goroutines, the mutex becomes a serialization point.

<details><summary>After</summary>

Use `sync.Once`:

```go
type ClientFactory struct {
    once   sync.Once
    client *Client
}

func (f *ClientFactory) Get() *Client {
    f.once.Do(func() { f.client = newClient() })
    return f.client
}
```

```
BenchmarkOnceLazyInit-8     500000000      2.4 ns/op    0 B/op   0 allocs/op
```

~10× speedup post-init; under contention, the gap widens because `sync.Once` doesn't serialize on the fast path.

**Why faster:** `sync.Once.Do` does an atomic load on the fast path. After the first call, every subsequent call sees `done == 1` and returns immediately without acquiring any mutex. The mutex version pays for `Lock`/`Unlock` forever.

For even tighter loops, hand-roll using `atomic.Pointer[T]` (Go 1.19+):

```go
type ClientFactory struct {
    p atomic.Pointer[Client]
    once sync.Once
}

func (f *ClientFactory) Get() *Client {
    if c := f.p.Load(); c != nil {
        return c
    }
    f.once.Do(func() { f.p.Store(newClient()) })
    return f.p.Load()
}
```

```
BenchmarkAtomicLoad-8       1000000000     1.1 ns/op    0 B/op   0 allocs/op
```

**Trade-offs:** `sync.Once.Do` takes a closure, which on rare paths the compiler may not inline. The atomic pattern is one line longer. Both are strictly better than the mutex version.

**When NOT to do this:** Almost never — `sync.Once` is strictly better than the mutex pattern for one-time init. The only time the mutex version is justified is when re-initialization is needed (e.g., the client can be invalidated and re-built), and even then prefer `atomic.Pointer` with CAS.
</details>

---

## Exercise 4 — Factory returning interface forces heap allocation

**Scenario:** Factory function returns an interface. Escape analysis is forced to put the value on the heap because it cannot prove the interface doesn't escape.

**Before:**

```go
type Encoder interface {
    Encode(v any) ([]byte, error)
}

type jsonEncoder struct{ buf []byte }

func (j *jsonEncoder) Encode(v any) ([]byte, error) { /* ... */ }

func NewEncoder() Encoder {
    return &jsonEncoder{}  // escapes to heap
}

func encodeBatch(items []Item) {
    for _, item := range items {
        e := NewEncoder()    // heap alloc per iteration
        _, _ = e.Encode(item)
    }
}
```

```
BenchmarkInterfaceFactory-8    5000000    260 ns/op    32 B/op    1 allocs/op
```

Run escape analysis:

```bash
go build -gcflags='-m -m' . 2>&1 | grep -E '(escapes|NewEncoder)'
# Output: ./main.go:18:9: &jsonEncoder{} escapes to heap
```

<details><summary>After</summary>

Return the concrete type — let escape analysis stack-allocate:

```go
func NewEncoder() *jsonEncoder {
    return &jsonEncoder{}
}

func encodeBatch(items []Item) {
    for _, item := range items {
        e := NewEncoder()  // may stack-allocate now
        _, _ = e.Encode(item)
    }
}
```

```
BenchmarkConcreteFactory-8    100000000    14 ns/op    0 B/op    0 allocs/op
```

~18× speedup, zero allocations.

If you still want the abstraction at the call site:

```go
func encodeBatch(items []Item) {
    enc := jsonEncoder{}  // stack value
    for _, item := range items {
        _, _ = enc.Encode(item)
    }
}
```

Or hoist the allocation outside the loop:

```go
func encodeBatch(items []Item) {
    e := NewEncoder()  // one alloc
    for _, item := range items {
        _, _ = e.Encode(item)
    }
}
```

**Why faster:** Returning an interface boxes the value: the runtime needs an `iface` (type+data) header, and the data pointer has to outlive the function (it escapes). Returning the concrete pointer lets escape analysis sometimes prove the value is local and stack-allocate it.

**Trade-offs:** You lose the abstraction at the function signature. Callers see `*jsonEncoder`, not `Encoder`. Substitution at the call site becomes harder. For library APIs, this is usually a bad trade — keep the interface. For private factories inside a hot loop, the win is real.

**When NOT to do this:** When the abstraction is the point — when you have multiple implementations and callers don't know which one they get. Public factories of a strategy/policy interface should keep returning the interface.

```bash
# Confirm stack allocation
go build -gcflags='-m' . 2>&1 | grep jsonEncoder
# Want to see: "does not escape"
```
</details>

---

## Exercise 5 — Reflect-based factory replaced by type-specific factories

**Scenario:** A "generic" factory uses reflection to construct objects from a type registry.

**Before:**

```go
var typeRegistry = map[string]reflect.Type{
    "user":    reflect.TypeOf(User{}),
    "order":   reflect.TypeOf(Order{}),
    "product": reflect.TypeOf(Product{}),
}

func New(name string) any {
    t, ok := typeRegistry[name]
    if !ok {
        return nil
    }
    return reflect.New(t).Interface()
}

func handle() {
    u := New("user").(*User)
    u.Name = "alice"
}
```

```
BenchmarkReflectFactory-8     2000000    850 ns/op    144 B/op    4 allocs/op
```

Reflection is slow: type descriptor lookup, allocation via the runtime, boxing into `any`, then a type assertion on the way out.

<details><summary>After</summary>

Use type-specific factories with a typed dispatcher:

```go
func newUser() *User       { return &User{} }
func newOrder() *Order     { return &Order{} }
func newProduct() *Product { return &Product{} }

// If you need string dispatch, type-switch the result:
type Entity interface{ kind() string }

var registry = map[string]func() Entity{
    "user":    func() Entity { return newUser() },
    "order":   func() Entity { return newOrder() },
    "product": func() Entity { return newProduct() },
}
```

For known call sites, skip dispatch entirely:

```go
func handle() {
    u := newUser()  // direct call
    u.Name = "alice"
}
```

```
BenchmarkDirectFactory-8     200000000    8 ns/op    16 B/op    1 allocs/op
```

~100× speedup. The remaining allocation is the struct itself, which is unavoidable.

**Why faster:** No reflection. `reflect.New` walks the type's method tables, allocates by walking the GC bitmap descriptor, then boxes. The direct call is a single allocation by the inlined runtime stub.

**Trade-offs:** You can no longer add new types without editing the registry. Reflection's only real virtue is true runtime extensibility (config-driven plugin systems).

**When NOT to do this:** When the type set is genuinely unknown at compile time (plugin loaders, ORM hydration from arbitrary tables, JSON schema-driven decoding). Then reflection earns its cost. But cache the `reflect.Type` and `reflect.Value` factories where possible.

```bash
# pprof to confirm reflect overhead
go tool pprof -list 'reflect\..*' cpu.pprof
```
</details>

---

## Exercise 6 — Factory recompiling regex per call

**Scenario:** A factory creates a validator that compiles a regex on every construction.

**Before:**

```go
type EmailValidator struct {
    re *regexp.Regexp
}

func NewEmailValidator() *EmailValidator {
    return &EmailValidator{
        re: regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`),
    }
}

// Hot path: handler creates a new validator per request
func handle(email string) bool {
    v := NewEmailValidator()
    return v.re.MatchString(email)
}
```

```
BenchmarkRegexCompilePerCall-8    300000    4200 ns/op    2848 B/op    32 allocs/op
```

Regex compilation is the dominant cost: tokenize, build NFA/DFA, allocate the program.

<details><summary>After</summary>

Compile once as a package var, share the validator (or just the regex):

```go
var emailRE = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

type EmailValidator struct{}  // stateless

func (EmailValidator) Validate(email string) bool {
    return emailRE.MatchString(email)
}

// Or skip the wrapper entirely:
func ValidateEmail(s string) bool { return emailRE.MatchString(s) }
```

```
BenchmarkRegexPackageVar-8     30000000     45 ns/op    0 B/op    0 allocs/op
```

~90× speedup, zero allocations.

**Why faster:** Compilation runs once at package init. The hot path is a single function call into the compiled matcher.

**Trade-offs:** None of substance. The regex is fixed at compile time. The validator struct, if it had no other state, can disappear entirely.

If the pattern *is* dynamic (user-provided), cache compiled regexes:

```go
var regexCache sync.Map  // map[string]*regexp.Regexp

func compileCached(pattern string) (*regexp.Regexp, error) {
    if v, ok := regexCache.Load(pattern); ok {
        return v.(*regexp.Regexp), nil
    }
    re, err := regexp.Compile(pattern)
    if err != nil {
        return nil, err
    }
    actual, _ := regexCache.LoadOrStore(pattern, re)
    return actual.(*regexp.Regexp), nil
}
```

**When NOT to do this:** When patterns are truly per-call and unique. Then compilation is unavoidable — but consider whether `strings.Contains` or hand-written parsing would beat the regex.
</details>

---

## Exercise 7 — Map-based dispatch in factory replaced by switch for small N

**Scenario:** Factory uses a `map[string]func() T` to dispatch. The number of keys is small (3-6) and fixed.

**Before:**

```go
var shapeFactories = map[string]func() Shape{
    "circle":    func() Shape { return &Circle{} },
    "square":    func() Shape { return &Square{} },
    "triangle":  func() Shape { return &Triangle{} },
}

func NewShape(name string) Shape {
    fn, ok := shapeFactories[name]
    if !ok {
        return nil
    }
    return fn()
}
```

```
BenchmarkMapDispatch-8     20000000      62 ns/op    16 B/op    1 allocs/op
```

Map cost is hash + bucket walk + closure call.

<details><summary>After</summary>

Switch for small, fixed N:

```go
func NewShape(name string) Shape {
    switch name {
    case "circle":
        return &Circle{}
    case "square":
        return &Square{}
    case "triangle":
        return &Triangle{}
    default:
        return nil
    }
}
```

```
BenchmarkSwitchDispatch-8    150000000     10 ns/op    16 B/op    1 allocs/op
```

~6× speedup for small N.

**Why faster:** String hashing is ~20-30 ns. A switch on string compares against each case label directly — for ≤8 cases, that's a few branches. The compiler may also generate jump tables or perfect-hash dispatch for larger switches.

**Trade-offs:** Adding a new shape requires editing the function (not registering at runtime). Less dynamic. You also can't iterate the supported names without a separate list.

**When NOT to do this:** When the set of names is large (≥20) or determined at runtime by user code (plugin registration). The map handles those well. Also, when extensibility matters more than 50 ns/call.

Rule of thumb:

| N (number of cases) | Best dispatch |
|---|---|
| 1-8 | switch |
| 9-30 | either; profile |
| 30+ | map |

```bash
# See what the compiler did with your switch
go tool compile -S file.go | grep -A 20 NewShape
```
</details>

---

## Exercise 8 — PGO devirtualization for factory call sites

**Scenario:** A factory returns an interface that's called frequently. The actual concrete type in production is almost always the same one.

**Before:**

```go
type Codec interface {
    Encode(v any) ([]byte, error)
}

func NewCodec(name string) Codec {
    switch name {
    case "json":     return &jsonCodec{}
    case "protobuf": return &protoCodec{}
    case "msgpack":  return &msgpackCodec{}
    }
    return nil
}

// In production, 95% of calls use "json".
func handle(req Request) {
    c := NewCodec(req.Format)  // almost always &jsonCodec{}
    c.Encode(req.Payload)
}
```

```
BenchmarkPolymorphicCall-8     5000000    280 ns/op
```

`c.Encode` is an interface dispatch — itab lookup, indirect call. The CPU's branch predictor can't see through the indirection.

<details><summary>After (with PGO)</summary>

Collect a profile from production-representative load:

```bash
# 1. Build instrumented binary, run under realistic load, collect profile
go test -bench=. -cpuprofile=cpu.pprof -benchtime=10s

# Or capture from a running service:
curl -o cpu.pprof http://localhost:6060/debug/pprof/profile?seconds=30

# 2. Move profile to default location and rebuild with PGO
mv cpu.pprof default.pgo
go build -pgo=auto .   # picks up default.pgo automatically
```

```
BenchmarkPolymorphicCallPGO-8    9000000    155 ns/op
```

~45% faster.

**Why faster:** PGO sees that `c.Encode` is dominated by `*jsonCodec.Encode` calls. The compiler emits a fast-path check (`if itab == jsonItab`) followed by a direct, inlinable call, with the indirect dispatch as a fallback for other types. The CPU branch predictor handles the fast path well.

**Trade-offs:**
- Binary is 3-10% larger.
- Profile must reflect production. A profile from staging with different traffic mix devirtualizes the wrong type and may even regress.
- Build pipeline gets more complex: collect, version, ship the profile alongside source.

**When NOT to do this:** Small services, batch jobs, anything not running hot enough to matter. For <1k QPS services the wins are invisible. Also skip PGO until you have a stable production workload to profile — it's not for prototypes.

```bash
# Verify devirtualization happened
go build -pgo=default.pgo -gcflags='-m=2' . 2>&1 | grep devirtual
```
</details>

---

## Exercise 9 — Factory using `fmt.Sprintf` in hot path

**Scenario:** A factory builds object identifiers or labels using `fmt.Sprintf` on every construction.

**Before:**

```go
type Worker struct {
    id   string
    name string
}

func NewWorker(pool string, n int) *Worker {
    return &Worker{
        id:   fmt.Sprintf("%s-%d", pool, n),
        name: fmt.Sprintf("worker-%s-%05d", pool, n),
    }
}

func spawn(pool string, count int) []*Worker {
    workers := make([]*Worker, count)
    for i := 0; i < count; i++ {
        workers[i] = NewWorker(pool, i)
    }
    return workers
}
```

```
BenchmarkSprintfFactory-8     2000000    580 ns/op    96 B/op    4 allocs/op
```

`fmt.Sprintf` parses the format string, dispatches via reflection per verb, allocates the result buffer.

<details><summary>After</summary>

Use `strings.Builder` + `strconv` for fast, allocation-controlled formatting:

```go
func NewWorker(pool string, n int) *Worker {
    var idBuf, nameBuf strings.Builder
    idBuf.Grow(len(pool) + 12)
    idBuf.WriteString(pool)
    idBuf.WriteByte('-')
    idBuf.WriteString(strconv.Itoa(n))

    nameBuf.Grow(len(pool) + 14)
    nameBuf.WriteString("worker-")
    nameBuf.WriteString(pool)
    nameBuf.WriteByte('-')
    // zero-pad to 5 digits
    s := strconv.Itoa(n)
    for k := len(s); k < 5; k++ {
        nameBuf.WriteByte('0')
    }
    nameBuf.WriteString(s)

    return &Worker{id: idBuf.String(), name: nameBuf.String()}
}
```

```
BenchmarkBuilderFactory-8     15000000     95 ns/op    48 B/op    2 allocs/op
```

~6× speedup, half the allocations.

For even tighter loops, append into a shared byte slice with `strconv.AppendInt`:

```go
func NewWorker(pool string, n int, scratch []byte) *Worker {
    scratch = scratch[:0]
    scratch = append(scratch, pool...)
    scratch = append(scratch, '-')
    scratch = strconv.AppendInt(scratch, int64(n), 10)
    return &Worker{id: string(scratch) /* still allocates */}
}
```

The `string(scratch)` conversion still copies — but you control the buffer reuse.

**Why faster:** `fmt.Sprintf` walks the format string, boxes each argument into `any` (often allocating), and dispatches via type switch + reflect. `strings.Builder` writes bytes directly; `strconv.Itoa` is a hot, allocation-free integer formatter.

**Trade-offs:** Code is verbose. Easy to introduce bugs (wrong width, missing pad). Less obvious what the output format is.

**When NOT to do this:** When the format is complex (many verbs, locale-aware) or the function is called rarely. For startup-time factories or admin endpoints, `fmt.Sprintf` is fine.

```bash
# Confirm the allocations dropped
go test -bench=NewWorker -benchmem
```
</details>

---

## Exercise 10 — Generic factory with closure list replaced by direct field setters

**Scenario:** A factory uses the functional-options pattern with `[]Option` (each Option is a closure). Constructing involves walking the slice and invoking each closure.

**Before:**

```go
type Server struct {
    addr    string
    timeout time.Duration
    maxConn int
    tlsCfg  *tls.Config
}

type Option func(*Server)

func WithAddr(a string) Option       { return func(s *Server) { s.addr = a } }
func WithTimeout(d time.Duration) Option { return func(s *Server) { s.timeout = d } }
func WithMaxConn(n int) Option       { return func(s *Server) { s.maxConn = n } }
func WithTLS(c *tls.Config) Option   { return func(s *Server) { s.tlsCfg = c } }

func NewServer(opts ...Option) *Server {
    s := &Server{timeout: 30 * time.Second, maxConn: 1000}
    for _, opt := range opts {
        opt(s)
    }
    return s
}

// Caller in a hot path (e.g. per-tenant server spin-up)
func spinUp() *Server {
    return NewServer(
        WithAddr(":8080"),
        WithTimeout(5*time.Second),
        WithMaxConn(500),
        WithTLS(myTLS),
    )
}
```

```
BenchmarkOptionsFactory-8     3000000    420 ns/op    192 B/op    6 allocs/op
```

Each `Option` is a closure value — that's a heap allocation for the captured args. The variadic `opts ...Option` is a slice — another allocation. Then iterating the slice and calling each.

<details><summary>After</summary>

If construction is on a hot path and the option set is fixed, use a config struct:

```go
type ServerConfig struct {
    Addr    string
    Timeout time.Duration
    MaxConn int
    TLSCfg  *tls.Config
}

func NewServer(cfg ServerConfig) *Server {
    if cfg.Timeout == 0 {
        cfg.Timeout = 30 * time.Second
    }
    if cfg.MaxConn == 0 {
        cfg.MaxConn = 1000
    }
    return &Server{
        addr:    cfg.Addr,
        timeout: cfg.Timeout,
        maxConn: cfg.MaxConn,
        tlsCfg:  cfg.TLSCfg,
    }
}

func spinUp() *Server {
    return NewServer(ServerConfig{
        Addr:    ":8080",
        Timeout: 5 * time.Second,
        MaxConn: 500,
        TLSCfg:  myTLS,
    })
}
```

```
BenchmarkConfigStructFactory-8    30000000    48 ns/op    64 B/op    1 allocs/op
```

~9× speedup, 1 allocation instead of 6.

**Why faster:**
- No closure allocation for each option.
- No variadic slice.
- No loop, no indirect calls.
- One allocation for the `Server` itself (and `ServerConfig` stays on the stack if it doesn't escape).

**Trade-offs:** You lose the lazy-evaluation of options (closures could decide at apply time). You also lose the ergonomic "only pass what you need" API — caller has to know about the struct shape. Zero values matter more (the function has to recognize "unset" vs "explicit zero").

**When NOT to do this:** When the factory is called rarely (startup-only) and ergonomics beats nanoseconds. Functional options exist for a reason — they're idiomatic, extendable, and forgiving. Only flatten them when the factory is genuinely hot (per-request, per-message).

A middle ground: keep functional options for the public API, expose a private `newServerFromConfig(ServerConfig)` for hot internal call sites.
</details>

---

## Exercise 11 — Factory pool with sync.Pool for transient objects

**Scenario:** A factory creates short-lived objects (request scratch buffers, parsers, encoders) and discards them. GC pressure rises.

**Before:**

```go
type RequestCtx struct {
    buf     []byte
    headers map[string]string
    fields  []Field
}

func NewRequestCtx() *RequestCtx {
    return &RequestCtx{
        buf:     make([]byte, 0, 4096),
        headers: make(map[string]string, 16),
        fields:  make([]Field, 0, 32),
    }
}

func handle(w http.ResponseWriter, r *http.Request) {
    ctx := NewRequestCtx()
    process(ctx, r)
    // ctx discarded, eligible for GC
}
```

At 50k QPS:

```
BenchmarkPerRequestCtx-8     2000000    720 ns/op    5280 B/op    4 allocs/op
```

That's ~250 MB/s of allocation. GC pauses become visible in p99 latency.

<details><summary>After</summary>

Pool the object:

```go
var ctxPool = sync.Pool{
    New: func() any {
        return &RequestCtx{
            buf:     make([]byte, 0, 4096),
            headers: make(map[string]string, 16),
            fields:  make([]Field, 0, 32),
        }
    },
}

func acquireCtx() *RequestCtx {
    return ctxPool.Get().(*RequestCtx)
}

func releaseCtx(c *RequestCtx) {
    // Reset before returning to pool
    c.buf = c.buf[:0]
    for k := range c.headers {
        delete(c.headers, k)
    }
    c.fields = c.fields[:0]
    ctxPool.Put(c)
}

func handle(w http.ResponseWriter, r *http.Request) {
    ctx := acquireCtx()
    defer releaseCtx(ctx)
    process(ctx, r)
}
```

```
BenchmarkPooledCtx-8        20000000     85 ns/op     0 B/op    0 allocs/op
```

~8× faster, allocations drop to zero in steady state.

**Why faster:** After warm-up, `Get` returns a recently-released object from a thread-local cache — no allocation. The cost shifts from "alloc + GC scan + GC sweep" to "atomic load from per-P pool".

**Trade-offs:**
- **Reset bugs:** if you forget to reset a field, state leaks between requests. This is a common source of nasty bugs. Always reset in `Put` (or in `Get`, but `Put` is safer).
- **Map clear cost:** clearing a map via `for k := range m { delete(m, k) }` is itself O(n). For Go 1.21+, use `clear(m)`. For older Go, sometimes reallocating the map is cheaper.
- **GC can drop pooled objects:** `sync.Pool` releases its contents at GC. After a GC, the next `Get` allocates. Don't rely on the pool for correctness, only for performance.
- **Lifetime confusion:** if a goroutine keeps a reference past `Put`, you'll see corruption. Use `defer release` and discipline.

**When NOT to do this:**
- When objects are small (<128 B) and infrequently created — `sync.Pool` overhead can exceed allocation cost.
- When the object has complex reset logic that's likely to be buggy. The bugs cost more than the GC.
- When the lifetime is long (most "transient" objects in the pool sense live <1 ms).

```bash
# Measure GC pressure before and after
GODEBUG=gctrace=1 ./service
# Look for pause times in the gctrace output
```
</details>

---

## Exercise 12 — Pre-warmed factory cache vs cold-start

**Scenario:** A factory caches expensive constructions in a map, but the first request after restart pays the full cost. With many keys, the warm-up tail is long.

**Before:**

```go
type SchemaFactory struct {
    mu    sync.RWMutex
    cache map[string]*Schema
}

func (f *SchemaFactory) Get(name string) *Schema {
    f.mu.RLock()
    if s, ok := f.cache[name]; ok {
        f.mu.RUnlock()
        return s
    }
    f.mu.RUnlock()

    f.mu.Lock()
    defer f.mu.Unlock()
    if s, ok := f.cache[name]; ok {
        return s
    }
    s := buildSchema(name)  // 5 ms each
    f.cache[name] = s
    return s
}
```

Cold start, first 100 requests:

```
p50: 5.2 ms   p99: 12 ms   p999: 25 ms
```

Steady state, after warm-up:

```
p50: 0.2 ms   p99: 0.5 ms   p999: 1.2 ms
```

The cold-start tail kills SLOs after deploys, scale-out events, or container restarts.

<details><summary>After</summary>

Pre-warm at startup, before serving traffic:

```go
func (f *SchemaFactory) Prewarm(ctx context.Context, names []string) error {
    var (
        wg   sync.WaitGroup
        sem  = make(chan struct{}, runtime.NumCPU())
        errs []error
        mu   sync.Mutex
    )
    for _, name := range names {
        wg.Add(1)
        sem <- struct{}{}
        go func(n string) {
            defer wg.Done()
            defer func() { <-sem }()
            if _, err := f.getOrBuild(ctx, n); err != nil {
                mu.Lock()
                errs = append(errs, err)
                mu.Unlock()
            }
        }(name)
    }
    wg.Wait()
    if len(errs) > 0 {
        return errors.Join(errs...)
    }
    return nil
}

// In main, before listening:
func main() {
    f := &SchemaFactory{cache: make(map[string]*Schema)}
    names := loadKnownSchemaNames()  // from config, DB, or last-seen-keys log
    if err := f.Prewarm(context.Background(), names); err != nil {
        log.Fatalf("prewarm: %v", err)
    }
    http.ListenAndServe(":8080", handler(f))
}
```

After pre-warm, first 100 requests:

```
p50: 0.2 ms   p99: 0.5 ms   p999: 1.0 ms
```

No cold-start tail.

Also consider readiness gating: only mark the pod ready after `Prewarm` succeeds, so the load balancer doesn't route traffic to cold instances.

```go
// In a Kubernetes liveness/readiness handler:
func readinessHandler(ready *atomic.Bool) http.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) {
        if !ready.Load() {
            http.Error(w, "not ready", http.StatusServiceUnavailable)
            return
        }
        w.WriteHeader(http.StatusOK)
    }
}
```

**Why faster (perceived):** The cost didn't disappear — it shifted from request-time to startup-time, where it's not user-visible. Users see steady-state latency from the first request.

**Trade-offs:**
- **Slower startup.** Pre-warm 10k schemas at 5 ms each = 50 seconds (serialized) or ~6 s with 8-way parallelism. Increases deploy time and scale-out delay.
- **Stale keys.** If the list of "known names" drifts, you pre-warm dead entries and miss live ones. Mitigation: combine pre-warm of top-N popular keys with lazy-build for the long tail.
- **Memory.** All schemas are resident from boot. If they're large or numerous, this is wasted RAM.
- **Pre-warm errors.** What do you do if 5 of 10k schemas fail to build at startup? Crash? Skip and serve? Decide explicitly.

**When NOT to do this:**
- When the key set is huge and most keys are cold. Pre-warming everything wastes time and memory.
- When the working set fits in cache after a few seconds — the cold-start window is short enough to ignore.
- When startup time is a hard constraint (serverless, scale-from-zero). There, lazy-build with a request-coalescing pattern (`singleflight`) is better.

```go
// Alternative: request-coalescing for cold misses
import "golang.org/x/sync/singleflight"

type SchemaFactory struct {
    g     singleflight.Group
    cache sync.Map  // name -> *Schema
}

func (f *SchemaFactory) Get(name string) (*Schema, error) {
    if v, ok := f.cache.Load(name); ok {
        return v.(*Schema), nil
    }
    v, err, _ := f.g.Do(name, func() (any, error) {
        s := buildSchema(name)
        f.cache.Store(name, s)
        return s, nil
    })
    if err != nil {
        return nil, err
    }
    return v.(*Schema), nil
}
```

`singleflight` ensures only one goroutine builds a given key; concurrent callers wait for the same result. This bounds the cold-start blast radius without pre-warming everything.

```bash
# Measure cold-start latency separately from steady-state
go test -bench=ColdStart -benchtime=1x   # one iteration to measure cold
go test -bench=Warm -benchtime=10s
```
</details>

---

## When NOT to optimize

Most factory-related optimisations are micro-optimisations. They matter only if:

1. **Profiling shows the factory is a bottleneck.** Run `go tool pprof` and verify before optimising.
2. **The QPS is high enough to matter.** A 100 ns saving × 10 QPS = 1 microsecond/sec. Irrelevant.
3. **The clarity loss is acceptable.** Most optimisations make code harder to read.

The right order: measure → identify hot paths → optimise selectively → measure again.

```bash
go test -bench=. -cpuprofile=cpu.pprof -memprofile=mem.pprof
go tool pprof -top -cum cpu.pprof
go test -bench=. -count=10 > before.txt   # apply change, then re-run
benchstat before.txt after.txt
```

Premature optimisation of factories is a classic time-waster. The pattern is *already* efficient — Go's compiler handles the common cases well. The exceptions almost always worth it without measurement:

- `sync.Once` for lazy init (cheaper than mutex; no downside).
- Pre-compile regexes / templates at package init.
- Resolve registry lookups at construction time, not per-call (Exercise 2).
- `var _ Iface = (*ConcreteFactory)(nil)` compile-time check.

Everything else: measure first.

---

## Summary

**Wins that always ship:**
- `sync.Once` for lazy init (Exercise 3).
- Pre-compile regexes at package level (Exercise 6).
- Resolve registry lookups once at boot (Exercise 2).
- Compile-time interface check (`var _ Iface = (*Factory)(nil)`).

**Wins behind a profile:**
- Cache cacheable factory results (Exercise 1).
- Return concrete types where the abstraction isn't needed (Exercise 4).
- Replace `reflect`-based factories with type-specific ones (Exercise 5).
- Replace `fmt.Sprintf` with `strings.Builder`/`strconv` (Exercise 9).
- Pool transient factory outputs with `sync.Pool` (Exercise 11).
- Pre-warm caches before serving traffic (Exercise 12).

**Wins that trade off flexibility:**
- Functional options → config struct (Exercise 10).
- Map dispatch → switch for small N (Exercise 7).

**Rarely worth it without measurement:** PGO devirtualization (Exercise 8) — only for hot services with stable workloads.

Most factory performance work is *avoiding* allocations and *moving cost off the hot path*. The three patterns most engineers hit first — per-request factory with static config (Exercise 1), registry lookup per call (Exercise 2), regex compiled per call (Exercise 6) — fix the majority of factory-related hotspots seen in real services with no measurement needed.
