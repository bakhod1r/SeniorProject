# Reasoning from Fundamentals — Interview Q&A

A focused set on first-principles thinking. The interviewer is checking whether you can tell physics from habit, compute a floor on a whiteboard, and — critically — recognize when *not* to bother. Answers favor precision over length.

---

## Section A — Concepts (1-5)

**Q1. Define first-principles reasoning and contrast it with reasoning by analogy.**

A: First-principles reasoning decomposes a problem to its irreducible truths — physics, math, information theory, the genuine contract — and derives a solution *upward* from those. Reasoning by analogy maps a new problem onto a previously-seen solution by surface similarity ("this is like X, so build it like X"). Analogy reasons *forward* from a known design; first-principles reasons *backward* from constraints. The roots go back to Aristotle's *archai* and Descartes' method of doubt; the modern engineering version is Musk's battery-cost decomposition.

Trap: saying first-principles is "just better." It's *more expensive* and usually unnecessary. Analogy is the correct default for most decisions.

---

**Q2. Most decisions should be made by analogy. So when is first-principles worth its cost?**

A: Four triggers: (1) the decision is **expensive to reverse** (data model, consistency model, sharding key, public API); (2) the **numbers don't reconcile** — observed cost is far from any reasonable floor; (3) an analogy is being used to **end debate** rather than inform it ("Netflix does X"); (4) you're at a **scale or constraint the inherited pattern was never designed for.** Otherwise, use the proven thing.

Follow-up — the single best predictor? Reversibility. Cheap, reversible decisions don't deserve derivation.

---

**Q3. You decompose a design and find an assumption. How do you decide if it's negotiable?**

A: Classify it into four bins. **Law** — physics/math, never movable (speed of light, Shannon entropy). **Hard requirement** — genuine external contract, movable only by renegotiating with the business (exactly-once payments). **Soft requirement** — stated preference, actually flexible ("must use Postgres"). **Convention** — inherited habit, freely movable ("paginate at 50"). Only the bottom two are cheaply negotiable.

Trap: the costly error is mislabeling a *soft requirement* as a *law* — e.g. treating "globally strongly consistent" as physics when it's a product preference you can renegotiate.

---

**Q4. Explain the Musk battery example and translate it to software.**

A: Batteries "cost" ~$600/kWh by market analogy; Musk's team asked what they're physically made of — cobalt, nickel, aluminium, carbon — priced the raw commodities at ~$80/kWh, and treated the gap as opportunity. Software version: ask "what does this feature *fundamentally* have to cost in compute, storage, network?" Compute the floor from bytes/rows/round-trips, then ask why the actual bill is a multiple of it. It reframes "too expensive" into "the floor is $X, we pay $40X, where did the 40× go?"

---

**Q5. What's the difference between this and Munger's inversion?**

A: They're complementary. Inversion asks "what would make this *fail*?" and removes those causes. First-principles asks "what is the minimum the constraints *demand*?" and builds up from there. Inversion is a search heuristic over failure modes; first-principles is a derivation from constraints. You often use inversion *inside* a floor analysis: "what would force this to be slow?" → round trips → count them.

---

## Section B — Computation on the whiteboard (6-9)

**Q6. Estimate the theoretical minimum round-trip latency from New York to London. Show your work.**

A: Distance ≈ 5,500 km. Light in fiber ≈ 200,000 km/s (⅔ of vacuum *c* due to glass's refractive index). One way = 5,500 / 200,000 = 27.5 ms. Round trip ≈ **55 ms**, theoretical floor. Real RTT is ~70–80 ms (cables aren't straight, routers add delay). No code beats the 55 ms; the only fix for a sub-50 ms requirement is a server closer to the user.

Trap: forgetting the ⅔ factor and using vacuum *c* — gives an impossibly optimistic 37 ms RTT.

---

**Q7. A team says "the API is slow because the database is slow, let's add Redis." Walk me through your response.**

