# Dependency Injection — Optimization

> Honest framing: DI itself rarely shows up in CPU profiles. What deserves attention is *the wiring layer's footprint* — startup time, allocations during construction, and the maintenance cost of a graph nobody can read. Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain.

---

## Optimization 1 — Replace `fx` with manual wiring on cold-start-sensitive binaries

**Problem:** `fx`/`dig` resolve graphs by reflection at process startup. For long-running servers this is invisible. For a CLI invoked thousands of times in CI, or a serverless function with cold starts, the reflection cost can be tens of milliseconds — every invocation.

**Before:**
```go
func main() {
    fx.New(
        fx.Provide(config.Load, infra.OpenDB, repo.NewUsers, service.New, transport.NewAPI),
        fx.Invoke(startAPI),
    ).Run()
}
```
Startup CPU profile shows `dig.(*Container).provide` and `reflect.Value.Call` on the hot path; ~30 ms of pure wiring overhead on a small graph.

**After:**
```go
func main() {
    cfg, _ := config.Load()
    db, _ := infra.OpenDB(cfg)
    users := repo.NewUsers(db)
    svc := service.New(users)
    api := transport.NewAPI(svc)
    api.Run(cfg.Port)
}
```

**Gain:** ~30 ms shaved off startup; CPU profile no longer shows reflection symbols; binary shrinks by ~300 KB. CI invoking the binary in 5,000 jobs/day saves ~2.5 minutes of cumulative wall time.

---

## Optimization 2 — Move from `fx` to `wire` to keep build-time safety without runtime cost

**Problem:** `fx` is great when you actually use its `Module` system and lifecycle hooks. If you mostly use it as "a fancy way to call constructors", you are paying reflection for no benefit and losing compile-time errors.

**Before (selection from a 50-provider `fx` setup):**
```go
fx.New(
    fx.Provide(/* 50 funcs */),
    fx.Invoke(start),
).Run()
```
Misconfiguration is a runtime panic. Cold start ~25 ms heavier than necessary.

**After (`wire`):**
```go
//go:build wireinject
func InitializeApp() (*App, func(), error) { panic(wire.Build(AllProviders)) }
```
`wire generate` produces direct constructor calls. Build-time verification of the entire graph.

**Gain:** Compile-time errors instead of runtime ones. Zero reflection at startup. Same code your team already wrote, just generated.

---

## Optimization 3 — Group cleanup functions instead of stacking `defer`s

**Problem:** Manual wiring with many resources accumulates a wall of `defer`:

```go
db, _ := openDB()
defer db.Close()
redis, _ := openRedis()
defer redis.Close()
metrics, _ := openMetrics()
defer metrics.Close()
// ... eight more
```

Each `defer` adds a small allocation; more importantly, the order is implicit (LIFO via the defer stack), and a panic mid-function may skip cleanups depending on where it occurs.

**After:** explicit cleanup composition.
```go
var cleanups []func()
defer func() {
    for i := len(cleanups) - 1; i >= 0; i-- { cleanups[i]() }
}()
cleanups = append(cleanups, func() { db.Close() })
cleanups = append(cleanups, func() { redis.Close() })
```

**Gain:** Slightly fewer allocations; far easier to reason about ordering; works seamlessly with `wire`'s cleanup convention.

---

## Optimization 4 — Drop unnecessary interfaces

**Problem:** Reflexive interface-everywhere produces noise:

```go
type Adder interface { Add(a, b int) int }
type realAdder struct{}
func (realAdder) Add(a, b int) int { return a + b }
```

There is no second implementation, no test fake (the test of `Add` is trivial without one), no swap planned. The interface is overhead.

**After:**
```go
func Add(a, b int) int { return a + b }
```

**Gain:** Less code, no indirect call, no boxing into an interface value. Apply the rule: no interface without a second implementation in sight (real + fake, or two reals).

---

## Optimization 5 — Narrow huge interfaces to per-consumer slices

**Problem:** A `UserRepo` with 47 methods, satisfied by a real DB-backed struct. Every consumer either accepts the full `UserRepo` (heavy coupling) or implements all 47 methods in fakes (test bloat).

**After:** each consumer declares its own two- or three-method interface.

```go
// in orderservice:
type Users interface {
    GetByID(ctx context.Context, id string) (User, error)
}

func New(u Users) *Service { ... }
```

**Gain:** Fakes drop from 47 methods to 1–3. The dependency direction is inverted — domain code depends on abstractions it owns. No code change in the producer.

---

## Optimization 6 — Replace single-method interfaces with function values

