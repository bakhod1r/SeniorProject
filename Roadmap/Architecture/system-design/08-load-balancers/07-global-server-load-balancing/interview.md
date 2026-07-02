# Global Server Load Balancing — Interview

Global Server Load Balancing (GSLB) is the tier of traffic management that sits *above* per-region load balancers and decides **which region a request should even reach** — before any regional L4/L7 balancer sees it. It is where system-design candidates get separated: most know how a local load balancer picks a server; far fewer can reason precisely about DNS TTLs, anycast withdrawal, region-loss capacity math, and the fact that GSLB routes traffic but does **not** solve data consistency.

## Table of Contents
1. [Q1: What is GSLB and how is it different from a local load balancer?](#q1-what-is-gslb-and-how-is-it-different-from-a-local-load-balancer)
2. [Q2: What are the two main GSLB implementation mechanisms?](#q2-what-are-the-two-main-gslb-implementation-mechanisms)
3. [Q3: DNS-based vs anycast GSLB — trade-offs?](#q3-dns-based-vs-anycast-gslb--trade-offs)
4. [Q4: What routing policies does a GSLB offer?](#q4-what-routing-policies-does-a-gslb-offer)
5. [Q5: Why is DNS-based failover slow?](#q5-why-is-dns-based-failover-slow)
6. [Q6: How do you make failover faster despite DNS?](#q6-how-do-you-make-failover-faster-despite-dns)
7. [Q7: Active-active vs active-passive multi-region?](#q7-active-active-vs-active-passive-multi-region)
8. [Q8: What problem does GSLB NOT solve?](#q8-what-problem-does-gslb-not-solve)
9. [Q9: How does GSLB decide a region is unhealthy?](#q9-how-does-gslb-decide-a-region-is-unhealthy)
10. [Q10: Region-loss capacity planning — the N+1 rule?](#q10-region-loss-capacity-planning--the-n1-rule)
11. [Q11: What are RTO and RPO, and how do they drive the design?](#q11-what-are-rto-and-rpo-and-how-do-they-drive-the-design)
12. [Q12: How does geo-routing interact with data residency and latency?](#q12-how-does-geo-routing-interact-with-data-residency-and-latency)
13. [Q13: Why can't you just health-check and repoint DNS in seconds?](#q13-why-cant-you-just-health-check-and-repoint-dns-in-seconds)
14. [Q14: How do anycast and DNS GSLB combine in practice?](#q14-how-do-anycast-and-dns-gslb-combine-in-practice)
15. [Q15: Scenario — design multi-region routing + failover for a global app.](#q15-scenario--design-multi-region-routing--failover-for-a-global-app)
16. [Q16: What are the hard parts interviewers probe on?](#q16-what-are-the-hard-parts-interviewers-probe-on)

---

## Q1: What is GSLB and how is it different from a local load balancer?
> A **local load balancer** (L4/L7) distributes requests across servers *inside one region/datacenter* — it assumes the request has already arrived at that region. **GSLB** operates one level up: it steers a client toward *which region* to hit at all, based on the client's location, region health, latency, and capacity. The mental model is two nested layers:
>
> ```mermaid
> graph TD
>     Client[Client] --> GSLB{GSLB<br/>which region?}
>     GSLB -->|us-east| LB1[Regional LB us-east]
>     GSLB -->|eu-west| LB2[Regional LB eu-west]
>     GSLB -->|ap-south| LB3[Regional LB ap-south]
>     LB1 --> A1[App servers]
>     LB2 --> A2[App servers]
>     LB3 --> A3[App servers]
> ```
>
> Key distinction: a local LB sees connections (it can do least-connections, sticky sessions, per-request L7 routing). GSLB usually sees only *DNS resolutions* or *BGP routes* — it decides at a coarser grain, often per-client-resolver rather than per-request, which is why it reacts more slowly.

## Q2: What are the two main GSLB implementation mechanisms?
> **DNS-based** and **anycast (BGP-based)**.
> - **DNS-based:** an authoritative DNS server returns a *different A/AAAA record depending on who is asking* (resolver location, health, policy). The client is "routed" by being handed a region-specific IP. Examples: Route 53, Cloudflare/NS1/Akamai GTM, F5 GTM.
> - **Anycast:** the *same IP address* is advertised via BGP from every region. The internet's routing fabric delivers the packet to the topologically nearest advertising site. Failover is achieved by *withdrawing* the BGP route from a dead region.
>
> Many large systems layer both: anycast to reach the nearest edge/PoP, then DNS or edge logic to steer to the right backend region.

## Q3: DNS-based vs anycast GSLB — trade-offs?
> | Dimension | DNS-based GSLB | Anycast (BGP) GSLB |
> |---|---|---|
> | Routing granularity | Per resolver (coarse) | Per network path (routing-table) |
> | Failover speed | Slow — bounded by TTL + resolver caching | Fast — BGP reconvergence (seconds to ~1 min) |
> | Client sees | A region-specific IP | One stable IP everywhere |
> | Policy richness | High — geo, latency, weighted, failover, custom | Low — mostly "nearest by BGP", weighting is crude |
> | "Nearest" accuracy | Approx — based on resolver, not client (EDNS Client Subnet helps) | Good — based on real network topology |
> | Mid-session stability | Stable (IP fixed for TTL) | Can flap — a route change mid-connection may reset TCP |
> | Best for | HTTP APIs, rich policy, per-geo routing | Latency-critical/UDP, DDoS absorption, stateless |
>
> Practical read: DNS gives you *policy control* but *slow reaction*; anycast gives you *fast reaction* and *topological nearness* but *crude policy and connection instability under route change*. Real designs combine them.

## Q4: What routing policies does a GSLB offer?
> The standard set:
> - **Geo / geolocation:** route by the client's geographic region (EU users → eu-west). Also used for data-residency compliance, not just latency.
> - **Latency-based:** route to the region with the lowest *measured* network latency for that resolver/client — subtly different from geo, because nearest-by-map isn't always nearest-by-network.
> - **Weighted:** split traffic by percentage (e.g., 90/10) — used for gradual migration, canary regions, or cost-shaping.
> - **Failover (active-passive):** send all traffic to primary; only serve the secondary's record when the primary fails health checks.
> - **Multivalue / round-robin:** return several healthy IPs and let the client pick — poor-man's load spread, not true balancing.
>
> Strong answers note these compose: e.g., *geo* to pick a continent, then *weighted* within it, with *failover* as the backstop.

## Q5: Why is DNS-based failover slow?
> Because the "route" is a cached DNS record, and you do not control the cache. When a region dies, you update the authoritative record — but every layer in between is holding the old answer:
>
> ```mermaid
> sequenceDiagram
>     autonumber
>     participant App as App / OS
>     participant Res as Recursive Resolver
>     participant Auth as Authoritative GSLB DNS
>     Note over Auth: Primary region dies. Record updated to secondary IP.
>     App->>Res: resolve api.example.com
>     Res-->>App: returns CACHED primary IP (TTL not expired)
>     Note over App,Res: client keeps hitting the DEAD region
>     Note over Res: TTL expires
>     App->>Res: resolve again
>     Res->>Auth: cache miss, re-query
>     Auth-->>Res: secondary IP
>     Res-->>App: secondary IP (recovery)
> ```
>
> The delays stack: (1) **health-check detection** time; (2) **authoritative propagation**; (3) the **record TTL** must expire in every resolver; (4) many resolvers and OS/browser/app-layer caches **ignore or clamp TTLs** — some enforce a minimum, browsers pin connections, and stub resolvers cache aggressively. A "60-second" TTL routinely produces multi-minute real-world failover. You are trusting third parties to honor a value you set, and many don't.

## Q6: How do you make failover faster despite DNS?
> Layered mitigations, roughly in order of effectiveness:
> - **Short TTLs** (e.g., 30–60 s) on the records that fail over — accepting more DNS query load. This is the floor of what DNS alone can do, and it's still slow because of non-honoring resolvers.
> - **Anycast for the fast path:** withdraw the BGP route from the dead region so *the same IP* stops being advertised there. Reconvergence is seconds, and clients need no new DNS answer. This is why latency/availability-critical systems front with anycast.
> - **Client-side / application failover:** the client library holds multiple region endpoints and retries the next one on error, independent of DNS (e.g., SDKs with endpoint lists, Happy Eyeballs–style racing).
> - **Health-checked DNS with fast checks:** aggressive health-check interval + low failure threshold so the authoritative answer flips quickly (removes step 1's delay, not the TTL delay).
> - **Global load balancers with anycast VIPs** (e.g., cloud "global" L7 LBs): the VIP is stable, failover happens inside the provider's fabric, not via client DNS.
>
> The honest interview point: **DNS failover is a coarse, slow backstop; sub-minute failover needs anycast or client-side retry, not DNS TTL tuning.**

## Q7: Active-active vs active-passive multi-region?
> | | Active-active | Active-passive |
> |---|---|---|
> | Traffic | All regions serve live traffic | Only primary serves; standby idle/warm |
> | Failover | Shed dead region's share to survivors | Promote standby to primary |
> | Utilization | High — every region earns its cost | Low — you pay for idle standby |
> | Data problem | Hard — multi-master / conflict resolution | Easier — one writer, standby replicates |
> | Failover speed | Fastest — survivors already live | Slower — promotion + warm-up + DNS/anycast flip |
> | Blast radius on failover | Survivors absorb extra load (capacity risk) | Standby takes full load (must be sized for it) |
>
> Active-active maximizes utilization and availability but forces you to confront **multi-region write consistency**. Active-passive sidesteps the write-conflict problem (single writer) but wastes capacity and has slower, riskier failover. Many teams run **active-active for reads / active-passive for writes** as a pragmatic middle ground.

## Q8: What problem does GSLB NOT solve?
> **Data consistency and state replication.** GSLB is a traffic router — it moves a *request* to a healthy region. It says nothing about whether that region has the *data* to answer correctly. If you fail traffic over to a secondary region whose database is 30 seconds behind, GSLB has done its job perfectly and your users still see stale or lost writes.
>
> So GSLB does not give you: cross-region write consistency, conflict resolution for concurrent multi-master writes, session/state affinity (the standby may not have the user's in-memory session), or replication lag guarantees. These are database/replication concerns (see leader-follower, multi-master, RPO). A classic candidate mistake is presenting GSLB as "and now we're multi-region and highly available" while ignoring that the *data* layer must independently be made multi-region-safe.

## Q9: How does GSLB decide a region is unhealthy?
> Via **health checks**, but the design nuance is *what* it checks and *from where*:
> - **Shallow checks** (TCP connect, ping, `/healthz` returns 200) are cheap and fast but can report "healthy" while the region is actually broken deeper down.
> - **Deep / synthetic checks** exercise a real dependency path (DB reachable, can serve a canary request) — truer signal, but slower and can false-positive on a single flaky dependency.
> - **Vantage points:** checks should run from *multiple external locations*, because a region may be reachable from one network and partitioned from another. A single checker is a single point of misjudgment.
> - **Thresholds/hysteresis:** flip after N consecutive failures and require M successes to recover, to avoid flapping — but this *adds* to detection latency (part of RTO).
>
> Tension: aggressive checks → fast detection but flapping and false failovers (which themselves cause outages); conservative checks → stable but slow. This trade-off is the detection component of your failover time budget.

## Q10: Region-loss capacity planning — the N+1 rule?
> If any single region can fail, the *surviving* regions must together be able to absorb **100% of traffic**, or you've merely moved the outage. This is **N+1** capacity planning: provision N regions such that N−1 can carry the full load.
>
> Worked example: 3 active-active regions, 3,000 req/s each = 9,000 req/s total. If one dies, the other two must serve 9,000 req/s → 4,500 each. So each region must be provisioned for **4,500 req/s, not 3,000** — i.e., run at ~67% utilization in steady state, leaving 33% headroom. General rule for R equal active regions surviving one loss: each region must handle `total / (R−1)`, giving a steady-state utilization ceiling of `(R−1)/R`.
>
> | Active regions | Steady-state max utilization | Headroom reserved for failover |
> |---|---|---|
> | 2 | 50% | 50% (each must carry 2×) |
> | 3 | 67% | 33% |
> | 4 | 75% | 25% |
> | 5 | 80% | 20% |
>
> More regions → cheaper failover headroom, but more replication/consistency complexity and cost. The candidate mistake is running all regions hot (near 100%) — the first failover then overloads survivors and *cascades* the failure to every region.

## Q11: What are RTO and RPO, and how do they drive the design?
> - **RTO (Recovery Time Objective):** the maximum acceptable *time to recover* — how long may you be down/degraded during failover. Drives your **routing/failover mechanism**: DNS-only gets you minutes (bad RTO); anycast + active-active gets you seconds.
> - **RPO (Recovery Point Objective):** the maximum acceptable *data loss* measured in time — how many seconds/minutes of writes may vanish when you fail over. Drives your **replication strategy**: async replication → RPO = replication lag (you lose in-flight writes); synchronous replication → RPO ≈ 0 but adds write latency (cross-region RTT per write).
>
> They pull in opposite directions from cost: RTO≈0 wants active-active + anycast (utilization/consistency cost); RPO≈0 wants synchronous cross-region writes (latency cost). A design statement should name both explicitly, e.g., *"RTO 30 s via anycast withdrawal + already-warm secondary; RPO 5 s accepting async replication lag."* Answering the failover question without stating RPO is a red flag — it means you haven't thought about the data you'll lose.

## Q12: How does geo-routing interact with data residency and latency?
> Two motivations that usually align but sometimes conflict:
> - **Latency:** route users to the nearest region → lowest RTT. This is a performance optimization.
> - **Data residency / compliance (e.g., GDPR):** EU users' data must stay in the EU regardless of latency. This is a *hard constraint*, and it can override latency (an EU user traveling to Asia must still be served/stored under EU rules).
>
> The subtlety: geo-routing by *resolver location* can misroute (the resolver isn't the user — this is where **EDNS Client Subnet** matters, passing a truncated client IP so the authoritative DNS can decide by real client geo). And residency means routing isn't purely "nearest": you may pin a user's *writes* to their home region (correct data placement) while serving *reads* from the nearest cache. Conflating "route to nearest" with "store nearest" is a common error — nearest-for-latency and home-region-for-compliance are different decisions.

## Q13: Why can't you just health-check and repoint DNS in seconds?
> Because you control the *authoritative answer*, not the *cached copies*. Even with a 1-second health check and instant authoritative update, the flip is gated by TTL expiry across the entire resolver population, and:
> - Recursive resolvers cache for the TTL — but some **clamp minimum TTLs** (won't honor your 30 s, enforce 300 s).
> - **Browsers and OS stub resolvers** cache independently and pin connections; a browser may hold a dead IP for the life of a keep-alive connection.
> - Some resolvers **serve stale** on purpose (RFC 8767) to survive authoritative outages — helpful for availability, harmful for fast failover.
> - Load among resolvers is uneven, so failover is *gradual*, not atomic — you get a long tail of clients still hitting the dead region.
>
> Net: DNS was designed for caching and stability, which is exactly the property that makes it a poor fast-failover mechanism. Sub-minute, reliable failover comes from **anycast withdrawal** (routing layer, no client cache) or **client-side retry** (application layer), with DNS as the slower, broader backstop.

## Q14: How do anycast and DNS GSLB combine in practice?
> A common production topology uses both, each at the layer it's good at:
>
> ```mermaid
> graph TD
>     Client[Client] --> DNS[DNS GSLB<br/>geo/latency policy]
>     DNS -->|returns anycast VIP| Edge{Anycast VIP<br/>BGP nearest PoP}
>     Edge --> PoP1[Edge PoP A]
>     Edge --> PoP2[Edge PoP B]
>     PoP1 --> Origin1[Origin region 1]
>     PoP2 --> Origin2[Origin region 2]
> ```
>
> DNS applies rich policy and hands back a **stable anycast IP**; anycast then delivers to the nearest healthy PoP and gives *fast* failover via route withdrawal without needing a new DNS answer. You get DNS's policy + anycast's speed. The DNS layer handles coarse geo/compliance steering and slow, broad failover; the anycast layer handles topological nearness and fast, IP-stable failover. This is essentially how large CDNs/edge platforms front global apps.

## Q15: Scenario — design multi-region routing + failover for a global app.
> **Prompt:** *A global app with users on three continents needs low latency and to survive the loss of an entire region.*
>
> **A structured answer:**
> 1. **Regions:** 3 active-active regions (NA, EU, APAC), each sized to N+1 — steady-state ≤ 67% utilization so any two can absorb 100% (Q10).
> 2. **Global routing:** DNS GSLB with **latency-based** policy (with EDNS Client Subnet for accuracy) to steer each user to the nearest region, **plus geo overrides** for data-residency (EU users pinned to EU for writes). Front origins with an **anycast VIP** so failover is IP-stable and fast (Q14).
> 3. **Health & failover:** multi-vantage-point deep health checks with hysteresis. On region loss: **withdraw anycast route** (seconds) as the fast path; DNS record failover as the slow, broad backstop; client SDK retries next endpoint on error.
> 4. **Data layer (the hard part):** decide read/write topology. Reads served locally from replicas everywhere. Writes: either **single-writer per data partition** (route writes to the record's home region — avoids conflicts, active-passive for writes) or **multi-master with conflict resolution** (true active-active, harder). State RPO from the replication mode (async ⇒ RPO = lag).
> 5. **Targets:** state **RTO ≈ 30 s** (anycast + already-warm survivors) and **RPO ≈ few seconds** (async replication), and note the cost/complexity of driving either toward zero.
> 6. **Capacity on failover:** confirm survivors won't be overloaded (the whole point of N+1), and that autoscaling can't be relied on to save you in the first 60 seconds — headroom must be *pre-provisioned*.
>
> The answer that impresses spends most of its time on step 4 and on capacity math, because those are where GSLB *doesn't* save you.

## Q16: What are the hard parts interviewers probe on?
> The signal-rich follow-ups, and the strong-answer stance on each:
> - **"You failed over — is your data there?"** GSLB routes traffic, not state. Name your RPO and replication mode (Q8, Q11). Failing to mention data loss is the top red flag.
> - **"How fast is failover, really?"** Distinguish detection time, propagation, and TTL/anycast reconvergence. Don't claim DNS gives seconds (Q5, Q13).
> - **"Can the survivors take the load?"** N+1 math; pre-provisioned headroom; autoscaling is too slow for the first minute (Q10).
> - **"Nearest by what?"** Resolver vs client geo, EDNS Client Subnet, geo vs latency vs residency (Q12).
> - **"What about mid-session flapping?"** Anycast route changes can reset connections; DNS is more session-stable (Q3).
> - **"When would you NOT go multi-region?"** If your data can't tolerate multi-region writes, or the app is small enough that one region + backups meets RTO/RPO more cheaply — multi-region adds serious consistency and cost complexity that is not free availability.
>
> A great candidate treats GSLB as *one* layer of a multi-region strategy — routing — and spends equal energy on the data-consistency and capacity layers that GSLB deliberately leaves unsolved.

---

## References
- Route 53 routing policies (geo, latency, weighted, failover): https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html
- Route 53 health checks & DNS failover: https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover.html
- Cloudflare — what is anycast: https://www.cloudflare.com/learning/cdn/glossary/anycast-network/
- Cloudflare — GSLB: https://www.cloudflare.com/learning/performance/what-is-global-server-load-balancing-gslb/
- EDNS Client Subnet (RFC 7871): https://www.rfc-editor.org/rfc/rfc7871
- Serving stale DNS data (RFC 8767): https://www.rfc-editor.org/rfc/rfc8767
- Google Cloud — global external load balancing with anycast: https://cloud.google.com/load-balancing/docs/https

*Next step:* [HTTP — Junior](../../09-communication/01-http/junior.md)
