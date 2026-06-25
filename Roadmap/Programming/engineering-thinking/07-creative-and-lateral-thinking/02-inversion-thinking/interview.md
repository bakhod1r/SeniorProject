> Interview questions on **inversion thinking** — solving by turning the problem around. Interviewers use these to see whether you reason from the failure surface, not just the happy path. Strong answers are concrete: they invert the prompt, *enumerate* failure modes, and turn each into a defense, test, or invariant. Watch for the trap of sliding from inversion into vague contrarianism.

---

## Q1. What is inversion thinking, and who's associated with it?

Solving a problem by asking its opposite. Carl **Jacobi**'s maxim — *"invert, always invert"* — captured it: when a forward problem is hard, work out the conditions for the opposite outcome and avoid them. **Charlie Munger** popularised it for decision-making, crediting Jacobi, with the line that you get further by being "consistently not stupid" than by being brilliant. In engineering: instead of "how do I make this reliable?", ask "how would I guarantee it fails?" and prevent each item.

**Follow-up trap:** *"Isn't that just pessimism?"* No — the test is that productive inversion ends in an **actionable list**. Pessimism ends in a shrug.

## Q2. Design a reliable payment service. Walk me through it using inversion.

Invert the goal: *"How would I guarantee this service loses money or has an outage?"* Enumerate, then flip each:

- No idempotency → double-charge on retry ⟹ **idempotency key**, unique DB constraint.
- No timeouts on the bank API → threads hang, service stalls ⟹ **timeouts + circuit breaker**.
- Charge and order-creation in separate non-atomic steps → money taken, no order ⟹ **transactional outbox / saga**.
- Single instance, big-bang deploy ⟹ **redundancy + canary + rollback**.
- No alerting on charge-failure rate ⟹ **SLO alert**.

The "how to lose money" list *is* the reliability checklist. I'd then rank by likelihood × blast radius and defend the catastrophic-plausible ones first.

## Q3. What's the difference between requirements and anti-requirements?

Requirements say what the system *should* do; **anti-requirements** say what it must **never** do — usually safety/security invariants. "Charge the card" is a requirement; "never charge twice," "never log a CVV," "never complete a charge without an authenticated user" are anti-requirements. They matter because they're invariants that must hold on *every* path, and each one forces specific design (idempotency, log redaction, auth gate). Good anti-requirements are written as **testable negatives**.

## Q4. What is a pre-mortem and why does it beat just asking "what could go wrong?"

A pre-mortem (Gary **Klein**) imagines the project has *already failed completely*, then asks the team to explain why. It beats "what could go wrong?" because asserting failure as a fact gives people **psychological permission** to voice doubts they'd otherwise suppress to avoid seeming negative — and the imagined certainty surfaces *specific* reasons. Each reason becomes a risk to mitigate now, cheaply. It's inversion applied to a plan instead of a function.

**Follow-up:** *output handling?* Cluster reasons, rank by likelihood × impact, assign each top risk an owner + mitigation with a due date. Untracked = theatre.

## Q5. You're debugging an intermittent bug you can't reproduce. How does inversion help?

Ask: **"What would have to be true for this exact symptom to appear?"** That converts a vague hunt into a list of falsifiable hypotheses — e.g. for an occasionally-wrong cart total: a concurrent write (race), a stale cache, inconsistent rounding, a currency mismatch, an overflow. Then I test each directly (add logging for concurrent writes, check cache TTLs, audit rounding). The bug lives where one "must be true" condition is actually false. It's the scientific method: each candidate is a hypothesis to confirm or kill.

## Q6. What does "design the failure cases first" mean for API design?

Specify and review the **error contract before the happy path**. Enumerate failures — insufficient funds, frozen account, downstream down, duplicate retry — and give each a *distinct, machine-readable* error code, because clients can only handle failures you've separated. Decide idempotency, retry semantics, and partial-failure behaviour up front, since those are contract-level and brutally expensive to change after release. The happy path is the easy, cheap-to-change part; the failure surface is where consumers actually get hurt.

## Q7. What is chaos engineering, and how is it inversion?

Chaos engineering deliberately injects real failures into a system to verify it stays in **steady state** — Netflix's Chaos Monkey kills instances; the discipline was codified by **Rosenthal and Jones**. It's inversion industrialised: rather than asking "is this resilient?" you *cause* the failure and watch. The method: define steady state as a measurable output, hypothesise it persists under fault, inject the fault, look for divergence. Key governance: **controlled blast radius**, an abort switch, and running during business hours so you fail when experts are watching — turning a future 3 a.m. outage into a supervised one now.

## Q8. Distinguish productive inversion from contrarianism.