A: Compute the floor first. The endpoint returns ~20 rows, ~10 KB, one indexed lookup. Floor: indexed read <1 ms, 10 KB on a datacenter link ~80 µs + one RTT ~0.5 ms, JSON encode <1 ms → **single-digit ms floor**. If it's at 800 ms, the DB isn't "slow" — something does 100× the necessary work. Trace it; you'll usually find an **N+1 query** (1 + 20 + 20 round trips). The fix is a JOIN or batch load. A cache would *hide* the bug and add a new system to maintain.

Follow-up — when *would* the cache be right? When the floor itself is too high (e.g. an irreducibly expensive aggregation hit at high QPS), not when implementation overhead is the gap.

---

**Q8. You need 10,000 globally-linearizable writes/sec to a single key across three continents (~150 ms inter-region RTT). Feasible?**

A: No — and the floor proves it without prototyping. Linearizable writes to one key need consensus; each decision costs ≥1 cross-region round trip, and writes to the same key form a dependency chain you can't pipeline past. Floor ≈ 1 / 0.150 ≈ **~7 writes/sec/key**. 10,000 is three orders of magnitude over the floor. The fundamentals say the *requirement* must change: partition the key space, or relax to causal/eventual consistency per region. This is CAP/FLP showing up as arithmetic.

---

**Q9. A PM says storing an activity feed is "too expensive." 1M users, 5 events/day each, ~200 bytes/event. Respond.**

A: 1M × 5 × 200 B = 1 GB/day. 90 days hot = ~90 GB — a few dollars a month. The *fundamental* storage cost is trivial. So "too expensive" describes a current implementation (likely storing rendered HTML or full denormalized rows), not the floor. The reframe: "the floor is 90 GB; what is our implementation doing to reach the number you're worried about?" Now it's a debuggable engineering question, not a feature-killer.

---

## Section C — Judgment and traps (10-13)

**Q10. When is reasoning from fundamentals actively the wrong tool?**

A: When you'd be re-deriving solved, undifferentiated problems (consensus, congestion control, B-trees, exponential-backoff retries) — that's not-invented-here in disguise. When the decision is cheap and reversible. When you lack data to compute an honest floor, so the "derivation" is fabricated constants — a good analogy beats invented arithmetic. And when the constraint is taste or maintainability, which resist floor models.

---

**Q11. What's "first-principles theater" and how do you catch it?**

A: An impressive-looking floor model built on guessed constants to justify a decision already made — rigor as rhetoric. Catch it by demanding *measured* constants (dated), peer review, and the prediction-then-observation loop: a floor model that was never compared against a real measurement is not engineering. False precision that *looks* rigorous is worse than admitting you don't know.

---

**Q12. The floor model says 8 ms; production shows 400 ms. Is the model wrong?**

A: Not necessarily — that 50× gap is the *output* of the method, not a failure of it. The gap is a quantity to explain: an implementation defect (N+1, no connection reuse), an unstated requirement (you forgot it also fans out to three services), or a deliberate trade-off. The method is always *floor versus observation*; a floor alone, or a measurement alone, tells you little. The gap is where the work is.

---

**Q13. Give an example where treating a soft requirement as a law cost real money.**

A: A team takes "globally strongly consistent" as immovable and spends a quarter trying to make cross-region writes fast — fighting physics, since consensus needs WAN round trips. The fix was never technical: examined, the business would happily accept causal consistency per region for 100× throughput. The error was *bin misclassification* — soft requirement labeled as law — and it cost a quarter. The cheap insurance is asking, of every "must," whether it's physics or preference.

---

## Section D — Stretch (14)

**Q14. Can you ever reason from fundamentals about something with no clean numbers, like developer experience?**

A: Partially. You can't compute a floor for "pleasant API," but you *can* decompose toward fundamentals: what irreducible steps must a developer perform to accomplish the task? Each unnecessary step above that minimum is friction you can name and remove — analogous to round trips above the latency floor. The technique degrades gracefully: where exact floors don't exist, "minimum necessary steps" is still a more honest baseline than "feels nicer than the old one."
