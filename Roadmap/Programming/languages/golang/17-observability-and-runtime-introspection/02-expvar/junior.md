# The `expvar` Package — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What is `expvar`?" and "How do I expose a number from my running program over HTTP?"

You wrote a Go service. It is running. You want to know, *right now*, without attaching a debugger or adding a logging line and redeploying: how many requests has it served? How much memory is it using? How many items are in that cache?

`expvar` is the standard library's answer to that question, and it is delightfully small. Import the package, and it does two things automatically:

1. It registers an HTTP handler at the path `/debug/vars` on the default HTTP mux.
2. It publishes two variables for free: `cmdline` (the command-line arguments your program was started with) and `memstats` (a large struct of runtime memory statistics).

When you hit `/debug/vars`, you get a single JSON document with every published variable in it. That's the whole idea: **expose public application variables as JSON over HTTP**.

```go
package main

import (
    _ "expvar" // import for side effect: registers /debug/vars
    "net/http"
)

func main() {
    http.ListenAndServe(":8080", nil)
}
```

Run that, then in another terminal:

```bash
curl localhost:8080/debug/vars
```

You get a JSON object with `cmdline` and `memstats` already populated. You did not write a handler. You did not define a struct. The blank import (`_ "expvar"`) was enough.

After reading this file you will:
- Understand what `expvar` is and the `/debug/vars` endpoint
- Know the `Var` interface and the built-in types: `Int`, `Float`, `String`, `Map`, `Func`
- Publish your own counters and gauges
- Know why all the types are safe to use from many goroutines at once
- Understand what `expvar` is *not* (it is not Prometheus)
- Know never to expose `/debug/vars` to the public internet

You do **not** need to understand metrics pipelines, histograms, labels, or OpenTelemetry yet. This file is about the moment you say "I just want to see a number from my running program."

---

## Prerequisites

- **Required:** A working Go installation, version 1.21 or newer. `expvar` has been in the standard library since Go 1.0, so anything modern works. Check with `go version`.
- **Required:** Basic knowledge of `net/http` — specifically `http.ListenAndServe` and what a "mux" (request router) is. See the HTTP section of the roadmap if `nil` as the second argument to `ListenAndServe` is unfamiliar.
- **Required:** Comfort with goroutines at a *conceptual* level: you should know that a web server handles many requests concurrently, which is why thread-safety matters.
- **Helpful:** Familiarity with JSON — `expvar` outputs JSON and you will read it.
- **Helpful:** `curl` or any HTTP client to hit the endpoint.

If `go version` prints `go1.21` or higher and you can run a basic `net/http` server, you are ready.

---

## Glossary

| Term | Definition |
|------|-----------|
| **`expvar`** | The standard library package (`expvar`) for publishing public variables as JSON over HTTP. |
| **`/debug/vars`** | The conventional HTTP path where `expvar`'s handler serves the JSON document. |
| **`Var` interface** | The single-method interface (`String() string`) that every published variable implements. `String()` must return *valid JSON*. |
| **Publish** | To register a named `Var` in the global registry so it appears in `/debug/vars`. Done via `expvar.Publish` or the `New*` constructors. |
| **Side-effect import** | A blank import (`_ "expvar"`) used purely to run the package's `init`, which registers the handler. No symbols are referenced. |
| **`Int`** | A published 64-bit integer variable, safe for concurrent use, with `Add` and `Set`. |
| **`Float`** | A published 64-bit float variable, safe for concurrent use, with `Add` and `Set`. |
| **`String`** | A published string variable, safe for concurrent use, with `Set`. |
| **`Map`** | A published key→`Var` map (think: per-label counters), with `Add`, `AddFloat`, `Set`, and `Do`. |
| **`Func`** | A `Var` backed by a function: it is *computed* every time `/debug/vars` is read. Good for gauges. |
| **Counter** | A value that only goes up (e.g. total requests). Use `Int.Add(1)`. |
| **Gauge** | A value that goes up and down (e.g. current connections, queue depth). Often a `Func`. |
| **`DefaultServeMux`** | The package-global HTTP router `net/http` uses when you pass `nil` to `ListenAndServe`. `expvar` registers its handler here. |

---

## Core Concepts

### What `expvar` actually does on import

The entire activation mechanism is a side-effect import. The package's `init` function runs this:

```go
http.HandleFunc("/debug/vars", expvarHandler)
```

That single line registers the JSON handler on `http.DefaultServeMux`. It also publishes the two default variables. From that point on, any HTTP server using the default mux will answer `/debug/vars`.

This is why you usually see `_ "expvar"` — the underscore means "import this package only to run its `init`; I am not going to reference any of its names." If you *do* call `expvar.NewInt(...)` etc., then it's a normal import (no underscore) and the `init` still runs.

### The two default variables

You get these for free, with no code:

