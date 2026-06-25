> Interview questions on the *nature* of tradeoffs — not the decision process (that's [evaluating tradeoffs objectively](../../04-critical-thinking/04-evaluating-tradeoffs-objectively/)), but seeing that a tradeoff exists, naming both sides, and knowing when it flips. Answers are short and precise; traps and follow-ups are flagged. Strong candidates *name the dominant axis* and *the assumed context*, not just recite definitions.

---

## Q1. What does "there is no free lunch" mean in engineering?

Every improvement is paid for somewhere — you don't eliminate difficulty, you relocate it. A cache trades memory and staleness for read speed; a retry trades extra load for resilience. If a change looks like a pure win with no cost, you either found genuine slack (you were below the Pareto frontier) or you haven't found the cost yet — and it's almost always the latter.

**Trap:** candidates who say "good engineering avoids tradeoffs." It doesn't — it *chooses* them deliberately and puts the cost where it hurts least.

---

## Q2. Explain the difference between latency and throughput, and why they trade off.

**Latency** is how long one operation takes; **throughput** is how many operations complete per unit time. They trade because **batching** amortizes per-operation overhead — great for throughput — but makes each item wait for the batch, hurting latency. Example: batching 10,000 DB writes into one transaction gives huge rows/sec but each row's p99 latency balloons to hundreds of ms.

**Follow-up:** *Can you improve both at once?* Yes — if you're below the frontier (remove an N+1, add an index) *or* by pushing the frontier with parallelism/more hardware. On a single saturated thread, no.

---

## Q3. State the CAP theorem precisely. What's the common misstatement?

In a distributed data store you cannot simultaneously guarantee **Consistency**, **Availability**, and **Partition tolerance**. The misstatement is "pick 2 of 3" as if it's a free menu. **Partitions are not optional** — networks fail — so P is given. The real choice happens *only during a partition*: stay consistent and reject requests (**CP**), or stay available and serve stale data (**AP**).

**Trap:** "Pick any two." Wrong framing — you don't choose to drop P; you choose between C and A *when* a partition occurs.

---

## Q4. What does PACELC add that CAP misses?

CAP only describes behavior *during* a partition, which is rare. **PACELC** (Abadi): if **P**artition, trade **A** vs **C**; **E**lse, trade **L**atency vs **C**onsistency. The "else" branch is where you spend 99.9% of your time — even with no partition, stronger consistency costs latency (more coordination round trips). DynamoDB is PA/EL; Spanner is PC/EC.

**Follow-up:** *Why is PACELC more practical?* Because most decisions are made in the no-partition steady state, where latency-vs-consistency is the live tradeoff.

---

## Q5. "Always normalize your database" — when is this best practice wrong?

It assumes writes/consistency dominate and storage is scarce. For a **read-heavy** workload (analytics, a feed read 1000:1 over writes), denormalizing — duplicating data to avoid joins — wins, and you accept update anomalies as the price. The best practice is a tradeoff with a hidden assumed context; when the context (read:write ratio) flips, the tradeoff flips.

**Trap:** treating normalization as a moral rule rather than a read/write-optimization tradeoff.

---

## Q6. What is a Pareto frontier, and why does it matter?

The set of achievable combinations where you can't improve one property without worsening another. **On** the frontier, optimization means *trading* along it. **Below** it (a "dominated" point), you can improve everything at once — there's slack to claim for free. The practical rule: before trading anything, check you're actually on the frontier; if "10× faster, no downside" is true, you were dominated, so find and claim that slack *first*.

**Follow-up:** *How do you know you're off the frontier?* You found a pure win — a missing index, an N+1, redundant work. After you fix obvious waste, further gains start costing something.

---

## Q7. What is the "dominant constraint" and how do you find it?

Most decisions have one axis that actually decides the outcome; the rest are noise. You find it by asking *what breaks first as we grow* or *what does the user actually feel*. If writes hit a ceiling, writes dominate; if users abandon at 3 s, tail latency dominates. Optimizing a non-dominant axis yields zero end-to-end improvement (Theory of Constraints).

**Trap:** candidates who optimize every axis equally — that's wasted effort and usually means they didn't find the bottleneck.

---

## Q8. Name the tradeoff in adding a database index.

Read speed vs write speed (and disk). The index makes matching reads fast but slows every `INSERT`/`UPDATE`/`DELETE` (the index must be maintained) and consumes space. Right when reads dominate; wrong on a write-heavy table where it's read rarely.

**Follow-up:** *Index everything, then?* No — each index taxes every write. On a write-heavy table, an unused index is pure cost.

---

## Q9. Name the tradeoff in caching.

Read latency (and DB load) vs **staleness** plus memory plus a new failure mode (cache-invalidation, cold-start, thundering herd). You trade fresh-but-slow for fast-but-possibly-stale. Acceptable when the data tolerates a bounded staleness window (a TTL); dangerous for data that must be exact (account balance shown as authoritative).

---

## Q10. Coupling vs duplication — when do you prefer duplication?

When the two pieces of code are *different concepts that merely look alike*, or when teams need to deploy independently. De-duplicating coincidental similarity creates a wrong abstraction that couples unrelated things forever. "A little copying is better than a little dependency" (Rob Pike). DRY assumes the duplicated logic is genuinely *one* rule.

**Trap:** treating DRY as absolute. The real tradeoff is maintenance cost of N copies vs the rigidity of coupling.

---

## Q11. Give an example of a tradeoff that flips with scale.

Monolith vs microservices: a monolith is simpler and faster to ship for a small team (right at small scale); above ~50 engineers, the inability to deploy independently dominates and services win. Or strong consistency: nearly free on one node, but the coordination cost explodes across many nodes/regions, pushing you toward eventual consistency. *What's true at 1 server is false at 1,000.*

**Follow-up:** *How do you handle the flip?* Define the metric/threshold that signals the flip is approaching and start the redesign with lead time — don't wait for the ceiling.

---

## Q12. What does it mean to "push the frontier" instead of accepting a tradeoff?

Accepting = picking the best point on the *current* frontier. Pushing = spending money/hardware/complexity to reach a *better* frontier where the original tradeoff hurts less — e.g., buying more RAM to get speed without memory pressure, or a CDN to cut global latency. It's not a free escape: you traded money/complexity for a better position on the original axes. Push only on the dominant, durable constraint.

---

## Q13. Generality vs performance — explain with an example.

A general solution handles many cases; a specialized one is faster at one. A generic JSON parser handles any schema; a code-generated parser for one known schema can be 5–50× faster by skipping impossible branches. The senior move: profile, then specialize only the dominant hot path and keep the rest general (the end-to-end argument in spirit).

---

## Q14. What is Tesler's Law (conservation of complexity)?

Every system has an irreducible amount of complexity; it can't be removed, only moved between the user, the application, and the platform. A clean API doesn't delete complexity — it relocates it from a thousand callers into one implementation. So "simplify" really means "decide who pays for the complexity," which is itself a tradeoff.

---

## Q15. Security vs usability — how do you avoid a bad spot on this frontier?

Don't apply uniform friction. Put the cost where the risk is: **step-up authentication** — smooth for low-risk actions, extra verification (2FA, re-auth) only for high-risk ones (new device, password change, large transfer). You're placing the unavoidable security cost where the system best absorbs it, instead of taxing every interaction equally.

**Follow-up:** *Why not just maximize security?* Because each friction point costs conversion/abandonment; max security with zero usability is a system nobody uses, which is also insecure-by-irrelevance.
