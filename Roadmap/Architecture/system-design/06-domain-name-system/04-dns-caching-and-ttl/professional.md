# DNS Caching & TTL — Professional

TTL is a single unsigned integer, yet it silently governs the availability, propagation speed, and origin load of every DNS-dependent system on the planet. At the professional tier the job is to stop treating TTL as "a number of seconds" and start treating it as a **protocol field with precise wire semantics, RFC-mandated bounds, and a well-defined cache state machine** — including the negative-caching and serve-stale extensions that most operators never read. This section pins every claim to an RFC and gives you the arithmetic that connects a TTL value to origin QPS.

## Table of Contents

1. [The TTL Field on the Wire (RFC 1035)](#1-the-ttl-field-on-the-wire-rfc-1035)
2. [RFC 2181 §8: The 31-Bit Clamp and RRset TTL](#2-rfc-2181-8-the-31-bit-clamp-and-rrset-ttl)
3. [Where TTL Lives: Authoritative vs Cached Countdown](#3-where-ttl-lives-authoritative-vs-cached-countdown)
4. [Negative Caching (RFC 2308): SOA MINIMUM Redefined](#4-negative-caching-rfc-2308-soa-minimum-redefined)
5. [Cache-Entry Lifecycle State Machine](#5-cache-entry-lifecycle-state-machine)
6. [Serve-Stale (RFC 8767)](#6-serve-stale-rfc-8767)
7. [Origin QPS as a Function of TTL](#7-origin-qps-as-a-function-of-ttl)
8. [RFC Role Comparison](#8-rfc-role-comparison)

---

## 1. The TTL Field on the Wire (RFC 1035)

Every resource record (RR) in a DNS message carries its own TTL. In the wire format defined by **RFC 1035 §3.2.1**, the RR layout is:

```
NAME | TYPE (16) | CLASS (16) | TTL (32) | RDLENGTH (16) | RDATA
```

The **TTL is a 32-bit field**. RFC 1035 §3.2.1 describes it as *"a 32 bit signed integer that specifies the time interval that the resource record may be cached before the source of the information should again be consulted. Zero values are interpreted to mean that the RR can only be used for the transaction in progress, and should not be cached."*

Two facts from that definition carry weight:

- **TTL = 0 means "do not cache."** The record is usable for the current resolution transaction only. This is the mechanism behind DNS-based failover and dynamic load-distribution answers that must never be pinned.
- The original text says **signed**, which is the source of a long-standing ambiguity: is the top bit a sign bit (allowing "negative" TTLs) or is it simply the high bit of a magnitude? RFC 1035's own §4.1.3 muddies it further by describing the same field as an unsigned interval. This contradiction is exactly what RFC 2181 was written to resolve (Section 2).

TTL is expressed in **seconds**. It is a relative duration, not an absolute timestamp — a critical property, because it means a record can be cached, re-served, and re-cached down a chain of resolvers, and each hop only needs to know "how many more seconds," never a synchronized clock.

---

## 2. RFC 2181 §8: The 31-Bit Clamp and RRset TTL

**RFC 2181 ("Clarifications to the DNS Specification"), §8** exists precisely to kill the signed/unsigned ambiguity. It states that the TTL is **an unsigned number, with a minimum value of 0 and a maximum value of 2147483647** — that is, `0 .. 2^31 − 1`. The reasoning:

> *"Implementations should treat TTL values received with the most significant bit set as if the entire value received was zero."*

So the **top bit is treated as poison**: any TTL with bit 31 set (values ≥ 2³¹) must be clamped to 0, not interpreted as a huge duration or a negative number. This closes the door on both "negative TTL" nonsense and on a hostile or buggy authority handing out a ~136-year cache lifetime that overflows naïve signed arithmetic. The usable range is therefore `[0, 2147483647]` seconds (~68 years).

RFC 2181 §5.2 adds the second load-bearing clarification: **TTL is a property of the RRset, not of individual records within it.** An RRset is the set of all records sharing the same name, class, and type (e.g., all A records for `www.example.com`). §5.2 mandates:

- All records in an RRset **must** be sent from an authority with the same TTL.
- If a resolver receives an RRset whose records disagree on TTL (a misconfiguration or an on-path merge), it **should** treat the TTLs as though they were all the *lowest* TTL in the set, and **may** log an error. It must never cache different members of one RRset for different durations.

This is why you cannot give one A record in a rotation a longer life than its siblings: the RRset is the atomic caching unit.

---

## 3. Where TTL Lives: Authoritative vs Cached Countdown

The same 32-bit field means two different things depending on which side of the cache boundary you stand.

**At the authoritative server**, the TTL is a **static configuration value**. It is read verbatim from the zone file (or the zone's `$TTL` directive / per-RR override) and stamped into every answer. It does **not** count down. If the zone says the A record TTL is 300, every authoritative answer ships `300`, forever, until the operator edits the zone. Authoritative TTL is a *policy*, not a clock.

**At a caching resolver**, the received TTL becomes the **initial value of a countdown timer.** When the resolver caches the RRset, it records either `expiry = now + TTL` or an equivalent decrementing counter. On every subsequent client query served from cache, the resolver must return the **remaining** TTL — `expiry − now`, floored at 0 — not the original value. RFC 2181 §5.2 and RFC 1035 §4.1.3 both assume this: the TTL a downstream client sees is the *residual* lifetime, so a second-hop resolver caches only for what's left.

The consequence that surprises people: **a record with authoritative TTL 3600 might be served to your resolver with a remaining TTL of 12** if the record has been sitting in an upstream forwarder's cache for nearly an hour. TTL down a resolution chain is monotonically non-increasing. When you `dig` a name twice a few seconds apart against a caching resolver and watch the TTL decrease, you are literally reading the countdown timer; when it drops to 0 the entry is evicted or refetched and the number jumps back up to the authoritative value.

This also means **DNS "propagation" is a misnomer.** Nothing is pushed. A TTL change only takes effect after every cache that holds the old record lets its countdown reach 0. The worst-case propagation delay for a *change* is bounded by the *old* record's TTL, not the new one — which is why operators lower a record's TTL well in advance of a planned migration.

---

## 4. Negative Caching (RFC 2308): SOA MINIMUM Redefined

Caching a *successful* answer is obvious. Caching a *failure* — "this name does not exist" (NXDOMAIN) or "this name exists but has no record of this type" (NODATA) — is what **RFC 2308 ("Negative Caching of DNS Queries")** standardizes. Without it, every miss for a nonexistent name would hammer the authority indefinitely.

RFC 2308's central move is a **redefinition of the SOA record's MINIMUM field.** In the original RFC 1035, `SOA.MINIMUM` was intended as a default/minimum TTL for the zone. RFC 2308 §4 repurposes it:

> *"The MINIMUM field of the SOA record and the TTL of the SOA itself is used to control the length of time to cache a negative answer."*

Precisely, the negative-cache TTL is the **minimum of the SOA's own TTL and the SOA MINIMUM field:**

```
negative_TTL = min( SOA.TTL , SOA.MINIMUM )
```

When an authority returns NXDOMAIN or NODATA, it includes the zone's SOA record in the authority section. The resolver caches the *negative* result for `negative_TTL` seconds and answers subsequent queries for that name from cache without re-contacting the authority. RFC 2308 §5 also caps negative caching: implementations **should** enforce an upper bound (commonly 3 hours / 10800s) regardless of what the SOA says.

Two negative response types are distinguished:

- **NXDOMAIN** — the queried name does not exist at all (RCODE 3). RFC 8020 later reinforced that NXDOMAIN applies to the whole name and everything below it.
- **NODATA** — the name exists but has no RRset of the requested type (RCODE 0, empty answer, authoritative). RFC 2308 §2.2 defines the three sub-cases by whether the authority section carries an SOA and/or NS.

The operational lever: **SOA MINIMUM is your negative-caching TTL.** Set it too high and a mistakenly-missing record stays "does not exist" in caches for a long time even after you create it; set it too low and typo/probe traffic for nonexistent names floods your authority.

---

## 5. Cache-Entry Lifecycle State Machine

A cached RRset moves through a small set of well-defined states. The classic (pre-serve-stale) model has three: **Fresh**, **Expired/Evicted**, and a transient **Refetching**. Serve-stale (Section 6) inserts a **Stale-but-servable** window between expiry and eviction.

```mermaid
stateDiagram-v2
    [*] --> Fresh : cache RRset (t = 0, ttl = T)

    Fresh --> Fresh : query hit\nreturn remaining TTL
    Fresh --> Expiring : remaining TTL == 0\n(countdown reaches zero)

    Expiring --> Refetching : query arrives\ntrigger authoritative lookup
    Refetching --> Fresh : SUCCESS\nre-stamp ttl = new T
    Refetching --> Stale : lookup FAILS\n(timeout / SERVFAIL)\nRFC 8767

    Stale --> Fresh : async refetch SUCCEEDS
    Stale --> Evicted : stale window exceeded\n(max-stale expired)

    Expiring --> Evicted : LRU pressure\nno query arrives

    Evicted --> [*]
```

State semantics:

- **Fresh** — `remaining_TTL > 0`. Hits are served directly, decrementing the shared countdown. No network I/O.
- **Expiring** — `remaining_TTL == 0`. The entry is no longer authoritative-valid. In a strict resolver this immediately transitions to Refetching on the next query (or to Evicted under memory pressure with no query).
- **Refetching** — the resolver is performing the upstream lookup. Well-built resolvers apply **request coalescing** here (a single in-flight query for many waiting clients) to avoid a stampede — the DNS analog of cache-stampede/thundering-herd control.
- **Stale** — only reachable in serve-stale mode: the refetch failed, so the resolver keeps serving the expired data for a bounded window while retrying in the background.
- **Evicted** — the entry is gone; the next query starts a cold lookup at `[*]`.

---

## 6. Serve-Stale (RFC 8767)

**RFC 8767 ("Serving Stale Data to Improve DNS Resiliency")** formalizes the Stale state. Its thesis: an expired-but-recently-valid answer is almost always better than a resolution failure. When an authoritative lookup cannot be completed (authority unreachable, DDoS, network partition, upstream SERVFAIL), a resolver **may** return the stale cached RRset rather than fail the client.

The mechanism, per RFC 8767 §4 and §6, has three tunables:

| Parameter | RFC 8767 default (recommended) | Meaning |
|---|---|---|
| **client-response-timeout** | ~1.8 s | If a fresh resolution isn't ready within this budget, serve stale immediately (don't make the client wait for a slow authority). |
| **max-stale-TTL** | 1–3 days | Maximum age past expiry that stale data remains servable; after this the entry is discarded. |
| **stale answer TTL** | 30 s | The TTL *value* stamped on a stale answer handed to the client, so downstream caches retry soon. RFC 8767 §4 recommends stale answers carry a short TTL (and NOT 0, which some clients mishandle). |

The state flow: on expiry the entry is retained (not evicted) until `now > expiry + max-stale-TTL`. When a query arrives for an expired entry, the resolver kicks off a refetch and, if the refetch does not complete within `client-response-timeout` *or* fails outright, it serves the stale RRset with the short stale-answer TTL. A successful async refetch re-promotes the entry to Fresh. This is precisely the `Refetching → Stale → Fresh/Evicted` sub-graph in Section 5.

Serve-stale converts a hard availability dependency on your DNS authorities into a soft one: an authority outage degrades to "answers a few minutes/hours out of date" instead of "the whole domain goes dark." The cost is correctness — during the stale window, clients see records that the operator may have intended to change — which is exactly why `max-stale-TTL` is bounded and the served TTL is kept short.

---

## 7. Origin QPS as a Function of TTL

Here is the arithmetic that ties everything together. Under steady-state traffic, a caching resolver hits the authoritative origin **once per name per TTL window** — because between refetches, every query for that name is a cache hit. So the origin sees, per name, one query every `TTL` seconds:

```
expected origin QPS  ≈  (number of distinct cached names) / TTL
```

Equivalently, for a single name, the **cache hit ratio** at request rate `R` (queries/sec for that name) is:

```
hit_ratio  =  1 − 1 / (R · TTL)        (for R · TTL ≥ 1)
```

because exactly 1 of every `R · TTL` requests in a TTL window is the miss that refetches; the rest are hits.

**Worked example.** Suppose you serve **50,000 distinct hostnames**, each with **TTL = 300 s (5 min)**, fronted by a fleet of caching resolvers that collectively behave like one cache under steady load:

```
origin QPS ≈ 50,000 / 300 ≈ 166.7 queries/sec
```

Your authoritative fleet must sustain ~167 QPS regardless of whether clients issue a thousand or a million lookups per second — caching flattens client rate to `names / TTL`.

Now **drop TTL to 30 s** for a fast-failover posture:

```
origin QPS ≈ 50,000 / 30 ≈ 1,666.7 queries/sec
```

A 10× TTL reduction produced a **10× origin load increase** — an exactly linear, inverse relationship. And a single popular name at `R = 1000 q/s` with `TTL = 300` has hit ratio `1 − 1/(1000·300) = 1 − 1/300000 ≈ 99.9997%`; the origin sees just 1 query per 5 minutes for it. This is the core tension of TTL tuning: **low TTL buys agility (fast propagation, fast failover) and pays in origin QPS and resolver dependency; high TTL buys cheap, resilient caching and pays in slow change propagation.**

---

## 8. RFC Role Comparison

Positive vs negative TTL, side by side:

| Aspect | Positive TTL | Negative TTL |
|---|---|---|
| Caches | Successful answer (an RRset) | NXDOMAIN / NODATA |
| Value source | Per-RRset TTL field (RFC 1035 §3.2.1) | `min(SOA.TTL, SOA.MINIMUM)` (RFC 2308 §4) |
| Where carried | Answer section RRset | SOA in authority section |
| Typical bound | Zone policy (60 s – 1 day) | Capped, commonly ≤ 3 h (RFC 2308 §5) |
| Purpose | Reduce origin load for real records | Reduce origin load from misses/typos/probes |

Which RFC owns which piece of the TTL story:

| RFC | Year | Role in TTL / caching |
|---|---|---|
| **RFC 1035** | 1987 | Defines the 32-bit TTL field, TTL = 0 semantics, seconds unit. Originally calls it "signed" — source of the ambiguity. |
| **RFC 2181** | 1997 | §8 clamps TTL to unsigned `[0, 2^31−1]`; top-bit-set ⇒ treat as 0. §5.2 makes TTL an RRset property; unequal TTLs in an RRset ⇒ use the minimum. |
| **RFC 2308** | 1998 | Standardizes negative caching; redefines SOA MINIMUM as the negative-cache TTL; defines NXDOMAIN vs NODATA sub-cases and an upper cap. |
| **RFC 8767** | 2020 | Serve-stale: adds the Stale state, `max-stale-TTL`, `client-response-timeout`, and short stale-answer TTL to trade correctness for availability during authority outages. |

The through-line: RFC 1035 gives you the field, RFC 2181 fixes its bounds and scope, RFC 2308 extends caching to failures, and RFC 8767 extends caching *past* expiry for resilience. A professional-grade DNS design has an explicit position on all four.

*Next step:* [DNS Caching & TTL — Staff](staff.md)