- **`cmdline`** — a JSON array of the command-line arguments (`os.Args`). Useful to confirm *which* binary and flags a running process was started with.
- **`memstats`** — the full `runtime.MemStats` struct as JSON. Heap size, GC count, allocation totals, and dozens more fields. This is a live snapshot, recomputed on each read.

### The `Var` interface

Everything `expvar` publishes satisfies one tiny interface:

```go
type Var interface {
    String() string
}
```

That's it — a single method that returns a string. The crucial rule: **the returned string must be valid JSON**. When `/debug/vars` is served, `expvar` builds a JSON object whose values are the raw output of each variable's `String()`. If your `String()` returns something that is not valid JSON, the whole document becomes malformed.

The built-in types handle this for you. An `Int` returns `42` (a valid JSON number). A `String` returns `"hello"` *with quotes* (a valid JSON string). You only need to worry about the JSON rule when you write a *custom* `Var`.

### The built-in types

`expvar` ships four data types plus a function adapter:

- **`Int`** — a thread-safe `int64`. Methods: `Add(delta int64)`, `Set(v int64)`, `Value() int64`.
- **`Float`** — a thread-safe `float64`. Methods: `Add(delta float64)`, `Set(v float64)`, `Value() float64`.
- **`String`** — a thread-safe string. Methods: `Set(v string)`, `Value() string`.
- **`Map`** — a thread-safe map from `string` keys to `Var` values. Methods: `Add`, `AddFloat`, `Set`, `Get`, `Delete`, `Do`, `Init`.
- **`Func`** — wraps a `func() any`; its value is recomputed on every read. Use for gauges and derived values.

### Publishing: two ways

**Way 1 — the `New*` constructors** create the variable *and* register it under a name:

```go
var hits = expvar.NewInt("hits")
```

Now `hits` is a `*expvar.Int`, and it will appear in `/debug/vars` under the key `"hits"`.

**Way 2 — `Publish(name, Var)`** registers an existing `Var`:

```go
var queue = new(expvar.Int)
expvar.Publish("queue_depth", queue)
```

Both put the variable into the same global registry. The `New*` constructors are just convenience wrappers around `Publish`.

### The global registry and the duplicate-name rule

`expvar` keeps a single, package-global registry of name → `Var`. There is exactly one per process. This has one sharp edge you must know early:

**Publishing the same name twice calls `log.Fatal` and kills your program.**

```go
expvar.NewInt("hits")
expvar.NewInt("hits") // log.Fatal: Reuse of exported var name: hits
```

This is intentional — duplicate names would silently shadow each other — but it means you must pick unique names, and you must be careful in tests (more on that in the pitfalls section).

### Reading the output

Hit `/debug/vars` and you get something like:

```json
{
  "cmdline": ["/tmp/go-build/exe/myapp"],
  "hits": 17,
  "memstats": { "Alloc": 123456, "TotalAlloc": 789012, ... }
}
```

Each top-level key is a published variable name. Each value is the raw JSON from that variable's `String()`. It is a *pull* model: nothing is pushed anywhere; you read the current state when you ask.

---

## Real-World Analogies

**1. The dashboard gauges in a car.** Your engine is running. You do not stop the car and open the hood to learn the speed or fuel level — you glance at the dashboard, which exposes a few public readings. `expvar` is the dashboard: a small, always-available panel of the numbers the program chose to make visible.

**2. A status board on a wall.** A factory floor has a board showing "units produced today," "machines running," "defects." Anyone walking by reads it. Nobody pushes the numbers to anyone; the board just reflects the current state when you look. `/debug/vars` is that board, served as JSON.

**3. A vending machine's coin counter.** The machine tallies coins internally; a small window shows the running total. `expvar.Int` with `Add(1)` on each event is exactly this counter — increment-only, always readable.

**4. A glass-walled server room.** You can see the blinking lights and read the rack labels without going inside. `expvar` lets you see *some* of the program's internals from outside, through a small read-only window — without stopping it or attaching a debugger.

---

## Mental Models

### Model 1 — `expvar` is a pull-based JSON snapshot

Nothing is pushed. A reader hits `/debug/vars` and gets the current values *at that instant*. There is no time series, no history, no retention. If you want history, something else (a scraper) must poll the endpoint and store the results.

### Model 2 — Everything is a `Var`, and a `Var` is "a thing that prints valid JSON"

The whole system reduces to one interface with one method. An `Int` prints `42`; a `String` prints `"x"`; your custom type prints whatever JSON you make it print. The handler just concatenates those into one object.

### Model 3 — Counters go up with `Add`; gauges are computed with `Func`

A counter (`Int.Add(1)`) accumulates an event count. A gauge (a `Func` returning the current value of something) reflects a live measurement. Choosing between them is the most common day-one decision.

### Model 4 — One global registry, names are forever, duplicates are fatal

