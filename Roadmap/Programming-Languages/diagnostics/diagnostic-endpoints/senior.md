# Diagnostic Endpoints — Senior Level

> **Topic:** [Diagnostic Endpoints Roadmap](README.md)
> **Focus:** The control surface as an architectural decision, not a feature. Readiness/liveness semantics under cascading failure. Probe storms and the feedback loops that amplify them. The security blast radius of an introspection endpoint. The separate admin plane. On-demand profiling on a live fleet without taking it down.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Readiness vs Liveness as Semantics, Not Endpoints](#readiness-vs-liveness-as-semantics-not-endpoints)
8. [Cascading Failure Through Health Checks](#cascading-failure-through-health-checks)
9. [Probe Storms and the Control Loop](#probe-storms-and-the-control-loop)
10. [The Admin Plane — A Separate Network Surface](#the-admin-plane--a-separate-network-surface)
11. [Security: An Endpoint Is an Attack Surface](#security-an-endpoint-is-an-attack-surface)
12. [On-Demand Profiling in Production](#on-demand-profiling-in-production)
13. [Designing the Health Aggregator](#designing-the-health-aggregator)
14. [Graceful Drain, Connection Draining, and the LB Race](#graceful-drain-connection-draining-and-the-lb-race)
15. [Code Examples](#code-examples)
16. [Failure Stories](#failure-stories)
17. [Pros & Cons](#pros--cons)
18. [Use Cases](#use-cases)
19. [Coding Patterns](#coding-patterns)
20. [Clean Code](#clean-code)
21. [Best Practices](#best-practices)
22. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Tricky Points](#tricky-points)
25. [Test Yourself](#test-yourself)
26. [Tricky Questions](#tricky-questions)
27. [Cheat Sheet](#cheat-sheet)
28. [Summary](#summary)
29. [What You Can Build](#what-you-can-build)
30. [Further Reading](#further-reading)
31. [Related Topics](#related-topics)
32. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **A diagnostic endpoint is a control surface wired into a feedback loop. Design it as such, or it will design your outage for you.**

At middle level you learned *which dependency belongs in which check*, how to poll off the hot path, how to mount pprof on a private mux, and how to wire three Kubernetes probes with sane parameters. That is correct local behavior. The senior shift is that **the endpoint is no longer the thing you are designing — the system around it is**.

A health check is not a function that returns a boolean. It is one node in a distributed control loop with thousands of replicas, a load balancer that reacts to it, a fleet that shares its downstreams, and an orchestrator that will kill or eject pods based on what it reports. The same `/readyz` that protected one pod at middle level can, at fleet scale, take down the *entire service* through a mechanism the local code never hints at: a 200ms blip on one shared dependency, amplified by synchronized probing across 800 replicas, becomes a thundering herd that knocks out the dependency for good and then keeps the whole fleet out of rotation while it tries to recover.

Three questions define this level, and none of them have a local answer:

1. **What does this report *do* to the system when it's wrong?** A readiness check that lies "unready" during a recoverable blip causes more damage than no check at all, because it removes capacity at the exact moment load is concentrating.
2. **Who can reach this, and what can they do with it?** `/debug/pprof/profile`, `/actuator/heapdump`, `/actuator/env`, and a log-level toggle are, respectively, a DoS amplifier, a memory-exfiltration channel, a secrets dump, and a log-pipeline flood — *if* the boundary is wrong.
3. **Can I run this in production without becoming the incident?** A 30-second CPU profile, a multi-gigabyte heap dump, a full goroutine dump on a million-goroutine process — each has a cost that, under the wrong conditions, is larger than the bug you're chasing.

> 🎓 **Why this matters for a senior:** The middle engineer ships a *correct* endpoint. The senior owns the *consequences* of that endpoint across the fleet, the security boundary it sits behind, and the blast radius when it's exercised during an incident. You will be the person who explains, in the post-mortem, why a one-line health check took down four regions — or the person who designed it so it couldn't.

---

## Prerequisites

- **Required:** All of [`middle.md`](middle.md) — the dependency-in-check matrix, no-I/O-in-handler, private mux, k8s probe parameters, runtime log toggles, on-demand dumps.
- **Required:** You can reason about a load balancer / orchestrator as a **control loop** (probe → evaluate → act → repeat) and know it can oscillate.
- **Required:** Comfort with the failure modes in [`../debugging/senior.md`](../debugging/senior.md) — goroutine leaks, GC pauses, heap dumps, the observer effect.
- **Required:** Network-layer literacy — listeners, bind addresses, mTLS, NetworkPolicy / security groups, reverse proxies.
- **Helpful:** The `high-availability-patterns`, `circuit-breaker-pattern`, `rate-limiting-throttling`, `load-balancing`, and `monitoring-alerting` skills. They are the systemic context this page assumes.
- **Helpful:** You've run a real incident where a probe or a debug endpoint was *part of the problem*.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Control plane / admin plane** | The network surface carrying diagnostics and control (health, pprof, dumps, toggles) — separate from the data plane that serves user traffic. |
| **Data plane** | The surface serving business traffic. The one the public reaches. |
| **Probe storm** | Many probes (across replicas, or retried on failure) converging on a shared resource simultaneously, amplifying a small blip into an outage. |
| **Thundering herd** | A large number of clients (here: probes, or recovering pods) hitting a resource at once, often after a synchronized trigger. |
| **Cascading failure** | A failure that propagates: one component fails, the reaction to its failure overloads the next, and so on. Health checks are a classic propagation vector. |
| **Fail-static / fail-open readiness** | Readiness that, under uncertainty about a *shared* dependency, keeps reporting *ready* rather than ejecting the whole fleet. The opposite of fail-closed. |
| **Hysteresis** | Asymmetric thresholds: easy to leave rotation, hard to re-enter (or vice-versa), to damp oscillation in a control loop. |
| **Probe debouncing** | Requiring N consecutive same-state results before acting, to avoid reacting to single-sample noise. |
| **Blast radius** | The set of things harmed when a given surface is exercised or compromised. |
| **SSRF** | Server-Side Request Forgery — tricking a server into making requests on the attacker's behalf; debug endpoints that fetch URLs are prime targets. |
| **Admin/management port** | A dedicated listener (often loopback or a separate interface) for the control plane. `management.server.port` in Spring; a second `http.Server` in Go. |
| **Sidecar-exposed diagnostics** | Diagnostics reachable only via a mesh sidecar (Envoy) or a `kubectl port-forward`, never via a public Service/Ingress. |
| **Profile-guided DoS** | Repeatedly requesting an expensive profile/dump to exhaust CPU/memory — using a diagnostic endpoint as a weapon. |
| **Brownout** | Deliberately shedding non-essential work (including expensive diagnostics) to preserve core function under stress. |
| **Coordinated omission** | A measurement artifact where the worst latencies are *under-sampled* because the measuring loop itself stalls — relevant when health probes time out. |

---

## Core Concepts

### 1. A health check is a control signal, and control signals have gain

Readiness output feeds a controller (the LB / kubelet) that *acts* on it by adding or removing capacity. Any controller with feedback has **gain** — how strongly output reacts to input. A readiness check that flips to `503` on a single slow downstream sample has enormous gain: one sample removes a whole pod's capacity. Multiply by a synchronized fleet and you have a self-amplifying loop. The senior designs the signal to have *low gain near the operating point*: debounce, cache, hysteresis, and — critically — **the ability to abstain** when the thing being checked is shared and the honest answer would harm the fleet.

### 2. The most dangerous readiness check is a correct one at fleet scale

A readiness check that *accurately* reports "my required DB is slow right now" is locally honest and globally catastrophic if every replica shares that DB. All replicas report unready simultaneously, the LB has nowhere to route, and you've converted a degraded-but-serving state into a total outage. The lesson is not "lie." It is: **distinguish a fault that is yours (eject me) from a fault that is shared (don't take the fleet out over it).** For shared dependencies, readiness should often **fail static** — keep serving, let requests degrade or error individually, and let circuit breakers and timeouts handle the dependency — rather than ejecting everyone at once.

### 3. The admin plane is an architectural boundary, not a port number

At middle level "admin port" meant `127.0.0.1:9090` so pprof didn't leak. At senior level it's a *plane*: a distinct listener, on a distinct interface, with distinct authn/authz, distinct NetworkPolicy, distinct rate limits, never fronted by the public Ingress, and ideally only reachable via a controlled path (loopback + `kubectl port-forward`, a mesh sidecar, or a bastion). The boundary is the design; the port is an implementation detail.

### 4. Every diagnostic endpoint is dual-use

The exact capabilities that make pprof, heapdump, env, and log toggles valuable to *you* make them valuable to an *attacker*: profiling = CPU DoS + stack/memory disclosure; heap dump = full memory exfiltration (secrets, PII, session tokens) + OOM trigger; env = config and credential disclosure; log toggle = pipeline flood / cost attack; any fetch-a-URL diagnostic = SSRF pivot. You inventory these the way you inventory privileged operations, because that is what they are.

### 5. On-demand in production means "bounded, authorized, and abortable"

You *will* profile in production — that's the whole point of always-on, on-demand endpoints. But on a hot fleet, "pull a 30s CPU profile" must be: bounded (the profile can't run forever or capture the whole heap unbounded), authorized (not anyone with network access), rate-limited (one profile at a time, not 50 concurrent), and ideally abortable / shed under load (brownout when the box is already on fire). The senior pre-decides these limits so the 3 a.m. operator doesn't have to.

### 6. Probes interact with deploys, autoscaling, and PodDisruptionBudgets

A readiness check doesn't live alone. It gates rolling deploys (new pods join only when ready), feeds the HPA's notion of available replicas, and interacts with `PodDisruptionBudget` and `terminationGracePeriodSeconds`. A subtly wrong readiness check can stall a deploy, mislead the autoscaler into over- or under-provisioning, or break a drain. The endpoint is wired into the whole orchestration substrate.

---

## Real-World Analogies

| Concept | Analogy |
|---|---|
| Readiness as high-gain control signal | A thermostat wired to the whole building's breaker: one bad reading and the lights go out citywide. You want a thermostat with a deadband, not a hair trigger. |
| Fail-static on a shared dependency | A bridge with a slightly slow toll booth: you don't close *every* lane and strand all traffic — you let cars through slower while you fix the booth. |
| Probe storm / thundering herd | Everyone in a stadium flushing toilets at halftime — the plumbing was fine until perfectly synchronized demand hit it. |
| Admin plane | The hospital's service corridor: staff-only doors, separate keys, never routed through the public lobby. |
| Heap dump exfiltration | Handing a stranger a photograph of every document on every desk in the building. |
| Profile-guided DoS | Pulling the fire alarm repeatedly to keep the building evacuated — the alarm is a real safety tool, weaponized by repetition. |
| Hysteresis / debounce | A door that needs three firm knocks, not one, before it opens — so a passing breeze doesn't let everyone in. |
| Brownout shedding | A theatre dimming the lobby chandeliers during a power dip so the stage lights stay on. |

---

## Mental Models

### Model 1: "Readiness Is a Vote About the Fleet, Not a Confession About Yourself"

Middle-level readiness answers *"can I serve?"* Senior readiness answers *"should the LB route to me, given what taking me out does to everyone else?"* When the cause of your unreadiness is **shared** (a common DB, a common cache, a common downstream), your `503` is a vote to remove capacity that every other replica is casting simultaneously — a unanimous vote to delete the service. Reframe readiness as participation in a quorum: you only cast "remove me" when the fault is *yours alone* (this pod's connection pool is wedged, this pod failed to warm). For shared faults, you abstain and keep serving degraded.

### Model 2: "Gain, Lag, and Oscillation"

Borrow from control theory. Your probe loop has **gain** (how much capacity one signal moves), **lag** (probe period + failureThreshold + LB reaction time), and a tendency to **oscillate** when gain is high and lag is non-trivial. High gain + lag = a loop that overshoots: pods flap in and out of rotation, traffic sloshes between them, latency rings. The fixes are the standard control-loop dampers: lower gain (debounce, cache), add hysteresis (asymmetric in/out thresholds), and reduce coupling (don't let every replica react to the same shared input at the same instant — jitter your probes, decorrelate).

### Model 3: "The Two-Plane Process"

Think of every production process as having two network personas. The **data-plane persona** is paranoid, public, authenticated as your users expect, rate-limited for the internet. The **admin-plane persona** is privileged, private, authenticated as *operators*, and can do dangerous things (dump memory, change levels, profile). They share a process but must never share a listener, an auth model, or a network reachability story. When you add any new introspection capability, the only question is *which persona owns it* — and the answer is almost always the admin plane.

### Model 4: "Diagnostics Have a Budget"

You have a finite production-perturbation budget. A CPU profile spends ~1–3% CPU for 30s. A heap dump spends a stop-the-world pause and a multi-GB write. A full goroutine dump spends an STW proportional to goroutine count. The senior treats this like a cost center: knows the price of each tool, never spends the whole budget at once (one profile at a time), and brownouts the expensive tools when the box is already under stress. "Free until you call it" is true; "free *when* you call it" is not.

---

## Readiness vs Liveness as Semantics, Not Endpoints

The distinction you learned as a rule of thumb is, at this level, a **semantic contract with the orchestrator** whose violation has specific, predictable failure modes.

| | **Liveness** | **Readiness** | **Startup** |
|---|---|---|---|
| **Question** | "Am I in a state only a kill can fix?" | "Should traffic be routed to me right now?" | "Have I finished booting?" |
| **k8s action on fail** | **Restart the container** | **Remove from Service endpoints** (no restart) | **Suspend liveness/readiness** until first success |
| **Cost of a false positive** | Unnecessary restart → lost in-flight work, cold caches, JIT de-warm, crash-loop risk | Capacity removed → load concentrates → cascade risk | Boot declared failed → crash-loop |
| **Cost of a false negative** | Wedged pod keeps serving errors | Broken pod keeps getting traffic | Traffic routed to a cold pod |
| **What may it depend on** | **Only the process itself** (and at most a self-watchdog) | The process + *strictly-required* deps (cached, with fail-static for shared deps) | Boot progress only |
| **Failure amplification** | Restart of one pod is local; mass restart is catastrophic | **Mass ejection is catastrophic** — this is the cascade vector | A bad startup probe blocks the whole rollout |

The senior insight buried in this table: **liveness and readiness fail in opposite directions, and confusing them is how you turn a blip into an outage.**

- Put a dependency in **liveness** and a dependency blip becomes a **fleet-wide restart storm** — far worse than ejection, because restarts lose state and stagger recovery (cold caches, reconnect storms, JIT re-warm). *Liveness must depend on nothing external. Period.*
- Make **readiness** too eager on a **shared** dependency and a blip becomes a **fleet-wide ejection** — a total outage while the dependency was merely slow.

The defensible default: liveness is a constant `200` plus, at most, a **self-watchdog** that detects *your own* wedge:

```go
// Liveness with a watchdog: fails ONLY if the event loop / scheduler is wedged.
// Never touches a dependency.
type Watchdog struct{ lastTick atomic.Int64 }

func (wd *Watchdog) tick() {                 // called from the main work loop
	wd.lastTick.Store(time.Now().UnixNano())
}

func (wd *Watchdog) liveness(w http.ResponseWriter, r *http.Request) {
	last := time.Unix(0, wd.lastTick.Load())
	if time.Since(last) > 30*time.Second {   // loop hasn't ticked in 30s → wedged
		http.Error(w, "event loop stalled", http.StatusInternalServerError)
		return
	}
	w.Write([]byte("ok"))
}
```

This is the *one* legitimate enrichment of liveness: it detects a deadlocked runtime, a blocked event loop, a goroutine-starved scheduler — conditions a kill genuinely fixes — without ever reporting on a dependency.

---

## Cascading Failure Through Health Checks

This is the single most important systemic failure mode of diagnostic endpoints, and the reason senior engineers are conservative with deep checks.

### The mechanism, step by step

```text
   t0   Shared DB has a 300ms latency blip (a slow query, a brief failover, a GC pause on the DB).
   t1   Every replica's readiness check (which pings the DB) times out.
   t2   All N replicas report 503 → k8s removes ALL of them from the Service.
   t3   The Service now has ZERO ready endpoints. 100% of traffic 503s at the LB.
   t4   The DB blip resolves in 300ms — but...
   t5   ...all N replicas, probing in sync, slam the now-recovering DB simultaneously
        (thundering herd) → DB struggles again → readiness fails again.
   t6   Oscillation: the fleet flaps in and out of rotation, never stabilizing.
        A 300ms blip is now a multi-minute total outage.
```

The cruelty is that **each local check did exactly what it was told**. The bug is systemic: a high-gain, synchronized, deeply-coupled control loop turned a recoverable degradation into a self-sustaining outage.

### Why "deep readiness" is the trap

A deep readiness check (pings DB, cache, every downstream) *feels* responsible — "I won't claim ready unless I really can serve." But it couples your availability to your dependencies' availability **and synchronizes that coupling across the fleet**. The more thorough the check, the larger the cascade surface.

### The senior remedies

| Remedy | What it does | When |
|---|---|---|
| **Fail-static on shared deps** | Keep reporting `ready` even when a *shared* dependency is degraded; let individual requests fail/degrade and let circuit breakers absorb it. | Any dependency every replica shares (the common DB, central cache). |
| **Separate "own fault" from "shared fault"** | Readiness fails only on faults unique to this pod (wedged local pool, failed warm-up); shared faults don't eject. | Always — this is the core discipline. |
| **Cache + debounce the dep state** | Readiness reads a cached result updated by a background poller; require N consecutive failures before flipping. | The middle-level pattern, now load-bearing for cascade prevention. |
| **Decorrelate probes (jitter)** | Add random jitter so replicas don't probe the shared dep in lockstep, smoothing the herd. | High-replica fleets sharing a dependency. |
| **Minimum-ready floor** | Orchestration-level: never let *all* replicas leave rotation simultaneously (e.g., maxUnavailable, or app-level "if I'd be the last ready pod, stay ready"). | Belt-and-suspenders against full ejection. |
| **Circuit breakers do the shedding** | Move "should I call this dependency right now?" out of readiness and into per-call circuit breakers, which fail fast *per request* without ejecting the pod. | The right home for downstream-failure handling. See the `circuit-breaker-pattern` skill. |

The mental rule: **readiness gates capacity; circuit breakers gate dependency calls.** Don't make readiness do the circuit breaker's job — it has the wrong granularity (whole-pod) and the wrong coupling (fleet-synchronized).

```go
// Readiness that distinguishes "my fault" (eject me) from "shared fault" (stay).
func (rd *Readiness) handler(w http.ResponseWriter, r *http.Request) {
	if !rd.started.Load() {                       // still warming → not ready (my state)
		http.Error(w, "starting", http.StatusServiceUnavailable)
		return
	}
	if rd.localPoolWedged.Load() {                // THIS pod's pool is dead → eject me
		http.Error(w, "local pool wedged", http.StatusServiceUnavailable)
		return
	}
	// NOTE: we deliberately do NOT 503 just because the shared DB is slow.
	// A shared-DB blip would eject the whole fleet. We stay ready and let
	// circuit breakers + timeouts degrade individual requests.
	w.Write([]byte("ready"))
}
```

---

## Probe Storms and the Control Loop

Even without a shared-dependency cascade, the probe loop itself can become the problem.

### Sources of probe storms

- **Retry-on-failure amplification.** Some LBs/meshes retry a failed health probe immediately; a slow endpoint turns one probe into many, multiplying load on the very endpoint that's struggling.
- **Synchronized probing.** All replicas booted from the same Deployment probe on the same period with the same phase → perfectly correlated probe traffic on shared resources.
- **Probe-induced load.** A readiness check that does *real work* (queries, computes) means probe frequency × replica count is a constant background load. At 5s period × 800 replicas that's 160 probes/sec doing work, forever — and it *spikes* exactly when failures trigger retries.
- **Coordinated omission at the probe.** When the box is overloaded, probes themselves queue and time out, so the orchestrator sees failure *because* of load, ejects the pod, concentrates load further. The probe's measurement is corrupted by the condition it's measuring.

### Damping the loop

```yaml
# Readiness tuned to NOT amplify: cheap endpoint, debounced, decorrelated upstream.
readinessProbe:
  httpGet: { path: /readyz, port: 9090 }   # cheap: reads cached atomics, no I/O
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3      # debounce: 3 consecutive misses (~15s) before ejection
  successThreshold: 1
```

```go
// Probe handler must be O(1) and never block. If it can ever do I/O, it can
// ever queue under load, and then it lies under exactly the conditions you
// most need the truth.
func (rd *Readiness) handler(w http.ResponseWriter, r *http.Request) {
	// pure atomic reads — cannot queue, cannot time out under load
	w.WriteHeader(rd.cachedStatus.Load()) // 200 or 503, precomputed
}
```

Key senior practices:

1. **The probe path is the cheapest path in the process.** It must not contend for the same resources that saturate under load (no shared mutex with hot handlers, no shared connection pool, no allocation storms). Otherwise the probe fails *because* you're busy — the textbook self-eviction.
2. **Debounce with `failureThreshold ≥ 3`.** Never act on a single sample.
3. **Decorrelate.** Jitter background pollers and, where the platform allows, probe phases, so the fleet doesn't hit shared resources in lockstep.
4. **Know your LB's retry behavior.** Envoy, HAProxy, ALB, and kube-proxy differ. A health-check retry policy can quietly multiply load.
5. **Beware coordinated omission.** If your probe shares the request-processing path, overload makes the probe time out and you evict healthy-but-busy pods. Give the probe its own listener/goroutine budget (the admin plane helps here).

---

## The Admin Plane — A Separate Network Surface

The single highest-leverage architectural decision in this topic: **run diagnostics on a separate listener with its own reachability and auth.**

### Why a separate listener, concretely

| Reason | Without it | With it |
|---|---|---|
| **Reachability** | One firewall mistake exposes pprof/env to the internet | Public Ingress physically cannot reach the admin listener |
| **Auth** | Diagnostics share user auth (wrong principal: users, not operators) | Operator auth (mTLS, SSO, bastion) independent of user auth |
| **Saturation isolation** | Probes/diagnostics queue behind saturated business handlers (coordinated omission) | Admin listener has its own accept loop and budget |
| **Rate limiting** | One rate-limit config for both planes | Admin plane throttles profiles/dumps independently |
| **Blast radius** | A bug in a business handler can corrupt the diagnostic surface | Planes are isolated within the process |

### Go — two genuinely separate servers

```go
func main() {
	// DATA PLANE — public, business traffic only, its own mux. NEVER DefaultServeMux.
	appMux := http.NewServeMux()
	appMux.HandleFunc("/api/orders", ordersHandler)
	appServer := &http.Server{
		Addr:    ":8080",
		Handler: appMux,
		// data-plane timeouts tuned for the internet
		ReadHeaderTimeout: 5 * time.Second,
	}

	// ADMIN PLANE — separate listener, loopback (or a private interface only).
	adminMux := http.NewServeMux()
	adminMux.HandleFunc("/healthz", liveness)
	adminMux.HandleFunc("/readyz", readiness.handler)
	adminMux.HandleFunc("/version", versionHandler)
	adminMux.Handle("/metrics", promhttp.Handler())
	adminMux.Handle("/debug/vars", expvar.Handler())
	// pprof mounted EXPLICITLY here, never via blank-import on DefaultServeMux:
	adminMux.HandleFunc("/debug/pprof/", pprof.Index)
	adminMux.HandleFunc("/debug/pprof/profile", pprof.Profile)
	adminMux.HandleFunc("/debug/pprof/heap", pprof.Handler("heap").ServeHTTP)
	adminMux.HandleFunc("/debug/pprof/goroutine", pprof.Handler("goroutine").ServeHTTP)
	adminMux.HandleFunc("/admin/loglevel", withAuth(setLogLevel))

	adminServer := &http.Server{
		Addr:    "127.0.0.1:9090", // loopback: reach via `kubectl port-forward` only
		Handler: adminMux,
	}

	go func() { log.Fatal(adminServer.ListenAndServe()) }()
	log.Fatal(appServer.ListenAndServe())
}
```

The load-bearing details: a **non-default mux on the data plane** (so a stray blank import can't leak pprof to `:8080`), a **separate `http.Server`** on loopback for admin, and `kubectl port-forward 9090` as the only operator path. In Kubernetes the admin `containerPort` is simply *not* exposed by any public `Service` or `Ingress`, and a `NetworkPolicy` denies ingress to it from anywhere but the bastion / mesh.

### Spring Boot — a dedicated management port

```properties
# Management on a SEPARATE port, bound to loopback, with its own context.
management.server.port=9090
management.server.address=127.0.0.1
management.endpoints.web.base-path=/manage

# Expose ONLY what you need — never `*`.
management.endpoints.web.exposure.include=health,info,prometheus,loggers,threaddump

# heapdump and env are NOT exposed here on purpose (see Security).
# Health detail only for authorized callers:
management.endpoint.health.show-details=when-authorized
management.endpoint.health.show-components=when-authorized

# Real k8s probe groups:
management.endpoint.health.probes.enabled=true
```

Securing the management port with Spring Security so only operators (not application users) can reach it:

```java
@Configuration
public class ManagementSecurity {
	@Bean
	@Order(1) // applies to the management port before the app's filter chain
	SecurityFilterChain mgmt(HttpSecurity http) throws Exception {
		http.securityMatcher(EndpointRequest.toAnyEndpoint())
			.authorizeHttpRequests(a -> a
				.requestMatchers(EndpointRequest.to("health", "info")).permitAll()
				.anyRequest().hasRole("OPERATOR"))   // loggers/threaddump/etc.
			.httpBasic(Customizer.withDefaults())
			.csrf(c -> c.disable());                 // non-browser, token-auth surface
		return http.build();
	}
}
```

### Node, Python, Rust — same shape, different syntax

```js
// Node: two Express apps on two listeners. Admin bound to loopback.
const appServer   = app.listen(8080);              // public
const adminApp    = express();
adminApp.get("/healthz", (_, res) => res.send("ok"));
adminApp.get("/readyz",  (_, res) => res.status(ready ? 200 : 503).end());
adminApp.post("/admin/loglevel", requireOperator, setLevel);
const adminServer = adminApp.listen(9090, "127.0.0.1");   // loopback only
// V8 inspector: NEVER `--inspect=0.0.0.0`. Use `--inspect=127.0.0.1:9229`
// and reach it via SSH/port-forward. An open inspector = remote code execution.
```

```python
# Python: prometheus_client on its own port; app on another.
from prometheus_client import start_http_server
start_http_server(9090, addr="127.0.0.1")  # /metrics on loopback admin plane
# app (FastAPI/uvicorn) serves :8080 separately. py-spy attaches out-of-process,
# so there's no in-process profiling endpoint to expose at all — strictly better.
```

```rust
// Rust (axum): two routers, two listeners. Admin on loopback with a tower
// auth layer. pprof-rs mounted only on the admin router, behind auth.
let admin = Router::new()
    .route("/healthz", get(|| async { "ok" }))
    .route("/readyz",  get(readyz))
    .route("/debug/pprof/profile", get(pprof_profile))
    .layer(RequireOperatorAuth::default());
tokio::spawn(async move {
    let l = TcpListener::bind("127.0.0.1:9090").await.unwrap();
    axum::serve(l, admin).await.unwrap();
});
```

---

## Security: An Endpoint Is an Attack Surface

Treat this section as a threat model. Each diagnostic capability is a **named, dual-use weapon** the moment the boundary is wrong.

| Endpoint | What an attacker gains | Realistic exploit |
|---|---|---|
| `/debug/pprof/profile?seconds=N` | CPU DoS (profiling consumes CPU) + stack-symbol disclosure | Hit it in a loop with large `seconds` → pin CPU; read symbols to map internals |
| `/debug/pprof/heap`, `/actuator/heapdump`, `v8.writeHeapSnapshot()` | **Full memory exfiltration**: secrets, tokens, PII, private keys live in heap | One GET downloads everything in memory; grep the dump for `Bearer`, `password`, key material |
| `/actuator/env`, `/actuator/configprops` | Config + (poorly-masked) credentials, internal hostnames, feature flags | Read DB URLs, masked-but-leaky props, topology for lateral movement |
| `/actuator/loggers` (POST) | Log-pipeline flood / cost attack; possible info-leak via DEBUG logs | Flip everything to TRACE → blow up log bill, drown signal, leak request bodies |
| Any "fetch URL" diagnostic / `/actuator/httptrace` w/ user URLs | **SSRF** pivot, request-body capture | Make the server hit `169.254.169.254` (cloud metadata) → steal IAM creds |
| `/debug/pprof/goroutine?debug=2`, `/threaddump` | Internal structure, code paths, in-flight data in frames | Map the architecture; sometimes capture argument values |
| Spring Actuator `/jolokia`, JMX over RMI | **Remote code execution** (historically: MBean abuse, deserialization) | The infamous Actuator RCE chains; JMX/RMI deserialization gadgets |
| V8 `--inspect` open to network | **Remote code execution** | Connect the Inspector protocol → evaluate arbitrary code in-process |

### The hard rules

1. **Never `*`-expose Actuator.** `management.endpoints.web.exposure.include=*` is how production secrets leak. Allowlist explicitly. `heapdump`, `env`, `configprops`, `jolokia`, `threaddump` get exposed only on a secured management port, never publicly.
2. **Bind debug/inspector ports to loopback.** `--inspect=127.0.0.1`, pprof on `127.0.0.1:9090`. An inspector or pprof bound to `0.0.0.0` is, respectively, RCE and memory disclosure to anyone on the network.
3. **Authenticate the admin plane as operators**, separate from user auth. mTLS, SSO behind a bastion, or a mesh policy — not the same JWT your users carry.
4. **Rate-limit and singleton-gate expensive endpoints.** One concurrent profile/dump, bounded duration, bounded size. This blocks profile-guided DoS *and* protects you from your own footgun.
5. **Mask aggressively, then assume masking failed.** Treat `/env` as "leaks secrets eventually" and keep it off the reachable surface, rather than trusting the masker.
6. **No user-controlled URLs in any diagnostic.** That's the SSRF door to cloud metadata and internal services.
7. **Audit every privileged invocation.** A heap dump or a log-level change is a privileged operation; log *who* did it, *when*, and *why* — the same way you'd audit a `sudo`.
8. **Disable JMX/RMI remoting unless you truly need it**, and never over an untrusted network. Prefer Jolokia-over-HTTPS behind auth, or just Micrometer/Actuator metrics.

### Real CVE-class lessons (named)

- **Spring Boot Actuator over-exposure** — countless breaches from `exposure.include=*` shipping `/env`, `/heapdump`, `/jolokia` to the internet; `/jolokia` + a reachable MBean has yielded **RCE** in the wild.
- **Open Node `--inspect`** — debuggers left listening on `0.0.0.0` are a documented RCE vector; the Inspector protocol evaluates arbitrary JS.
- **Cloud metadata SSRF (Capital One, 2019 class of bug)** — any server-side fetch of an attacker-controlled URL pivots to `169.254.169.254` for IAM credentials. Diagnostic "fetch and show me this" features are textbook SSRF sinks.

---

## On-Demand Profiling in Production

You profile production because the bug only exists in production — real traffic, real data, real concurrency. The senior skill is doing it **without becoming the incident**, on a live, hot, possibly-already-degraded fleet. (Continuous, always-on profiling is its own topic: [`../continuous-profiling/README.md`](../continuous-profiling/README.md). Here we mean the deliberate, on-demand pull.)

### The cost of each pull, and how to bound it

| Tool | Cost on a hot process | Bound it by |
|---|---|---|
| Go CPU profile (`/profile?seconds=30`) | ~1–3% CPU for the window; observable in latency on a small service | Short window; profile **one** replica, not the fleet; singleton gate |
| Go heap profile (`/heap`) | A GC + walk; modest, but allocates | Fine on-demand; avoid tight loops of it |
| Go goroutine dump (`?debug=2`) | **STW proportional to goroutine count**; on a million-goroutine leak this is a real pause | Use `debug=1` (aggregated) first; `debug=2` only when you need stacks |
| Java heap dump (`/actuator/heapdump`, `jmap`) | **STW pause + multi-GB write**; on a memory-pressured pod it can OOM the pod | Pick a *non-serving* replica; ensure disk headroom; never on the box you're trying to save |
| Java async-profiler | ~1–2% via `AsyncGetCallTrace`, avoids safepoint bias | Prefer over JFR/jstack-loop for CPU on hot JVMs |
| `py-spy` (out-of-process) | Near-zero on target; reads `/proc/<pid>/mem` | Already production-safe; needs `CAP_SYS_PTRACE` |
| Node `--inspect` profiler / `clinic` | Inspector overhead; UI attach perturbs | Loopback + port-forward; short captures |
| `pprof-rs` (Rust) | Sampling, low; the *handler* is your responsibility to gate | Auth + rate-limit the handler |

### The senior workflow: profile one, not all

```bash
# WRONG: profiling the whole fleet at once doubles the perturbation across N pods.
#   for pod in $(kubectl get pods -o name); do go tool pprof ... ; done   # NO.

# RIGHT: pick ONE representative replica, port-forward the admin plane, profile it.
kubectl port-forward pod/orders-7c9f 9090:9090 &
go tool pprof -http=:0 'http://localhost:9090/debug/pprof/profile?seconds=20'
# 20s, one pod, loopback. Latency blip is contained to one replica behind the LB.
```

```bash
# Goroutine dump: aggregate FIRST (cheap), get stacks only if needed.
curl -s 'http://localhost:9090/debug/pprof/goroutine?debug=1' | head   # counts by stack
# only if you must see full stacks (heavier STW on huge G counts):
curl -s 'http://localhost:9090/debug/pprof/goroutine?debug=2' > gs.txt
```

### Singleton gate + brownout for expensive endpoints

```go
// One profile/dump at a time, and shed it entirely if the box is already hot.
var profiling atomic.Bool

func guardedProfile(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Brownout: if we're already under heavy load, refuse the expensive op.
		if currentCPUUtil() > 0.85 {
			http.Error(w, "shedding profile under load", http.StatusServiceUnavailable)
			return
		}
		// Singleton: never run two profiles concurrently (that doubles the cost).
		if !profiling.CompareAndSwap(false, true) {
			http.Error(w, "a profile is already running", http.StatusConflict)
			return
		}
		defer profiling.Store(false)
		// Bound the duration regardless of what the caller asked for.
		if s := r.URL.Query().Get("seconds"); s != "" {
			if n, _ := strconv.Atoi(s); n > 60 {
				http.Error(w, "max 60s", http.StatusBadRequest)
				return
			}
		}
		next(w, r)
	}
}
```

### Heap dumps without OOMing the patient

The Java heap dump deserves its own warning. `/actuator/heapdump` on a 16 GB heap writes a ~16 GB file and pauses the JVM; on a pod that's *already* under memory pressure, the dump allocation and the file write can trigger the very OOM you're investigating — you kill the patient to take its X-ray. Senior practice:

- **Dump a replica you've already drained** (set readiness false, let the LB stop routing, *then* dump). The dump's pause now harms no live traffic.
- **Confirm disk headroom** ≥ heap size + margin, on a volume that won't fill `/`.
- **Prefer `jmap -dump:live`** (collects first, dumps live set) when you only need live objects — smaller and cleaner.
- **For chronic leaks, prefer continuous heap *profiling*** (sampled allocation profiles) over a single giant dump — the dump is the last resort, not the first.

> The throughline: **on-demand profiling in production is a privileged, bounded, single-target operation.** It is not "run the debug command on the fleet." The middle engineer knows the endpoints; the senior knows the *cost* of pulling them and the discipline to pull exactly one, on exactly the right pod, with exactly the right bound.

---

## Designing the Health Aggregator

Real services have many health signals (DB, cache, queue, downstreams, disk, warm-up). A senior designs the **aggregator** that turns N signals into the handful of boolean answers the orchestrator needs — and bakes in the readiness/liveness semantics so individual indicators can't violate them.

```go
// A health indicator with declared semantics: does this signal affect liveness,
// readiness, both, or neither — and is the dependency SHARED (fail-static)?
type Indicator struct {
	Name        string
	Critical    bool // if false (degradable), failure never affects readiness
	Shared      bool // if true, a failure must NOT eject (fail-static for the fleet)
	check       func(ctx context.Context) error
	lastOK      atomic.Bool
	consecutive atomic.Int32 // for debouncing
}

type Aggregator struct {
	indicators []*Indicator
	started    atomic.Bool
}

// Background poller (one goroutine), jittered to decorrelate from other replicas.
func (a *Aggregator) poll() {
	for {
		for _, ind := range a.indicators {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			err := ind.check(ctx)
			cancel()
			if err == nil {
				ind.lastOK.Store(true)
				ind.consecutive.Store(0)
			} else if ind.consecutive.Add(1) >= 3 { // debounce: 3 in a row
				ind.lastOK.Store(false)
			}
		}
		// jitter so the fleet doesn't hammer shared deps in lockstep:
		time.Sleep(5*time.Second + time.Duration(rand.Intn(1000))*time.Millisecond)
	}
}

// Readiness: started, AND every CRITICAL, NON-SHARED indicator is OK.
// Shared-critical failures are deliberately NOT cause for ejection.
func (a *Aggregator) Ready() bool {
	if !a.started.Load() {
		return false
	}
	for _, ind := range a.indicators {
		if ind.Critical && !ind.Shared && !ind.lastOK.Load() {
			return false // my own critical dependency is down → eject me
		}
	}
	return true // shared/degradable failures: stay ready, degrade per-request
}

// Liveness ignores ALL indicators by design.
func (a *Aggregator) Live() bool { return true /* + optional self-watchdog */ }
```

The design embeds the senior rules structurally:

- **`Critical && !Shared` is the only thing that ejects.** Shared-dependency failures fail static; degradable (optional) failures never count.
- **Debounced** (3-in-a-row) so a single sample can't flip the fleet.
- **Jittered poller** so replicas don't synchronize on the shared dependency.
- **Liveness is unconditional.** No indicator can ever cause a restart.

Spring's equivalent is `HealthContributor` / `HealthIndicator` grouped into `liveness` and `readiness` groups via `management.endpoint.health.group.*`; the same discipline applies — be deliberate about which contributors land in the `readiness` group, and keep the `liveness` group empty of dependencies.

---

## Graceful Drain, Connection Draining, and the LB Race

The most common deploy-time outage isn't a crash — it's the **drain race** between readiness flipping false and the LB actually stopping traffic.

```text
   SIGTERM ──► you flip readiness=503 ──► [LB's NEXT probe cycle] ──► LB stops routing
                       │                          │
                       │  ◄── this gap is real ──►│
                       ▼                          ▼
              if you Shutdown() HERE,      requests still arriving here
              in-flight requests die       hit a closing server → 5xx
```

The race: Kubernetes sends `SIGTERM` and *simultaneously* begins removing the pod from endpoints, but endpoint propagation to every kube-proxy / LB is **eventually consistent** and takes time. If your process exits as soon as it gets `SIGTERM`, traffic that was already in flight (and traffic routed in the propagation window) hits a dead listener.

```go
func gracefulShutdown(rd *Readiness, srv *http.Server) {
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM)
	<-sig

	// 1. Flip readiness FIRST so probes start failing and the LB begins draining.
	rd.SetReady(false)

	// 2. SLEEP long enough for endpoint removal to propagate to all proxies.
	//    This must exceed (readiness period × failureThreshold) + propagation.
	//    Counterintuitive but essential: keep serving during this window.
	time.Sleep(15 * time.Second)

	// 3. NOW stop accepting new conns and let in-flight requests finish.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
```

Senior details that bite:

- **`terminationGracePeriodSeconds` must exceed step 2 + step 3.** If k8s `SIGKILL`s you at 30s but your drain needs 45s, you cut connections regardless. Size the grace period to the whole sequence.
- **`preStop` hook as a portable drain.** A `preStop: exec sleep 15` runs *before* `SIGTERM`, giving endpoint removal time to propagate even for apps you can't modify. Common belt-and-suspenders.
- **The sleep is not optional and not a hack.** "Keep serving after SIGTERM" feels wrong but is exactly correct: you're covering the eventual-consistency window of endpoint propagation.
- **Don't `503` so aggressively that the LB ejects you before in-flight requests finish.** Readiness false means "no *new* traffic," not "kill current requests."

---

## Code Examples

### Go — the complete senior admin plane (drain + guarded profile + auth)

```go
type Admin struct {
	rd      *Readiness
	logLvl  *slog.LevelVar
	auditor *Auditor
}

func (ad *Admin) server(addr string) *http.Server {
	mux := http.NewServeMux() // private mux — never DefaultServeMux
	mux.HandleFunc("/healthz", liveness)             // unconditional + watchdog
	mux.HandleFunc("/readyz", ad.rd.handler)         // own-fault only, fail-static
	mux.HandleFunc("/version", versionHandler)       // git SHA via -ldflags
	mux.Handle("/metrics", promhttp.Handler())
	mux.Handle("/debug/vars", expvar.Handler())

	// pprof: explicit mount, auth + singleton + brownout + audit on the expensive ones.
	mux.HandleFunc("/debug/pprof/", ad.auth(pprof.Index))
	mux.HandleFunc("/debug/pprof/heap", ad.auth(pprof.Handler("heap").ServeHTTP))
	mux.HandleFunc("/debug/pprof/goroutine", ad.auth(pprof.Handler("goroutine").ServeHTTP))
	mux.HandleFunc("/debug/pprof/profile",
		ad.auth(ad.audit("cpu-profile", guardedProfile(pprof.Profile))))

	mux.HandleFunc("/admin/loglevel", ad.auth(ad.audit("loglevel", ad.setLogLevel)))

	return &http.Server{Addr: addr, Handler: mux} // bind 127.0.0.1:9090
}

// Self-reverting log toggle so a forgotten DEBUG can't flood the pipeline forever.
func (ad *Admin) setLogLevel(w http.ResponseWriter, r *http.Request) {
	var body struct{ Level string }
	if json.NewDecoder(r.Body).Decode(&body) != nil {
		http.Error(w, "bad body", http.StatusBadRequest); return
	}
	lvl, err := parseLevel(body.Level)
	if err != nil { http.Error(w, "bad level", http.StatusBadRequest); return }
	ad.logLvl.Set(lvl)
	if lvl == slog.LevelDebug {
		time.AfterFunc(15*time.Minute, func() { ad.logLvl.Set(slog.LevelInfo) })
	}
	w.Write([]byte("ok"))
}

// Audit wrapper: every privileged invocation is logged with who/when/what.
func (ad *Admin) audit(op string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ad.auditor.Log(op, operatorFrom(r), r.RemoteAddr, time.Now())
		next(w, r)
	}
}
```

### Java/Spring — readiness that fails static on a shared dependency

```java
// A readiness contributor for a SHARED database: report UP even when the DB is
// slow, so a blip doesn't eject the whole fleet. Let circuit breakers degrade
// individual requests instead. Contrast with a per-pod resource (below).
@Component
class SharedDbReadiness implements HealthIndicator {
	// Intentionally returns UP regardless of shared-DB latency.
	// We monitor the DB via metrics/alerts, NOT via readiness ejection.
	@Override public Health health() { return Health.up().build(); }
}

// A readiness contributor for a PER-POD resource (this pod's connection pool):
// failure here SHOULD eject this pod, because it's local and not fleet-wide.
@Component
class LocalPoolReadiness implements HealthIndicator {
	private final HikariDataSource ds;
	LocalPoolReadiness(HikariDataSource ds) { this.ds = ds; }
	@Override public Health health() {
		HikariPoolMXBean p = ds.getHikariPoolMXBean();
		// if THIS pod can't get a connection from its own pool, eject it
		return p.getActiveConnections() < p.getMaximumPoolSize() || p.getIdleConnections() > 0
			? Health.up().build()
			: Health.down().withDetail("pool", "exhausted").build();
	}
}
```

```properties
# Only LocalPoolReadiness participates in the readiness probe group.
management.endpoint.health.group.readiness.include=readinessState,localPoolReadiness
management.endpoint.health.group.liveness.include=livenessState
```

### Node — drain + loopback inspector note

```js
let ready = true;
const adminApp = express();
adminApp.get("/readyz", (_, res) => res.status(ready ? 200 : 503).end());
const admin = adminApp.listen(9090, "127.0.0.1"); // loopback admin plane

process.on("SIGTERM", async () => {
  ready = false;                       // probes start failing → LB drains
  await sleep(15000);                  // wait out endpoint-removal propagation
  server.close(() => admin.close(() => process.exit(0)));
});
// Profiling: start the process with `--inspect=127.0.0.1:9229` ONLY, reach via
// `kubectl port-forward 9229`. `--inspect=0.0.0.0` is remote code execution.
```

---

## Failure Stories

**1. The 300ms blip that became a 9-minute outage (deep readiness cascade).**
A payments service ran a "thorough" readiness check that pinged its primary Postgres on every probe. A routine Postgres failover caused a ~300ms write stall. All 240 replicas' readiness probes timed out within the same 2-second window; k8s removed *every* endpoint; the Service went to zero ready pods; 100% of traffic 503'd at the LB. When Postgres recovered, all 240 replicas' synchronized probes slammed it at once, re-stalling it. The fleet flapped for nine minutes. **Root cause:** deep, synchronized, high-gain readiness. **Fix:** readiness now fails static on the shared DB (UP regardless of DB latency); per-call circuit breakers handle the actual degradation; pollers are jittered. The 300ms blip is now a 300ms blip.

**2. The liveness probe that crash-looped the fleet during GC.**
A JVM service set `livenessProbe.timeoutSeconds: 1`. Under peak load, G1 mixed collections produced ~1.5s pauses at p99. Every time a probe landed in a pause, it timed out; with `failureThreshold: 1`, the kubelet restarted the pod — mid-GC, mid-request, losing in-flight work and cold-starting the JIT, which raised load, which raised GC pressure, which caused more pauses. A self-reinforcing restart storm. **Fix:** `timeoutSeconds: 5` (above worst-case pause), `failureThreshold: 3`, and the liveness endpoint made unconditional. Restarts dropped to zero.

**3. The Actuator that leaked the database password.**
A team set `management.endpoints.web.exposure.include=*` "to make debugging easier," on the *application* port, behind a public Ingress. A scanner found `/actuator/env`, which exposed `spring.datasource.password` (the masking rule didn't cover a custom property). Twenty minutes of internet exposure, full DB compromise. **Fix:** dedicated `management.server.port` on loopback, explicit allowlist (no `env`, no `heapdump`), operator-only auth on the management chain, and a CI lint that fails the build on `exposure.include=*`.

**4. The heap dump that OOM-killed the pod it was diagnosing.**
An operator chasing a slow leak hit `/actuator/heapdump` on a pod that was already at 92% of its memory limit. The dump allocated buffers and wrote a 14 GB file; the allocation pushed the pod over its limit; the kernel OOM-killer reaped it mid-dump. They lost the evidence *and* the pod. **Fix:** the runbook now says "drain the pod first (readiness false), confirm disk headroom, *then* dump," and the heapdump endpoint is gated behind a singleton + brownout check.

**5. The open Node inspector that became RCE.**
A debugging session left a service started with `--inspect=0.0.0.0:9229` in a staging environment reachable from a compromised neighbor. The attacker connected the Inspector protocol and evaluated arbitrary JavaScript in the process — full RCE, lateral movement from there. **Fix:** inspector bound to `127.0.0.1` only, reached via port-forward; a startup assertion that refuses to boot if `--inspect` is bound to anything but loopback in non-dev.

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| Fail-static readiness on shared deps | Prevents fleet-wide ejection cascade | Pod stays in rotation while degraded; needs circuit breakers to compensate |
| Deep readiness (ping all deps) | Catches "can't serve" precisely | High cascade gain; synchronized fleet ejection; probe-induced load |
| Separate admin plane | Isolates blast radius, auth, saturation | Extra listener, extra config, one more thing to secure correctly |
| On-demand prod profiling | Bug only reproduces in prod; live insight | Perturbs the process; expensive ones can OOM/DoS if ungated |
| Unconditional liveness | Can't cause dependency-driven restart storms | Won't catch a process that's "up" but functionally degraded (use readiness/metrics) |
| Self-watchdog liveness | Detects genuine wedge/deadlock | One more moving part; a buggy watchdog restarts healthy pods |
| Singleton + brownout on diagnostics | Blocks profile-guided DoS and self-inflicted overload | Operator may be refused a profile during the exact incident they need it |
| Audited privileged endpoints | Forensics + accountability for dumps/toggles | Audit pipeline is another dependency; more code |

---

## Use Cases

- **A shared dependency blips and the whole fleet flaps.** Switch readiness to fail-static on shared deps; move shedding to circuit breakers; jitter pollers.
- **Restart storm during GC.** Raise liveness `timeout` above worst-case pause; `failureThreshold ≥ 3`; make liveness unconditional.
- **Need a CPU profile from prod without a second outage.** Port-forward the admin plane of *one* replica; bounded `seconds`; singleton-gated.
- **Suspect a leak; need a heap dump safely.** Drain one replica (readiness false), confirm disk, then dump; or prefer sampled allocation profiles.
- **Security review flags debug endpoints.** Move everything to a loopback management port with operator auth; allowlist Actuator; bind inspectors to loopback.
- **Deploys cause a burst of 5xx.** Add drain: readiness false → sleep past propagation → graceful shutdown; size `terminationGracePeriodSeconds` accordingly.
- **An operator left DEBUG on and the log bill spiked.** Self-reverting log toggles; audit who toggled.

---

## Coding Patterns

### Pattern: own-fault-only readiness

```go
// Eject only on faults unique to THIS pod; fail static on shared faults.
if rd.localPoolWedged.Load() { return notReady } // mine → eject
// shared DB slow? stay ready; circuit breakers degrade per-request.
return ready
```

### Pattern: singleton-gated expensive diagnostic

```go
if !profiling.CompareAndSwap(false, true) { return http.StatusConflict }
defer profiling.Store(false)
```

### Pattern: drain past propagation

```go
rd.SetReady(false)              // stop new traffic
time.Sleep(propagationWindow)   // wait out endpoint eventual-consistency
srv.Shutdown(ctx)               // finish in-flight, then exit
```

### Pattern: audited privileged op

```go
auditor.Log("heapdump", operator, remoteAddr, now)
serveHeapDump(w, r)
```

### Pattern: jittered poller (decorrelate the fleet)

```go
time.Sleep(base + time.Duration(rand.Intn(jitterMs))*time.Millisecond)
```

---

## Clean Code

- **Liveness is unconditional** (or unconditional + a self-watchdog). Any dependency in liveness is a defect.
- **Readiness ejects only on own-pod faults.** Shared-dependency degradation is handled by circuit breakers and timeouts, not by ejecting the fleet.
- **Diagnostics live on a separate listener** bound to loopback / a private interface, with operator auth — never the data-plane listener, never `DefaultServeMux`.
- **Every expensive diagnostic is bounded, singleton-gated, brownout-aware, and audited.**
- **Inspectors and pprof bind to loopback.** A startup assertion refuses non-loopback `--inspect` outside dev.
- **Actuator exposure is an explicit allowlist.** `env`, `heapdump`, `configprops`, `jolokia` never ship to a reachable surface.
- **Drain is part of the lifecycle**, not an afterthought: readiness false → wait propagation → graceful shutdown, with `terminationGracePeriodSeconds` sized to the whole sequence.
- **Pollers are jittered** so a fleet doesn't synchronize on shared dependencies.

---

## Best Practices

1. **Liveness depends on nothing.** The only enrichment allowed is a self-watchdog for genuine wedge/deadlock.
2. **Readiness distinguishes own-fault (eject) from shared-fault (fail static).** Never let a shared-dependency blip eject the whole fleet.
3. **Move dependency-failure handling into circuit breakers**, not readiness. Readiness gates capacity; breakers gate calls.
4. **Run diagnostics on a dedicated admin plane**: separate listener, loopback/private interface, operator auth, its own rate limits, no public Ingress, denied by NetworkPolicy.
5. **Allowlist Actuator endpoints explicitly; never `*`.** Keep `env`/`heapdump`/`jolokia` off any reachable surface.
6. **Bind every debugger/inspector/pprof to loopback.** Reach via port-forward or a bastion.
7. **Bound, singleton-gate, brownout, and audit expensive diagnostics.** Profile one replica, not the fleet.
8. **Drain correctly**: readiness false → wait out endpoint propagation → graceful shutdown; size `terminationGracePeriodSeconds`; add a `preStop` sleep for portability.
9. **Tune the probe loop to low gain**: `failureThreshold ≥ 3`, cheap O(1) handlers, jittered pollers, awareness of LB retry behavior.
10. **Treat heap dumps as last-resort, drain-first, disk-checked operations**; prefer sampled allocation profiling for chronic leaks.

---

## Edge Cases & Pitfalls

- **The probe shares a resource with hot handlers.** Under load the probe queues behind business work, times out, and you self-evict (coordinated omission). Give the probe its own listener and an O(1) path.
- **`exposure.include=*` plus public Ingress.** The classic secrets leak / RCE. Allowlist + management port + auth.
- **`--inspect=0.0.0.0`.** Remote code execution. Always loopback.
- **Liveness timeout < worst-case GC pause.** Healthy pods restarted mid-collection → restart storm exactly under load.
- **Drain without waiting for propagation.** `Shutdown()` immediately on `SIGTERM` → 5xx on every rolling deploy from in-flight + in-propagation traffic.
- **`terminationGracePeriodSeconds` shorter than the drain.** k8s `SIGKILL`s mid-drain; connections cut regardless of your careful sequence.
- **Synchronized pollers on a shared dependency.** A fleet probing in lockstep is a thundering herd on recovery. Jitter.
- **Heap dump on a memory-pressured pod.** OOM-kills the patient and loses the evidence. Drain + disk-check first.
- **Goroutine `?debug=2` on a million-goroutine leak.** The STW to walk all stacks is itself a pause. Use `debug=1` aggregation first.
- **SSRF via a "fetch this URL" diagnostic.** Pivots to cloud metadata for IAM creds. Never accept user-controlled URLs.
- **Masking that "covers" secrets in `/env`.** Custom properties slip through. Don't rely on masking; keep `/env` unreachable.
- **`successThreshold > 1` on liveness.** Invalid in k8s (must be 1); a copy-paste from readiness that misbehaves silently.

---

## Common Mistakes

1. **A dependency in liveness.** Turns a blip into a fleet restart storm — strictly worse than ejection.
2. **Deep, synchronized readiness on a shared dependency.** The cascade engine: one blip → total outage.
3. **`exposure.include=*` / pprof on `DefaultServeMux` / inspector on `0.0.0.0`.** Secrets, memory, and RCE leaked to the network.
4. **Profiling the whole fleet at once during an incident.** Doubles perturbation across every replica when you're already degraded.
5. **Heap dump first, drain never.** OOMs the pod and loses the evidence.
6. **Exiting on `SIGTERM` without draining past propagation.** 5xx on every deploy.
7. **`failureThreshold: 1` with a tight timeout.** Restart/eject storm on the first transient blip.
8. **No singleton/rate limit on profiles or dumps.** A profile-guided DoS, or your own operator, pins the box.
9. **Sharing user auth with the admin plane.** Operators and users are different principals; conflating them is how user tokens reach `/heapdump`.
10. **No audit on privileged endpoints.** A heap dump or log toggle with no who/when/why is an un-investigable incident.

---

## Tricky Points

- **Fail-static readiness is *not* "lying."** It's refusing to cast a fleet-wide "remove capacity" vote over a fault that is shared and recoverable. The honest-but-catastrophic alternative is what's actually wrong.
- **The drain sleep means "keep serving after SIGTERM."** Counterintuitive, but it covers the eventual-consistency window of endpoint removal. Removing it causes deploy-time 5xx.
- **Liveness and readiness fail in opposite, asymmetric directions.** A false-positive liveness restarts (loses state); a false-positive readiness ejects (loses capacity). Mass restart is worse than mass ejection, which is why liveness must be the *more* conservative of the two.
- **Profiling is observable in latency on small services and noise on big ones.** Know which you have before you pull a 30s CPU profile on a low-traffic box.
- **`/debug/pprof/goroutine?debug=2` is not free at scale.** Its STW grows with goroutine count; on the very leak you're diagnosing it can be a real pause.
- **A management port on loopback still needs auth.** A compromised sidecar or a port-forward from a stolen kubeconfig reaches loopback. Loopback reduces, but does not eliminate, the boundary.
- **Circuit breakers and readiness can fight.** If both react to the same dependency, you can get oscillation. Decide explicitly: breakers shed per-request; readiness ejects only on own-pod faults. Don't double-count.
- **Spring's `LivenessState.BROKEN` is a self-destruct button.** Publishing it restarts the pod via the probe. Publish only for genuinely unrecoverable state.

---

## Test Yourself

1. A shared Postgres has a 300ms failover stall. Walk through, step by step, how a deep readiness check turns this into a multi-minute total outage — and exactly what you'd change so it stays a 300ms blip.
2. Explain why a dependency in *liveness* is strictly worse than the same dependency in *readiness*, in terms of what each false-positive costs the fleet.
3. Design an admin plane for a Go service: bind address, mux, auth, what's mounted, how an operator reaches it, and the NetworkPolicy posture. Justify each choice.
4. You must pull a CPU profile and a heap dump from a hot, leaking production JVM fleet *without causing a second incident*. Give the exact sequence and the safeguards at each step.
5. List five diagnostic endpoints and, for each, the specific attacker capability it grants if the boundary is wrong (be precise: DoS, memory exfiltration, RCE, SSRF, log flood).
6. Write the graceful-drain sequence and explain why the "sleep after SIGTERM" is required, what it must be larger than, and how `terminationGracePeriodSeconds` relates to it.
7. Your fleet of 800 replicas shares a cache and probes it on a 5s readiness period. Describe the thundering-herd failure on recovery and three independent ways to damp it.
8. When should readiness *fail static* on a dependency, and what mechanism then handles the dependency's actual failure?

---

## Tricky Questions

**Q1: Your readiness check accurately reports "my required shared DB is slow," and during a DB blip every replica reports unready and the service goes fully down. The check was *correct* — what's the actual bug?**
The bug is systemic, not local: a *correct* signal feeding a high-gain, fleet-synchronized control loop. Because the dependency is shared, an honest "I can't serve well right now" is cast unanimously across all replicas, and the orchestrator's reaction (remove unready endpoints) deletes all capacity at once — converting a degraded-but-serving state into a total outage. The fix is to make readiness *fail static* on shared dependencies (stay ready, degrade per-request via circuit breakers) and to reserve `503` for faults unique to this pod. Readiness should gate capacity on *your own* health, not vote the fleet out over a shared blip.

**Q2: Why is putting a dependency in the liveness check more dangerous than putting it in readiness?**
Because the orchestrator's reactions differ in cost and direction. A failed readiness check *ejects* a pod (no traffic, no restart) — recoverable, reversible, local-ish. A failed liveness check *restarts* the container — losing in-flight work, cold-starting caches and the JIT, and risking a crash-loop. A dependency blip in readiness causes mass ejection (bad); the same blip in liveness causes a mass *restart storm* (worse), because restarts destroy state and stagger recovery, often making the underlying load problem worse. Liveness must therefore depend on nothing external — at most a self-watchdog for genuine wedge.

**Q3: An operator needs a CPU profile during an active incident on an 800-replica fleet. What's the right way, and what's the failure mode of the naive way?**
Right way: pick *one* representative replica, `kubectl port-forward` its loopback admin plane, pull a bounded (`seconds≤30`) profile through a singleton gate, on that one pod. The profile's ~1–3% CPU perturbation is contained behind the LB. Naive way: loop over every pod and profile the fleet — now you've added profiling overhead to all 800 replicas simultaneously *during an incident where they're already degraded*, amplifying the very latency you're investigating. Profile one, not all.

**Q4: Is binding the admin port to `127.0.0.1` sufficient security for `/actuator/heapdump`?**
No — necessary, not sufficient. Loopback removes the public network as an attack path, but a compromised sidecar in the same pod, a stolen kubeconfig that can `port-forward`, or an SSRF from the app process all reach loopback. A heap dump exfiltrates *all process memory* (secrets, tokens, PII), so it still needs operator authentication, a singleton/brownout gate (so it can't OOM the pod or be spammed), and an audit log. Loopback is the first layer; auth + bounding + audit are the rest.

**Q5: Why does your service keep serving traffic for 15 seconds *after* receiving SIGTERM, and isn't that a bug?**
It's deliberate and correct. On `SIGTERM`, k8s simultaneously begins removing the pod from Service endpoints, but that removal propagates to every kube-proxy / LB with eventual consistency — for several seconds, traffic is still being routed to this pod. If you stopped serving immediately, that in-flight and in-propagation traffic would hit a dead listener and 5xx. So you flip readiness false (to *start* the drain), keep serving during the propagation window, then gracefully shut down. The sleep must exceed the propagation/probe window, and `terminationGracePeriodSeconds` must exceed the whole sequence or k8s `SIGKILL`s you mid-drain.

**Q6: A team sets `management.endpoints.web.exposure.include=*` to "make debugging easier." Name three distinct ways this gets them breached.**
(1) `/actuator/env` discloses configuration including credentials that masking missed → database/credential compromise. (2) `/actuator/heapdump` lets anyone download all process memory → secrets, session tokens, PII exfiltrated. (3) `/actuator/jolokia` plus a reachable MBean has yielded remote code execution in the wild (MBean abuse / deserialization gadget chains). The fix is an explicit allowlist on a separate, authenticated management port — never `*`, never on the public data plane.

**Q7: When is a readiness check that *stays ready during a dependency failure* the correct design, and what then prevents you from serving garbage?**
When the dependency is *shared* across the fleet and the failure is recoverable — ejecting all replicas would cause a worse outage than degrading. Staying ready keeps capacity in rotation; the actual failure is then handled at *request* granularity by circuit breakers (fail fast, return a graceful error or degraded response per call), timeouts (don't hang), and fallbacks (serve stale cache, partial results). Readiness gates *capacity*; the breaker gates *calls*. You're not serving garbage — you're failing individual requests cleanly instead of deleting the whole service.

---

## Cheat Sheet

```text
┌──────────────────────── DIAGNOSTIC ENDPOINTS — SENIOR CHEAT SHEET ────────────────────────┐
│                                                                                            │
│  LIVENESS vs READINESS (fail in OPPOSITE directions)                                      │
│    liveness  fails → RESTART (lose state)   → depend on NOTHING (self-watchdog at most)    │
│    readiness fails → EJECT  (lose capacity) → eject on OWN-POD faults only                 │
│    shared-dep blip in liveness  = fleet RESTART storm  (worst)                             │
│    shared-dep blip in readiness = fleet EJECTION       (bad → use FAIL-STATIC)             │
│                                                                                            │
│  CASCADE PREVENTION                                                                        │
│    readiness gates CAPACITY ; circuit breakers gate CALLS — don't conflate                │
│    fail-static on SHARED deps · debounce (failureThreshold≥3) · jitter pollers            │
│                                                                                            │
│  ADMIN PLANE (separate listener!)                                                         │
│    Go: 2nd http.Server on 127.0.0.1:9090, private mux (NOT DefaultServeMux)               │
│    Spring: management.server.port + address=127.0.0.1 + allowlist (NEVER *)               │
│    Node: --inspect=127.0.0.1 ONLY (0.0.0.0 = RCE) ; Python: py-spy out-of-process          │
│                                                                                            │
│  SECURITY — each endpoint is a weapon                                                      │
│    pprof/profile → CPU DoS+symbols   heap/heapdump → MEMORY EXFIL+OOM                      │
│    env → secrets   loggers → log flood   fetch-url → SSRF   jolokia/jmx → RCE              │
│    → loopback + operator auth + rate-limit + singleton + AUDIT                             │
│                                                                                            │
│  ON-DEMAND PROFILING IN PROD                                                               │
│    profile ONE replica (port-forward), bounded seconds, singleton gate, brownout          │
│    heap dump: DRAIN first → check disk → dump ; goroutine debug=1 before debug=2           │
│                                                                                            │
│  DRAIN                                                                                     │
│    SIGTERM → readiness=false → SLEEP past endpoint propagation → graceful Shutdown         │
│    terminationGracePeriodSeconds > whole sequence ; preStop sleep for portability          │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **A diagnostic endpoint is a control surface in a feedback loop, not a function returning a boolean.** Design the loop, not the line.
- **Liveness and readiness fail in opposite, asymmetric directions.** Liveness-fail restarts (loses state); readiness-fail ejects (loses capacity). Liveness must depend on *nothing* external; a dependency in liveness turns a blip into a restart storm, which is worse than mass ejection.
- **Deep, synchronized readiness on a shared dependency is the cascade engine.** A 300ms blip becomes a total outage when every replica votes "unready" at once and the recovering dependency is then slammed by a synchronized herd. **Fail static** on shared deps; let **circuit breakers** shed per-request; **jitter** pollers; **debounce** the signal.
- **The admin plane is an architectural boundary**: a separate listener, on loopback or a private interface, with operator (not user) auth, its own rate limits, no public Ingress, denied by NetworkPolicy. The "port" is an implementation detail of the plane.
- **Every diagnostic endpoint is dual-use.** pprof = CPU DoS + disclosure; heapdump/`/env` = memory/secrets exfiltration; loggers = log flood; fetch-a-URL = SSRF; jolokia/JMX = RCE; open inspector = RCE. Allowlist, bind to loopback, authenticate, rate-limit, audit.
- **On-demand profiling in production is a privileged, bounded, single-target operation.** Profile one replica, bound the duration, singleton-gate and brownout the expensive ones, drain-then-dump for heap dumps, and prefer sampled allocation profiling over giant dumps for chronic leaks.
- **Graceful drain covers the LB race**: flip readiness false, *keep serving* through the endpoint-propagation window, then shut down gracefully — with `terminationGracePeriodSeconds` sized to the whole sequence.

---

## What You Can Build

- A **reusable admin-plane library** for your language: separate loopback listener, operator-auth middleware, allowlisted diagnostics, singleton + brownout + audit wrappers around pprof/heap/log-toggle, and a startup assertion that refuses non-loopback inspector binds outside dev.
- A **health aggregator** that encodes the semantics structurally: per-indicator `Critical`/`Shared` flags, debounced background polling with jitter, `Ready()` that ejects only on own-pod critical faults, `Live()` that ignores all indicators — with a Spring `HealthContributor` adapter.
- A **cascade-safety linter**: fails CI on `exposure.include=*`, on `net/http/pprof` blank-imported into a package serving `DefaultServeMux`, on `--inspect` without a loopback bind, and on readiness handlers that perform synchronous I/O.
- A **drain wrapper** that sequences readiness-false → propagation-wait → graceful shutdown and asserts at boot that `terminationGracePeriodSeconds` exceeds the configured drain budget.
- A **probe-tuning + cascade-risk calculator**: inputs replica count, probe period, shared-dependency latency distribution, and worst-case GC pause; outputs probe parameters, a cascade-risk score, and the recommended fail-static set.
- A **production-profiling runbook tool**: picks one representative replica, port-forwards its admin plane, pulls a bounded profile/dump through the singleton gate, and writes an audit record — turning "profile prod safely" into one command.

---

## Further Reading

- Google SRE Book — *Handling Overload* and *Addressing Cascading Failures*: <https://sre.google/sre-book/addressing-cascading-failures/>
- Kubernetes — probes, termination, and endpoint propagation: <https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination>
- Spring Boot Actuator — security & exposure: <https://docs.spring.io/spring-boot/reference/actuator/endpoints.html>
- OWASP — SSRF and API Security Top 10: <https://owasp.org/www-project-api-security/>
- Go `net/http/pprof` and "Profiling Go Programs": <https://pkg.go.dev/net/http/pprof> · <https://go.dev/blog/pprof>
- `async-profiler` (JVM, safepoint-bias-free): <https://github.com/async-profiler/async-profiler>
- Marc Brooker / AWS Builders' Library — *Implementing health checks*: <https://aws.amazon.com/builders-library/implementing-health-checks/>
- Brendan Gregg — *Systems Performance* (on-demand and continuous profiling, overhead).

---

## Related Topics

- [`middle.md`](middle.md) — dependency-in-check matrix, no-I/O probes, private mux, probe parameters, log toggles, on-demand dumps.
- [`junior.md`](junior.md) — the four starter endpoints and the liveness/readiness distinction.
- [`professional.md`](professional.md) — fleet standardization, authz models, abuse prevention, safe profiling under load at organizational scale.
- [`interview.md`](interview.md) — health-check and diagnostic-endpoint interview questions.
- [`tasks.md`](tasks.md) — hands-on labs (build a cascade, then fix it).
- [`../debugging/senior.md`](../debugging/senior.md) — production debugging without stopping the world; goroutine/heap dumps; the observer effect.
- [`../continuous-profiling/README.md`](../continuous-profiling/README.md) — turning on-demand pprof into always-on, fleet-aggregated profiling.
- [`../observability-engineering/README.md`](../observability-engineering/README.md) — where health, metrics, and traces meet.
- [`../telemetry-cost-and-sampling-strategy/README.md`](../telemetry-cost-and-sampling-strategy/README.md) — the cost dimension of always-on diagnostics.
- [`../metrics/README.md`](../metrics/README.md) and [`../logging/README.md`](../logging/README.md) — the signals behind `/metrics` and the pipeline a log-toggle floods.
- The `high-availability-patterns`, `circuit-breaker-pattern`, `rate-limiting-throttling`, `load-balancing`, and `api-security-checklist` skills.

---

## Diagrams & Visual Aids

### The cascade: deep readiness on a shared dependency

```text
   shared DB 300ms blip
          │
          ▼
   ┌──────────────┐  every replica's deep readiness pings the DB → all time out
   │ replica 1..N │ ───────────────────────────────────────────────┐
   └──────────────┘                                                 ▼
                                                          all report 503
                                                                 │
                                                                 ▼
                                                 k8s removes ALL endpoints
                                                                 │
                                                                 ▼
                                              Service = 0 ready → 100% 5xx
                                                                 │
                                  DB recovers ──► synchronized herd slams it
                                                                 │
                                                                 ▼
                                              DB re-stalls → fleet flaps (minutes)

   FIX: fail-static on shared dep (stay ready) + circuit breakers + jittered probes
        → 300ms blip stays a 300ms blip
```

### Two planes, one process

```text
   DATA PLANE  :8080 (public, user auth)         ADMIN PLANE  127.0.0.1:9090 (operator auth)
   ├── /api/orders                               ├── /healthz  (unconditional + watchdog)
   ├── /api/payments                             ├── /readyz   (own-fault only, fail-static)
   └── fronted by public Ingress                 ├── /metrics  /debug/vars  /version
                                                 ├── /debug/pprof/*  (auth+singleton+brownout)
        ▲ Ingress CANNOT reach :9090             ├── /admin/loglevel (auth+audit+self-revert)
        │ NetworkPolicy denies it                └── reached ONLY via kubectl port-forward
```

### Liveness vs readiness — opposite failure directions

```text
                       FALSE POSITIVE COST
   liveness  ──fails──► RESTART  ──► lose in-flight, cold caches, JIT de-warm, crash-loop risk
                                     (mass restart = WORST → depend on nothing)

   readiness ──fails──► EJECT    ──► lose capacity, load concentrates, cascade risk
                                     (mass ejection = BAD → fail-static on shared deps)

   rule: liveness is the MORE conservative check, because its mistake is more expensive.
```

### Graceful drain timeline

```text
   SIGTERM
     │  readiness=false (start draining)
     │        │
     │        │◄──── keep SERVING ────►│  (endpoint removal propagates to all proxies)
     │        │                        │
     │        ▼                        ▼
     │   probes fail            LB stops routing
     │                                 │
     │                                 ▼
     │                          srv.Shutdown(): finish in-flight → exit
     └──────────────────────────────────────────────────────────────────
        terminationGracePeriodSeconds MUST span this entire timeline,
        or k8s SIGKILLs mid-drain and cuts live connections.
```
