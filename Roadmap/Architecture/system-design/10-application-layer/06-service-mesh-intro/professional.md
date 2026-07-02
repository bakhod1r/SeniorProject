# Service Mesh — Professional

A service mesh is a programmable proxy fabric: a fleet of L7 proxies (Envoy, or Linkerd's `linkerd2-proxy`) interposed on the data path, driven by a control plane that computes and pushes configuration. At the professional tier the interesting questions are not *what* a mesh does but *how* it does it under load and at scale: the wire protocol that streams config to proxies (xDS), the workload-identity substrate that anchors mTLS (SPIFFE/SPIRE), the internal object model of the proxy itself (listeners → filters → clusters), the sidecarless *ambient* datapath, and the latency and consistency budgets you inherit for every extra hop.

## Table of contents

1. [The xDS protocol: LDS, RDS, CDS, EDS](#1-the-xds-protocol-lds-rds-cds-eds)
2. [Config propagation and eventual consistency](#2-config-propagation-and-eventual-consistency)
3. [SPIFFE/SPIRE identity and mTLS rotation](#3-spiffespire-identity-and-mtls-rotation)
4. [Envoy internals for a mesh](#4-envoy-internals-for-a-mesh)
5. [Ambient mesh: ztunnel and waypoints](#5-ambient-mesh-ztunnel-and-waypoints)
6. [Latency and overhead budget](#6-latency-and-overhead-budget)
7. [Consistency across the fleet](#7-consistency-across-the-fleet)
8. [References](#8-references)

---

## 1. The xDS protocol: LDS, RDS, CDS, EDS

Envoy is configured almost entirely at runtime through the **xDS** family of gRPC/REST APIs. Each API is a "discovery service" for one resource type. The control plane (Istio's `istiod`) is the xDS *server*; every Envoy proxy is an xDS *client* that opens a long-lived bidirectional gRPC stream and subscribes to the resources it needs.

The core resource types form a dependency chain, resolved lazily and top-down:

| Acronym | Resource | Answers the question | Depends on |
|---------|----------|----------------------|------------|
| **LDS** | Listener | "What ports/sockets do I bind, and what filter chain runs on each?" | — |
| **RDS** | RouteConfiguration | "For this HTTP virtual host, which route matches this request and which cluster does it select?" | referenced by an HCM filter in a listener |
| **CDS** | Cluster | "What upstream service groups exist, and what are their LB policy, circuit breakers, TLS context, health checks?" | selected by routes |
| **EDS** | ClusterLoadAssignment | "What are the concrete endpoints (IP:port), their locality, weight, and health for this cluster?" | belongs to an EDS-type cluster |
| **SDS** | Secret | "What are the TLS certificate and private key for this identity?" | referenced by TLS contexts |

Two auxiliary services round out the picture: **LDS/RDS/CDS/EDS** are the "big four"; **SDS** (Secret Discovery Service) streams certificates and keys so private keys never touch disk or static config, and **ADS** (Aggregated Discovery Service) multiplexes all of the above onto a *single* gRPC stream to guarantee ordering (see §2).

The resolution order matters. A listener (LDS) names a route config (RDS); a route names a cluster (CDS); a cluster of type `EDS` names an endpoint assignment (EDS). Envoy fetches them in that order and applies **make-before-break**: a new cluster's endpoints and health checks must warm up before the cluster replaces its predecessor, so a config push never drains a working upstream into a cold one.

xDS runs in two flavors. **State-of-the-World (SotW)** sends the *complete* set of resources for a type on every update. **Delta/Incremental xDS** sends only the resources that changed plus a list of removed names — essential at scale, where a single endpoint flap should not re-serialize thousands of endpoints to every proxy.

---

## 2. Config propagation and eventual consistency

A mesh is a distributed system whose "database" is the union of every proxy's live config. Propagation is **eventually consistent**: when you apply a `VirtualService`, `istiod` recomputes the affected xDS resources and pushes them, but different proxies receive and apply the update at slightly different times.

The dangerous failure mode is **partial application across resource types**. Suppose a route (RDS) is updated to point at a new cluster, but the corresponding cluster (CDS) has not yet arrived at that proxy. The route now references a nonexistent cluster and requests get NR ("no route") / 503s. This is exactly why **ADS** exists: by carrying all resource types on one stream, the server controls ordering — it can send CDS before the RDS that depends on it — and Envoy's **make-before-break** plus resource **warming** ensure a config version is only swapped in once its dependencies are satisfiable.

Each xDS response carries a `version_info` and a `nonce`. The client ACKs a config by echoing the nonce with the version it accepted, or NACKs with an error detail if the config is invalid (e.g., a malformed regex). NACKs are the single most useful signal that a control-plane push is broken; a healthy fleet ACKs, a broken push produces a wave of NACKs while proxies keep serving their last-good config.

```mermaid
sequenceDiagram
    autonumber
    participant Op as Operator
    participant CP as istiod (xDS server)
    participant Px as Envoy (xDS client)
    Op->>CP: apply VirtualService + DestinationRule
    Note over CP: recompute affected LDS/RDS/CDS/EDS
    CP->>Px: ADS: CDS (new cluster) v42, nonce=n1
    Px->>Px: warm cluster (resolve EDS, health-check)
    CP->>Px: ADS: EDS (endpoints) v42, nonce=n2
    Px-->>CP: ACK CDS v42 (echo n1)
    Px-->>CP: ACK EDS v42 (echo n2)
    CP->>Px: ADS: RDS (route → new cluster) v42, nonce=n3
    Px->>Px: make-before-break swap of route table
    Px-->>CP: ACK RDS v42 (echo n3)
    Note over Px: new config live; old upstream drained only now
```

The **convergence time** — the interval between `kubectl apply` and the last proxy serving the new config — is the metric that matters operationally. It scales with fleet size, push batching (`istiod` debounces bursts of changes), and stream fan-out. Delta xDS and push-scoping (the `Sidecar` resource restricts which services a proxy hears about) are the primary levers to keep convergence fast as the fleet grows.

---

## 3. SPIFFE/SPIRE identity and mTLS rotation

Mesh mTLS is only as trustworthy as the identities behind the certificates. **SPIFFE** (Secure Production Identity Framework For Everyone) defines a platform-neutral identity: the **SPIFFE ID**, a URI such as `spiffe://cluster.local/ns/payments/sa/checkout`. This ID is embedded in the SAN (Subject Alternative Name) of an X.509 **SVID** (SPIFFE Verifiable Identity Document). Authorization policy is then written against the SPIFFE ID — "checkout may call ledger" — not against IPs, which are ephemeral in a scheduler-driven cluster.

**SPIRE** is the reference implementation: a SPIRE Server acts as CA and registry; a SPIRE Agent on each node **attests** workloads (via node attestation — cloud instance identity, k8s PSAT — and workload attestation — process UID, k8s pod selectors) before handing them an SVID. In Istio's built-in flavor, `istiod` plays the CA role directly and the sidecar's agent handles attestation via the pod's projected ServiceAccount token; the SPIFFE ID model is the same.

The critical mechanic is **short-lived certificates with automatic rotation**. SVIDs are minted with lifetimes measured in hours (Istio's default workload cert TTL is 24h), and the agent proactively rotates them — typically after a fraction of the TTL — over **SDS**, hot-swapping the cert into Envoy's TLS context with no connection drop and no process restart. Short TTLs make revocation a non-problem: a compromised identity expires on its own before a CRL/OCSP round-trip would even matter.

```mermaid
sequenceDiagram
    autonumber
    participant W as Workload (pod)
    participant A as Agent (istio-agent / SPIRE Agent)
    participant CA as CA (istiod / SPIRE Server)
    participant E as Envoy (SDS client)
    W->>A: start; present projected SA token
    A->>A: workload attestation (verify pod identity)
    A->>A: generate keypair, build CSR w/ SPIFFE ID in SAN
    A->>CA: CSR + attestation evidence
    CA->>CA: verify evidence, sign X.509 SVID (TTL 24h)
    CA-->>A: signed SVID + trust bundle
    A->>E: SDS push: cert + key + CA bundle
    Note over A,E: at ~T*0.5, rotate before expiry
    A->>CA: new CSR (fresh keypair)
    CA-->>A: new SVID
    A->>E: SDS push new cert (hot swap, no drop)
```

At connection time both proxies present SVIDs, each validates the peer's chain against the shared trust bundle, extracts the peer SPIFFE ID from the SAN, and enforces `AuthorizationPolicy` on it. Private keys are generated in the agent and delivered to Envoy over a Unix domain socket via SDS — they never appear in xDS config, on disk, or in etcd.

---

## 4. Envoy internals for a mesh

Understanding the mesh means understanding Envoy's object model, because every mesh policy compiles down to it.

- **Listener** — a bound socket (or a virtual inbound/outbound listener that captures redirected traffic). In a sidecar, iptables/`REDIRECT` (or a TPROXY / eBPF hook) steers the pod's traffic to Envoy's virtual listener at `15001` (outbound) / `15006` (inbound).
- **Filter chain** — an ordered pipeline attached to a listener. Network (L4) filters process raw bytes; the terminal L4 filter for HTTP is the **HTTP Connection Manager (HCM)**, which parses HTTP and then runs a chain of **HTTP filters** (L7).
- **HTTP filters** — where mesh L7 features live: routing, retries, fault injection, the RBAC filter (authz), ext_authz, rate limiting, header manipulation, and telemetry (stats/tracing). The router filter is always last; it selects a cluster via the route table and hands the request off.
- **Cluster** — a logical upstream. Carries load-balancing policy (round-robin, least-request, ring-hash for consistent hashing, Maglev), outlier detection (passive health via ejection), circuit-breaker thresholds, and the client-side TLS context that presents the SVID.
- **Endpoint** — a concrete member of a cluster, delivered by EDS, tagged with locality (region/zone) for locality-aware and topology-aware routing.

A request through a sidecar therefore traverses: source app → source Envoy outbound listener → HCM/HTTP filters → router → source cluster (mTLS originate) → **network** → dest Envoy inbound listener → HCM/HTTP filters (RBAC, telemetry) → router → local `127.0.0.1` cluster → dest app. Two proxy traversals per hop is the cost model you must budget for (§6).

Filters can also be **WASM** modules, letting operators inject custom L7 logic without recompiling Envoy — the extensibility story that distinguishes Envoy-based meshes from Linkerd's deliberately minimal, purpose-built Rust proxy (which trades general programmability for a smaller, faster, memory-safe data path).

---

## 5. Ambient mesh: ztunnel and waypoints

The classic sidecar model injects a full Envoy into every pod. That is powerful but expensive: per-pod memory, per-pod CPU for TLS and L7 parsing, and a lifecycle coupling (you must restart pods to upgrade the proxy). **Ambient mesh** (Istio) splits the data path into two tiers so applications pay only for what they use.

- **ztunnel** (zero-trust tunnel) — a per-**node** L4 proxy (one shared instance, not one per pod). It provides mTLS, workload identity (SPIFFE SVID per workload it fronts), and L4 authorization. It transports traffic over **HBONE** (HTTP/2 CONNECT tunnels over mTLS). No pod sidecar, no pod restart to enroll.
- **waypoint** — an *optional*, per-namespace (or per-service-account) L7 Envoy proxy. You deploy a waypoint only for the workloads that actually need L7 features (HTTP routing, retries, L7 authz, rich telemetry). Traffic that needs only mTLS + L4 policy skips it entirely.

The eBPF/redirect layer captures pod traffic at the node and steers it into ztunnel without per-pod iptables mangling, and routes to a waypoint only when policy requires L7 processing.

| Aspect | Sidecar (per-pod Envoy) | Ambient — ztunnel (L4) | Ambient — waypoint (L7) |
|--------|-------------------------|------------------------|-------------------------|
| Deployment unit | one proxy per pod | one per node (DaemonSet) | one per namespace/SA, opt-in |
| Layer | L4 + L7 | L4 only | L7 |
| Provides | mTLS, routing, retries, L7 authz | mTLS, workload identity, L4 authz | HTTP routing, retries, L7 authz, telemetry |
| Transport | direct mTLS | HBONE (HTTP/2 CONNECT over mTLS) | HTTP over HBONE |
| Upgrade | restart every pod | restart DaemonSet, pods untouched | restart waypoint only |
| Overhead when idle | full proxy per pod always | shared, thin | zero (not deployed) |

The design goal is a **layered cost curve**: enroll a workload into zero-trust mTLS + L4 policy for near-zero marginal overhead via ztunnel, and pay the L7 proxy tax (a waypoint hop) only where an L7 feature is actually used. This directly attacks the latency and resource footprint that made sidecars a hard sell for large, latency-sensitive fleets.

---

## 6. Latency and overhead budget

Every mesh hop inserts proxies into the request path, and you must budget for them explicitly.

**Sidecar path.** A single service-to-service call crosses **two** proxies: the caller's outbound Envoy and the callee's inbound Envoy. Each adds:

- kernel/loopback traversal (iptables redirect or eBPF hook) into and out of the proxy,
- HTTP parsing + filter-chain execution,
- TLS work: the *handshake* cost is amortized by connection pooling and reuse, but per-request symmetric crypto and record framing are not free.

Well-tuned Envoy adds low-single-digit-millisecond P50 latency per proxy, but the **tail** is what bites: filter execution, GC-like buffer churn, and connection warm-up push P99/P99.9 up disproportionately, and the two-proxy multiplier compounds it. Always measure with the mesh's own histograms (Envoy exports per-cluster latency percentiles), not synthetic averages.

**Ambient path.** ztunnel-only traffic pays *one* thin L4 hop per node-pair with no L7 parsing — cheaper than a sidecar. When a waypoint is in play, the path is caller → ztunnel → waypoint → ztunnel → callee, which can be *more* hops than a sidecar; the trade is that only L7-requiring traffic pays it, and the proxies are shared rather than per-pod, cutting aggregate CPU/memory across the fleet.

Budget checklist:

1. **Count the hops.** Sidecar = 2 proxies/call. Ambient L4 = 1 thin hop. Ambient L7 = up to 4 traversals. Fold this into your end-to-end latency SLO before adopting.
2. **Reuse connections.** Upstream connection pools and HTTP/2 multiplexing keep handshakes off the hot path; a cold pool turns every call into a TLS handshake.
3. **Cap the filter chain.** Each HTTP filter (ext_authz, rate limit, WASM) is inline latency. Order and prune deliberately.
4. **Size resources.** Sidecars consume memory proportional to the *number of upstreams they know about*; scope with the `Sidecar`/ambient waypoint model so a proxy holds config for only what it talks to.
5. **Watch the tail, not the mean.** SLOs are set on P99/P99.9; proxy overhead concentrates there.

---

## 7. Consistency across the fleet

The mesh's config is never simultaneously identical everywhere; correctness depends on the *ordering* and *warming* guarantees discussed in §2, not on instantaneous global agreement.

Key properties to reason about:

- **Per-proxy atomicity, fleet-wide eventual consistency.** Each proxy swaps to a new config version atomically (make-before-break), but the fleet reaches a new version asynchronously. During the convergence window, callers and callees may briefly hold different views — e.g., a caller routing to a new subset before the callee's inbound RBAC recognizes it. Design policies to be *safe under skew*: additive changes (allow, then use) before subtractive ones (stop using, then deny).
- **ADS ordering + warming** prevent the classic "route references missing cluster" 503 storm by guaranteeing dependencies land before dependents.
- **ACK/NACK versioning** gives you observability into convergence: a push is only "done" when every subscribed proxy has ACKed the new `version_info`. Track the distribution of proxy config versions (`istiod` exposes `pilot_proxy_convergence_time` and per-proxy version metrics) — a long tail of stale versions signals an overloaded control plane, a wedged stream, or a NACK loop.
- **Control-plane availability is not request-path availability.** If `istiod` dies, no new config propagates, but every proxy keeps serving its **last-good config** — the data plane is decoupled from the control plane. This is the property that makes a mesh safe: a control-plane outage freezes policy, it does not sever traffic.
- **Scoping bounds the blast radius.** The `Sidecar` resource (and ambient's per-namespace waypoints) restrict which resources a proxy subscribes to, shrinking both push size and the set of proxies any given change touches — the primary tool for keeping convergence bounded as the fleet grows into the thousands.

The mental model: treat the mesh config as a versioned, causally-ordered stream replicated to thousands of clients, where the server enforces dependency ordering, each client applies atomically, and the request path degrades to last-known-good on control-plane failure.

---

## 8. References

- Envoy — xDS protocol and configuration model: https://www.envoyproxy.io/docs/envoy/latest/api-docs/xds_protocol
- Envoy — life of a request (listeners, filters, clusters): https://www.envoyproxy.io/docs/envoy/latest/intro/life_of_a_request
- Istio — traffic management and config resources: https://istio.io/latest/docs/concepts/traffic-management/
- Istio — security, PeerAuthentication and mTLS: https://istio.io/latest/docs/concepts/security/
- Istio — ambient mesh (ztunnel and waypoints): https://istio.io/latest/docs/ambient/
- SPIFFE — SPIFFE ID and SVID concepts: https://spiffe.io/docs/latest/spiffe-about/spiffe-concepts/
- SPIRE — architecture, attestation, rotation: https://spiffe.io/docs/latest/spire-about/spire-concepts/
- Linkerd — architecture and the linkerd2-proxy data plane: https://linkerd.io/2/reference/architecture/

*Next step:* [Service Mesh — Staff](staff.md)