There is one registry per process. A name, once published, cannot be un-published or re-published. Re-publishing a name crashes the process. Treat names like permanent, unique identifiers.

### Model 5 — `expvar` is the *minimum* observability, not the maximum

It is the smallest possible thing that gets a number out of a running process over HTTP. It has no labels, no histograms, no aggregation, no typing beyond "JSON." It is perfect for a quick look and a poor substitute for a real metrics system.

---

## Pros & Cons

### Pros

- **Zero dependencies.** It is in the standard library. No `go get`, no version to manage.
- **Almost zero setup.** A blank import and an HTTP server, and you have an endpoint.
- **Concurrency-safe out of the box.** Every built-in type can be updated from any goroutine without you adding a mutex.
- **Free runtime insight.** `memstats` and `cmdline` come for free and are genuinely useful for debugging.
- **JSON output.** Easy to read by eye, easy to parse with `jq`, easy to scrape.
- **Tiny footprint.** No background goroutines, no buffers, no overhead until you read the endpoint.

### Cons

- **No labels or dimensions.** You cannot attach `{method="GET", status="200"}` to a counter the way Prometheus does. You fake it with `Map` keys.
- **No histograms or quantiles.** You cannot natively express "p99 latency."
- **No types beyond JSON.** A consumer cannot tell a counter from a gauge from a string; it is all untyped JSON.
- **Global registry.** Names are process-global, which makes testing and library use awkward.
- **`DefaultServeMux` coupling.** The default handler registers on the global mux — a problem if you avoid the default mux for good reasons (and you should).
- **Security exposure.** `memstats` and `cmdline` leak operational details. Never expose `/debug/vars` publicly.

### When the trade-off is acceptable

`expvar` is the right tool for *quick introspection*: a counter you can glance at, a debugging endpoint behind an internal network, a small service where pulling in Prometheus would be overkill. It is the wrong tool for a production metrics pipeline with dashboards and alerting.

---

## Use Cases

You should reach for `expvar` when:

- **You want a quick request counter** visible without redeploying.
- **You are debugging memory** and want live `memstats` from a running process.
- **You have an internal-only service** behind a trusted network where a JSON debug endpoint is convenient.
- **You want per-something counts** (per-endpoint, per-status-code) and a `Map` is enough.
- **You are writing a small tool** and a full metrics stack is disproportionate.
- **You want a health-ish snapshot** that a simple script can poll.

You should **not** reach for `expvar` when:

- You need histograms, quantiles, or rate calculations — use Prometheus client or OpenTelemetry.
- You need labels/dimensions on metrics — `Map` keys are a poor substitute at scale.
- The endpoint would be reachable from the public internet without a gate.
- You need a metrics format your existing monitoring already speaks (Prometheus exposition, OTLP).

---

## Code Examples

### Example 1 — The smallest possible `expvar` program

```go
package main

import (
    _ "expvar"
    "net/http"
)

func main() {
    // /debug/vars is already registered by expvar's init.
    http.ListenAndServe(":8080", nil)
}
```

```bash
curl localhost:8080/debug/vars
# {"cmdline":[...],"memstats":{...}}
```

### Example 2 — A request counter

```go
package main

import (
    "expvar"
    "net/http"
)

// NewInt publishes "requests" and returns the *expvar.Int.
var requests = expvar.NewInt("requests")

func handler(w http.ResponseWriter, r *http.Request) {
    requests.Add(1) // safe to call from many goroutines
    w.Write([]byte("ok"))
}

func main() {
    http.HandleFunc("/", handler)
    http.ListenAndServe(":8080", nil)
}
```

After a few requests:

```bash
curl localhost:8080/debug/vars | jq .requests
# 3
```

`requests.Add(1)` is atomic — no mutex needed even though many requests run concurrently.

### Example 3 — Per-status-code counts with a `Map`

```go
package main

import (
    "expvar"
    "net/http"
    "strconv"
)

var statusCounts = expvar.NewMap("http_status")

func handler(w http.ResponseWriter, r *http.Request) {
    status := http.StatusOK
    if r.URL.Path == "/fail" {
        status = http.StatusInternalServerError
    }
    w.WriteHeader(status)
    // Map.Add increments the Int under this key (creating it if absent).
    statusCounts.Add(strconv.Itoa(status), 1)
}

func main() {
    http.HandleFunc("/", handler)
    http.HandleFunc("/fail", handler)
    http.ListenAndServe(":8080", nil)
}
```

```bash
curl localhost:8080/debug/vars | jq .http_status
# {"200": 5, "500": 2}
```

`Map.Add(key, n)` finds (or creates) the `Int` under `key` and adds `n`. This is how you approximate "labels" with `expvar`.

### Example 4 — A computed gauge with `Func`

Counters use `Add`. A *gauge* (current value of something) is best done with `Func`, which recomputes on every read:

