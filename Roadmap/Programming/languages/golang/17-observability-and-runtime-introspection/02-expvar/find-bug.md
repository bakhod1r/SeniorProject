# The `expvar` Package — Find the Bug

> Each snippet contains a real-world bug related to publishing variables with `expvar`. The package exposes public variables as JSON at `/debug/vars`; importing it registers that handler on `http.DefaultServeMux` and publishes `cmdline` and `memstats`. Every published value satisfies `Var { String() string }`, and `String()` must return *valid JSON*. Find the bug, explain it, fix it.

---

## Bug 1 — Endpoint 404s because of a custom mux

```go
func main() {
    requests := expvar.NewInt("requests")
    mux := http.NewServeMux()
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        requests.Add(1)
        w.Write([]byte("ok"))
    })
    http.ListenAndServe(":8080", mux) // custom mux
}
```

```bash
$ curl -i localhost:8080/debug/vars
HTTP/1.1 404 Not Found
```

**Bug:** Importing `expvar` registers `/debug/vars` on `http.DefaultServeMux`, but this server serves a *custom* mux. The auto-registration is unused, so the endpoint 404s.

**Fix:** mount the handler explicitly on the mux you serve:

```go
mux.Handle("/debug/vars", expvar.Handler())
```

`expvar.Handler()` returns the same handler the package registers by default.

---

## Bug 2 — Duplicate published name crashes at startup

```go
var requests = expvar.NewInt("requests")

func setupMetrics() {
    // intended to "ensure" the counter exists
    requests = expvar.NewInt("requests")
}
```

```bash
$ ./app
log.Fatal: Reuse of exported var name: requests
```

**Bug:** `NewInt` calls `Publish`, which `log.Fatal`s if the name already exists. The package-level `var` already published `"requests"`; `setupMetrics` publishes it a second time and kills the process.

**Fix:** publish each name exactly once. Don't re-publish; reuse the existing variable:

```go
var requests = expvar.NewInt("requests")

func setupMetrics() {
    // requests already exists; just use it.
}
```

There is no `Unpublish` and no idempotent publish — names are permanent.

---

## Bug 3 — Custom `Var` returns invalid JSON

```go
type status struct{ state string }

func (s status) String() string {
    return s.state // e.g. "healthy"
}

func main() {
    expvar.Publish("status", status{state: "healthy"})
    http.ListenAndServe(":8080", nil)
}
```

```bash
$ curl localhost:8080/debug/vars | jq .
parse error: Invalid numeric literal at line 2
```

**Bug:** `String()` returns the bare word `healthy`, which is not valid JSON. The handler splices each var's `String()` verbatim, so the whole document becomes `"status": healthy` — invalid — and the entire `/debug/vars` response fails to parse.

**Fix:** always emit valid JSON, with a safe fallback on error:

```go
func (s status) String() string {
    b, err := json.Marshal(s.state)
    if err != nil {
        return "null"
    }
    return string(b) // "healthy"  (quoted)
}
```

---

## Bug 4 — Hand-maintained gauge drifts

```go
var conns = expvar.NewInt("active_connections")

func handle(c net.Conn) {
    conns.Add(1)
    defer conns.Add(-1)
    process(c) // may panic
}
```

```bash
$ curl localhost:8080/debug/vars | jq .active_connections
734        # but only 12 connections are actually open
```

**Bug:** The gauge is maintained by hand with `Add(1)`/`Add(-1)`. The `defer` covers panics here, but in real code a decrement path is eventually missed (early return before the defer, a goroutine that exits abnormally, a refactor), and the gauge drifts upward forever.

**Fix:** compute the gauge on read with a `Func` over the live value, so it cannot drift:

```go
expvar.Publish("active_connections", expvar.Func(func() any {
    return connTracker.Count() // reads the live, authoritative count
}))
```

A computed-on-read gauge has no stored state to desynchronize.

---

## Bug 5 — `/debug/vars` exposed on the public port

```go
import (
    _ "expvar"
    _ "net/http/pprof"
    "net/http"
)

func main() {
    http.HandleFunc("/api/", apiHandler)
    http.ListenAndServe(":8080", nil) // public, default mux
}
```

```bash
$ curl http://your-service.example.com/debug/vars
{"cmdline":["/app","-db-password=hunter2"],"memstats":{...}}
```

**Bug:** Serving the *default* mux on a public port, with `expvar` and `pprof` imported, exposes `/debug/vars` and `/debug/pprof/*` to the internet. `cmdline` leaks the command line — here including a password passed as a flag — and `memstats` leaks runtime behaviour.

**Fix:** never serve the default mux publicly. Public traffic on a custom mux; debug endpoints on a gated internal listener:

