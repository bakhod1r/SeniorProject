# The `expvar` Package — Optimization

> Honest framing first: `expvar` is already cheap. An `Int.Add` is one atomic instruction; the registry does nothing until somebody reads `/debug/vars`. The command itself is rarely the bottleneck. What is genuinely worth optimizing is the *design and workflow* around `expvar`: keeping the read path cheap, keeping the endpoint safe, choosing the right type for each measurement, and — most importantly — recognizing when `expvar` is the wrong tool and a real metrics library would serve you better.
>
> Each entry below states the problem, shows a "before" and an "after", and the realistic gain. The closing sections cover measurement and the cases where `expvar` is the wrong choice.

---

## Optimization 1 — Cache expensive `Func` values off the read path

**Problem:** A `Func` runs on *every* read of `/debug/vars`, on the request goroutine, under the registry read lock. An expensive `Func` (a query, a deep computation) makes the whole endpoint as slow as that one function, and a frequent scraper pays the cost repeatedly.

**Before:**
```go
expvar.Publish("db_rows", expvar.Func(func() any {
    var n int
    db.QueryRow("SELECT count(*) FROM big").Scan(&n) // 500ms each scrape
    return n
}))
```

**After:**
```go
var dbRows atomic.Int64
go func() {
    for range time.Tick(30 * time.Second) {
        var n int64
        db.QueryRow("SELECT count(*) FROM big").Scan(&n)
        dbRows.Store(n)
    }
}()
expvar.Publish("db_rows", expvar.Func(func() any { return dbRows.Load() }))
```

**Expected gain:** `/debug/vars` read time drops from hundreds of milliseconds to microseconds, the database stops being hit per scrape, and the registry read lock is held briefly. The value is at most 30s stale — usually fine for introspection.

---

## Optimization 2 — Use `Int` over `Func` for hot counters

**Problem:** Some teams reach for `Func` reflexively, even for plain counters. A `Func` is recomputed (and JSON-marshaled) on every read; an `Int` is a lock-free atomic add on write and a trivial format on read.

**Before:**
```go
var n int64
expvar.Publish("requests", expvar.Func(func() any {
    return atomic.LoadInt64(&n)
}))
// hot path: atomic.AddInt64(&n, 1)
```

**After:**
```go
var requests = expvar.NewInt("requests")
// hot path: requests.Add(1)
```

**Expected gain:** Simpler code, and the read path avoids a function call plus `json.Marshal`. For a counter (only goes up), `Int` is the correct type; reserve `Func` for genuinely *computed* values (gauges, derived metrics).

---

## Optimization 3 — Pre-create hot `Map` keys to avoid the creation race

**Problem:** The first `Map.Add` to a *new* key pays for race-free creation (`LoadOrStore`) plus sorted-key bookkeeping. For a known, hot set of keys, paying that on the hot path is avoidable.

**Before:**
```go
var byStatus = expvar.NewMap("http_status")
// every request: byStatus.Add(code, 1)  // first add per code creates the key
```

**After:**
```go
var byStatus = expvar.NewMap("http_status")
func init() {
    // pre-create the common keys at startup
    for _, code := range []string{"200", "400", "404", "500"} {
        byStatus.Add(code, 0)
    }
}
// hot path: byStatus.Add(code, 1) // key already exists, cheap atomic add
```

**Expected gain:** Steady-state `Add`s to pre-created keys are a `sync.Map` load plus an atomic add — no creation cost, no sorted-key churn. Marginal per call, but it removes a latency cliff on first-seen keys and makes the key set predictable.

---

## Optimization 4 — Expose only the runtime numbers you need, not all of `memstats`

**Problem:** The default `memstats` var calls `runtime.ReadMemStats` on every read and serializes the *entire* struct (dozens of fields). If a scraper pulls `/debug/vars` frequently, that cost is paid continuously, and most of the fields are noise.

**Before:** Rely on the default `memstats`, scraped every few seconds — the full `ReadMemStats` runs each time and the payload is large.

