# The `expvar` Package — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Global Registry and How Publication Works](#the-global-registry-and-how-publication-works)
3. [The `Var` Interface and the JSON Contract](#the-var-interface-and-the-json-contract)
4. [The Built-in Types in Depth](#the-built-in-types-in-depth)
5. [`Map`: Per-Key Counters Done Right](#map-per-key-counters-done-right)
6. [`Func`: Computed Values and Gauges](#func-computed-values-and-gauges)
7. [The Handler, `DefaultServeMux`, and Custom Muxes](#the-handler-defaultservemux-and-custom-muxes)
8. [The Concurrency Model](#the-concurrency-model)
9. [Iterating the Registry with `Do`](#iterating-the-registry-with-do)
10. [Writing a Custom `Var`](#writing-a-custom-var)
11. [Testing Code That Publishes Vars](#testing-code-that-publishes-vars)
12. [Common Errors and Their Real Causes](#common-errors-and-their-real-causes)
13. [When `expvar` Is Right and When It Is Wrong](#when-expvar-is-right-and-when-it-is-wrong)
14. [Best Practices for Real Codebases](#best-practices-for-real-codebases)
15. [Pitfalls You Will Meet in Real Projects](#pitfalls-you-will-meet-in-real-projects)
16. [Self-Assessment](#self-assessment)
17. [Summary](#summary)

---

## Introduction

You already know the mechanical effect of `expvar`: import it, get `/debug/vars`, publish counters with `NewInt`, gauges with `Func`. The middle-level questions are *how the registry actually behaves*, *what the JSON contract really demands*, *how the concurrency safety is implemented*, and *how to integrate the endpoint cleanly into a server that does not use the default mux*.

This file moves from "I can publish a counter" to "I understand the global registry, the `Var` contract, the locking model, and the integration seams well enough to debug a misbehaving endpoint and to write my own `Var`."

After reading this you will:
- Know exactly how the global registry stores and serves variables
- Understand the JSON contract every `Var` must honour, including the `String` quirk
- Use `Map`, `Func`, and custom `Var`s with full understanding of their semantics
- Mount `expvar` on a custom mux and reason about the default-mux coupling
- Explain the concurrency model: atomics for scalars, a mutex for `Map`
- Test code that publishes vars without the duplicate-name `log.Fatal` biting you

---

## The Global Registry and How Publication Works

`expvar` keeps a single, package-global registry: a map from `string` name to `Var`, plus a sorted list of keys and a `sync.RWMutex` guarding both. There is exactly one registry per process; you cannot create a second.

`Publish(name string, v Var)` does three things under the lock:

1. Checks whether `name` already exists. If it does, it calls `log.Fatalf("Reuse of exported var name: %s", name)` — the process exits.
2. Stores `name → v` in the map.
3. Appends `name` to the sorted key list (kept sorted so output is deterministic).

The `New*` constructors are thin wrappers:

```go
func NewInt(name string) *Int {
    v := new(Int)
    Publish(name, v)
    return v
}
```

So `NewInt`, `NewFloat`, `NewString`, and `NewMap` all funnel through `Publish` and inherit the duplicate-name behaviour.

Two consequences follow directly:

- **Names are permanent.** There is no `Unpublish`. The registry only grows for the life of the process.
- **The duplicate-name crash is a *startup* hazard.** Because publication usually happens in package `init` or in `var` initializers, a collision typically kills the program before `main` even runs — which is at least loud and early, not silent.

`Get(name string) Var` returns the stored `Var` or `nil`. Always nil-check it; there is no "ok" boolean.

---

## The `Var` Interface and the JSON Contract

The interface is one method:

```go
type Var interface {
    String() string
}
```

The handler serves `/debug/vars` by writing an opening `{`, then for each registered name (in sorted order) writing `"name": ` followed by the *raw output of that var's `String()`*, comma-separated, then a closing `}`.

The critical word is **raw**. The handler does *not* JSON-encode your `String()` output — it splices it in verbatim. Therefore `String()` must itself return a syntactically valid JSON value. If it returns `hello`, the document contains `"name": hello`, which is invalid JSON and corrupts the entire response. If it returns `"hello"`, the document contains `"name": "hello"`, which is correct.

This is why the built-in `String` type quotes itself: `String.String()` returns a JSON-encoded string (with quotes and escaping), because a bare string would be invalid JSON. People expecting `String.Set("v1")` to render `v1` are surprised — but the type is doing the only correct thing for the contract.

The practical rule for custom `Var`s: **build your output with `json.Marshal` and return the result**, or assemble a string you can prove is valid JSON.

---

## The Built-in Types in Depth

### `Int`

A 64-bit integer. Internally an `atomic.Int64` (modern Go). Methods:

- `Add(delta int64)` — atomic add.
- `Set(value int64)` — atomic store.
- `Value() int64` — atomic load.
- `String() string` — formats the value as a decimal integer (valid JSON number).

No mutex; the atomic does all the work. Calling `Add` from thousands of goroutines is correct and cheap.

### `Float`

A 64-bit float. Internally an `atomic.Uint64` storing the bit pattern, with `Add` implemented as a compare-and-swap loop (because float addition is not a single atomic instruction). Methods mirror `Int`: `Add`, `Set`, `Value`, `String`. `String()` formats with enough precision to round-trip and emits a valid JSON number.

### `String`

A string protected so that reads and writes are consistent. Methods: `Set(v string)`, `Value() string`, `String() string`. `Value()` returns the raw string; `String()` returns the *JSON-quoted* string. Internally it stores the value atomically (an `atomic.Value` holding a string in modern Go), so a reader never sees a torn write — historically this was a subtle area, and the modern implementation is fully consistent.

### `Map`

A concurrent map from `string` to `Var`. Covered in its own section below.

### `Func`

An adapter from a function to a `Var`. Covered in its own section below.

The asymmetry to remember: `Value()` returns the *Go* value; `String()` returns the *JSON* rendering. They differ for `String` (quotes) and are the same shape for numbers.

---

## `Map`: Per-Key Counters Done Right

`Map` is how `expvar` approximates labeled metrics. It maps string keys to `Var` values and is safe for concurrent use.

Methods:

- `Add(key string, delta int64)` — find or create an `Int` under `key`, add `delta`. Creates the key atomically if absent.
- `AddFloat(key string, delta float64)` — same, but the value is a `Float`.
- `Set(key string, v Var)` — store an arbitrary `Var` under `key`.
- `Get(key string) Var` — fetch (or `nil`).
- `Delete(key string)` — remove a key.
- `Do(f func(KeyValue))` — iterate, sorted by key.
- `Init() *Map` — reset to empty (returns the map for chaining).
- `String() string` — render as a JSON object, keys sorted.

Internally `Map` uses a `sync.Map` plus a mutex for the "create key if absent" race, so concurrent `Add`s to the *same new key* do not produce duplicate `Int`s. The first writer wins the creation; subsequent writers add to the same `Int`.

Typical use:

```go
var byStatus = expvar.NewMap("http_status")

byStatus.Add("200", 1)
byStatus.Add("500", 1)
// /debug/vars -> "http_status": {"200": 1, "500": 1}
```

`AddFloat` is useful for sum accumulators (e.g. `latency_sum`) that you later divide by a count to get an average — though if you need real latency distributions, you have outgrown `expvar`.

`Map.String()` sorts keys before emitting, so the JSON is deterministic across reads. Do not depend on insertion order; depend on sorted order if you must depend on anything.

---

## `Func`: Computed Values and Gauges

`Func` is a function type that satisfies `Var`:

```go
type Func func() any

func (f Func) Value() any     { return f() }
func (f Func) String() string { /* json.Marshal(f()) */ }
```

When the handler reads a `Func`, it *calls the function* and JSON-marshals the result. This makes `Func` ideal for any value that should reflect the *current* state at read time rather than an accumulated count:

```go
expvar.Publish("goroutines", expvar.Func(func() any {
    return runtime.NumGoroutine()
}))

expvar.Publish("queue_depth", expvar.Func(func() any {
    return len(workQueue)
}))

expvar.Publish("uptime_seconds", expvar.Func(func() any {
    return time.Since(start).Seconds()
}))
```

Two properties matter:

1. **Recomputed on every read.** A gauge built with `Func` never drifts, because there is no stored state to get out of sync — it reads the live value each time.
2. **The body runs on the HTTP request goroutine.** Keep it cheap and non-blocking. An expensive `Func` makes `/debug/vars` slow, and a panicking `Func` propagates into the handler. If you must read shared state, read it with whatever synchronization that state already requires.

The built-in `memstats` variable is itself a `Func` that calls `runtime.ReadMemStats` on each read — which is exactly why it is always current and also why frequent scraping has a cost.

---

## The Handler, `DefaultServeMux`, and Custom Muxes

`expvar`'s `init` does:

```go
http.HandleFunc("/debug/vars", expvarHandler)
```

This registers on `http.DefaultServeMux`. The package also exports `expvar.Handler()`, which returns the same `http.Handler` so you can mount it yourself.

The coupling has two faces:

- **If you serve the default mux** (`http.ListenAndServe(addr, nil)`), `/debug/vars` works automatically. So does `/debug/pprof` if you imported `net/http/pprof`. This is convenient and also the source of accidental exposure.
- **If you serve a custom mux** (`http.ListenAndServe(addr, mux)`), the auto-registration on the default mux is *unused*. You must mount `expvar.Handler()` on your mux explicitly to reach the endpoint.

```go
mux := http.NewServeMux()
mux.Handle("/debug/vars", expvar.Handler())
```

The professional pattern: serve public traffic from a custom mux that deliberately omits `/debug/*`, and serve debug endpoints from a separate, internal mux/listener where you mount `expvar.Handler()` (and `pprof`) explicitly. This gives you the endpoint without the default-mux exposure risk.

One subtlety: importing `expvar` *always* registers on the default mux, even if you never serve it. If you also (elsewhere) serve the default mux for some unrelated reason, the endpoint leaks. The safest posture is to never serve `http.DefaultServeMux` on a public listener.

---

## The Concurrency Model

All built-in `expvar` types are safe for concurrent use. The mechanisms differ by type:

| Type | Mechanism | Notes |
|------|-----------|-------|
| `Int` | `atomic.Int64` | `Add`/`Set`/`Value` are lock-free atomics. |
| `Float` | `atomic.Uint64` (bit pattern) | `Add` is a CAS loop; `Set`/`Value` are atomic. |
| `String` | `atomic.Value` holding a string | Reads and writes are consistent; no torn values. |
| `Map` | `sync.Map` + a mutex for key creation | Per-key values are themselves `Var`s (usually `Int`). |
| `Func` | none (stateless) | Thread-safety is your function's responsibility. |

Key takeaways:

- **Scalars are lock-free.** `Int.Add` and `Float.Add` are fine on the hottest paths.
- **`Map` takes a brief lock** to create a missing key, then delegates to the underlying `Int`'s atomic add. The lock is held only during creation, so steady-state adds to existing keys are cheap.
- **`Func` inherits *your* concurrency story.** If your function reads a slice that another goroutine mutates, you need synchronization around that slice; `expvar` does not add any.
- **The historical `String` caveat.** In very old Go versions, `String` used a plain `sync.RWMutex` and `Set` was not atomic with reads; a reader could observe a partially-updated value in pathological cases. Modern Go (the `atomic.Value` implementation) fixes this — strings are stored and read atomically, and `String.String()` JSON-quotes consistently. On any supported Go (1.21+), you do not need to worry about it.

You never need to wrap a built-in `expvar` type in your own mutex. Doing so is redundant and can mislead readers into thinking the type is unsafe.

---

## Iterating the Registry with `Do`

`expvar.Do` walks the entire global registry in sorted key order:

```go
expvar.Do(func(kv expvar.KeyValue) {
    fmt.Printf("%s = %s\n", kv.Key, kv.Value.String())
})
```

`KeyValue` is `{ Key string; Value Var }`. Uses:

- **Snapshot on shutdown.** Log every counter's final value when the process stops.
- **Custom exporters.** Translate `expvar` output into another format (e.g. Prometheus exposition) by walking the registry and re-emitting.
- **Tests.** Assert that a particular var exists and has the expected value.

`Map.Do` does the same for one map's keys. Both are read-only iterations; the `Var`s you receive are the live ones, so calling `Value()` reflects the current state.

`Do` holds the registry's read lock during iteration, so do not perform slow work inside the callback (and do not publish new vars from inside it — that wants the write lock and will deadlock).

---

## Writing a Custom `Var`

When the built-in types do not fit, implement `Var` yourself. The only requirement is `String() string` returning valid JSON.

```go
type buildInfo struct {
    Version string
    Commit  string
    Built   time.Time
}

func (b buildInfo) String() string {
    out, err := json.Marshal(struct {
        Version string `json:"version"`
        Commit  string `json:"commit"`
        Built   string `json:"built"`
    }{b.Version, b.Commit, b.Built.Format(time.RFC3339)})
    if err != nil {
        return "null" // always valid JSON, even on error
    }
    return string(out)
}

func main() {
    expvar.Publish("build", buildInfo{
        Version: "1.4.2", Commit: "abc123", Built: time.Now(),
    })
}
```

Rules for a correct custom `Var`:

- **Always return valid JSON,** including a valid fallback (`"null"`, `"{}"`) on marshal error. Never return an empty string or a raw, unquoted value.
- **Make `String()` cheap and non-blocking** if the value is read often.
- **Make `String()` safe for concurrent calls** — the handler may call it while other goroutines mutate underlying state, so synchronize access to that state.
- **Decide composed vs computed.** For a struct that rarely changes, a value-type `Var` is fine. For live values, prefer `Func` over a custom type.

A `Func` is itself the simplest custom `Var` — reach for it first; write a named type only when you want a method set or reuse.

---

## Testing Code That Publishes Vars

The global registry plus the duplicate-name `log.Fatal` makes naive tests fragile. Two test functions that each call `expvar.NewInt("requests")` will crash the second one — and `log.Fatal` cannot be recovered.

Strategies:

- **Publish once, in production code, at package init or via a `sync.Once`.** Tests then reference the already-published var rather than republishing.
- **Inject the var rather than publishing inside the unit under test.** Have your constructor accept a `*expvar.Int` (or an interface) so tests pass a fresh, *unpublished* `new(expvar.Int)` and assert on it directly, without touching the global registry.
- **Use `expvar.Get` to assert** on a published var: `expvar.Get("requests").(*expvar.Int).Value()`.
- **Avoid republishing.** If a test truly must (re)publish, guard with a check, or run it in a subprocess, since you cannot remove a name.

The cleanest design decouples *counting* from *publishing*: your business logic increments a `*expvar.Int` it was handed; a thin wiring layer publishes it once. This makes the logic testable and sidesteps the global-registry hazard entirely.

---

## Common Errors and Their Real Causes

### `Reuse of exported var name: X` (then the process exits)

`log.Fatal` from a duplicate `Publish`. Causes: two packages picking the same name; a test republishing on each run; an `init` running twice. Fix: unique names; publish once; inject vars in tests.

### `/debug/vars` returns 404

The handler is not on the mux you are serving. Cause: you serve a custom mux but did not mount `expvar.Handler()`. Fix: `mux.Handle("/debug/vars", expvar.Handler())`.

### The whole `/debug/vars` body is invalid JSON

A custom `Var`'s `String()` returned non-JSON. Cause: returning a raw string, an empty string, or an un-marshaled value. Fix: `json.Marshal` and return; provide a valid fallback on error.

### A `Func` makes the endpoint slow or hangs

The function body is expensive or blocks (e.g. takes a contended lock, does I/O). Cause: heavy work on the read path. Fix: keep `Func` bodies to a cheap read; pre-compute expensive values on a timer and have `Func` return the cached result.

### Gauge value is wrong / drifts

You hand-maintained it with `Add(1)`/`Add(-1)` and missed a decrement path. Fix: replace with a `Func` that reads the live value.

### `panic` while serving `/debug/vars`

A `Func` panicked, or a custom `Var`'s `String()` panicked. Cause: nil deref or unguarded state in the read path. Fix: make read-path code panic-free; recover defensively if the value is genuinely fallible.

---

## When `expvar` Is Right and When It Is Wrong

| Situation | `expvar`? | Why |
|-----------|-----------|-----|
| Quick request/error counter for an internal service | Yes | Zero deps, instant, good enough. |
| Live `memstats` during incident debugging | Yes | Free, current, no redeploy. |
| Per-status-code or per-endpoint counts | Yes (`Map`) | A single map covers it. |
| A computed gauge (goroutines, queue depth) | Yes (`Func`) | Computed-on-read, never drifts. |
| Latency histograms / p99 | No | No histogram support; use Prometheus/OTel. |
| Multi-dimensional labels at scale | No | `Map` is one dimension; real labels need a metrics lib. |
| Metrics your monitoring already scrapes (Prometheus exposition) | No | Wrong format; use the Prometheus client. |
| Public-facing endpoint without a gate | No | `cmdline`/`memstats` leak; never expose publicly. |
| A throwaway tool or script | Yes | Disproportionate to add anything heavier. |

The pattern: **`expvar` for quick introspection and debugging; a real metrics library when you need labels, histograms, aggregation, or a specific exposition format.**

---

## Best Practices for Real Codebases

1. **Decouple counting from publishing.** Business logic increments injected `*expvar.Int`s; a wiring layer publishes them once. Testable and collision-free.
2. **Never serve `http.DefaultServeMux` on a public listener.** Use a custom mux for public traffic; mount `expvar.Handler()` only on an internal one.
3. **Use `Func` for gauges, `Add` for counters,** every time.
4. **Use `Map` keys where you want one label;** do not create dozens of separate named `Int`s.
5. **Keep names stable and namespaced.** They are part of your observability contract.
6. **Always return valid JSON from custom `Var`s,** with a safe fallback on error.
7. **Keep `Func` and custom `String()` bodies cheap and panic-free** — they run on the request path.
8. **Gate or localhost-bind the endpoint;** never publish secrets.
9. **Treat `expvar` as a first step;** plan the migration to Prometheus/OTel before scale forces it.

---

## Pitfalls You Will Meet in Real Projects

### Pitfall 1 — Two libraries publish the same name and crash startup

A vendored library publishes `"requests"`; so does your code. The second `Publish` `log.Fatal`s. Namespace your names and avoid publishing from reusable libraries — let the application own the registry.

### Pitfall 2 — `/debug/vars` accidentally public via the default mux

The service uses `http.ListenAndServe(":8080", nil)` (default mux) and imports `expvar` (and `pprof`). The debug endpoints are now world-readable on the public port. Move public traffic to a custom mux.

### Pitfall 3 — A custom `Var` breaks observability silently

Someone adds a custom `Var` whose `String()` occasionally returns non-JSON (e.g. on an error path). `/debug/vars` becomes unparseable, and the scraper silently drops the whole document. Always JSON-encode with a fallback.

### Pitfall 4 — Expensive `Func` slows every scrape

A `Func` does a database query or a deep computation. Every scrape pays it, and frequent scraping amplifies the cost. Cache the value on a timer; have `Func` return the cached number.

### Pitfall 5 — Test suite crashes on the second run

Tests republish a name and hit `log.Fatal`. Inject unpublished vars in tests, or publish once in production code via `sync.Once`.

### Pitfall 6 — Hand-maintained gauge drifts after a panic path

A connection-count gauge built with `Add(1)`/`Add(-1)` drifts because one disconnect path (a panic) skips the decrement. Replace with a `Func` reading the live count.

### Pitfall 7 — Scraping `memstats` at high frequency

A monitoring job scrapes `/debug/vars` every second; each scrape recomputes `memstats` via `runtime.ReadMemStats`. The overhead is real on a busy process. Scrape less often, or expose only the specific fields you need via `Func`.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Describe how the global registry stores vars and why duplicate names `log.Fatal`
- [ ] State the JSON contract of `Var.String()` and explain why `String` quotes itself
- [ ] Use `Int`, `Float`, `String`, `Map`, and `Func` with full understanding of each
- [ ] Explain the concurrency mechanism behind each built-in type
- [ ] Mount `expvar` on a custom mux and reason about the default-mux coupling
- [ ] Write a correct custom `Var` with a valid-JSON fallback
- [ ] Test code that publishes vars without tripping the duplicate-name crash
- [ ] Diagnose 404, invalid-JSON, slow-`Func`, and drifting-gauge errors from symptoms
- [ ] Decide when `expvar` is enough and when to reach for Prometheus/OTel

---

## Summary

`expvar` is mechanically simple — a global registry of `name → Var`, served as one JSON object at `/debug/vars` — but the middle-level details govern whether you use it correctly. The registry is process-global, names are permanent, and re-publishing a name `log.Fatal`s the process. Every `Var` satisfies a one-method interface whose `String()` must return *raw valid JSON*, which is why `String` quotes itself and why a careless custom `Var` can corrupt the whole document.

The built-in types map cleanly to needs: `Int`/`Float` for counters (lock-free atomics), `String` for labels (atomic value), `Map` for per-key counts (a `sync.Map` plus a creation lock), and `Func` for gauges (recomputed on every read, running on the request goroutine). The handler auto-registers on `http.DefaultServeMux`, but the disciplined pattern is to serve public traffic from a custom mux and mount `expvar.Handler()` only on an internal listener.

Design for testability by decoupling counting from publishing; keep read-path code cheap and panic-free; always emit valid JSON; and treat `expvar` as the minimum observability — perfect for quick introspection, and a deliberate stepping stone to a real metrics library when labels, histograms, and aggregation become necessary.
