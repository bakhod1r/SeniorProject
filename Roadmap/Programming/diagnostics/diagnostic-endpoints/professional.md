# Diagnostic Endpoints — Professional (Staff / Principal) Level

> **Topic:** [Diagnostic Endpoints Roadmap](README.md)
> **Focus:** The diagnostic surface as a *fleet-wide contract*, not a per-service feature. Safe live profiling under production load. Capturing heap/goroutine/thread dumps without triggering the OOM you're investigating. Standardizing one introspection surface across thousands of heterogeneous services. Authorization models for a privileged admin plane. Modeling and defeating abuse / DoS of debug endpoints. Folding on-demand profiling into always-on eBPF continuous profiling.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [The Diagnostic Surface as a Fleet Contract](#the-diagnostic-surface-as-a-fleet-contract)
6. [Safe Live Profiling Under Production Load](#safe-live-profiling-under-production-load)
7. [Capturing Dumps Without Triggering the OOM](#capturing-dumps-without-triggering-the-oom)
8. [Standardizing a Diagnostic Surface Across a Large Fleet](#standardizing-a-diagnostic-surface-across-a-large-fleet)
9. [Authorization Models for the Admin Plane](#authorization-models-for-the-admin-plane)
10. [Abuse and DoS of Debug Endpoints — A Threat Model](#abuse-and-dos-of-debug-endpoints--a-threat-model)
11. [eBPF and Continuous Profiling Integration](#ebpf-and-continuous-profiling-integration)
12. [The On-Demand / Always-On Boundary](#the-on-demand--always-on-boundary)
13. [Per-Language Deep Dives](#per-language-deep-dives)
14. [Code Examples](#code-examples)
15. [Failure Stories](#failure-stories)
16. [A Worked "Profile the Fleet Safely" Runbook](#a-worked-profile-the-fleet-safely-runbook)
17. [Pros & Cons](#pros--cons)
18. [Use Cases](#use-cases)
19. [Coding Patterns](#coding-patterns)
20. [Clean Code](#clean-code)
21. [Best Practices](#best-practices)
22. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
23. [Common Mistakes](#common-mistakes)
24. [Tricky Points](#tricky-points)
25. [Anti-Patterns at Professional Level](#anti-patterns-at-professional-level)
26. [Test Yourself](#test-yourself)
27. [Tricky Questions](#tricky-questions)
28. [Cheat Sheet](#cheat-sheet)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)
33. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> 🎓 At the professional level the question is no longer "is *this* service's diagnostic surface correct?" It is: **"can any engineer profile, dump, and introspect *any* of our 3,000 services, at 3am, without an OOM, without a CPU stall, without leaking a secret, and without me reviewing it first — because the platform makes the safe path the only path?"**

The [`senior.md`](senior.md) page taught the admin plane as an architectural boundary: a separate loopback listener, fail-static readiness, singleton-gated profiles, the drain race, the dual-use threat table. That is the correct design *for one service, owned by one team, reasoned about by one senior engineer*. This page is about the move that defines staff and principal work: **the diagnostic surface stops being a property of a service and becomes a property of the platform.**

That move changes every problem you already know how to solve, because it adds three multipliers the senior page did not have to reason about:

1. **Scale.** A safeguard that one careful operator applies by hand (profile one replica, not the fleet) must instead be *enforced for thousands of operators who are not careful*, across services written in five languages by teams who never read your runbook. The singleton gate is no longer a code review comment; it is a sidecar, an admission policy, or a property of the profiling control plane.
2. **Heterogeneity.** Go has `net/http/pprof`. The JVM has JFR, async-profiler, and `jmap`. Python has `py-spy` out-of-process. Rust has `pprof-rs` and `tokio-console`. Node has `--inspect` and `clinic`. A *fleet* diagnostic surface must paper over all of these so the collection plane, the authz model, and the storage format are uniform — `pprof` protobuf, `OTLP`, `parca`/`pyroscope` ingestion — even though the producers are wildly different.
3. **Adversaries who scale too.** A debug endpoint that one bored intern can DoS is a debug endpoint that a worm, a credential-stuffed CI token, or a compromised sidecar can DoS across the whole fleet at once. The threat model is no longer "someone hits `/profile` in a loop"; it is "the diagnostic plane itself becomes the blast vector."

> If `senior.md` is "design the admin plane for your service so it can't take down your service," `professional.md` is "**design the diagnostic platform for the fleet so no operator, no attacker, and no script can turn introspection into an outage — and so the safe way is the easy way.**" The deliverable is not a handler. It is a *contract*, an *authz model*, a *collection plane*, and the *guardrails that make the unsafe path impossible.*

We assume, and do not re-derive, everything below the line: the liveness/readiness asymmetry, fail-static on shared dependencies, the cascade mechanism, the basic two-server admin plane, the SIGTERM drain. Read [`senior.md`](senior.md) first. Here we go one level deeper into the five expert frontiers named in the focus block.

---

## Prerequisites

- **Required:** All of [`senior.md`](senior.md) — admin plane as a boundary, fail-static readiness, the cascade, singleton-gated profiles, the drain race, the dual-use security table. This page does not repeat them.
- **Required:** You can read a `pprof` profile, a JFR recording, a flame graph, and a goroutine/thread dump, and you know roughly what each costs to *collect* (see [`../debugging/senior.md`](../debugging/senior.md)).
- **Required:** Fluency with the runtime cost models: STW pauses, safepoints, GC behavior under memory pressure, the difference between `AsyncGetCallTrace` and `jstack`, perf-event vs. signal-based sampling.
- **Required:** Comfort owning a *platform* surface: admission controllers, service mesh policy (Envoy/Istio/Linkerd), SPIFFE/SPIRE workload identity, OPA, sidecars, and how a control plane fans an action out to a fleet.
- **Helpful:** Hands-on with at least one continuous-profiling system — [Parca](https://www.parca.dev/), [Grafana Pyroscope](https://grafana.com/oss/pyroscope/), [Polar Signals](https://www.polarsignals.com/), Datadog Continuous Profiler, or Google-Wide Profiling-style infrastructure.
- **Helpful:** eBPF literacy — `perf_event_open`, BPF stack-walking, frame-pointer vs. DWARF unwinding, the `dynamic-instrumentation-and-ebpf` sibling topic ([`../dynamic-instrumentation-and-ebpf/README.md`](../dynamic-instrumentation-and-ebpf/README.md)).
- **Helpful:** You have run, or cleaned up after, an incident where a *diagnostic action* — a fleet profile, a heap dump, a debug toggle — was itself the cause.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Diagnostic surface** | The complete set of introspection capabilities a process exposes: health, metrics, profiles, dumps, toggles, state snapshots, version. At fleet scale, a *contract*, not a list of handlers. |
| **Collection plane / profiling control plane** | The fleet-wide system that *initiates and collects* diagnostics (profiles, dumps) — Parca/Pyroscope agents, a profiling scheduler, a fleet `kubectl debug` orchestrator — distinct from the per-process admin plane that *serves* them. |
| **Continuous profiling** | Always-on, low-frequency, fleet-wide sampling of CPU/heap/lock profiles, stored and queryable over time — vs. on-demand single-pull profiling. |
| **Whole-fleet profiling (GWP)** | "Google-Wide Profiling": sample a *small fraction* of every machine continuously, aggregate. Per-host cost is negligible; fleet coverage is total. |
| **eBPF profiler** | A profiler that samples stacks in-kernel via `perf_event` + BPF, *out of process*, with no application code, no SDK, no restart, no symbols needed at collection time (e.g. Parca Agent, `bpftrace`, `perf`). |
| **Frame-pointer unwinding** | Walking the call stack via the `RBP` chain. Cheap, but requires frames not be omitted (`-fno-omit-frame-pointer`). The default for modern eBPF profilers. |
| **DWARF / CFI unwinding** | Stack-walking using debug-info unwind tables when frame pointers are absent. Heavier; some eBPF profilers ship a DWARF-CFI unwinder in BPF. |
| **Safepoint bias** | A JVM profiling artifact: `jstack`/`GetStackTrace` only sample *at safepoints*, systematically mis-attributing hot code. `AsyncGetCallTrace` (async-profiler) avoids it. |
| **JFR** | Java Flight Recorder — built-in, low-overhead, always-on-capable JVM event recorder (allocations, locks, GC, CPU). The JVM's native continuous-profiling substrate. |
| **Self-OOM** | Taking a heap dump (or other large allocation) on a memory-pressured process and pushing it over its limit, killing the very process you were diagnosing. |
| **Profile-guided DoS** | Weaponizing an expensive diagnostic (profile/dump) by invoking it repeatedly or at scale to exhaust CPU/memory/disk. |
| **Diagnostic amplification** | One small request triggering disproportionate work: `goroutine?debug=2` STW, a multi-GB heap dump, a fleet-wide profile fan-out. |
| **Workload identity** | A cryptographic identity for a *service instance* (SPIFFE ID, cloud IAM role, mTLS cert) used to authn/authz machine-to-machine — including operator-to-admin-plane. |
| **Just-in-time (JIT) access** | Time-boxed, audited, approval-gated elevation to a privileged capability (here: the admin plane) — vs. standing access. |
| **Ephemeral debug container** | `kubectl debug` / `EphemeralContainers`: attach a tooling container into a running pod's namespaces to profile/dump without baking tools into the image. |
| **Break-glass** | An emergency, heavily-audited path to bypass normal authz when the normal path is down — the diagnostic equivalent of the firefighter's axe behind glass. |
| **Backpressure on diagnostics** | Treating profile/dump requests as load that must be admission-controlled, queued, and shed — not as free side-channel operations. |

---

## Core Concepts

### 1. The diagnostic surface is a fleet API with a versioned contract

At senior level, `/readyz`, `/debug/pprof/profile`, and `/metrics` are handlers you mount. At professional level they are an **API the whole org depends on**: every dashboard, every runbook, every automated profiler, every `kubectl debug` wrapper assumes `/debug/pprof/` is at the same path, on the same port, behind the same auth, in the same protobuf format, on *every* service. The moment one team mounts pprof on `:8080` instead of `:9090`, or returns gzip where the collector expects raw protobuf, the fleet tooling breaks for them silently. A staff engineer owns this contract the way an API owner owns a public schema: documented, linted in CI, versioned, and changed only with migration.

### 2. The cost of a diagnostic is paid by the process you're trying to save

The senior page established that diagnostics have a budget. The professional escalation: **the cost is highest exactly when you most want to spend it.** You pull a heap dump *because* the process is memory-pressured — and the dump's allocation is what OOM-kills it. You pull a CPU profile *because* the box is CPU-bound — and the profiler's overhead is what pushes p99 over the SLO. You pull a goroutine dump *because* you suspect a leak — and the STW to walk a million goroutines is the longest pause of the incident. The frontier skill is **collecting the signal without the act of collection becoming the next line of the incident timeline.**

### 3. On-demand and always-on are the same data, collected two ways

A 30-second `pprof` pull and a continuous-profiling agent both produce a CPU profile. The difference is *who initiates*, *how often*, and *at what sampling rate*. The professional insight is to **unify them**: if you have always-on, low-overhead, fleet-aggregated profiling (eBPF or in-process sampler shipping to Parca/Pyroscope), you almost never need the dangerous on-demand pull — the data is *already there*, collected safely, queryable retroactively. On-demand profiling becomes the rare, gated exception, not the default tool. The endpoint still exists; it's just no longer the thing you reach for first.

### 4. Standardization beats local optimization

A fleet where every team writes their own "best" admin plane is a fleet with 3,000 subtly-different attack surfaces, 3,000 auth models, and no tooling that works everywhere. A fleet where every service inherits *one* admin-plane library / sidecar — slightly suboptimal for any single service, uniform across all — is a fleet you can actually operate, secure, and audit. **The staff move is to make the standard surface so good that opting out is irrational, and then to lint the opt-outs to zero.**

### 5. The diagnostic plane is a privileged-action API and must be authorized like one

Senior says "operator auth, separate from user auth." Professional says: **a heap dump is `sudo`, a fleet profile is `sudo` on N machines, a log toggle is config-change-in-prod.** These are privileged operations and demand the full apparatus: workload identity, RBAC, just-in-time elevation, per-action audit, break-glass, and — critically — *who is allowed to fan an action out to how many instances at once*. The authz question is not only "can you" but "can you, *at this scale*, *right now*."

### 6. An adversary scales with you

Every safeguard you build for operators is a safeguard against attackers, and vice versa. The singleton gate that stops your operator double-profiling also stops the attacker's loop. But the inverse is the trap: a *fleet* control plane that lets one operator profile 3,000 instances with one command is, if compromised, a button that DoSes 3,000 instances with one command. **The blast radius of the diagnostic plane is the blast radius of whoever controls it.**

---

## The Diagnostic Surface as a Fleet Contract

The single highest-leverage professional decision is to define the diagnostic surface as a **written, versioned, linted contract** that every service in the fleet honors identically. Local correctness (senior) becomes fleet uniformity (professional).

### The contract specifies, for the whole fleet

| Dimension | The fleet contract (example) | Why uniform |
|---|---|---|
| **Admin port** | Always `9090`, always bound to loopback or the pod IP behind a mesh, never a public Service | Tooling, scrapers, port-forward wrappers all assume it |
| **Health paths** | `/healthz` (liveness, unconditional), `/readyz` (readiness, own-fault), `/startupz` | Orchestrator config is templated, not per-service |
| **Profile paths & format** | `/debug/pprof/*` returning raw `pprof` protobuf; JFR via the JFR-over-HTTP shim; everything normalized to pprof at the collector | The collection plane parses *one* format |
| **Metrics** | `/metrics`, OpenMetrics/Prometheus exposition | One scrape config fleet-wide |
| **State snapshot** | `/debug/state` returning a versioned JSON schema | Runbooks and dashboards parse it |
| **Auth** | One operator-auth scheme (mTLS workload identity + RBAC), enforced by the shared library / sidecar | One authz model to reason about and audit |
| **Expensive-op limits** | Singleton + brownout + max-duration enforced *by the platform*, not per-team code | The careless team is protected anyway |
| **Audit** | Every privileged invocation emits a structured audit event to a fixed sink | Forensics works the same everywhere |

### How you enforce a contract across thousands of services

You do **not** enforce it by documentation and good intentions. Three enforcement layers, strongest last:

1. **A shared library / framework default.** The `internal/adminplane` Go module, the Spring Boot starter, the `diagnostics` crate. New services get the correct surface by importing it. This catches the *willing* majority.
2. **CI lint / conformance test.** A check that fails the build if pprof is on `DefaultServeMux`, if `management.endpoints.web.exposure.include=*`, if `--inspect` lacks a loopback bind, if the admin port isn't `9090`, or if a readiness handler does synchronous I/O. This catches the *forgetful*.
3. **Admission control / mesh policy.** A Kubernetes admission webhook that rejects a Deployment exposing port `9090` on a public Service; a mesh `AuthorizationPolicy` that denies all traffic to the admin port except from the bastion / collection plane. This catches the *non-compliant*, including services not built from your framework at all.

```rego
# OPA / Gatekeeper: reject any Service that exposes the admin port publicly.
package fleet.diagnostics

violation[{"msg": msg}] {
    input.review.object.kind == "Service"
    input.review.object.spec.type == "LoadBalancer"
    some p
    port := input.review.object.spec.ports[p]
    port.targetPort == 9090            # the fleet-standard admin port
    msg := "admin port 9090 must never be exposed via a LoadBalancer Service"
}
```

The principle: **a contract you cannot mechanically verify is a wish.** The senior engineer reviews one service's surface in a PR; the staff engineer writes the linter that reviews every service's surface forever.

---

## Safe Live Profiling Under Production Load

The senior page said: profile *one* replica, bound the duration, singleton-gate, brownout. That is the manual discipline. The professional skill is doing this **at fleet scale, on hot boxes, with overhead you can predict and bound, often without touching the application at all.**

### Know the overhead of every collection method — precisely

You cannot reason about "safe under load" without numbers. Approximate, measured-on-real-systems overheads:

| Method | Mechanism | Typical overhead | Perturbation profile | Needs |
|---|---|---|---|---|
| Go `pprof` CPU (`/profile`) | SIGPROF timer, in-process | ~1–5% during window | Adds wall-clock to all goroutines | nothing (built in) |
| Go heap profile | Sampled allocations, always on | ~0% (sampling is continuous) | A GC + walk on pull | nothing |
| Go `goroutine?debug=2` | STW + walk every G | **STW ∝ goroutine count** | A real pause on huge G counts | nothing |
| JVM async-profiler (CPU) | `AsyncGetCallTrace` + perf events | ~1–2% | No safepoint bias | agent attach |
| JVM JFR | In-JVM event ring buffer | ~1–3% (often <2% default) | Low, steady; designed for always-on | nothing (built in) |
| JVM `jstack` loop | Safepoint stack dumps | **Safepoint-biased + STW per dump** | Misleading *and* pausing | nothing |
| JVM `jmap -dump:live` | STW + full GC + heap write | **STW + multi-GB I/O** | The OOM risk | nothing |
| `py-spy` (sampling) | Reads `/proc/<pid>/mem`, out-of-process | ~0% on target | None on the target process | `CAP_SYS_PTRACE` |
| Rust `pprof-rs` | SIGPROF + frame unwind, in-process | ~1–3% | Like Go's | crate + handler |
| Rust `tokio-console` | Tracing instrumentation, always-on | Low, but always-paying | Steady tax for task introspection | `console-subscriber` |
| Node `--inspect` CPU profiler | V8 sampling via inspector | Low sample, but attach perturbs | Inspector protocol overhead | inspector port |
| **eBPF profiler (Parca Agent)** | `perf_event` + BPF stack walk, **out of process** | **~0.3–1% per host, all processes** | None on any app; kernel-side | `CAP_BPF` / privileged agent |

The single most important row is the last one. **An eBPF profiler samples every process on the host with sub-1% overhead, needs no application code, no SDK, no restart, and no in-process endpoint to abuse.** For CPU profiling at fleet scale this is strictly better than mounting `/debug/pprof/profile` and hoping nobody loops it. The on-demand endpoint becomes the fallback for languages/runtimes the eBPF profiler can't unwind well, or for profile types (heap, contention) that need in-runtime knowledge.

### The "profile one, statistically" pattern

Even when you *do* use in-process pulls, the fleet-safe pattern is not "profile the one pod I happened to port-forward." It is **continuous sampling of a random small fraction of the fleet** — Google-Wide-Profiling style. Each host is profiled, say, for 10 seconds out of every 10 minutes (~1.7% duty cycle), uncoordinated across hosts. No single host ever carries more than one profile's worth of overhead, the fleet is *always* covered, and you never run the dangerous "profile everything at once" command because you never need to.

```text
   WRONG (on-demand fleet pull):  all N hosts profiled NOW → N× overhead spike during incident
   RIGHT (continuous fraction):   each host profiled 10s/600s, phases random → ~1.7% per host, ALWAYS
```

### Bounding overhead you don't control

When an operator *must* pull on-demand on a hot box, the platform — not the operator — enforces the bounds. The admin-plane library wraps every expensive endpoint with: max duration clamp, singleton CAS, brownout on CPU/memory headroom, *and* a fleet-level concurrency cap (no more than K profiles running across the service at once, enforced by a token in a shared store). The operator cannot exceed these even with the right credentials, because the safe path is the only path the platform offers.

---

## Capturing Dumps Without Triggering the OOM

This is the failure mode that most distinguishes professional practice: **the heap dump that kills the patient.** It deserves its own section because the naive instinct — "memory bug, take a heap dump" — is exactly backwards on a pressured process.

### Why a heap dump self-OOMs

A heap dump must, by construction, read the entire live heap and serialize it. The serialization path itself **allocates** (buffers, encoder state, I/O queues). On a JVM at 92% of its memory limit, those buffers tip it over the cgroup limit and the kernel OOM-killer reaps it mid-dump. You lose the process *and* the evidence — a strictly worse outcome than not dumping at all. The same logic applies to Go's heap profile under extreme pressure (smaller, but not free), to Node's `v8.writeHeapSnapshot()` (which can double live memory transiently), and to any full-fidelity memory capture.

### The professional dump protocol

| Step | Action | Why |
|---|---|---|
| 1 | **Pick a replica you can sacrifice or have already drained** | Its pause/risk harms no live traffic |
| 2 | **Set readiness false on it; wait out endpoint propagation** | LB stops routing before you perturb it |
| 3 | **Verify headroom**: dump volume free ≥ heap size + margin; cgroup memory headroom for the encoder | The dump must not be the allocation that OOMs |
| 4 | **Prefer the *sampled* or *live-only* variant** | `jmap -dump:live` (post-GC live set), Go's sampled heap profile, `py-spy dump` (no heap copy at all) |
| 5 | **Stream to disk/object-store, not into a response buffer** | Don't hold the whole dump in memory to serve it over HTTP |
| 6 | **Audit who, when, why; tag the artifact** | A heap dump contains all secrets in memory — treat it as sensitive data at rest |
| 7 | **Encrypt the artifact and gate its download** | The dump is a memory-exfiltration object even after collection |

### Capture techniques that avoid the in-process allocation entirely

The deepest move is to **capture memory state without asking the target process to serialize itself**:

- **Core dump from outside.** `gcore <pid>` (or a kernel-configured core on crash) snapshots the process's address space via the kernel, then you analyze it offline with `delve` (Go), `mat`/Eclipse MAT or `jhsdb` (JVM), or `gdb`. The *target* does almost no work; the cost is the page-cache pressure of writing the core, which you can throttle (`ionice`, cgroup IO limits). For crash-time capture, see [`../crash-reporting/README.md`](../crash-reporting/README.md).
- **`py-spy dump`** reads another process's stacks from `/proc/<pid>/mem` with zero cooperation from the target — the target doesn't pause, doesn't allocate, doesn't even know.
- **eBPF allocation profiling.** Sample allocation stacks continuously and out-of-process so the leak's *shape* is already recorded before you ever consider a full dump. The dump becomes confirmation, not discovery.
- **JFR's `OldObjectSample`** event records live objects' allocation stacks with bounded overhead, always on — so you diagnose a leak from the always-on recording instead of a stop-the-world dump.

### Goroutine / thread dumps at scale

A Go `goroutine?debug=2` on a process with a 1M-goroutine leak triggers a stop-the-world walk of every goroutine — the dump is itself a multi-hundred-millisecond pause, landing on the exact process already in trouble. The protocol:

1. **Aggregate first, cheap:** `goroutine?debug=1` returns counts grouped by stack — usually enough to spot the leak (e.g. "847,000 goroutines blocked in `chan receive` at `worker.go:88`") without the full STW walk.
2. **Full stacks only if needed:** `debug=2` once, on a drained replica.
3. **JVM equivalent:** `jstack` / `/actuator/threaddump` is far cheaper (threads number in the hundreds, not millions) but still safepoint-synchronized — fine on-demand, never in a tight loop.

> The throughline: **a dump is a privileged, potentially-fatal operation on the very process you're trying to understand.** Drain first, capture from outside the process where possible, prefer sampled/live-only variants, verify headroom, and treat the artifact as the most sensitive data your service produces.

---

## Standardizing a Diagnostic Surface Across a Large Fleet

Heterogeneity is the enemy of operability. A fleet with five languages and per-team admin planes is unprofileable, unauditable, and insecure. The professional job is to make the surface *look the same* to tooling regardless of what's behind it.

### The normalization layers

```text
   PRODUCERS (heterogeneous)          NORMALIZATION              CONSUMERS (uniform)
   ┌────────────────────────┐
   │ Go    /debug/pprof/*   │──┐
   │ JVM   JFR / async-prof │──┤   ┌────────────────────┐   ┌─────────────────────────┐
   │ Py    py-spy           │──┼──▶│ all → pprof proto  │──▶│ Parca / Pyroscope store │
   │ Rust  pprof-rs         │──┤   │ all → OTLP traces  │   │ one query UI, one authz │
   │ Node  --inspect/v8     │──┘   │ all → OpenMetrics  │   │ one retention policy    │
   └────────────────────────┘      └────────────────────┘   └─────────────────────────┘
```

The trick is that the *collection plane* converts each runtime's native format to a common one (`pprof` protobuf is the de-facto lingua franca for profiles; OTLP for traces; OpenMetrics for metrics), so consumers never know or care what produced the data. Pyroscope and Parca both ingest pprof; async-profiler emits collapsed stacks and JFR that convert to pprof; py-spy can emit speedscope/pprof. **You standardize the *format at the boundary*, not the *runtime*.**

### What the shared admin-plane library guarantees

A single internal library (per language, but conforming to one spec) gives every service:

- The fleet-standard port, paths, and bind address.
- The operator-auth middleware (workload identity + RBAC) wired in by default.
- The singleton + brownout + max-duration + fleet-concurrency-cap wrappers on expensive endpoints — not optional.
- A `/debug/state` returning a versioned, schema'd snapshot.
- Audit emission on every privileged call.
- A startup self-check that refuses to boot if the surface is misconfigured (e.g. admin listener bound to `0.0.0.0`, inspector public, Actuator `*`-exposed).

```go
// One import, correct-by-default fleet admin plane. A team CANNOT misconfigure
// the dangerous bits because the library owns them.
func main() {
    app := myservice.New()
    admin := adminplane.New(adminplane.Config{
        // Port/bind/auth are fleet defaults; a team can't move them off-contract.
        StateSnapshot: app.SnapshotState,            // their state, our schema
        Indicators:    app.HealthIndicators(),       // their checks, our aggregator
        // pprof, metrics, expvar, expensive-op guards, audit: all mounted by the library.
    })
    admin.MustStartConformant()  // panics at boot if the surface violates the contract
    log.Fatal(app.Serve(":8080"))
}
```

### Migrating an existing fleet to the contract

You will inherit thousands of services that predate the contract. The migration is a campaign, not a flag flip:

1. **Inventory.** Scan every service for its current diagnostic surface (port, exposed endpoints, auth). A one-off scanner that hits each service's admin port and records what it finds.
2. **Lint in warn-mode.** Add the CI conformance check as a *warning* first; publish the fleet's compliance percentage on a dashboard.
3. **Ship the library/sidecar.** Make adoption a one-line change.
4. **Flip lint to error** for new services; backfill old ones team-by-team.
5. **Enforce at admission** so non-compliant surfaces literally cannot deploy.
6. **Track to zero.** A "diagnostic-surface compliance" SLO owned by the platform team.

---

## Authorization Models for the Admin Plane

Senior: "operator auth, separate from user auth, mTLS or SSO behind a bastion." Professional: a **full authorization model** for a privileged-action API, because at fleet scale "operator" is too coarse — you need to express *who* can do *what* to *how many instances* *for how long*, with audit and break-glass.

### The authz dimensions

| Dimension | Question | Mechanism |
|---|---|---|
| **Identity** | Who/what is calling? | Workload identity (SPIFFE/SPIRE, cloud IAM, mTLS cert) for machines; SSO/OIDC for humans, federated to a short-lived cert |
| **Authorization** | Are they allowed this action? | RBAC/ABAC: `role:oncall-payments` may `profile`, `dump`, `toggle-log` on `service:payments-*` |
| **Scope / blast radius** | On how many instances at once? | A *fan-out cap*: `profile` allowed on ≤ N instances per request; `dump` on ≤ 1 |
| **Time** | For how long? | Just-in-time elevation: access granted for a 1-hour window tied to an incident ID, auto-revoked |
| **Audit** | Recorded immutably? | Every action → structured audit event (who, what, target, when, incident-id) to an append-only sink |
| **Break-glass** | Emergency override? | A separate, louder, more-audited path for when the normal authz plane is itself down |

### Why workload identity, not a shared secret

A shared bearer token on the admin plane is a single secret that, once leaked (a CI log, a heap dump, an env var in a screenshot), unlocks the fleet's diagnostics forever. **Workload identity** (SPIFFE ID issued by SPIRE, or a cloud IAM role, presented as a short-lived mTLS cert) means:

- The caller's identity is cryptographic and *non-transferable* (the private key never leaves the workload).
- Authz is per-identity and revocable centrally.
- Certs are short-lived (minutes/hours), so a stolen cert expires fast.
- The mesh enforces it, so even a service that forgot to check is protected by the sidecar.

```yaml
# Istio AuthorizationPolicy: only the profiling control plane's identity may reach
# the admin port, and only it. Everything else to :9090 is denied at the sidecar.
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: admin-plane-lockdown, namespace: payments }
spec:
  selector: { matchLabels: { app: payments } }
  action: ALLOW
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/observability/sa/profiling-agent"]
      to:
        - operation:
            ports: ["9090"]
            paths: ["/debug/pprof/*", "/debug/state"]
# (implicit deny for all other identities on :9090)
```

### Just-in-time and break-glass

Standing access to "dump any service's memory" is a standing liability — every operator account becomes a fleet-wide exfiltration risk. **Just-in-time access** flips this: by default nobody can dump prod memory; during an incident, an operator requests elevation tied to the incident ID, gets a 1-hour scoped credential, and it auto-revokes. Routine work needs no standing privilege; the dangerous capability exists only in a bounded window, fully audited.

**Break-glass** is the escape hatch for when the authz plane *itself* is part of the outage (SPIRE down, SSO down). It is a separate, pre-provisioned, heavily-alarmed path — using it pages security, the on-call lead, and leaves an audit trail loud enough that nobody uses it casually. The diagnostic equivalent of the axe behind glass: available, but breaking it is itself an event.

### Authorizing the fan-out, not just the action

The fleet-specific authz frontier: a control plane that can profile one instance with one API call can profile *all* instances with the same call. The authz model must therefore gate **scale** as a first-class dimension. "You may profile" and "you may profile 3,000 instances simultaneously" are different grants. The default fan-out cap should be small (one instance, or a single-digit sample); profiling a large fraction at once requires elevated, separately-audited authorization — because that action is, mechanically, a self-inflicted fleet DoS waiting to be fat-fingered.

---

## Abuse and DoS of Debug Endpoints — A Threat Model

The senior dual-use table listed the weapons. The professional treatment is a **threat model**: who attacks, how the attack scales, and the specific control that neutralizes each — because at fleet scale the diagnostic plane is a *systemic* attack surface, not a per-service footgun.

### Threat actors and their leverage

| Actor | Access | What they weaponize | Scaled impact |
|---|---|---|---|
| **External attacker** | Misconfigured public admin port | `/heapdump` (exfil), `/profile` loop (DoS), `jolokia` (RCE), open `--inspect` (RCE) | One misconfig → whole-service compromise; a scanner finds it in minutes |
| **Malicious/curious insider** | Standing operator access | Fleet `dump` (mass exfil), fleet `profile` (mass DoS) | Standing access → standing fleet-wide exfiltration capability |
| **Compromised CI token / service account** | The collection plane's identity | The fan-out itself | One stolen identity → DoS or dump *every* instance with one command |
| **Compromised sidecar / neighbor pod** | Loopback to the admin port | Everything loopback "protected" | Loopback is not a security boundary against same-pod compromise |
| **Automated worm** | Any reachable debug endpoint | `/profile`, `/dump` in a loop across discovered hosts | Self-replicating profile-guided DoS across the fleet |
| **Cost attacker** | A reachable `/loggers` POST or verbose toggle | Flip everything to TRACE fleet-wide | A log/telemetry-bill DoS — see [`../telemetry-cost-and-sampling-strategy/README.md`](../telemetry-cost-and-sampling-strategy/README.md) |

### The attack → control map

| Attack | Mechanism | Control |
|---|---|---|
| **Profile-guided CPU DoS** | Loop `/profile?seconds=large` | Max-duration clamp + singleton CAS + fleet concurrency cap + brownout-on-load + authz |
| **Heap-dump exfiltration** | One GET returns all process memory | Off the reachable surface entirely; JIT-only; encrypt + gate the artifact; audit |
| **Self-OOM as DoS** | Trigger a dump on a pressured pod | Brownout: refuse dump when memory headroom is low; require drain-first |
| **Goroutine-dump STW amplification** | `?debug=2` on a huge-G process | Default to `debug=1` aggregation; gate `debug=2` |
| **SSRF via any fetch-a-URL diagnostic** | Point the server at `169.254.169.254` | No user-controlled URLs in any diagnostic, ever; deny metadata egress at the network |
| **RCE via jolokia / JMX / open inspector** | Deserialization gadget; inspector eval | Disable remoting; never `*`-expose; inspector loopback-only + startup assertion |
| **Telemetry-cost DoS** | Fleet-wide DEBUG/TRACE flip | Self-reverting toggles; authz on `/loggers`; rate-limit; per-service sampling caps |
| **Fan-out DoS via the control plane** | One command profiles all N | Fan-out cap as an authz dimension; elevated grant for large scale; rate-limit the control plane |
| **Diagnostic-plane as pivot** | Compromised admin plane → lateral movement | Network-segment the admin plane; workload identity; the plane can reach *out* to nothing |

### The control plane is itself a target

The defining professional insight: **once you build a control plane that can profile/dump the whole fleet, that control plane is the most dangerous thing in your infrastructure.** It holds (or can mint) credentials to introspect every service's memory. Securing it is a top priority:

- It runs with the *least* privilege that still works; it cannot reach the internet.
- Its own access is JIT and break-glass-gated, not standing.
- Every fan-out it performs is rate-limited and capped *by the control plane*, so a compromised operator account can't turn it into a fleet weapon.
- It is monitored: an alert fires if profile/dump request rate or fan-out scale exceeds normal — abnormal diagnostic activity is an intrusion signal.

> Reframe: you have built a legitimate, authorized, fleet-wide memory-exfiltration-and-DoS tool. That is exactly what continuous profiling *is*, viewed adversarially. The entire authz, capping, and audit apparatus exists because the tool is genuinely that powerful. Treat it like the loaded weapon it is.

---

## eBPF and Continuous Profiling Integration

The frontier that resolves most of the tension above: **stop relying on in-process diagnostic endpoints for routine profiling, and collect out-of-process, continuously, fleet-wide, via eBPF.**

### Why eBPF profiling changes the calculus

An eBPF profiler (Parca Agent, `perf`, Pyroscope's eBPF mode, Polar Signals) attaches `perf_event` sampling and a BPF program that walks the stack *in the kernel*, for *every* process on the host, with no application cooperation. The properties that matter:

| Property | In-process endpoint (`/debug/pprof`) | eBPF profiler (out-of-process) |
|---|---|---|
| App code / SDK required | Yes (mount handler) | **No** |
| Restart to enable | Sometimes | **No** |
| Per-language work | Per-language | **One agent, all languages** |
| Overhead | 1–5% during a pull | **~0.3–1% always, all processes** |
| Abuse surface | An HTTP endpoint to gate | **None — no endpoint exists** |
| Coverage | Only when you pull | **Always; retroactively queryable** |
| Symbolization | At collect time | **Deferred; from build-id + debuginfod** |

The fourth-from-last row is the security punchline: **an endpoint that doesn't exist cannot be DoSed, leaked, or RCE'd.** Moving routine CPU profiling out of the process and into an eBPF agent *removes* the attack surface rather than guarding it.

### Frame pointers, DWARF, and the symbolization deferral

The cost of out-of-process stack-walking is unwinding. Two approaches:

- **Frame-pointer unwinding** (cheap): follow the `RBP` chain. Requires the fleet to be built with `-fno-omit-frame-pointer` (Go does this by default; modern glibc/Fedora re-enabled it; the JVM and many C/C++/Rust builds historically omitted it). A staff-level fleet decision is *"we compile the whole fleet with frame pointers"* — it costs ~1% runtime for vastly cheaper, more reliable profiling.
- **DWARF-CFI unwinding in BPF** (Parca's approach): ship the unwind tables into the kernel so frames can be walked without frame pointers. Heavier, but works on binaries you can't recompile.

Symbolization is **deferred**: the agent records raw addresses + build-IDs; symbols are resolved later from a `debuginfod` server or uploaded debug info, so no debug symbols ship to production and collection stays cheap.

### Wiring continuous profiling into the fleet

```yaml
# Parca Agent as a DaemonSet: one eBPF profiler per node, profiling EVERY process,
# pushing pprof to the Parca server. No application changes, no endpoints to secure.
apiVersion: apps/v1
kind: DaemonSet
metadata: { name: parca-agent, namespace: observability }
spec:
  template:
    spec:
      hostPID: true
      containers:
        - name: parca-agent
          image: ghcr.io/parca-dev/parca-agent:latest
          args:
            - --remote-store-address=parca.observability:7070
            - --node=$(NODE_NAME)
          securityContext:
            privileged: true          # needs CAP_BPF / CAP_PERFMON / CAP_SYS_PTRACE
```

```go
// In-process alternative when eBPF can't unwind your runtime well (or for HEAP/
// CONTENTION profiles eBPF doesn't capture): push pprof to Pyroscope continuously.
// Note: this is ALWAYS-ON, low-rate, and self-limited — NOT an exposed endpoint.
import "github.com/grafana/pyroscope-go"

func main() {
    pyroscope.Start(pyroscope.Config{
        ApplicationName: "payments.checkout",
        ServerAddress:   "http://pyroscope.observability:4040",
        ProfileTypes: []pyroscope.ProfileType{
            pyroscope.ProfileCPU, pyroscope.ProfileAllocObjects,
            pyroscope.ProfileInuseSpace, pyroscope.ProfileGoroutines,
        },
        // Low, steady sample rate — overhead budgeted as a constant tax, not a spike.
    })
    // ... run the service ...
}
```

```java
// JVM: JFR as the always-on continuous-profiling substrate. Start a bounded
// recording at launch; ship chunks to the collector. Overhead typically <2%.
//   -XX:StartFlightRecording=settings=profile,maxsize=256m,maxage=1h,dumponexit=true
// async-profiler can attach on-demand for a deeper CPU profile WITHOUT safepoint bias:
//   asprof -d 30 -e cpu -f /tmp/cpu.html <pid>     # 30s, one JVM, no endpoint
```

### Continuous profiling subsumes most on-demand pulls

When CPU, heap-allocation, in-use-space, lock-contention, and goroutine profiles are *already being collected continuously and stored queryably*, the on-demand pull becomes the rare exception:

- "Why was this service CPU-bound at 14:32 last Tuesday?" → query the stored profile for that window. No live pull, no incident-time perturbation, and you can diff against a healthy window.
- "Is this leak in `cache.go` or `session.go`?" → query stored in-use-space profiles over the leak's growth window. No stop-the-world dump.

The on-demand endpoint survives for: profile types the continuous system doesn't capture, runtimes the eBPF agent can't unwind, and the rare "I need *this exact* live moment, not a sample" case. It is the scalpel, not the everyday tool. This is the deepest integration point with the sibling topic — see [`../continuous-profiling/README.md`](../continuous-profiling/README.md).

---

## The On-Demand / Always-On Boundary

A decision table for *which* mechanism to reach for, because the professional skill is knowing when the dangerous on-demand pull is even justified.

| You need… | Reach for | Not |
|---|---|---|
| Routine fleet CPU hot-spots | eBPF continuous profiler (Parca/Pyroscope/`perf`) | On-demand `/profile` |
| "Why was service X slow last Tuesday?" | Query stored continuous profiles | A live pull (the moment is gone) |
| A leak's allocation shape | Continuous in-use-space / JFR `OldObjectSample` | A stop-the-world heap dump |
| A *full* heap graph for a hard leak | `gcore` + offline MAT/delve, on a drained replica | `/actuator/heapdump` on the hot pod |
| Goroutine-leak counts | `goroutine?debug=1` (aggregated) | `?debug=2` (full STW) |
| A specific live CPU moment eBPF can't unwind | On-demand in-process `pprof`/async-profiler, one replica, gated | A fleet-wide pull |
| Lock contention on the JVM | async-profiler `-e lock` / JFR | `jstack` loop |
| Python hot path | `py-spy record` (out-of-process) | An in-process profiling endpoint |

The rule: **always-on, out-of-process, fleet-aggregated by default; on-demand, in-process, single-target only when the always-on data genuinely can't answer the question.** If you find your team reaching for on-demand pulls routinely, your continuous-profiling coverage has a gap — fix the gap, don't normalize the dangerous pull.

---

## Per-Language Deep Dives

The fleet contract papers over these, but the staff engineer must know each runtime's frontier to build the adapters and set the safe defaults.

### Go

- **Continuous:** Pyroscope/Parca via in-process push or eBPF; `runtime/pprof` and `net/http/pprof` are the substrate.
- **Frame pointers** are on by default → eBPF unwinds Go cheaply.
- **`runtime.SetMutexProfileFraction` / `SetBlockProfileRate`** gate the contention profiles; default off because they cost. The admin-plane library should expose enabling them as a *gated, self-reverting* toggle, not a standing setting.
- **`GODEBUG` knobs** (`gctrace=1`, `schedtrace`, `scheddetail`) are diagnostic but extremely verbose — treat like a self-reverting log toggle.
- **Goroutine dumps:** `debug=1` first; `debug=2` is STW.

### JVM (Java / Kotlin / Scala)

- **JFR** is the always-on substrate: `-XX:StartFlightRecording`, ~1–2% overhead, captures CPU, alloc, locks, GC, `OldObjectSample` (leak shapes). This is the fleet default.
- **async-profiler** for on-demand deep CPU/lock/alloc profiling *without safepoint bias* (`AsyncGetCallTrace`). Strictly better than `jstack` loops or naive `GetStackTrace`.
- **Never `jstack`-loop** for profiling — safepoint-biased *and* pausing.
- **`jmap -dump:live`** when you truly need the heap; drain first; or `gcore` + `jhsdb`/MAT offline.
- **Actuator:** `threaddump`, `heapdump`, `metrics`, `prometheus`, `loggers`, `startup`, `env`, `configprops` — allowlist explicitly, never `*`, `heapdump`/`env`/`jolokia` off the reachable surface (see [`senior.md`](senior.md)).
- **JMX** only over an authenticated, non-public channel; prefer Jolokia-over-HTTPS-behind-auth or just Micrometer.

```java
// On-demand async-profiler attach via the Actuator-secured plane, gated + audited.
// Returns a flame graph for ONE JVM; no safepoint bias; bounded duration.
@RestController
@RequestMapping("/manage/profile")
class ProfileController {
    private final AtomicBoolean running = new AtomicBoolean(false);

    @PostMapping("/cpu")
    @PreAuthorize("hasRole('OPERATOR')")
    ResponseEntity<byte[]> cpu(@RequestParam(defaultValue = "20") int seconds) throws Exception {
        if (seconds > 60) return ResponseEntity.badRequest().body("max 60s".getBytes());
        if (memoryHeadroomLow()) return ResponseEntity.status(503).body("brownout".getBytes());
        if (!running.compareAndSet(false, true))            // singleton gate
            return ResponseEntity.status(409).body("profile already running".getBytes());
        try {
            AsyncProfiler p = AsyncProfiler.getInstance();
            p.execute("start,event=cpu,flat=200");
            Thread.sleep(seconds * 1000L);
            String svg = p.execute("stop,flamegraph");      // no safepoint bias
            audit("cpu-profile", currentOperator(), seconds);
            return ResponseEntity.ok(svg.getBytes());
        } finally { running.set(false); }
    }
}
```

### Python

- **`py-spy`** is the headline: a *sampling, out-of-process* profiler that reads the target's memory via `/proc/<pid>/mem`. **Near-zero target overhead, no code changes, no restart, no in-process endpoint to abuse.** Needs `CAP_SYS_PTRACE`.
- **`py-spy dump <pid>`** prints every thread's stack from outside — the safe thread-dump equivalent.
- **`prometheus_client`** on its own loopback port for metrics (per [`senior.md`](senior.md)); no in-process profiling endpoint is needed *at all*, which is strictly more secure.
- **For continuous:** run `py-spy` in a sidecar emitting to Pyroscope, or use Pyroscope's Python eBPF support.
- **`tracemalloc`** for allocation tracking is in-process and costly; gate it as a self-reverting toggle for leak hunts only.

```bash
# Python production profiling done right: out-of-process, zero target overhead.
py-spy record -o flame.svg --pid 4242 --duration 30        # CPU flame graph
py-spy dump --pid 4242                                      # all-thread stack dump
# Continuous: py-spy in a sidecar, --format speedscope|pprof → Pyroscope.
```

### Rust

- **`pprof-rs`** (in-process, SIGPROF sampling) for on-demand CPU profiles emitting pprof protobuf — mount the handler on the gated admin router (per [`senior.md`](senior.md)).
- **`tokio-console`** for async runtime introspection: task counts, poll times, busy/idle, where tasks are stuck. It's an *always-paying* tax (the `console-subscriber` instruments every task), so enable it deliberately — excellent for diagnosing stuck async work, not free.
- **eBPF profiles Rust well** *if* built with frame pointers (`RUSTFLAGS="-C force-frame-pointers=yes"`) — a fleet build decision worth making.
- **No heap-dump story** like the JVM's; for leaks, use a continuous allocation profiler (`jemalloc`'s profiling via `MALLOC_CONF=prof:true` + `jeprof`) or eBPF alloc profiling.

```rust
// Rust admin router: pprof-rs CPU profile, gated + bounded + singleton. (Auth layer
// per senior.md.) Emits pprof protobuf the fleet collector understands.
async fn pprof_profile(State(st): State<Admin>) -> Result<Vec<u8>, StatusCode> {
    if st.cpu_util() > 0.85 { return Err(StatusCode::SERVICE_UNAVAILABLE); } // brownout
    let _g = st.profile_lock.try_lock().map_err(|_| StatusCode::CONFLICT)?;  // singleton
    let guard = pprof::ProfilerGuardBuilder::default()
        .frequency(100)
        .blocklist(&["libc", "libpthread"])
        .build().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    tokio::time::sleep(Duration::from_secs(20)).await;       // bounded window
    let report = guard.report().build().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut buf = Vec::new();
    report.pprof().unwrap().write_to_vec(&mut buf).unwrap(); // fleet-standard format
    st.audit("cpu-profile", /* operator */);
    Ok(buf)
}
```

### Node.js

- **`--inspect=127.0.0.1:9229` ONLY** — public inspector is RCE (per [`senior.md`](senior.md)). Reach via `kubectl port-forward`. A startup assertion should refuse a non-loopback inspector bind outside dev.
- **`v8.writeHeapSnapshot()`** can transiently ~double live memory → self-OOM risk; drain first, or use `--heapsnapshot-near-heap-limit=1` to capture *as* it approaches the limit (kernel does the heavy lifting at the cliff).
- **`clinic` (doctor/flame/bubbleprof)** and `0x` for flame graphs — attach perturbs, so single-target, bounded.
- **`--cpu-prof` / `--heap-prof`** flags write profiles to disk on exit — useful for short-lived processes, not live hot ones.
- **Continuous:** Pyroscope's Node SDK, or eBPF (Node's JIT makes eBPF unwinding harder; frame-pointer / `--perf-basic-prof` helps the kernel map JIT frames).

```js
// Node: inspector loopback-only, asserted at boot. Heap snapshot drains first.
const inspector = require("node:inspector");
const url = inspector.url?.() ?? "";
if (process.env.NODE_ENV === "production" && url && !url.includes("127.0.0.1")) {
  console.error("FATAL: inspector bound non-loopback in prod");
  process.exit(1);
}
adminApp.post("/admin/heapsnapshot", requireOperator, async (req, res) => {
  setReady(false);                       // drain THIS replica before the costly snapshot
  await waitForEndpointPropagation();
  const v8 = require("node:v8");
  const stream = v8.getHeapSnapshot();   // stream — don't buffer the whole snapshot
  res.setHeader("content-type", "application/octet-stream");
  stream.pipe(res);                      // to an encrypted, gated artifact store ideally
});
```

---

## Code Examples

### Go — the fleet expensive-op guard with fleet-wide concurrency cap

```go
// senior.md gave the per-process singleton + brownout. The FLEET escalation:
// cap the number of profiles running across the WHOLE service at once, via a
// shared token store, so the collection plane can't fan a profile out to all
// replicas and double everyone's overhead during an incident.
type FleetGuard struct {
    local    atomic.Bool   // per-process singleton (from senior.md)
    tokens   TokenStore     // e.g. Redis: SET diag:profile:<svc> NX EX 60 with a cap
    maxFleet int            // e.g. 3 concurrent profiles across the whole service
}

func (g *FleetGuard) Acquire(ctx context.Context, svc, instance string) (release func(), err error) {
    if currentCPUUtil() > 0.85 {
        return nil, errors.New("brownout: box under load")        // self-protection
    }
    if !g.local.CompareAndSwap(false, true) {
        return nil, errors.New("a profile is already running on this instance")
    }
    // Fleet cap: atomically claim one of maxFleet slots, TTL-bounded so a crashed
    // profiler can't leak a slot forever.
    ok, err := g.tokens.ClaimSlot(ctx, "diag:profile:"+svc, g.maxFleet, 60*time.Second)
    if err != nil || !ok {
        g.local.Store(false)
        return nil, errors.New("fleet profile concurrency cap reached")
    }
    return func() {
        g.tokens.ReleaseSlot(context.Background(), "diag:profile:"+svc, instance)
        g.local.Store(false)
    }, nil
}
```

### Go — `/debug/state` returning a fleet-versioned, schema'd snapshot

```go
// One schema, every service. Tooling parses StateV1 uniformly across the fleet.
type StateV1 struct {
    Schema       string            `json:"schema"`        // "state/v1" — versioned contract
    Service      string            `json:"service"`
    InstanceID   string            `json:"instance_id"`
    BuildSHA     string            `json:"build_sha"`     // -ldflags injected
    StartedAt    time.Time         `json:"started_at"`
    Goroutines   int               `json:"goroutines"`
    HeapInUse    uint64            `json:"heap_inuse_bytes"`
    GCPauseP99Ms float64           `json:"gc_pause_p99_ms"`
    Readiness    string            `json:"readiness"`     // ready|unready(reason)
    QueueDepths  map[string]int    `json:"queue_depths"`
    Deps         map[string]string `json:"deps"`          // dep -> up|degraded|down
}

func (ad *Admin) state(w http.ResponseWriter, r *http.Request) {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    s := StateV1{
        Schema: "state/v1", Service: ad.svc, InstanceID: ad.id, BuildSHA: buildSHA,
        StartedAt: ad.startedAt, Goroutines: runtime.NumGoroutine(),
        HeapInUse: m.HeapInuse, Readiness: ad.rd.Describe(),
        QueueDepths: ad.app.QueueDepths(), Deps: ad.app.DepStates(),
    }
    w.Header().Set("content-type", "application/json")
    _ = json.NewEncoder(w).Encode(s)   // O(1)-ish, no I/O, safe under load
}
```

### Go — out-of-process core dump capture (no in-process allocation)

```go
// When you need full memory state on a Go process WITHOUT asking it to serialize
// itself (which allocates), snapshot from outside via the kernel, then analyze
// offline with delve. The target does ~no work beyond being paused by ptrace.
func captureCore(ctx context.Context, pid int, outDir string) error {
    // Throttle the I/O so the core write doesn't thrash page cache on a hot host.
    cmd := exec.CommandContext(ctx, "ionice", "-c2", "-n7", "gcore", "-o",
        filepath.Join(outDir, "core"), strconv.Itoa(pid))
    if out, err := cmd.CombinedOutput(); err != nil {
        return fmt.Errorf("gcore: %v: %s", err, out)
    }
    // Analyze offline:  dlv core ./binary ./core.<pid>
    //   (lis goroutines, heap, locals — no risk to the live process)
    return nil
}
```

### Kubernetes — ephemeral debug container (tools without baking them into the image)

```bash
# Profile/dump a running pod WITHOUT shipping py-spy/delve/gcore in the app image.
# The ephemeral container shares the target's PID namespace; the app image stays minimal.
kubectl debug -it payments-7c9f \
  --image=ghcr.io/myorg/diag-tools:latest \
  --target=payments \
  --profile=general -- \
  py-spy record -o /tmp/flame.svg --pid 1 --duration 30
# The diag-tools image carries py-spy, delve, async-profiler, bpftrace, gcore.
# Authz: kubectl debug is RBAC-gated; tie it to JIT incident-scoped access.
```

### Java — JFR continuous + on-demand dump-to-object-store

```java
// Always-on JFR (launch flag) PLUS an on-demand "dump current recording" that
// streams to object storage rather than buffering a multi-GB file in heap.
@Component
class FlightRecorderDump {
    @PreAuthorize("hasRole('OPERATOR')")
    public String dumpToStore(String incidentId) throws Exception {
        Recording r = FlightRecorder.getFlightRecorder().getRecordings().stream()
            .filter(x -> "continuous".equals(x.getName())).findFirst().orElseThrow();
        Path tmp = Files.createTempFile("jfr-", ".jfr");
        r.dump(tmp);                                  // bounded by maxsize/maxage from launch
        String key = "diag/jfr/" + incidentId + "/" + Instant.now() + ".jfr";
        objectStore.putEncrypted(key, tmp);           // encrypt at rest; gate download
        audit.log("jfr-dump", currentOperator(), incidentId, key);
        Files.deleteIfExists(tmp);
        return key;
    }
}
```

---

## Failure Stories

**1. The fleet profile that became the incident.** During a latency investigation, an engineer ran a "profile every replica" script over all 600 instances of a service simultaneously to "get the full picture." Each `/profile` added ~3% CPU; the fleet was already at 80% utilization chasing the latency bug. The synchronized 3% pushed dozens of replicas past their CPU limits, throttling kicked in, latency *doubled*, and the readiness probes (sharing the now-saturated CPU) started timing out — pods began ejecting. The diagnostic action caused a worse outage than the bug. **Fix:** a fleet concurrency cap (≤3 profiles across the service) enforced by the admin-plane library; the "profile the fleet" script was deleted in favor of querying the continuous profiler, which already had the data at sub-1% steady overhead.

**2. The heap dump that OOM-killed three pods in a row.** A memory leak was suspected. An operator hit `/actuator/heapdump` on the most-pressured pod (94% of limit). The dump allocation OOM-killed it. Kubernetes rescheduled the load onto the *next* pod, which rose to 94%, the operator dumped *it*, and it died too. Three pods lost, zero dumps captured, leak undiagnosed, and a brief capacity dip. **Fix:** the heapdump endpoint now refuses (`503`) below a memory-headroom threshold (brownout), the runbook mandates drain-first, and chronic-leak diagnosis moved to JFR `OldObjectSample` continuous recording — which had the leak's allocation site recorded all along.

**3. The compromised CI token that profiled the world.** A leaked CI service-account token had been granted (over-broadly) the collection plane's `profile` permission "for the perf-test pipeline." An attacker who found it in a build log used it to fan a continuous high-rate profile out across the entire fleet — a profile-guided DoS using the org's own legitimate tooling. **Fix:** the collection plane's fan-out is now capped *by the control plane itself* (no single grant can profile more than N instances per minute), profile/dump grants are JIT and incident-scoped rather than standing, and an alert fires on anomalous fan-out scale (which would have caught it in seconds).

**4. The `goroutine?debug=2` that paused the leader.** A service had a goroutine leak (~1.2M goroutines). An engineer pulled `?debug=2` on the leader replica to see the stacks. The stop-the-world walk of 1.2M goroutines took ~900ms; the leader missed its lease renewal, lost leadership mid-operation, and triggered a failover storm. **Fix:** the admin-plane library defaults goroutine dumps to `debug=1` (aggregated counts, no full walk), which immediately showed "1.18M goroutines blocked at `outbound.go:204`" — enough to find the leak without the pause. `debug=2` is now gated and warns about STW cost.

**5. The "loopback is safe" sidecar compromise.** A team reasoned that since the admin plane was bound to `127.0.0.1`, it needed no auth. A vulnerability in a *logging sidecar* in the same pod gave an attacker code execution in that sidecar — which could reach the app's loopback admin plane and pull `/debug/pprof/heap`, exfiltrating secrets from the app's memory. **Fix:** loopback is treated as defense-in-depth, *not* a security boundary; the admin plane now requires workload-identity mTLS even on loopback, enforced by the mesh, so a same-pod neighbor without the right SPIFFE identity is denied.

**6. The frame-pointer-less fleet that couldn't be profiled.** A team adopted Parca for continuous profiling, but their C++ and old-JVM services were built with frame pointers omitted; the eBPF unwinder produced broken, truncated stacks — useless flame graphs exactly where they were most needed. **Fix:** a fleet-wide build-flag change (`-fno-omit-frame-pointer`, JVM `-XX:+PreserveFramePointer`) for ~1% runtime cost, plus Parca's DWARF-CFI BPF unwinder for binaries that couldn't be rebuilt. Profiling coverage went from partial to fleet-complete.

---

## A Worked "Profile the Fleet Safely" Runbook

A staff-authored runbook so the 3am operator does the safe thing by default. The scenario: *"`checkout` p99 is elevated fleet-wide; we suspect CPU. Find the hot path without causing a second incident."*

**Step 0 — Try the data you already have (always first).**
```text
1. Open the continuous-profiling UI (Parca/Pyroscope) for service=checkout.
2. Select the time range of the regression. Diff against a healthy window.
3. 90% of the time, the flame-graph diff shows the new hot frame. STOP HERE.
   No live pull, no perturbation, no risk. The data was collected at <1% overhead.
```

**Step 1 — If continuous data is insufficient (gap in coverage / need a live moment).**
```bash
# Pick ONE representative replica. Do NOT loop the fleet.
POD=$(kubectl get pods -l app=checkout -o name | head -1)

# JIT-elevate for this incident; the grant is scoped + time-boxed + audited.
diagctl elevate --action profile --service checkout --incident INC-2026-06-11-003 --ttl 1h

# eBPF first (zero target overhead) if the runtime unwinds:
kubectl debug -it "$POD" --image=diag-tools --target=checkout --profile=general -- \
  perf record -F 99 -p 1 -g -- sleep 20
```

**Step 2 — In-process pull only if eBPF can't unwind this runtime.**
```bash
# Port-forward the loopback admin plane of the ONE pod. The library's guard enforces
# singleton + brownout + max-duration + fleet-cap; you cannot exceed them.
kubectl port-forward "$POD" 9090:9090 &
go tool pprof -http=:0 'http://localhost:9090/debug/pprof/profile?seconds=20'
# 20s, one pod, loopback, gated, audited. Latency blip contained to one replica.
```

**Step 3 — If you need a heap/full-state capture (the dangerous one).**
```text
1. Confirm memory headroom on the chosen replica (>2× dump size free on the volume).
2. Set readiness=false on that replica; wait out endpoint propagation (~15s).
3. Capture from OUTSIDE the process:  kubectl debug ... -- gcore -o /tmp/core 1
   (or jmap -dump:live on a drained JVM; or py-spy dump on Python).
4. Stream the artifact to the ENCRYPTED, gated diag store. Never to a chat paste.
5. Analyze offline (delve / MAT / jhsdb). The live fleet is untouched.
```

**Step 4 — Close out.**
```text
1. JIT grant auto-revokes; confirm the audit record landed.
2. If you reached for an on-demand pull, file a ticket: WHY did continuous
   profiling not answer this? Close the coverage gap so next time is Step 0.
```

The runbook's whole design philosophy: **make Step 0 succeed almost always, make every later step safe-by-construction, and treat reaching the dangerous steps as a signal to improve the always-on coverage.**

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| Fleet diagnostic contract (one surface everywhere) | Tooling/authz/audit work everywhere; one model to secure | Upfront platform investment; migrating legacy services is a campaign |
| Shared admin-plane library / sidecar | Correct-by-default; the careless team is protected | A bug in the library is a fleet bug; some teams resent the constraint |
| eBPF continuous profiling | ~0 app work, fleet coverage, no endpoint to abuse, retroactive queries | Needs frame pointers or DWARF unwinder; privileged agent; symbolization infra |
| Continuous over on-demand | Data already there; no incident-time perturbation; diffable | Storage + ingestion cost; coverage gaps force fallback to risky pulls |
| Out-of-process capture (`gcore`/py-spy) | Target does ~no work; no self-OOM from serialization | I/O cost of core write; offline analysis tooling needed; ptrace caps |
| Workload-identity + JIT authz | No standing fleet-exfil capability; revocable; per-action audit | SPIRE/OPA/mesh complexity; break-glass must be built and tested |
| Fleet concurrency cap on profiles | Can't fan a profile into a self-DoS | An operator may be capped during the exact incident they need it |
| Fan-out as an authz dimension | Compromised account can't weaponize the control plane | More authz surface; a large legit profiling job needs elevation |

---

## Use Cases

- **A fleet of thousands of polyglot services with no uniform introspection.** Define and enforce the diagnostic contract; ship the shared library; lint + admission-gate to compliance.
- **"Profile any service, retroactively, without touching it."** Deploy eBPF continuous profiling (Parca/Pyroscope) as a DaemonSet; query stored profiles instead of pulling live.
- **A leak you must diagnose without OOMing the pod.** Continuous in-use-space / JFR `OldObjectSample` first; `gcore`/`jmap -dump:live` on a drained replica only as last resort.
- **Standing fleet-exfiltration risk from operator access.** Move heap-dump and fleet-profile to JIT, incident-scoped, audited grants; remove standing privilege.
- **The diagnostic control plane is a juicy target.** Cap its fan-out, least-privilege it, alarm on anomalous diagnostic activity as an intrusion signal.
- **A diagnostic action caused an outage.** Enforce singleton + brownout + max-duration + fleet-cap *in the platform*, not in per-team code; default to continuous data.
- **Minimal app images but rich on-demand tooling.** Ephemeral debug containers (`kubectl debug`) carry the toolchain; RBAC + JIT gate them.

---

## Coding Patterns

### Pattern: conformance self-check at boot (fail closed)

```go
// The service refuses to start if its diagnostic surface violates the fleet contract.
func (a *Admin) MustStartConformant() {
    if a.bindAddr == "0.0.0.0:9090" { panic("admin plane must not bind 0.0.0.0") }
    if usesDefaultServeMux() { panic("pprof must not be on DefaultServeMux") }
    if a.auth == nil { panic("admin plane requires operator auth") }
    if !a.guardsExpensiveOps() { panic("expensive endpoints must be guarded") }
    go a.server(a.bindAddr).ListenAndServe()
}
```

### Pattern: brownout before any expensive diagnostic

```go
if memHeadroom() < dumpSizeEstimate()*2 || cpuUtil() > 0.85 {
    return http.StatusServiceUnavailable // refuse: collection would harm the patient
}
```

### Pattern: capture from outside the process

```bash
gcore -o /tmp/core <pid>     # kernel snapshots; target does ~no work; analyze offline
py-spy dump --pid <pid>      # stacks without target cooperation
```

### Pattern: fleet concurrency cap via shared token

```go
ok, _ := tokens.ClaimSlot(ctx, "diag:profile:"+svc, maxFleet, ttl) // bounded fleet-wide
if !ok { return errFleetCapReached }
```

### Pattern: deferred symbolization

```text
agent records raw addr + build-id → store → resolve symbols later from debuginfod
(no debug symbols shipped to prod; collection stays cheap)
```

### Pattern: JIT-scoped privileged action

```bash
diagctl elevate --action dump --service payments --incident INC-... --ttl 1h
# grant auto-revokes; every use audited with the incident id
```

---

## Clean Code

- **One diagnostic surface, fleet-wide, enforced by a shared library + CI lint + admission control.** Local cleverness loses to fleet uniformity.
- **The dangerous bits are owned by the platform, not per-team code.** Singleton, brownout, max-duration, fleet-cap, audit, auth — inherited, not reimplemented.
- **Routine profiling is always-on and out-of-process.** eBPF or in-process sampler → Parca/Pyroscope; the on-demand endpoint is the gated exception.
- **No diagnostic ever serializes a pressured process into its own heap.** Capture from outside (`gcore`, `py-spy`) or use sampled/live-only variants; brownout-refuse when headroom is low.
- **Goroutine/thread dumps aggregate first** (`debug=1`); full STW walks are gated and warned.
- **The admin plane authenticates via workload identity even on loopback.** Loopback is defense-in-depth, never the boundary.
- **Privileged diagnostics are JIT, incident-scoped, fan-out-capped, and audited.** No standing fleet-exfiltration capability.
- **Dump artifacts are encrypted at rest and download-gated.** A heap dump is the most sensitive object the service produces.
- **The collection/control plane is least-privileged, internet-isolated, and alarmed on anomalous activity.** It is the loaded weapon; treat it so.
- **A boot self-check fails the process closed** if its surface is off-contract.

---

## Best Practices

1. **Define the diagnostic surface as a versioned fleet contract** (ports, paths, formats, auth, limits, audit) and enforce it with a shared library, CI lint, and admission control — track compliance to zero off-contract services.
2. **Default to always-on, out-of-process, fleet-aggregated profiling** (eBPF/Parca/Pyroscope, JFR). Query stored profiles before ever pulling live.
3. **Treat the on-demand pull as the scalpel, not the tool.** Bound, singleton-gate, brownout, *and* fleet-concurrency-cap every expensive endpoint — in the platform, not per team.
4. **Never let a diagnostic serialize a pressured process into its own memory.** Capture from outside (`gcore`, `py-spy`, ephemeral debug container); prefer sampled / live-only variants; brownout-refuse on low headroom; drain-first for heap dumps.
5. **Aggregate goroutine/thread dumps first** (`debug=1`); gate and warn on full STW walks.
6. **Authorize the admin plane as a privileged-action API:** workload identity (SPIFFE/IAM/mTLS), RBAC/ABAC, JIT incident-scoped elevation, break-glass, per-action audit.
7. **Make fan-out scale a first-class authz dimension.** Default caps small; profiling a large fraction needs separate, audited elevation.
8. **Compile the fleet with frame pointers** (`-fno-omit-frame-pointer`, `-XX:+PreserveFramePointer`, `force-frame-pointers`) so eBPF unwinds cheaply and reliably; ship DWARF-CFI unwinding for the rest.
9. **Secure the collection/control plane harder than anything else** — least privilege, internet-isolated, fan-out-rate-limited, and monitored as an intrusion signal.
10. **Treat dump artifacts as sensitive data at rest** — encrypted, download-gated, retention-bounded; a heap dump is full memory exfiltration even after you collected it legitimately.

---

## Edge Cases & Pitfalls

- **Profiling the whole fleet at once during an incident.** Synchronized overhead on already-hot boxes is a self-inflicted second outage. Cap fan-out; query continuous data instead.
- **Heap dump on a pressured pod.** The serialization allocation OOM-kills the patient. Brownout-refuse; drain-first; capture from outside.
- **`goroutine?debug=2` on a million-G process.** The STW walk is itself the longest pause of the incident — and can lose a leader lease. Aggregate with `debug=1`.
- **Frame pointers omitted fleet-wide.** eBPF flame graphs are truncated garbage exactly where you need them. Build with frame pointers; ship a DWARF unwinder for the rest.
- **`jstack`-loop "profiling."** Safepoint-biased (misleading) *and* pausing. Use async-profiler / JFR.
- **Standing access to fleet dump/profile.** Every operator account becomes a fleet-exfiltration risk. Make it JIT and incident-scoped.
- **Loopback treated as a security boundary.** A compromised same-pod sidecar reaches loopback. Require workload-identity mTLS even there.
- **The control plane over-privileged.** A stolen control-plane identity is a fleet-wide DoS/exfil button. Cap fan-out *in the control plane*; alarm on anomalies.
- **Buffering a multi-GB dump into an HTTP response.** Doubles the memory cost and can OOM. Stream to an encrypted object store.
- **Continuous-profiling coverage gaps** silently push operators back to dangerous on-demand pulls. Track coverage; treat a live pull as a ticket to close the gap.
- **Symbols shipped to prod** to make profiling work. Defer symbolization to `debuginfod`; keep prod binaries stripped.
- **JFR / py-spy / async-profiler tools baked into every app image.** Bloated, larger attack surface. Use ephemeral debug containers instead.

---

## Common Mistakes

1. **"Profile the whole fleet to get the full picture."** Synchronized overhead = second outage. Query continuous data; cap fan-out.
2. **Heap dump first, drain never, headroom unchecked.** OOMs the patient and loses the evidence. Capture from outside, drained, with headroom.
3. **Per-team admin planes.** N subtly-different attack surfaces and auth models; no tooling works everywhere. Standardize via a shared library + admission control.
4. **On-demand pulls as the default profiling tool.** Dangerous, perturbing, and unnecessary if you have continuous profiling. Make always-on the default.
5. **Standing fleet dump/profile access.** A latent mass-exfiltration capability on every operator account. JIT-scope it.
6. **Loopback = "no auth needed."** A same-pod compromise walks right in. Workload identity even on loopback.
7. **`?debug=2` on a huge-goroutine process.** STW pause, possibly a lost lease. Aggregate first.
8. **Frame-pointer-less builds + eBPF profiler.** Broken stacks; the profiler is useless. Build with frame pointers.
9. **An over-privileged, internet-reachable control plane.** The single most dangerous box in the fleet, left soft. Least-privilege, isolate, alarm.
10. **Treating a collected heap dump as a transient file.** It's full memory; secrets and PII live in it. Encrypt, gate, expire.

---

## Tricky Points

- **The safest profiler is the one with no endpoint.** Moving routine CPU profiling to an out-of-process eBPF agent *removes* the attack surface rather than guarding it — a property no amount of auth on `/debug/pprof/profile` can match.
- **Continuous profiling is, adversarially, a legitimate fleet-wide memory-exfil + DoS tool.** The entire authz/cap/audit apparatus exists because the capability is genuinely that powerful — not bureaucratic caution.
- **The cost of a dump is highest exactly when you want it.** You pull because the process is pressured, and the pull's allocation is what kills it. Capture from outside.
- **`debug=1` beats `debug=2` almost always.** Aggregated goroutine counts answer "where's the leak?" without the STW walk that `debug=2` pays.
- **A fan-out cap is an authz control, not a rate limit.** "May profile" and "may profile 3,000 at once" are different grants; conflating them is how a fat-finger becomes a fleet outage.
- **Frame pointers are a ~1% tax that pays for fleet-wide profilability.** A staff-level build decision most teams never think to make until eBPF flame graphs come back truncated.
- **JIT access removes a *standing* risk, not an *acute* one.** It doesn't make the dump safer to run; it makes the *capability to run it* not exist by default.
- **Loopback reduces, never eliminates, the boundary.** Same-pod and stolen-kubeconfig paths reach it; workload identity is what actually authorizes.
- **Deferred symbolization keeps prod stripped *and* profilable.** You don't trade security (debug symbols in prod) for observability — `debuginfod` gives both.

---

## Anti-Patterns at Professional Level

1. **The fleet "profile everything" button** with no fan-out cap. One fat-finger or one stolen credential = fleet-wide self-DoS. Cap the fan-out in the control plane.
2. **The artisanal admin plane.** Every team hand-rolls their "best" diagnostic surface. The fleet becomes unprofileable, unauditable, and insecure. Standardize.
3. **Heap-dump-driven leak hunting.** Reaching for a stop-the-world full dump as the *first* move on a pressured process. Use continuous allocation profiling; dump from outside, drained, as a last resort.
4. **"Loopback is our auth."** A same-pod sidecar compromise disproves it in one CVE. Workload identity everywhere.
5. **Standing god-mode diagnostics.** Every operator can dump any service's memory, forever, unaudited. Make it JIT, scoped, audited.
6. **The unguarded, internet-soft control plane.** The most powerful introspection tool in the org, left least-secured. It deserves the *most* hardening.
7. **On-demand-as-default.** Normalizing live, perturbing pulls because nobody built continuous coverage. Fix coverage; demote on-demand to exception.
8. **Symbols-in-prod for profilability.** Trading attack surface for flame graphs when `debuginfod` + deferred symbolization gives both.
9. **Tools baked into every image.** Bloated images and larger surface to ship py-spy/delve everywhere. Use ephemeral debug containers.
10. **Audit theater.** Logging diagnostic actions to a sink nobody monitors or alarms on. Anomalous diagnostic activity is an intrusion signal — alarm on it.

---

## Test Yourself

1. Your service has a memory leak and is at 93% of its memory limit. Walk through, step by step, how you capture enough memory state to diagnose it *without* OOM-killing the pod — naming the techniques and why each avoids the self-OOM.
2. Design the authorization model for a fleet diagnostic control plane. Cover identity, action authz, *fan-out scale*, time-boxing, audit, and break-glass — and explain why fan-out is a separate dimension.
3. You inherit 2,000 polyglot services with per-team admin planes. Lay out the campaign to migrate them all to one diagnostic contract, including the three enforcement layers and how you'd track progress.
4. Explain precisely why moving routine CPU profiling from `/debug/pprof/profile` to an eBPF agent *improves security*, and what fleet build decision that move depends on.
5. An operator wants to "profile the whole fleet" during a CPU-latency incident. Explain the failure mode of doing so, and give the safe alternative that gets the same insight.
6. Contrast `goroutine?debug=1` and `?debug=2` in both cost and what each answers. When is `debug=2` justified, and what must you do first?
7. Your continuous profiler returns truncated, useless stacks for the C++ and old-JVM services. Diagnose why and give the two fixes.
8. Why is a collected heap dump a sensitive data-at-rest object, and what controls does it require even after it was collected by an authorized operator?

---

## Tricky Questions

**Q1: Why is taking a heap dump often the *worst* first move on a process you suspect is leaking memory?**
Because a heap dump must serialize the entire live heap, and serialization *allocates* — buffers, encoder state, I/O queues. On a process already near its memory limit (which is exactly why you suspect a leak), that allocation tips it over the cgroup limit and the kernel OOM-killer reaps it mid-dump. You lose both the process and the evidence — strictly worse than not dumping. The professional path is to *not* ask the pressured process to serialize itself: use always-on sampled allocation profiling (Go in-use-space, JFR `OldObjectSample`) that already recorded the leak's shape, or capture from *outside* the process via `gcore` (kernel snapshots the address space; the target does ~no work) on a *drained* replica with verified headroom, then analyze offline.

**Q2: You have a fleet-wide profiling control plane. Why is it the most dangerous system in your infrastructure, and how do you secure it?**
Because it holds — or can mint — the capability to introspect *every service's memory* (full secret/PII exfiltration) and to add CPU/memory overhead to *every instance at once* (fleet-wide DoS). Adversarially, it is a legitimate, authorized mass-exfiltration-and-DoS tool. Securing it: run it least-privileged and internet-isolated (it can reach nothing outbound); make its own access JIT and break-glass-gated, never standing; cap the *fan-out* of any single command inside the control plane so a compromised operator account can't weaponize it; and monitor it — abnormal profile/dump rate or fan-out scale is an *intrusion signal* that should page security, not just log.

**Q3: An engineer profiles all 600 replicas simultaneously during a CPU-latency incident "to get the full picture." What happens, and what should they have done?**
Each `/profile` adds ~1–5% CPU. On an already-hot fleet, 600 synchronized profiles push replicas past their limits → CPU throttling → latency *increases* (the opposite of the goal) → readiness probes sharing the saturated CPU time out → pods eject → the diagnostic action becomes a worse outage than the bug. They should have queried the *continuous* profiler (Parca/Pyroscope), which already had every replica's CPU profile at <1% steady overhead, and diffed the regression window against a healthy one — zero incident-time perturbation. If continuous coverage had a gap, they should have profiled *one* representative replica through the fleet-capped, gated endpoint — and then filed a ticket to close the coverage gap.

**Q4: Why does moving CPU profiling from an in-process endpoint to an eBPF agent improve security, and what does it require?**
Because an endpoint that doesn't exist cannot be DoSed, leaked, RCE'd, or used to exfiltrate. The eBPF profiler samples stacks in-kernel, out-of-process, for every process on the host, with no application code, no SDK, no restart, and no HTTP surface to gate — it *removes* the attack surface instead of guarding it, at ~0.3–1% overhead. It requires reliable stack-walking: either the fleet is built with frame pointers (`-fno-omit-frame-pointer`, `-XX:+PreserveFramePointer`) so the `RBP` chain can be followed cheaply, or the agent ships a DWARF-CFI unwinder in BPF for binaries that omit them. Symbolization is deferred to `debuginfod`, so production binaries stay stripped.

**Q5: Is binding the admin plane to loopback and requiring nothing else acceptable at fleet scale? Why or why not?**
No. Loopback removes the *public network* path, but it is not a security boundary against same-pod compromise: a vulnerable sidecar (logging, mesh, metrics) running in the same pod can reach `127.0.0.1:9090` and pull `/debug/pprof/heap` to exfiltrate the app's secrets from memory. A stolen kubeconfig that can `port-forward` reaches it too. Loopback is defense-in-depth; the actual authorization must be workload identity (SPIFFE/SPIRE mTLS, or cloud IAM) enforced by the mesh, so a neighbor without the right cryptographic identity is denied even from inside the pod.

**Q6: How do you let thousands of teams introspect their services without each team building (and mis-securing) its own admin plane?**
Make the safe surface the default and the easy one: ship a shared admin-plane library/starter per language that mounts the fleet-standard ports, paths, auth, and (non-optional) expensive-op guards correctly by construction — a team gets the right surface by importing it. Catch the forgetful with a CI conformance lint (fails on `exposure.include=*`, pprof on `DefaultServeMux`, non-loopback `--inspect`, I/O in readiness). Catch the non-compliant with admission control / mesh policy that rejects off-contract surfaces at deploy time. Track a fleet "diagnostic-surface compliance" metric to zero off-contract services. The constraint is the feature: uniformity is what makes the fleet operable, auditable, and securable.

**Q7: Why is "fan-out scale" a distinct authorization dimension, separate from "may this principal perform this action"?**
Because the *same* action authorized on one instance is catastrophic when authorized on all of them. A control plane that can profile one replica with one API call can profile 3,000 with the identical call; "may profile checkout" and "may profile 3,000 checkout instances simultaneously" are mechanically different blast radii. If authz only gates the verb, a fat-finger or a compromised account turns a routine grant into a fleet-wide self-DoS or mass exfiltration. So the default fan-out cap must be small (one instance, or a single-digit sample), and profiling a large fraction must require a separate, individually-audited elevation — making the dangerous-scale action a deliberate, visible act rather than an accident.

**Q8: When is an on-demand, in-process profile pull still the right tool at professional scale?**
When the always-on, out-of-process path genuinely can't answer the question: a runtime the eBPF agent can't unwind reliably; a profile type continuous profiling doesn't capture (some contention/heap-graph cases); or a need for *this exact live moment* rather than a sample. Even then it's single-target (one replica), bounded, singleton- and fleet-cap-gated, brownout-aware, JIT-authorized, and audited — and reaching for it is itself a signal that continuous coverage has a gap worth closing. It is the scalpel for the rare case, never the everyday instrument.

---

## Cheat Sheet

```text
┌────────────────── DIAGNOSTIC ENDPOINTS — PROFESSIONAL CHEAT SHEET ──────────────────┐
│                                                                                      │
│  DEFAULT POSTURE                                                                     │
│    always-on > on-demand · out-of-process > in-process · query stored > pull live    │
│    eBPF/Parca/Pyroscope/JFR cover routine profiling at <1% — NO endpoint to abuse    │
│                                                                                      │
│  DUMPS WITHOUT SELF-OOM                                                              │
│    drain replica → check headroom → capture from OUTSIDE (gcore / py-spy / jmap live)│
│    brownout-refuse on low headroom · stream to encrypted store, never into heap      │
│    goroutine debug=1 (counts) BEFORE debug=2 (STW walk) — debug=2 can lose a lease   │
│                                                                                      │
│  FLEET CONTRACT (one surface everywhere)                                             │
│    shared library (correct-by-default) + CI lint + admission/mesh policy             │
│    fixed port/paths/format/auth/limits/audit · boot self-check fails CLOSED           │
│                                                                                      │
│  AUTHZ = PRIVILEGED-ACTION API                                                       │
│    workload identity (SPIFFE/IAM/mTLS) · RBAC/ABAC · JIT incident-scoped · audit     │
│    FAN-OUT is its own grant: "may profile" ≠ "may profile 3,000 at once"             │
│    loopback = defense-in-depth, NOT the boundary                                     │
│                                                                                      │
│  ABUSE / DoS                                                                         │
│    profile loop → CPU DoS · heapdump → mass exfil · fan-out → fleet self-DoS          │
│    controls: max-dur clamp · singleton · FLEET-cap · brownout · authz · audit/alarm  │
│    the CONTROL PLANE is the most dangerous box — least-priv, isolate, alarm          │
│                                                                                      │
│  eBPF PREREQ                                                                         │
│    frame pointers fleet-wide (-fno-omit-frame-pointer / -XX:+PreserveFramePointer)    │
│    OR DWARF-CFI unwinder in BPF · symbolization DEFERRED to debuginfod (prod stripped)│
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- **The diagnostic surface is a fleet contract, not a per-service feature.** One port, one path set, one format, one auth model, one limit policy — enforced by a shared library, CI lint, and admission/mesh policy, tracked to zero off-contract services. Local correctness loses to fleet uniformity.
- **Default to always-on, out-of-process, fleet-aggregated profiling** (eBPF/Parca/Pyroscope/JFR). It covers routine profiling at sub-1% overhead, is queryable retroactively, and — crucially — *has no endpoint to abuse*. The on-demand in-process pull is the gated scalpel for the rare case the always-on data can't answer.
- **Never let a diagnostic serialize a pressured process into its own memory.** The heap dump that OOM-kills the patient is the signature professional failure. Drain first, verify headroom, capture from *outside* the process (`gcore`, `py-spy`, ephemeral debug container), prefer sampled/live-only variants, and aggregate goroutine dumps (`debug=1`) before paying the STW walk.
- **Authorize the admin plane as a privileged-action API:** workload identity, RBAC/ABAC, JIT incident-scoped elevation, break-glass, per-action audit — and make *fan-out scale* a first-class authz dimension, because "may profile" and "may profile the whole fleet at once" are different blast radii.
- **Model the diagnostic plane as a systemic attack surface.** Each capability is a weapon that scales with you; the control plane that can profile/dump the fleet is, adversarially, a legitimate mass-exfiltration-and-DoS tool. Cap its fan-out, least-privilege and isolate it, encrypt and gate dump artifacts, and alarm on anomalous diagnostic activity as an intrusion signal.
- **Build the fleet for profilability:** frame pointers everywhere (a ~1% tax) so eBPF unwinds cheaply, DWARF-CFI for the rest, and deferred symbolization so production stays stripped *and* profilable.

The senior engineer makes one service's diagnostic surface safe. The staff/principal engineer makes the *fleet's* diagnostic surface safe *by construction* — so that the safe path is the only path, the data is already there before the incident, and no operator, attacker, or script can turn introspection into the outage.

---

## What You Can Build

- A **fleet diagnostic-surface conformance suite**: a CI lint + admission webhook + mesh `AuthorizationPolicy` set that enforces port/path/format/auth/limit/audit uniformly and fails non-compliant services at build and deploy time, with a live compliance dashboard.
- A **shared admin-plane library** (per language, one spec) that mounts the contract correctly by default, owns the singleton/brownout/max-duration/fleet-cap/audit wrappers, exposes a versioned `/debug/state`, and self-checks at boot — failing closed if off-contract.
- A **continuous-profiling rollout**: Parca/Pyroscope eBPF DaemonSet + per-runtime in-process fallbacks (JFR, Pyroscope SDK), a fleet frame-pointer build change, deferred symbolization via `debuginfod`, and a coverage SLO that turns every on-demand pull into a gap-closing ticket.
- A **safe-dump toolkit**: a `diagctl` that drains a replica, verifies headroom, captures from outside the process (`gcore`/`jmap -dump:live`/`py-spy`), streams the artifact to an encrypted, download-gated, retention-bounded store, and writes an audit record — turning "dump prod memory safely" into one command.
- A **diagnostic authz plane**: workload-identity (SPIRE) + OPA/RBAC for the admin plane, JIT incident-scoped elevation tied to incident IDs, a break-glass path, a fan-out cap enforced in the control plane, and anomaly alerts on diagnostic activity.
- A **"profile the fleet safely" runbook + tool** that tries continuous data first, falls back to one capped single-target pull, and never offers the dangerous fleet-wide option — the runbook in this page, codified.

---

## Further Reading

- Parca — eBPF continuous profiling, deferred symbolization, DWARF-in-BPF unwinding: <https://www.parca.dev/docs/>
- Grafana Pyroscope — continuous profiling (eBPF + SDKs), pprof ingestion: <https://grafana.com/docs/pyroscope/>
- Google — *Google-Wide Profiling: A Continuous Profiling Infrastructure for Data Centers* (Ren et al., 2010): <https://research.google/pubs/pub36575/>
- Brendan Gregg — *Systems Performance* (2nd ed.) and *BPF Performance Tools* — `perf`, eBPF, flame graphs, frame pointers.
- async-profiler — safepoint-bias-free JVM profiling (`AsyncGetCallTrace`): <https://github.com/async-profiler/async-profiler>
- JDK Flight Recorder (JFR) — always-on JVM event recording, `OldObjectSample`: <https://docs.oracle.com/en/java/javase/jfr/>
- `py-spy` — out-of-process sampling profiler for Python: <https://github.com/benfred/py-spy>
- `pprof-rs` and `tokio-console` — Rust profiling and async runtime introspection: <https://github.com/tikv/pprof-rs> · <https://github.com/tokio-rs/console>
- SPIFFE / SPIRE — workload identity for service-to-service (and operator-to-service) authz: <https://spiffe.io/>
- Open Policy Agent / Gatekeeper — admission-control policy as code: <https://www.openpolicyagent.org/>
- Kubernetes — Ephemeral Containers and `kubectl debug`: <https://kubernetes.io/docs/tasks/debug/debug-application/debug-running-pod/>
- The "frame pointers" debate — Brendan Gregg, *The Return of the Frame Pointers*: <https://www.brendangregg.com/blog/2024-03-17/the-return-of-the-frame-pointers.html>

---

## Related Topics

- [`senior.md`](senior.md) — the admin plane as a boundary, fail-static readiness, the cascade, basic singleton-gated profiles, the drain race, the dual-use security table. **This page assumes all of it.**
- [`middle.md`](middle.md) — dependency-in-check matrix, no-I/O probes, private mux, probe parameters, log toggles, on-demand dumps.
- [`junior.md`](junior.md) — the starter endpoints and the liveness/readiness distinction.
- [`README.md`](README.md) — the diagnostic-endpoints roadmap.
- [`../continuous-profiling/README.md`](../continuous-profiling/README.md) — the deep version of "always-on, fleet-aggregated profiling" this page leans on.
- [`../dynamic-instrumentation-and-ebpf/README.md`](../dynamic-instrumentation-and-ebpf/README.md) — eBPF, `bpftrace`, out-of-process stack-walking and unwinding in depth.
- [`../crash-reporting/README.md`](../crash-reporting/README.md) — core dumps at crash time, the offline-analysis side of `gcore`.
- [`../post-mortem-analysis/README.md`](../post-mortem-analysis/README.md) — analyzing cores, heap dumps, and JFR recordings after the fact.
- [`../debugging/professional.md`](../debugging/professional.md) — debugging as an organizational capability; runbooks, observability-as-design, building debuggability in.
- [`../debugging/senior.md`](../debugging/senior.md) — production diagnosis without stopping the world; the observer effect; profiler/dump costs.
- [`../telemetry-cost-and-sampling-strategy/README.md`](../telemetry-cost-and-sampling-strategy/README.md) — the cost/DoS dimension of always-on diagnostics and log-toggle floods.
- [`../observability-engineering/README.md`](../observability-engineering/README.md) — where health, metrics, traces, and profiles meet at fleet scale.
- The `high-availability-patterns`, `circuit-breaker-pattern`, `rate-limiting-throttling`, `api-authentication`, `api-security-checklist`, and `secrets-management` skills.

---

## Diagrams & Visual Aids

### The on-demand → always-on shift (and where the attack surface goes)

```text
   SENIOR (per service)                      PROFESSIONAL (fleet)
   ┌──────────────────────────┐             ┌──────────────────────────────────────┐
   │ operator pulls /profile   │             │ eBPF agent samples EVERY process       │
   │ on ONE replica, gated     │             │ out-of-process, <1%, ALWAYS            │
   │   ↑ an endpoint to secure │             │   → Parca/Pyroscope store (queryable)  │
   └──────────────────────────┘             │ on-demand pull = rare gated EXCEPTION  │
        attack surface: the endpoint        └──────────────────────────────────────┘
                                                  attack surface: REMOVED (no endpoint)
                                                  new surface: the CONTROL PLANE (harden it)
```

### Dump without self-OOM

```text
   suspect leak, pod at 93% mem
            │
            ▼
   DON'T: /heapdump  ──► serialize heap ──► allocate buffers ──► OOM-kill ──► lose pod + evidence
            │
   DO:      ▼
   1. readiness=false on a chosen replica   (drain; LB stops routing)
   2. verify volume free ≥ heap + margin    (the dump must not be the OOM)
   3. capture from OUTSIDE the process:
        gcore <pid>   |   jmap -dump:live   |   py-spy dump   |  ephemeral debug container
   4. stream → ENCRYPTED, gated artifact store     (not into heap, not into a chat paste)
   5. analyze OFFLINE (delve / MAT / jhsdb)         (live fleet untouched)
```

### Authz: action × scale × time

```text
   "may PROFILE checkout"                 ┌── action authz (RBAC/ABAC) ──┐
            ×                              │ role:oncall-payments         │
   "on ≤ 1 instance" (default cap)        │ → profile,dump,toggle on svc │
            ×                              └──────────────────────────────┘
   "for 1h, incident INC-..."   ──────────►  JIT, scoped, auto-revoked
            ×
   fan-out > cap?  ──► SEPARATE, audited elevation   ("profile 3,000 at once" ≠ "profile")
            │
            ▼
   every grant + use → immutable AUDIT (who/what/target/scale/when/incident)
   anomalous scale or rate → ALARM (intrusion signal, not just a log line)
```

### The fleet contract enforcement stack

```text
   ┌─────────────────────────────────────────────────────────────────────┐
   │ 3. ADMISSION / MESH POLICY   reject off-contract surfaces at DEPLOY  │ ← non-compliant
   ├─────────────────────────────────────────────────────────────────────┤
   │ 2. CI CONFORMANCE LINT       fail the BUILD on contract violations   │ ← forgetful
   ├─────────────────────────────────────────────────────────────────────┤
   │ 1. SHARED LIBRARY DEFAULT    correct surface by IMPORT               │ ← willing majority
   └─────────────────────────────────────────────────────────────────────┘
        a contract you cannot mechanically verify is a wish.
```

### Continuous profiling subsumes the on-demand pull

```text
   "Why was checkout CPU-bound at 14:32 last Tuesday?"
        │
        ├─ continuous profiler has it  ──►  query stored profile, diff vs healthy window
        │                                    (zero incident-time perturbation)  ✅ 90% of cases
        │
        └─ coverage gap?  ──►  ONE capped single-target live pull  ──►  file ticket: close the gap
                                (the dangerous path is the EXCEPTION, and a signal to fix coverage)
```