```go
package main

import (
    "expvar"
    "net/http"
    "runtime"
)

func main() {
    // Recomputed every time /debug/vars is read.
    expvar.Publish("goroutines", expvar.Func(func() any {
        return runtime.NumGoroutine()
    }))
    http.ListenAndServe(":8080", nil)
}
```

```bash
curl localhost:8080/debug/vars | jq .goroutines
# 4
```

`expvar.Func` takes a `func() any`. Whatever it returns is JSON-encoded automatically by `expvar`. Because it is recomputed on each read, it always shows the *current* value — perfect for a gauge.

### Example 5 — A `String` variable

```go
var version = expvar.NewString("version")

func main() {
    version.Set("v1.4.2")
    http.ListenAndServe(":8080", nil)
}
```

```bash
curl localhost:8080/debug/vars | jq .version
# "v1.4.2"
```

Note the output is `"v1.4.2"` *with quotes* — `String.String()` returns a JSON-encoded (quoted, escaped) string. You do not add quotes yourself.

### Example 6 — Serving `expvar` on a *custom* mux

The default registration uses `http.DefaultServeMux`. Many teams avoid the default mux. You can mount `expvar` explicitly using its exported `Handler()`:

```go
package main

import (
    "expvar"
    "net/http"
)

func main() {
    mux := http.NewServeMux()        // our own mux, not the default
    mux.Handle("/debug/vars", expvar.Handler())
    mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        w.Write([]byte("hello"))
    })
    http.ListenAndServe(":8080", mux)
}
```