```go
public := http.NewServeMux()
public.HandleFunc("/api/", apiHandler)

debug := http.NewServeMux()
debug.Handle("/debug/vars", expvar.Handler())
// (mount pprof on debug too)

go http.ListenAndServe("127.0.0.1:6060", debug)
http.ListenAndServe(":8080", public)
```

And don't pass secrets as flags.

---

## Bug 6 — `Func` panics and breaks the endpoint

```go
var cache map[string]int // nil until init

func main() {
    expvar.Publish("cache_size", expvar.Func(func() any {
        return len(cache) // fine on nil, but...
    }))
    expvar.Publish("first_key", expvar.Func(func() any {
        for k := range cache {
            return k
        }
        return cache["missing"] // ok
    }))
    // a later refactor:
    expvar.Publish("ratio", expvar.Func(func() any {
        return total / count // count can be 0
    }))
    http.ListenAndServe(":8080", nil)
}
```

```bash
$ curl localhost:8080/debug/vars
panic: runtime error: integer divide by zero
```

**Bug:** A `Func` body runs on every read, on the HTTP request goroutine. The `ratio` function divides by `count`, which can be zero, panicking the handler and failing the whole `/debug/vars` request.

**Fix:** make read-path code panic-free:

```go
expvar.Publish("ratio", expvar.Func(func() any {
    if count == 0 {
        return 0.0
    }
    return float64(total) / float64(count)
}))
```

Keep `Func` bodies simple, cheap, and incapable of panicking.

---

## Bug 7 — Expensive `Func` makes every scrape slow

```go
expvar.Publish("db_row_count", expvar.Func(func() any {
    var n int
    db.QueryRow("SELECT count(*) FROM big_table").Scan(&n) // 800ms
    return n
}))
```

```bash
$ time curl localhost:8080/debug/vars
real    0m0.840s
```

**Bug:** The `Func` runs a slow database query on *every* read of `/debug/vars`. Each scrape pays 800ms, holds the registry read lock, and a frequent scraper hammers the database. The whole endpoint is as slow as its slowest `Func`.

**Fix:** compute expensive values on a background timer and cache them; the `Func` returns the cached value cheaply:

```go
var rowCount atomic.Int64

func init() {
    go func() {
        for range time.Tick(30 * time.Second) {
            var n int64
            db.QueryRow("SELECT count(*) FROM big_table").Scan(&n)
            rowCount.Store(n)
        }
    }()
}

expvar.Publish("db_row_count", expvar.Func(func() any {
    return rowCount.Load() // cheap
}))
```

---

## Bug 8 — Reading a var with `Get` and not nil-checking

```go
func currentRequests() int64 {
    v := expvar.Get("requests")
    return v.(*expvar.Int).Value() // panics if "requests" was never published
}
```

```bash
panic: interface conversion: expvar.Var is nil, not *expvar.Int
```

**Bug:** `expvar.Get` returns `nil` for an unknown name (there is no `(Var, ok)` form). Type-asserting `nil` to `*expvar.Int` panics.

**Fix:** nil-check before asserting:

```go
func currentRequests() int64 {
    v := expvar.Get("requests")
    if v == nil {
        return 0
    }
    iv, ok := v.(*expvar.Int)
    if !ok {
        return 0
    }
    return iv.Value()
}
```

---

## Bug 9 — Test suite crashes on the second test

```go
func TestServiceA(t *testing.T) {
    reqs := expvar.NewInt("requests")
    // ...
}

func TestServiceB(t *testing.T) {
    reqs := expvar.NewInt("requests") // log.Fatal on the second run
    // ...
}
```

```bash
$ go test ./...
log.Fatal: Reuse of exported var name: requests
FAIL    (process exited)
```

**Bug:** Both tests publish `"requests"` into the *global* registry. The second `NewInt` `log.Fatal`s, and `log.Fatal` cannot be recovered — the whole test binary dies.

**Fix:** don't publish from unit tests. Inject an *unpublished* var and assert on it directly:

```go
func TestServiceA(t *testing.T) {
    reqs := new(expvar.Int) // not published, no registry touch
    svc := NewService(reqs)
    // ... assert reqs.Value()
}
```

Decouple counting (a `*expvar.Int` the logic uses) from publishing (done once in production wiring).

---

## Bug 10 — Library publishes to the global registry

```go
// package httputil (a reusable library)
var Requests = expvar.NewInt("http_requests")

func Middleware(next http.Handler) http.Handler { /* Requests.Add(1) */ }
```

```bash
$ ./app   # app also defines expvar.NewInt("http_requests")
log.Fatal: Reuse of exported var name: http_requests
```

