# Diagnostic Endpoints — Junior Level

> **Topic:** [Diagnostic Endpoints Roadmap](README.md)
> **Focus:** What a diagnostic endpoint is. Liveness vs readiness. Your first `/healthz` and `/metrics`. Why a running service exposes URLs that nobody outside the team is ever supposed to call.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The First Toolkit](#the-first-toolkit)
8. [Code Examples](#code-examples)
9. [Health vs Metrics — Don't Confuse Them](#health-vs-metrics--dont-confuse-them)
10. [Use Cases](#use-cases)
11. [Coding Patterns](#coding-patterns)
12. [Clean Code](#clean-code)
13. [Best Practices](#best-practices)
14. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
15. [Common Mistakes](#common-mistakes)
16. [Tricky Points](#tricky-points)
17. [Test Yourself](#test-yourself)
18. [Tricky Questions](#tricky-questions)
19. [Cheat Sheet](#cheat-sheet)
20. [Summary](#summary)
21. [What You Can Build](#what-you-can-build)
22. [Further Reading](#further-reading)
23. [Related Topics](#related-topics)
24. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **What is a diagnostic endpoint, and why does almost every backend service have a `/healthz` URL you've never typed into a browser?**

A **diagnostic endpoint** is a URL (or RPC) that a running service exposes *about itself* rather than about your business data. `/healthz` doesn't return an order or a user — it returns *"am I alive?"*. `/metrics` doesn't return a product page — it returns counts and timings of everything the process has done. `/version` returns the exact build that's running right now. These endpoints exist so that **other software** — a load balancer, Kubernetes, a Prometheus scraper, an on-call engineer with `curl` — can ask a live process questions without stopping it, attaching a debugger, or reading its source.

Here's the mental shift to make early: most of the code you write is for *users*. Diagnostic endpoints are for *operators* — the people and machines that keep your service running. A user never sees `/healthz`. But if `/healthz` is wrong, the user sees an outage. The endpoint that nobody looks at on a good day is the one everybody depends on during a bad one.

This page covers the two endpoints you'll meet first and use forever: **health/readiness checks** (the contract between your process and whatever is routing traffic to it) and **`/metrics`** (the numbers a monitoring system reads). We'll build a `/healthz` in Go, Python, Node, and Java/Spring, explain why *liveness* and *readiness* are two different questions, and explain why you must never put the database in a liveness check. The next level (`middle.md`) wires these into Kubernetes probes and adds profiling endpoints. `senior.md` covers the trade-offs and security. `professional.md` covers running this safely across a whole fleet.

> 🎓 **Why this matters for a junior:** The first time a deploy "succeeds" but the service serves errors, it's almost always a health-check bug — you reported "ready" before you actually were, or "alive" when you were wedged. Getting these two checks right is one of the highest-leverage things a junior can learn, because every service you ever touch has them, and most of them are subtly wrong.

---

## Prerequisites

What you should know before reading this:

- **Required:** How to write and run a small HTTP server in at least one language (Go, Python/Flask/FastAPI, Node/Express, Java/Spring).
- **Required:** What an HTTP request, an HTTP status code (`200`, `503`), and a URL path are.
- **Required:** The difference between a *process* (your running program) and the *machine/container* it runs on.
- **Helpful:** A rough idea of what a **load balancer** does — it sits in front of N copies of your service and sends each request to one of them.
- **Helpful:** A rough idea of what **Kubernetes** is — software that runs many copies of your container and restarts the ones that look unhealthy. See [`../../../DevOps/`](../../../DevOps/).
- **Helpful:** Exposure to [`../metrics/junior.md`](../metrics/junior.md). This roadmap is about the *endpoints*; metrics is about the *numbers* those endpoints expose.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Diagnostic endpoint** | A URL/RPC a service exposes about its own state (health, metrics, version, profiles) rather than about business data. |
| **Health check** | An endpoint that answers "is this process okay?" with a status code. The umbrella term. |
| **Liveness** | "Is the process *alive and not wedged*?" If this fails, the right action is to **restart** the process. |
| **Readiness** | "Is the process *ready to receive traffic right now*?" If this fails, the right action is to **stop sending it requests** (but don't restart). |
| **Startup probe** | "Has the process *finished booting*?" Used for slow-starting apps so liveness doesn't kill them mid-boot. |
| **Probe** | The act of calling a health endpoint on a schedule. Kubernetes and load balancers "probe" your service. |
| **`/metrics`** | The conventional path where a service exposes counters/gauges/histograms in Prometheus text format. |
| **Prometheus** | A monitoring system that periodically *scrapes* (HTTP GETs) every service's `/metrics` and stores the numbers. |
| **Scrape** | One HTTP GET of `/metrics` by a monitoring system. |
| **Load balancer (LB)** | Routes incoming requests across multiple instances; uses readiness to decide which instances are eligible. |
| **`200 OK` / `503 Service Unavailable`** | The two status codes health endpoints overwhelmingly use: `200` = healthy, `503` = not. |
| **Actuator** | Spring Boot's built-in set of diagnostic endpoints (`/actuator/health`, `/actuator/metrics`, …). |
| **expvar** | Go's standard-library package that exposes runtime variables as JSON at `/debug/vars`. |
| **pprof** | Go's profiling endpoints at `/debug/pprof/*` (a `middle.md` topic, named here for vocabulary). |
| **Admin port** | A *separate* network port for diagnostic endpoints, so they aren't reachable from the public internet. |

---

## Core Concepts

### 1. A Diagnostic Endpoint Talks About the Service, Not the Data

The handler for `/orders` returns orders. The handler for `/healthz` returns *the service's opinion of itself*. This is the defining distinction. When you see a path like `/health`, `/ready`, `/metrics`, `/version`, `/debug/*`, `/actuator/*` — you're looking at the **control and introspection surface**, not the product. Different audience, different rules, different security posture.

### 2. Liveness and Readiness Answer Two Different Questions

This is the single most important idea on this page, and the one juniors most often get wrong.

- **Liveness** = *"Am I broken in a way only a restart can fix?"* Examples of a real liveness failure: a deadlock where every request hangs forever, a corrupted in-memory state, an event loop that stopped turning. The orchestrator's response: **kill and restart me.**
- **Readiness** = *"Should traffic come to me *right now*?"* Examples of a real readiness failure: I'm still loading a 2 GB model into memory, my database connection pool is temporarily empty, I'm draining before shutdown. The orchestrator's response: **leave me running, just stop routing to me.**

If you swap them, disaster follows. Put "is the database reachable?" in your *liveness* check, and a 30-second database blip will make Kubernetes **restart every single one of your pods at once** — turning a recoverable hiccup into a full outage. (More on this exact failure in `senior.md`.)

### 3. The Status Code *Is* the Answer

Health endpoints communicate through the HTTP status code, not the body. `200` means healthy; anything else (almost always `503`) means not. The body is for *humans* reading `curl` output — it can say *why* — but the machine probing you only reads the code. Get the code right first.

### 4. Cheap Checks Beat Thorough Checks

A health check runs *constantly* — every few seconds, on every instance, forever. If your check does real work (queries the DB, calls another service), you've built a tiny load test that runs 24/7 and can amplify outages. A liveness check should be nearly free: *"is my process responding to HTTP at all?"* often just returns `200 ok` and that's correct.

### 5. `/metrics` Is a Snapshot, Not a Log

`/metrics` exposes *current values* of counters and gauges — `http_requests_total 48213`, `goroutines 142`. It is read on a schedule by a monitoring system, which stores the time series. You don't call `/metrics` to "log an event"; you increment a counter in your code, and `/metrics` reports the running total whenever it's scraped. See [`../metrics/junior.md`](../metrics/junior.md) for the signals themselves.

### 6. These Endpoints Leak Internals — Treat Them Carefully

`/metrics` reveals your traffic volumes and error rates. `/version` reveals your exact build (and thus its known CVEs). `/debug/pprof` can dump memory. None of this should be reachable by the public internet. Even as a junior, internalize: **diagnostic endpoints are not public endpoints.** `senior.md` and `professional.md` go deep on this; for now, know that they belong behind auth, on a separate port, or both.

---

## Real-World Analogies

| Concept | Real-World Analogy |
|---|---|
| **Diagnostic endpoint** | The diagnostic port (OBD-II) under your car's dashboard — not for driving, but for the mechanic's scanner. |
| **Liveness check** | A pulse. No pulse → resuscitate (restart). |
| **Readiness check** | A "this register is closed" sign at a checkout lane. The cashier is fine; just don't queue here right now. |
| **Startup probe** | A shop's "opening soon" sign while staff set up — don't judge them as dead before they've unlocked the doors. |
| **Putting the DB in a liveness check** | Declaring yourself clinically dead because the building's WiFi is down. An overreaction with fatal consequences. |
| **`/metrics`** | A car's dashboard gauges — speed, RPM, fuel — read at a glance, continuously. |
| **Prometheus scraping** | A nurse doing rounds every 15 minutes recording everyone's vitals onto a chart. |
| **Admin port** | A staff-only door at the back of the shop. Customers use the front; operations happen out of sight. |
| **`/version`** | The "best before / batch number" stamp — tells you exactly which production run this unit came from. |

---

## Mental Models

### 1. The Service Has Two Doors

Picture every service as a building with two doors. The **front door** (your public port, e.g. `:8080`) is for customers — it serves `/orders`, `/login`, `/search`. The **back door** (your admin port, e.g. `:9090`) is for staff — `/healthz`, `/metrics`, `/debug/*`. Customers should never find the back door, and the back door should never be on the same street as the front. When you wire diagnostics, you're building and locking the back door.

### 2. Liveness Is "Restart Me," Readiness Is "Skip Me"

Don't memorize definitions — memorize the *action each one triggers*. Ask of any failure: *"Do I want to be restarted, or do I just want to be skipped?"*

- Want a restart → it's a **liveness** concern.
- Want to be skipped temporarily → it's a **readiness** concern.

If you can't honestly say "restarting fixes this," it does **not** belong in liveness.

### 3. The Probe Is a Question Asked Forever

Your health endpoint is not called once. It's called every few seconds for the entire life of the deployment — across every instance. So design it as something that's cheap to ask a million times, not something thorough you'd run once. Every expensive thing you put in it, you pay for continuously.

### 4. Metrics Are Cumulative; You Read the Difference

A Prometheus counter only goes up. `http_requests_total` is `0` at boot and climbs forever. The *useful* number — "requests per second right now" — comes from the monitoring system subtracting two scrapes. Your job is just to count honestly and expose the total; the math happens upstream.

---

## The First Toolkit

Your day-one diagnostic toolkit is small:

1. **A `/healthz` endpoint** that returns `200 ok`. (`z` is a Google convention to avoid clashing with a real `/health` business page.)
2. **A `/readyz` endpoint** that returns `200` only once startup is finished and dependencies you *truly need* are usable.
3. **A `/metrics` endpoint** using your language's Prometheus client library.
4. **A `/version` (or `/buildinfo`) endpoint** returning the git SHA and build time, so you can answer *"did the new version actually deploy?"* in one `curl`.
5. **`curl`** — your client for all of the above. `curl -i localhost:8080/healthz` shows you the status code (`-i` prints headers).

That's the whole starter kit. Everything else in this roadmap — pprof, heap dumps, runtime toggles, continuous profiling — is depth on top of these four endpoints.

---

## Code Examples

The same four endpoints — `/healthz`, `/readyz`, `/metrics`, `/version` — in four ecosystems. Read them side by side; the *shape* is identical everywhere.

### Go — `net/http`, `expvar`, and Prometheus

```go
package main

import (
	"encoding/json"
	"net/http"
	"sync/atomic"

	"github.com/prometheus/client_golang/prometheus/promhttp"
)

// ready is flipped to true once startup finishes. Atomic so the probe
// goroutine and the startup goroutine don't race on it.
var ready atomic.Bool

var buildInfo = map[string]string{
	"version":   "1.4.2",
	"gitSHA":    "a1b2c3d",
	"buildTime": "2026-06-11T09:00:00Z",
}

func main() {
	mux := http.NewServeMux()

	// LIVENESS: dirt cheap. If the process can answer HTTP, it's alive.
	// Never touch the DB or downstreams here.
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	// READINESS: 200 only once we've finished booting (and, if you truly
	// need them, only when required dependencies are usable).
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if !ready.Load() {
			http.Error(w, "still starting", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ready"))
	})

	// VERSION: which build is actually running?
	mux.HandleFunc("/version", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(buildInfo)
	})

	// METRICS: Prometheus exposition format.
	mux.Handle("/metrics", promhttp.Handler())

	go warmUp() // simulate slow startup

	http.ListenAndServe(":8080", mux)
}

func warmUp() {
	// ... load config, prime caches, open the DB pool ...
	ready.Store(true) // now and only now do we accept traffic
}
```

Go's standard library also ships **`expvar`**: importing it registers `/debug/vars`, a JSON blob of runtime counters (memory stats, GC, plus anything you publish). It's the zero-dependency cousin of `/metrics`:

```go
import (
	"expvar"
	_ "expvar" // registers /debug/vars on http.DefaultServeMux
)

var ordersProcessed = expvar.NewInt("orders_processed")

// later: ordersProcessed.Add(1)
// curl localhost:8080/debug/vars  ->  {"orders_processed": 42, "memstats": {...}}
```

### Python — Flask + `prometheus_client`

```python
# pip install flask prometheus_client
from flask import Flask, Response
from prometheus_client import Counter, generate_latest, CONTENT_TYPE_LATEST
import threading

app = Flask(__name__)

_ready = threading.Event()  # set once startup completes

BUILD = {"version": "1.4.2", "git_sha": "a1b2c3d", "build_time": "2026-06-11T09:00:00Z"}
requests_total = Counter("http_requests_total", "Total HTTP requests", ["path"])

@app.get("/healthz")          # LIVENESS — cheap, no dependencies
def healthz():
    return "ok", 200

@app.get("/readyz")           # READINESS — only after warm-up
def readyz():
    if not _ready.is_set():
        return "still starting", 503
    return "ready", 200

@app.get("/version")
def version():
    return BUILD, 200

@app.get("/metrics")          # Prometheus exposition
def metrics():
    return Response(generate_latest(), mimetype=CONTENT_TYPE_LATEST)

def warm_up():
    # ... prime caches, open the DB pool ...
    _ready.set()

if __name__ == "__main__":
    threading.Thread(target=warm_up, daemon=True).start()
    app.run(host="0.0.0.0", port=8080)
```

### Node.js — Express + `prom-client`

```js
// npm i express prom-client
const express = require("express");
const client = require("prom-client");

const app = express();
let ready = false; // flipped true after warm-up

const BUILD = { version: "1.4.2", gitSha: "a1b2c3d", buildTime: "2026-06-11T09:00:00Z" };
const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry }); // event-loop lag, heap, etc.

app.get("/healthz", (_req, res) => res.status(200).send("ok"));          // liveness

app.get("/readyz", (_req, res) =>                                        // readiness
  ready ? res.status(200).send("ready") : res.status(503).send("starting"));

app.get("/version", (_req, res) => res.json(BUILD));

app.get("/metrics", async (_req, res) => {                                // metrics
  res.set("Content-Type", registry.contentType);
  res.send(await registry.metrics());
});

app.listen(8080, () => {
  setTimeout(() => { ready = true; }, 3000); // simulate slow warm-up
});
```

### Java — Spring Boot Actuator (almost no code)

The JVM's answer is **Actuator**: add one dependency and you get `/actuator/health`, `/actuator/info`, `/actuator/metrics`, and more, for free.

```xml
<!-- pom.xml -->
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
<!-- For /metrics in Prometheus format: -->
<dependency>
  <groupId>io.micrometer</groupId>
  <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

```properties
# application.properties
# Liveness vs readiness as SEPARATE health groups (Spring supports this directly):
management.endpoint.health.probes.enabled=true
management.health.livenessstate.enabled=true
management.health.readinessstate.enabled=true

# Prometheus scrape endpoint at /actuator/prometheus
management.endpoints.web.exposure.include=health,info,metrics,prometheus

# Put diagnostics on a SEPARATE port (see senior.md on why this matters):
management.server.port=9090
```

Now `curl localhost:9090/actuator/health/liveness` and `.../readiness` return `{"status":"UP"}` separately, and `/actuator/prometheus` is your `/metrics`. You wrote zero handler code.

---

## Health vs Metrics — Don't Confuse Them

Juniors routinely blur these. They answer different questions for different consumers:

| | Health/readiness | `/metrics` |
|---|---|---|
| **Question it answers** | "Should I get traffic / be restarted?" | "How much / how fast / how many?" |
| **Consumer** | Load balancer, Kubernetes | Prometheus, dashboards, alerts |
| **Response** | A status code (`200`/`503`) | A block of numbers |
| **Called when** | Every few seconds, per instance | Every scrape interval (e.g. 15s) |
| **What failure means** | "Take action on this instance" | Nothing — it's just data |
| **Should it be cheap?** | Yes, extremely | Yes (don't compute on scrape) |

A health check that returns rich metrics is over-engineered. A `/metrics` endpoint that load balancers probe for routing is misused. Keep the lanes separate.

---

## Use Cases

| Situation | Endpoint you reach for |
|---|---|
| Kubernetes needs to know when to restart a wedged pod. | **Liveness** (`/healthz`). |
| The load balancer needs to know which instances can take traffic. | **Readiness** (`/readyz`). |
| Your app loads a huge model and takes 40s to boot. | **Startup probe** (so liveness doesn't kill it mid-boot). |
| You want a dashboard of request rate and error rate. | **`/metrics`** scraped by Prometheus. |
| "Did the hotfix actually deploy, or is the old version still running?" | **`/version`**. |
| You're debugging locally and want quick runtime counters with zero deps (Go). | **`/debug/vars`** (expvar). |
| On-call needs to confirm a service is up during an incident. | `curl` the **liveness** endpoint. |

---

## Coding Patterns

### Pattern 1 — Separate Liveness From Readiness From Day One

```go
mux.HandleFunc("/healthz", liveness)  // restart me if this fails
mux.HandleFunc("/readyz", readiness)  // skip me if this fails
```

Even if both return `200` today, having two endpoints means you can evolve them independently without re-plumbing your probes later.

### Pattern 2 — The Readiness Flag

```python
_ready = threading.Event()
# ... after warm-up ...
_ready.set()
```

A single boolean/event flipped at the end of startup is the simplest correct readiness signal. Default it to *not ready* so you never accept traffic before you're done booting.

### Pattern 3 — Liveness Returns a Constant

```js
app.get("/healthz", (_req, res) => res.status(200).send("ok"));
```

The cheapest possible handler. If the process can run this, it's alive enough to keep. Resist the urge to "make it more useful" by adding checks — that's how you accidentally turn a DB blip into a restart storm.

### Pattern 4 — Echo the Build So You Can Trust the Deploy

```go
mux.HandleFunc("/version", func(w http.ResponseWriter, r *http.Request) {
	json.NewEncoder(w).Encode(buildInfo) // version, gitSHA, buildTime
})
```

The first question in many incidents is "what's actually running?" A `/version` endpoint answers it in seconds instead of guessing from CI logs.

---

## Clean Code

- Use the conventional paths: `/healthz`, `/readyz`, `/metrics`, `/version`. Operators and tooling expect them; don't invent `/are-you-ok`.
- **Default readiness to false.** A service that's "ready" before it finished booting is worse than one that's slow to come up.
- Keep liveness free of I/O. No DB, no downstream calls, no disk.
- Don't log on every health probe — they fire every few seconds and will drown your logs. (See [`../logging/junior.md`](../logging/junior.md).)
- Put diagnostic handlers in one obvious place (`diagnostics.go`, `health.py`) so the next person finds them instantly.
- Never expose secrets via `/version` or `/metrics` — no DB passwords, no API keys, no full config dumps. (Big topic in `senior.md`.)

---

## Best Practices

1. **Two endpoints, two questions.** Liveness ("restart me") and readiness ("skip me") are distinct. Implement both.
2. **Liveness must not depend on anything but the process itself.** No databases, no caches, no other services.
3. **Readiness may check *required* dependencies — sparingly.** Only the ones without which you genuinely cannot serve a single request, and even then, prefer "is the pool open?" over "run a query."
4. **Make checks cheap.** They run forever, on every instance.
5. **Use a real metrics library**, not hand-rolled string concatenation — `prometheus_client`, `prom-client`, Micrometer, `client_golang`. They get the format and escaping right.
6. **Expose `/version`.** One `curl` should tell you the exact running build.
7. **Don't put diagnostics on the public internet.** Even before you learn the full security story, default to a separate port or localhost binding.
8. **Test your health logic.** A health check that always returns `200` even when the process is broken is worse than none — it lies confidently.

---

## Edge Cases & Pitfalls

- **The "always 200" liveness that lies.** If your handler returns `200` no matter what, a wedged process is never restarted. (But don't overcorrect — see the DB-in-liveness trap below.)
- **The database in the liveness check.** The classic catastrophe: a brief DB outage makes liveness fail on every pod, the orchestrator restarts them all simultaneously, and now you have *zero* capacity plus a thundering herd of reconnects. DB belongs (cautiously) in readiness, never liveness.
- **Readiness that never flips back.** If you set `ready = true` and never set it `false` during shutdown, the LB keeps sending requests to a draining pod. (Graceful shutdown is a `middle.md` topic.)
- **Forgetting the startup window.** A 40-second boot plus a liveness probe that starts at second 5 means the orchestrator kills the pod before it ever comes up — an infinite crash loop. Use a startup probe or a generous initial delay.
- **Logging every probe.** Thousands of `GET /healthz 200` lines per hour bury the logs that matter.
- **`/metrics` doing work on scrape.** Computing expensive values *inside* the metrics handler means every scrape (every 15s) runs that work. Update metrics as events happen; just *report* on scrape.
- **Health endpoint on the public port.** Now anyone on the internet can probe your internals and infer your deploy times and traffic.

---

## Common Mistakes

1. **Treating liveness and readiness as the same thing.** They trigger opposite actions (restart vs skip). Conflating them turns recoverable issues into outages.
2. **Putting downstream dependencies in liveness.** A dependency blip should never restart your process.
3. **Returning `200` for everything in readiness**, so traffic arrives before the service can serve it — users get errors during every deploy.
4. **Hand-writing the Prometheus format.** Miss one newline or escape and the whole scrape fails. Use the library.
5. **Exposing diagnostics publicly.** `/metrics` and `/version` on the open internet hand attackers a reconnaissance map.
6. **No `/version` endpoint**, so "is the fix live?" becomes a 20-minute archaeology dig through CI.
7. **Health checks that block.** A slow check (full DB query) can time out and be read as a *failure*, restarting a perfectly fine pod.
8. **Logging or allocating heavily inside the probe handler.** Multiply by "every few seconds, forever" and it adds up.

---

## Tricky Points

1. **`/healthz` returning `200` does not mean "the service works."** It means "the process answers HTTP." A liveness pass is a *low* bar by design — that's the point. Don't read more into a green liveness than it claims.
2. **Readiness failing is *normal*, not an error.** During startup and shutdown, returning `503` from readiness is the *correct* behavior. Don't alert on it the way you'd alert on a `500`.
3. **A counter that resets to 0 looks like a problem but is usually a restart.** Prometheus counters reset when the process restarts; monitoring systems handle this, but seeing `http_requests_total` drop to 0 means "this instance just restarted," not "we lost data."
4. **The status code matters more than the body.** A probe reading your endpoint cares about `200` vs `503`. A pretty JSON body with `"status": "ok"` and an HTTP `500` will be read as **unhealthy** — the machine never reads your JSON.
5. **`/debug/vars` (expvar) is registered just by *importing* the package** in Go (a blank import). It's easy to expose it accidentally on your public port. Know what your imports register.
6. **"Ready" and "live" can disagree, and that's healthy.** A draining pod is *live* (don't restart it) but *not ready* (don't send it traffic). The two endpoints existing separately is what lets you express that.

---

## Test Yourself

No answers — for your own honest assessment.

1. In your own words, what action does a *liveness* failure trigger? A *readiness* failure? Give one realistic example of each that is **not** in this page.
2. Add `/healthz`, `/readyz`, `/metrics`, and `/version` to a small service in your language of choice. Verify each with `curl -i`.
3. Make `/readyz` return `503` for the first 5 seconds after boot, then `200`. Watch it flip with a `curl` loop.
4. Explain why putting a database query in your liveness check could turn a 20-second DB hiccup into a multi-minute outage.
5. Hit `/metrics` twice, 10 seconds apart, while sending some traffic. Find a counter that went up. What's the per-second rate?
6. Take any service you work on. Find its health endpoints. Are liveness and readiness actually separate, or is one endpoint doing both? Is the DB in the liveness path?
7. (Go) Blank-import `expvar`, hit `/debug/vars`, and read the `memstats` block. What's the live heap size?

---

## Tricky Questions

**Q1: Your `/healthz` returns `200` but users are getting errors. How is that possible?**

Liveness only proves the process answers HTTP. It says nothing about whether the *business logic* works — a bad config, a broken downstream, or a bug can leave the process "alive" but serving errors. Liveness is intentionally a low bar. Use readiness, metrics (error rate), and traces to catch functional failures; don't expect liveness to.

**Q2: Why not just put the database check in liveness so a broken DB connection restarts the pod?**

Because restarting won't fix a DB outage — the DB is the problem, not your process. Worse, the DB blip would fail liveness on *every* pod simultaneously, so the orchestrator restarts your *entire fleet* at once, and they all slam the recovering DB with reconnects. You've converted a transient dependency issue into a self-inflicted total outage. Dependency health belongs in readiness (cautiously), never liveness.

**Q3: A teammate's readiness check always returns `200`, even during startup. What breaks?**

Traffic gets routed to the instance before it's finished booting (caches cold, pools empty, config unloaded), so the first wave of users hit errors or timeouts on every single deploy. Readiness must return `503` until warm-up completes, and should default to *not ready*.

**Q4: Should `/metrics` be reachable from the public internet?**

No. It exposes your request volumes, error rates, latencies, and often internal endpoint names — a reconnaissance gift to an attacker and a privacy leak about your traffic. Bind it to a separate admin port, localhost, or behind auth. This is covered in depth in `senior.md` and `professional.md`.

**Q5: What's the difference between `/metrics` and a log line?**

`/metrics` exposes *aggregated current state* (totals, gauges) read on a schedule by a monitoring system; it never grows unbounded and isn't per-event. A log line is one *discrete event* written when something happens. You'd increment a counter *and* maybe log — they serve different questions. See [`../logging/junior.md`](../logging/junior.md) and [`../metrics/junior.md`](../metrics/junior.md).

**Q6: Why the `z` in `/healthz` and `/readyz`?**

It's a Google-originated convention to avoid colliding with a real application route called `/health` and to signal "this is an internal/ops endpoint." It's just a naming habit — `/health` and `/ready` are equally fine; the behavior is what matters.

---

## Cheat Sheet

```text
┌─────────────────────────── DIAGNOSTIC ENDPOINTS — JUNIOR CHEAT SHEET ───────────────────────────┐
│                                                                                                 │
│  THE FOUR YOU START WITH                                                                        │
│    /healthz   liveness   → 200 = "alive"      fail ⇒ RESTART me                                 │
│    /readyz    readiness  → 200 = "send traffic"  fail ⇒ SKIP me (don't restart)                 │
│    /metrics   Prometheus → block of numbers   read every ~15s by the scraper                    │
│    /version   build info → git SHA + build time   "did the deploy land?"                        │
│                                                                                                 │
│  LIVENESS vs READINESS (memorize the ACTION, not the words)                                     │
│    "Restarting fixes this"  → LIVENESS                                                          │
│    "Just stop routing to me" → READINESS                                                        │
│    DB / downstream in LIVENESS  →  blip restarts the WHOLE fleet. NEVER.                        │
│                                                                                                 │
│  GOLDEN RULES                                                                                   │
│    • Status code IS the answer (200 / 503). The body is for humans.                            │
│    • Liveness must be cheap and dependency-free.                                                │
│    • Readiness defaults to FALSE; flips true after warm-up.                                     │
│    • Update metrics on events; only REPORT on scrape.                                           │
│    • Diagnostics are NOT public. Separate port / localhost / auth.                              │
│                                                                                                 │
│  CURL IT                                                                                        │
│    curl -i localhost:8080/healthz      # -i shows the status code                              │
│    curl    localhost:9090/metrics      # admin port in real deploys                            │
│                                                                                                 │
│  PER-ECOSYSTEM                                                                                  │
│    Go     net/http + promhttp ; expvar → /debug/vars                                            │
│    Python prometheus_client + Flask/FastAPI                                                     │
│    Node   prom-client + express                                                                 │
│    Java   Spring Actuator (/actuator/health/{liveness,readiness}, /actuator/prometheus)         │
│                                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A **diagnostic endpoint** exposes the service's view of *itself* — health, metrics, version — for operators and machines, not users.
- **Liveness** answers "should I be restarted?"; **readiness** answers "should I get traffic right now?" They trigger *opposite* actions. Implement both, separately.
- **Never put a database or downstream dependency in a liveness check** — a dependency blip would restart your whole fleet and turn a hiccup into an outage.
- **The HTTP status code is the answer** (`200`/`503`). The body is for humans.
- **Liveness must be cheap and dependency-free**; readiness may *sparingly* check required dependencies and should default to *not ready*.
- **`/metrics`** exposes cumulative numbers read on a schedule by a monitoring system; use a real client library, and update counters on events rather than computing on scrape.
- **`/version`** answers "what's actually running?" in one `curl`.
- Go ships `expvar` (`/debug/vars`); Spring ships Actuator with first-class liveness/readiness groups; Python and Node use `prometheus_client` / `prom-client`.
- **Diagnostic endpoints leak internals and are not public.** Default to a separate admin port or localhost even before you learn the full security story (`senior.md`, `professional.md`).

---

## What You Can Build

- A **"health-check starter"** for your language: a single file exposing `/healthz`, `/readyz`, `/metrics`, `/version` that you can drop into any new service in two minutes.
- A **readiness simulator**: a service that's "not ready" for a configurable N seconds after boot, so you can watch a `curl` loop flip from `503` to `200` and *feel* what readiness gating does.
- A **`/version` enricher**: wire your build system (Go `-ldflags`, Maven resource filtering, npm build step) to inject the real git SHA and build time at compile, and expose it.
- A **"two doors" demo**: one service listening on `:8080` (public) and `:9090` (admin), with business routes only on the first and diagnostics only on the second. Prove with `curl` that `/metrics` is unreachable on `:8080`.
- A **probe-logger killer**: middleware that suppresses access logs for `/healthz` and `/readyz` so your logs stay readable.

---

## Further Reading

- **Specs & conventions**
  - Kubernetes — "Configure Liveness, Readiness and Startup Probes": <https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/>
  - Prometheus exposition format: <https://prometheus.io/docs/instrumenting/exposition_formats/>
  - Google "kubernetes/community" health-check conventions (the `/healthz` `z` origin).
- **Library docs (read once, refer often)**
  - Go `expvar`: <https://pkg.go.dev/expvar> · Go `net/http/pprof`: <https://pkg.go.dev/net/http/pprof>
  - `prometheus_client` (Python): <https://github.com/prometheus/client_python>
  - `prom-client` (Node): <https://github.com/siimon/prom-client>
  - Spring Boot Actuator: <https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html>
- **Books**
  - *Site Reliability Engineering* (Google) — the health-checking and probing chapters.

---

## Related Topics

- **Next level up:** [middle.md](middle.md) — implementing health correctly, pprof/Actuator usage, expvar, log-level toggles, wiring k8s probes.
- **Senior level:** [senior.md](senior.md) — readiness/liveness semantics, cascading failures, probe storms, separate admin port, on-demand profiling in prod.
- **Professional level:** [professional.md](professional.md) — safe live profiling, dumps without OOM, fleet-wide standardization, authz, abuse/DoS of debug endpoints.
- **Interview prep:** [interview.md](interview.md) — questions you'll be asked about health checks and diagnostic endpoints.
- **Practice:** [tasks.md](tasks.md) — hands-on labs at each level.

**Sibling diagnostic topics:**

- [Metrics — Junior](../metrics/junior.md) — the *signals* `/metrics` exposes (this topic is the *endpoint*).
- [Logging — Junior](../logging/junior.md) — why you must *not* log every health probe.
- [Debugging — Junior](../debugging/junior.md) — diagnostic endpoints are debugging tools you ship with the service.

**Cross-roadmap links:**

- [DevOps](../../../DevOps/) — load balancers and Kubernetes consume your health endpoints.
- `container-orchestration` and `high-availability-patterns` skills — probe wiring and failover.

---

## Diagrams & Visual Aids

### The Two Doors

```text
                         ┌────────────────────────────────────────┐
   public internet ────► │  :8080  FRONT DOOR (customers)          │
                         │    /orders   /login   /search           │
                         │                                         │
   ops / k8s / LB  ────► │  :9090  BACK DOOR (operators) — locked  │
                         │    /healthz  /readyz  /metrics  /version│
                         └────────────────────────────────────────┘
```

### Liveness vs Readiness → Opposite Actions

```text
   probe /healthz (LIVENESS)            probe /readyz (READINESS)
            │                                    │
        200 │ 503                             200 │ 503
            ▼   ▼                                ▼   ▼
        keep    RESTART                      route   STOP routing
        running  the pod                     traffic (but keep running)
```

### Startup → Ready → Draining

```text
   boot ─────────────► warming up ─────────► serving ─────────► draining ───► exit
   live:    yes            yes                  yes               yes
   ready:   no             no                   YES               no   ◄── still live!
            └ don't route ──┘                   └ route ─┘        └ stop routing, finish in-flight
```
