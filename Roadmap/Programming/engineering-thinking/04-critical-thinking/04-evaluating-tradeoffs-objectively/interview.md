> Interview questions on evaluating tradeoffs objectively. These probe whether you can turn "it depends" into a *defensible* decision: explicit criteria set before options, dominant-axis thinking, reversibility (one-way vs two-way doors), cost of delay vs cost of being wrong, TCO and second-order costs, and the honesty disciplines (no fudged weights, mark guesses, baseline always). Answers are short with the trap and a follow-up. Classic system-design tradeoff questions are included.

---

## Q1. How do you keep yourself from rationalizing the option you already prefer?

Write the decision criteria and their weights **before** looking at the options. Fixed-in-advance criteria can't be invented or re-weighted the moment your favorite starts losing. Add a baseline ("do nothing") and mark which scores are measured vs guessed.

**Trap:** Saying "I just stay objective." Objectivity is a *procedure*, not a personality trait — name the procedure.

**Follow-up:** *What's the tell that you're fudging?* You feel the urge to bump a weight or add a brand-new criterion exactly when it would flip the result toward your preference.

## Q2. What is a weighted decision matrix and what is its main failure mode?

Options as columns, criteria as rows, each weighted by importance; score cells, multiply by weights, sum. The failure mode is **fudging the weights (or inventing criteria) to engineer the answer you wanted** — false objectivity. Defenses: set weights before scoring, separate pass/fail knockout gates from soft criteria, and run a sensitivity check.

**Trap:** Treating the matrix's number as truth. It's an argument structure, not an oracle; garbage weights in, confident garbage out.

## Q3. What's a one-way door vs a two-way door, and why does it matter?

Bezos's 2015 Amazon shareholder letter: a **two-way door** is reversible (change it back cheaply), a **one-way door** is irreversible or nearly so. It matters because rigor should scale with reversibility — deliberate slowly on one-way doors, decide fast on two-way doors. The classic org failure is applying heavyweight process to two-way doors, producing slowness and timidity.

**Follow-up:** *Example of each?* Two-way: logging library, feature-flag default, internal naming. One-way: public API shape, primary data model, an event schema other teams consume.

## Q4. How do you decide how much analysis a decision deserves?

Weigh **cost of being wrong × probability of wrong** against **cost of delay**, discounted by reversibility. High cost-of-wrong + low cost-of-delay → invest in rigor. Low cost-of-wrong (reversible) → decide fast and revisit if it hurts. Spending one-way-door rigor on a two-way door *is* the mistake (analysis paralysis).

**Trap:** Applying rigor in proportion to how *interesting* the decision is rather than how *consequential and irreversible*.

## Q5. What is cost of delay and how would you quantify it?

The value lost while you *don't* decide or ship — blocked revenue, blocked teams, closing windows (Reinertsen, *Principles of Product Development Flow*). Quantify it: estimate the value of the blocked outcome per unit time. "Each week of more analysis costs ~$7k of delayed revenue and buys near-zero decision improvement" reframes the debate from "be careful" to a priced tradeoff.

**Follow-up:** *Difference from WSJF?* Weighted Shortest Job First (cost of delay ÷ duration) *sequences a queue of jobs*; it's prioritization, not a single-decision tradeoff tool. Same insight (delay has a price), different use.

## Q6. "Should we adopt Kafka?" — how do you respond?

Reject the framing: no option exists in a vacuum. Ask **"compared to what?"** — Kafka **vs** our current approach (the do-nothing baseline) **vs** a managed queue. Then: what's the dominant requirement (throughput? ordering? retention?), is this a one-way door, and what does TCO look like vs upfront. A single floating option can't be evaluated objectively.

**Trap:** Diving into Kafka's features. The first move is always to surface the alternatives and the baseline.

## Q7. Upfront cost vs total cost of ownership — walk me through a case.

Self-hosting looks cheaper than a managed service by monthly bill, but TCO adds ongoing ops labor, on-call burden, patching/upgrades, and outage risk over a stated horizon (e.g. 3 years). Price engineer-hours explicitly: 6 ops-hrs/month at $100/hr is $600/month — often more than the managed premium. "Free" OSS is rarely free once staffed.

**Follow-up:** *What second-order costs do people forget?* Operability/debuggability, on-call load, hiring and onboarding, cognitive load, blast radius. Put them as explicit rows.

## Q8. SQL vs NoSQL for a new service — how do you evaluate it objectively?

