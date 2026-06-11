# Diagnostic Endpoints — Hands-On Exercises

> **Topic:** [Diagnostic Endpoints Roadmap](README.md)
> **Focus:** Practical labs that take you from "I can return `200 ok`" to "I can profile a hot service in prod, toggle log levels mid-incident, and tune k8s probes so they help instead of restart the fleet."

---

## Table of Contents

1. [Introduction](#introduction)
2. [Warm-Up](#warm-up)
3. [Core](#core)
4. [Advanced](#advanced)
5. [Capstone](#capstone)
6. [Related Topics](#related-topics)

---

## Introduction

You cannot learn diagnostic endpoints by reading about them. You learn them by wiring `/readyz` wrong, watching k8s eject every healthy pod under load, and then fixing it so the probe reads a cached atomic instead of hammering the database. You learn pprof by pulling a 30-second CPU profile from a service you deliberately made hot and being surprised by what's actually on top. The exercises below are tiered.

The **Warm-Up** band trains the reflexes: stand up the four endpoints, drive `go tool pprof`, hit `/actuator/loggers`, write a probe stanza. Fifteen to thirty minutes each — the goal is fluency, not insight. The **Core** band makes you implement the things *correctly*: a readiness check that polls off the hot path, a self-reverting log toggle, pprof on a private mux that you prove is unreachable from the public port. The **Advanced** band drops you into the failure modes that separate a junior's service from a senior's: a deep-check cascade, a probe storm, a heap dump that OOMs the pod you were trying to save, a debug surface you have to lock down with auth and a separate listener. The **Capstone** band stops being about endpoints and starts being about design: standardize an admin surface across a fleet, audit and secure an over-exposed Actuator, write the runbook the next on-call needs.

Do not skip ahead. The Capstone tasks assume you can mount pprof on a private mux and reason about a `failureThreshold` without googling. If you are still unsure why a downstream service belongs in *neither* health check, re-read the dependency matrix in [`middle.md`](middle.md) before you start.

For background reading at each level: see [junior.md](junior.md), [middle.md](middle.md), [senior.md](senior.md), [professional.md](professional.md), and [interview.md](interview.md).

A note on languages: the labs name a primary language (usually Go or Java/Spring) because the tooling is concrete, but most translate directly. Where a lab is language-specific, the **stretch goals** ask you to port it. Pick the stack you'll actually operate.

---

## Warm-Up

These are 15-to-30-minute exercises. The goal is fluency with the basic surface — health endpoints, pprof commands, Actuator URLs, probe YAML — not insight. If a Warm-Up task takes more than an hour, stop and re-read the corresponding section of [`junior.md`](junior.md) or [`middle.md`](middle.md).

### Task 1: Stand up the four starter endpoints

**Goal.** Expose `/healthz`, `/readyz`, `/version`, and `/metrics` on an HTTP server in your language of choice. Liveness returns `200 ok` unconditionally; readiness returns `200` once a `started` flag is set (flip it after a fake 3-second warm-up); version returns a JSON blob; metrics returns Prometheus text.

**Starting point.** An empty `main.go` (or `app.py`, `index.js`, a Spring Boot skeleton). No framework features beyond a router.

**Acceptance criteria.**
- [ ] `curl -i localhost:8080/healthz` returns `200` immediately, before warm-up finishes.
- [ ] `curl -i localhost:8080/readyz` returns `503` for the first ~3 seconds, then `200`.
- [ ] `curl localhost:8080/version` returns JSON with at least `{"version": ..., "commit": ...}`.
- [ ] `curl localhost:8080/metrics` returns at least one Prometheus-format line (`# HELP`, `# TYPE`, a counter).

**Hints.**
- Go: `http.NewServeMux()` and a `time.AfterFunc(3*time.Second, ...)` to flip an `atomic.Bool`.
- Spring: `spring-boot-starter-actuator` gives you `/actuator/health` and `/actuator/info` for free — the spirit is the same.
- Prometheus text: `promhttp.Handler()` (Go), `micrometer` (Spring), `prom-client` (Node).

**Stretch goals.**
- Make `/version` read the real git SHA at build time (`-ldflags "-X main.commit=$(git rev-parse HEAD)"`), not a hardcoded constant.

### Task 2: Prove liveness must not depend on the database

**Goal.** Take the readiness/liveness pair from Task 1. Add a *wrong* liveness handler that pings a database. Kill the database. Observe that k8s (or a local script simulating it) would restart the pod. Then revert liveness to the trivial handler and confirm the pod survives a DB outage.

**Starting point.** Task 1's server plus a local Postgres/Redis you can stop with `docker stop`.

**Acceptance criteria.**
- [ ] With the *wrong* liveness (DB ping in handler), stopping the DB makes `/healthz` return `503`.
- [ ] You wrote a 5-line loop that mimics a liveness probe (`failureThreshold: 3`) and showed it would "restart" after 3 failures.
- [ ] With the *correct* trivial liveness, stopping the DB leaves `/healthz` at `200` — only `/readyz` flips to `503`.

**Hints.**
- The simulated probe: `for i in 1 2 3; do curl -sf localhost:8080/healthz || echo "fail $i"; done`.
- The teaching moment: a DB blip should *skip* you (readiness), never *kill* you (liveness).

**Stretch goals.**
- Add a comment in the code explaining, in one sentence, why a restart makes a DB outage strictly worse (you lose warm caches and add boot load to a struggling system).

### Task 3: Mount pprof and pull a goroutine count

**Goal.** Wire `net/http/pprof` onto an admin server and hit `/debug/pprof/goroutine?debug=1` to read the current goroutine count and the top stacks. (Java equivalent: `/actuator/threaddump`. Python: `py-spy dump --pid`.)

**Starting point.** Any running Go service. If you don't have one, a 20-line HTTP server that spawns 50 background goroutines on startup.

**Acceptance criteria.**
- [ ] `curl 'localhost:9090/debug/pprof/goroutine?debug=1'` returns a stack summary with goroutine counts grouped by stack.
- [ ] You can name the total number of goroutines and the most common stack.
- [ ] You mounted pprof on a *separate* port (`:9090`), not the public `:8080`.

**Hints.**
- `debug=1` is the grouped summary; `debug=2` is the full per-goroutine dump.
- Mount explicitly: `mux.HandleFunc("/debug/pprof/", pprof.Index)` on your admin mux — do **not** rely on the blank-import side effect onto `DefaultServeMux`.

**Stretch goals.**
- Spin up a goroutine that blocks on an unbuffered channel forever, then find it in the `debug=2` dump by its `chan receive` stack.

### Task 4: Change a Spring log level at runtime

**Goal.** Using Spring Actuator, read the current log level of a package and change it to `DEBUG` at runtime via `/actuator/loggers`, with no restart. Confirm DEBUG lines appear, then reset to default.

**Starting point.** A Spring Boot app with `spring-boot-starter-actuator` and a class that logs at `debug` and `info` in some handler.

**Acceptance criteria.**
- [ ] `curl localhost:9090/actuator/loggers/com.example.orders` shows the configured and effective level.
- [ ] A `POST` with `{"configuredLevel":"DEBUG"}` makes that package's DEBUG logs start appearing immediately.
- [ ] A `POST` with `{"configuredLevel":null}` resets it to the inherited level and DEBUG lines stop.

**Hints.**
- `curl -X POST .../actuator/loggers/com.example.orders -H 'Content-Type: application/json' -d '{"configuredLevel":"DEBUG"}'`.
- Expose the endpoint first: `management.endpoints.web.exposure.include=health,loggers`.

**Stretch goals.**
- Do the same in Go with a `slog.LevelVar` and a tiny `POST /admin/loglevel` handler. Compare the lines of code (Spring: ~0; Go: ~20).

### Task 5: Write a three-probe Kubernetes stanza

**Goal.** Write a `startupProbe`, `livenessProbe`, and `readinessProbe` for a hypothetical app that boots in ~60 seconds and has p99 GC pauses of ~1.5 seconds. Justify every number in a comment.

**Starting point.** A blank `deployment.yaml` container spec.

**Acceptance criteria.**
- [ ] The startup probe tolerates at least 90 seconds of boot (`failureThreshold × periodSeconds ≥ 90`).
- [ ] The liveness `timeoutSeconds` exceeds the 1.5s worst-case pause (≥ 3s) and `failureThreshold ≥ 3`.
- [ ] Every numeric field has a one-line comment explaining the choice.
- [ ] `kubectl apply --dry-run=client -f deployment.yaml` (or `kubeval`) validates.

**Hints.**
- Startup probe *suspends* liveness/readiness until it first succeeds — that's what protects slow boots.
- `successThreshold` for liveness must be `1`; anything else is invalid (a common readiness copy-paste bug).

**Stretch goals.**
- Add a second variant for an app that boots in 5 seconds and explain why the startup probe is almost unnecessary there.

### Task 6: Read a 30-second CPU profile in the flame graph view

**Goal.** Take any Go service with a deliberately CPU-bound endpoint. Put it under a simple load (`hey`, `wrk`, or a `curl` loop), pull a 30-second CPU profile, and open the flame graph. Name the widest frame.

**Starting point.** A handler that does pointless work in a loop (sum of `i*i` for five million iterations) plus a load generator.

**Acceptance criteria.**
- [ ] `go tool pprof -http=:0 'http://localhost:9090/debug/pprof/profile?seconds=30'` opens a browser.
- [ ] You switched to the Flame Graph view and identified the widest frame.
- [ ] You can explain why width = time-in-frame and height = call depth.

**Hints.**
- Generate load *during* the 30-second capture window or the profile is empty.
- `hey -z 35s -c 50 http://localhost:8080/work` keeps it busy for the whole capture.

**Stretch goals.**
- Pull `/debug/pprof/heap` too and run `top` in text mode to see the biggest live allocators.

### Task 7: Suppress probe noise in access logs

**Goal.** A k8s probe hitting `/healthz` every 5 seconds produces ~17,000 access-log lines a day per pod, burying real traffic. Configure your access-log middleware to skip probe paths.

**Starting point.** A service with request logging on every route.

**Acceptance criteria.**
- [ ] After the change, `/healthz` and `/readyz` requests produce **zero** access-log lines.
- [ ] A real request to a business endpoint still logs normally.
- [ ] You did not disable logging globally — only for the probe paths.

**Hints.**
- A path allowlist/denylist in the logging middleware: `if r.URL.Path == "/healthz" { next(); return }` before the log call.
- Spring: a `RequestLoggingFilter` with a path predicate, or filter at the log-config level.

**Stretch goals.**
- Make the suppressed paths configurable via an env var so ops can re-enable probe logging for a debugging window.

---

## Core

These tasks are 1-to-3 hours each. They require you to implement things correctly — cached checks, private muxes, self-reverting toggles — and prove the property with a command, not just claim it. If you can do all of them comfortably, you're at the middle level.

### Task 8: Implement a correct readiness check (no I/O in the handler)

**Goal.** Build a readiness check whose handler does **zero I/O**. A background poller pings the database every 5 seconds with a 2-second timeout and stores the result in an atomic. The handler reads the atomic. Prove that a slow database cannot make the probe slow.

**Starting point.** A service with a real DB connection. A way to inject latency into the DB (a `pg_sleep`, a `tc` netem delay, or a proxy like `toxiproxy`).

**Acceptance criteria.**
- [ ] The probe handler contains no database call — verified by reading the code.
- [ ] With the DB healthy, `/readyz` returns `200` in under 5ms (`curl -w '%{time_total}'`).
- [ ] After injecting a 10-second DB latency, the *probe* still responds in under 5ms (it returns `503` once the poller's next ping times out, but it never *hangs*).
- [ ] The background ping has its own 2-second timeout and cannot block forever.

**Hints.**
- Go: `atomic.Bool` for `dbOK`, a `for range time.Tick(5*time.Second)` poller, `db.PingContext(ctx)` with a 2s `context.WithTimeout`.
- The whole point: "busy DB" must look like "busy DB," never like "probe timed out."

**Sample Solution.**

```go
type Readiness struct {
	started atomic.Bool
	dbOK    atomic.Bool
}

// pollDB runs in the background. The probe handler never calls this path.
func (rd *Readiness) pollDB(db *sql.DB) {
	for range time.Tick(5 * time.Second) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		rd.dbOK.Store(db.PingContext(ctx) == nil)
		cancel()
	}
}

func (rd *Readiness) handler(w http.ResponseWriter, r *http.Request) {
	switch {
	case !rd.started.Load():
		http.Error(w, "starting", http.StatusServiceUnavailable)
	case !rd.dbOK.Load():
		http.Error(w, "db unavailable", http.StatusServiceUnavailable)
	default:
		w.Write([]byte("ready"))
	}
}

// wiring
func main() {
	rd := &Readiness{}
	go rd.pollDB(db)
	rd.started.Store(true) // after real warm-up in a production app
	mux.HandleFunc("/readyz", rd.handler)
}
```

**Stretch goals.**
- Add a second dependency (a cache) to the poller and make it *not* fail readiness when the cache is down — readiness should only gate on strictly-required dependencies.

### Task 9: Build a self-reverting runtime log-level toggle

**Goal.** Implement `POST /admin/loglevel` that switches the process log level to `DEBUG` and automatically reverts to `INFO` after a bounded window (use 60 seconds for the lab; 15 minutes in prod). Prove it takes effect immediately and reverts on its own.

**Starting point.** A service whose logger reads a settable level (Go `slog.LevelVar`, Node `pino`, Python `logging`).

**Acceptance criteria.**
- [ ] Before the toggle, DEBUG lines are absent from the output.
- [ ] After `POST /admin/loglevel {"level":"DEBUG"}`, DEBUG lines appear immediately, no restart.
- [ ] After 60 seconds, DEBUG lines stop on their own — verified by watching the log stream.
- [ ] An invalid level (`{"level":"VERBOSE"}`) returns `400` and changes nothing.

**Hints.**
- Go: `logLevel := new(slog.LevelVar)`; `logLevel.Set(slog.LevelDebug)`; `time.AfterFunc(60*time.Second, func(){ logLevel.Set(slog.LevelInfo) })`.
- Guard against a *re-trigger* extending the window indefinitely if you want; for the lab, a fresh timer per call is fine.

**Sample Solution.**

```go
var logLevel = new(slog.LevelVar) // concurrent-safe; default INFO

func init() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout,
		&slog.HandlerOptions{Level: logLevel})))
}

func setLogLevel(w http.ResponseWriter, r *http.Request) {
	var body struct{ Level string }
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	var lvl slog.Level
	switch strings.ToUpper(body.Level) {
	case "DEBUG":
		lvl = slog.LevelDebug
	case "INFO":
		lvl = slog.LevelInfo
	case "WARN":
		lvl = slog.LevelWarn
	default:
		http.Error(w, "bad level", http.StatusBadRequest)
		return
	}
	logLevel.Set(lvl)
	if lvl == slog.LevelDebug {
		// auto-revert so a forgotten DEBUG doesn't flood the pipeline forever
		time.AfterFunc(60*time.Second, func() { logLevel.Set(slog.LevelInfo) })
	}
	w.Write([]byte("ok"))
}
```

**Stretch goals.**
- Make the window scoped to a single logger/package (like Actuator's `/loggers/{name}`) instead of process-wide.

### Task 10: Mount pprof on a private mux and prove it's unreachable publicly

**Goal.** Run a public app server on `:8080` and a private admin server bound to `127.0.0.1:9090`. Mount `pprof` and `expvar` only on the admin mux. Prove with `curl` that `/debug/pprof/` is reachable on `:9090` and returns `404` (or connection refused) on `:8080`.

**Starting point.** A Go service that currently uses `DefaultServeMux` and blank-imports `net/http/pprof` (the footgun configuration).

**Acceptance criteria.**
- [ ] `curl -s -o /dev/null -w '%{http_code}' localhost:9090/debug/pprof/` returns `200`.
- [ ] `curl -s -o /dev/null -w '%{http_code}' localhost:8080/debug/pprof/` returns `404` (or the connection is refused if the admin server binds loopback only).
- [ ] The public server uses an explicit mux with *only* business routes — not `DefaultServeMux`.
- [ ] You removed the blank import side-effect reliance and mounted the pprof handlers explicitly.

**Hints.**
- Bind the admin server to `127.0.0.1:9090`, not `:9090`, so it's not reachable off-box at all.
- Explicit mounts: `pprof.Index`, `pprof.Profile`, `pprof.Handler("heap").ServeHTTP`, etc.

**Sample Solution.**

```go
func startAdminServer(rd *Readiness, addr string) {
	mux := http.NewServeMux() // PRIVATE mux — not DefaultServeMux
	mux.HandleFunc("/healthz", liveness)
	mux.HandleFunc("/readyz", rd.handler)
	mux.HandleFunc("/admin/loglevel", setLogLevel)
	mux.Handle("/metrics", promhttp.Handler())

	// pprof — mounted HERE, explicitly, so it never rides DefaultServeMux
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/heap", pprof.Handler("heap").ServeHTTP)
	mux.HandleFunc("/debug/pprof/goroutine", pprof.Handler("goroutine").ServeHTTP)
	mux.Handle("/debug/vars", expvar.Handler())

	log.Fatal(http.ListenAndServe(addr, mux)) // "127.0.0.1:9090"
}

func startPublicServer() {
	mux := http.NewServeMux() // business routes ONLY
	mux.HandleFunc("/orders", ordersHandler)
	log.Fatal(http.ListenAndServe(":8080", mux))
}
```

**Stretch goals.**
- Write a CI check (a `go vet`-style grep or a small `go/analysis` linter) that fails the build if `net/http/pprof` is imported into a package that also serves `DefaultServeMux` on a public listener.

### Task 11: Capture and analyze a heap profile diff

**Goal.** Find a memory leak with two heap profiles taken 10–30 minutes apart. Use `pprof -base` to diff them and name the type and call site that's growing.

**Starting point.** A Go service with a deliberate leak — e.g., a global `map[string][]byte` that you append to on every request and never evict. Put it under steady load.

**Acceptance criteria.**
- [ ] You captured `heap1` and `heap2` via `curl 'localhost:9090/debug/pprof/heap' > heapN.pb.gz`.
- [ ] `go tool pprof -base heap1 heap2` shows positive growth (`inuse_space`).
- [ ] You named the leaking type and the source line that allocates it (`list <func>`).
- [ ] You distinguished `inuse_space` (live) from `alloc_space` (cumulative) and explained which one matters for a leak.

**Hints.**
- `go tool pprof -base heap1 heap2` then `top`, then `list yourLeakyFunc`.
- A real leak shows up under `inuse_space`; high `alloc_space` with flat `inuse_space` is churn, not a leak.

**Stretch goals.**
- Fix the leak (add eviction / bounded cache), re-run the diff, and show `inuse_space` is now flat between snapshots.

### Task 12: Wire Actuator liveness/readiness groups to k8s probes

**Goal.** Configure a Spring Boot app so `/actuator/health/liveness` and `/actuator/health/readiness` are real, separate endpoints, exposed on a *separate management port*, and wire k8s probes to them. Signal readiness programmatically after a simulated cache warm-up.

**Starting point.** A Spring Boot app with `spring-boot-starter-actuator`.

**Acceptance criteria.**
- [ ] `management.server.port` differs from the app's `server.port` (diagnostics on a separate listener).
- [ ] `/actuator/health/liveness` and `/actuator/health/readiness` each return their own status.
- [ ] During the simulated 10-second warm-up, readiness reports `OUT_OF_SERVICE`; after, `UP`.
- [ ] You published `ReadinessState.ACCEPTING_TRAFFIC` programmatically when warm-up completes.

**Hints.**
- `management.endpoint.health.probes.enabled=true`, `management.health.livenessstate.enabled=true`, `management.health.readinessstate.enabled=true`.
- Programmatic signal: `AvailabilityChangeEvent.publish(publisher, this, ReadinessState.ACCEPTING_TRAFFIC)`.

**Sample Solution.**

```properties
# application.properties
server.port=8080
management.server.port=9090
management.endpoints.web.exposure.include=health,info,metrics,loggers
management.endpoint.health.probes.enabled=true
management.health.livenessstate.enabled=true
management.health.readinessstate.enabled=true
management.endpoint.health.show-details=when-authorized
```

```java
@Component
class WarmUp {
    private final ApplicationEventPublisher publisher;
    WarmUp(ApplicationEventPublisher publisher) { this.publisher = publisher; }

    @EventListener(ApplicationReadyEvent.class)
    void warm() throws InterruptedException {
        Thread.sleep(10_000); // simulate cache warm-up
        AvailabilityChangeEvent.publish(publisher, this,
            ReadinessState.ACCEPTING_TRAFFIC); // now route traffic to us
    }
}
```

```yaml
# probes target the management port (9090)
livenessProbe:
  httpGet: { path: /actuator/health/liveness, port: 9090 }
  periodSeconds: 10
  timeoutSeconds: 3
  failureThreshold: 3
readinessProbe:
  httpGet: { path: /actuator/health/readiness, port: 9090 }
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

**Stretch goals.**
- Publish `LivenessState.BROKEN` from a simulated unrecoverable-corruption path and watch k8s restart the pod. Then argue in writing why this is a self-destruct button you must use sparingly.

### Task 13: Implement graceful drain on SIGTERM

**Goal.** On `SIGTERM`, flip readiness to `false` first, wait long enough for the load balancer to notice and stop routing, *then* shut the server down so in-flight requests finish. Prove that a rolling deploy produces zero client errors.

**Starting point.** Task 8's service with a readiness atomic and an HTTP server.

**Acceptance criteria.**
- [ ] On `SIGTERM`, `/readyz` returns `503` immediately.
- [ ] The process waits at least one probe cycle (e.g., 5s) before calling `Shutdown`.
- [ ] In-flight requests during the drain window complete successfully (no dropped connections).
- [ ] A test that fires continuous requests while you send `SIGTERM` records zero `connection refused` / `502` errors.

**Hints.**
- Order matters: readiness-false → sleep one probe period → `srv.Shutdown(ctx)`. Reverse it and you drop connections.
- Test it: `hey -z 20s http://localhost:8080/work &` then `kill -TERM <pid>` mid-run; check for non-2xx.

**Sample Solution.**

```go
func onShutdown(rd *Readiness, srv *http.Server) {
	rd.started.Store(false)               // /readyz → 503; LB begins draining us
	time.Sleep(5 * time.Second)           // let the LB's next probe cycle deregister us
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)                 // finish in-flight, then stop accepting
}

func main() {
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGTERM, syscall.SIGINT)
	go func() { <-stop; onShutdown(rd, srv) }()
	_ = srv.ListenAndServe()
}
```

**Stretch goals.**
- Add a `preStop` lifecycle hook in the pod spec (`sleep 5`) and explain how it interacts with the in-process drain (belt and suspenders for the LB deregistration race).

### Task 14: Expose computed runtime variables via expvar

**Goal.** Use Go's `expvar` to publish a few application counters plus a computed value (current goroutine count) at `/debug/vars`, on the admin port. Confirm the JSON updates as the app runs.

**Starting point.** Any Go service.

**Acceptance criteria.**
- [ ] `curl localhost:9090/debug/vars` returns JSON including your custom counters, `memstats`, and `cmdline`.
- [ ] At least one published value is computed on each request (`expvar.Func`), e.g. `runtime.NumGoroutine()`.
- [ ] The counters change between two `curl`s after you exercise the app.
- [ ] `/debug/vars` is on the admin mux, not the public one.

**Hints.**
- `expvar.NewInt("orders_total")`, `expvar.NewMap("cache").Init()`, `expvar.Publish("goroutines", expvar.Func(func() any { return runtime.NumGoroutine() }))`.
- Mount with `mux.Handle("/debug/vars", expvar.Handler())` on the admin mux — the blank import would otherwise put it on `DefaultServeMux`.

**Stretch goals.**
- Add a deliberately *expensive* `expvar.Func` (sleeps 100ms), scrape it in a tight loop, and observe how a costly published function turns each scrape into work. Then make it cheap.

---

## Advanced

These tasks are 4-to-8 hours each. They reproduce the failure modes that make diagnostic endpoints dangerous when done naively. Several have no single right answer — they have defensible writeups. Treat each as if you'll have to defend your fix in an incident review.

### Task 15: Reproduce and fix a readiness flap under load

**Goal.** Build a service whose readiness check pings the DB *synchronously in the handler*. Drive it with enough load that the DB slows down. Observe instances flapping out of rotation. Then fix it (poll off the hot path) and prove the flapping stops.

**Starting point.** A service with the *wrong* readiness handler (DB ping inline), a DB you can load, and a load generator. A local k8s (kind/minikube) or a script that mimics the readiness probe with a `timeoutSeconds: 2`.

**Acceptance criteria.**
- [ ] Under load, the synchronous-ping readiness exceeds the 2s probe timeout and the simulated probe records failures — the instance "flaps."
- [ ] You wrote a paragraph explaining the cascade: busy DB → slow probe → timeout → deregistered → traffic concentrates → more instances flap.
- [ ] After switching to a background poller + cached atomic, the readiness handler responds in single-digit milliseconds even while the DB is slow.
- [ ] Under the *same* load, the fixed version no longer flaps (zero simulated probe timeouts).

**Hints.**
- The simulated probe with a timeout: `curl --max-time 2 -sf localhost:8080/readyz || echo FAIL`.
- The lesson: a synchronous DB ping turns "busy" into "broken," and k8s can't tell the difference.

**Stretch goals.**
- Add a brief *grace period* to the cached state so a single failed background ping doesn't immediately flip readiness (debounce), and discuss the tradeoff (faster failover vs fewer false negatives).

### Task 16: Induce and observe a deep-check cascade

**Goal.** Stand up three services A → B → C where each one's readiness check pings the *next* service. Introduce a 5-second blip in C. Observe A and B both reporting unready. Then refactor so each service checks only *its own* ability to serve, and show the blip in C no longer takes down A and B.

**Starting point.** Three minimal HTTP services chained by readiness checks (the *wrong* deep-check design).

**Acceptance criteria.**
- [ ] With deep checks, a 5s outage in C makes A's and B's `/readyz` return `503`.
- [ ] You produced a timeline (timestamps) showing the failure propagating upward A ← B ← C.
- [ ] After refactoring, C's blip leaves A's and B's readiness `UP` (they degrade or queue, they don't deregister).
- [ ] You wrote one paragraph on *when* (if ever) it's legitimate to include a downstream in readiness, and why "almost never" is the default.

**Hints.**
- The fix is conceptual: readiness is a *promise about your own ability*, not a report on the world. Check your own process, not your neighbor's health.
- If A genuinely cannot serve a single request without C, the right move is usually a circuit breaker + graceful degradation, not failing readiness. See the `circuit-breaker-pattern` skill.

**Stretch goals.**
- Add a circuit breaker on A's call to B so that when B is down, A fails *fast* with a degraded response instead of hanging — and readiness stays `UP`.

### Task 17: Lock down a debug endpoint with auth on a separate port

**Goal.** Take an admin surface (pprof, heapdump, log toggle, expvar) and secure it properly: bind it to a separate port, require authentication (token or mTLS), and confirm an unauthenticated request to any debug path is rejected. Confirm the public app port exposes none of it.

**Starting point.** A service with diagnostics currently mounted (possibly on the public port). Pick Go or Spring.

**Acceptance criteria.**
- [ ] All diagnostic paths live on a dedicated admin listener, separate from the app listener.
- [ ] An unauthenticated `curl` to `/debug/pprof/`, `/admin/loglevel`, and `/actuator/heapdump` returns `401`/`403`.
- [ ] A request with the correct credential (bearer token or client cert) succeeds.
- [ ] A scan of the public port (`:8080`) shows *no* diagnostic paths reachable.
- [ ] Auth failures are logged/audited (you can see who tried).

**Hints.**
- Go: wrap the admin mux in an auth middleware that checks `Authorization: Bearer <token>` against a secret from the environment (never hardcoded — see the `secrets-management` skill).
- Spring: secure the management port with Spring Security; `management.endpoints.web.exposure.include` plus an `AuthenticationManager` on the management context.
- Defense in depth: bind admin to `127.0.0.1` or a private interface *and* require auth — not one or the other.

**Sample Solution.**

```go
// adminAuth wraps the admin mux; rejects anything without the shared token.
func adminAuth(next http.Handler, token string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		// constant-time compare to avoid a timing oracle
		if subtle.ConstantTimeCompare([]byte(got), []byte(token)) != 1 {
			log.Printf("admin auth FAIL from %s path=%s", r.RemoteAddr, r.URL.Path)
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	token := os.Getenv("ADMIN_TOKEN") // from a secret, never hardcoded
	admin := buildAdminMux(rd)        // pprof, expvar, loglevel, metrics
	go http.ListenAndServe("127.0.0.1:9090", adminAuth(admin, token))
	// public server: business routes only, no diagnostics
	http.ListenAndServe(":8080", publicMux)
}
```

**Stretch goals.**
- Replace the bearer token with mTLS (client-cert verification) so even a leaked token isn't enough without the client certificate. Review against the `api-security-checklist` skill.

### Task 18: Profile a hot service in production-like conditions without melting it

**Goal.** A CPU profile request itself consumes CPU and competes with your app. Profile a hot service *safely*: choose a sane duration, measure the latency impact of the profile capture, and decide whether on-demand profiling is safe for this workload or whether you need continuous profiling instead.

**Starting point.** A Go service under realistic load with measurable p99 latency. A way to record latency (`hey`, a histogram, or your metrics).

**Acceptance criteria.**
- [ ] You captured a 30s CPU profile while recording p50/p99 latency *during* the capture and comparing to a baseline.
- [ ] You quantified the latency impact (e.g., "p99 rose 8% during capture") with numbers, not adjectives.
- [ ] You decided, with justification, whether 30s on-demand profiling is acceptable for this service or whether you'd reach for shorter captures / continuous profiling.
- [ ] You explained why a heap profile (`/debug/pprof/heap`) is cheaper than a CPU profile (snapshot vs sampling-over-time).

**Hints.**
- A CPU profile on a tiny service is noise; on a hot service it's observable. Measure, don't assume.
- If the impact is too high, the answer is continuous profiling (always-on, low-overhead sampling). See [`../continuous-profiling/README.md`](../continuous-profiling/README.md) and the `profiling-techniques` skill.

**Stretch goals.**
- Run the capture against a single canary instance behind the LB instead of the whole fleet, and explain why you'd profile one pod, not all of them, during an incident.

### Task 19: Trigger a heap dump that OOMs the pod, then do it safely

**Goal.** Demonstrate the foot-gun: trigger `/actuator/heapdump` (or a Go heap snapshot to disk) on a memory-pressured pod with a tight memory limit and watch it get OOM-killed *by the very dump you ran to diagnose it*. Then design a safe dump procedure.

**Starting point.** A JVM (or Node/Go) service with a large live heap, running in a container with a memory limit only slightly above its working set.

**Acceptance criteria.**
- [ ] You triggered a heap dump under memory pressure and observed an OOM kill (or near-OOM with the dump failing). Capture the event (`kubectl describe pod` showing `OOMKilled`, or the JVM error).
- [ ] You wrote a one-paragraph explanation of *why* the dump caused the kill (the dump's buffers + the snapshot itself spike memory; the `.hprof` of a 4GB heap is ~4GB).
- [ ] You designed a safe procedure: dump to a volume with disk headroom, raise the memory limit temporarily or dump from a sidecar/clone, take the dump *before* the pod is critically pressured, and treat the dump as privileged + sensitive (it contains secrets/PII).
- [ ] Your safe procedure names *who* is authorized and *where* the dump file lands.

**Hints.**
- The dump file is roughly the size of the live heap; budget disk *and* the transient memory the dump machinery needs.
- A heap dump contains everything in memory — tokens, credentials, customer data. Gate it behind authz and audit it.

**Stretch goals.**
- Script a "dump from a clone": snapshot the pod's state or attach to a copy so you never dump the live, customer-serving instance under pressure.

### Task 20: Induce and resolve a probe storm

**Goal.** Misconfigure a liveness probe (`timeoutSeconds: 1`, `failureThreshold: 1`) on a service with a ~2s p99 GC pause. Run it under load until you observe a restart storm: healthy pods getting killed mid-GC, restarting, adding boot load, and triggering more restarts. Then fix the probe parameters and prove the storm stops.

**Starting point.** A service with observable GC pauses (force them with allocation pressure if needed), deployed to kind/minikube under load.

**Acceptance criteria.**
- [ ] With the tight probe, you observed repeated `Liveness probe failed` events and pod restarts under load (`kubectl get events`, `kubectl describe pod`).
- [ ] You produced a timeline correlating GC pauses with probe-failure timestamps — showing the restarts coincide with pauses, not real crashes.
- [ ] You explained the storm mechanism: restart → cold pod → boot load → more GC → more probe timeouts → more restarts.
- [ ] After setting `timeoutSeconds` above the worst-case pause (≥ 3s) and `failureThreshold ≥ 3`, the same load produces **zero** liveness-induced restarts.
- [ ] You added the missing startup probe and explained how it would have prevented the boot-time slice of the storm.

**Hints.**
- `kubectl get events --sort-by=.lastTimestamp | grep -i probe` to see the failures.
- Size `timeoutSeconds` above your p99 stop-the-world pause; size `failureThreshold` so a single blip never restarts a healthy pod.
- The startup probe *suspends* liveness during boot — without it, a slow boot looks like a wedge.

**Stretch goals.**
- Write a small "probe-tuning calculator": input boot time and p99 GC pause, output a validated `startupProbe`/`livenessProbe`/`readinessProbe` stanza with a justification comment on each field.

### Task 21: Find a goroutine/thread leak from a live dump

**Goal.** Build a service with a goroutine leak (a handler that spawns a goroutine blocked on an unbuffered channel whose receiver has already returned). Watch the goroutine count climb. Capture two `goroutine?debug=2` dumps 10 minutes apart, group by stack, and name the exact blocking line.

**Starting point.** A leaky Go service under steady request load. (Java equivalent: thread leak + `/actuator/threaddump` / `jstack`.)

**Acceptance criteria.**
- [ ] You showed the goroutine count climbing monotonically (via `/debug/pprof/goroutine?debug=1` or an `expvar` counter).
- [ ] You captured two full dumps and identified the stack shared by thousands of goroutines.
- [ ] You named the source function and the blocking operation (`chan receive`, `sync.WaitGroup.Wait`, etc.) and the file:line.
- [ ] You proposed and applied a fix (buffered channel, `context` cancellation, or a `select` with a done channel) and showed the count stops climbing.

**Hints.**
- A leak shows up as 1000+ goroutines sharing one stack parked on the same line. Group the `debug=2` dump by its top frames.
- Common cause: an unbuffered channel send with no receiver, or a missing `ctx` cancellation in a spawned goroutine.

**Stretch goals.**
- Add a guardrail: an `expvar`/metric on `runtime.NumGoroutine()` and an alert rule that fires when it crosses a threshold — so the next leak is caught by monitoring, not by a manual dump.

---

## Capstone

These are open-ended scenarios. The point is not to find one correct answer but to design and defend a complete approach. Treat each as if you're presenting it at a staff-level design review.

### Task 22: Build a reusable admin-server module for your fleet

**Goal.** Design and implement a drop-in admin-server module that any service in your organization can mount in three lines: a private listener (`127.0.0.1:9090`) bundling `/healthz`, `/readyz` (with a pluggable dependency-poller), `/version`, `/metrics`, `pprof`, `/debug/vars`, and a self-reverting `/admin/loglevel` — all behind auth.

**Constraints.**
- A service author registers dependency checks declaratively (name, timeout, interval); the module maintains the cached readiness atomic.
- pprof/expvar/dumps never touch the public listener or `DefaultServeMux`.
- The log toggle is guarded and auto-reverts.
- The module is configured by struct/options, not globals, so it's testable.

**Hints.**
- The readiness poller is the reusable core: `Register(name string, check func(ctx) error, timeout, interval)` → background goroutines write atomics → handler ANDs them.
- Ship sane defaults (loopback bind, 3-failure thresholds, 15-min toggle revert) so the common case needs no tuning.

**What "done" looks like.** You have a module with a three-line integration in a sample service. Dependency checks are registered declaratively. You proved (with `curl`) that diagnostics are reachable only on the authenticated admin port and absent from the public port. You wrote a one-page "how to adopt this in your service" doc. A second teammate can wire it into a different service without reading the source.

### Task 23: Audit and secure an over-exposed Actuator surface

**Goal.** You inherit a Spring Boot service deployed with `management.endpoints.web.exposure.include=*` on the *same* port as the app, `show-details=always`, and no auth. `/actuator/env`, `/actuator/heapdump`, and `/actuator/loggers` are all reachable from the internet. Produce the remediation.

**Constraints.**
- Identify every concretely dangerous endpoint and what it leaks or enables (env → config/secrets; heapdump → memory contents + DoS; loggers → log-flood DoS; threaddump → internal structure).
- Your fix must move diagnostics to a separate management port, restrict exposure to a deliberate allowlist, require auth, and mask secrets in any config-exposing endpoint.
- Quantify the blast radius of the current state (what an unauthenticated attacker can do today).

**Hints.**
- `management.server.port`, `management.endpoints.web.exposure.include=<allowlist>`, `management.endpoint.health.show-details=when-authorized`, Spring Security on the management context.
- `/actuator/heapdump` is both a memory-disclosure *and* a DoS vector — it's the single worst thing to leave open.

**What "done" looks like.** You have a written audit: a table of currently-exposed endpoints, each with severity and the concrete attack it enables. You have a remediation diff (properties + a security config) that moves diagnostics to a separate authenticated port and trims exposure to an allowlist. You can demo, before and after: `curl` to `/actuator/env` returns config before and `401`/connection-refused after. You wrote a short policy ("which Actuator endpoints are allowed in prod, on which port, behind which auth") your team can apply to every service.

### Task 24: Standardize liveness/readiness semantics across a polyglot fleet

**Goal.** Your organization runs Go, Java/Spring, Python, and Node services, each with its own ad-hoc health checks — some put the DB in liveness, some have no readiness, some have no startup probe. Design a single contract that all four stacks implement identically, and a way to verify compliance.

**Constraints.**
- Define the contract precisely: what liveness means, what readiness means, which dependencies are allowed in each, the path/port convention, the drain behavior, and the probe-parameter rules (timeout > worst pause, `failureThreshold ≥ 3`, startup probe for slow boots).
- The contract must be enforceable — a CI check or admission policy, not just a wiki page.
- Account for the languages' differences (Spring gives liveness/readiness groups for free; Go/Python/Node need the pattern hand-rolled).

**Hints.**
- The dependency matrix from [`middle.md`](middle.md) is your spec: process → both; required DB → readiness only (cached); optional cache → neither; downstream you call → neither.
- Enforcement options: an OPA/Gatekeeper policy on probe parameters, a CI lint that rejects DB calls in liveness handlers, a conformance test that hits `/healthz`/`/readyz` and asserts behavior.

**What "done" looks like.** You have a one-page contract any engineer can implement in any of the four stacks. You have at least one enforcement mechanism implemented (a Gatekeeper policy that rejects a `livenessProbe` with `failureThreshold: 1`, or a CI conformance test). You can show a non-compliant service being rejected and a compliant one passing. You can explain how a new language joining the fleet adopts the contract.

### Task 25: Write a "diagnose a live service" runbook

**Goal.** Write the runbook an on-call engineer reaches for when a service is misbehaving and they have access to its diagnostic endpoints but have never operated it before. Cover: CPU pinned, memory creeping, service hung, "deploy succeeded but old behavior persists," and "I need DEBUG logs for one code path, now."

**Constraints.**
- Maximum 2 pages, organized by symptom, with copy-pasteable commands.
- Name the exact endpoint/tool per symptom and the *next* decision (mitigate vs keep investigating).
- Include the safety rails: don't heap-dump a pressured pod, don't profile the whole fleet, auto-revert log toggles, treat dumps as sensitive.
- Tool-agnostic where possible; where you assume a tool, name it (`go tool pprof`, `kubectl`, Actuator).

**Hints.**
- CPU pinned → `/debug/pprof/profile?seconds=30` (or shorter on a hot service), flame graph, widest frame.
- Memory creeping → two heap profiles 30 min apart, `pprof -base`, name the growing type.
- Hung → goroutine/thread dump (`debug=2` / `/actuator/threaddump`), group by stack.
- Old behavior persists → `curl /version` on each pod to confirm the build.
- Need DEBUG → POST `/admin/loglevel` or `/actuator/loggers/<pkg>`, with a self-revert.

**What "done" looks like.** Your runbook is readable in 5 minutes and actionable by someone who's never seen the service. Each symptom section has the exact command, the expected output shape, and the decision point. It tells the engineer when to stop diagnosing and start mitigating (rollback, traffic shift, autoscale, restart). It calls out the foot-guns explicitly. A teammate can use it on a real incident and report back whether it held up.

---

## If you can do all of these, you have the senior level

You can implement health and readiness that tell the truth under failure instead of lying or cascading. You can mount pprof, expvar, dumps, and a log toggle on a private authenticated port and prove the public port exposes none of it. You can pull a CPU profile, diff two heap snapshots, and find a goroutine leak from a live dump without restarting anything. You can tune a Kubernetes probe so it survives a GC pause instead of restarting a healthy fleet, and you can recognize a probe storm or a deep-check cascade *as it happens* and name the fix. The next step is not more endpoint exercises — it's the senior material: live profiling under load without melting the service, fleet-wide standardization and authz, and designing the diagnostic surface so the next engineer can operate the system at 3am without paging you.

---

## Related Topics

- [Diagnostic Endpoints — Junior](junior.md)
- [Diagnostic Endpoints — Middle](middle.md)
- [Diagnostic Endpoints — Senior](senior.md)
- [Diagnostic Endpoints — Professional](professional.md)
- [Diagnostic Endpoints — Interview](interview.md)
- Sibling diagnostic topics: [Debugging](../debugging/README.md), [Logging](../logging/README.md), [Metrics](../metrics/README.md), [Continuous Profiling](../continuous-profiling/README.md)
- [DevOps](../../../DevOps/) and the `container-orchestration`, `high-availability-patterns`, `circuit-breaker-pattern`, `secrets-management`, and `api-security-checklist` skills.