**Bug:** A reusable library publishes into the process-global registry. It collides with the application's identically-named var (or with a second user of the library), crashing startup. It also forces `/debug/vars` registration on every consumer.

**Fix:** libraries expose values; applications publish. Return the counter (or accept a sink); let the app name and publish it:

```go
// library: hand the metric back, don't publish it
func NewMiddleware(requests *expvar.Int) func(http.Handler) http.Handler { ... }

// application: owns the registry
var reqs = expvar.NewInt("http_requests")
mw := httputil.NewMiddleware(reqs)
```

---

## Bug 11 — Faking labels with concatenated `Map` keys

```go
var reqs = expvar.NewMap("requests")

func handle(method, route, status string) {
    key := method + "|" + route + "|" + status // {GET|/api/users/123|200}
    reqs.Add(key, 1)
}
```

```bash
$ curl localhost:8080/debug/vars | jq '.requests | keys | length'
148732     # one key per unique (method, route-with-id, status) tuple
```

**Bug:** Concatenating dimensions into a single `Map` key explodes cardinality — every unique tuple (including high-cardinality path IDs) becomes a permanent key. Memory grows unbounded and the JSON becomes unusable. `expvar` has no real labels; this abuses `Map` keys.

**Fix:** keep `Map` keys low-cardinality (e.g. status code only), strip IDs from routes, and — if you genuinely need multi-dimensional labels — use a metrics library built for them:

```go
var byStatus = expvar.NewMap("requests_by_status")
byStatus.Add(status, 1) // one low-cardinality dimension
```

For `{method, route, status}` with real route templates, use the Prometheus client.

---

## Bug 12 — `String` used where raw JSON was intended

```go
var config = expvar.NewString("config")

func main() {
    j, _ := json.Marshal(map[string]any{"workers": 8, "debug": true})
    config.Set(string(j)) // sets to the JSON text of an object
    http.ListenAndServe(":8080", nil)
}
```

```bash
$ curl localhost:8080/debug/vars | jq .config
"{\"workers\":8,\"debug\":true}"   # a STRING, not an object
```

**Bug:** `String` always JSON-*quotes* its value. Setting it to a JSON document produces a JSON *string* containing escaped JSON — not a JSON object. Consumers get a string they must double-decode.

**Fix:** to expose a JSON *object*, use a `Func` (or a custom `Var`) that returns the value to be marshaled, not a pre-stringified blob:

```go
expvar.Publish("config", expvar.Func(func() any {
    return map[string]any{"workers": 8, "debug": true}
}))
// -> "config": {"workers":8,"debug":true}
```

`Func` marshals the returned value; `String` quotes whatever string you give it.

---

## Bug 13 — `Func` reads shared state without synchronization

```go
var queue []job // appended/popped by worker goroutines, no lock here

func main() {
    expvar.Publish("queue_depth", expvar.Func(func() any {
        return len(queue) // racy read
    }))
    http.ListenAndServe(":8080", nil)
}
```

```bash
$ go run -race .
WARNING: DATA RACE
  Read at ... by goroutine (expvar Func)
  Write at ... by worker goroutine
```

**Bug:** `expvar.Func` adds no synchronization. The function reads `queue` concurrently with worker goroutines mutating it — a data race. `expvar`'s thread-safety covers its *own* types, not the state your `Func` touches.

**Fix:** synchronize the shared state the `Func` reads — use the queue's existing lock, or an atomic counter:

```go
var depth atomic.Int64 // updated by workers on push/pop

expvar.Publish("queue_depth", expvar.Func(func() any {
    return depth.Load()
}))
```

---

## Bug 14 — Wrapping an `expvar.Int` in a redundant mutex

```go
type counter struct {
    mu sync.Mutex
    n  *expvar.Int
}

func (c *counter) inc() {
    c.mu.Lock()
    defer c.mu.Unlock()
    c.n.Add(1) // expvar.Int is ALREADY atomic
}
```

**Bug:** `expvar.Int.Add` is backed by `sync/atomic` and is already safe for concurrent use. Wrapping it in a mutex adds contention and overhead for no benefit, and misleads readers into thinking `Int` is unsafe.

**Fix:** drop the mutex; call `Add` directly:

```go
var n = expvar.NewInt("count")
// from any goroutine:
n.Add(1)
```

All built-in `expvar` types (`Int`, `Float`, `String`, `Map`) are concurrency-safe without external locking.

---

## Bug 15 — Counter incremented before the work, then early-returns

```go
var processed = expvar.NewInt("processed")

func process(item Item) error {
    processed.Add(1)            // counted as processed...
    if !valid(item) {
        return errBadItem       // ...but we returned without processing
    }
    return doWork(item)
}
```