Productive inversion is bounded and constructive: you flip the question, generate a concrete actionable list, then **flip back and build**. It serves the goal of shipping something good. Contrarianism is unbounded negativity — "this won't work" — that produces discouragement, not action items, and often just avoids the work. The litmus test: *does your inversion end in things you can do?* If asking "how would this fail?" yields five fixes, it's inversion; if it yields a reason to quit, it isn't.

## Q9. Explain "via negativa" with an engineering example.

Taleb's *via negativa*: improvement by **removing** rather than adding, often the more robust lever because removed complexity can't break, be misconfigured, or be misunderstood. Example: a slow page — the additive fix is "add a CDN and a cache"; the via-negativa fix is "remove the 400 KB library imported for one date format." At architecture scale: *remove a state* (redesign so "partially-charged order" can't exist) and you eliminate the whole bug class that lived there. Before adding anything, ask: *can I subtract to get the same outcome with less surface?*

## Q10. "It's easier to avoid stupidity than to seek brilliance." How does that apply to writing reliable software?

Most outages come from a short, well-known list of failure modes: missing timeout, unhandled null, no idempotency, SQL injection, off-by-one, forgotten `await`. You don't need a brilliant insight to be reliable — you need to systematically *not* step on those known rakes. That's reachable far earlier than brilliance, and it compounds: a team that reliably avoids the known failure catalogue out-ships one chasing clever solutions while tripping over basics.

## Q11. How do you make an anti-requirement actually hold, instead of hoping people remember it?

Push enforcement down the strength ladder: **convention → runtime check → DB constraint → type/state machine.** For "never double-charge": a comment is weakest; a handler check fails if a path skips it; a *unique index* makes the DB refuse the double-write from any writer; a state machine where `charge()` only exists on a `Pending` order makes the double-charge *not compile*. Pick the lowest, most automatic rung you can — make the bad state **unrepresentable**, not merely checked.

## Q12. You only test the failures you thought of. How do you find the ones you didn't?

Use tooling that generates adversity instead of relying on my imagination: **property-based testing** (state an invariant, let the framework search thousands of inputs to falsify it), **fuzzing** (random structured input to a parser; assert no crash/hang), and **fault injection / chaos** (make dependencies fail in tests/prod and verify the degradation curve). An invariant verified only with examples I chose just confirms my own optimism.

## Q13. Design "secure file upload" using inverted, attacker-style thinking.

Invert: *"How would I, the attacker, abuse this upload?"* — upload an executable disguised as an image; a 10 GB file to exhaust disk; a path-traversal filename (`../../etc/...`); a polyglot/SVG with embedded script for stored XSS; a zip bomb; a file that gets served back with a dangerous content-type. Each abuse becomes a control: validate type by content not extension; cap size and rate; sanitise/randomise stored filenames; store outside the web root and serve with a safe, fixed content-type and `Content-Disposition: attachment`; scan archives. This is threat modeling — STRIDE is just an organised set of these inverted questions.

## Q14. When can inversion mislead you or be the wrong tool?

When the failure space is effectively infinite and unranked, inversion can produce a paralysing list and tip into analysis paralysis or a culture of "no." It must be paired with **ranking** (likelihood × blast radius) so you defend the catastrophic-plausible and merely document the trivial-fantastical. It's also weak for *generative* problems — inversion sharpens "make X robust," but inventing a genuinely new approach often needs forward, [divergent thinking](../01-divergent-vs-convergent/) or [analogical thinking](../03-analogical-thinking/). Use inversion to harden and validate; use other tools to invent.

## Q15. Give a concrete example of turning a "how to cause an outage" list into a reliability checklist.

Inverted goal — *guarantee an outage*: (1) no dependency timeouts; (2) no circuit breaker; (3) single instance, no health check; (4) unbounded queues, no backpressure; (5) big-bang deploy, no canary; (6) no error/latency alerts; (7) untested backups. Flip every line: timeouts + retry-with-backoff; circuit breakers; N+1 instances behind a load balancer; bounded queues with load shedding; canary + auto-rollback; SLO alerts; scheduled restore drills. The inverse of a good sabotage plan is a credible reliability checklist — and sabotage is easier to imagine than excellence, which is exactly why the technique has leverage.

---

### See also

- [Divergent vs. convergent thinking](../01-divergent-vs-convergent/) · [Analogical thinking](../03-analogical-thinking/) · [Constraint-driven creativity](../04-constraint-driven-creativity/)
- [Cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/) · [Risk and failure probabilities](../../06-probabilistic-thinking/03-risk-and-failure-probabilities/)
- [Section overview](../) · [Engineering-thinking roadmap](../../README.md)
