> Practice tasks for spikes and prototypes. **Global constraints for every task:** (1) every spike must name exactly **one** technical question; (2) every spike must declare a **time box** before any code; (3) every spike's deliverable is a **decision + a short writeup**, never a feature; (4) spike code is **throwaway** — assume you will delete it. Where a task asks for a writeup, use the format: *Question · Time box · Answer · Evidence · Decision · Next step*. Do these on paper or in a scratch repo; the thinking is the point.

---

## Task 1 — Turn a vague worry into a spike question

You're told: *"I'm not sure our reporting will be fast enough."*

Rewrite this as a proper spike: state the **one** question concretely (with a measurable threshold), set a time box, and name the decision it unblocks.

**Acceptance:** Your question has a number in it (e.g. a latency or row-count threshold), a time box in hours/days, and a one-sentence "this decides whether we…". A question with no threshold or no decision fails.

---

## Task 2 — Classify: spike, prototype, PoC, or MVP?

For each item, label it and give one sentence of justification:

1. A clickable Figma-to-code screen shown to 5 users to test a checkout flow.
2. Three days of code wiring your real auth, a real DB write, and a real deploy, doing almost nothing — to prove the pipeline connects.
3. A 20-line script checking whether a vendor's API works behind your corporate proxy.
4. The first paid release of a new product to 100 beta customers.
5. An end-to-end demo built to convince leadership that "edge inference" is even feasible.

**Acceptance:** (1) prototype, (2) walking skeleton / evolutionary, (3) spike, (4) MVP, (5) PoC. For each, you can state whether the code is *kept* and whether it's *production quality*.

---

## Task 3 — Write the spike conclusion

Given this raw result, write the proper writeup (Question · Time box · Answer · Evidence · Decision · Next step):

> *"I tried the `parquet` library on our exports. Worked great on the 100MB file, returned in 2s. The 4GB file ran out of memory and crashed. Time-boxed it to half a day, used about 3 hours."*

**Acceptance:** Your decision is actionable (e.g. "stream/chunk large exports, or cap export size") and includes deleting the spike code + a real follow-up ticket. A writeup that just says "it kind of works" fails the global constraint #3.

---

## Task 4 — Decide: spike or don't spike?

For each, answer **spike** or **don't spike**, and why:

1. "Does PostgreSQL support partial indexes?"
2. "Can our ML model return a fraud score in under 50ms on production-scale data?"
3. "Should the new service be written in Go or Rust?"
4. "Will 5 million records fit in 16GB of RAM if each is ~2KB?"
5. "Does this third-party SDK actually work behind our VPN?"

**Acceptance:** (1) don't — read docs; (2) spike — unknowable without code, high impact; (3) don't — that's a design/discussion call, not a code question; (4) don't — arithmetic (~10GB, fits); (5) spike — environment-specific, only code tells you. Justify each with the "knowable without code?" test.

---

## Task 5 — Catch the prototype-to-production trap

A teammate opens a PR titled *"Promote search spike to main"* that merges their spike branch directly. The code has no tests, secrets hardcoded, and one 300-line function — but it works.

Write the review comment you'd leave. Explain *why* merging it is wrong and *what* the correct path is.

**Acceptance:** You name the trap, explain that the spike's deliberate shortcuts become permanent debt, and prescribe: keep the *learnings*, delete the branch, implement fresh through normal review/tests. Approving the merge fails the task.

---

## Task 6 — Order the spikes by risk

A new feature "live collaborative editing" has these unknowns. Rank them in the order you'd spike them, using impact-if-wrong × uncertainty:

- A. Can our CRDT library merge concurrent edits without conflicts at 50 concurrent users? *(unsure; whole design depends on it)*
- B. Will the toolbar icons match the design system? *(cosmetic)*
- C. Can we read the document from the existing DB? *(almost certainly yes)*
- D. Can we push updates to clients with < 200ms latency? *(unsure; reshapes the design if no)*

**Acceptance:** Order is roughly A, D, then C/B deferred or skipped. You can articulate why testing A first means that if it fails, nothing built around it is wasted.

---

## Task 7 — Design a spike that can fail loudly

Take this rigged spike and fix it:

> *"To test if Postgres full-text search is fast enough, I ran one query on 1,000 rows on my laptop. It returned instantly. Conclusion: it's fast enough."*

List everything wrong with it and rewrite the experiment so it could actually *disconfirm* the belief.

**Acceptance:** Your version uses production-scale + messy data, adversarial queries (rare/long terms), concurrency, measures **p95** against a stated threshold, and stops at a decision (pass *or* fail). You can state the single observation that would prove the approach wrong.

---

## Task 8 — Pre-commit a decision rule

You're about to spike on-device video transcoding. Before running anything, write the **decision rule** that will be applied to the result.

**Acceptance:** Your rule is a concrete if/then with numbers, decided *before* the spike (e.g. "if a 2-min 1080p clip transcodes in < 30s with no thermal throttling, pursue it; else drop client-side and go server-side"). Explain *why* committing the rule in advance matters (it neutralizes sunk-cost reasoning when the inconvenient answer arrives).

---

## Task 9 — Write a spike as a team ticket

Convert this into a board card a teammate could pick up cold: *"someone should look into whether we can use websockets for notifications."*

**Acceptance:** The card states the **one question**, the **time box** (a cap, not an estimate), the **acceptance question / threshold**, and the **decision it unblocks** ("spend ≤ X to answer Q so we can decide D"). If a reader can't tell when it's "done," it fails.

---

## Task 10 — Spike vs walking skeleton vs tracer bullet

Explain, in your own words and with a concrete example each, the difference between a **spike**, a **walking skeleton**, and a **tracer bullet**. Then state, for each, whether the code is thrown away or kept.

**Acceptance:** Spike = throwaway, one question. Walking skeleton (Cockburn) = kept, thin end-to-end through the whole architecture + pipeline. Tracer bullet (Hunt & Thomas) = kept, thin real slice you build along and thicken. You correctly mark the spike as the only throwaway of the three.

---

## Task 11 — Design a staged de-risking gate

You're a tech lead and someone proposes a 2-quarter "edge inference" flagship. Design a **gated sequence** of escalating-cost experiments (desk research → spike → walking skeleton → full build), with a kill criterion at each gate.

**Acceptance:** Each gate costs more than the last, is only entered if the prior passed, and has an explicit "stop here if…". You can explain how this makes a doomed bet die at gate 0 or 1 for a few days instead of at month 4 for a team-quarter.

---

## Task 12 — Defend the spike budget to leadership

Leadership says: *"Why are we spending 10% of capacity on spikes instead of shipping features?"* Write a 3–4 sentence response.

**Acceptance:** You argue from **expected value of information** and from **cheaply-killed bets** — ideally with a quantified example ("two bets killed at gate 1 this quarter freed ~1.5 team-quarters"). You frame de-risking as protecting feature capacity from late, expensive surprises, not competing with it. See [first-principles thinking](../../05-first-principles-thinking/) and the section root [Scientific & Hypothesis-Driven](../) for the underlying reasoning, and the [Engineering Thinking roadmap](../../README.md) for the broader map.