```bash
$ curl localhost:8080/debug/vars | jq '{processed}'
{"processed": 10000}   # but 2000 were rejected and never processed
```

**Bug:** The counter is incremented at the *top* of the function, before the work is known to succeed. Items that fail validation still count as "processed," so the metric overstates real throughput.

**Fix:** increment only on the success path (and count rejects separately):

```go
var processed = expvar.NewInt("processed")
var rejected  = expvar.NewInt("rejected")

func process(item Item) error {
    if !valid(item) {
        rejected.Add(1)
        return errBadItem
    }
    if err := doWork(item); err != nil {
        return err
    }
    processed.Add(1) // only successes
    return nil
}
```

---

## Bug 16 — `Do` callback publishes a new var and deadlocks

```go
func mirrorVars() {
    expvar.Do(func(kv expvar.KeyValue) {
        // mirror each var under a prefixed name
        expvar.Publish("mirror_"+kv.Key, kv.Value) // deadlock
    })
}
```

```bash
$ ./app
# hangs: Do holds the registry read lock; Publish wants the write lock
```

**Bug:** `expvar.Do` holds the registry lock while calling the callback. Calling `Publish` from inside the callback tries to acquire the (write) lock the iteration already holds — a self-deadlock (or, depending on the lock, a fatal re-entrancy).

**Fix:** collect the work inside `Do`, then publish *after* iteration completes and the lock is released:

```go
type pair struct{ name string; v expvar.Var }
var toPublish []pair
expvar.Do(func(kv expvar.KeyValue) {
    toPublish = append(toPublish, pair{"mirror_" + kv.Key, kv.Value})
})
for _, p := range toPublish {
    expvar.Publish(p.name, p.v)
}
```

Never mutate the registry from inside `Do`.

---

## Bug 17 — Scraping `memstats` at high frequency

```yaml
# prometheus.yml
scrape_configs:
  - job_name: app
    scrape_interval: 1s          # very aggressive
    metrics_path: /debug/vars
```

```bash
# under load, GC pause and CPU climb noticeably
```

**Bug:** Every read of `/debug/vars` recomputes `memstats` by calling `runtime.ReadMemStats`, which has real cost (historically a stop-the-world). Scraping the full endpoint every second pays that cost continuously and perturbs the very process being observed.

**Fix:** scrape less aggressively, and expose only the specific numbers you need via cheap `Func`s instead of pulling the whole `memstats` blob on a tight interval:

```go
expvar.Publish("heap_alloc_bytes", expvar.Func(func() any {
    var m runtime.MemStats
    runtime.ReadMemStats(&m) // still costs, but scrape it slowly
    return m.HeapAlloc
}))
// and set scrape_interval to 15s+
```

Better still: use `runtime/metrics` or a metrics client for hot-path runtime numbers.

---

## Bug 18 — Renaming a published var breaks dashboards

```go
// before
var reqs = expvar.NewInt("requests")

// after a "cleanup" refactor
var reqs = expvar.NewInt("http_requests_total")
```

```bash
# every dashboard and scraper keyed on "requests" now reads null
```

**Bug:** Published names are an observability *contract*. Renaming `"requests"` to `"http_requests_total"` silently breaks every dashboard, alert, and scraper that read the old name — they now find nothing, with no error.

**Fix:** treat names as stable API. If you must rename, publish *both* during a deprecation window so consumers can migrate:

```go
var reqs = expvar.NewInt("http_requests_total")

func init() {
    // temporary alias for the old name
    expvar.Publish("requests", expvar.Func(func() any { return reqs.Value() }))
}
```

Remove the alias only after consumers have moved.

---

## Bug 19 — `init` order publishes before configuration

```go
var version = expvar.NewString("version") // published empty at init

func main() {
    version.Set(buildVersion()) // set later, in main
    http.ListenAndServe(":8080", nil)
}
```

This one is *not* a bug by itself — `Set` after publish is fine. But the next variant is:

```go
var built = expvar.NewString("built")

func init() {
    // forgot to Set it anywhere
}
```

```bash
$ curl localhost:8080/debug/vars | jq .built
""        # always empty
```

**Bug:** Publishing a `String` (or `Int`) reserves the name, but the value stays at its zero value (`""`, `0`) until something calls `Set`. A var published but never set silently reports the zero value, which looks like a real (wrong) reading.

**Fix:** set the value at startup, right after (or as part of) wiring:

```go
var built = expvar.NewString("built")

func main() {
    built.Set(time.Now().Format(time.RFC3339))
    // ...
}
```