Start with the dominant axis and knockout gates, not preferences. Gates: do we *need* multi-row ACID transactions? Strong consistency? Then dominant axis — is the real constraint relational integrity, write scale, flexible schema, or operability with *this* team? Score survivors against a TCO horizon, include the team's existing skills (a huge second-order cost), and check reversibility (a storage abstraction makes it more two-way). The objective answer is often "Postgres, because operability-today is a certain cost and the scale problem is a probabilistic future one we can convert to a two-way door."

**Trap:** "NoSQL because it scales." Scales on *which* axis, compared to what, and at what cost to consistency and team familiarity?

## Q9. Monolith vs microservices — what's the honest tradeoff?

Microservices trade *internal* complexity (a call is a function) for *operational/distributed* complexity (network, partial failure, eventual consistency, deployment surface, observability). The dominant axes are usually team topology and independent-deployability needs, not raw scale. For a small team, the second-order costs (distributed debugging, on-call, infra) usually dominate, so the baseline "modular monolith" wins. It's also largely a one-way door once split, so it deserves real rigor.

**Follow-up:** *When do microservices win?* When org size makes coordination on one codebase the bottleneck, or teams genuinely need independent deploy cadences — i.e. the dominant axis is organizational, not technical.

## Q10. How do you handle a criterion that can't be quantified, like "developer experience"?

Two honest moves: (1) **proxy** it with something measurable — DX → "time for a new hire to make a first safe change"; future-flexibility → "count of foreseeable requests this option blocks." (2) **Flag the guess** explicitly: score it `4 (judgment, not measured)`. Never launder a vibe into a confident integer — that's false precision, which is worse than admitting uncertainty. If an unquantifiable criterion *dominates*, run a spike instead of arguing.

## Q11. Your weighted matrix says option B, but your gut says A. What do you do?

Investigate the gap honestly — don't just override or just submit. Either (1) your gut encodes a real criterion missing from the matrix (add it *on its merits* and re-score), or (2) your gut is bias/preference and the matrix is right. The discipline: if adding the missing criterion would make *either* option win, it's legitimate; if it conveniently only rescues your favorite, it's rationalization.

**Trap:** Both "always trust the matrix" and "always trust your gut" are wrong. The matrix is a tool to *interrogate* the gut, not replace or rubber-stamp it.

## Q12. What is an Architecture Decision Record and why does it help objectivity?

A short immutable note (Nygard, 2011): Status / Context / Decision / **Alternatives considered** / **Consequences**. It forces honesty *structurally* — the "Alternatives" section forces a real baseline, and "Consequences" forces you to write down what you're *giving up*. An ADR with only upsides in Consequences is a tell that the decision was sold, not evaluated. It's also your defense in hindsight: it freezes what you actually knew at the time.

## Q13. A decision you made looks wrong six months later. How do you judge it?

Separate **decision quality** from **outcome**. Judge whether the *process* was sound given the information available *then* — fair baseline, honest weights, sensitivity-checked, assumptions stated — not whether the dice came up bad. Hindsight bias makes failures look obvious in retrospect; the ADR is the antidote. A good decision can have a bad outcome, and punishing those teaches people to stop taking defensible risks.

## Q14. How do you avoid analysis paralysis?

Diagnose the door first: most decisions are two-way, so decide fast and revisit. Time-box the analysis ("we decide Thursday with what we have"). Buy cheap decisive information (a spike) instead of debating. Default to "try it behind a flag and measure" for reversible calls. And put a *price* on the cost of delay — "more analysis" then has to beat a concrete weekly dollar figure.

**Trap:** Confusing thoroughness with rigor. Rigor is *proportional* effort; thoroughness everywhere is itself a failure of judgment.

## Q15. How would you convert a one-way door into a two-way door?

Add indirection that preserves optionality: a repository/port interface in front of a database (swap implementations), API versioning behind a gateway (deprecate rather than break), schema-evolution formats (forward/backward compatible), strangler-fig for migrations (reversible at each step), avoiding proprietary vendor features. The conversion isn't free — it costs generality and indirection — so do it *selectively*, only where cost-of-wrong and uncertainty are both high.

**Follow-up:** *When is converting a door a mistake?* When you pay for optionality you'll never exercise — premature generalization on a decision that was actually low-stakes or low-uncertainty. Optionality is itself a tradeoff to evaluate, not a free win.