**After:**
```go
expvar.Publish("heap_alloc_bytes", expvar.Func(func() any {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    return m.HeapAlloc
}))
expvar.Publish("num_gc", expvar.Func(func() any {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    return m.NumGC
}))
// and scrape modestly; or use runtime/metrics for hot-path numbers
```

**Expected gain:** Smaller payloads and the ability to scrape only the fields that matter. (Note `ReadMemStats` still costs per call; for high-frequency needs, `runtime/metrics` is the cheaper API.) The bigger win is scraping `memstats` *less often*.

---

## Optimization 5 — Separate public and debug listeners (security as the primary win)

**Problem:** Serving the default mux on a public port exposes `/debug/vars` (and `pprof`) to the internet, leaking `cmdline` and `memstats`. The "optimization" here is eliminating an information-disclosure vulnerability, which is worth more than any latency tweak.

**Before:**
```go
import _ "expvar"
http.ListenAndServe(":8080", nil) // public, default mux, debug exposed
```

**After:**
```go
public := http.NewServeMux()
public.HandleFunc("/api/", api)

debug := http.NewServeMux()
debug.Handle("/debug/vars", expvar.Handler())

go http.ListenAndServe("127.0.0.1:6060", debug) // internal only
http.ListenAndServe(":8080", public)            // no /debug/*
```

**Expected gain:** The public surface no longer leaks operational detail. Debug endpoints are reachable only from localhost (or wherever you gate them). This is the single most important change to make around `expvar`.

---

## Optimization 6 — Decouple counting from publishing for testability

**Problem:** Publishing inside business logic couples it to the global registry, makes unit tests crash on the duplicate-name `log.Fatal`, and prevents reuse. The cost is paid in test fragility and design rigidity, not CPU.

**Before:**
```go
func NewService() *Service {
    return &Service{requests: expvar.NewInt("requests")} // publishes globally
}
// second test constructing a Service -> log.Fatal
```

**After:**
```go
func NewService(requests *expvar.Int) *Service {
    return &Service{requests: requests}
}
// production wiring (once):
svc := NewService(expvar.NewInt("requests"))
// test:
svc := NewService(new(expvar.Int)) // unpublished, no registry touch
```

**Expected gain:** Tests no longer crash, run in isolation, and assert on the injected var directly. The global-registry coupling is confined to one wiring line you can later swap for Prometheus without touching the logic.

---

## Optimization 7 — Keep `Func` bodies lock-light

**Problem:** A `Func` that takes a heavily-contended lock to read shared state can stall on every scrape and add contention to the hot path it's measuring.

**Before:**
```go
expvar.Publish("queue_depth", expvar.Func(func() any {
    queueMu.Lock()         // same lock the hot path contends for
    defer queueMu.Unlock()
    return len(queue)
}))
```

**After:**
```go
var queueDepth atomic.Int64 // workers update on push/pop
expvar.Publish("queue_depth", expvar.Func(func() any {
    return queueDepth.Load() // lock-free read
}))
```

**Expected gain:** The read path no longer competes for the queue's lock, so scraping cannot perturb throughput. Maintaining a parallel atomic counter is cheaper than serializing the gauge read against the hot path.

---

## Optimization 8 — Mount `expvar.Handler()` explicitly instead of relying on the default mux

**Problem:** Relying on the implicit default-mux registration makes the endpoint's existence a side effect of an import — fragile (a dropped blank import removes it) and opaque (its exposure isn't visible in the code).

**Before:**
```go
import _ "expvar"          // wiring is invisible and tool-fragile
http.ListenAndServe(":6060", nil)
```

**After:**
```go
import "expvar"            // real reference, tooling won't drop it
mux := http.NewServeMux()
mux.Handle("/debug/vars", expvar.Handler())
http.ListenAndServe("127.0.0.1:6060", mux)
```

**Expected gain:** The endpoint's registration and location are explicit and reviewable, the dependency survives "organize imports," and you control the mux, path, and any middleware. No runtime cost — purely a robustness and clarity win.