Or use a `Func` so the value is always derived from a real source, never a stale zero.

---

## Bug 20 — Two servers, only one mounts `expvar`, scraper hits the wrong one

```go
func main() {
    expvar.NewInt("requests")

    debug := http.NewServeMux()
    debug.Handle("/debug/vars", expvar.Handler())
    go http.ListenAndServe("127.0.0.1:6060", debug)

    public := http.NewServeMux()
    public.HandleFunc("/", index)
    http.ListenAndServe(":8080", public)
}
```

```bash
# monitoring config:
$ curl localhost:8080/debug/vars   # 404 — scraping the PUBLIC port
```

**Bug:** The layout is correct (debug on an internal port), but the *scraper* is pointed at the public port `:8080`, which deliberately doesn't serve `/debug/vars`. The metric is published and served — just not where the scraper looks.

**Fix:** point the scraper at the debug listener:

```bash
$ curl localhost:6060/debug/vars   # correct
```

When you split public and debug listeners, update monitoring to scrape the debug address (and ensure it's reachable from the scraper).

---

## Bug 21 — Custom `Var` not safe for concurrent `String()` calls

```go
type histo struct {
    buckets map[int]int // mutated by record(); read by String()
}

func (h *histo) record(v int) { h.buckets[v/10]++ }      // writer
func (h *histo) String() string {
    b, _ := json.Marshal(h.buckets) // reader, concurrent with record()
    return string(b)
}
```

```bash
$ go run -race .
WARNING: DATA RACE   # String() reads buckets while record() writes it
```

**Bug:** The handler may call `String()` on any goroutine while application code calls `record()`. The custom `Var` shares an unsynchronized `map`, so reads and writes race (and a concurrent map read/write can also panic).

**Fix:** guard the shared state inside the custom `Var`:

```go
type histo struct {
    mu      sync.Mutex
    buckets map[int]int
}

func (h *histo) record(v int) { h.mu.Lock(); h.buckets[v/10]++; h.mu.Unlock() }

func (h *histo) String() string {
    h.mu.Lock()
    b, err := json.Marshal(h.buckets)
    h.mu.Unlock()
    if err != nil {
        return "null"
    }
    return string(b)
}
```

A custom `Var` is responsible for its own concurrency safety — `expvar` provides none for your types.

---

## Bug 22 — Blank import dropped by goimports, endpoint disappears

```go
import (
    "net/http"
    // _ "expvar"   <- removed by an editor "organize imports" pass
)

func main() {
    http.ListenAndServe(":8080", nil)
}
```

```bash
$ curl -i localhost:8080/debug/vars
HTTP/1.1 404 Not Found
```

**Bug:** The only thing wiring up `/debug/vars` was the blank import `_ "expvar"`. A tooling pass (goimports/IDE "remove unused imports") sees no referenced symbol and deletes it, silently removing the endpoint registration. Nothing references `expvar`, so nothing complains.

**Fix:** if you rely on the side effect, make the dependency explicit and tool-stable — either reference the package (so it's not "unused"), or keep the blank import with a comment that signals intent:

```go
import (
    _ "expvar" // registers /debug/vars on the default mux — do not remove
    "net/http"
)
```

Better in non-trivial servers: mount `expvar.Handler()` explicitly on a mux you control, which makes the dependency a real reference that tooling won't drop.

---

## Summary

`expvar` looks trivial — publish a number, read JSON — but the bugs cluster around a few recurring misunderstandings:

1. **The endpoint lives on a specific mux.** Importing `expvar` registers on `http.DefaultServeMux`; a custom mux (the right choice for public traffic) needs an explicit `expvar.Handler()` mount, and a dropped blank import silently removes the endpoint. Know *which* mux serves `/debug/vars`, and scrape the right listener.

2. **The registry is global, permanent, and fatal on duplicates.** Re-publishing a name `log.Fatal`s; libraries that publish collide; tests that publish crash. Decouple counting from publishing, let applications own the namespace, and inject unpublished vars in tests.

3. **`String()` is spliced raw and must be valid JSON.** A custom `Var` returning non-JSON poisons the whole document; `String` always quotes (so it's wrong for raw JSON objects — use `Func`). Custom `Var`s and `Func`s must also be panic-free and synchronize any shared state they read, because `expvar` protects only its own types.

4. **The read path runs on every scrape.** `Func` bodies and `memstats` recompute per read; keep them cheap (cache expensive values), and never expose `/debug/vars` publicly, because `cmdline` and `memstats` leak operational detail.

Treat `expvar` as a small, sharp tool: publish once under stable names, emit valid JSON, keep reads cheap and safe, and gate the endpoint.
