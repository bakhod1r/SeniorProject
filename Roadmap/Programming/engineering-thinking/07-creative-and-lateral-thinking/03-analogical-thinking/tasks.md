> Exercises to build analogical thinking as a disciplined tool. **Global constraints for every task:** (1) for each analogy, write a two-column **holds / breaks** ledger — never present an analogy without naming where it fails; (2) distinguish whether you're using the analogy to *explain* or to *decide*; (3) treat every analogy as a hypothesis, and where a decision rides on it, note how you'd validate from first principles. Deliverables marked **📄** should be a short written artifact (a note, a doc section, or a diagram) you could show a teammate.

---

## Task 1 — Map the structure, strip the surface

For each analogy below, write **one sentence** naming the *relational structure* that maps, then list **two surface features that do NOT map**:

- a cache ↔ keeping snacks at your desk
- a message queue ↔ a post office
- a load balancer ↔ a restaurant host seating guests
- a semaphore ↔ a parking lot with N spaces and a counter

**Goal:** train yourself to separate structure (what transfers) from decoration (what fools people). **📄** Deliverable: a 4-row table.

## Task 2 — Find where the analogy breaks

Take three analogies you personally use and rely on at work. For each, complete the sentence **"...but unlike the real-world version, in software ___"** at least twice. Then mark which break is *load-bearing* — i.e. one where, if you forgot it, you'd ship a bug.

**Goal:** make boundary-finding a reflex. **📄** Deliverable: the completed sentences with the load-bearing break highlighted.

## Task 3 — Diagnose a surface analogy in the wild

Find a real example (in your codebase, a design doc, a Slack thread, or a blog post) where someone reasoned from a **surface analogy** and it caused a problem — e.g. "treat the database like a filesystem", "a microservice is just a class with a network", "config is just constants." Write up:
1. The analogy as stated.
2. The attribute(s) it mapped on (what things *are*).
3. The relation(s) it missed (what things *do*).
4. The concrete consequence.

**📄** Deliverable: a short postmortem-style note.

## Task 4 — Generate a cross-domain solution

Pick a problem you're currently stuck on or that your team recently solved awkwardly. **Abstract it to its relations first** (write the shape: "many X, ordered by Y, must guarantee Z"). Then deliberately retrieve **three** source analogies from *different* domains (e.g. one from physics, one from biology, one from economics/logistics). For each, sketch the solution it suggests.

Finally: where do the three agree (robust structure) and where do they disagree (the part you must actually think about)?

**Goal:** practice structural retrieval and triangulation. **📄** Deliverable: the abstracted shape + three sketches + the agree/disagree analysis.

## Task 5 — Interrogate the real source mechanism

Take the analogy **"our system should be strongly consistent like a bank ledger."** Research how multi-branch / interbank consistency *actually* works (clearing, settlement, reconciliation, eventual consistency). Then answer: does the *real* source mechanism support or undermine the conclusion people draw from the folk version?

Repeat with one more analogy where you suspect the *folk version* differs from reality (candidates: "the internet routes around damage", "DNS is like a phone book", "Git is like saving versions of a Word doc").

**Goal:** never map the stereotype of a source domain. **📄** Deliverable: two short writeups, each ending with "folk version says X; real mechanism says Y; this changes the recommendation by ___."

## Task 6 — Build the holds/breaks ledger for a resilience pattern

Pick **one**: circuit breaker, bulkhead, or retry-with-backoff. Write its full **holds / breaks** ledger against its real-world source (electrical / ship / phone-redial). Aim for at least 3 "holds" and 3 "breaks." Then state its **domain of validity** in one line, in the form "valid when ___, breaks when ___."

**📄** Deliverable: the ledger + the validity statement. (Reference: Nygard, *Release It!* for circuit breaker and bulkhead.)

## Task 7 — Spot the adversary boundary

For each "natural process" analogy, identify exactly where an **intelligent adversary** invalidates it:

- immune system ↔ intrusion detection
- herd immunity ↔ "most clients are patched, so we're safe"
- ecosystem / self-healing ↔ auto-remediation
- gossip / epidemic spread ↔ rumor/feature propagation

**Goal:** internalize that natural-source analogies assume a non-malicious environment. **📄** Deliverable: a table of analogy → adversary move that breaks it.

## Task 8 — Catch an analogy ending a debate

Over one week, log every time you observe an analogy used to **conclude** a discussion rather than **open** one (in reviews, planning, docs, chat). For each, write the one boundary question that *should* have been asked (e.g. "where does the LEGO analogy break for our services?"). Pick the highest-stakes one and write how you'd reopen it constructively.

**Goal:** detect the debate-ender pattern socially. **📄** Deliverable: the log + the reopening script for the top one.

## Task 9 — Explain vs. decide

Take one analogy and write it **twice**:
1. As an **explanation** for a non-engineer (optimize for the picture clicking).
2. As input to a **decision** in a design doc (optimize for the boundary being explicit and the claim being falsifiable).

Notice how much more boundary-marking the decision version needs. Then state: what would have to be true (validated from fundamentals) before you'd actually act on it?

**📄** Deliverable: the two versions side by side + the validation condition.

## Task 10 — Audit an organizational analogy for dogma

Identify one analogy your team or org uses *as a premise* in strategy or architecture (candidates: "microservices are independent companies", "platform team's a product", "move fast and break things", "two-pizza teams", "tech debt = financial debt"). Answer:
1. What did it originally illuminate?
2. What decision is it now *driving*?
3. Has the org/context grown past its domain of validity?
4. What's the boundary question you'd raise, and who has standing to retire it?

**Goal:** practice the staff-level dogma audit. **📄** Deliverable: a one-page audit.

## Task 11 — Start (or grade) your cross-domain pattern library

If you don't have one, start a note with **5 entries** in the format: `problem-shape → real-world/other-domain solution it maps to → the boundary that bit someone`. If you already keep analogy notes, upgrade 5 of them from one-liners to full mappings with boundaries.

Then add one entry sourced from **outside software** (queueing theory, control theory, epidemiology, economics, logistics) that you could plausibly use at work.

**📄** Deliverable: the 5+1 entries.

## Task 12 — Stress an analogy to its breaking scale

Pick a scale-sensitive analogy ("threads are workers", "add servers to add capacity", "the cache is just a faster copy"). Identify the **order of magnitude** at which it flips from true to false, and name the *source-domain feature that has no software equivalent* (e.g. people don't have cache-line contention; physical copies don't go stale on the original's update). Write the failure as a one-line warning a future engineer would thank you for.

**📄** Deliverable: the flip-point + the warning line.

---

### How to know you're improving

- You can't state an analogy anymore without your brain auto-completing the **breaks** column.
- You retrieve analogies by **structure** (you abstract the problem first), not by "the last thing I saw."
- You catch yourself and others using analogy to **end** decisions, and you reopen them.
- Your **pattern library** has entries from outside software, with boundaries, not just slogans.

## See also

- [Reasoning from fundamentals](../../05-first-principles-thinking/01-reasoning-from-fundamentals/) — the validation half of every analogy.
- [Logical fallacies in engineering](../../04-critical-thinking/02-logical-fallacies-in-engineering/) — false analogy.
- [Inversion thinking](../02-inversion-thinking/) · [Constraint-driven creativity](../04-constraint-driven-creativity/) · [Divergent vs. convergent](../01-divergent-vs-convergent/)
- [Section root](../) · [Roadmap home](../../README.md)