---

## Optimization 9 — Keep `Map` keys low-cardinality

**Problem:** Treating a `Map` like a labeled metric and stuffing high-cardinality dimensions (user IDs, full paths) into keys makes the map grow without bound — memory leaks, an enormous JSON payload, and unusable output.

**Before:**
```go
reqs.Add(method + "|" + fullPath + "|" + userID, 1) // unbounded keys
```

**After:**
```go
reqs.Add(routeTemplate(r) , 1) // e.g. "/api/users/:id" — bounded
// or just status code:
byStatus.Add(strconv.Itoa(status), 1)
```

**Expected gain:** Bounded memory, a small readable payload, and a meaningful aggregation. If you genuinely need multi-dimensional, high-cardinality labels, that's the signal to move to a metrics library — `expvar` is the wrong tool for it (see "When NOT to use `expvar`").

---

## Optimization 10 — Bridge to a real metrics system instead of polling JSON forever

**Problem:** A monitoring stack that scrapes `/debug/vars` and screen-scrapes the JSON works, but it's brittle (the whole document breaks if one var emits bad JSON) and label-less. As needs grow, the JSON-polling glue becomes the bottleneck.

**Before:** External collector polls `/debug/vars`, JSON-decodes the whole body, and re-derives metrics every interval — fragile and unable to recover types or labels.

**After (in-process bridge as a transition):**
```go
// /metrics handler that walks the registry once and emits Prometheus text
func metrics(w http.ResponseWriter, r *http.Request) {
    expvar.Do(func(kv expvar.KeyValue) {
        switch v := kv.Value.(type) {
        case *expvar.Int:   fmt.Fprintf(w, "%s %d\n", kv.Key, v.Value())
        case *expvar.Float: fmt.Fprintf(w, "%s %g\n", kv.Key, v.Value())
        }
    })
}
```

**Expected gain:** Typed, robust translation that doesn't break on one malformed var, as a *stepping stone*. The real win is the eventual migration: instrument the high-value metrics natively in a metrics client, and keep `expvar` only as the debug window.

---

## Optimization 11 — Increment counters on the success path, accurately

**Problem:** A counter incremented at the top of a function (before the work succeeds) overstates throughput and produces misleading numbers — an accuracy "optimization" that matters more than performance.

**Before:**
```go
func process(it Item) error {
    processed.Add(1)        // counted before knowing it worked
    return doWork(it)
}
```

**After:**
```go
func process(it Item) error {
    if err := doWork(it); err != nil {
        failed.Add(1)
        return err
    }
    processed.Add(1)        // only real successes
    return nil
}
```

**Expected gain:** Counters mean what they say. `processed` reflects actual successes; `failed` is a separate, honest counter. Cheap to fix, and it prevents wrong conclusions during incidents.

---

## Optimization 12 — Gate the endpoint instead of relying on obscurity

**Problem:** Leaving `/debug/vars` reachable in-cluster "because nobody knows the path" is not a control — the path is documented and well-known. The cost of *not* gating it is a disclosure incident.

**Before:** Debug listener reachable from any pod in the cluster, no auth.

**After:**
```go
mux.Handle("/debug/vars", requireBearer(token, expvar.Handler()))
// or bind to 127.0.0.1 and restrict with a NetworkPolicy
```

**Expected gain:** `cmdline`/`memstats`/app vars are reachable only by authorized callers. `expvar.Handler()` is a plain `http.Handler`, so wrapping it with auth is a few lines. The "gain" is the absence of a leak.

---

## Optimization 13 — Stable, namespaced names to avoid churn

**Problem:** Ad-hoc, un-namespaced names collide (fatal) and get renamed casually (breaking dashboards). The cost is collisions at startup and broken monitoring after refactors.

**Before:** `expvar.NewInt("count")`, `expvar.NewInt("errors")` scattered across packages, prone to collision and rename.

