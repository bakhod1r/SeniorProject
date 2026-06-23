# Branch by Abstraction — Interview

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

Questions a strong candidate should handle. Model answers are concise but complete; the depth is what distinguishes a senior answer from a textbook recital.

---

### Q1. What is Branch by Abstraction, and why is "branch" a misnomer?

It's a technique for making a large change to a codebase incrementally while keeping the system releasable on trunk at every commit. You introduce an abstraction (a seam — usually an interface) in front of the component you want to replace, build the replacement behind the same abstraction, switch over (often via a flag), and delete the old implementation.

"Branch" is metaphorical: you branch *in the code* — two implementations behind one interface — not in version control. In fact the whole point is to *avoid* a long-lived VCS branch.

---

### Q2. Walk me through the five phases.

1. **Introduce an abstraction** in front of the component; make the existing implementation conform to it. No client uses it yet.
2. **Route clients through the abstraction**, one at a time. The old impl is still behind it, so behavior is identical.
3. **Build the new implementation** behind the same abstraction, selectable via a flag, defaulting OFF (dark/dormant).
4. **Switch over** — flip the flag, usually ramping traffic gradually and reversibly. This is the only deliberate behavior change.
5. **Remove the old implementation**, delete the flag, and consciously keep-or-inline the abstraction.

Every phase decomposes into small commits, each landing on green trunk.

---

### Q3. Why is this better than a three-week feature branch for the same change?

Three concrete reasons. First, **no big-bang merge** — the change is always on trunk, so it never diverges and there's nothing to reconcile. Second, **small reviewable PRs** instead of one giant unreviewable diff. Third, **cheap rollback** — cutover is an incremental flag ramp, and rollback is flipping the flag back in seconds, versus reverting a huge merge.

In risk terms: a feature branch's cost is dominated by rare catastrophic events (merge hell, big-bang cutover failures). Branch by Abstraction trades that for a small, steady, predictable cost.

---

### Q4. Which phase changes behavior, and how do you make it safe?

Only Phase 4 (the flip) changes observable behavior. You make it safe by making it **incremental and reversible**: ramp traffic (internal → 1% → … → 100%), watch dashboards at each step, and roll back instantly by flipping the flag off — which routes everyone back to the proven old implementation. Pre-agree the abort conditions before you ramp.

---

### Q5. How does this relate to feature flags?

The abstraction is the *seam*; the flag is the *lever* that chooses which implementation the seam exposes. The flag enables the gradual ramp in Phase 4 and the instant rollback. Crucially the flag is **temporary** — it exists only to manage cutover and must be deleted in Phase 5. A migration flag that outlives its migration is debt: dead branching plus a config knob that does nothing. Not every Branch by Abstraction needs a *runtime* flag, though — a low-risk internal swap can switch with a one-line composition-root change.

---

### Q6. How is Branch by Abstraction related to Parallel Change and the Strangler pattern?

Same philosophy — change incrementally while staying shippable — at three scales. **Parallel Change** (expand/contract) operates on a single method or published interface: add the new form, migrate callers, remove the old. **Branch by Abstraction** is essentially Parallel Change applied to a whole *component* behind an interface. **Strangler** operates on an entire legacy *application or subsystem*, replacing it from the outside at the system/routing boundary. They nest: inside a strangled slice you often run Branch by Abstraction.

---

### Q7. When would you NOT use it?

- The change is small enough to land in one safe, reviewable, behavior-preserving commit — just do it; don't build scaffolding.
- Old and new genuinely can't share one clean contract (incompatible semantics) — the interface would be leaky and `if`-laden; that's a deeper migration, not a Branch by Abstraction.
- No good seam exists and clients are deeply tangled — do the seam-creating refactoring first.
- You can't commit to reaching Phase 5 — an abandoned migration (two half-alive impls, a flag stuck at 30%) leaves the codebase worse than before.

---

### Q8. What's the single most common failure mode?

Not finishing Phase 5. The migration "succeeds" — new impl at 100% — but the old implementation, the flag, and the branching code are never removed. Now you have permanent indirection, an immortal flag, and a drift risk where a bug fix can land in one impl but not the other. The fix is to treat cleanup as part of the definition of done, with an owner and an expiry date on the flag from day one.

---

### Q9. How do you choose where to put the seam?

Define the interface by **what clients actually depend on**, not by the old class's full public surface — run the interface across real call sites and you'll often find the true contract is narrower. Place the seam on a **genuine boundary** (persistence, external I/O, a policy engine), and keep the **old technology's accidents out of the contract** (no leaked `SQLException`, no connection lifecycle). If you can't articulate a clean contract, the component's responsibilities are tangled — the prerequisite is decomposition, not abstraction.

---

### Q10. How do you keep the two implementations from drifting during the coexistence window?

Three levers. **Keep the window short** — treat Phase 4→5 as urgent. **Review for it** — every PR touching the component is reviewed with "does this need to land in both impls?". And **shadow-compare reads** — run both implementations on read traffic, return the old result, and emit a mismatch metric. The shadow approach catches divergence automatically, but only works cleanly for idempotent reads; writes need a real dual-write/reconciliation plan.

---

### Q11. You're swapping a write path (the persistence layer's `save`). What's different from swapping a read?

Reads are idempotent and side-effect-free, so you can shadow-compare and roll back the *code* with no data consequences. Writes mutate state: shadow-running `save` mutates two stores, and rolling back the flag after the new impl has written somewhere doesn't un-write that data. So write-path cutovers need a data-consistency plan — typically dual-write with reconciliation, or keeping the old store authoritative until full cutover. The flag rolls back the implementation, not the data.

---

### Q12. How does Branch by Abstraction fit trunk-based development?

It's what makes trunk-based development viable for changes too large to finish in a day. TBD says "everyone integrates to trunk frequently; avoid long-lived branches." A big component swap seems to require a long-lived branch — Branch by Abstraction dissolves that contradiction by letting the large change live on trunk as a dormant second implementation behind a seam, shipped in small green commits and activated by a flag.

---

### Q13. How do you decide whether to keep or inline the abstraction in Phase 5?

Keep it if it's a **genuine, useful boundary** you'd want regardless of the migration — persistence interfaces and external-service gateways usually qualify because they aid testing and future swaps. Inline it if it was **pure scaffolding** — an interface with one implementation, existing only to host the swap, adding indirection nobody benefits from afterward. The danger of keeping scaffolding is that future readers mistake an accident for an intention.

---

### Q14. Your team has ten in-flight Branch-by-Abstraction migrations, several at 80–90%. What do you do?

Stop starting and start finishing. Each open migration is an open coexistence window — a drift risk and cognitive load — so ten of them have effectively recreated the long-lived-branch problem in flag form. I'd cap WIP, prioritize driving the closest ones to Phase 5 (old impl deleted, flag removed), and serialize any migrations touching the same hot paths so the test/flag-combination matrix doesn't explode. New migrations wait until in-flight count drops.

---

### Q15. What observability would you put in place before flipping the flag?

Metrics dimensioned by which implementation served the request: error rate, latency (p50/p95/p99), and — for reads — a correctness mismatch counter from shadow comparison. Plus saturation of any new downstream the new impl talks to. The `impl` dimension lets every chart split old-vs-new on identical traffic, so I can compare the candidate against the proven baseline during the ramp. I'd also pre-agree the numeric abort thresholds so rollback isn't a judgment call mid-incident.

---

## Next

- [tasks.md](tasks.md) — hands-on exercises.
- [find-bug.md](find-bug.md) — diagnose misapplied Branch by Abstraction.
- [optimize.md](optimize.md) — design the right phased plan for rough situations.
- Back to [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md)
