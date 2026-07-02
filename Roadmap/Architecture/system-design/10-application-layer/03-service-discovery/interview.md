# Service Discovery — Interview

Service discovery answers one deceptively simple question: *given a logical service name, where — right now — are the healthy instances that can serve my request?* In a static world you would hard-code an IP and be done. In a world of autoscaling groups, rolling deploys, spot-instance reclamation, and containers that live for minutes, the set of addresses behind a name changes constantly, and any cached answer is a decaying approximation of the truth. This file drills the interview surface of that problem: the registry, health checking, the client-side vs server-side split, the registration models, DNS and Kubernetes, the CP-vs-AP tension, the staleness window, service mesh, and the SPOF question — closing with the scenario an interviewer almost always reaches for.

## Table of Contents

1. [Q1: Why is service discovery needed at all?](#q1-why-is-service-discovery-needed-at-all)
2. [Q2: What is a service registry, and what does an entry contain?](#q2-what-is-a-service-registry-and-what-does-an-entry-contain)
3. [Q3: How do health checks and heartbeats keep the registry honest?](#q3-how-do-health-checks-and-heartbeats-keep-the-registry-honest)
4. [Q4: Client-side vs server-side discovery — what is the difference?](#q4-client-side-vs-server-side-discovery--what-is-the-difference)
5. [Q5: Self-registration vs third-party registration?](#q5-self-registration-vs-third-party-registration)
6. [Q6: How does DNS-based discovery work, and where does it fall short?](#q6-how-does-dns-based-discovery-work-and-where-does-it-fall-short)
7. [Q7: How do Kubernetes Services implement discovery?](#q7-how-do-kubernetes-services-implement-discovery)
8. [Q8: Should the registry be CP or AP — and why does AP usually win?](#q8-should-the-registry-be-cp-or-ap--and-why-does-ap-usually-win)
9. [Q9: What is the staleness window, and how is detection time bounded?](#q9-what-is-the-staleness-window-and-how-is-detection-time-bounded)
10. [Q10: How does a service mesh do discovery differently?](#q10-how-does-a-service-mesh-do-discovery-differently)
11. [Q11: Isn't the registry a single point of failure?](#q11-isnt-the-registry-a-single-point-of-failure)
12. [Q12: How do clients survive a total registry outage?](#q12-how-do-clients-survive-a-total-registry-outage)
13. [Q13: Discovery vs load balancing — same thing?](#q13-discovery-vs-load-balancing--same-thing)
14. [Q14: How do you avoid routing to an instance that is starting up or draining?](#q14-how-do-you-avoid-routing-to-an-instance-that-is-starting-up-or-draining)
15. [Q15: Scenario — how do services find each other in a Kubernetes / autoscaling environment?](#q15-scenario--how-do-services-find-each-other-in-a-kubernetes--autoscaling-environment)

---

## Q1: Why is service discovery needed at all?

> Because in a modern deployment the mapping from *service name* to *network address* is not fixed — it changes on a timescale of seconds. Autoscaling adds and removes instances to track load; rolling deploys cycle every instance behind a name; orchestrators reschedule containers onto new hosts after a node dies; spot/preemptible instances are reclaimed with minutes of notice. Each of these events changes the IP:port set behind a logical name.
>
> If a caller hard-codes `10.0.3.14:8080`, it breaks the moment that instance is replaced. The classic fixes — a static config file, a hand-maintained load-balancer pool, `/etc/hosts` — all assume a human is in the loop to update the mapping, and humans operate on a timescale of minutes-to-days, not seconds. Service discovery is the automation that keeps the name→address mapping fresh without a human, so callers can address services by *stable logical identity* (`payments`) rather than *ephemeral location* (`10.0.3.14:8080`).
>
> The one-sentence version: **service discovery decouples a service's identity from its location so that location can change freely.**

## Q2: What is a service registry, and what does an entry contain?

> The service registry is the authoritative, queryable database of currently-available service instances — the source of truth for "who is up right now." Examples: Consul, etcd, ZooKeeper, Eureka, and the internal registries inside Kubernetes (the API server backed by etcd, surfaced as Endpoints/EndpointSlices).
>
> A registry entry (a *registration*) typically carries:
>
> | Field | Purpose |
> |---|---|
> | Service name | The logical identity callers query by (`payments`) |
> | Instance ID | Unique per instance, so re-registrations are idempotent |
> | Address + port | Where to actually connect |
> | Health status | `passing` / `warning` / `critical` — drives whether it's returned |
> | Metadata / tags | Version, zone/region, protocol, weight — for filtering & routing |
> | TTL / lease | Expiry after which the entry is auto-evicted if not renewed |
>
> The registry's core operations are **register**, **deregister**, **renew** (heartbeat), and **query/watch**. The last one matters: good registries let clients *watch* a service and get pushed a new instance list on change, rather than polling.

## Q3: How do health checks and heartbeats keep the registry honest?

> A registration is a claim ("I'm here and healthy"); health checking is how the registry verifies that claim continues to hold, so it can evict dead entries before callers route to them. Two dominant models:
>
> - **Heartbeat / TTL (push, pull-from-instance):** the instance renews its lease every *N* seconds. If the registry doesn't hear a renewal within the TTL, it marks the entry unhealthy and evicts it. This is Eureka's model and Consul's TTL-check model. Advantage: scales well (the registry does no work per instance). Weakness: a process can heartbeat while being unable to serve real traffic (event loop wedged, dependency dead) — a heartbeat proves the *heartbeating code* runs, not that the *service* works.
> - **Active health check (registry/agent probes the instance):** an agent periodically calls an HTTP `/health` endpoint, opens a TCP socket, or runs a script, and reports the result. This checks a real code path. Consul agents do this locally per node, which keeps probe traffic off the central servers.
>
> ```mermaid
> stateDiagram-v2
>     [*] --> Starting: register (out of rotation)
>     Starting --> Passing: readiness probe OK
>     Passing --> Passing: heartbeat / probe OK
>     Passing --> Critical: N missed heartbeats\nor probe fails
>     Critical --> Passing: probe recovers
>     Critical --> Deregistered: TTL expires
>     Passing --> Draining: SIGTERM / deregister
>     Draining --> Deregistered: graceful shutdown
>     Deregistered --> [*]
> ```
>
> The subtlety to name in an interview: distinguish **liveness** (is the process alive?) from **readiness** (should it receive traffic *right now*?). Discovery cares about readiness — an instance that is alive but still warming its cache should be `Starting`, not `Passing`.

## Q4: Client-side vs server-side discovery — what is the difference?

> They differ in *who* does the lookup and load-balancing decision.
>
> - **Client-side discovery:** the caller queries the registry itself, gets the full list of healthy instances, and picks one (round-robin, least-connections, etc.). The client owns the load-balancing logic. Netflix Eureka + Ribbon is the canonical example; gRPC with a resolver plugin is another.
> - **Server-side discovery:** the caller sends the request to a fixed intermediary (a load balancer, reverse proxy, or the platform's router). That intermediary queries the registry and forwards to a healthy instance. AWS ELB/ALB, Kubernetes `Service` via kube-proxy, and NGINX-with-a-registry-plugin are examples.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant C as Caller
>     participant R as Registry
>     participant S as Service Instance
>     Note over C,S: Client-side
>     C->>R: 1. query "payments"
>     R-->>C: 2. [ip1, ip2, ip3] (healthy)
>     C->>C: 3. pick ip2 (LB logic in client)
>     C->>S: 4. request → ip2
>     Note over C,S: Server-side
>     C->>S: 1'. request → LB VIP
>     Note over R,S: LB independently queries R and forwards
> ```
>
> | Aspect | Client-side | Server-side |
> |---|---|---|
> | LB logic lives in | Every client (library) | Central LB / proxy |
> | Extra network hop | No (direct to instance) | Yes (through LB) |
> | Language coupling | High — need a lib per language | None — clients speak plain HTTP |
> | Registry exposure | Clients talk to registry | Only LB talks to registry |
> | Failure blast radius | Bug ships in every client | Contained in LB fleet |
>
> Client-side is leaner (one fewer hop) but forces a smart client in every language you use — painful in a polyglot shop. Server-side keeps clients dumb at the cost of an extra hop and a fleet to run. Service mesh (Q10) is essentially "client-side load balancing, but the smarts live in a sidecar so the client stays dumb."

## Q5: Self-registration vs third-party registration?

> This is about *who writes the entry into the registry.*
>
> - **Self-registration:** the instance registers itself on startup and deregisters on shutdown (and heartbeats in between). Simple, no extra moving parts. Downsides: it couples app code to the registry client, and a hard crash (SIGKILL, OOM, power loss) means the instance never deregisters — the entry lingers until its TTL expires, so you *depend* on TTL-based eviction to clean up.
> - **Third-party registration:** a separate *registrar* watches for instances starting/stopping (via the orchestrator's events, Docker events, or a scheduler API) and manages registry entries on their behalf. The app stays ignorant of the registry. This is how Kubernetes works — the kubelet/endpoints-controller populates Endpoints; the pod itself does nothing. Registrator (for Docker) is another example.
>
> Rule of thumb: on a platform (Kubernetes, Nomad, ECS) prefer **third-party** — the platform already knows the lifecycle and can react to crashes the app can't report. For a service running on bare VMs without an orchestrator, **self-registration** is often the pragmatic choice. Either way, back it with TTL eviction so a missed deregistration self-heals.

## Q6: How does DNS-based discovery work, and where does it fall short?

> DNS-based discovery reuses the internet's existing name resolution as the discovery mechanism: you resolve `payments.internal` and get one or more A/AAAA records (or SRV records that also carry the port and a priority/weight). It's ubiquitous, language-agnostic, and requires no special client library — every runtime already speaks DNS.
>
> Where it falls short:
>
> - **TTL-driven staleness.** DNS answers are cached by the resolver, the OS, and often the application runtime, for the record's TTL. Lower the TTL and you fight caching layers that clamp or ignore small TTLs; many stacks cache a resolved IP for the life of a connection or the process regardless of TTL (the classic JVM `networkaddress.cache.ttl` foot-gun). So an instance can be dead for the TTL window while clients keep hammering its old IP.
> - **No health awareness by default.** Plain A records don't know if the target is healthy; you need the DNS layer integrated with health checks (as Consul DNS and Kubernetes headless Services are) to prune dead endpoints.
> - **Weak load balancing.** Round-robin DNS distributes *names to resolvers*, not *requests to instances*, and resolver caching skews the distribution badly.
> - **No port/metadata in A records.** SRV records fix the port but many clients don't implement SRV.
>
> DNS is a great *lowest-common-denominator* interface — often layered *on top of* a real registry (Consul, CoreDNS) so you get DNS's ubiquity plus the registry's health awareness — but bare round-robin DNS with long TTLs is where staleness bugs are born.

## Q7: How do Kubernetes Services implement discovery?

> Kubernetes bakes discovery into the platform so app code does nothing:
>
> 1. **Registration is third-party and automatic.** When a Pod becomes *Ready* (its readiness probe passes), the endpoints controller adds its IP to the `Service`'s EndpointSlice. On termination or probe failure it's removed. The Pod never touches a registry.
> 2. **A stable virtual identity.** A `Service` gets a stable ClusterIP (a virtual IP) and a DNS name (`payments.default.svc.cluster.local`) served by CoreDNS. Callers hit the name; the IP never changes even as backing Pods churn.
> 3. **Server-side load balancing.** `kube-proxy` programs iptables/IPVS (or a CNI does eBPF) on every node so that traffic to the ClusterIP is DNAT'd to a randomly chosen ready endpoint. This is server-side discovery with the "LB" distributed into the kernel of every node — no extra hop through a central proxy.
> 4. **Headless Services for client-side.** Setting `clusterIP: None` makes DNS return the *individual* Pod IPs instead of a VIP, handing the client the raw endpoint list so it can do client-side balancing (used by StatefulSets and gRPC clients).
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant P as New Pod
>     participant K as kubelet
>     participant EP as Endpoints Controller
>     participant DNS as CoreDNS
>     participant C as Caller
>     P->>K: 1. readiness probe passes
>     K->>EP: 2. Pod marked Ready
>     EP->>EP: 3. add Pod IP to EndpointSlice
>     C->>DNS: 4. resolve payments.svc
>     DNS-->>C: 5. ClusterIP (VIP)
>     C->>P: 6. request → VIP, kube-proxy DNATs to a ready Pod
> ```
>
> The key insight: readiness probes are the health-check half, EndpointSlices are the registry half, and kube-proxy is the server-side LB — all three of the earlier concepts, integrated.

## Q8: Should the registry be CP or AP — and why does AP usually win?

> The registry is itself a distributed, replicated data store, so CAP applies to *it*. During a network partition it must choose:
>
> - **CP (consistent):** refuse reads/writes it can't confirm against a quorum. ZooKeeper and etcd are CP — under partition, the minority side stops serving. Correctness of the *registry data* is preserved, but discovery queries on the minority side fail.
> - **AP (available):** keep serving whatever entries it has, even if possibly stale. Eureka is deliberately AP — during a partition it enters "self-preservation" mode and keeps serving the last-known instance list rather than evicting everything.
>
> **Why AP usually wins for discovery specifically:** the *consumer* of discovery data — a caller trying to route a request — is already resilient to a slightly-wrong answer. If the registry hands back an instance that just died, the caller gets a connection error, retries, and hits a live one. A *stale* answer degrades gracefully. A *no* answer (CP refusing to serve during a partition) is catastrophic: every caller in the affected zone can't route *anything*, taking down services that were otherwise perfectly healthy. In other words, discovery data is soft state where staleness is cheap and unavailability is expensive — exactly the profile that favors AP.
>
> The caveat: for tasks that need a *single correct answer* — leader election, distributed locks, configuration that must be linearizable — you want CP (etcd/ZooKeeper). Kubernetes reflects this: its registry (etcd) is CP for the control plane's own correctness, but the *data-plane routing* is eventually consistent and fails soft. The nuance to voice: "AP for the discovery *query path*, CP for anything requiring a unique decision."

## Q9: What is the staleness window, and how is detection time bounded?

> The **staleness window** is the interval between the moment an instance actually becomes unusable and the moment every caller stops routing to it. During this window callers send requests into a black hole. It's the sum of several delays:
>
> ```text
> total staleness ≈ detection_time + propagation_time + client_cache_TTL
>
>   detection_time   = (missed heartbeats) × heartbeat_interval   (e.g. 3 × 10s = 30s)
>                      or probe_interval × failure_threshold
>   propagation_time = time for the registry to update + push/notify watchers
>   client_cache_TTL = how long the caller caches the instance list before refresh
> ```
>
> Worked example: heartbeat every 10s, evict after 3 misses = **30s detection**; watchers notified in ~1s; clients cache the list for 30s = up to **~61s** where a dead instance is still being called. Tightening any term shrinks the window but costs something: a short heartbeat interval multiplies registry traffic; an aggressive eviction threshold risks flapping a healthy-but-briefly-slow instance out of rotation (false positive). This is the fundamental **detection-time vs stability** trade-off.
>
> You bound the *impact* of the window (rather than eliminating it) with client-side resilience: fast connection timeouts, retries on a *different* instance, circuit breakers that eject a failing endpoint immediately on error, and outlier detection. The registry gets you *approximately* correct in tens of seconds; the client's error-handling covers the gap in milliseconds.

## Q10: How does a service mesh do discovery differently?

> A service mesh (Istio, Linkerd, Consul Connect) moves discovery, load balancing, retries, and mTLS out of the application and into a **sidecar proxy** (typically Envoy) deployed next to every instance. The application makes a plain request to `localhost`; the sidecar intercepts it and handles everything else.
>
> The discovery mechanics: a central **control plane** (Istio's `istiod`) watches the platform's registry (Kubernetes EndpointSlices, Consul catalog) and pushes the resolved, health-filtered endpoint lists down to every sidecar via xDS (the Envoy config API). Each sidecar then does **client-side** load balancing against that list — locally, with rich policies (locality-aware routing, weighted subsets for canaries, outlier detection).
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant App as App container
>     participant SC as Sidecar (Envoy)
>     participant CP as Control plane (istiod)
>     participant Reg as Registry (EndpointSlices)
>     Reg-->>CP: 1. endpoint changes (watch)
>     CP-->>SC: 2. push endpoints via xDS
>     App->>SC: 3. request to localhost
>     SC->>SC: 4. pick healthy endpoint (client-side LB)
>     SC->>SC: 5. mTLS + retry/timeout policy
> ```
>
> So the mesh gives you the *performance* of client-side discovery (direct instance-to-instance, no central LB hop) with the *operational simplicity* of server-side (zero discovery code in the app, one policy surface for all languages). The cost is a proxy on every instance — extra latency (typically sub-millisecond per hop), memory, and a control plane to run. The interview one-liner: **"a mesh is client-side discovery where the client is a language-agnostic sidecar, centrally configured."**

## Q11: Isn't the registry a single point of failure?

> It would be if you ran one node — and that's the trap the question is testing. The registry is the most safety-critical component in the discovery path (if callers can't resolve names, nothing can talk to anything), so it is *always* deployed as a replicated cluster, never a singleton:
>
> - **Consensus-replicated cluster.** etcd, ZooKeeper, and Consul run 3 or 5 nodes with Raft/Zab. A 5-node cluster tolerates 2 node failures and keeps a quorum. Eureka replicates peer-to-peer across zones. Odd numbers avoid split votes; nodes are spread across availability zones so one AZ loss doesn't take quorum.
> - **Client-side caching as a shock absorber.** Well-designed clients cache the last-known-good instance list and keep using it if the registry is unreachable. This turns a registry outage into "no *new* topology info for a while" rather than "all traffic stops." Eureka clients explicitly do this.
> - **Read/write asymmetry.** Discovery is read-heavy (many queries, occasional registration changes). You can serve reads from any replica / a local agent cache and only route the rarer writes through consensus, so a partial outage still serves lookups.
>
> The honest answer names both halves: **replicate the registry for its own availability, and cache on the client so a total registry outage degrades gracefully instead of cascading.**

## Q12: How do clients survive a total registry outage?

> Even a replicated registry can be fully unreachable from a given caller (network partition to the registry AZ, DNS failure to the registry itself). Survival rests on the principle that **discovery data is cacheable and stale data beats no data**:
>
> - **Last-known-good cache.** The client keeps the most recent instance list on disk/in memory and continues routing to it when the registry is unreachable. Most of those instances are probably still up.
> - **Freeze eviction under mass failure.** Eureka's self-preservation: if it suddenly loses heartbeats from *many* instances at once, it assumes a network problem (not that the whole fleet died) and *stops* evicting — better to serve slightly-stale entries than to empty the registry and black-hole everything.
> - **Client-side error handling covers the gaps.** When a cached endpoint is actually dead, the request fails fast and retries against another cached endpoint; a circuit breaker ejects the bad one. The registry doesn't need to be reachable for this to work.
> - **Static fallback.** A last-resort hard-coded list (or a per-zone DNS name pointing at a stable LB) as the floor.
>
> The design goal to articulate: the registry outage should degrade *freshness of topology*, not *ability to route*.

## Q13: Discovery vs load balancing — same thing?

> No, though they're adjacent and often bundled. **Discovery** answers *"which instances exist and are healthy?"* — producing the candidate list. **Load balancing** answers *"given this list, which one gets this request?"* — the selection policy (round-robin, least-connections, weighted, locality-aware).
>
> They compose: discovery feeds the list, load balancing picks from it. A server-side LB (ALB, kube-proxy) does both behind a VIP. A client-side setup does discovery via the registry/resolver and load balancing in the client library or sidecar. Keeping them conceptually separate matters because you often want the *same* discovery source with *different* LB policies per client (e.g., a latency-sensitive service uses locality-aware routing; a batch job uses plain round-robin). The interviewer wants to hear that you don't conflate the two.

## Q14: How do you avoid routing to an instance that is starting up or draining?

> By using **readiness** as the gate on registry membership, not liveness:
>
> - **Startup:** an instance must not enter the healthy set until it can actually serve — DB pool warmed, caches primed, migrations checked. Kubernetes uses a *readiness probe*: the Pod IP is only added to EndpointSlices once it passes. Register only after readiness, never at process start.
> - **Draining (graceful shutdown):** on SIGTERM the instance should *first* deregister / fail its readiness probe so no *new* requests are routed to it, then finish in-flight requests, then exit. The sequence matters: deregister → drain → die. Skip the deregister-first step and you drop the requests that arrive in the gap between "started shutting down" and "registry noticed."
> - **Connection draining at the LB:** server-side LBs support a drain timeout — stop sending new connections, let existing ones complete, then remove. Kubernetes `preStop` hooks + `terminationGracePeriod` implement the same idea.
>
> Both edges use the same lever: an instance is in the healthy set **iff** it is ready to take *new* traffic — which is strictly narrower than "the process is running."

## Q15: Scenario — how do services find each other in a Kubernetes / autoscaling environment?

> Walk it end to end, because this ties every prior concept together.
>
> **Setup.** Say `checkout` needs to call `payments`. `payments` runs as a Deployment with a Horizontal Pod Autoscaler, so its Pod count and IPs change continuously.
>
> 1. **Stable identity.** `payments` is fronted by a `Service`, giving it a stable ClusterIP and DNS name `payments.default.svc.cluster.local`. `checkout` addresses it by that name — never by Pod IP.
> 2. **Registration is automatic and third-party.** When the HPA scales up, new `payments` Pods start. Each stays *out* of rotation until its **readiness probe** passes; then the endpoints controller adds its IP to the `payments` **EndpointSlice**. Scale-down or a crashed Pod removes it. No app code touches a registry — the platform is the registrar.
> 3. **Resolution.** `checkout` resolves `payments.default.svc` via **CoreDNS**, getting the stable ClusterIP.
> 4. **Server-side balancing in the kernel.** `kube-proxy` (iptables/IPVS) on `checkout`'s node has programmed rules that DNAT the ClusterIP to a *randomly chosen ready* Pod from the current EndpointSlice. As Pods churn, kube-proxy reprograms; `checkout` is oblivious.
> 5. **Health & staleness.** Readiness probes keep the endpoint set fresh within a few probe intervals; a dead Pod is pruned in seconds. During the small staleness window, `checkout`'s client retries/timeouts (or a mesh sidecar's outlier detection) cover any request that hits a just-dead Pod.
> 6. **When you want more.** For client-side LB (e.g., gRPC long-lived connections that must spread across Pods), use a **headless Service** (`clusterIP: None`) so DNS returns individual Pod IPs and the client balances itself. For cross-cluster/multi-region, richer routing, canaries, mTLS, and locality-aware balancing, add a **service mesh** — its control plane watches the same EndpointSlices and pushes endpoints to per-Pod sidecars.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant HPA
>     participant Pod as new payments Pod
>     participant EP as Endpoints Controller
>     participant DNS as CoreDNS
>     participant KP as kube-proxy
>     participant C as checkout Pod
>     HPA->>Pod: 1. scale up, start Pod
>     Pod->>EP: 2. readiness OK → IP added to EndpointSlice
>     C->>DNS: 3. resolve payments.svc
>     DNS-->>C: 4. ClusterIP (VIP)
>     C->>KP: 5. request → ClusterIP
>     KP->>Pod: 6. DNAT to a ready payments Pod
> ```
>
> The summary the interviewer wants: **stable name via `Service`/DNS, automatic health-gated registration via readiness probes + EndpointSlices, server-side load balancing via kube-proxy, and client-side resilience (retries/mesh) to absorb the staleness window** — no service ever hard-codes another's address.

---

*Next step:* [API Composition — Junior](../04-api-composition/junior.md)