**Problem:** A one-method interface is wasteful syntax for "a function that does X":

```go
type IDGen interface { New() string }
type uuidGen struct{}
func (uuidGen) New() string { return uuid.NewString() }

func NewService(g IDGen) *Service { ... }
```

**After:** inject the function directly.

```go
type GenID func() string

func NewService(g GenID) *Service { ... }

// caller:
NewService(uuid.NewString)
```

**Gain:** Fewer types; smaller fakes (`func() string { return "fixed" }` is a one-liner test double); often slightly less binary code.

---

## Optimization 7 — Construct expensive things once, share them

**Problem:** Constructors that allocate connections re-run more often than they should. A handler that calls `sql.Open` per request is a textbook example.

**Before:**
```go
func handle(w http.ResponseWriter, r *http.Request) {
    db, _ := sql.Open("postgres", dsn) // wrong place
    defer db.Close()
    // ...
}
```

**After:**
```go
type Server struct{ db *sql.DB }

func main() {
    db, _ := sql.Open("postgres", dsn)
    srv := &Server{db: db}
    http.HandleFunc("/", srv.handle)
    http.ListenAndServe(":8080", nil)
}
```

**Gain:** No connection-pool churn; predictable resource usage; easier to apply DI further (the `*sql.DB` is now a bona fide dependency instead of a per-request shadow).

---

## Optimization 8 — Inject a no-op rather than nil for optional dependencies

**Problem:** Optional dependencies (metrics, tracer) are often modelled as nilable interface fields, leading to nil checks at every call site:

```go
if s.metrics != nil { s.metrics.Inc(...) }
```

**After:** wire a no-op by default.

```go
type noopMetrics struct{}
func (noopMetrics) Inc(string) {}

func New(m Metrics) *Service {
    if m == nil { m = noopMetrics{} }
    return &Service{m: m}
}
```

**Gain:** Cleaner call sites. No nil-interface trap risk. Marginal CPU win because the no-op is in-lined to a noop function call by the compiler in many cases.

---

## Optimization 9 — Construct loggers once with stable handler

**Problem:** Re-creating a logger per request (or per package init) is a frequent micro-mistake:

```go
func handle(w http.ResponseWriter, r *http.Request) {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil)) // per-request
    // ...
}
```

**After:** construct once in `main`, attach request-scoped fields via `logger.With(...)`:

```go
func main() {
    base := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    // pass `base` down
}

func (s *Server) handle(w http.ResponseWriter, r *http.Request) {
    log := s.logger.With("req_id", reqID(r))
    // log is cheap (it's a wrapper, not a new handler)
}
```

**Gain:** Handler initialisation cost is paid once per process. `With` is allocation-light and explicitly designed for the per-request use case.

---

## Optimization 10 — Eliminate `reflect.Type`-keyed maps in hand-rolled containers

**Problem:** A team built a `Container` that stores values keyed by `reflect.Type`. Every read does a `reflect.TypeOf(...)` and a map lookup. In a hot path this shows up.

**After:** delete the container; use plain constructors. If a runtime container is genuinely needed, switch to `dig` (which is at least optimised by people whose job is to optimise `dig`).

**Gain:** Lookups vanish from the profile. Bonus: nobody can register the wrong type any more.

---

## Optimization 11 — Run `wire generate` in CI, fail PRs on drift

**Problem:** `wire`'s build-time guarantees evaporate if `wire_gen.go` is stale relative to the providers.

**Solution:**
```yaml
# .github/workflows/ci.yml
- run: go generate ./...
- run: git diff --exit-code
```

**Gain:** No stale generated code in `main`. Catches "I forgot to regen" before review.

---

## Optimization 12 — Lazy-initialise rarely-used dependencies

**Problem:** A binary's `main` constructs every component up-front, including a heavy machine-learning model that 90% of invocations never touch. Cold start is dominated by this one constructor.

**After:** wrap the heavy dependency in a `sync.OnceValue` so it constructs on first use.

```go
type ModelHolder struct {
    once sync.Once
    val  *Model
    err  error
}

func (h *ModelHolder) Get() (*Model, error) {
    h.once.Do(func() { h.val, h.err = LoadModel() })
    return h.val, h.err
}

func main() {
    holder := &ModelHolder{}
    svc := NewService(holder)
    // ... model is loaded only if and when svc actually uses it
}
```

**Gain:** Cold start drops dramatically when the rare path is rare. The dependency is still injected — it is just lazy.

---

## Optimization 13 — Use `wire.Bind` to make impl swaps explicit and statically checked