`expvar.Handler()` returns the same handler the package registers by default. By mounting it yourself, you control the mux and the path. (Even with a custom mux, `expvar`'s `init` still registers on the *default* mux — that registration is just unused if you never serve the default mux.)

### Example 7 — Iterating all published vars with `Do`

```go
expvar.Do(func(kv expvar.KeyValue) {
    fmt.Printf("%s = %s\n", kv.Key, kv.Value.String())
})
```

`expvar.Do` walks the entire registry, calling your function with each name/`Var` pair. Useful for logging a snapshot on shutdown, or for writing a custom exporter.

---

## Coding Patterns

### Pattern: declare published vars as package-level variables

```go
var (
    requests  = expvar.NewInt("requests")
    errors    = expvar.NewInt("errors")
    cacheHits = expvar.NewInt("cache_hits")
)
```

Because publication happens at package-init time and names are global, package-level `var` declarations are the natural home. They are created once and used everywhere.

### Pattern: a `Map` for "labeled" counters

```go
var byEndpoint = expvar.NewMap("requests_by_endpoint")

func handle(name string, w http.ResponseWriter, r *http.Request) {
    byEndpoint.Add(name, 1)
}
```

When you would reach for a label in Prometheus, reach for a `Map` key in `expvar`.

### Pattern: `Func` for anything derived

Never try to keep a gauge in sync by hand (incrementing on connect, decrementing on disconnect is bug-prone). Compute it on read:

```go
expvar.Publish("queue_depth", expvar.Func(func() any {
    return len(workQueue) // read the live value
}))
```

### Pattern: namespace your names

Names are flat and global. Prefix them to avoid collisions and to group related vars:

```go
expvar.NewInt("db_queries")
expvar.NewInt("db_errors")
expvar.NewInt("http_requests")
```

A `_` or `.` separator (`db.queries`) is common; pick one and be consistent.

---

## Clean Code

- **Use the `New*` constructors when you want create-and-publish in one line;** use `Publish` when you already hold the `Var`.
- **Do not pass `expvar` variables around as values.** `expvar.Int` has internal state; always use pointers (`*expvar.Int`), which is what `NewInt` returns.
- **Prefer `Func` over manual gauge bookkeeping.** A computed-on-read gauge cannot drift; a hand-maintained one will.
- **Keep names stable.** Renaming a published var breaks every scraper and dashboard that reads it. Treat names as part of your API.
- **Don't publish secrets.** `cmdline` already risks leaking flags; never `expvar.NewString("api_key")`.
- **Mount `expvar` on a mux you control** rather than relying on the default mux being served, so the endpoint's location and access are explicit.

---

## Product Use / Feature

In a real service, `expvar` typically supports:

- **A debug endpoint** on an internal admin port, alongside `net/http/pprof`, that on-call engineers hit to read live counters.
- **Lightweight readiness signals** — "items processed," "last successful sync," "current backlog" — visible without a metrics stack.
- **Memory triage** — `memstats` gives heap and GC numbers during an incident, without re-deploying with extra logging.
- **A cheap scrape target** — a small polling script reads `/debug/vars` every minute and writes the numbers to a log or simple time-series store.

For a serious product with dashboards, SLOs, and alerting, `expvar` is usually a *stepping stone*: you start with it, and graduate to Prometheus/OpenTelemetry when you need labels, histograms, and aggregation.

---

## Error Handling

`expvar` is almost error-free by design — there are very few places it can fail — but the failures it does have are abrupt.

### Duplicate publish → `log.Fatal`

```go
expvar.NewInt("hits")
expvar.NewInt("hits") // log.Fatal kills the process
```

The message is `Reuse of exported var name: hits`. There is no error return; the program exits. This bites most often in tests that run init code twice, or when two packages publish the same name. The fix: unique names; in tests, guard publication or use a fresh process.

### Malformed JSON from a custom `Var`

If you write your own `Var` and its `String()` returns invalid JSON, the *entire* `/debug/vars` document becomes invalid — one bad variable poisons the whole response. The built-in types never do this; only custom `Var`s are at risk. The fix: always `json.Marshal` and return the result, or build a string you are certain is valid JSON.

```go
type stat struct{ data map[string]int }

func (s stat) String() string {
    b, err := json.Marshal(s.data)
    if err != nil {
        return "null" // valid JSON fallback, never an empty or raw string
    }
    return string(b)
}
```

### A panicking `Func`

If the function inside `expvar.Func` panics, the panic propagates through the HTTP handler. Keep `Func` bodies simple and non-panicking; do a cheap read, return a value.

---

## Security Considerations

This is the most important section for a junior to internalize: **`/debug/vars` is a leak if exposed publicly.**

- **`cmdline` leaks how the process was started** — binary path, and any flags passed on the command line. If you pass secrets as flags (you should not), they appear here.
- **`memstats` leaks operational detail** — memory usage, GC behaviour, allocation patterns. Useful to an attacker profiling your service.
- **Your own vars may leak business data** — a careless `expvar.NewString("current_user_email")` is now world-readable.

Rules:

1. **Never serve `/debug/vars` on a public-facing port.** Put it on an internal admin port, or behind authentication, or bind it to localhost only.
2. **Do not rely on "nobody knows the path."** `/debug/vars` is a well-known, documented path. Security by obscurity fails.
3. **Avoid the default mux for public servers.** Because `expvar` (and `pprof`) auto-register on `http.DefaultServeMux`, a public server that happens to use the default mux silently exposes these endpoints. Use your own mux for public traffic and mount debug endpoints only on an internal one.
4. **Gate it.** If it must be reachable, wrap `expvar.Handler()` in an auth-checking middleware.

A common safe layout: public traffic on `:8080` via a custom mux; debug endpoints (`/debug/vars`, `/debug/pprof`) on `:6060` bound to `127.0.0.1`, reachable only by an SSH tunnel or a sidecar.

---

## Performance Tips

- **`Int.Add` and `Float.Add` are cheap.** They are backed by atomic operations, not mutexes — calling them on a hot path is fine.
- **`Map` operations take a lock briefly.** A `Map.Add` is more expensive than an `Int.Add` because the map is protected by internal locking. Fine for moderate rates; for extremely hot per-key counts, consider pre-creating the `Int`s.
- **`Func` runs on every read.** Keep the function cheap. Reading `/debug/vars` calls *every* `Func`; an expensive `Func` makes the endpoint slow and can cause work proportional to scrape frequency.
- **`memstats` is recomputed each read** and calls `runtime.ReadMemStats`, which briefly stops the world in older Go versions. Do not scrape `/debug/vars` at extremely high frequency if it includes `memstats`.
- **There is no cost when nobody reads.** `expvar` does no background work; the only cost is updating your counters and serving the occasional request.

---

## Best Practices

1. **Use a blank import only if you want the side effect** (`_ "expvar"`); use a normal import if you call its functions.
2. **Declare published vars at package level** with the `New*` constructors.
3. **Use `Func` for gauges, `Add` for counters.** Do not hand-maintain gauge state.
4. **Use `Map` for per-key counts** instead of dozens of separate named `Int`s.
5. **Pick stable, namespaced names.** They are part of your observability contract.
6. **Mount `expvar.Handler()` on an internal mux,** not the public one.
7. **Never publish secrets** and never expose the endpoint publicly.
8. **Treat `expvar` as a starting point;** graduate to Prometheus/OTel when you outgrow it.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Forgetting the blank import

If you never import `expvar` (directly or via a constructor call), nothing is registered and `/debug/vars` 404s. The blank import `_ "expvar"` exists precisely to run the registering `init`.

### Pitfall 2 — Publishing the same name twice crashes the process

`log.Fatal` on duplicate names is not a warning — it exits. Two packages publishing `"requests"`, or a test that publishes the same name on each run, will kill the program.

### Pitfall 3 — A custom `Var` that returns non-JSON

A `String()` that returns `hello` (not `"hello"`) makes the entire `/debug/vars` document invalid. Always JSON-encode.

### Pitfall 4 — Expecting `String.Set("x")` to output `x`

`String.Set("x")` is stored and rendered as `"x"` — the output is a *JSON string*, quoted and escaped. This surprises people who expect raw output. If you genuinely need raw JSON, do not use `String`; write a custom `Var`.

### Pitfall 5 — Relying on the default mux being served

`expvar`'s registration is on `http.DefaultServeMux`. If your server uses a *custom* mux (and serves it), `/debug/vars` will not be reachable unless you also mount `expvar.Handler()` on that mux. The auto-registration is silently useless in that case.

### Pitfall 6 — Treating `Map` key order as stable

`Map.String()` sorts keys (Go's implementation sorts them for deterministic output), but do not write code that depends on a particular iteration order beyond that. Use `Do` for explicit iteration.

### Pitfall 7 — Hand-maintaining a gauge

`connections.Add(1)` on connect and `connections.Add(-1)` on disconnect *looks* fine but drifts the moment a disconnect path is missed (panic, early return). Prefer a `Func` that reads the live count.

### Pitfall 8 — Scraping `memstats` too often

Every read of `/debug/vars` recomputes `memstats`. High-frequency scraping of the full endpoint adds runtime overhead. Scrape modestly, or expose only the specific numbers you need via `Func`.

---

## Common Mistakes

- **No import → no endpoint.** Forgetting `_ "expvar"` (or any `expvar` use) means `/debug/vars` does not exist.
- **Duplicate names** crashing the process via `log.Fatal`.
- **Custom `Var` returning invalid JSON,** poisoning the whole document.
- **Exposing `/debug/vars` publicly,** leaking `cmdline` and `memstats`.
- **Using `String` and being surprised by the quotes** in the output.
- **Hand-maintaining gauges** instead of using `Func`.
- **Creating many named `Int`s** where a single `Map` would be cleaner.
- **Passing `expvar.Int` by value** instead of using the pointer from `NewInt`.

---

## Common Misconceptions

> *"`expvar` is a metrics system like Prometheus."*

No. It is a way to expose JSON variables over HTTP. It has no labels, no histograms, no aggregation, no typing. It is the minimum, not a metrics platform.

> *"I have to write the `/debug/vars` handler myself."*

No. Importing the package registers it automatically. You only mount `expvar.Handler()` manually if you use a custom mux.

> *"`expvar` pushes my metrics somewhere."*

No. It is pull-only. A reader fetches `/debug/vars`; nothing is pushed. If you want push, you build a scraper.

> *"`String.Set("v1")` outputs `v1`."*

No. It outputs `"v1"` — a JSON string with quotes. All built-in types output valid JSON, which for strings means quoting.

> *"`expvar` types need a mutex around them."*

No. `Int`, `Float`, `String`, and `Map` are all safe for concurrent use already. Adding your own lock is redundant.

> *"It's safe to leave `/debug/vars` open; it's just numbers."*

No. `cmdline` and `memstats` are operationally sensitive, and your own vars might leak data. Gate it.

---

## Tricky Points

- **The `init` registers on `DefaultServeMux` regardless of whether you serve it.** Importing `expvar` *always* touches the default mux; the registration is just unused if you serve a different mux.
- **`Func`'s argument is `func() any`,** and the return value is JSON-marshaled by `expvar`. It does not need to be a `Var`; the package wraps it.
- **`Map.Add` and `Map.AddFloat` create the key if absent;** the first `Add` to a new key implicitly creates an `Int` (or `Float`).
- **`Get` returns `nil` for an unknown name,** so always nil-check the result of `expvar.Get`.
- **`memstats` is a `Func` internally,** which is why it is always current — it calls `runtime.ReadMemStats` on each read.
- **Names cannot be removed.** There is no `Unpublish`. The registry only grows during the process lifetime.
- **`NewMap` returns an empty, ready-to-use `*Map`;** you do not need to `Init` it before `Add`.

---

## Test

Try this in a scratch folder.

```go
package main

import (
    "expvar"
    "fmt"
    "net/http"
)

var hits = expvar.NewInt("hits")

func main() {
    http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
        hits.Add(1)
        fmt.Fprintln(w, "ok")
    })
    expvar.Publish("answer", expvar.Func(func() any { return 42 }))
    http.ListenAndServe(":8080", nil)
}
```

```bash
curl localhost:8080/        # a few times
curl localhost:8080/debug/vars | jq '{hits, answer}'
```

Expected: `hits` reflects the number of `/` requests, and `answer` is `42`.

Now answer:
1. What happens if you add a second `expvar.NewInt("hits")`? (Answer: `log.Fatal`, the process exits.)
2. Does `String.Set("v")` output `v` or `"v"`? (Answer: `"v"`, quoted.)
3. If you switch to a custom mux and pass it to `ListenAndServe`, does `/debug/vars` still work? (Answer: not unless you mount `expvar.Handler()` on that mux.)
4. Is `hits.Add(1)` safe to call from many goroutines? (Answer: yes, it is atomic.)

---

## Tricky Questions

**Q1.** Why is the import usually written as `_ "expvar"`?

A. Because most programs want only the *side effect* — registering `/debug/vars` on the default mux and publishing `cmdline`/`memstats`. The blank import runs the package's `init` without referencing any of its names. If you also call `expvar.NewInt(...)`, drop the underscore.

**Q2.** I published a var but `/debug/vars` 404s. Why?

A. Most likely you are serving a custom mux instead of the default mux, and you did not mount `expvar.Handler()` on it. The auto-registration is on `http.DefaultServeMux` only.

**Q3.** Counter or gauge — how do I choose?

A. If it only ever increases (total requests, total errors), it is a counter: use `Int.Add(1)`. If it goes up and down (current connections, queue depth), it is a gauge: use a `Func` that reads the live value.

**Q4.** Can two goroutines call `requests.Add(1)` at the same time safely?

A. Yes. `Int` is backed by atomic operations. No mutex needed.

**Q5.** My custom `Var` broke the whole `/debug/vars` output. What happened?

A. Its `String()` returned something that is not valid JSON. The handler concatenates each var's `String()` into one JSON object; one invalid value makes the entire document invalid. JSON-encode your value.

**Q6.** Is it safe to leave `/debug/vars` reachable from the internet?

A. No. `cmdline` and `memstats` leak operational detail, and your own vars may leak data. Bind it to localhost, put it on an internal port, or require authentication.

**Q7.** How do I see all the variables in Go code instead of over HTTP?

A. Use `expvar.Do(func(kv expvar.KeyValue){ ... })`, which iterates the whole registry. Or `expvar.Get("name")` for a single one (it returns `nil` if not found).

**Q8.** Why does `expvar` use `log.Fatal` for duplicate names instead of returning an error?

A. Because publication happens at init time with no error channel, and a silent shadow would be worse than a crash. It forces you to fix the collision immediately.

**Q9.** Does `Map` give me Prometheus-style labels?

A. Loosely. A `Map` key is a single string dimension. It approximates one label (e.g. status code), but it has no multi-dimensional labels, no histograms, and no aggregation. For real labels, use a metrics library.

**Q10.** What's the difference between `expvar.NewInt("x")` and `expvar.Publish("x", new(expvar.Int))`?

A. None functionally — `NewInt` is a convenience wrapper that creates an `*Int`, calls `Publish`, and returns the pointer. Both register an `Int` under the name `x`.

---

## Cheat Sheet

```go
// Publish + create in one line
var hits = expvar.NewInt("hits")
var ratio = expvar.NewFloat("ratio")
var ver  = expvar.NewString("version")
var byKey = expvar.NewMap("by_key")

// Counter (increment-only)
hits.Add(1)

// Gauge (computed on each read)
expvar.Publish("goroutines", expvar.Func(func() any {
    return runtime.NumGoroutine()
}))

// Per-key ("labeled") counts
byKey.Add("GET", 1)
byKey.AddFloat("latency_sum", 0.042)

// Set values
ver.Set("v1.2.3")     // renders as "v1.2.3"
ratio.Set(0.95)

// Mount on a custom mux
mux.Handle("/debug/vars", expvar.Handler())

// Read in Go
v := expvar.Get("hits")          // nil if absent
expvar.Do(func(kv expvar.KeyValue) {
    fmt.Println(kv.Key, kv.Value.String())
})
```

```
Defaults you get for free:
    cmdline   -> ["/path/to/binary", "-flag", ...]
    memstats  -> { "Alloc":..., "NumGC":..., ... }
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `/debug/vars` 404s | No `expvar` import, or custom mux | Add `_ "expvar"` or mount `expvar.Handler()` |
| Process exits on startup | Duplicate published name | Pick unique names |
| Whole JSON is invalid | Custom `Var` returns non-JSON | JSON-encode in `String()` |
| `version` shows `"v1"` not `v1` | `String` always quotes | Expected; use custom `Var` for raw JSON |
| Gauge value drifts | Hand-maintained counter | Use `Func` instead |
| Endpoint leaks data | Served publicly | Bind to localhost / gate it |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain what `expvar` does on import and what `/debug/vars` returns
- [ ] Name the two default variables and what they contain
- [ ] State the `Var` interface and its one rule (valid JSON from `String()`)
- [ ] Use `Int`, `Float`, `String`, `Map`, and `Func`
- [ ] Choose between a counter (`Add`) and a gauge (`Func`)
- [ ] Use a `Map` for per-key counts
- [ ] Publish a var two ways (`NewInt` vs `Publish`)
- [ ] Mount `expvar` on a custom mux with `expvar.Handler()`
- [ ] Explain why all the built-in types are concurrency-safe
- [ ] Explain why duplicate names crash the process
- [ ] Explain why `/debug/vars` must not be exposed publicly

---

## Summary

`expvar` is the standard library's smallest observability tool: import it, and it serves your program's public variables as JSON at `/debug/vars`, including two freebies (`cmdline`, `memstats`). Everything it publishes satisfies the one-method `Var` interface whose `String()` returns valid JSON. The built-in types — `Int`, `Float`, `String`, `Map`, and the `Func` adapter — cover counters, gauges, and per-key counts, and every one of them is safe to use from many goroutines without a mutex.

You publish with the `New*` constructors or with `Publish(name, Var)`; names live in a single global registry, are permanent, and crash the process (`log.Fatal`) if reused. Use `Add` for counters, `Func` for gauges, and `Map` keys where you would otherwise want labels. Mount the endpoint on a mux you control, keep the function bodies cheap, and — above all — never expose `/debug/vars` to the public internet, because `cmdline` and `memstats` leak operational detail.

`expvar` is the minimum, not the maximum: perfect for quick introspection and debugging, and a fine stepping stone toward Prometheus or OpenTelemetry when you need labels, histograms, and aggregation.

---

## What You Can Build

After learning this:

- **A self-instrumented HTTP service** with live request/error counters visible at `/debug/vars`.
- **A memory-triage endpoint** that exposes `memstats` for incident debugging without a redeploy.
- **A per-endpoint or per-status-code dashboard source** using a single `Map`.
- **A tiny scraper** that polls `/debug/vars` and logs the numbers over time.
- **An internal admin port** that mounts `expvar` and `pprof` together, gated from public traffic.

You cannot yet:
- Express histograms or quantiles (next: Prometheus client / OpenTelemetry)
- Attach multi-dimensional labels to metrics
- Build a full alerting pipeline (later, in the metrics topics)
- Write a custom exporter that translates `expvar` into another format (middle/professional)

---

## Further Reading

- [`expvar` package documentation](https://pkg.go.dev/expvar) — authoritative, terse, the source of truth.
- [`runtime.MemStats`](https://pkg.go.dev/runtime#MemStats) — what every field in `memstats` means.
- [`net/http/pprof`](https://pkg.go.dev/net/http/pprof) — the sibling debug endpoint, same default-mux pattern.
- [The Go Blog: profiling Go programs](https://go.dev/blog/pprof) — context for runtime introspection.
- [`net/http.ServeMux`](https://pkg.go.dev/net/http#ServeMux) — why the default mux matters for `expvar`.

---

## Related Topics

- [17.1 `net/http/pprof`](../01-pprof/junior.md) — the profiling sibling; same auto-registration pattern
- 17.3 `runtime` metrics — `runtime/metrics` for richer runtime numbers
- 17.4 Prometheus client — labels, histograms, the next step up from `expvar`
- 17.5 OpenTelemetry metrics — the modern, vendor-neutral metrics stack
- [HTTP servers & muxes](../../../) — why a custom mux beats the default for public traffic

---

## Diagrams & Visual Aids

```
What import "expvar" wires up:

    import _ "expvar"
          │
          │  package init runs:
          ▼
    http.HandleFunc("/debug/vars", expvarHandler)   ──> DefaultServeMux
          │
          ├─ publishes "cmdline"  (os.Args)
          └─ publishes "memstats" (runtime.MemStats, recomputed on read)
```

```
The pull model:

    your program            HTTP client / scraper
    ┌───────────┐               │
    │ requests  │  GET /debug/vars
    │  Int = 17 │ <─────────────┘
    │ status    │
    │  Map{...} │  ──────────────> {"requests":17,"status":{...},...}
    └───────────┘   (current snapshot, no history)
```

```
The Var interface, everything reduces to it:

    type Var interface { String() string }   // must return VALID JSON

    Int.String()    -> 42
    Float.String()  -> 0.95
    String.String() -> "hello"        (quoted!)
    Map.String()    -> {"GET":3,"POST":1}
    Func.String()   -> <json of fn() result>
                          │
                          ▼
    handler concatenates them:
       { "name1": <json>, "name2": <json>, ... }
```

```
Counter vs Gauge:

    Counter (only goes up)        Gauge (up and down)
    ┌──────────────────┐          ┌──────────────────────┐
    │ requests.Add(1)  │          │ expvar.Func(func()   │
    │ errors.Add(1)    │          │   any { return       │
    │                  │          │   len(queue) })      │
    │ value accumulates│          │ recomputed each read │
    └──────────────────┘          └──────────────────────┘
```

```
Safe vs unsafe exposure:

    PUBLIC :8080                 INTERNAL :6060 (127.0.0.1)
    ┌──────────────┐             ┌──────────────────────┐
    │ custom mux   │             │ /debug/vars          │
    │ /            │             │ /debug/pprof         │
    │ /api/...     │             │ (gated, localhost)   │
    │ (no /debug)  │             └──────────────────────┘
    └──────────────┘
        clients                     on-call engineers only
```
