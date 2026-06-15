# The `expvar` Package — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — The smallest `expvar` program

Create a module with a `main.go` that blank-imports `expvar` and serves the default mux on `:8080`. Then:

```bash
curl localhost:8080/debug/vars | jq 'keys'
```

Confirm the output contains `"cmdline"` and `"memstats"` even though you published nothing.

**Goal.** See that the blank import alone registers the endpoint and the two default variables.

---

### Task 2 — A request counter

Add a `*expvar.Int` named `"requests"` and increment it in an HTTP handler. Hit the handler a few times, then read `/debug/vars`.

```bash
curl localhost:8080/                 # several times
curl localhost:8080/debug/vars | jq .requests
```

Confirm `requests` matches the number of times you hit the handler.

**Goal.** Publish and increment a counter; confirm it's visible.

---

### Task 3 — Observe the `String` quoting quirk

Add `var version = expvar.NewString("version")` and `version.Set("v1.2.3")`. Read the endpoint:

```bash
curl localhost:8080/debug/vars | jq -r .version    # v1.2.3
curl localhost:8080/debug/vars | grep version      # "version": "v1.2.3"
```

Note that the raw JSON shows `"v1.2.3"` *with quotes* — `String.String()` returns the JSON-encoded string.

**Goal.** Internalize that `String` quotes itself to satisfy the valid-JSON contract.

---

### Task 4 — A computed gauge with `Func`

Publish a `Func` that returns `runtime.NumGoroutine()`. Spawn a few goroutines that sleep, then read the endpoint while they're alive and again after they exit.

```bash
curl localhost:8080/debug/vars | jq .goroutines
```

Confirm the value reflects the *current* goroutine count each time — it changes between reads.

**Goal.** See that `Func` is recomputed on every read, making it a drift-free gauge.

---

### Task 5 — Trigger the duplicate-name crash

Add a second `expvar.NewInt("requests")` somewhere. Run the program.

```
log.Fatal: Reuse of exported var name: requests
```

Observe that the process exits at startup. Remove the duplicate to recover.

**Goal.** Recognize the duplicate-name `log.Fatal` and why names must be unique.

---

## Medium

### Task 6 — Per-status-code counts with a `Map`

Create `var byStatus = expvar.NewMap("http_status")`. In a handler, write different status codes for different paths and call `byStatus.Add(strconv.Itoa(status), 1)`. After mixed traffic:

```bash
curl localhost:8080/debug/vars | jq .http_status
# {"200": 5, "404": 2, "500": 1}
```

**Goal.** Use a `Map` as the `expvar` approximation of a labeled counter.

---

### Task 7 — Serve `expvar` on a custom mux only

Build a server that uses a *custom* `http.ServeMux` (not the default) for `:8080`, serving `/` but *not* mounting `expvar`. Confirm `/debug/vars` 404s. Then mount `expvar.Handler()` on the custom mux and confirm it works.

```bash
curl -i localhost:8080/debug/vars    # 404 before; 200 after mounting
```

**Goal.** Understand the default-mux coupling: the endpoint only works on a mux where it's mounted.

---

### Task 8 — Separate public and debug listeners

Run two servers in one process: a public one on `:8080` with a custom mux (no `/debug/*`), and an internal one on `127.0.0.1:6060` that mounts `expvar.Handler()`. Confirm:

```bash
curl -i localhost:8080/debug/vars       # 404 (public, no debug)
curl localhost:6060/debug/vars | jq .   # works (internal)
```

**Goal.** Build the standard safe layout — debug endpoints off the public listener.

---

### Task 9 — A custom `Var` for build info

Implement a type with a `String() string` method that JSON-marshals a struct (version, commit, build time). Publish it under `"build"`.

```bash
curl localhost:8080/debug/vars | jq .build
# {"version":"1.4.2","commit":"abc123","built":"2026-..."}
```

Then deliberately make `String()` return a raw, unquoted string and observe that the *entire* `/debug/vars` document becomes invalid JSON (`jq` errors).

**Goal.** Prove the valid-JSON contract and the "one bad var poisons the document" failure mode.

---

### Task 10 — Iterate the registry with `Do`

Write a function that, on SIGINT, walks the registry with `expvar.Do` and logs every name and value before exiting. Trigger it with Ctrl-C.

```
requests = 17
http_status = {"200": 5}
version = "v1.2.3"
...
```

**Goal.** Use `Do` to snapshot all published vars from Go code.

---

## Hard

### Task 11 — A scraper that builds a time series

Write a second program that polls `/debug/vars` every second, parses the JSON, extracts `requests`, and prints the per-second delta (the rate). Run it against Task 2's server while generating load.

**Goal.** Build the missing piece `expvar` lacks — rate computation — entirely in the consumer.

---

