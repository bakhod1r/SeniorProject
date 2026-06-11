# Diagnostic Endpoints — Middle Level

> **Focus:** Implement health and readiness *correctly* — dependency checks that don't lie and don't cascade. Drive `net/http/pprof` and Spring Actuator like power tools. Toggle log levels at runtime. Wire Kubernetes liveness/readiness/startup probes so they help instead of hurt.

> **Topic:** [Diagnostic Endpoints Roadmap](README.md)

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Implementing Health & Readiness Correctly](#implementing-health--readiness-correctly)
8. [Profiling Endpoints — pprof in Anger](#profiling-endpoints--pprof-in-anger)
9. [Spring Boot Actuator — The Full Surface](#spring-boot-actuator--the-full-surface)
10. [expvar and Runtime Variables](#expvar-and-runtime-variables)
11. [Runtime Log-Level Toggles](#runtime-log-level-toggles)
12. [On-Demand Dumps — Thread, Goroutine, Heap](#on-demand-dumps--thread-goroutine-heap)
13. [Wiring Kubernetes Probes](#wiring-kubernetes-probes)
14. [Code Examples](#code-examples)
15. [Pros & Cons](#pros--cons)
16. [Use Cases](#use-cases)
17. [Coding Patterns](#coding-patterns)
18. [Clean Code](#clean-code)
19. [Best Practices](#best-practices)
20. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
21. [Common Mistakes](#common-mistakes)
22. [Tricky Points](#tricky-points)
23. [Test Yourself](#test-yourself)
24. [Tricky Questions](#tricky-questions)
25. [Cheat Sheet](#cheat-sheet)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)
30. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Stop returning `200 ok` and calling it a health check.** Make these endpoints carry real information without making them a liability.

At junior level you exposed `/healthz`, `/readyz`, `/metrics`, and `/version`, and you learned the cardinal rule: liveness means "restart me," readiness means "skip me." That gets a service deployed. It does not get it *operable*. The middle-level jump is two-fold.

First, **correctness under failure**. A health check is only valuable if it tells the truth at the exact moment things are going wrong — and that's precisely when naïve implementations lie or backfire. A readiness check that queries the database synchronously will time out under load and report `503` *because it's busy*, removing a healthy instance right when you need it most. A liveness check with a dependency in it restarts the whole fleet during a downstream blip. Getting health *right* means understanding *which* dependencies belong in *which* check, with timeouts, caching, and graceful degradation.

Second, **the introspection surface beyond health**. A running process has questions you'll want to ask without redeploying: *what's burning CPU right now? what's leaking goroutines? can I crank logging to DEBUG for ten minutes?* `net/http/pprof`, Spring Actuator's `/threaddump` and `/heapdump`, `expvar`, and runtime log-level toggles answer those — and you should be able to drive them from memory, because the time you need them is during an incident, not during a tutorial.

> 🎓 **Why this matters at middle level:** The difference between a junior's and a mid-level engineer's service is that the mid-level one can be *diagnosed and tuned while it runs*. You don't restart to read a profile. You don't redeploy to raise the log level. You don't guess what's stuck — you pull a goroutine dump. The endpoints make the live process answer for itself.

---

## Prerequisites

- **Required:** All of [`junior.md`](junior.md) — liveness/readiness distinction, basic `/healthz`/`/readyz`/`/metrics`/`/version`, the "status code is the answer" rule.
- **Required:** You can write an HTTP middleware/handler in your language and read an HTTP status code with `curl -i`.
- **Required:** Basic Kubernetes literacy — what a Pod, Deployment, and container are. See [`../../../DevOps/`](../../../DevOps/).
- **Required:** You know what CPU and heap profiling *are* conceptually (see [`../debugging/middle.md`](../debugging/middle.md) and the `profiling-techniques` skill).
- **Helpful:** Familiarity with structured logging and log levels. See [`../logging/middle.md`](../logging/middle.md).

---

## Glossary

| Term | Definition |
|------|-----------|
| **Shallow check** | A health check that proves only the process is responsive (no dependencies touched). |
| **Deep check** | A health check that verifies dependencies (DB, cache, downstreams). Powerful and dangerous. |
| **Probe** | One scheduled call to a health endpoint by k8s/LB. Has `initialDelay`, `period`, `timeout`, `failureThreshold`. |
| **Startup probe** | A k8s probe that gates liveness/readiness until the app has booted; protects slow starters. |
| **`pprof`** | Go's profiler + the `/debug/pprof/*` HTTP surface (CPU, heap, goroutine, mutex, block, trace). |
| **Profile** | A captured sample set — CPU stacks over N seconds, or a heap snapshot — that `go tool pprof` analyzes. |
| **Actuator** | Spring Boot's diagnostic endpoint framework (`/actuator/*`). |
| **Health group** | An Actuator concept: a named subset of health indicators (e.g. `liveness`, `readiness`). |
| **expvar** | Go stdlib package exposing public variables as JSON at `/debug/vars`. |
| **Thread/goroutine dump** | A snapshot of every thread/goroutine's stack — the tool for "what is the process stuck on?" |
| **Heap dump** | A snapshot of all live objects in memory, for offline leak analysis (MAT, `pprof`). |
| **Log-level toggle** | A runtime endpoint that changes a logger's level without restart (`/actuator/loggers`, custom `/admin/loglevel`). |
| **Graceful drain** | On shutdown, flip readiness to `false`, finish in-flight requests, *then* exit. |
| **`failureThreshold`** | How many consecutive probe failures before k8s acts (restart for liveness, deregister for readiness). |

---

## Core Concepts

### 1. The Right Dependency in the Right Check

There is a decision matrix you must internalize:

| Dependency | Liveness? | Readiness? | Why |
|---|---|---|---|
| The process itself responding | ✅ | ✅ | The whole point. |
| A *required* DB you can't serve any request without | ❌ | ⚠️ cautiously | A DB blip should skip you, not restart you — and even skipping the whole fleet is dangerous. |
| An *optional* cache (you degrade without it) | ❌ | ❌ | Degrade gracefully; don't fail health for it. |
| A downstream service you call | ❌ | ❌ usually | Its health is *its* problem; failing yours cascades the outage upward. |
| In-flight startup (caches warming) | ❌ | ✅ | Readiness is exactly "have I finished booting?" |

The default answer for *every* external dependency in *liveness* is **no**. The default for readiness is "only if you literally cannot serve a single request without it, and even then think twice."

### 2. Deep Checks Cascade; Shallow Checks Don't

A "deep" readiness check that pings every dependency feels thorough. But consider the topology: service A's readiness checks service B; B's checks C; C has a 5-second blip. Now A and B both report unready, the LB drops them, traffic concentrates on fewer instances, they overload, *their* readiness fails too — a **cascading failure** triggered by one downstream hiccup. (Senior territory; introduced here so you stop reaching for deep checks reflexively.) Prefer checking *your* ability to function, not *their* health.

### 3. Profiling Endpoints Are Always-On, On-Demand

`/debug/pprof/*` costs nothing until you hit it. A CPU profile is captured *only* while you're requesting `?seconds=30`; a heap profile is computed *only* on GET. So you mount them permanently (on the admin port) and pay only when diagnosing. This is the model: the surface is ready; the cost is deferred to the moment of need.

### 4. Toggle, Don't Redeploy

The mid-level reflex during an incident is *"I wish I had DEBUG logs for this code path."* Redeploying with a higher log level takes minutes you don't have and changes the system you're debugging. A **runtime log-level toggle** flips one logger to DEBUG for ten minutes, then back — no redeploy, no restart, surgical. Spring gives it for free (`/actuator/loggers`); in Go/Python/Node you wire a tiny `/admin/loglevel` handler over an atomic level.

### 5. Probes Have Parameters, and the Defaults Bite

A Kubernetes probe isn't just a URL — it's `initialDelaySeconds`, `periodSeconds`, `timeoutSeconds`, `failureThreshold`, `successThreshold`. Most production incidents involving probes come from *wrong parameters*, not wrong endpoints: a liveness `timeout` shorter than a GC pause, an `initialDelay` shorter than boot time, a `failureThreshold` of 1 that restarts on a single blip. Knowing the endpoint is half the job; tuning the probe is the other half.

---

## Real-World Analogies

| Concept | Analogy |
|---|---|
| Shallow vs deep check | A receptionist saying "I'm here and answering" vs personally calling every supplier before saying "we're open." |
| Deep-check cascade | A power grid where each substation trips when its neighbor trips — one fault blacks out the region. |
| On-demand pprof | A security camera that only records when you press "capture" — no storage cost while idle. |
| Runtime log toggle | A dimmer switch — turn the brightness up to inspect, back down when done, without rewiring the room. |
| Goroutine/thread dump | A freeze-frame of a crowded kitchen showing exactly what every cook is waiting on. |
| Startup probe | A "do not disturb until 9am" sign so the night manager isn't fired for the shop being dark at 7am. |
| `failureThreshold` | Requiring three missed heartbeats, not one, before calling the code team — avoids panicking over a single skipped beat. |

---

## Mental Models

### Model 1: "Health Is a Promise, Not a Diagnosis"

Readiness promises *"route to me and I'll serve correctly."* Liveness promises *"I'm not in a state only a kill can fix."* Both are **promises about your own ability**, not reports on the world. The moment your health check starts reporting on *other* systems' health, it stops being a promise you can keep and becomes a rumor you propagate. Keep checks about what you can guarantee.

### Model 2: "The Admin Port Is a Workshop"

Everything diagnostic — pprof, dumps, log toggles, expvar — lives on a port that's a *workshop*: full of power tools, locked to the public, lit only when you're working. You don't move the workshop into the showroom (public port) just because it's convenient. The mid-level habit is: new diagnostic capability → admin port, always.

### Model 3: "Probes Are a Control Loop"

Kubernetes runs a feedback loop: probe → evaluate → act (restart / deregister) → repeat. Like any control loop, it oscillates badly when mis-tuned — too sensitive (`failureThreshold: 1`, short timeout) and it thrashes; too sluggish (long period, high threshold) and it ignores real failures for minutes. You're tuning a controller, not setting a flag.

---

## Implementing Health & Readiness Correctly

### The shape of a correct readiness check

A good readiness check is: *started up* AND *required dependencies are usable* — where "usable" is checked **cheaply, with a timeout, and ideally from cached state**, not by hammering the dependency on every probe.

```go
type Readiness struct {
	started  atomic.Bool
	dbOK     atomic.Bool // updated by a background poller, NOT on every probe
}

// Background goroutine pings the DB every few seconds and caches the result,
// so the probe handler reads an atomic instead of doing I/O on the hot path.
func (rd *Readiness) pollDB(db *sql.DB) {
	for range time.Tick(5 * time.Second) {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		rd.dbOK.Store(db.PingContext(ctx) == nil)
		cancel()
	}
}

func (rd *Readiness) handler(w http.ResponseWriter, r *http.Request) {
	if !rd.started.Load() {
		http.Error(w, "starting", http.StatusServiceUnavailable)
		return
	}
	if !rd.dbOK.Load() {
		http.Error(w, "db unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Write([]byte("ready"))
}
```

Why this shape:

- **No I/O in the probe handler.** The probe reads an atomic; the actual DB ping happens on a background timer with its *own* timeout. A slow DB can't make your probe slow.
- **The check is bounded.** The background ping has a 2s timeout, so it can't hang.
- **It degrades, it doesn't crash.** A `503` from readiness deregisters you; it never restarts you.

### Liveness: keep it dumb on purpose

```go
func liveness(w http.ResponseWriter, r *http.Request) {
	w.Write([]byte("ok")) // that's it. that's the check.
}
```

A liveness check that does anything more is a liability. The one *legitimate* enrichment is detecting a **wedged event loop / deadlocked runtime** — e.g., a watchdog goroutine that updates a "last tick" timestamp and liveness fails if it's stale. But that detects *your own* wedge, never a dependency's.

### Graceful drain: the often-missed half

Readiness isn't only for startup. On `SIGTERM`, flip readiness to `false` *first*, wait for the LB to notice and stop routing, then finish in-flight requests and exit:

```go
func onShutdown(rd *Readiness, srv *http.Server) {
	rd.started.Store(false)         // /readyz now returns 503 → LB drains us
	time.Sleep(5 * time.Second)     // let the LB's next probe cycle deregister us
	srv.Shutdown(context.Background()) // finish in-flight, then stop
}
```

Skip this and the LB keeps sending requests to a process that's already closing connections — instant errors on every deploy.

---

## Profiling Endpoints — pprof in Anger

In Go, a single blank import wires the entire profiling surface onto a mux:

```go
import _ "net/http/pprof" // registers /debug/pprof/* on http.DefaultServeMux
```

The endpoints, and what each answers:

| Endpoint | Question it answers | How to pull it |
|---|---|---|
| `/debug/pprof/profile?seconds=30` | "What's using CPU?" | `go tool pprof http://host:9090/debug/pprof/profile?seconds=30` |
| `/debug/pprof/heap` | "What's holding memory?" | `go tool pprof http://host:9090/debug/pprof/heap` |
| `/debug/pprof/goroutine?debug=2` | "What is everything stuck on?" | `curl ...goroutine?debug=2 > gs.txt` |
| `/debug/pprof/mutex` | "Where is lock contention?" | requires `runtime.SetMutexProfileFraction(n)` |
| `/debug/pprof/block` | "Where do goroutines block?" | requires `runtime.SetBlockProfileRate(n)` |
| `/debug/pprof/allocs` | "What allocates the most (cumulative)?" | `go tool pprof ...allocs` |
| `/debug/pprof/trace?seconds=5` | "Full execution trace" | `go tool pprof` / `go tool trace` |

The interactive workflow you'll use most:

```bash
# Pull a 30s CPU profile from a live (admin-port) service and explore it.
go tool pprof -http=:0 'http://localhost:9090/debug/pprof/profile?seconds=30'
# In the browser: Flame Graph view. Widest frame = hottest. Done.

# Or text-mode:
go tool pprof 'http://localhost:9090/debug/pprof/heap'
(pprof) top          # biggest retainers
(pprof) list LRU.Set # annotated source of a suspect function
(pprof) web          # SVG call graph
```

> **Mid-level discipline:** mount pprof on the **admin port**, never the public one. A CPU profile request makes the runtime do work; an attacker who can hit `/debug/pprof/profile` repeatedly has a cheap DoS *and* a memory-disclosure vector. (Why, in [`senior.md`](senior.md).)

**Python** has no built-in equivalent, but `py-spy` attaches to a running PID with no code changes — the on-demand spirit, externalized:

```bash
sudo py-spy dump   --pid $PID            # all thread stacks (≈ goroutine dump)
sudo py-spy top    --pid $PID            # live "top" of Python functions
sudo py-spy record --pid $PID -o flame.svg --duration 30
```

**Node** exposes the V8 inspector for profiling: start with `--inspect` (bound to localhost!), connect Chrome DevTools, use the Profiler tab — or use `clinic flame` / `0x` for flame graphs without a UI.

**Rust** (axum/tower) has no built-in surface; `pprof-rs` gives you a CPU profiler you mount behind a handler that returns a pprof- or flamegraph-format body on demand.

---

## Spring Boot Actuator — The Full Surface

The JVM's batteries-included answer. With `spring-boot-starter-actuator` on the classpath, you opt endpoints in and get a rich diagnostic surface:

```properties
# Expose only what you want, on a SEPARATE port.
management.server.port=9090
management.endpoints.web.exposure.include=health,info,metrics,prometheus,threaddump,heapdump,loggers,env

# Real liveness/readiness groups, mapped to k8s probes:
management.endpoint.health.probes.enabled=true
management.health.livenessstate.enabled=true
management.health.readinessstate.enabled=true

# Show health detail only to authenticated callers (default is "never"):
management.endpoint.health.show-details=when-authorized
```

What you get:

| Endpoint | Use |
|---|---|
| `/actuator/health/liveness` | k8s liveness probe target. |
| `/actuator/health/readiness` | k8s readiness probe target. |
| `/actuator/threaddump` | JSON thread dump — "what's stuck?" Replaces SSHing in for `jstack`. |
| `/actuator/heapdump` | Downloads a `.hprof` — open in Eclipse MAT for leak analysis. **Heavy & sensitive.** |
| `/actuator/loggers/{name}` | GET the level; POST to *change it at runtime*. |
| `/actuator/prometheus` | `/metrics` in Prometheus format (via Micrometer). |
| `/actuator/info` | Build/version info (wire git-commit-id plugin for SHA). |
| `/actuator/env` | Current config (with sensitive keys masked). |

A Spring app can also signal readiness/liveness programmatically:

```java
@Component
public class WarmUp {
    private final ApplicationAvailability availability;
    private final ApplicationEventPublisher publisher;
    // ...
    void onCacheLoaded() {
        // Tell Actuator we're ready to receive traffic.
        AvailabilityChangeEvent.publish(publisher, this, ReadinessState.ACCEPTING_TRAFFIC);
    }
    void onFatalCorruption() {
        // Tell Actuator we're broken — liveness flips, k8s restarts us.
        AvailabilityChangeEvent.publish(publisher, this, LivenessState.BROKEN);
    }
}
```

This is the JVM's superpower: liveness/readiness/threaddump/heapdump/log-toggle, standardized, with almost no code. The *risk* is exposing too much (`/actuator/env` leaks config, `/actuator/heapdump` leaks memory) — covered in [`senior.md`](senior.md).

---

## expvar and Runtime Variables

Go's `expvar` is the minimal, zero-dependency `/metrics`. Importing it registers `/debug/vars`, which serves a JSON object of published variables plus `memstats` and `cmdline`:

```go
import "expvar"

var (
	ordersTotal = expvar.NewInt("orders_total")
	cacheStats  = expvar.NewMap("cache").Init()
)

func init() {
	// You can publish computed values via a function, evaluated on each scrape.
	expvar.Publish("goroutines", expvar.Func(func() any {
		return runtime.NumGoroutine()
	}))
}

// usage: ordersTotal.Add(1) ; cacheStats.Add("hits", 1)
```

```bash
curl localhost:9090/debug/vars
# {"orders_total": 1287, "cache": {"hits": 9001, "misses": 42},
#  "goroutines": 138, "memstats": { ... }, "cmdline": [...] }
```

When to use `expvar` vs Prometheus: `expvar` is great for quick, dependency-free introspection and ad-hoc counters; Prometheus client is what you wire to dashboards and alerting. Many services run both — `expvar` for a fast human `curl`, `/metrics` for the monitoring system. Note: `/debug/vars` is registered on `DefaultServeMux`, so a naïve setup can leak it onto your public port. Mount it deliberately.

---

## Runtime Log-Level Toggles

The single highest-value "control" endpoint after health. The pattern: an **atomic level variable** that your logger reads, plus a tiny handler to set it.

### Go (`slog` with a `LevelVar`)

```go
var logLevel = new(slog.LevelVar) // safe for concurrent use; default INFO

func init() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout,
		&slog.HandlerOptions{Level: logLevel})))
}

// POST /admin/loglevel  body: {"level":"DEBUG"}
func setLogLevel(w http.ResponseWriter, r *http.Request) {
	var body struct{ Level string }
	json.NewDecoder(r.Body).Decode(&body)
	switch strings.ToUpper(body.Level) {
	case "DEBUG":
		logLevel.Set(slog.LevelDebug)
	case "INFO":
		logLevel.Set(slog.LevelInfo)
	case "WARN":
		logLevel.Set(slog.LevelWarn)
	default:
		http.Error(w, "bad level", http.StatusBadRequest)
		return
	}
	w.Write([]byte("ok"))
}
```

`logLevel.Set(slog.LevelDebug)` takes effect immediately, process-wide, no restart. Pair it with a self-revert (a timer that resets to INFO after 15 minutes) so a forgotten DEBUG toggle doesn't flood your log pipeline forever.

### Java (Actuator gives it free)

```bash
# Read the level:
curl localhost:9090/actuator/loggers/com.example.orders
# Set it at runtime:
curl -X POST localhost:9090/actuator/loggers/com.example.orders \
  -H 'Content-Type: application/json' -d '{"configuredLevel":"DEBUG"}'
# Reset:
curl -X POST localhost:9090/actuator/loggers/com.example.orders \
  -H 'Content-Type: application/json' -d '{"configuredLevel":null}'
```

### Python / Node

Python: a handler that calls `logging.getLogger(name).setLevel(...)`. Node: many loggers (`pino`, `winston`) expose `logger.level = "debug"` at runtime; wrap it in an admin route. Same shape everywhere: one atomic-ish level, one guarded endpoint.

---

## On-Demand Dumps — Thread, Goroutine, Heap

When a process is *stuck* (not crashed), a dump is the tool. Each ecosystem:

| Ecosystem | "What's stuck?" (stacks) | "What's leaking?" (memory) |
|---|---|---|
| **Go** | `curl .../debug/pprof/goroutine?debug=2` | `go tool pprof .../debug/pprof/heap` |
| **Java** | `curl .../actuator/threaddump` (or `jstack <pid>`) | `curl .../actuator/heapdump > h.hprof` → MAT |
| **Python** | `py-spy dump --pid <pid>` | `tracemalloc` snapshots / `py-spy --memory` |
| **Node** | `kill -USR1` (inspector) or `process.report` | `require('v8').writeHeapSnapshot()` → DevTools |
| **Rust** | `pprof-rs` handler / `tokio-console` for async tasks | heap via external (`jemalloc` profiling, `bytehound`) |

The goroutine/thread dump is the fastest path from "the service is hung" to "here's the line every worker is blocked on." Group the dump by stack signature: if 10,000 goroutines share one stack parked on `chan receive`, you've found a leak whose producer died. (Deep treatment in [`../debugging/senior.md`](../debugging/senior.md).)

> **Caution, foreshadowing `professional.md`:** a heap dump on a 16 GB heap writes a 16 GB file and can pause/OOM the process. `/actuator/heapdump` on a memory-pressured pod can *be* the thing that kills it. On-demand dumps are powerful and not free.

---

## Wiring Kubernetes Probes

The endpoints are useless until the orchestrator calls them with sane parameters. The three probe types map to the three questions:

```yaml
# deployment.yaml (container spec)
ports:
  - name: http
    containerPort: 8080      # public app traffic
  - name: admin
    containerPort: 9090      # diagnostics — NOT exposed via a public Service

# STARTUP: gate everything until the app booted. Protects slow starters.
startupProbe:
  httpGet:   { path: /healthz, port: 8080 }
  periodSeconds: 5
  failureThreshold: 30       # 30 × 5s = up to 150s to boot before giving up

# LIVENESS: restart if wedged. Cheap endpoint, generous timeout (survive GC pauses).
livenessProbe:
  httpGet:   { path: /healthz, port: 8080 }
  periodSeconds: 10
  timeoutSeconds: 3          # MUST exceed your worst-case GC/STW pause
  failureThreshold: 3        # 3 misses (~30s) before restart — not 1

# READINESS: deregister if not ready. Can be slightly "deeper".
readinessProbe:
  httpGet:   { path: /readyz, port: 8080 }
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

The rules that prevent self-inflicted outages:

1. **Startup probe exists for slow boots.** Without it, liveness fires during boot and you crash-loop forever. The startup probe *suspends* liveness/readiness until it first succeeds.
2. **Liveness `timeout` > worst-case pause.** If a 2-second GC stop-the-world exceeds a 1-second liveness timeout, healthy pods get restarted mid-GC. Size the timeout above your p99 pause.
3. **`failureThreshold` ≥ 3 for liveness.** Restarting on a single blip is how one slow probe becomes a restart storm.
4. **Liveness and readiness usually share the cheap endpoint or use distinct ones — never the same *logic* that includes dependencies in liveness.**
5. **Probes hit the app port or the admin port — pick deliberately.** Many teams probe the app port for simplicity; just ensure the path is dependency-correct.

(The *why these rules exist* — probe storms, cascading restarts — is the heart of [`senior.md`](senior.md).)

---

## Code Examples

### Go — a complete admin server on a separate port

```go
func startAdminServer(rd *Readiness, addr string) {
	mux := http.NewServeMux()                 // a PRIVATE mux, not DefaultServeMux
	mux.HandleFunc("/healthz", liveness)
	mux.HandleFunc("/readyz", rd.handler)
	mux.HandleFunc("/version", versionHandler)
	mux.HandleFunc("/admin/loglevel", setLogLevel)
	mux.Handle("/metrics", promhttp.Handler())

	// Mount pprof explicitly on THIS mux so it isn't on the public one.
	mux.HandleFunc("/debug/pprof/", pprof.Index)
	mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("/debug/pprof/heap", pprof.Handler("heap").ServeHTTP)
	mux.HandleFunc("/debug/pprof/goroutine", pprof.Handler("goroutine").ServeHTTP)

	// expvar on the admin mux too:
	mux.Handle("/debug/vars", expvar.Handler())

	log.Printf("admin server on %s (private)", addr)
	log.Fatal(http.ListenAndServe(addr, mux)) // e.g. "127.0.0.1:9090"
}

// public app server uses a DIFFERENT mux with only business routes.
```

The key move: a **private mux** so `pprof` and `expvar` don't ride along on `DefaultServeMux` to your public port.

### Python — FastAPI with a cached dependency check

```python
import asyncio, time
from fastapi import FastAPI, Response

app = FastAPI()
_state = {"started": False, "db_ok": False, "db_checked": 0.0}

async def poll_db():
    while True:
        try:
            await asyncio.wait_for(db.ping(), timeout=2.0)
            _state["db_ok"] = True
        except Exception:
            _state["db_ok"] = False
        _state["db_checked"] = time.time()
        await asyncio.sleep(5)

@app.on_event("startup")
async def startup():
    asyncio.create_task(poll_db())
    await warm_caches()
    _state["started"] = True

@app.get("/healthz")                          # liveness — trivial
async def healthz():
    return Response("ok", 200)

@app.get("/readyz")                           # readiness — reads cached state
async def readyz():
    if not _state["started"]:
        return Response("starting", 503)
    if not _state["db_ok"]:
        return Response("db down", 503)
    return Response("ready", 200)
```

### Node — runtime log toggle with pino + drain

```js
const pino = require("pino");
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

// POST /admin/loglevel  { "level": "debug" }
adminApp.post("/admin/loglevel", express.json(), (req, res) => {
  const valid = ["trace", "debug", "info", "warn", "error"];
  if (!valid.includes(req.body.level)) return res.status(400).send("bad level");
  logger.level = req.body.level;            // takes effect immediately
  // auto-revert so a forgotten DEBUG doesn't flood forever:
  setTimeout(() => { logger.level = "info"; }, 15 * 60 * 1000);
  res.send("ok");
});

let ready = true;
process.on("SIGTERM", () => {
  ready = false;                            // /readyz now 503 → LB drains
  setTimeout(() => server.close(() => process.exit(0)), 5000);
});
```

---

## Pros & Cons

| Capability | Pros | Cons |
|---|---|---|
| Shallow liveness | Can't cascade; cheap; can't lie about dependencies | Won't detect a process that's "up" but functionally broken |
| Deep readiness | Catches "I can't serve" before users do | Risk of cascade; cost on every probe if not cached |
| `pprof` endpoints | Live CPU/heap/goroutine insight, zero cost when idle | Memory disclosure + DoS if exposed; profiling adds load |
| Actuator | Liveness/readiness/dumps/log-toggle with ~no code | Easy to over-expose (`env`, `heapdump`) |
| Runtime log toggle | Surgical debug logging, no redeploy | Forgotten toggles flood logs; needs auth |
| On-demand heap dump | Exact leak analysis on a live process | Can OOM/pause the very process you're saving |
| Startup probe | Protects slow boots from crash-loops | One more knob to tune; wrong `failureThreshold` masks real boot failures |

---

## Use Cases

- **Service crash-loops on deploy because boot takes 90s.** Add a **startup probe** with a high `failureThreshold`.
- **CPU pinned at 100% in prod, no idea where.** Pull `/debug/pprof/profile?seconds=30`, read the flame graph.
- **Memory creeping up over hours.** Two heap profiles 30 min apart, diff with `pprof -base`.
- **A specific endpoint misbehaves and you need DEBUG logs for it only, now.** POST to `/actuator/loggers/<pkg>` or `/admin/loglevel`.
- **The service is hung, not crashed.** Goroutine/thread dump; group by stack.
- **DB has a 5s blip and you want pods *skipped*, not *killed*.** Correct: DB in *readiness* (cached), not liveness.
- **Deploy "succeeded" but old behavior persists.** `curl /version` on each pod to confirm the build.

---

## Coding Patterns

### Pattern: cached dependency state, polled off the hot path

```go
// Background poller writes; probe reads. Probe never does I/O.
go rd.pollDB(db)
mux.HandleFunc("/readyz", rd.handler)
```

### Pattern: private mux for diagnostics

```go
adminMux := http.NewServeMux()       // pprof/expvar/metrics go here
go http.ListenAndServe("127.0.0.1:9090", adminMux)
```

### Pattern: self-reverting log toggle

```go
logLevel.Set(slog.LevelDebug)
time.AfterFunc(15*time.Minute, func() { logLevel.Set(slog.LevelInfo) })
```

### Pattern: readiness as the drain switch

```go
// shutdown: flip readiness false, wait a probe cycle, then Shutdown().
rd.started.Store(false)
time.Sleep(2 * probePeriod)
srv.Shutdown(ctx)
```

---

## Clean Code

- Liveness handler is a one-liner. Resist enriching it.
- Readiness reads *cached* dependency state; the actual ping lives in a background poller with its own timeout.
- Diagnostics (pprof, expvar, dumps, toggles, metrics) live on a **private mux / separate port**, never `DefaultServeMux` reachable from public.
- Every runtime toggle (log level, debug mode) is **guarded** (auth and/or admin port) and ideally **self-reverting**.
- Suppress access logs for probe paths so they don't bury real logs. (See [`../logging/middle.md`](../logging/middle.md).)
- Wire real build info into `/version` at compile time (`-ldflags`, git-commit-id plugin), not a hardcoded constant you'll forget to bump.

---

## Best Practices

1. **No I/O in probe handlers.** Poll dependencies on a timer; have probes read cached atomics.
2. **Liveness depends on nothing but the process.** Readiness may *cautiously* include strictly-required dependencies.
3. **Tune the probe, not just the endpoint.** `timeout` > worst-case pause; `failureThreshold` ≥ 3 for liveness; startup probe for slow boots.
4. **Mount pprof/expvar/dumps on the admin port.** Never let them ride `DefaultServeMux` to the public listener.
5. **Ship a runtime log-level toggle** in every service; prefer self-reverting.
6. **Drain on shutdown**: flip readiness false → wait a probe cycle → `Shutdown`.
7. **Treat heap dumps as heavy and sensitive.** Know they can pause/OOM; never trigger casually under memory pressure.
8. **Mask secrets** in any config-exposing endpoint (`/actuator/env`, custom `/admin/config`).

---

## Edge Cases & Pitfalls

- **`net/http/pprof`'s blank import registers on `DefaultServeMux`.** If your public server uses `DefaultServeMux`, you just exposed pprof to the internet. Use an explicit private mux.
- **Liveness timeout shorter than a GC pause** → healthy pods restarted during collection → throughput collapses under load (exactly when GC is busiest).
- **Readiness ping with no timeout** → a hung DB hangs the probe → k8s times out the probe → instance flaps in and out of rotation.
- **Startup probe missing** → liveness kills the pod mid-boot → `CrashLoopBackOff` that looks like an app crash but is a probe misconfig.
- **`/actuator/heapdump` exposed and reachable** → anyone can both DoS you (giant dump) and exfiltrate memory contents (secrets, PII).
- **Log toggle with no auth** → an attacker flips you to DEBUG and floods/expensive-ifies your logging pipeline.
- **`successThreshold` > 1 on liveness** is invalid in k8s (must be 1) — a copy-paste from readiness that silently misbehaves.
- **Probing the *app* port while the app port is saturated** → readiness fails *because* you're busy → you get deregistered → remaining pods overload → cascade.

---

## Common Mistakes

1. **Putting a DB ping directly in the probe handler.** Under load it times out and ejects healthy instances.
2. **One endpoint serving both liveness and readiness with dependency logic in it.** A dependency blip now restarts pods.
3. **Exposing pprof/actuator on the public port** via `DefaultServeMux` or a permissive `exposure.include=*`.
4. **No startup probe for a slow-booting app** → permanent crash-loop on deploy.
5. **Liveness `failureThreshold: 1` with a tight timeout** → restart storm on the first transient blip.
6. **Forgetting to drain.** No readiness-false on `SIGTERM` → errors on every rolling deploy.
7. **Leaving a DEBUG log toggle on** → log pipeline flooded, costs spike, signal drowned.
8. **Triggering a heap dump on a memory-pressured pod** → the dump OOM-kills the very process you were investigating.

---

## Tricky Points

- **A passing readiness check during startup is a *bug*, not a feature** — it means you're routing to a cold instance. Readiness should default closed.
- **pprof endpoints have prerequisites**: `mutex` and `block` profiles return nothing until you call `runtime.SetMutexProfileFraction` / `SetBlockProfileRate`. Empty profile ≠ no contention; it may mean "not enabled."
- **Actuator `health` returns aggregate UP/DOWN by default but hides detail** unless `show-details` is set — and showing detail is itself a disclosure decision.
- **`/debug/vars` evaluates `expvar.Func` values on every request** — an expensive published function turns each scrape into work. Keep them cheap.
- **k8s liveness and readiness use independent counters.** A pod can be `Running` (liveness OK) but `0/1 READY` (readiness failing) indefinitely — that's a draining or warming pod, not a bug.
- **A profile request competes with your app for CPU.** A 30-second CPU profile on a hot service is observable in latency; on a tiny service it's noise. Know which you have.
- **Spring's `LivenessState.BROKEN` actually causes a restart** via the probe — publish it only for genuinely unrecoverable state, or you've built a self-destruct button.

---

## Test Yourself

1. Write a readiness check that polls the DB on a 5s timer (with a 2s timeout) and has the probe handler read a cached atomic. Why must the ping not happen *in* the handler?
2. Mount `net/http/pprof` on a private mux on `127.0.0.1:9090`. Prove (with `curl`) that `/debug/pprof/` is **not** reachable on your public `:8080`.
3. Pull a 30s CPU profile from a deliberately hot endpoint and identify the top function in the flame graph.
4. Add a `/admin/loglevel` toggle that flips to DEBUG and auto-reverts after 60s. Verify with log output.
5. Trigger a goroutine/thread dump on a service with a leaked goroutine; group the dump and name the blocking line.
6. Write k8s `startupProbe`/`livenessProbe`/`readinessProbe` for an app that boots in ~60s and has p99 GC pauses of ~1.5s. Justify every number.
7. Explain, with the dependency matrix, why a downstream service you *call* should usually be in *neither* health check.

---

## Tricky Questions

**Q1: Your readiness check pings the database on every probe. Under heavy load, instances start flapping out of rotation. Why?**
Under load the DB is slow; the synchronous ping in the probe handler exceeds the probe `timeout`; k8s reads the timeout as a failure and deregisters the instance — *because it's busy, not because it's broken*. Now traffic concentrates on fewer instances, which get slower, which flap too. Fix: poll the DB on a background timer with its own timeout; the probe reads cached state and never does I/O.

**Q2: Why is the `net/http/pprof` blank import a security footgun?**
It registers `/debug/pprof/*` on `http.DefaultServeMux`. If your public HTTP server serves `DefaultServeMux` (the common default), you've just published CPU/heap/goroutine profiling — a memory-disclosure surface and a cheap DoS (profiling consumes CPU) — to anyone who can reach the port. Mount it on an explicit private mux on the admin port.

**Q3: A pod is `Running` but shows `0/1 READY` for ten minutes. Is something wrong?**
Not necessarily. `Running` means liveness is fine (don't restart); `0/1 READY` means readiness is returning `503` (don't route here). That's exactly a pod that's still warming up, draining, or whose required dependency is temporarily down. It's the system *working as designed* — readiness gating traffic away from an instance that can't serve. Investigate *why* readiness is false, don't assume a crash.

**Q4: When would you ever raise the log level at runtime instead of redeploying with DEBUG?**
Almost always, during an incident. Redeploying takes minutes, restarts the process (losing the state you're debugging), and changes the system. A runtime toggle flips one logger to DEBUG for a bounded window on the exact running instance, then reverts — no restart, no redeploy, minimal perturbation.

**Q5: Your liveness probe has `timeoutSeconds: 1`. The app does a ~2s stop-the-world GC at p99. What happens, and how often?**
Roughly once per p99 GC cycle, the liveness probe lands during the pause, times out at 1s, and counts a failure. With `failureThreshold: 1` that's an immediate restart of a perfectly healthy pod; with a higher threshold it's intermittent restarts under load. Fix: set `timeoutSeconds` comfortably above worst-case pause and `failureThreshold` ≥ 3.

**Q6: Is it safe to expose `/actuator/heapdump` to your operators on the admin port?**
With auth and awareness, yes — but treat it as a privileged, heavy operation. The dump can be many GB, can pause the JVM, and on a memory-pressured pod can trigger the OOM you were trying to diagnose. It also contains *everything in memory* — secrets, tokens, customer PII. Gate it behind authz, audit its use, and never trigger it reflexively. (Full treatment in `professional.md`.)

---

## Cheat Sheet

```text
┌─────────────────────────── DIAGNOSTIC ENDPOINTS — MIDDLE CHEAT SHEET ───────────────────────────┐
│                                                                                                 │
│  DEPENDENCY-IN-CHECK MATRIX                                                                     │
│    process itself        → liveness ✅  readiness ✅                                            │
│    required DB           → liveness ❌  readiness ⚠ (cached ping, timeout)                      │
│    optional cache        → liveness ❌  readiness ❌  (degrade gracefully)                      │
│    downstream you call   → liveness ❌  readiness ❌  (don't cascade their outage upward)       │
│                                                                                                 │
│  CORRECT READINESS                                                                             │
│    background poller (own timeout) writes atomic → probe handler READS atomic, never does I/O  │
│                                                                                                 │
│  GO pprof (mount on PRIVATE mux / admin port)                                                  │
│    profile?seconds=30  CPU     heap  memory     goroutine?debug=2  stuck                        │
│    mutex / block  (need SetMutexProfileFraction / SetBlockProfileRate first)                    │
│    go tool pprof -http=:0 'http://host:9090/debug/pprof/profile?seconds=30'                     │
│                                                                                                 │
│  SPRING ACTUATOR (separate management.server.port!)                                            │
│    /actuator/health/{liveness,readiness}   /threaddump   /heapdump                             │
│    POST /actuator/loggers/<pkg> {"configuredLevel":"DEBUG"}   /prometheus                       │
│                                                                                                 │
│  RUNTIME LOG TOGGLE  → slog.LevelVar / pino logger.level / Actuator loggers ; SELF-REVERT       │
│                                                                                                 │
│  K8S PROBES                                                                                     │
│    startupProbe   → protect slow boot (high failureThreshold)                                   │
│    livenessProbe  → timeout > worst GC pause ; failureThreshold ≥ 3                             │
│    readinessProbe → can be slightly deeper ; drains on SIGTERM                                  │
│                                                                                                 │
│  RULES                                                                                          │
│    • probe handlers do NO I/O   • diagnostics on admin port   • drain before exit               │
│    • heap dump = heavy + sensitive   • toggles need auth + auto-revert                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **Correct health is about *which dependency goes in which check*.** Liveness depends on nothing but the process; readiness may *cautiously* include strictly-required dependencies — cached, timed-out, polled off the hot path.
- **Never do I/O in a probe handler.** Poll on a background timer with its own timeout; the probe reads an atomic. A synchronous DB ping makes "busy" look like "broken."
- **Deep checks cascade.** A readiness check that pings downstreams turns one blip into a fleet-wide cascade. Check *your* ability to serve, not *their* health.
- **`pprof` is always-on, on-demand**: mount `/debug/pprof/*` on a **private mux / admin port** (the blank import's `DefaultServeMux` registration is a footgun), pull CPU/heap/goroutine profiles only when diagnosing.
- **Spring Actuator** delivers liveness/readiness groups, `/threaddump`, `/heapdump`, `/prometheus`, and runtime `/loggers` with almost no code — on a separate management port.
- **`expvar`** is Go's zero-dependency `/debug/vars`; great for quick `curl` introspection alongside Prometheus.
- **Runtime log-level toggles** let you debug a specific path without redeploying; make them guarded and self-reverting.
- **On-demand dumps** (goroutine/thread for "stuck", heap for "leaking") are the tools for a hung or bloating live process — and heap dumps are heavy and sensitive.
- **Wire k8s probes deliberately**: startup probe for slow boots, liveness `timeout` above worst-case GC pause, `failureThreshold` ≥ 3, and drain readiness on `SIGTERM`.

---

## What You Can Build

- A reusable **admin server module** for your language: private mux on `127.0.0.1:9090` bundling `/healthz`, `/readyz` (cached deps), `/metrics`, `/version`, pprof, `/debug/vars`, and a self-reverting `/admin/loglevel`.
- A **dependency-poller** library: register a check (DB, cache, queue) with a timeout and interval; it maintains the atomic readiness state your probe reads.
- A **probe-tuning calculator**: input your boot time and p99 GC pause, output sane `startupProbe`/`livenessProbe`/`readinessProbe` YAML with justifications.
- A **"pprof footgun" linter**: a check that fails CI if `net/http/pprof` is imported into a package that serves `DefaultServeMux` on a public listener.
- A **drain-on-SIGTERM** wrapper that flips readiness false, waits a configurable probe cycle, then gracefully shuts the server — drop-in for any service.

---

## Further Reading

- Kubernetes probe reference: <https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/>
- Go `net/http/pprof`: <https://pkg.go.dev/net/http/pprof> · "Profiling Go Programs": <https://go.dev/blog/pprof>
- Spring Boot Actuator (health groups, probes): <https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html#actuator.endpoints.kubernetes-probes>
- `py-spy`: <https://github.com/benfred/py-spy> · `clinic` (Node): <https://clinicjs.org/>
- Brendan Gregg, *Systems Performance* — flame graphs and on-demand profiling.

---

## Related Topics

- [`junior.md`](junior.md) — the four starter endpoints and the liveness/readiness distinction.
- [`senior.md`](senior.md) — readiness/liveness semantics under cascading failure, probe storms, the security exposure, separate admin port, on-demand profiling in prod.
- [`professional.md`](professional.md) — safe live profiling under load, dumps without OOM, fleet standardization, authz, abuse of debug endpoints.
- [`interview.md`](interview.md) — health-check and diagnostic-endpoint interview questions.
- [`tasks.md`](tasks.md) — hands-on labs.
- [`../metrics/middle.md`](../metrics/middle.md) — the signals behind `/metrics`.
- [`../logging/middle.md`](../logging/middle.md) — structured logs, suppressing probe noise, log levels.
- [`../debugging/middle.md`](../debugging/middle.md) — pprof, dumps, and profilers as debugging tools.
- [`../continuous-profiling/README.md`](../continuous-profiling/README.md) — turning on-demand pprof into always-on.
- [DevOps](../../../DevOps/) and the `container-orchestration`, `high-availability-patterns` skills — probe wiring and resilience.

---

## Diagrams & Visual Aids

### Probe handler reads cache; poller does the I/O

```text
   ┌────────────────┐  every 5s (2s timeout)   ┌──────────┐
   │ background      │ ───────ping───────────►  │   DB     │
   │ poller          │ ◄──────ok/err──────────  └──────────┘
   └───────┬────────┘
           │ store atomic(dbOK)
           ▼
   ┌────────────────┐   probe (no I/O!)         ┌──────────┐
   │ /readyz handler│ ◄──────────────────────── │  k8s     │
   │  read atomic   │ ──────200 / 503─────────► │  kubelet │
   └────────────────┘                           └──────────┘
```

### The three probes over a pod's life

```text
   t=0 ───────────────► boot (90s) ───► serving ──────► SIGTERM ──► exit
        startupProbe: failing → succeeds│
        livenessProbe:   (suspended)    │ OK ............... OK
        readinessProbe:  (suspended)    │ READY ........ NOT READY (drain)
                                        ▲                    ▲
                          startup gate lifts          readiness flips false,
                          liveness/readiness begin     LB stops routing, drain
```

### Public mux vs private mux

```text
   public  :8080  (DefaultServeMux?)        private :9090  (own ServeMux)
   ├── /orders                              ├── /healthz  /readyz  /version
   ├── /login                               ├── /metrics  /debug/vars
   └──  ⚠ pprof leaks here if you            ├── /debug/pprof/*   ← mount HERE
        blank-import net/http/pprof          └── /admin/loglevel
        AND serve DefaultServeMux
```
