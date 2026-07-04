# BGP & Internet Routing — Middle

The Internet is not one network. It is ~75,000 independent networks — **Autonomous Systems (ASes)** — that agree to carry each other's traffic. BGP (Border Gateway Protocol, RFC 4271) is the single protocol that stitches them together. It answers one question: *"To reach this block of IP addresses, which neighbor should I hand the packet to?"* This tier explains the mechanics: how sessions form, how prefixes propagate, how a router picks one path out of many, and how anycast and multi-homing fall out of those rules.

## Contents

1. [Autonomous Systems and prefixes](#1-autonomous-systems-and-prefixes)
2. [eBGP vs iBGP](#2-ebgp-vs-ibgp)
3. [BGP sessions: TCP/179 and message types](#3-bgp-sessions-tcp179-and-message-types)
4. [The AS-path and loop prevention](#4-the-as-path-and-loop-prevention)
5. [Tracing a prefix announcement](#5-tracing-a-prefix-announcement)
6. [Choosing the best path: intro attributes](#6-choosing-the-best-path-intro-attributes)
7. [Anycast mechanics](#7-anycast-mechanics)
8. [Multi-homing](#8-multi-homing)
9. [Convergence at a working level](#9-convergence-at-a-working-level)
10. [Summary](#10-summary)

---

## 1. Autonomous Systems and prefixes

An **Autonomous System** is a network under one administrative control (an ISP, a cloud provider, a large university) identified by a globally unique **AS number** (ASN), e.g. `AS15169` (Google), `AS13335` (Cloudflare).

An AS "owns" one or more **prefixes** — blocks of IP address space written in CIDR notation:

- `93.184.216.0/24` — a `/24` covers 256 addresses (the last 8 bits vary).
- `104.16.0.0/12` — a `/12` covers ~1M addresses.

The whole job of BGP is to distribute, across every AS on the planet, the mapping:

> *prefix → the sequence of ASes you traverse to reach it.*

A router doesn't store individual IP routes; it stores prefixes. When a packet for `93.184.216.34` arrives, the router does a **longest-prefix match** against its table and forwards toward the neighbor advertised for the most specific matching prefix.

---

## 2. eBGP vs iBGP

BGP runs in two modes depending on whether the two peers are in the *same* AS or *different* ASes. The protocol messages are identical; the rules for propagation and next-hop differ.

| Aspect | eBGP (external) | iBGP (internal) |
|---|---|---|
| Peers | Routers in **different** ASes | Routers in the **same** AS |
| Purpose | Exchange routes *between* ASes | Distribute externally-learned routes *within* an AS |
| Typical peer distance | Directly connected (1 hop) | Anywhere in the AS (often via IGP) |
| AS-path on advertise | Router **prepends its own ASN** | AS-path **unchanged** |
| Re-advertisement rule | Routes learned via eBGP are freely re-advertised to all peers | Routes learned via iBGP are **not** re-advertised to other iBGP peers (split-horizon) |
| Default admin distance (Cisco) | 20 (preferred) | 200 |

The iBGP no-re-advertise rule prevents loops *inside* an AS (where the AS-path can't help, since the ASN is the same). It forces a **full mesh** of iBGP sessions — every border router talks directly to every other — or the use of **route reflectors** to scale (that scaling machinery is a Senior/Professional concern).

Mental model: **eBGP decides which AS to leave through; iBGP tells the interior routers what eBGP learned.**

---

## 3. BGP sessions: TCP/179 and message types

BGP is not a broadcast/flooding protocol. Two peers form an explicit, long-lived **session** over **TCP port 179**. Using TCP gives BGP reliable, ordered delivery for free — it never re-implements retransmission.

A session progresses through a state machine: `Idle → Connect → OpenSent → OpenConfirm → Established`. Only in **Established** do peers exchange routes.

Four message types travel over the session:

| Message | Role |
|---|---|
| **OPEN** | Sent once at session start: my ASN, hold time, capabilities. Negotiates the session. |
| **UPDATE** | The workhorse. Carries **NLRI** (prefixes being *advertised*) with their path attributes, and/or **withdrawn routes** (prefixes no longer reachable). |
| **KEEPALIVE** | Periodic heartbeat (default ~60s). If none arrives within the **hold time** (~180s), the peer is declared dead and its routes are withdrawn. |
| **NOTIFICATION** | Sent on error; tears the session down. |

Key point: BGP is **incremental**. After the initial full table dump, a peer only sends UPDATEs for *changes* — a new prefix, a withdrawn prefix, or a changed attribute. It does not periodically re-flood the whole table.

---

## 4. The AS-path and loop prevention

Every advertised prefix carries an **AS-path attribute**: the ordered list of ASNs the advertisement has traversed, most-recent first.

The rule that makes the Internet loop-free is disarmingly simple:

> **When a router *sends* a prefix over an eBGP session, it prepends its own ASN to the front of the AS-path.**
>
> **When a router *receives* a prefix whose AS-path already contains its own ASN, it rejects the route.**

Because your ASN would only already be in the path if the advertisement had passed through you before, seeing it means a loop — so you drop it. No timers, no counters, no coordination. The AS-path is self-describing history.

Example: Google's `8.8.8.0/24` might reach you with AS-path `[7018, 15169]` — "go through AS7018 (AT&T), then you're in AS15169 (Google)." If AS15169 ever received a route with `15169` already in the path, it discards it instantly.

The AS-path also doubles as a rough **distance metric**: fewer ASes usually means a shorter, better path (see §6).

---

## 5. Tracing a prefix announcement

Follow a brand-new prefix `203.0.113.0/24`, owned by **AS1**, as it propagates to **AS2** and then **AS3**. Each eBGP hop prepends an ASN.

```mermaid
sequenceDiagram
    autonumber
    participant AS1 as AS1 (origin)
    participant AS2 as AS2 (transit)
    participant AS3 as AS3 (edge)

    Note over AS1: Operator configures ownership of 203.0.113.0/24
    AS1->>AS2: UPDATE: advertise 203.0.113.0/24, AS-path = [1]
    Note over AS2: Accept. My ASN not in path → no loop.<br/>Install route. Will prepend 2 on re-advertise.
    AS2->>AS3: UPDATE: advertise 203.0.113.0/24, AS-path = [2, 1]
    Note over AS3: Receives it via AS2. AS-path = [2,1].
    AS3->>AS3: Suppose a 2nd copy also arrives from AS4:<br/>203.0.113.0/24, AS-path = [4, 5, 1]
    Note over AS3: Two candidates for the same prefix.<br/>Run best-path selection.
    Note over AS3: [2,1] length 2  vs  [4,5,1] length 3<br/>→ pick shorter AS-path = via AS2
    AS3->>AS3: Install best path; forward traffic toward AS2
    Note over AS3: Traffic for 203.0.113.0/24 now follows AS3 → AS2 → AS1
```

The takeaways:

- The prefix propagates **hop by hop**; there is no central authority. Each AS independently decides to accept and re-advertise.
- The AS-path **grows by one ASN** at each eBGP hop.
- When multiple copies of the same prefix arrive, the receiver runs **best-path selection** and installs exactly one. Traffic then follows that reverse path back to the origin.

---

## 6. Choosing the best path: intro attributes

A busy router routinely holds several candidate routes for the same prefix. BGP runs a deterministic **best-path algorithm** — a tie-break list checked in strict order — and installs one winner. At this tier, know the three attributes that decide most real cases:

| Attribute | Scope | Preference rule | Who sets it / why |
|---|---|---|---|
| **LOCAL_PREF** | Inside one AS (iBGP) | **Higher wins** | Set by *your* AS to express policy — e.g. "prefer the cheap peering link over the expensive transit link." Checked *first*, so it overrides path length. |
| **AS-path length** | Global | **Shorter wins** | The default "closeness" heuristic — fewer ASes to cross. Used when LOCAL_PREF is equal. |
| **MED** (Multi-Exit Discriminator) | Between two ASes sharing multiple links | **Lower wins** | A hint from a *neighbor* AS: "if you have two links into me, use this one." Only compared between routes from the *same* neighbor AS. |

Simplified order the router applies: **LOCAL_PREF → AS-path length → MED**, then further tie-breaks (origin type, IGP metric to the next-hop, router ID). The crucial insight for now:

> **LOCAL_PREF is your own policy and beats everything else. AS-path length is the fallback "shortest route." MED is the neighbor's suggestion and is only weighed within one neighbor's routes.**

The full ordered algorithm — including origin, next-hop IGP cost, and oldest-route tie-breaks — is covered at the Professional tier.

---

## 7. Anycast mechanics

**Anycast** is a technique that falls directly out of best-path selection — it needs no new protocol.

The idea: **announce the same prefix from many geographically separate sites.** A CDN might advertise `1.1.1.0/24` from data centers in Tokyo, Frankfurt, and São Paulo, each from the same ASN.

Because every router across the Internet runs best-path selection, each one independently converges on the *topologically nearest* copy of that prefix — the one with the shortest AS-path (and closest IGP metric) from *its* vantage point. The result:

- A user in Japan is routed to the Tokyo site.
- A user in Brazil is routed to the São Paulo site.

No DNS trickery, no geo-database, no central load balancer decides this. **BGP's per-router shortest-path choice does the routing automatically.** Each user hits the site the Internet's topology says is closest.

This is why public DNS (`1.1.1.1`, `8.8.8.8`), CDNs, and DDoS scrubbing services are built on anycast: one IP, served from hundreds of locations, with the network itself steering each request. (Caveat: because any router may re-converge to a different site mid-flow, anycast suits stateless or short-lived requests best — a Senior-tier concern.)

---

## 8. Multi-homing

**Multi-homing** means an AS connects to **two or more upstream providers** instead of one. It advertises the *same* prefix to both.

```
                 ┌────────── AS100 (Provider A) ──────── Internet
                 │
   Your AS65001 ─┤   advertises 198.51.100.0/24 to BOTH
                 │
                 └────────── AS200 (Provider B) ──────── Internet
```

What this buys you:

- **Redundancy.** If the link to Provider A fails, its KEEPALIVEs stop, the session drops, its routes are withdrawn, and traffic re-converges onto Provider B — automatically, in seconds. Your prefix stays reachable.
- **Inbound path influence.** By tuning outbound advertisements (e.g. **AS-path prepending** — listing your ASN multiple times toward Provider B so its path looks longer and less preferred), you can nudge which provider the world uses to reach you.
- **Outbound path choice.** Using **LOCAL_PREF** internally, you decide which provider *your* outbound traffic prefers (e.g. the one with the cheaper transit contract).

Multi-homing is *the* reason a company runs its own BGP: it turns "the Internet" into a resource with two independent, self-healing on-ramps rather than a single point of failure.

---

## 9. Convergence at a working level

**Convergence** is the interval between a topology change (a link fails, a prefix is withdrawn, a new path appears) and the moment *every* router has settled on a consistent, loop-free set of best paths again.

The working-level picture:

1. A change occurs — say AS2's link to AS1 goes down.
2. AS2 notices (KEEPALIVE timeout or interface-down) and sends **UPDATE withdrawals** for the prefixes it can no longer reach that way.
3. Neighbors receive the withdrawals, remove those routes, **re-run best-path selection**, and may promote a previously-second-choice route (e.g. via AS4).
4. If their best path changed, they send their *own* UPDATEs onward — the change ripples outward hop by hop.
5. When the ripple stops and no router's table is changing, the network has **converged**.

Practical characteristics to remember:

- BGP convergence is **not instant** — it can take seconds to minutes on the global table, because changes propagate AS-by-AS and routers deliberately damp flapping.
- During convergence, transient **micro-loops** or brief unreachability can occur before all routers agree.
- Withdrawals and re-advertisements are **incremental** — only the affected prefixes move, not the whole table.

For a system designer, the operational consequence is: a BGP-level failover (an upstream dying, an anycast site being drained) is measured in **seconds**, not milliseconds — fine for surviving outages, too slow to be a request-level load-balancing mechanism.

---

## 10. Summary

- The Internet is a mesh of **Autonomous Systems**; BGP distributes **prefix → AS-path** mappings between them.
- **eBGP** exchanges routes between ASes (prepending your ASN); **iBGP** distributes them inside your AS (no re-advertise to other iBGP peers).
- Sessions run over **TCP/179**; peers exchange **OPEN / UPDATE / KEEPALIVE / NOTIFICATION**, and UPDATEs are **incremental** advertisements and withdrawals.
- The **AS-path** gives loop prevention for free: reject any route already containing your ASN.
- Best-path selection is a strict tie-break list; at this tier, **LOCAL_PREF (policy) → AS-path length (shortest) → MED (neighbor hint)**.
- **Anycast** = one prefix from many sites; BGP routes each user to the nearest copy automatically.
- **Multi-homing** = two upstreams advertising the same prefix, giving self-healing redundancy and path control.
- **Convergence** after a change is hop-by-hop and takes seconds, not milliseconds.

*Next step:* [BGP & Internet Routing — Senior](senior.md)
