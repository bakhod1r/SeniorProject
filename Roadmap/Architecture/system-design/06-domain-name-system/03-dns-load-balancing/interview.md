# DNS Load Balancing — Interview

> **How this topic is examined:** interviewers use DNS load balancing to test whether you
> understand that DNS is a *coarse, cache-mediated, connectionless* steering layer — not a
> load balancer in the L4/L7 sense. The strongest answers keep returning to one fact:
> **DNS decides an answer at resolution time and then never sees the traffic again.** Every
> limit (no load awareness, caching defeats fairness, TTL ≠ failover speed) follows from
> that. Weak answers treat "round-robin DNS" as real load balancing.

## Table of Contents
1. [Q1: What is DNS load balancing, and how does round-robin DNS work?](#q1-what-is-dns-load-balancing-and-how-does-round-robin-dns-work)
2. [Q2: Why is round-robin DNS not "true" load balancing?](#q2-why-is-round-robin-dns-not-true-load-balancing)
3. [Q3: How does resolver and client caching affect DNS load distribution?](#q3-how-does-resolver-and-client-caching-affect-dns-load-distribution)
4. [Q4: Why doesn't lowering the TTL guarantee fast failover?](#q4-why-doesnt-lowering-the-ttl-guarantee-fast-failover)
5. [Q5: What is the trade-off in choosing a DNS TTL?](#q5-what-is-the-trade-off-in-choosing-a-dns-ttl)
6. [Q6: How does DNS load balancing differ from L4 and L7 load balancing?](#q6-how-does-dns-load-balancing-differ-from-l4-and-l7-load-balancing)
7. [Q7: How do weighted and health-checked DNS routing work?](#q7-how-do-weighted-and-health-checked-dns-routing-work)
8. [Q8: What is GeoDNS, and what is its weakness?](#q8-what-is-geodns-and-what-is-its-weakness)
9. [Q9: What is EDNS Client Subnet (ECS) and what problem does it solve?](#q9-what-is-edns-client-subnet-ecs-and-what-problem-does-it-solve)
10. [Q10: Can DNS provide session affinity (sticky sessions)?](#q10-can-dns-provide-session-affinity-sticky-sessions)
11. [Q11: How does DNS load balancing compose with anycast?](#q11-how-does-dns-load-balancing-compose-with-anycast)
12. [Q12: Why publish multiple A records instead of one?](#q12-why-publish-multiple-a-records-instead-of-one)
13. [Q13: When is DNS the right layer for a steering decision, and when is it wrong?](#q13-when-is-dns-the-right-layer-for-a-steering-decision-and-when-is-it-wrong)
14. [Q14: What are the failure modes of DNS-based routing?](#q14-what-are-the-failure-modes-of-dns-based-routing)
15. [Q15 (Scenario): Design multi-region failover using DNS — and explain what breaks.](#q15-scenario-design-multi-region-failover-using-dns--and-explain-what-breaks)
16. [Q16: How would you achieve sub-minute RTO if DNS failover is too slow?](#q16-how-would-you-achieve-sub-minute-rto-if-dns-failover-is-too-slow)

---

## Q1: What is DNS load balancing, and how does round-robin DNS work?

> DNS load balancing distributes traffic by returning **different IP addresses for the same
> hostname** at resolution time. Round-robin DNS is the simplest form: the authoritative
> server publishes multiple A/AAAA records for one name and rotates their order on each
> query, so consecutive resolvers receive different orderings.
>
> ```text
> app.example.com. 60 IN A 203.0.113.10
> app.example.com. 60 IN A 203.0.113.20
> app.example.com. 60 IN A 203.0.113.30
> ```
> Client 1 gets [.10, .20, .30]; client 2 gets [.20, .30, .10]; and so on. Since most
> clients connect to the **first** address returned, rotating the order spreads connections
> across the three backends. It requires no data-path component — the DNS server never
> carries traffic; it only hands out addresses. That is the whole mechanism, and also the
> source of every limitation.

---

## Q2: Why is round-robin DNS not "true" load balancing?

> Because a load balancer, by definition, **observes and reacts to load**; round-robin DNS
> does neither. Four gaps:
>
> 1. **No load awareness.** The authoritative server answers a query and then loses all
>    contact with the client. It never sees the TCP connection, the request, or whether the
>    chosen backend is now at 95% CPU. It rotates *blindly*, by count of queries — not by
>    actual backend load, latency, or connection count.
> 2. **Query-count balancing ≠ load balancing.** Rotating evenly across queries only
>    balances *load* if every query maps to identical work and identical client volume.
>    One resolver behind an ISP represents millions of users; another represents one. Equal
>    query rotation produces wildly unequal traffic.
> 3. **Caching breaks the rotation** (see Q3) — a cached answer is served to a whole
>    population for the TTL, so the "rotation" the authoritative server thinks it is doing
>    does not reach end users per-request.
> 4. **No health reaction per connection.** Plain round-robin keeps handing out a dead
>    backend's IP until a (slow, coarse) health check removes it.
>
> The precise framing: round-robin DNS is a **query distributor**, not a load balancer. It
> shapes *demand across populations*, statistically, not *load across servers*, reactively.

---

## Q3: How does resolver and client caching affect DNS load distribution?

> Caching is what makes DNS scale — and what defeats fair distribution. Between the
> authoritative server and the user sit **recursive resolvers** (ISP resolvers, 8.8.8.8,
> 1.1.1.1, corporate resolvers) and the client's own **stub/OS/browser cache**.
>
> - A single large ISP or public resolver queries the authoritative server **once per TTL**
>   and serves that one cached answer to *millions* of downstream users for the whole TTL.
>   Your intended 50/50 split becomes "whatever fraction of *resolvers* cached which
>   answer" — weighted by each resolver's user base, which you do not control.
> - The effective **unit of load balancing is "one resolver's user base for one TTL,"** not
>   "one request." A few giant resolvers dominate the distribution.
> - Clients pin the resolved IP for the life of a connection pool or page, sometimes longer
>   than the TTL (browsers and stub resolvers honor TTL loosely).
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant U as Millions of Users
>     participant R as One Big Resolver
>     participant A as Authoritative DNS (round-robin)
>     R->>A: query (ONCE per TTL)
>     A-->>R: A=Backend1 (this rotation)
>     Note over R: caches Backend1 for the full TTL
>     U->>R: resolve app.example.com (millions of times)
>     R-->>U: Backend1 (same cached answer to everyone)
>     Note over U,R: rotation never reaches end users;<br/>Backend1 absorbs this resolver's entire population
> ```
> **Takeaway:** DNS distribution is only as fair as the *resolver population is uniform* —
> which it never is.

---

## Q4: Why doesn't lowering the TTL guarantee fast failover?

> Lowering the TTL only **bounds** how long a bad answer *can* stay cached; it does not
> **enforce** it, for three reasons:
>
> 1. **Resolvers may not obey it.** Many recursive resolvers clamp a **minimum TTL** (e.g.,
>    treat anything below 30–300s as their floor). You publish TTL=10; they cache for 300.
> 2. **Serve-stale.** Under RFC 8767, resolvers may serve a stale (expired) answer when the
>    authoritative server is unreachable — so a "dead" answer can outlive its TTL by design.
> 3. **Client-side pinning.** Browsers, OS stubs, and connection pools hold a resolved IP
>    beyond the TTL, so even a perfectly obeyed low TTL doesn't move an already-connected
>    client.
>
> The result is that DNS failover is **best-effort with a long tail**: most traffic moves
> within a TTL, but a stubborn fraction lingers for minutes. Any design that assumes "clean
> cutover in TTL seconds" is wrong — your real RTO is "TTL *plus* the resolver/client tail,"
> which you must **measure**, not read off the published TTL.

---

## Q5: What is the trade-off in choosing a DNS TTL?

> TTL sits at the center of an irreducible tension between **failover speed** and **cache
> efficiency/stability**:
>
> ```text
>                 low TTL <──────────────────────────> high TTL
>  failover speed:    FAST (bounded)                    SLOW
>  authoritative QPS: HIGH (more re-queries)            LOW
>  client stability:  churny (bounce between IPs)       sticky
>  fairness fidelity: better                            worse (long stale windows)
>  blast radius of a bad answer: seconds–minutes        up to full TTL, unrecallable
> ```
>
> - **Low TTL** → quicker (bounded) failover and better fairness, at the cost of much higher
>   authoritative query volume and more client churn/connection setup. It can also create a
>   **thundering herd**: a synchronized population's caches expire together, spiking both
>   re-queries at the authoritative server and new connections at the chosen backend.
> - **High TTL** → cheap and stable, but a dead region stays cached for up to the full TTL,
>   and **DNS has no cache-purge protocol** — you cannot recall a bad answer, only wait it
>   out.
>
> **Practical rule:** moderate TTLs (30–120s) for records that participate in failover;
> never rely on TTL as your *primary* fast-failover mechanism.

---

## Q6: How does DNS load balancing differ from L4 and L7 load balancing?

> They are not competitors — they are layers of one stack, each making a decision at a
> different point in the request lifecycle. The mental model: **DNS picks which *building*;
> L4 picks which *door*; L7 picks which *room* (and whether you're allowed in).**
>
> | Dimension | **DNS LB** | **L4 LB** (TCP/UDP) | **L7 LB** (HTTP/gRPC) |
> |---|---|---|---|
> | When it acts | Resolution time, before connection | Per connection, in data path | Per request, in data path |
> | Unit of balancing | Resolver population / TTL window | TCP/UDP flow | Individual request |
> | Sees the request? | No — only the query name | No — only IP/port 4-tuple | Yes — method, path, headers |
> | Real-time load awareness | None (pre-set weights) | Connection counts, health | Full: latency, errors, queue depth |
> | Failover speed | Best-effort, TTL-bounded, long tail | Seconds (drop dead backend) | Seconds (drop backend/route) |
> | Health-check granularity | Whole endpoint/region, slow | Per backend, sub-second | Per backend + per-path, fast |
> | Session affinity | Accidental, cache-lifetime | Deterministic (flow hash) | Deterministic (cookie/header) |
> | Geographic steering | **Native strength** (GeoDNS/ECS) | No (single-site) | No (single-site) |
> | Cross-region / cross-cloud reach | **Only layer that spans all** | No | No |
> | In the byte path? | No — steers, never carries traffic | Yes | Yes (highest cost) |
> | Typical products | Route 53, NS1, Akamai, Cloud DNS | AWS NLB, Maglev, IPVS | Envoy, NGINX, ALB |
>
> Read it as a layering argument: every row where DNS says "No" is a decision you must push
> *down* to L4/L7; every row where DNS is the only "Yes" (cross-region reach, native geo,
> out-of-band steering) is a decision only DNS can make. Correct global architectures use
> **all three**.

---

## Q7: How do weighted and health-checked DNS routing work?

> These are the two features that lift DNS above plain round-robin (offered by managed
> authoritative providers such as Route 53, NS1, and Cloud DNS):
>
> - **Weighted routing:** you assign weights to records (e.g., 90/10), and the authoritative
>   server returns each answer with a probability proportional to its weight. Used for
>   blue-green or coarse canary steering across *sites*. **Caveat:** because caching skews
>   the population (Q3), the realized split drifts from the published weight — a few big
>   resolvers caching the 90% answer can dominate. So DNS weighting is *coarse*; precise
>   percentage rollouts belong at L7.
> - **Health-checked routing:** the provider actively probes each endpoint (HTTP/TCP/ping)
>   and **removes unhealthy answers from the response set**. This is how DNS does automatic
>   failover — a dead region simply stops being returned. **Caveats:** (a) it is coarse
>   (whole-endpoint/region, not per-connection) and slow (TTL-bounded to take effect), and
>   (b) shallow probes create blind spots — a region can pass a ping health check while
>   serving errors, so probe a **deep, dependency-inclusive endpoint**.

---

## Q8: What is GeoDNS, and what is its weakness?

> GeoDNS returns a different answer based on the **geographic or network location of the
> query source**, so EU users resolve to `eu-west` and US users to `us-east`. This is DNS's
> native strength: "which region" is inherently a coarse, population-scale, geography-shaped
> decision — exactly DNS's grain.
>
> **The core weakness:** GeoDNS sees the **resolver's** location, not the **user's**. A user
> configured to a distant public or corporate resolver (say, a US employee behind a
> corporate resolver homed in Europe) gets steered to the resolver's region, not their own —
> the wrong region, higher latency. This is what EDNS Client Subnet (Q9) exists to mitigate.

---

## Q9: What is EDNS Client Subnet (ECS) and what problem does it solve?

> ECS (RFC 7871) is an EDNS0 option that lets a recursive resolver **forward a truncated
> prefix of the client's IP** (e.g., the /24) to the authoritative server along with the
> query. The authoritative server can then make its geo/latency decision based on the
> *client's* network location instead of the *resolver's* — fixing the GeoDNS blind spot in
> Q8 where users on distant public resolvers get mis-steered.
>
> ```text
>   Without ECS:  auth server sees resolver 8.8.8.8 (anycast, "somewhere") → guesses region
>   With ECS:     resolver sends "client is in 203.0.113.0/24" → auth picks the right region
> ```
>
> **Caveats an interviewer wants to hear:**
> - **Privacy cost:** ECS leaks a slice of the client's address to authoritative servers;
>   some resolvers (notably privacy-focused ones) **strip or don't send it**, so it is not
>   universally honored.
> - **Cache fragmentation:** answers now vary by client subnet, so resolver caches must key
>   on (name, subnet), inflating cache entries and reducing hit rates.
> - It **mitigates but does not eliminate** mis-steering; residual error is corrected
>   downstream by anycast/L7.

---

## Q10: Can DNS provide session affinity (sticky sessions)?

> Only **accidentally**, never reliably. A client that resolves to region A stays on region A
> until its local cache expires — this looks like affinity, but it is a side effect of
> caching, bounded by cache lifetime and non-deterministic (it evaporates on cache expiry or
> connection-pool refresh, and you cannot control its duration).
>
> If you need *deterministic* affinity, it must live in the data path:
> - **L4:** connection/flow hashing (e.g., consistent hashing on the 5-tuple) pins a flow to
>   a backend.
> - **L7:** cookie- or header-based affinity pins a *user session* to a backend.
>
> DNS "affinity" is useful when you happen to want stability (fewer cross-region hops) and a
> liability when you're trying to **drain** a region — cached clients keep coming back until
> their cache expires.

---

## Q11: How does DNS load balancing compose with anycast?

> This composition is the standard fix for DNS's slow failover. **Anycast** announces the
> *same IP* from many locations via BGP; the network routes each client to the topologically
> nearest announcement. The key property: **failover independent of DNS TTL.** When a PoP
> dies, you **withdraw its BGP route**, and traffic reconverges to a live PoP in *seconds* —
> even for clients holding a stale cached DNS answer, because that answer still points at the
> anycast VIP, which BGP has already rerouted.
>
> ```mermaid
> flowchart TD
>     U[User] -->|1. resolve| DNS[GeoDNS: coarse region steer,<br/>weighted, health-checked]
>     DNS -->|2. returns stable ANYCAST VIP| U
>     U -->|3. connect to anycast VIP| BGP{Anycast / BGP<br/>routes to nearest HEALTHY PoP}
>     BGP -->|PoP up| L7A[Region A: L4 to L7 LB<br/>per-request routing, TLS, affinity]
>     BGP -.->|PoP withdrawn in seconds,<br/>NO DNS change needed| L7B[Region B: L4 to L7 LB]
>     L7A --> S1[Backends A: per-backend health]
>     L7B --> S2[Backends B: per-backend health]
> ```
>
> Division of labor: **DNS** does coarse geo steering and whole-region disaster failover
> (slow); **anycast/BGP** does fast PoP-level failover (seconds); **L4/L7 at each PoP** does
> per-connection/per-request work. Each layer covers another's weakness.

---

## Q12: Why publish multiple A records instead of one?

> Two reasons, both about resilience:
>
> 1. **Client-side retry / failover for free.** When several A records are returned, a
>    well-behaved client (or SDK) that fails to connect to the first address **retries the
>    next**. So even a stale cached answer that includes a dead IP is *survivable* as long as
>    it also includes a live one — this is the cheapest mitigation for the "stale cached IP
>    points at a dead region" failure.
> 2. **Coarse load spreading** across the listed endpoints via round-robin.
>
> The caveat: retry-across-records depends on **client behavior**, which varies (browsers
> retry; naive clients that grab only the first record do not). So it *hedges* the risk but
> doesn't eliminate it — pair it with anycast for the real fast-failover guarantee.

---

## Q13: When is DNS the right layer for a steering decision, and when is it wrong?

> Place each decision at the **cheapest layer that can make it correctly**. DNS is right for
> decisions that are **coarse, population-scale, slow-changing, and geography-shaped.**
>
> | DNS is the RIGHT tool for… | DNS is the WRONG tool for… |
> |---|---|
> | Coarse geographic / site steering (GeoDNS/ECS) | Per-request routing (path/header/canary) → L7 |
> | Whole-region disaster failover | Deterministic session affinity → L4/L7 |
> | Steering across independent stacks / clouds | Fast per-backend health failover → L4/L7 |
> | Planet-scale, out-of-band steering (no byte path) | Precise weighting / gradual rollout → L7 |
> | — | Real-time load-adaptive routing (least-conn/latency) → L4/L7 |
>
> The tell in an interview: if the decision needs to **see the request** or **react to live
> load**, it cannot be DNS — DNS only ever sees the query name and never sees the traffic.

---

## Q14: What are the failure modes of DNS-based routing?

> The ones a senior is expected to anticipate:
>
> 1. **Stale cached IP → dead region.** Health check pulls a region, but cached clients keep
>    hitting the dead IP for up to the TTL (longer with min-TTL clamping / serve-stale). Users
>    time out even though the dashboard says "failed over." *Fix:* anycast VIP + moderate TTL
>    + multiple A records + client retry.
> 2. **RTO blown.** DNS-only failover can't meet sub-minute RTO because it's TTL-bounded and
>    best-effort. *Fix:* anycast/BGP or global health-checked L4 for fast failover.
> 3. **Thundering herd on TTL expiry.** Synchronized cache expiry spikes authoritative QPS and
>    backend connections. *Fix:* avoid extreme-low TTLs; authoritative headroom; autoscaling.
> 4. **Weight drift from cache asymmetry.** Big resolvers skew the realized split. *Fix:* do
>    canary at L7.
> 5. **Health-check blind spot.** Shallow probe passes while the app serves errors. *Fix:*
>    deep, dependency-inclusive probes; per-backend L7 health.
> 6. **Provider outage = total outage.** Single authoritative provider is a SPOF for the whole
>    product. *Fix:* two independent authoritative DNS providers on the zone.

---

## Q15 (Scenario): Design multi-region failover using DNS — and explain what breaks.

> **Design:** Two regions, `us-east` and `eu-west`, each fronted by an L4→L7 LB and a
> backend pool. Authoritative DNS (e.g., Route 53) has:
> - **GeoDNS + ECS** routing US traffic to `us-east`, EU traffic to `eu-west`.
> - **Health checks** on a deep endpoint in each region.
> - **Failover policy:** if a region's health check fails, remove it from the answer set so
>   all traffic resolves to the survivor.
> - **Moderate TTL (60s)** on the failover records; **multiple A records** returned.
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant U as US Users
>     participant R as Resolver (cached us-east, TTL 60s)
>     participant HC as DNS Health Check
>     participant A as Authoritative DNS
>     HC->>A: us-east DOWN → remove from answer set
>     Note over A: authoritative now returns eu-west only
>     U->>R: resolve app.example.com
>     R-->>U: us-east (STILL CACHED — 40s left)
>     U->>U: connect to us-east VIP → TIMEOUT
>     Note over U,R: user broken until cache expires;<br/>the DNS change did NOT help this user
>     R->>A: (after expiry) re-query → eu-west
>     R-->>U: eu-west (now recovered)
> ```
>
> **What breaks:**
> - **The stale-cache tail.** For up to the full TTL — and longer for resolvers that clamp
>   minimums or serve stale (RFC 8767) — cached clients keep hitting dead `us-east` and time
>   out. Your *measured* RTO is "TTL + long tail," not 60s.
> - **Cross-region capacity shock.** All US traffic lands on `eu-west` at once. If `eu-west`
>   wasn't provisioned for 2× load, it now falls over too — cascading failure. Failover
>   design must include **capacity headroom** in the survivor.
> - **Latency penalty.** US users now cross the Atlantic — higher RTT, degraded experience.
> - **Thundering herd** as caches expire together and re-connect to `eu-west`.
> - **Weight/geo drift + ECS gaps** mean some users were mis-steered even before the failure.
>
> **The fix (what a strong candidate proposes):** front each region with an **anycast VIP** so
> BGP withdrawal reroutes even cached clients in seconds; reserve DNS for the slower
> whole-*geo* steer; keep multiple A records with client retry; provision the survivor for the
> combined load; quote RTO from the measured tail, not the TTL; and run **two authoritative
> DNS providers** so the control plane itself isn't a SPOF.

---

## Q16: How would you achieve sub-minute RTO if DNS failover is too slow?

> Take failover **off the DNS critical path**. Because DNS is TTL-bounded and best-effort, use
> a mechanism that reroutes *without* waiting for caches to expire:
>
> - **Anycast + BGP withdrawal (preferred).** DNS hands out a stable anycast VIP; when a PoP
>   dies, withdraw its BGP announcement and the network reconverges to a live PoP in seconds —
>   the cached DNS answer still works because it points at the anycast IP.
> - **Health-checked global L4** (e.g., a global network LB with fast per-backend health) that
>   drops a dead backend in sub-second time within the data path.
> - **Client/SDK-level resilience:** multiple endpoints + retry with backoff, so a single dead
>   IP is transparently survivable.
>
> DNS then does only what it's good at — the coarse, slow, whole-region/geo steer — while the
> fast RTO guarantee lives in a layer that actually sees and controls live traffic. The
> summary rule an interviewer wants: **fast failover must never depend on DNS TTL.**

*Next step:* [DNS Caching & TTL — Junior](../04-dns-caching-and-ttl/junior.md)
