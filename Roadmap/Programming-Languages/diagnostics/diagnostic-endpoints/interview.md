# Diagnostic Endpoints — Interview Questions

> **Topic:** [Diagnostic Endpoints Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about health/liveness/readiness, Kubernetes probes, `pprof`/`expvar`, Spring Actuator and JMX, runtime log-level toggles, on-demand dumps, and the security of debug surfaces in production.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Kubernetes Probes](#kubernetes-probes)
4. [Language / Tool-Specific](#language--tool-specific)
5. [Security of Debug Surfaces](#security-of-debug-surfaces)
6. [Tricky / Trap Questions](#tricky--trap-questions)
7. [System / Design Scenarios](#system--design-scenarios)
8. [Incident Scenarios](#incident-scenarios)
9. [Live Coding / Whiteboard](#live-coding--whiteboard)
10. [Behavioral / Experience](#behavioral--experience)
11. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
12. [Cheat Sheet](#cheat-sheet)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Diagnostic-endpoint interviews probe two things at once. The first is "do you know the surface" — can you name what `/debug/pprof/profile` does versus `/heap`, do you know that Actuator has liveness/readiness health groups, can you toggle a log level at runtime, do you know `expvar` registers on `DefaultServeMux`. That's table stakes for mid-level.

The second, and the one senior and staff interviews actually care about, is "do you understand the *failure modes* of these endpoints" — that a deep readiness check cascades, that a liveness timeout below your GC pause restarts healthy pods, that a blank `net/http/pprof` import is a memory-disclosure footgun, that a heap dump can OOM the process you're trying to save. The endpoints are easy to add and easy to weaponize against yourself. The good answers are always about *which dependency goes in which check*, *what the probe parameters do under load*, and *what an attacker who reaches the admin port can do*.

Trap questions below explain *why* the obvious instinct is wrong, because in production the wrong instinct is the outage. The scenario and behavioral sections are for senior/staff roles where the interviewer wants a story with shape — symptom, wrong hypothesis, evidence, fix, lesson — not a recital of endpoint paths.

---

## Conceptual / Foundational

### Q: What's the difference between liveness and readiness?

**Liveness** answers "should you restart me?" A failing liveness check tells the orchestrator the process is wedged in a state only a kill can fix — deadlocked, event loop stuck, unrecoverable internal corruption. The action is **restart**.

**Readiness** answers "should you route traffic to me?" A failing readiness check tells the load balancer to *skip* this instance temporarily — it's still warming caches, a required dependency is briefly down, or it's draining for shutdown. The action is **deregister, don't restart**.

The cardinal rule: *liveness means "restart me," readiness means "skip me."* The most expensive mistake in this whole topic is putting dependency checks in liveness — a database blip then restarts your entire fleet instead of just routing around it.

### Q: What's a startup probe and why does it exist separately?

A startup probe gates liveness and readiness until the application has finished booting. Until it succeeds for the first time, the other two probes are *suspended*.

It exists because slow-booting apps (JVM warmup, large cache preload, schema migration on start) would otherwise be killed by the liveness probe mid-boot. Without a startup probe you either set a huge `initialDelaySeconds` on liveness (which then delays detection of a *real* wedge for the whole lifetime of the pod) or you crash-loop forever. The startup probe lets you say "give boot up to 150 seconds, but once you're up, check liveness aggressively." It decouples "is it still starting?" from "is it wedged?"

**Follow-up — what if your app sometimes boots in 10s and sometimes in 120s?** Size `failureThreshold × periodSeconds` for the *worst* case, not the median. The cost of an over-generous startup window is only a slower detection of a genuinely failed boot; the cost of an under-sized one is a crash-loop on the slow days.

### Q: What's the difference between a shallow and a deep health check?

A **shallow** check proves only that the process is responsive — it touches no dependencies, just returns `200`. A **deep** check verifies dependencies: pings the DB, calls a downstream, checks the cache.

Shallow checks can't cascade and can't lie about dependencies, but they won't catch a process that's "up" yet functionally broken. Deep checks catch "I can't actually serve" before users do, but they're dangerous: they cost something on every probe, and worst, they propagate other systems' failures into yours.

The senior framing: liveness should always be shallow. Readiness may be *cautiously* deep — but only for dependencies you literally cannot serve a single request without, checked from *cached* state with a timeout, never synchronously in the handler.

### Q: Why is "return 200 OK" not a sufficient health check?

It depends on which check. For *liveness*, a bare `200` is often exactly right — it proves the HTTP server, the runtime, and the event loop are alive, which is all liveness should assert. For *readiness*, a bare `200` is a lie: it claims "route to me, I'll serve correctly" while the instance might still be loading caches, have an empty connection pool, or have lost its required database. A readiness check that always returns `200` defeats the entire point of readiness — it lets traffic hit cold or broken instances. The discipline is: readiness should default *closed* (return `503` until proven ready), liveness should be *trivially true*.

### Q: Which dependencies belong in which check?

The decision matrix:

| Dependency | Liveness | Readiness | Why |
|---|---|---|---|
| The process itself | yes | yes | The whole point. |
| A *required* DB | no | cautiously (cached, timed-out) | A blip should skip you, not restart you. |
| An *optional* cache | no | no | Degrade gracefully; don't fail health for it. |
| A downstream you call | no | usually no | Their health is their problem; failing yours cascades. |
| In-flight startup | no | yes | Readiness *is* "have I finished booting?" |

Default for every external dependency in liveness: **no**. Default for readiness: only if you cannot serve a *single* request without it — and even then, check it cheaply from cached state.

### Q: What does "deep checks cascade" mean concretely?

Service A's readiness pings B; B's pings C. C has a 5-second blip. Now C's dependents report unready, the LB drops them, traffic concentrates on the survivors, the survivors overload, *their* readiness fails, and a single downstream hiccup becomes a fleet-wide brownout — a cascading failure. The readiness check, meant to protect users, became the amplifier.

The cure is to check *your own ability to function*, not other systems' health. If you can still serve degraded responses without C, then C being down should not fail your readiness at all.

### Q: Why mount diagnostics on a separate port?

Three reasons. **Security**: pprof, heap dumps, `env`, and thread dumps are memory-disclosure and DoS surfaces; you do not want them reachable from the public internet. **Isolation**: probe and profiling traffic shouldn't compete with or pollute your application's request metrics, access logs, or rate limits. **Saturation independence**: if you probe the *app* port and the app port saturates, your readiness fails *because you're busy*, which deregisters you and worsens the overload — a separate admin port (or at least a separate listener/goroutine pool) decouples "can the orchestrator reach me" from "is the app pool full."

The mental model: the admin port is a workshop — full of power tools, locked to the public, lit only when you're working.

### Q: What's `expvar` and how does it differ from a Prometheus `/metrics` endpoint?

`expvar` is Go's stdlib package that publishes public variables as a JSON object at `/debug/vars`, including `memstats` and `cmdline` for free. It's zero-dependency, great for a quick human `curl` and ad-hoc counters.

Prometheus client metrics (`/metrics`) are designed for a *scraping system* — typed metrics (counters, gauges, histograms), labels, and a text exposition format that Prometheus, dashboards, and alerting consume. `expvar` has no histograms, no labels, no scrape-friendly typing.

In practice many services run both: `expvar` for fast human introspection, `/metrics` for the monitoring pipeline. The gotcha worth mentioning: `expvar`'s import registers `/debug/vars` on `DefaultServeMux`, so it can leak onto your public port if you're not deliberate. And `expvar.Func` values are evaluated *on every request* — an expensive published function turns each scrape into work.

---

## Kubernetes Probes

### Q: Walk me through the probe parameters and what each one does.

- **`initialDelaySeconds`** — wait this long after container start before the *first* probe. (Largely superseded by `startupProbe`.)
- **`periodSeconds`** — how often to probe.
- **`timeoutSeconds`** — how long to wait for a response before counting the probe a failure. Default is 1s, which is dangerously short for anything that can pause.
- **`failureThreshold`** — consecutive failures before the orchestrator acts (restart for liveness, deregister for readiness).
- **`successThreshold`** — consecutive successes before considered passing. Must be `1` for liveness and startup probes (k8s rejects other values); can be higher for readiness.

Most probe-caused incidents come from *wrong parameters*, not wrong endpoints. The classic killers: a liveness `timeout` shorter than a GC pause, a missing startup probe for a slow boot, a `failureThreshold: 1` that restarts on a single transient blip.

### Q: How do you tune a liveness probe for an app with a 2-second p99 GC pause?

Two non-negotiables. First, `timeoutSeconds` must comfortably exceed the worst-case stop-the-world pause — if a 2s STW exceeds a 1s liveness timeout, the probe lands during GC, times out, and you restart a perfectly healthy pod *exactly when it's busiest*. Set it to, say, 3–5s. Second, `failureThreshold` should be at least 3, so a single unlucky probe during a pause doesn't trigger a restart; you need a *sustained* failure (~30s) to conclude the process is genuinely wedged. Restarting on one blip is how a slow probe becomes a restart storm.

**Follow-up — why not just make the probe endpoint faster?** The endpoint is already trivial (a bare `200`). The latency isn't in your handler — it's the runtime pausing *all* goroutines/threads, including the one serving the probe. You can't outrun a stop-the-world pause from inside the process; you tune the probe to tolerate it.

### Q: Why might a pod show `Running` but `0/1 READY` for ten minutes — is that a bug?

Not necessarily, and assuming it is a bug is the trap. `Running` means liveness is passing (don't restart). `0/1 READY` means readiness is returning `503` (don't route here). Liveness and readiness use *independent counters*. That state is exactly a pod that's still warming caches, draining for shutdown, or whose required dependency is temporarily down. It's the system working as designed — readiness gating traffic away from an instance that can't serve correctly. The right move is to investigate *why* readiness is false (check the readiness reason, the dependency state), not to restart it.

### Q: What's graceful drain and how do probes implement it?

On `SIGTERM`, you flip readiness to `false` *first*, wait for the load balancer's next probe cycle to notice and stop routing, *then* finish in-flight requests and exit. The sequence: readiness goes `503` → kubelet/LB sees the failure and deregisters the endpoint → no new traffic arrives → you drain in-flight work → `server.Shutdown()`.

Skip this and the LB keeps sending requests to a process that's already closing its listener, producing connection-refused errors on *every rolling deploy*. The often-missed insight is that readiness isn't only a startup gate — it's also your *drain switch*.

**Follow-up — how long should you wait before shutting down?** At least one full readiness `periodSeconds × failureThreshold`, plus a margin for the LB's own propagation delay. If readiness probes every 5s with `failureThreshold: 2`, wait ~10–15s before you stop accepting. This is also why `terminationGracePeriodSeconds` must be longer than your drain window, or k8s `SIGKILL`s you mid-drain.

### Q: Should liveness and readiness use the same endpoint?

They can share a *cheap* endpoint, but never the same *logic that includes dependencies in liveness*. The danger is a single `/health` that checks the DB and is wired to both probes: now a DB blip fails liveness and restarts the pod (wrong) instead of only failing readiness and deregistering it (right). The safe patterns are either two distinct endpoints (`/healthz` trivial for liveness, `/readyz` cached-dependency-aware for readiness) or Actuator's health *groups* which formalize exactly this split. The rule: dependency state may reach readiness, never liveness.

---

## Language / Tool-Specific

### Go

#### Q: What does the `import _ "net/http/pprof"` blank import actually do?

It runs the package's `init()`, which registers the `/debug/pprof/*` handlers (`index`, `profile`, `heap`, `goroutine`, `cmdline`, `symbol`, `trace`) onto `http.DefaultServeMux`. That's the footgun: if your *public* HTTP server is serving `DefaultServeMux`, the blank import silently publishes full profiling to the internet — a memory-disclosure surface and a cheap DoS (a CPU profile request makes the runtime do work).

The correct setup is to *not* rely on the blank import's side effect, and instead mount the handlers explicitly on a private mux on the admin port:

```go
mux := http.NewServeMux()
mux.HandleFunc("/debug/pprof/", pprof.Index)
mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
mux.Handle("/debug/pprof/heap", pprof.Handler("heap"))
go http.ListenAndServe("127.0.0.1:9090", mux)
```

#### Q: Name the pprof endpoints and what each answers.

```
/debug/pprof/profile?seconds=30  → "What's using CPU?" (sampled stacks over N sec)
/debug/pprof/heap                → "What's holding memory right now?" (inuse_space)
/debug/pprof/allocs              → "What allocates the most cumulatively?"
/debug/pprof/goroutine?debug=2   → "What is every goroutine stuck on?" (full stacks)
/debug/pprof/mutex               → "Where's lock contention?" (needs SetMutexProfileFraction)
/debug/pprof/block               → "Where do goroutines block?" (needs SetBlockProfileRate)
/debug/pprof/trace?seconds=5     → full execution trace (go tool trace)
```

The trap on `mutex` and `block`: they return *nothing* until you call `runtime.SetMutexProfileFraction(n)` / `runtime.SetBlockProfileRate(n)`. An empty profile ≠ no contention; it may just mean the profile isn't enabled.

#### Q: How do you pull and read a CPU profile from a live service?

```bash
go tool pprof -http=:0 'http://localhost:9090/debug/pprof/profile?seconds=30'
# opens a browser; Flame Graph view; widest frame = hottest path
```

Or text mode: `go tool pprof <url>`, then `top` (hottest by flat/cum), `list <func>` (annotated source), `web` (SVG call graph). For a leak: pull two heap profiles 30 minutes apart and diff with `go tool pprof -base heap_t1.pprof heap_t2.pprof` — the diff shows what grew.

Caveat to state: a 30-second CPU profile *competes with your app for CPU*. On a hot service it's observable in latency; on a small one it's noise. Know which you have before you profile prod.

#### Q: How do you take a goroutine dump and what do you look for?

`curl 'http://localhost:9090/debug/pprof/goroutine?debug=2'` (or send `SIGQUIT` to abort-and-dump). Then **group by stack signature**. The patterns:

- 10,000 goroutines parked on the same `chan receive` → the producer died or the consumer leaked; classic goroutine leak.
- Everyone in `semacquire` on the same lock address → deadlock or a slow critical section.
- One goroutine `running` on the same line for minutes → a CPU-bound loop.

The dump turns "the service is hung" into "here's the exact line every worker is blocked on."

### Java / JVM

#### Q: What does Spring Boot Actuator give you for diagnostics?

With `spring-boot-starter-actuator` on the classpath and endpoints opted in (on a separate `management.server.port`):

- `/actuator/health/liveness` and `/actuator/health/readiness` — real health *groups* mapped to k8s probes.
- `/actuator/threaddump` — JSON thread dump; replaces SSHing in for `jstack`.
- `/actuator/heapdump` — downloads an `.hprof` for Eclipse MAT. **Heavy and sensitive.**
- `/actuator/loggers/{name}` — GET the level, POST to change it at runtime.
- `/actuator/prometheus` — Micrometer metrics in Prometheus format.
- `/actuator/env`, `/actuator/configprops`, `/actuator/info`, `/actuator/metrics`.

The superpower is that liveness/readiness/threaddump/heapdump/log-toggle come standardized with almost no code. The risk is over-exposing: `/actuator/env` leaks config, `/actuator/heapdump` leaks all of memory.

#### Q: How does a Spring app signal readiness/liveness from code?

By publishing availability state events:

```java
AvailabilityChangeEvent.publish(publisher, this, ReadinessState.ACCEPTING_TRAFFIC);
AvailabilityChangeEvent.publish(publisher, this, ReadinessState.REFUSING_TRAFFIC);
AvailabilityChangeEvent.publish(publisher, this, LivenessState.BROKEN); // → k8s restarts you
```

The sharp edge: `LivenessState.BROKEN` actually causes a restart via the liveness probe. Publish it *only* for genuinely unrecoverable state, or you've built a self-destruct button that any over-eager error handler can trigger.

#### Q: What's JMX and where does it still fit?

JMX (Java Management Extensions) exposes MBeans — managed beans presenting attributes (heap usage, thread counts, GC stats) and operations (force GC, change a log level, rotate a key) — over a connector. Tools like JConsole, VisualVM, and `jmxterm` connect and read/invoke them.

It predates HTTP-first observability and is still everywhere in legacy JVM systems and for app-server internals (Tomcat, Kafka brokers expose rich JMX). The modern trend is to bridge JMX into Prometheus via the **JMX Exporter** rather than connect JMX clients directly, because the JMX RMI connector is a notorious remote-code-execution surface if exposed. If asked "JMX vs Actuator": Actuator is HTTP/JSON-native and Kubernetes-friendly; JMX is richer for deep JVM/app-server internals but operationally heavier and a bigger security liability over the network.

#### Q: `jstack`/`jcmd`/`jmap` — when do you reach for each?

- `jstack <pid>` — quick thread dump; deadlock detection; "what's stuck?"
- `jcmd <pid> <command>` — the swiss army knife: `Thread.print` (same as jstack), `GC.heap_dump`, `GC.class_histogram`, `VM.flags`, `JFR.start`. Modern answer: use `jcmd` for nearly everything.
- `jmap -dump:live,format=b,file=heap.hprof <pid>` — heap dump for MAT (or `-XX:+HeapDumpOnOutOfMemoryError` to capture automatically on OOM).

In a containerized world you often prefer the *endpoint* equivalents (`/actuator/threaddump`, `/actuator/heapdump`) because you can't always `exec` into the pod, and the JVM's PID is 1.

### Python / Node

#### Q: Python has no built-in pprof. How do you profile a live process?

`py-spy`, which attaches to a running PID with **no code changes** — it reads the target's memory externally:

```bash
sudo py-spy dump  --pid $PID            # all thread stacks (≈ goroutine dump)
sudo py-spy top   --pid $PID            # live "top" of Python functions
sudo py-spy record --pid $PID -o flame.svg --duration 30
```

This is the on-demand spirit, externalized — you don't pre-mount anything; you bring the tool to the process. For memory, `tracemalloc` snapshots (in-process) or `py-spy --memory`.

#### Q: How do you toggle a log level at runtime in Python/Node?

Python: a guarded admin handler that calls `logging.getLogger(name).setLevel(logging.DEBUG)`. Node: most loggers (`pino`, `winston`) expose `logger.level = "debug"` at runtime; wrap it in an admin route. The pattern is identical across languages — one atomic-ish level variable the logger reads, one guarded endpoint to set it, and ideally a self-revert timer so a forgotten DEBUG toggle doesn't flood the pipeline:

```js
adminApp.post("/admin/loglevel", (req, res) => {
  if (!LEVELS.includes(req.body.level)) return res.status(400).send("bad level");
  logger.level = req.body.level;
  setTimeout(() => { logger.level = "info"; }, 15 * 60 * 1000); // auto-revert
  res.send("ok");
});
```

#### Q: How do you capture diagnostics from a Node process?

`--inspect` (bound to localhost!) opens the V8 inspector for CPU profiling and heap snapshots via Chrome DevTools or the Profiler tab. For flame graphs without a UI: `clinic flame` or `0x`. For an on-demand snapshot in code: `require('v8').writeHeapSnapshot('/tmp/snap.heapsnapshot')`. `process.report` (diagnostic report) dumps a JSON of stacks, resource usage, and libuv handles, triggerable on signal. As always, never bind `--inspect` to `0.0.0.0` — anyone reaching 9229 gets arbitrary code execution in your process.

---

## Security of Debug Surfaces

### Q: What can an attacker do if they reach `/debug/pprof/` on a public port?

Two attacks. **Information disclosure**: `/debug/pprof/heap` and the goroutine dump expose live memory contents and stack data — request payloads, tokens, internal addresses, in-memory secrets. **Denial of service**: `/debug/pprof/profile?seconds=300` makes the runtime sample and serialize for five minutes; repeated requests pin CPU and inflate latency cheaply. The `cmdline` endpoint even leaks the full process arguments (which sometimes contain credentials). This is why the blank import on a public `DefaultServeMux` is treated as a vulnerability, not a convenience.

### Q: Why is `/actuator/heapdump` considered dangerous even on the admin port?

Three reasons stacked. It's **heavy** — a 16 GB heap writes a 16 GB file and can pause or OOM the JVM; on a memory-pressured pod, triggering it can *be* the thing that kills the process you were trying to diagnose. It's a **total disclosure** — the dump contains *everything* in memory: passwords, session tokens, encryption keys, customer PII; whoever can download it has exfiltrated your entire runtime state. And it's **easy to leave open** — a permissive `management.endpoints.web.exposure.include=*` exposes it alongside the harmless ones. Gate it behind authz, audit every invocation, and never trigger it reflexively.

### Q: How do you secure the admin surface?

Layered. **Network**: bind diagnostics to `127.0.0.1` or a dedicated admin port that has no public `Service`/Ingress; in k8s, a `NetworkPolicy` restricting who can reach it. **AuthN/AuthZ**: require authentication on the management port (Actuator integrates with Spring Security; for Go/Node, an auth middleware on the admin mux); restrict sensitive endpoints (`heapdump`, `env`, `threaddump`) to an operator role. **Minimization**: expose only the endpoints you actually use — never `exposure.include=*`. **Masking**: any config-exposing endpoint must mask secret-shaped keys (`*.password`, `*.token`, `*.key`). **Audit**: log who hit `heapdump`/`loggers`/`env` and when. **Self-revert**: runtime toggles (log level, debug mode) revert automatically so a flipped switch can't linger.

### Q: A runtime log-level toggle with no auth — what's the abuse?

An attacker POSTs `{"level":"TRACE"}` and your logging pipeline floods: cost spikes (ingestion is billed by volume), real signal drowns in debug noise, and TRACE logging can itself *leak* request bodies and credentials that INFO never logged. It's both a DoS on your observability budget and a disclosure escalation. The toggle must be authenticated, scoped, and self-reverting.

---

## Tricky / Trap Questions

### Q: Your readiness check pings the DB on every probe. Under load, instances flap out of rotation. Why?

**Wrong instinct:** "the DB is down." It isn't — it's *slow*.

Under load the DB latency rises; the synchronous ping in the probe handler exceeds the probe `timeoutSeconds`; the kubelet counts the timeout as a failure and deregisters the instance — *because it's busy, not because it's broken*. Traffic now concentrates on fewer instances, which get slower, whose probes also time out, and the whole fleet flaps. The fix is structural: poll the DB on a background timer with its *own* timeout, store the result in an atomic, and have the probe handler *read the atomic* and do no I/O. A slow DB can then never make your probe slow.

### Q: You put the database check in the liveness probe "to be thorough." What breaks?

**Wrong instinct:** "more checking is safer."

When the DB has a blip, liveness fails *across every pod simultaneously* (they all share the same DB). k8s restarts them all. Restarting doesn't fix a DB outage, so they boot, fail liveness again, and crash-loop — you've converted a recoverable dependency blip into a full self-inflicted fleet outage that *persists until the DB recovers and possibly longer*. Liveness must depend on nothing but the process itself. Dependency awareness belongs in readiness, where the action is "skip me," not "kill me."

### Q: Liveness `timeoutSeconds: 1`, the app does a ~2s stop-the-world GC at p99. What happens?

**Wrong instinct:** "the probe will retry, it's fine."

Roughly once per p99 GC cycle the probe lands during the pause and times out at 1s. With `failureThreshold: 1` that's an immediate restart of a healthy pod; with a higher threshold it's intermittent restarts, worst under load when GC runs most. You can't speed up the probe handler — the runtime has paused *all* threads including the prober. Fix: `timeoutSeconds` comfortably above worst-case pause (3–5s) and `failureThreshold ≥ 3`.

### Q: You removed the startup probe because "the app boots fast now." Deploys start crash-looping. Why?

**Wrong instinct:** "boot is fast, so the startup probe is redundant."

Boot is fast *most of the time*. On a cold node, under image-pull contention, during a dependency's slow moment, or after a config that warms a bigger cache, boot occasionally takes longer than the liveness probe's tolerance. Without the startup probe suspending liveness during boot, the liveness probe fires mid-boot, fails, restarts the pod, and you get `CrashLoopBackOff` that *looks* like an application crash but is purely a probe misconfig. The startup probe is cheap insurance against the tail of your boot-time distribution.

### Q: Your readiness check returns `200` immediately on startup, before caches load. What's the symptom?

**Wrong instinct:** "readiness passing means we're good."

A readiness check that passes *during* startup is a bug, not a feature — it routes user traffic to a cold instance. Symptoms: the first wave of requests after each deploy/scale-up sees cache-miss latency spikes, empty connection pools, or errors from half-initialized state. Readiness must default *closed* — return `503` until warmup genuinely completes, then flip to `200`. The whole purpose of readiness is to *withhold* traffic until you can serve correctly.

### Q: `/debug/pprof/mutex` returns an empty profile. Does that mean no lock contention?

**Wrong instinct:** "empty profile, no contention, move on."

No — it almost certainly means the mutex profiler isn't *enabled*. Go's mutex and block profiles record nothing until you call `runtime.SetMutexProfileFraction(n)` (and `runtime.SetBlockProfileRate(n)` for block). An empty profile is "not measuring," not "nothing to measure." Enable it, generate load, then re-pull. Same trap exists for block contention.

### Q: A profile request on your hot service makes p99 latency spike. Is the profiler broken?

**Wrong instinct:** "profiling shouldn't cost anything."

It's working as designed. A CPU profile request makes the runtime sample stacks for the requested duration, and on a hot service that sampling and the serialization compete for the same CPU your requests need — observable in latency. On a small service it's noise; on a saturated one it's a measurable tax. The lesson: profiling is on-demand and cheap *when idle*, but not *free when running*. On a critical service, profile a canary or use a continuous profiler that samples at a low, fixed rate.

### Q: You expose `/actuator/*` with `exposure.include=*` "just for the dev cluster." Why is that a problem even there?

**Wrong instinct:** "it's only dev, it doesn't matter."

`*` exposes `env` (config, often with un-masked secrets if masking isn't configured), `heapdump` (all of memory), `threaddump`, and `shutdown` (if enabled, a one-request kill). Dev clusters leak: they share secrets with staging, they're reachable from corp networks, and the config you set in dev is the config that gets copy-pasted to prod. Expose deliberately, the same way, in every environment — the habit is what protects prod.

### Q: Your service is hung. You hit `/healthz` and it returns `200`. Does that mean the process is fine?

**Wrong instinct:** "health is green, the process is healthy."

A trivial liveness `200` only proves the HTTP listener and the goroutine/thread serving it are alive. The *worker* pool can be entirely deadlocked while the health endpoint — served on a separate goroutine — happily returns `200`. That's actually the *correct* behavior for liveness (you don't want a dependency wedge to restart you), but it means "healthz is green" is not "the app is doing work." To diagnose a hang you need a goroutine/thread dump, not a health check. Some teams add a watchdog: a background goroutine updates a "last progress" timestamp, and liveness fails only if *that* goes stale — detecting your own wedge without depending on anything external.

---

## System / Design Scenarios

### Q: Design a fleet-wide diagnostic surface — every service exposes the same diagnostics, consistently and safely.

Goal: any on-call engineer can diagnose *any* service the same way, with no per-service archaeology, and no surface is a liability.

- **A shared admin-server module** (a library per language) that every service embeds. It binds a private listener on a fixed admin port (say `127.0.0.1:9090`) and mounts a *standard* set: `/healthz` (trivial liveness), `/readyz` (cached-dependency readiness), `/version` (build SHA via `-ldflags`/git-commit plugin), `/metrics` (Prometheus), `/debug/pprof/*` (or language equivalent), `/debug/vars`/dump endpoints, and `/admin/loglevel` (self-reverting). Same paths, same port, everywhere — that uniformity *is* the product.
- **A dependency-poller framework**: services register checks (DB, cache, queue) with a timeout and interval; the framework maintains the atomic readiness state and never lets I/O reach the probe handler.
- **Security baked in, not bolted on**: the admin listener is never on a public `Service`; a `NetworkPolicy` restricts callers to operators/observability; sensitive endpoints (`heapdump`, `env`) require an operator role and are audited; config-exposing endpoints mask secrets; nothing uses `exposure.include=*`.
- **Standardized probe wiring**: a templated probe block (startup/liveness/readiness) with the org's defaults — liveness timeout > worst GC pause, `failureThreshold ≥ 3`, drain-on-`SIGTERM` — so individual teams don't re-derive (and re-misconfigure) the parameters.
- **A linter/CI gate** that fails the build on the known footguns: `net/http/pprof` blank-imported into a package serving a public `DefaultServeMux`; Actuator `exposure.include=*`; missing startup probe on a slow-boot service; liveness timeout below the declared GC budget.
- **Continuous profiling** (Pyroscope/Datadog/Parca) layered on the same pprof format, so the on-demand surface doubles as the always-on one.

The principle: diagnostics are infrastructure, not per-service decoration. Standardize the *surface*, *security*, and *probe parameters* centrally; let services only register their specific dependency checks.

### Q: Design the health/readiness for a service that depends on a required DB, an optional cache, and three downstreams.

Map each dependency through the matrix:

- **Liveness**: trivial `200`. Nothing external. Optionally a self-wedge watchdog.
- **Readiness**: passes when (a) startup/warmup is complete AND (b) the *required* DB is reachable — checked from a *cached* atomic updated by a background poller with its own 2s timeout, never synchronously. The DB is the one dependency you cannot serve a single request without.
- **Optional cache**: in *neither* check. If it's down you degrade (serve from origin, slower); failing health for it would take you out of rotation for a non-fatal condition.
- **Three downstreams you call**: in *neither* check, normally. Their health is their problem; putting them in your readiness cascades their outage into yours. If a downstream is *strictly required* for *every* request and there's genuinely no degraded mode, you might gate readiness on a *cached, circuit-breaker-style* signal — but the default is no, and you reach for graceful degradation (timeouts, fallbacks, circuit breakers) instead.

State explicitly: readiness defaults closed, the DB check is cached and off the hot path, and downstream failures are handled by resilience patterns, not by failing your own health.

### Q: Design observability so on-call can debug a hung service in production without restarting it.

Constraint: no restart (it loses the wedged state you need), no redeploy.

1. **Goroutine/thread dump on demand** — `/debug/pprof/goroutine?debug=2` (Go), `/actuator/threaddump` (JVM), `py-spy dump` (Python). First move on a hang: dump and group by stack signature to find the blocking line.
2. **CPU profile on demand** — `/debug/pprof/profile?seconds=30` to distinguish "stuck waiting" (idle) from "spinning" (hot loop).
3. **Heap profile on demand** — for "bloating, not crashed"; two snapshots, diff.
4. **Runtime log-level toggle** — flip the suspect package to DEBUG for a bounded window on the *exact running instance*, then auto-revert. Get debug-level detail without restarting the process you're investigating.
5. **`expvar`/metrics** — quick `curl` for queue depths, goroutine count, in-flight requests.
6. **All on the admin port**, authenticated, audited.

The thread that ties it together: every capability is *on-demand* (zero cost until invoked) and *non-destructive* (it observes the live process; it doesn't restart it). Restarting a hung process destroys the only evidence of *why* it hung.

### Q: How would you roll out a change to probe parameters across hundreds of services safely?

Probe parameters are load-bearing; a bad change can crash-loop a fleet. Treat it like any risky config rollout:

1. **Template, don't hand-edit.** Parameters live in a shared chart/template with org defaults, so the change is one place, reviewable, with justification comments tying each number to a measured quantity (GC pause, boot p99).
2. **Canary first.** Apply to one low-traffic service, watch restart counts, readiness flap rate, and deploy success over a full traffic cycle including peak.
3. **Watch the right signals.** `kube_pod_container_status_restarts_total` (did restarts spike?), readiness gauge flapping, and deploy error rate. A bad liveness timeout shows up as restarts; a bad readiness shows up as flapping/`0/1 READY`.
4. **Stagger by blast radius.** Roll to tiers, not all at once, so a mistake hits one cell, not the company.
5. **Have an instant rollback.** Because the parameters are templated config, revert is a single change, not N PRs.

---

## Incident Scenarios

### Q: Readiness is flapping fleet-wide and you're having an outage. Walk me through it.

First, classify: is readiness flapping *because the instances are genuinely unready*, or because the *check itself* is failing under load? That distinction determines everything.

1. **Look at the readiness reason.** If it's `503: db unavailable`, the dependency really is down — but the *flap* (in-and-out) suggests a *slow* dependency, not a dead one: the cached check times out intermittently.
2. **Suspect the cascade.** If readiness does a synchronous deep check (DB or downstream ping in the handler), load makes the dependency slow, the probe times out, instances deregister, traffic concentrates on survivors, *they* slow down and flap — a self-amplifying loop. The flapping *is* the cascade.
3. **Stop the bleed.** If it's a deep-check cascade, the fastest mitigation is to make readiness *shallower* — temporarily decouple it from the flaky dependency so instances stay in rotation and serve degraded rather than being yanked. (A feature flag or config that switches the readiness logic, no redeploy.)
4. **Fix the structure.** Move the dependency check to a *cached* background poll with its own timeout; the probe reads the atomic. Now a slow dependency degrades the *answer* slowly instead of *timing out the probe*.
5. **Tune.** Raise `failureThreshold` so a single slow probe doesn't deregister; ensure the readiness timeout is sane.

The headline lesson: **a readiness check that does synchronous I/O turns "the dependency is slow" into "we have no healthy instances."** Flapping under load is the signature of a deep check that should have been cached.

### Q: After a deploy, pods enter `CrashLoopBackOff`. The app logs show a clean startup. What's your first hypothesis?

A clean startup log with crash-looping pods points hard at a *probe misconfiguration*, not an app crash. Likely the **liveness probe is firing during boot** (no startup probe, or `initialDelaySeconds` too low) and killing the pod *after* it logs "started" but *before* it's actually serving — or the new build's boot got slower (bigger cache, a migration) and crossed the liveness tolerance. Check: `kubectl describe pod` for the probe-failure events (`Liveness probe failed`), restart count, and whether a startup probe exists. The tell is that the kill is *external* (kubelet) — the app didn't choose to exit, so its logs look clean right up to the SIGTERM/SIGKILL.

### Q: CPU is pinned at 100% in production and you don't know why. No restart allowed. Go.

1. **CPU profile, 30s**: `go tool pprof -http=:0 '<admin>/debug/pprof/profile?seconds=30'` (or `py-spy top`, JFR). The widest flame frame is the answer — a hot retry loop, an unbounded scan, a regex catastrophe.
2. **If the profile shows the runtime itself (GC) hot**: it's allocation pressure, not your logic. Pull a heap/allocs profile to find the allocation site; the fix is cutting allocation, not tuning GC.
3. **If a goroutine dump shows everyone spinning on one line**: a busy-wait or a lock-free loop gone wrong.
4. **Correlate with a deploy or a traffic shape** — did the spike start at a release, a cron boundary, or a cache-expiry cliff?

The point: the profile *names the function*; you don't guess. And you do it on the live, pinned process — restarting would just hide the evidence.

### Q: Memory climbs steadily over hours until OOMKill. Diagnose on a live pod.

1. **Confirm it's a leak, not a sawtooth.** `kubectl top pod` over time: monotonic rise = leak; sawtooth = healthy GC.
2. **Two heap snapshots, 30 min apart.** `curl <admin>/debug/pprof/heap > t1; ... > t2`, then `go tool pprof -base t1 t2` (Go) or compare snapshots in MAT (Java).
3. **Read the retainer.** Dominator tree (MAT) or `inuse_objects` + `list` (pprof). Usual suspects: an unbounded cache/map with no eviction, a leaked goroutine accumulating, a `ThreadLocal` holding requests in a pooled thread, listeners never unregistered.
4. **Confirm with a controlled experiment.** Route the suspected traffic type away from one pod; its RSS should plateau.
5. **The caution that bites:** do *not* trigger a full heap dump on a pod that's *already* near its memory limit — the dump allocates and can be the OOM you were trying to prevent. Snapshot earlier, or on a canary with headroom.

---

## Live Coding / Whiteboard

### Q: Write a correct readiness handler in Go (no I/O in the handler).

```go
type Readiness struct {
    started atomic.Bool
    dbOK    atomic.Bool // written by a background poller, read by the probe
}

// Background poller: the ONLY place that touches the DB.
func (rd *Readiness) pollDB(db *sql.DB) {
    for range time.Tick(5 * time.Second) {
        ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
        rd.dbOK.Store(db.PingContext(ctx) == nil)
        cancel()
    }
}

func (rd *Readiness) handler(w http.ResponseWriter, r *http.Request) {
    if !rd.started.Load() {
        http.Error(w, "starting", http.StatusServiceUnavailable) // default closed
        return
    }
    if !rd.dbOK.Load() {
        http.Error(w, "db unavailable", http.StatusServiceUnavailable)
        return
    }
    w.Write([]byte("ready"))
}
```

Talking points: the handler reads atomics and never does I/O, so a slow DB can't make the probe slow; the ping is bounded by its own 2s timeout; readiness defaults *closed* (`503` until `started`); a `503` deregisters but never restarts.

### Q: Mount pprof safely on a private admin mux. Show me the mux setup.

```go
func startAdmin(rd *Readiness, addr string) {
    mux := http.NewServeMux() // NOT DefaultServeMux

    mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
        w.Write([]byte("ok")) // liveness: trivial, no dependencies
    })
    mux.HandleFunc("/readyz", rd.handler)
    mux.Handle("/metrics", promhttp.Handler())
    mux.Handle("/debug/vars", expvar.Handler())

    // Explicit pprof on THIS mux — not the blank-import side effect.
    mux.HandleFunc("/debug/pprof/", pprof.Index)
    mux.HandleFunc("/debug/pprof/profile", pprof.Profile)
    mux.Handle("/debug/pprof/heap", pprof.Handler("heap"))
    mux.Handle("/debug/pprof/goroutine", pprof.Handler("goroutine"))

    log.Fatal(http.ListenAndServe(addr, mux)) // "127.0.0.1:9090" — private
}
```

The load-bearing move: a *private* mux on a localhost/admin address so pprof and `expvar` never ride `DefaultServeMux` to the public listener. Bonus point: an auth middleware wrapping the sensitive routes.

### Q: Write a self-reverting runtime log-level toggle.

```go
var logLevel = new(slog.LevelVar) // concurrency-safe; default INFO

func setLogLevel(w http.ResponseWriter, r *http.Request) {
    var body struct{ Level string }
    if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
        http.Error(w, "bad body", http.StatusBadRequest); return
    }
    switch strings.ToUpper(body.Level) {
    case "DEBUG": logLevel.Set(slog.LevelDebug)
    case "INFO":  logLevel.Set(slog.LevelInfo)
    case "WARN":  logLevel.Set(slog.LevelWarn)
    default:
        http.Error(w, "bad level", http.StatusBadRequest); return
    }
    // Auto-revert so a forgotten DEBUG doesn't flood the pipeline forever.
    time.AfterFunc(15*time.Minute, func() { logLevel.Set(slog.LevelInfo) })
    w.Write([]byte("ok"))
}
```

Talking points: the level is an atomic `LevelVar` the handler reads, so the change is immediate and process-wide; the self-revert is the senior touch; in a real system this route is on the admin mux and authenticated.

### Q: Write Kubernetes probes for an app that boots in ~60s with p99 GC pauses of ~1.5s. Justify every number.

```yaml
startupProbe:           # protect the slow boot
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 5
  failureThreshold: 30  # 30 × 5s = 150s boot budget (> ~60s with margin for slow nodes)

livenessProbe:          # restart only a genuine wedge
  httpGet: { path: /healthz, port: 8080 }
  periodSeconds: 10
  timeoutSeconds: 3     # > 1.5s worst-case GC pause, so GC never reads as "wedged"
  failureThreshold: 3   # ~30s sustained failure before restart — not one blip

readinessProbe:         # deregister, don't restart
  httpGet: { path: /readyz, port: 8080 }
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 3
```

Justifications: the startup probe's 150s budget exceeds the 60s boot with headroom for slow-node tails, and it *suspends* liveness during boot so the pod can't be killed mid-start. Liveness `timeoutSeconds: 3 > 1.5s` GC pause so a stop-the-world never trips it; `failureThreshold: 3` requires sustained failure. Readiness is separate from liveness so a dependency blip skips rather than kills.

### Q: Spot the bug.

```go
import _ "net/http/pprof"

func main() {
    http.HandleFunc("/orders", ordersHandler)
    http.ListenAndServe(":8080", nil) // serves DefaultServeMux on the public port
}
```

The blank `net/http/pprof` import registered `/debug/pprof/*` on `DefaultServeMux`, and `ListenAndServe(":8080", nil)` serves `DefaultServeMux` on the **public** port. The service has just published CPU/heap/goroutine profiling to anyone who can reach `:8080` — a memory-disclosure surface and a cheap DoS. Fix: serve business routes on an explicit mux on `:8080`, and mount pprof on a *separate, private* mux/port (`127.0.0.1:9090`).

---

## Behavioral / Experience

### Q: Tell me about a time a health check caused an outage.

The interviewer wants symptom, wrong hypothesis, evidence, fix, lesson — not "I know health checks."

Example skeleton:
- **Symptom.** During a traffic peak, half the fleet dropped out of rotation within seconds; error rate spiked; the remaining pods overloaded.
- **Wrong hypothesis.** "The database is down." It wasn't — it was slow.
- **Evidence.** The readiness handler did a synchronous `SELECT 1` with no caching. Under load the DB hit ~1.5s latency; the readiness `timeoutSeconds` was 1s; every probe timed out and k8s deregistered the pods. The flap pattern (in-and-out, not down-and-stay) was the tell.
- **Fix.** Moved the DB check to a background poller with a 2s timeout writing an atomic; the probe read the atomic and did zero I/O. Raised `failureThreshold` to 3.
- **Lesson.** A readiness check that does synchronous I/O converts "the dependency is slow" into "we have no healthy instances." Probe handlers must never block on a dependency.

Tell one incident, with concrete numbers.

### Q: Describe a time a debug endpoint was a security or stability problem.

"We found `/debug/pprof/` reachable on a service's *public* port — a blank `net/http/pprof` import combined with `ListenAndServe(addr, nil)`. Anyone on the internet could pull a heap dump (memory contents, tokens) or hammer `profile?seconds=300` for a cheap DoS. We moved pprof to a private admin mux on localhost, added a CI lint that fails the build if `net/http/pprof` is imported into a package serving a public `DefaultServeMux`, and swept the fleet for the same pattern. Lesson: the convenient default (blank import) is the insecure one; make the secure path the easy path with a linter."

### Q: Tell me about diagnosing a live production process without restarting it.

"A Go service went unresponsive — requests hung, no crash. Restarting would have cleared the wedge but destroyed the evidence and it would've recurred. I pulled `/debug/pprof/goroutine?debug=2` from the admin port and grouped by stack: ~8,000 goroutines parked on `chan send` to the same channel. The consumer goroutine had panicked-and-recovered into a dead state, so the channel was never drained and every request goroutine blocked forever. The dump named the exact line. We fixed the consumer's lifecycle and added a goroutine-count alert. Lesson: on a hang, dump *before* you restart — the restart is the last thing you do, not the first."

### Q: When did probe tuning bite you, and what did you change?

"A JVM service crash-looped only on busy days. The liveness `timeoutSeconds` was 1s, but under load the old-gen GC hit ~2s stop-the-world. The probe landed during GC, timed out, and k8s restarted a perfectly healthy pod — under load, exactly when GC ran most, so it cascaded. We raised the timeout above the worst-case pause and set `failureThreshold: 3`. I also added a runbook line: *probe timeout must exceed your p99 GC pause*, and we templated probe params so teams stopped hand-rolling them. Lesson: probe parameters are load-bearing config; the defaults are tuned for nothing in particular."

### Q: Describe standardizing diagnostics across many services.

"We had N services each with bespoke (or missing) health, metrics, and profiling. On-call was archaeology — every service different. I built a shared admin-server module: one private port, standard `/healthz`, `/readyz` (cached deps), `/version`, `/metrics`, pprof, and a self-reverting log toggle, with auth and secret-masking baked in. Adoption was a one-line embed. The payoff was that any engineer could diagnose any service the same way at 3am. Lesson: the value wasn't any single endpoint — it was *uniformity*, which is what makes a fleet operable."

---

## What I'd Ask a Candidate Now

Questions that separate "knows the endpoints" from "understands the failure modes."

### Q: When, if ever, would you put a dependency in a *liveness* check?

Listening for a firm "almost never, and here's why" — a dependency in liveness restarts the fleet on a blip and turns a recoverable outage into a crash-loop. The only legitimate enrichment is detecting your *own* wedge (a self-tick watchdog), which depends on nothing external. A candidate who casually adds a DB ping to liveness "to be thorough" hasn't internalized the cascade.

### Q: A pod is `Running` but `0/1 READY` for ten minutes. Bug or not?

The right answer is "not necessarily — investigate *why* readiness is false before assuming a crash." It's likely a warming, draining, or dependency-skipping pod working as designed. A candidate who reflexively says "restart it" has the liveness/readiness distinction backwards.

### Q: What can someone do if they reach your `/debug/pprof` from the public internet?

Strong answer names *both* axes: information disclosure (heap/goroutine dumps leak memory, tokens, `cmdline` leaks args) and DoS (profiling consumes CPU). Bonus: knows the blank-import-on-`DefaultServeMux` footgun and how to prevent it. Weak answer: "it's just metrics, it's fine."

### Q: Your readiness check pings three downstream services. Talk me through why that's risky.

Listening for the cascade explanation: their slowness becomes your unreadiness, which concentrates traffic and amplifies the outage. Strong candidates then pivot to the alternative — graceful degradation, circuit breakers, timeouts — rather than gating their own health on others'.

### Q: How do you raise the log level on one running production instance without redeploying?

Strong answer: a guarded, self-reverting runtime toggle (Actuator `/loggers`, or an atomic level var behind an admin route) flips the specific package to DEBUG on the exact instance for a bounded window. Knows *why* it beats redeploying: no restart (keeps the state you're debugging), no minutes of delay, minimal perturbation. Bonus: the auto-revert and the auth.

### Q: What's a diagnostic endpoint you've used that most people overlook?

Reveals depth. Satisfying answers: `/debug/pprof/trace` + `go tool trace`, `py-spy dump` on a no-access prod PID, JFR/`jcmd JFR.start`, Node `process.report`, `expvar.Func` for live computed introspection, `tokio-console` for async Rust tasks. Weak sign: only knows `/healthz`.

---

## Cheat Sheet

Top-10 must-know questions for any diagnostic-endpoints interview:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW DIAGNOSTIC-ENDPOINT QUESTIONS                                   │
├──────────────────────────────────────────────────────────────────────────┤
│  1. Liveness vs readiness?                                                │
│       → Liveness: "restart me." Readiness: "skip me."                     │
│                                                                           │
│  2. Which dependency goes in which check?                                 │
│       → Liveness: nothing external. Readiness: only strictly-required,    │
│         cached, timed-out, off the hot path.                              │
│                                                                           │
│  3. Why do deep checks cascade?                                           │
│       → A's readiness pings B pings C; one blip brownouts the fleet.      │
│                                                                           │
│  4. Why no I/O in a probe handler?                                        │
│       → A slow dep makes "busy" look like "broken"; instances flap.       │
│         Poll on a timer, probe reads an atomic.                           │
│                                                                           │
│  5. Liveness timeout vs GC pause?                                         │
│       → Timeout must exceed worst-case STW, or you restart healthy pods.  │
│       → failureThreshold ≥ 3.                                             │
│                                                                           │
│  6. What's the startup probe for?                                        │
│       → Suspends liveness/readiness during boot; prevents crash-loops.    │
│                                                                           │
│  7. net/http/pprof blank-import footgun?                                  │
│       → Registers on DefaultServeMux → leaks pprof to public port.        │
│         Use a private mux on the admin port.                             │
│                                                                           │
│  8. Risk of /actuator/heapdump?                                           │
│       → Heavy (can OOM/pause) + total memory disclosure. Authz + audit.   │
│                                                                           │
│  9. Runtime log-level toggle — why over redeploy?                         │
│       → No restart (keeps state), instant, scoped, self-reverting.        │
│                                                                           │
│ 10. Graceful drain on SIGTERM?                                            │
│       → Readiness false → wait a probe cycle → Shutdown. Else deploy errs.│
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- Kubernetes probes reference — <https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/>. The authoritative parameter semantics.
- Go `net/http/pprof` — <https://pkg.go.dev/net/http/pprof> · "Profiling Go Programs" — <https://go.dev/blog/pprof>.
- Spring Boot Actuator (health groups, Kubernetes probes) — <https://docs.spring.io/spring-boot/reference/actuator/endpoints.html>.
- `py-spy` — <https://github.com/benfred/py-spy>. On-demand profiling of a live Python PID with no code changes.
- JMX Exporter (bridging JMX to Prometheus) — <https://github.com/prometheus/jmx_exporter>.
- Brendan Gregg, *Systems Performance* — flame graphs, on-demand profiling, the USE method.
- Google SRE Book, Ch. 6 "Monitoring Distributed Systems" and Ch. 22 "Addressing Cascading Failures" — why deep checks and probe storms cascade.

---

## Related Topics

- [Diagnostic Endpoints — Junior](junior.md) — the four starter endpoints and the liveness/readiness distinction.
- [Diagnostic Endpoints — Middle](middle.md) — correct health, pprof/expvar/Actuator, log toggles, probe wiring.
- [Diagnostic Endpoints — Senior](senior.md) — cascading failure, probe storms, security exposure, on-demand profiling in prod.
- [Diagnostic Endpoints — Professional](professional.md) — safe live profiling under load, dumps without OOM, fleet standardization, authz.
- [Diagnostic Endpoints — Tasks](tasks.md) — hands-on labs.
- [Debugging — Interview](../debugging/interview.md) — pprof, dumps, races, and reading stuck processes.
- [Metrics — Interview](../metrics/interview.md) — the signals behind `/metrics`.
- [Logging — Interview](../logging/interview.md) — structured logs, levels, suppressing probe noise.