### Task 12 — Decouple counting from publishing (testable design)

Refactor a service so business logic increments a `*expvar.Int` passed into its constructor, and a separate wiring function publishes it once. Write a unit test that constructs the service with a fresh `new(expvar.Int)` (unpublished) and asserts on its `Value()` — without touching the global registry.

**Goal.** Avoid the global-registry test hazard by injecting unpublished vars.

---

### Task 13 — A cached gauge to keep scrapes cheap

You have an expensive value (simulate with a 200ms computation). Naively publishing it as a `Func` makes every scrape slow. Instead, recompute it on a 5-second timer into an atomic, and publish a `Func` that returns the cached value cheaply.

```bash
time curl localhost:8080/debug/vars   # should be fast, not 200ms
```

**Goal.** Keep the read path cheap by caching expensive values off the scrape path.

---

### Task 14 — Bridge `expvar` to Prometheus exposition

Write an `http.Handler` (or a `Func`-driven loop) that walks the registry with `expvar.Do`, type-switches on `*expvar.Int`/`*expvar.Float`/`*expvar.Map`, and emits Prometheus text exposition (`name value`) at `/metrics`. Confirm `curl /metrics` produces parseable Prometheus output for your `Int` and `Map` vars.

**Goal.** Stand up a transitional bridge from `expvar` numbers to a real metrics format.

---

### Task 15 — Audit the disclosure surface

Start a service that imports `expvar` and `net/http/pprof` and serves the *default* mux on a public port (the unsafe layout). Curl `/debug/vars` and `/debug/pprof/` from "outside." Document exactly what `cmdline` and `memstats` reveal. Then fix it: move public traffic to a custom mux and debug endpoints to an internal listener; confirm the public port no longer serves either.

**Goal.** Experience the `DefaultServeMux` exposure problem and the standard fix.

---

## Bonus / Stretch

### Task 16 — Gauge that reads shared state safely

Publish a `Func` that returns `len(queue)` where `queue` is mutated by worker goroutines under a mutex. Make the `Func` body take the same lock (or use an atomic counter) so the read is race-free. Run with `-race` under load and confirm no race is reported.

**Goal.** Remember that `Func` adds no synchronization; the state it reads needs its own.

---

### Task 17 — Per-endpoint latency *sum* and count

Use a `Map` with `AddFloat("latency_sum_seconds", elapsed)` and `Add("latency_count", 1)`, then compute the mean in the consumer. Note honestly what this *cannot* tell you (p99) and why you'd need a histogram-capable library instead.

**Goal.** See both the utility and the hard limit of `Map`-based aggregation.

---

### Task 18 — Gate the endpoint with auth middleware

Wrap `expvar.Handler()` in a middleware that checks a bearer token, and mount the wrapped handler. Confirm an unauthenticated request gets `401` and an authenticated one gets the JSON.

```bash
curl -i localhost:6060/debug/vars                       # 401
curl -H 'Authorization: Bearer secret' localhost:6060/debug/vars   # 200
```

**Goal.** Make a non-localhost debug endpoint safe to reach.

---

### Task 19 — Reset a `Map` with `Init`

Publish a `Map`, add several keys, then call `m.Init()` and confirm the next `/debug/vars` read shows an empty object. Discuss when resetting a published var is or isn't a good idea (it usually isn't — counters should be monotonic).

**Goal.** Know `Map.Init` exists and why you rarely want it.

---

### Task 20 — Decide `expvar`-or-not for a real service

For a service you know, write a one-paragraph recommendation: does it need `expvar`, a Prometheus client, OpenTelemetry, or some combination? Justify it against concrete needs — labels, histograms, alerting, air-gap, team tooling. Make `expvar` a deliberate choice, not a default.

**Goal.** Treat `expvar` as one option on a spectrum, chosen for a reason.

---

## Solutions (sketched)

### Solution 1
```go
package main
import ( _ "expvar"; "net/http" )
func main() { http.ListenAndServe(":8080", nil) }
```
`keys` returns `["cmdline","memstats"]`. The blank import's `init` did all the work.

### Solution 2
```go
var requests = expvar.NewInt("requests")
// in handler: requests.Add(1)
```
`requests` equals the number of handler hits. `Add` is atomic — safe under concurrent traffic.

### Solution 3
`String.String()` returns the JSON-quoted form. `jq -r` strips the quotes; the raw body shows `"v1.2.3"`. This is required: a bare `v1.2.3` would be invalid JSON.

### Solution 4
```go
expvar.Publish("goroutines", expvar.Func(func() any { return runtime.NumGoroutine() }))
```
The `Func` runs on every read, so the value tracks the live goroutine count.

### Solution 5
The second `NewInt("requests")` calls `Publish`, which finds the name already registered and `log.Fatal`s with `Reuse of exported var name: requests`. The process never reaches `main`'s server loop.