**Problem:** A team toggles between `Postgres` and `SQLite` repos with environment-conditional `if` statements scattered through `main`.

**After:** declare two `wire.NewSet`s, one per environment.

```go
var ProdSet = wire.NewSet(repo.NewPostgresUsers, wire.Bind(new(orders.UserRepo), new(*repo.PostgresUsers)))
var DevSet  = wire.NewSet(repo.NewSQLiteUsers,   wire.Bind(new(orders.UserRepo), new(*repo.SQLiteUsers)))
```

`main` picks the set, `wire` produces a compile-time-verified injector for each.

**Gain:** Implementation swaps are tracked statically. `wire` complains at build time if a binding is ambiguous or missing.

---

## Optimization 14 — Replace `fx.In` parameter objects with explicit positional parameters

**Problem:** `fx.In` structs hide which parameters are dependencies and which are configuration. They make signatures harder to read and slow down `dig` reflection (more fields to inspect).

**After:** declare positional parameters.

```go
// Before:
type Params struct {
    fx.In
    DB *sql.DB
    Logger *slog.Logger
    Metrics Metrics
}
func NewService(p Params) *Service { ... }

// After:
func NewService(db *sql.DB, logger *slog.Logger, metrics Metrics) *Service { ... }
```

`fx.Provide(NewService)` still works; reflection cost drops; the signature is a contract you can read at a glance.

**Gain:** Less reflection, more readable code, fewer surprises.

---

## Optimization 15 — Preallocate the `Deps` struct path-through

**Problem:** A `Deps`-style constructor copies eight pointers each time it is invoked. Even for singletons created once, the same `Deps` value sometimes flows through several layers, and each layer copies eight words.

**After:** pass `*Deps` (pointer to the struct) when the struct has more than ~5 fields.

```go
func New(d *Deps) *Service { ... }
```

**Gain:** Marginal — but noticeable when `Deps` has many fields and is passed through many layers. More importantly, mutations to the underlying struct are visible to all callers (sometimes desired, sometimes a bug — choose deliberately).

---

## Optimization 16 — Stop wrapping every dependency in a "facade"

**Problem:** A service wraps every dependency in a "facade" interface "for testability":

```go
type DBFacade interface { ... }
type RedisFacade interface { ... }
type StripeFacade interface { ... }
type S3Facade interface { ... }
```

Every facade is a one-implementation interface, every test mocks the facade. The boilerplate is huge; the wins are imaginary.

**After:** keep facades only where you genuinely have alternative implementations or test fakes that benefit from the seam. Direct concrete-type usage is fine for things that *aren't* swapped.

**Gain:** Hundreds of lines of facade code disappear. Tests that needed the facade move to component-level (with a real local DB).

---

## Optimization 17 — Stop logging through three layers of wrappers

**Problem:** Each layer wraps the logger to "add context":

```go
serviceLogger := baseLogger.With("layer", "service")
repoLogger    := serviceLogger.With("layer", "repo")
sqlLogger     := repoLogger.With("layer", "sql")
```

Three logger objects per request, three handler chains, three "context" merges per write.

**After:** add the context once, at the request boundary, and let the logger flow downstream unchanged.

```go
log := baseLogger.With("req_id", reqID, "user_id", userID)
// pass log into handler -> service -> repo -> sql, no rewraps
```

**Gain:** One `With` call instead of N. Lower allocation rate per request. Logs still carry the same context.

---

## Optimization 18 — Trim `wire` provider sets to remove unused providers

**Problem:** `wire` allows a provider in the set to be unused — but unused providers force you to import their packages, which slows compilation and pollutes binary symbol tables.

**After:** periodically prune. The `wire check` (paraphrased command in newer versions) and `go vet` reveal unreachable providers. Delete them.

**Gain:** Smaller binary. Faster compilation. Fewer transitive packages to vendor or scan for vulnerabilities.

---

## Summary of expected gains

| Optimization | Typical gain |
|--------------|--------------|
| `fx` → manual / `wire` (cold start) | 10–50 ms per startup |
| Drop unused interfaces | Micro-allocations + clarity |
| Narrow huge interfaces | Test bloat down sharply |
| No-op default for optionals | Cleaner code, fewer panics |
| Lazy heavy deps with `sync.OnceValue` | Cold start −90% for rare paths |
| `wire.Bind` for swaps | Build-time safety |
| `fx.In` → positional | Readability + small reflection win |

The largest gains, by a wide margin, come from *deleting* DI machinery you do not need — not from tuning the machinery you have. The rule of optimisation in DI is the same as elsewhere: measure before, measure after, and prefer simpler shapes over fancier ones.
