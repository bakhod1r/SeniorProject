> Interview questions on **decomposition** — the first pillar of computational thinking. Answers are short and precise, with the traps interviewers are probing for and the follow-ups they'll push on. Use these to check you can *defend* a decomposition, not just perform one.

---

## Q1. What is decomposition, and why is it the *first* step of computational thinking?

Breaking a problem too large to reason about into sub-problems each small enough to solve, test, and name on its own. It's first because every other pillar depends on having pieces to work with: you can't *pattern-match*, *abstract*, or *pick an algorithm* over an undifferentiated lump. Decomposition produces the units the rest of the toolkit operates on.

**Trap:** answering "it makes code cleaner." The deeper answer is cognitive — it's how you fit an unboundedly complex problem into bounded working memory.

---

## Q2. Functional vs data vs domain decomposition — when do you use each?

- **Functional** — split by what the system *does* (steps/verbs): validate → transform → store. Default for pipelines and transforms.
- **Data** — split by the *data* it operates on (shards/chunks): rows 0–1M here, 1M–2M there. For parallelism and huge inputs.
- **Domain** — split by business concept / bounded context: Catalog, Pricing, Inventory. For application and service architecture.

They compose: a service is carved by domain, built internally with functional stages, scaled with data decomposition.

**Follow-up:** "Which is the most common mistake?" → Decomposing a *domain* problem *functionally* — making flowchart-step modules that all share the data representation (Parnas's trap).

---

## Q3. How do you tell a *good* decomposition from a bad one?

Two measures: **high cohesion** inside each piece (everything serves one job) and **low coupling** between pieces (thin, stable interfaces). The mechanical proxy: look at the **interface between two pieces and count what crosses it** — fewer things crossing = better cut. A fat interface means you cut across the grain; the pieces are entangled and will change together.

**Trap:** "more, smaller pieces is better." No — there's a sweet spot; past it, integration cost dominates.

---

## Q4. What does Parnas's 1972 paper actually say, and why does it still matter?

*On the Criteria To Be Used in Decomposing Systems into Modules.* It says: **don't decompose by processing step (flowchart order). Decompose so each module hides a design decision likely to change**, behind an interface unlikely to change — *information hiding*. The flowchart decomposition looks natural but makes every module share knowledge of the data representation, so any change ripples through all of them. The information-hiding decomposition confines each change to one module.

**Why it still matters:** it's the reason "group by technical layer" or "one module per pipeline stage" produces brittle systems, and "one module per volatile decision" produces flexible ones. Coupling/cohesion are downstream *consequences* of getting this right.

---

## Q5. What's a "seam," and how do you find one?

A seam is a boundary where the two sides have a genuinely thin, stable relationship — where one side can change without disturbing the other. You find it by asking what's *likely to change* (Parnas) and where the *domain language changes* (DDD bounded contexts): when the same word means different things to different people ("product" in Catalog vs Inventory), you've found a context boundary. Cut along seams; cutting across them creates fat, brittle interfaces.

---

## Q6. Top-down vs bottom-up decomposition — which do you use?

- **Top-down** when the *shape* of the whole is clear: decompose the goal into sub-goals, fill them in. Risk: clean-on-paper pieces that don't match reality, validated only at the end.
- **Bottom-up** when the *parts* are clear/reusable: build trusted primitives, compose upward. Risk: building pieces nobody needs.

Real work is both, meeting in the middle. Lead top-down when the shape is known, bottom-up when the primitives are known.

---

## Q7. What is over-decomposition and why is it sometimes *worse* than under-decomposition?

Over-decomposition: splitting into too many tiny pieces — 2-line functions called once, factories for one-field objects, nanoservices. It's often worse than under-decomposition because the failure is *hidden*: each piece looks clean, but the **interfaces between them add up to more complexity than the logic**, and integration becomes the hard part. You open eight files to follow one flow. Under-decomposition (a God class) is at least obviously bad.

**Litmus test:** a piece used by exactly one caller, whose name doesn't make the caller clearer → inline it.

---

## Q8. Why is recomposition a design concern and not an afterthought?

Because every cut creates an interface that must be reassembled — data shapes agreed, failures handled, deploys coordinated. A decomposition that's elegant on a whiteboard can be a disaster in integration: chatty boundaries (50 calls to do one job), shared mutable state across the "boundary," or — worst — an **invariant straddling the cut**, forcing distributed transactions/sagas. The rule: **design the recomposition before committing to the decomposition** — trace one real end-to-end operation across each seam, count round-trips, and check no atomic invariant crosses it.

---

## Q9. How is decomposition a debugging tool?

You **binary-search the problem space** instead of reading everything. Put a check at the midpoint of a flow (or commit history): is the state correct here? Yes → bug is downstream; no → upstream. Each check halves the search — N stages debugged in log₂(N) probes. `git bisect` automates this over commits to find the one that introduced a regression. It only works *because* the system decomposes into independently inspectable stages — a tangled monolith gives you nowhere to probe.

**Follow-up:** "What does bisect assume?" → A monotone property (was good, now bad, one transition) and the ability to test each midpoint.

---

## Q10. How does decomposition relate to estimation?

You can't estimate a big lump; you decompose it into tasks small enough to estimate, then sum — a **work-breakdown structure**. It's more accurate than guessing the whole because per-piece errors partly cancel rather than compound. Same logic as **Fermi estimation**: break an unknowable quantity into knowable factors and multiply. Bonus: the breakdown that gives you the estimate also gives you the de-risking order and a stoppable plan.

---

## Q11. What's the connection between divide-and-conquer and decomposition?

Divide-and-conquer is decomposition applied to a single computation: **divide** the input, **conquer** each part (often recursively), **combine** the results. Merge sort, quicksort, binary search, FFT, MapReduce all share this shape. It's *data* decomposition plus explicit *recomposition* (the "combine"/merge step). It's where decomposition becomes an algorithmic technique, not just an architectural one.

---

## Q12. Explain Conway's law and what it means for how you decompose a system.

"Organizations produce designs that copy their communication structures." Practically: **the way you split teams determines the way the system splits** — and vice versa. So you can't choose service boundaries independent of team boundaries; if a boundary requires two teams to coordinate on every change, the teams will erode it (shared DBs, back-channels) until the architecture matches their real communication. The **Inverse Conway Maneuver** runs it backward: shape the org (teams owning bounded contexts) to *produce* the architecture you want.

**Follow-up:** "So how do you size a service?" → Until it fits one team's head; split only when change cadence / consistency / scaling / ownership axes genuinely diverge *and* no invariant straddles the seam.

---

## Q13. You're told to break a monolith into microservices. What's your first question?

Not "which services?" but "**where are the seams such that each invariant lives entirely on one side, and each piece can be owned by one team?**" Then: do the change/scale/consistency/ownership axes actually diverge enough to justify paying the network cost? Default to *modularize early, distribute late* — get boundaries right in-process where they're cheap to move, promote a module to a service only when an axis forces it. Premature service splitting is over-decomposition with a catastrophic integration tax.

---

## Q14. How do you decompose a multi-quarter initiative?

By **vertical slices**, not horizontal layers. Each slice must (a) ship value or learning on its own and (b) de-risk the next. The anti-pattern is decomposing by component ("data model in Q1, service in Q2, integrate in Q4") — all the recomposition risk lands at the end with no schedule to absorb it. Vertical slices integrate continuously, prove the scariest unknown early, and keep their value if the project is cancelled midway (strangler-fig migrations are this pattern applied to legacy replacement).

---

## Q15. Give a quick example of a *bad cut* and how you'd fix it.

A notification system split into `EmailSender`, `SMSSender`, `PushSender`, each re-implementing "decide whether to send, render the message, log it." That's a flowchart cut — adding an event type touches all three; adding a channel duplicates the shared logic. **Fix:** cut along axes of change (information hiding): `Channel` (secret = how to deliver via a provider), `Template` (secret = event → message), `Policy` (secret = who-gets-what / quiet hours), `Dispatch` (orchestrates). Now each change — new provider, new event, new rule — hits exactly one module.