**After:** `expvar.NewInt("db.queries")`, `expvar.NewInt("db.errors")`, `expvar.NewInt("http.requests")` — namespaced, owned by the application, documented as a contract; renames go through a deprecation alias.

**Expected gain:** No startup collisions, no silently-broken scrapers, and a self-grouping, readable `/debug/vars` document. Treat names like an API.

---

## Optimization 14 — Don't use `expvar` at all when you need real metrics

**Problem:** Building production metrics on `expvar` means contorting it — faking labels with `Map` keys, faking distributions with sum/count, computing rates in consumers. The "optimization" is to stop fighting the tool.

**Before:** A growing `expvar` setup with concatenated `Map` keys, manual sum/count "histograms," and a JSON-scraping collector — fragile and unqueryable.

**After:** Use the Prometheus client (typed counters/gauges/histograms, real labels, PromQL) or OpenTelemetry (vendor-neutral, unified signals) for the metrics that feed dashboards and alerts. Keep `expvar` (and `pprof`) only as an internal debug window.

**Expected gain:** Native histograms and labels, queryable metrics, robust scraping, and far less custom glue. The effort you'd spend bending `expvar` into a metrics platform is better spent adopting a tool built for it.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For `expvar` the useful signals are:

```bash
# How long does a scrape take? (dominated by your Funcs + memstats)
time curl -s localhost:6060/debug/vars > /dev/null

# How big is the payload?
curl -s localhost:6060/debug/vars | wc -c

# Is the document valid JSON? (one bad Var breaks everything)
curl -s localhost:6060/debug/vars | jq . > /dev/null && echo OK

# How many Map keys? (cardinality watch)
curl -s localhost:6060/debug/vars | jq '.requests_by_status | keys | length'

# Does a Func race against shared state?
go test -race ./...

# Is the public port leaking debug endpoints?
curl -i http://public-host:8080/debug/vars   # expect 404
```

Track scrape latency and payload size before and after each change. Pay particular attention to two signals: the cost of a single scrape (driven by your most expensive `Func` and by `memstats`), and the cardinality of any `Map` (an unbounded map is a slow memory leak).

---

## When NOT to Use `expvar`

`expvar` is a tool with a narrow sweet spot. It is the wrong choice when:

- **You need histograms or quantiles.** No native distribution support; sum/count gives you a mean and hides the tail. Use a histogram-capable metrics library.
- **You need multi-dimensional labels.** A `Map` is one dimension; faking more via concatenated keys explodes cardinality. Use real labels.
- **You need rates or metric metadata.** `expvar` exposes raw counters with no type, unit, or reset semantics; consumers must guess. A metrics format carries this.
- **The numbers feed dashboards and alerting your team already runs on Prometheus/OTel.** Don't add a second, weaker format; instrument natively.
- **The endpoint would be public and you can't gate it.** `cmdline`/`memstats` leak; if you can't put it behind a listener you control, don't expose it.

Use `expvar` when you have a concrete, modest need: a few counters and live `memstats` on an internal debug endpoint, zero dependencies, quick introspection during development or incidents. For anything beyond that, reach for a real metrics library and keep `expvar` as the debug window, not the metrics platform.

---

## Summary

`expvar` is not slow; the design and workflow around it are what reward attention. The wins come from keeping the read path cheap (cache expensive `Func` values, use `Int` for counters, keep `Func` bodies lock-light, expose only the `memstats` fields you need), keeping the endpoint safe (separate public and debug listeners, gate it, never serve the default mux publicly), and keeping the data honest (low-cardinality `Map` keys, success-path increments, stable namespaced names). Design for testability by decoupling counting from publishing, and mount the handler explicitly rather than relying on a fragile blank import.

The biggest optimization, though, is upstream of all of these: deciding honestly whether `expvar` is the right tool. For a couple of counters and live runtime stats on an internal endpoint, it is perfect and proportionate. For production metrics with labels, histograms, and alerting, the best optimization is to not use `expvar` for that at all — use a real metrics library, and keep `expvar` as the small, sharp introspection window it was designed to be.