### Solution 6
```go
var byStatus = expvar.NewMap("http_status")
// byStatus.Add(strconv.Itoa(status), 1)
```
Each key's `Int` is created on first `Add`. Output is a JSON object with one key per status code, keys sorted.

### Solution 7
With a custom mux and no mount, `/debug/vars` 404s — the auto-registration is on the *default* mux, which you aren't serving. Mounting `mux.Handle("/debug/vars", expvar.Handler())` fixes it.

### Solution 8
```go
go http.ListenAndServe("127.0.0.1:6060", debugMux) // mounts expvar.Handler()
http.ListenAndServe(":8080", publicMux)            // no /debug/*
```
Public port 404s `/debug/vars`; internal port serves it. This is the standard safe layout.

### Solution 9
A correct `String()` does `json.Marshal(...)` and returns the bytes, with `"null"` on error. Returning a raw unquoted string makes the spliced document invalid — `jq` fails on the whole body, proving one var poisons everything.

### Solution 10
```go
expvar.Do(func(kv expvar.KeyValue) {
    log.Printf("%s = %s", kv.Key, kv.Value.String())
})
```
Iterates the whole registry in sorted order; run it from a signal handler before exit.

### Solution 11
The scraper stores the previous `requests` value and prints `current - previous` each tick. `expvar` exposes the raw counter; the *rate* is computed entirely in the consumer because `expvar` carries no rate metadata.

### Solution 12
```go
func NewService(reqs *expvar.Int) *Service { return &Service{reqs: reqs} }
// production wiring: NewService(expvar.NewInt("requests"))
// test: NewService(new(expvar.Int)) // unpublished, no registry touch
```
The test asserts `svc.reqs.Value()` without publishing, sidestepping the duplicate-name hazard.

### Solution 13
A goroutine recomputes the expensive value every 5s into an `atomic.Int64`/`atomic.Value`; the published `Func` returns the cached value. Scrapes are fast; the cost is paid off the read path.

### Solution 14
```go
expvar.Do(func(kv expvar.KeyValue) {
    switch v := kv.Value.(type) {
    case *expvar.Int:   fmt.Fprintf(w, "%s %d\n", kv.Key, v.Value())
    case *expvar.Float: fmt.Fprintf(w, "%s %g\n", kv.Key, v.Value())
    case *expvar.Map:   v.Do(func(iv expvar.KeyValue){ /* emit with label */ })
    }
})
```
A faithful re-exposer of flat numbers; it cannot synthesize histograms or real labels.

### Solution 15
`cmdline` shows the binary path and flags; `memstats` shows heap/GC detail. Both are reachable on the public port in the unsafe layout. The fix: custom public mux without `/debug/*`, debug endpoints on an internal listener. Verify the public port 404s both.

### Solution 16
The `Func` body must take the same lock that guards `queue`, or read an atomic counter. Run `go test -race`/`go run -race` under load; a missing lock reports a data race because `expvar` adds no synchronization of its own.

### Solution 17
`AddFloat`/`Add` accumulate sum and count; mean = sum/count. This hides the tail — you cannot recover p99 from a sum and count. A histogram-capable library (Prometheus/OTel) is required for quantiles.

### Solution 18
```go
mux.Handle("/debug/vars", requireBearer("secret", expvar.Handler()))
```
`expvar.Handler()` is a plain `http.Handler`, so wrapping it with auth middleware is trivial. Unauthed → 401; authed → JSON.

### Solution 19
`m.Init()` empties the map; the next read shows `{}`. Resetting a published counter breaks monotonicity assumptions of any scraper computing rates — avoid it except for genuinely resettable state.

### Solution 20
The recommendation should map concrete needs to tools: counters + `memstats` only and internal-only → `expvar`; labels/histograms/alerting → Prometheus client; vendor-neutral multi-signal → OpenTelemetry. Keep the `expvar`/`pprof` debug endpoint regardless, on the internal port.

---

## Checkpoints

After completing the easy tasks: you can publish counters, gauges, and strings, read `/debug/vars`, and recognize the duplicate-name crash and the `String` quoting quirk.
After completing the medium tasks: you can use `Map` for per-key counts, mount `expvar` on a custom mux, separate public from debug listeners, write a correct custom `Var`, and iterate the registry with `Do`.
After completing the hard tasks: you can build a scraper for rates, design for testability by injecting vars, keep scrapes cheap with caching, bridge `expvar` to Prometheus, and audit and fix the default-mux disclosure surface.
After completing the bonus tasks: you can safely read shared state from a `Func`, understand the limits of `Map`-based aggregation, gate the endpoint with auth, and defend (or refuse) the choice of `expvar` on a per-service basis.
