# Service Discovery — Senior

At senior altitude you stop asking "how does a service find its peers?" and start asking "who owns the registry, what is its availability budget, and what happens to every caller in the fleet when it lies or goes dark?" The registry is not a convenience — it is a piece of **critical, in-the-request-path infrastructure**. Every RPC that resolves an endpoint depends on it, so its consistency model, its staleness window, and its failure modes become *your* consistency model, staleness window, and failure modes. Owning discovery means owning that whole chain: the CP-vs-AP tradeoff, the heartbeat/eviction timing that governs how long a dead instance keeps taking traffic, the caching that keeps you alive when the registry is not, and the decision of when to stop running discovery yourself and let a service mesh do it.

## Table of Contents

1. [The Registry Is Critical Infrastructure](#1-the-registry-is-critical-infrastructure)
2. [CP vs AP Registry: The Central Tradeoff](#2-cp-vs-ap-registry-the-central-tradeoff)
3. [Why AP Is Usually Right for Discovery](#3-why-ap-is-usually-right-for-discovery)
4. [The Staleness Window: Dead Instances Still in the Table](#4-the-staleness-window-dead-instances-still-in-the-table)
5. [Tuning Heartbeat vs Detection Speed](#5-tuning-heartbeat-vs-detection-speed)
6. [Caching Discovery Results and Failing Static](#6-caching-discovery-results-and-failing-static)
7. [The Shift to the Service Mesh: Control Plane + Sidecar + xDS](#7-the-shift-to-the-service-mesh-control-plane--sidecar--xds)
8. [Client-Side vs Mesh Discovery](#8-client-side-vs-mesh-discovery)
9. [Failure Modes: Outage, Stale, Thundering Herd, Split-Brain](#9-failure-modes-outage-stale-thundering-herd-split-brain)
10. [When Mesh Replaces DIY Discovery](#10-when-mesh-replaces-diy-discovery)
11. [Owner Checklist](#11-owner-checklist)
12. [Next Step](#12-next-step)

---

## 1. The Registry Is Critical Infrastructure

A service registry is a distributed key-value store whose keys are logical service names (`payments`, `orders-v2`) and whose values are the current set of healthy network endpoints. That sounds mundane until you notice its position in the topology: **it sits on the resolution path of every inter-service call.** If the registry is unreachable or wrong, callers cannot find callees, and an outage propagates fleet-wide within seconds — not because any application server failed, but because the thing that tells servers about each other failed.

This position dictates two non-negotiable properties, and they are in tension:

- **High availability.** The registry must answer "who serves `payments`?" even when parts of the cluster are partitioned, nodes are rebooting, or a registry replica is down. A registry that stops answering during a partition converts a *partial* infrastructure problem into a *total* application outage.
- **Consistent-enough truth.** The answer must be recent enough that callers do not spend most of their requests dialing instances that no longer exist. "Consistent-enough" is the load-bearing phrase: discovery rarely needs linearizability, but it cannot tolerate arbitrarily stale views either.

The senior insight is that these two pulls are exactly the CAP/PACELC dilemma applied to one specific store, and the industry has largely converged on a deliberate answer — but only after understanding what each side costs. That is the subject of the next section.

Two data structures make the tension concrete. The registry holds (a) the **membership set** — which instances exist and are healthy — and (b) implicitly, the **liveness signal** that keeps that set current (heartbeats/leases). Availability is about whether you can *read* (a) during trouble; staleness is about how quickly (b) removes a corpse from (a). A registry can be perfectly available and still hand you a dead endpoint; the two problems are orthogonal and you must reason about them separately.

## 2. CP vs AP Registry: The Central Tradeoff

Registries fall into two camps by their behavior during a network partition, and the choice defines everything downstream.

A **CP registry** (etcd, ZooKeeper, and Consul's strongly-consistent server core) runs a consensus protocol — Raft or ZAB — over its data. Writes require a quorum of the server nodes to agree, which guarantees that every reader sees a linearizable, single-copy view of membership. The price is paid during a partition: a minority partition **cannot make progress**. If a caller's local registry replica lands on the minority side of a split, reads may block or fail rather than return a possibly-stale answer. Consistency is preserved; availability is sacrificed.

An **AP registry** (Netflix Eureka is the canonical example) drops consensus in favor of best-effort replication. Every server replica accepts registrations and heartbeats and gossips them to peers asynchronously. During a partition, **every replica keeps serving** whatever view it last had. Two replicas may temporarily disagree about the membership set, and a caller may receive a slightly stale list — but it always receives *a* list and can keep making calls. Availability is preserved; strict consistency is sacrificed and replaced with eventual convergence.

| Dimension | CP registry (etcd / Consul / ZooKeeper) | AP registry (Eureka) |
|---|---|---|
| Consistency model | Linearizable — one agreed view of membership | Eventual — replicas converge, may disagree briefly |
| Behavior in a partition | Minority side **blocks / errors** on reads or writes | **Every replica keeps answering** its last-known view |
| Write path | Quorum consensus (Raft / ZAB) — needs a majority up | Local accept + async gossip — no quorum needed |
| Failure of registry majority | Registry becomes read-only or unavailable | Registry stays fully available (possibly stale) |
| Staleness risk | Low — reads reflect the latest committed write | Higher — you may dial an instance that just died |
| Extra machinery | Leader election, sessions/leases, watch semantics | Self-preservation mode, client-side heartbeat/renew |
| Best fit | Config, leader election, locks, coordination | High-churn service membership at scale |

The trap is to reach for the strongest guarantee "to be safe." For discovery, the strongest guarantee is often the wrong one, because it fails *closed* — under stress it stops answering, which is precisely when your fleet most needs an answer.

## 3. Why AP Is Usually Right for Discovery

Discovery has a property that most consumers of a KV store do not: **a slightly stale membership list is usually harmless, but an unavailable one is catastrophic.** Reason through it.

If an AP registry hands a caller a list that is a few seconds out of date, the worst case is that the list includes one instance that has just died. The caller dials it, the connection is refused or times out, and a **retry against another healthy instance from the same list** succeeds. The staleness is absorbed by client-side resilience (retries, load-balancer passive health checks, circuit breakers) that you already need for other reasons. The cost is a handful of failed-then-retried calls per dead instance per staleness window.

If instead a CP registry becomes unavailable — because a partition put the caller's replica in the minority, or because the registry lost quorum — then callers cannot resolve *any* endpoint. No retry helps, because there is nothing to retry against; the caller does not even know who to dial. A registry that fails closed turns "one instance died" into "no calls resolve." That asymmetry is the whole argument: **stale is recoverable, unavailable is not.**

This is why Eureka defaults to AP and even ships a **self-preservation mode**: when a Eureka server suddenly stops receiving the expected volume of heartbeats — the signature of a network partition rather than mass instance death — it *stops evicting* instances. It reasons, correctly, that during a partition it is more likely losing contact with healthy instances than that they all died at once, so it keeps serving the last-known list and lets client-side retries handle the few genuinely-dead entries. It chooses "possibly stale but complete" over "accurate but shrinking to empty."

The caveat that keeps this honest: AP is right for discovery *because discovery tolerates staleness*. It is the wrong default for the things you might also store in the same system — **leader election, distributed locks, and config that must be globally agreed** genuinely need CP, because two nodes believing they both hold a lock is a correctness bug, not a retryable blip. This is exactly why Consul separates the two: a strongly-consistent (Raft) server core for KV/locks/leader election, and gossip-based, partition-tolerant health/membership for discovery. Do not force one model onto both jobs.

## 4. The Staleness Window: Dead Instances Still in the Table

The defining operational hazard of discovery is the **staleness window**: the interval between the moment an instance actually dies and the moment the registry removes it from the served list. During that window, callers keep receiving the dead endpoint and keep failing against it. Every discovery system has this window; your job is to know its size and bound its damage.

Walk through the timeline of a crash and its eviction:

```mermaid
sequenceDiagram
    autonumber
    participant I as Instance B (dies at t=0)
    participant R as Registry
    participant C as Caller
    Note over I: t=0 — instance B crashes (no clean deregister)
    I--xR: 1. missed heartbeat (was due at t=10s)
    C->>R: 2. resolve "payments"
    R-->>C: 3. list = [A, B, D]  (B still listed — STALE)
    C->>I: 4. dial B
    I--xC: 5. connection refused / timeout  ❌ failed call
    C->>R: 6. (retry) resolve again — list still [A, B, D]
    C->>I: 7. dial A instead → success ✅ (retry absorbs staleness)
    Note over R: t=30s — lease expires after N missed heartbeats
    R->>R: 8. evict B → list = [A, D]
    Note over C,R: staleness window = t=0 … t=30s; every dial of B failed
```

The window's length is the sum of three delays: **(1)** how long until the registry *notices* B is gone (a function of heartbeat interval and how many misses it tolerates), **(2)** any propagation/gossip delay before all replicas agree B is gone, and **(3)** the caller's own **cache TTL** — even after the registry evicts B, a caller that cached the old list keeps using it until its cache expires. A common mistake is to tune only (1) and forget that (3) can dominate: a 60-second client cache makes registry eviction speed irrelevant.

Two mitigations shrink or bypass the window. **Graceful deregistration** — the instance calls the registry's deregister API during shutdown (via a `SIGTERM` handler) — removes B *instantly* for planned restarts and deploys, so the window only applies to *crashes*, not rollouts. And **client-side passive health** — the caller's load balancer marks B as failed on the first refused connection and stops routing to it *before* the registry catches up — collapses the effective window for that caller to a single failed request. The registry's active eviction and the client's passive ejection are complementary layers; rely on both.

## 5. Tuning Heartbeat vs Detection Speed

The knob that most directly controls the staleness window is the **heartbeat (lease renewal) configuration**, and it embodies a direct tradeoff between detection speed and load. Instances periodically send a heartbeat (or renew a lease); the registry evicts an instance after it misses some number of consecutive heartbeats.

- **Fast detection** — short interval (e.g. every 2s) and low miss tolerance (evict after 2 misses) — means a dead instance leaves the table within ~4–6 seconds. But it multiplies heartbeat traffic against the registry and, critically, makes you **jumpy**: a brief network hiccup or a GC pause that delays a couple of heartbeats gets a *healthy* instance evicted, causing needless churn and possibly a mini reconnect storm as the instance re-registers.
- **Slow detection** — long interval (e.g. every 30s) and higher tolerance (evict after 3 misses) — is calm and cheap on registry load, tolerant of transient blips, but leaves dead instances in the table for up to ~90 seconds, lengthening the staleness window and the failed-call count.

The senior framing: heartbeat tuning is choosing your **false-positive rate vs your detection latency**. Aggressive settings evict live instances (false positives → churn); relaxed settings keep corpses around (slow detection → stale calls). The right point depends on how bad a stale call is *for this service*. Ground it with arithmetic. With `H` = heartbeat interval and `M` = misses tolerated, worst-case detection is `≈ H × (M + 1)`. Heartbeat write load on the registry is `≈ instances / H` — so at 10,000 instances, a 2s interval costs the registry ~5,000 renew-writes/second of steady load *before any real traffic*, which is a large tax on a CP registry that must quorum-commit each renew and a strong argument for AP or for lease-batching. You are trading registry write-throughput against how long a dead instance keeps failing callers, and you should pick numbers, not vibes.

Do not tune this in isolation from client caching. If clients cache the list for `T` seconds, the *effective* staleness the caller experiences is `detection_time + T`, not `detection_time`. Tightening the heartbeat while leaving a fat client cache is wasted effort.

## 6. Caching Discovery Results and Failing Static

Callers must not resolve against the registry on every single request — that would put the registry directly in the hot path at full RPS and turn it into both a latency tax and a single point of failure. The universal pattern is a **client-side cache** of the resolved endpoint list, refreshed periodically (poll) or pushed on change (watch/stream). This decouples request throughput from registry throughput: a service doing 50,000 RPS might only hit the registry once every few seconds per client to refresh its list.

Caching buys three things and costs one. It buys **latency** (resolution is a local map lookup, not a network round-trip), **registry load reduction** (RPS is served from cache, not from the registry), and — most importantly — **survivability**: a cache lets callers **fail static**. If the registry goes completely dark, a caller with a warm cache keeps using its last-known-good list and keeps working, degrading gracefully instead of failing. The cost it introduces is exactly the staleness of §4: the cache TTL adds directly to the staleness window.

This produces the single most important operational principle for the caller side: **the cache must never expire into emptiness during a registry outage.** A naive TTL cache that evicts to nothing after `T` seconds turns a registry outage into a total outage `T` seconds later — the worst possible behavior, because the failure is *delayed* and therefore surprising. The correct design is **fail-static / last-known-good**: on refresh failure, keep serving the stale list indefinitely and log/alarm, rather than discarding it. Serving a slightly-stale list is almost always better than serving no list. (This mirrors the DNS pattern of honoring a stale answer when the authoritative server is unreachable, and Envoy's discovery clients do exactly this — they retain the last good config when the control plane is unreachable.)

## 7. The Shift to the Service Mesh: Control Plane + Sidecar + xDS

The largest structural change in modern discovery is that it has **moved out of application code and into infrastructure**. In the classic client-side model, every service embeds a discovery library (a Eureka client, a Consul client) that resolves names, caches lists, and load-balances — meaning discovery logic is duplicated across every language and framework in your fleet, and upgrading it means redeploying everyone.

A **service mesh** relocates all of that into a **sidecar proxy** (typically Envoy) deployed next to each service instance. The application no longer knows about the registry at all: it makes a plain request to `localhost`, and its sidecar handles resolution, load balancing, retries, and mTLS. Discovery has split into two planes:

- **Data plane** — the fleet of sidecar proxies that actually carry traffic and enforce routing/discovery decisions per request.
- **Control plane** — a central component (Istio's `istiod`, Consul's servers, Linkerd's controller) that knows the true membership of every service and **pushes** endpoint updates down to every sidecar.

The protocol connecting them is **xDS** (the "x Discovery Service" family from Envoy: EDS for endpoints, CDS for clusters, LDS/RDS for listeners/routes). The control plane watches the source of truth (the Kubernetes API, or a registry) and streams endpoint changes to sidecars over gRPC. This inverts the old model: instead of thousands of clients *polling* a registry, one control plane *pushes* deltas to thousands of sidecars — lower registry load, faster convergence, and discovery logic maintained in exactly one place regardless of application language.

```mermaid
sequenceDiagram
    autonumber
    participant K as Source of truth (K8s API / registry)
    participant CP as Control plane (istiod)
    participant SA as Sidecar (caller)
    participant App as Caller app
    participant SB as Sidecar (payments)
    K-->>CP: 1. instance set for "payments" changes (B removed, E added)
    CP-->>SA: 2. xDS/EDS push: endpoints(payments) = [A, D, E]
    Note over SA: 3. sidecar updates its cluster table (no app involvement)
    App->>SA: 4. GET http://payments/charge  (just localhost)
    SA->>SB: 5. mTLS, LB across [A,D,E], retry on failure
    SB-->>SA: 6. response
    SA-->>App: 7. response
    Note over App,SA: app never saw the registry; discovery lives in the data plane
```

## 8. Client-Side vs Mesh Discovery

The choice between embedding discovery in clients and delegating it to a mesh is a real architectural fork with different cost, blast-radius, and operational profiles.

| Dimension | Client-side discovery (library) | Service mesh (sidecar + control plane) |
|---|---|---|
| Where the logic lives | In every app, per language/framework | In the sidecar (Envoy) — language-agnostic |
| Update propagation | Client polls or watches the registry | Control plane **pushes** xDS deltas to sidecars |
| Consistency across fleet | Each client has its own cached view | Central control plane, uniform view pushed out |
| Adding a new language | Reimplement the discovery client | Free — the sidecar handles it |
| Extra runtime cost | None beyond the library | A proxy hop + sidecar CPU/memory per pod |
| Failure of the control/registry | Clients fail static on cached list | Sidecars fail static on last pushed config |
| Blast radius of a bad config | Per-service redeploy to fix | Fleet-wide instantly (push is powerful *and* dangerous) |
| Extra features gained | Just discovery | mTLS, retries, timeouts, traffic-splitting, observability |
| Operational burden | Low infra, high per-service duplication | Non-trivial mesh to run (upgrades, sidecar lifecycle) |

Two rows deserve emphasis. The mesh's centralized push is a double-edged sword: it makes fleet-wide changes instant and uniform, which is exactly why a **bad control-plane config can break the entire fleet at once** — the same property that makes it powerful. And the mesh does not remove the fail-static requirement of §6; it relocates it — sidecars must retain their last-good xDS config when the control plane is unreachable, or a control-plane outage becomes a data-plane outage.

## 9. Failure Modes: Outage, Stale, Thundering Herd, Split-Brain

Owning discovery means having a written answer for each of these, because each has bitten real fleets hard.

- **Registry / control-plane outage.** The registry becomes unreachable. *If callers fail static on a cached last-known-good list (client-side) or last-good xDS config (mesh), the fleet keeps running degraded but functional.* If any layer expires its cache to empty, the outage becomes total — usually with a confusing delay equal to the TTL. Mitigation: fail static everywhere, never TTL-to-empty, and run the registry itself with redundancy (an odd number of replicas for a CP quorum; multiple replicas for AP).

- **Stale entries.** Dead instances remain in the served list through the staleness window (§4). *Callers waste requests dialing corpses.* Mitigation: graceful deregistration on shutdown, tuned heartbeat/eviction (§5), and client-side passive health-check ejection so the first failed dial removes the endpoint locally without waiting for the registry.

- **Thundering herd on the registry.** A large number of clients hit the registry simultaneously — classically after a **registry restart or failover**, when every client's cache is cold or every client re-registers/re-subscribes at once, or when a synchronized poll interval makes all clients refresh on the same tick. *The registry is swamped and may collapse under a load spike far above steady state.* Mitigations: **jitter** the client refresh interval so polls spread out; use **watch/streaming** instead of polling so updates are pushed, not pulled; stagger reconnects with exponential backoff; and prefer the mesh push model, which eliminates the poll-storm shape entirely.

- **Split-brain.** A network partition divides the registry's own nodes. *In a CP registry, only the majority side accepts writes; the minority side stops making progress (this is the intended CP behavior — it prevents divergence, at the cost of minority-side availability). In an AP registry, both sides keep serving and may hand out divergent membership views until the partition heals and they reconverge.* The AP hazard is temporary inconsistency; the CP hazard is minority-side unavailability. Eureka's self-preservation mode (§3) is specifically a defense against the failure-mode confusion here: it avoids mass-evicting instances during a partition it might be mistaking for mass death.

The unifying lesson: **the registry's failure must degrade the system gracefully, never take it down.** If any discovery failure can cause a total outage, the design is wrong regardless of how consistent the registry is.

## 10. When Mesh Replaces DIY Discovery

The mesh is not automatically the answer; it is a trade of per-service simplicity for centralized capability plus platform complexity. Reach for it when the pressures below are real, and stay with client-side (or plain DNS/Kubernetes Services) when they are not.

**Adopt a mesh when:**
- You run a **polyglot fleet** and are tired of reimplementing (and version-skewing) discovery, retries, and mTLS across every language.
- You need **mTLS everywhere, uniform retry/timeout/traffic-split policy, and per-hop observability** — the mesh gives these as a byproduct of taking over the data plane, and discovery alone was never going to.
- You want **central, instant, uniform** control over routing and endpoints rather than per-service redeploys to change behavior.
- You are already on Kubernetes, where the sidecar lifecycle and control-plane integration are well-trodden.

**Stay with simpler discovery when:**
- You are on **Kubernetes with modest needs** — a `Service` + `kube-proxy`/CoreDNS *is* discovery (virtual IP + DNS name), and it may be all you need without a mesh's overhead.
- Your fleet is **small or single-language**, where one good client library beats operating a control plane, thousands of sidecars, and their upgrade treadmill.
- The **added proxy hop's latency and the sidecar's CPU/memory per pod** are not justified by the features you would actually use.

The honest senior conclusion: a mesh is worth it when you need *more than discovery* — security, traffic management, and observability — from the same layer, and when fleet scale/polyglotism makes duplicated client libraries a genuine tax. If you only need "find the instances," you almost certainly do not need a mesh; DNS-based or a single registry client is simpler, cheaper, and has a smaller blast radius. Do not adopt a service mesh *for discovery alone*.

## 11. Owner Checklist

- **Pick the registry's consistency model deliberately** — AP for high-churn membership (stale is recoverable), CP for locks/leader-election/config (divergence is a bug). Do not force one model onto both jobs.
- **Know your staleness window** end to end: registry detection time + gossip/propagation + client cache TTL. Tune all three, not just the heartbeat.
- **Wire graceful deregistration** on `SIGTERM` so deploys and rollouts leave the table instantly and the staleness window only applies to genuine crashes.
- **Fail static, never fail empty.** Caches and sidecar configs must retain last-known-good on refresh failure; a registry/control-plane outage must degrade, not delete.
- **Jitter refreshes and prefer watch/push** to avoid thundering herds on registry restart or synchronized polls.
- **Layer passive health checks** at the client/LB so the first failed dial ejects an endpoint locally without waiting for registry eviction.
- **Run the registry redundant** (odd-count quorum for CP; multi-replica for AP) and monitor it as tier-0 infra with its own SLO.
- **Adopt a mesh for more than discovery** — mTLS, policy, observability at fleet/polyglot scale — not for endpoint lookup alone.

## 12. Next Step

You can now own discovery end to end: choose CP vs AP with intent, bound the staleness window, cache safely, and decide when a mesh earns its keep. The professional level goes deeper on the formal side — the consensus/lease math behind eviction, precise availability modeling of the registry, gossip convergence and anti-entropy behavior under partition, and the quantitative capacity limits of push (xDS) vs poll at fleet scale.

*Next step:* [Service Discovery — Professional](professional.md)
