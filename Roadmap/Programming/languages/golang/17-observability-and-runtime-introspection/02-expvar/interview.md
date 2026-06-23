# The `expvar` Package — Interview Questions

> Practice questions ranging from junior to staff-level. Each has a model answer, common wrong answers, and follow-up probes.

---

## Junior

### Q1. What does the `expvar` package do?

**Model answer.** It publishes a program's public variables as JSON over HTTP at `/debug/vars`. Importing the package registers that handler on `http.DefaultServeMux` and publishes two defaults — `cmdline` (the command-line args) and `memstats` (runtime memory stats). Your code publishes counters, gauges, and maps with a handful of concurrency-safe types. It is a *pull* model: a client reads the current values; nothing is pushed.

**Common wrong answers.**
- "It's a metrics system like Prometheus." (No — it has no labels, histograms, or aggregation; it's raw JSON.)
- "It pushes metrics to a backend." (No — it's pull-only.)
- "I have to write the handler myself." (No — the import registers it.)

**Follow-up.** *Why is the import usually written `_ "expvar"`?* — Because most programs want only the side effect (registering `/debug/vars` and publishing the defaults); the blank import runs the package's `init` without referencing its names.

---

### Q2. What is the `Var` interface?

**Model answer.** A single-method interface:

```go
type Var interface { String() string }
```

Every published variable implements it. The rule is that `String()` must return a **valid JSON value**, because the handler splices each var's `String()` output verbatim into the JSON document. The built-in types all honour this; a custom `Var` must too.

**Common wrong answer.** "`String()` can return any text." (No — it must be valid JSON, or it corrupts the whole `/debug/vars` document.)

**Follow-up.** *What happens if a custom `Var` returns invalid JSON?* — The entire `/debug/vars` response becomes invalid, because values are concatenated raw. A scraper decoding the whole body drops everything.

---

### Q3. What are the built-in types?

**Model answer.** `Int` (thread-safe int64), `Float` (thread-safe float64), `String` (thread-safe string), `Map` (thread-safe key→`Var` map, for per-key counts), and `Func` (a `func() any` recomputed on each read, for gauges). You create-and-publish with `NewInt`/`NewFloat`/`NewString`/`NewMap`, or register an existing `Var` with `Publish(name, v)`.

**Follow-up.** *Counter or gauge — which type for each?* — Counter (only increases): `Int.Add(1)`. Gauge (up and down): a `Func` that reads the live value.

---

### Q4. Are `expvar` types safe to use from multiple goroutines?

**Model answer.** Yes, all of them. `Int` and `Float` are backed by `sync/atomic` (lock-free); `String` is stored atomically; `Map` is safe for concurrent use via an internal `sync.Map` plus a creation lock. You never need to add your own mutex. The only exception is `Func`: the *adapter* adds no synchronization, so if your function reads state another goroutine mutates, *that* state needs its own synchronization.

**Follow-up.** *Why is `Int.Add` cheap?* — It's a single atomic add, not a mutex acquisition, so it scales to very high call rates.

---

### Q5. Does `String.Set("v1")` output `v1` or `"v1"`?

**Model answer.** `"v1"` — quoted. `String.String()` returns the JSON-encoded string, because a bare string is not valid JSON. `Value()` returns the raw Go string `v1`; `String()` returns the JSON form `"v1"`. The difference is required by the valid-JSON contract.

**Common wrong answer.** "It outputs `v1`." (That would be invalid JSON.)

**Follow-up.** *What if you need raw JSON output, not a quoted string?* — Don't use `String`; write a custom `Var` (or a `Func`) that emits the JSON you want.

---

## Middle

### Q6. How does the global registry work, and why do duplicate names crash the program?

**Model answer.** There is one package-global registry per process: a `name → Var` map plus a sorted key list, guarded by a mutex. `Publish` adds to it; `Get` reads from it; there is no removal. If you publish a name that already exists, `Publish` calls `log.Fatal` and the process exits — because publication happens in `init`/`var` initializers with no error channel, and silently shadowing one var behind another would corrupt observability invisibly. Failing loud at startup is the deliberate choice.

**Follow-up.** *How does this affect tests?* — Two tests publishing the same name crash the second one, and `log.Fatal` can't be recovered. The fix is to inject unpublished vars in tests and publish once in production code.

---

### Q7. How do you serve `/debug/vars` on a custom mux?

**Model answer.** Use `expvar.Handler()`, which returns the same handler the package registers by default:

```go
mux := http.NewServeMux()
mux.Handle("/debug/vars", expvar.Handler())
```

You need this because the auto-registration is on `http.DefaultServeMux`; if you serve a *custom* mux, that registration is unused and the endpoint 404s unless you mount it yourself.

**Common wrong answer.** "It works automatically on any mux." (Only on the default mux.)

**Follow-up.** *Does importing `expvar` still touch the default mux if you use a custom one?* — Yes; the `init` always registers on the default mux. It's just inert if you never serve the default mux.

---

### Q8. How do you approximate labeled metrics with `expvar`?

**Model answer.** With a `Map`. A `Map` maps string keys to `Var`s; `Map.Add(key, n)` increments the `Int` under `key`, creating it if absent. So per-status-code counts become `statusCounts.Add("200", 1)`, rendered as `{"200": 5, "500": 2}`. This gives you *one* string dimension. It is not real labeling: there are no multi-dimensional labels, no histograms, no aggregation. For genuine labels you need a metrics library.

**Follow-up.** *Why not just create many named `Int`s, one per status?* — A `Map` is cleaner, groups related counts under one name, and creates keys dynamically; dozens of separate named `Int`s clutter the registry.

---

### Q9. What is `Func` and when do you use it?

**Model answer.** `Func` is `type Func func() any` adapted to `Var`. When the variable is read, the function is **called** and its result JSON-marshaled. Use it for gauges and any derived value — goroutine count, queue depth, uptime — because it's recomputed on every read and therefore never drifts. The caveats: the body runs on the HTTP request goroutine (keep it cheap and non-blocking), and a panic in it propagates into the handler.

**Common wrong answer.** "Use an `Int` and increment/decrement it for a gauge." (That drifts when a decrement path is missed; `Func` reads the live value.)

**Follow-up.** *What if the gauge is expensive to compute?* — Compute it on a background timer and have the `Func` return the cached value, so every scrape doesn't pay the cost.

---

### Q10. What do `cmdline` and `memstats` contain, and why do they matter for security?

**Model answer.** `cmdline` is `os.Args` — the binary path and every command-line flag. `memstats` is the full `runtime.MemStats` struct (heap size, GC counts, allocation totals), recomputed on each read via `runtime.ReadMemStats`. Both are disclosure risks: `cmdline` leaks configuration and any secret passed as a flag; `memstats` leaks runtime behaviour useful to an attacker profiling the service. This is why `/debug/vars` must never be exposed publicly.

**Follow-up.** *Where should the endpoint live instead?* — On an internal/localhost-bound admin listener, or behind authentication — never the public listener.

---

### Q11. How do you iterate all published variables in Go code?

**Model answer.** `expvar.Do(func(kv expvar.KeyValue){ ... })` walks the whole registry in sorted key order, giving each name/`Var` pair. `Map.Do` does the same for one map. Use it for shutdown snapshots, custom exporters, or test assertions. Note `Do` holds the registry read lock during iteration, so don't do slow work or publish new vars from inside the callback.

**Follow-up.** *How do you read a single var?* — `expvar.Get("name")`, which returns the `Var` or `nil`. Always nil-check before type-asserting.

---

### Q12. When is `expvar` enough, and when do you need Prometheus or OpenTelemetry?

**Model answer.** `expvar` is enough for quick introspection: a few counters, a gauge or two, live `memstats`, on an internal debug endpoint, with zero dependencies. It is *not* enough when you need histograms/quantiles (p99 latency), multi-dimensional labels, rates, or a metrics format your monitoring already scrapes. `expvar` is push-nothing, pull-JSON, untyped, and label-less. Use the Prometheus client when you need typed metrics and labels; use OpenTelemetry when you want vendor-neutral, unified telemetry across signals.

**Follow-up.** *Can you migrate from `expvar` to Prometheus cleanly?* — Yes, if you decoupled counting from publishing. Instrument behind an abstraction so the move is a wiring change, not a re-instrumentation.

---

## Senior

### Q13. Should a library publish to `expvar`? Why or why not?

**Model answer.** No. The registry is process-global with permanent names and a fatal duplicate-publish rule. A library that publishes `"requests"` will `log.Fatal` if two instances are linked or if the application uses the same name, and importing `expvar` for its side effect forces `/debug/vars` registration on every consumer whether they want it or not. The correct pattern: the library *exposes* metrics as values (returns `*expvar.Int`s or accepts a metrics sink), and the *application* decides whether and under what name to publish. Libraries instrument; applications wire.

**Follow-up.** *What if the library really wants out-of-the-box visibility?* — Expose the values and document them; let the app publish. Or accept an abstract metrics interface so the app can plug in `expvar`, Prometheus, or nothing.

---

### Q14. Explain the `DefaultServeMux` exposure problem and how to prevent it.

**Model answer.** Importing `expvar` (and very commonly `net/http/pprof`) registers handlers on `http.DefaultServeMux` during `init`. If any server serves the default mux — `http.ListenAndServe(addr, nil)` — those debug endpoints go live on that listener. If the listener is public, the endpoints are public, silently, with no explicit handler registration in the application code. It's insidious because the exposure is a transitive side effect of an import, possibly from deep in a dependency.

Prevention: never serve `http.DefaultServeMux` on a public listener. Build an explicit `*http.ServeMux` for public traffic (so the default-mux registrations are inert), and mount `/debug/vars` and `/debug/pprof` explicitly on a separate internal/localhost listener. In review, flag `ListenAndServe(addr, nil)` on anything public and audit blank imports of `expvar`/`pprof`.

**Follow-up.** *How do you make a debug endpoint reachable beyond localhost safely?* — Wrap `expvar.Handler()` in auth middleware (it's a plain `http.Handler`) and/or put it behind mTLS or an auth proxy.

---

### Q15. How is each built-in type made concurrency-safe?

**Model answer.**
- `Int` — `atomic.Int64`; `Add`/`Set`/`Value` are lock-free atomics.
- `Float` — `atomic.Uint64` storing the bit pattern; `Set`/`Value` are atomic; `Add` is a compare-and-swap loop because float addition isn't a single atomic instruction.
- `String` — an `atomic.Value` holding the string, so reads never see a torn write; `String()` returns the JSON-quoted form.
- `Map` — a `sync.Map` for key→value, with race-free key creation via `LoadOrStore` so concurrent first-writers to a new key don't create duplicate counters.
- `Func` — stateless; the function body's safety is the caller's responsibility.

None require a caller-supplied mutex.

**Follow-up.** *Was `String` always safe?* — In very old Go it used a plain mutex with a non-atomic path that could yield inconsistent reads; the modern atomic implementation fixed it. On supported Go (1.21+) it's fully consistent.

---

### Q16. How would you bridge existing `expvar` instrumentation into Prometheus?

**Model answer.** Two ways. In-process: walk the registry with `expvar.Do`, type-switch on `*expvar.Int`/`*expvar.Float`/`*expvar.Map`, and translate each into a Prometheus metric (gauges, mostly), falling back to parsing `String()` for `Func`/custom vars. Out-of-process: a standalone exporter polls `/debug/vars`, JSON-decodes it, and re-emits. Both are transitional glue — neither can recover histograms or multi-dimensional labels that `expvar` never carried. You re-expose flat numbers; you migrate the high-value metrics to native client instrumentation over time.

**Follow-up.** *Why not keep the bridge permanently?* — It inherits all of `expvar`'s expressiveness limits. It's a stopgap so you can stand up dashboards while migrating, not a destination.

---

### Q17. A scraper reports `/debug/vars` is "sometimes invalid JSON." Diagnose it.

**Model answer.** The handler splices each `Var.String()` verbatim, so one var returning invalid JSON corrupts the whole document. "Sometimes" points to a custom `Var` (or a `Func`) whose `String()` returns valid JSON on the happy path but invalid output on some path — e.g. a custom type returning a raw, unquoted string on an error branch, or a `Func` returning a value `json.Marshal` chokes on (a channel, a function, a `NaN` float). Find the offending var via `expvar.Do`, checking each `String()` for validity, and fix it to `json.Marshal` with a valid fallback (`"null"`) on error.

**Follow-up.** *Why does the whole document break, not just one key?* — Values are concatenated raw into one object; a single syntactically invalid value makes the entire object unparseable.

---

### Q18. Walk me through securely exposing `/debug/vars` in a Kubernetes service.

**Model answer.**
1. **Separate listeners.** Public traffic on the main port via an explicit mux that does *not* carry `/debug/*`. A second `http.Server` on a debug port for `/debug/vars` and `/debug/pprof`.
2. **Bind the debug port internally.** Ideally `127.0.0.1`, or a port not exposed in the Service/Ingress.
3. **Network policy.** A `NetworkPolicy` restricting the debug port to known sources (an ops namespace, a debugging sidecar).
4. **Auth if non-localhost.** If the debug port must be reachable in-cluster, wrap `expvar.Handler()` in auth or front it with mTLS.
5. **Audit disclosure.** Confirm `cmdline` carries no secrets (don't pass secrets as flags); review every published var for sensitive data.
6. **Never serve the default mux publicly,** so imported `expvar`/`pprof` registrations stay inert on the public path.

**Follow-up.** *Why not rely on the path being obscure?* — `/debug/vars` is a well-known, documented path; obscurity is not a control.

---

## Staff / Architect

### Q19. Design an observability strategy that starts with `expvar` and scales.

**Model answer.** Treat `expvar` as the first rung, behind an abstraction.

**Phase 1 — `expvar`.** Early service: a few counters and live `memstats` on an internal debug endpoint. Zero dependencies, proportionate. Crucially, instrument behind a small internal metrics interface — business logic calls `metrics.Inc("requests")`, not `expvar` directly — and wire it to `expvar` at the edge.

**Phase 2 — recognize the limits.** When the team wants "requests by route and status," p99 latency, or alerting, those are things `expvar` cannot express. The pain is the migration signal.

**Phase 3 — Prometheus or OTel.** Swap the *wiring* layer's implementation from `expvar` to the metrics client. Because the logic talks to the abstraction, this is a change at the edges, not a re-instrumentation. Keep the `expvar`/`pprof` debug endpoint on the internal port for ad-hoc introspection even after metrics graduate.

The architectural decision is the abstraction up front, which makes `expvar` a cheap start rather than a trap.

**Follow-up.** *What do you keep from `expvar` permanently?* — The debug endpoint for live introspection during incidents. The *metrics* graduate; the *window* stays.

---

### Q20. The global registry is a singleton with permanent names. What design consequences follow, and how do you contain them?

**Model answer.** Consequences: permanent names (renames are breaking changes), fatal duplicates (collisions crash startup), no isolation (one process-wide namespace), and test hostility (republishing crashes). Containment is architectural: **decouple measurement from publication.** Business code increments injected `*expvar.Int`s; one thin wiring layer publishes them once at startup. This confines the global-registry coupling to a single place, keeps logic testable (tests pass fresh, unpublished vars), avoids collisions (one owner of the namespace), and makes later migration to a different registry a localized change. It's the standard discipline for any global singleton: wrap it at the edge, don't let its reach spread.

**Follow-up.** *How does this help when you later adopt Prometheus?* — The logic depends on an abstraction, not on `expvar`; you reimplement only the wiring layer.

---

### Q21. How do you avoid `/debug/vars` becoming an operational footgun (slow scrapes, perturbing the process)?

**Model answer.** The read path runs every `Func` on the request goroutine under the registry read lock, and `memstats` calls `runtime.ReadMemStats` on each read. So:
- **Keep `Func` bodies cheap and panic-free.** Cache expensive values on a background timer; have `Func` return the cached number.
- **Don't scrape the full endpoint at high frequency** if it includes `memstats`; the `ReadMemStats` cost is paid per scrape and can perturb a busy process.
- **Expose only the specific numbers you need** via dedicated `Func`s rather than always pulling the whole `memstats` blob.
- **Watch lock duration:** a slow `Var.String()` holds the read lock and delays concurrent publication and other reads.
- **Document the endpoint** so on-call engineers know it's safe to poll and at what rate.

**Follow-up.** *How do you measure the cost?* — Benchmark a scrape, and watch the process's CPU/GC under a realistic scrape interval; if scraping moves those numbers, back off or trim what the endpoint computes.

---

### Q22. Compare `expvar` and `net/http/pprof` as runtime-introspection tools.

**Model answer.** They're siblings with the same default-mux pattern and the same security posture, but different jobs. `expvar` exposes *application and runtime variables* as JSON at `/debug/vars` — counters, gauges, `memstats` — for "what are the current numbers." `pprof` exposes *profiles* (CPU, heap, goroutine, block, mutex) at `/debug/pprof/*` for "where is the time/memory going." `expvar` is a flat snapshot; `pprof` produces profile data you analyze with `go tool pprof`. Both auto-register on `http.DefaultServeMux` on import, both leak operational detail, and both belong on a gated internal listener — never the public mux. In practice you mount them together on the debug port.

**Follow-up.** *Which do you reach for during a memory incident?* — `expvar`'s `memstats` for the live heap/GC numbers (cheap glance), then `pprof`'s heap profile to find *where* the allocations are.

---

## Quick-fire

| Q | Crisp answer |
|---|--------------|
| Endpoint path? | `/debug/vars`. |
| Push or pull? | Pull (JSON over HTTP). |
| Default vars? | `cmdline`, `memstats`. |
| The interface? | `Var { String() string }`, must return valid JSON. |
| Counter type? | `Int.Add`. |
| Gauge type? | `Func` (recomputed on read). |
| Labeled counts? | `Map` keys (one dimension only). |
| Duplicate name? | `log.Fatal` — process exits. |
| Concurrency-safe? | Yes — `Int`/`Float`/`String`/`Map` all are. |
| Custom mux? | Mount `expvar.Handler()`. |
| Safe to expose publicly? | No — gate it. |
| Histograms/labels? | No — use Prometheus/OTel. |

---

## Mock Interview Pacing

A 30-minute interview on `expvar` might cover:

- 0–5 min: warm-up — Q1, Q2, Q3.
- 5–15 min: middle topics — Q6, Q7, Q9, Q12.
- 15–25 min: a senior scenario — Q13, Q14, or Q17.
- 25–30 min: a curveball — Q19 or Q22.

If the candidate claims hands-on experience, drive straight to Q14 (default-mux exposure) and Q17 (invalid-JSON diagnosis) — both are field-test questions. If they've only read about `expvar`, stay in middle territory and probe whether they understand the custom-mux requirement (Q7) and the counter-vs-gauge distinction (Q9). A staff candidate should reach the observability-strategy question (Q19) within fifteen minutes and treat `expvar` as a deliberate first rung, not a metrics platform.
