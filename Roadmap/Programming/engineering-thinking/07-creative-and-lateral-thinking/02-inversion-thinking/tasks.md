> Exercises for **inversion thinking**. Each task makes you flip a goal, build a failure/abuse list, and turn it into defenses, tests, invariants, or a checklist. Global constraints for every task: (1) **enumerate** — produce a discrete, numbered list, not a paragraph; (2) **map each item to an action** — a guard, test, invariant, alert, or runbook step; (3) **rank** by likelihood × blast radius and say which you'd defend now vs. document-and-accept; (4) stay **productive** — end in a build/checklist, never a "this won't work." Where a deliverable is named, produce that artifact.

---

## Task 1 — Invert the reliability goal

Pick a service you've worked on (or use a generic "URL shortener API"). Write the sabotage playbook answering **"How would I guarantee this service has a bad outage?"** — at least 8 distinct items. Then flip each line into a reliability control.

**Deliverable:** a two-column table (`Sabotage → Control`) plus a one-paragraph note on which 3 controls you'd implement first and why (use likelihood × blast radius).

## Task 2 — Anti-requirements for a payments endpoint

For `POST /charge`, write the **anti-requirements**: at least 6 things this endpoint must NEVER do (double-charge, log a CVV, charge without auth, leave money in a charged-but-no-order state, …). For each, name the enforcement mechanism *and* place it on the strength ladder (convention / runtime check / DB constraint / type-state).

**Deliverable:** a table with columns `Must NEVER… | Enforcement | Ladder rung`. Mark which ones you've pushed to the lowest (most automatic) rung, and which are still only conventions you should harden.

## Task 3 — Negative-test a function

Take this function (or one of your own):

```python
def apply_discount(price, percent):
    return price - price * percent / 100
```

Build the "how would I break this?" list (≥7 items: negative price, percent > 100, percent < 0, `None`, string input, float-rounding to fractions of a cent, huge values). Write a negative test for each, and patch the function so every test passes by failing cleanly or clamping correctly.

**Deliverable:** the hardened function plus the negative test suite. Note which inputs you reject vs. clamp, and justify each choice.

## Task 4 — Debug by inversion

Take a recent intermittent bug (or this scenario: *"a user's cart total is occasionally £0.01 off"*). Apply **"What would have to be true for this exact symptom to appear?"** List ≥5 conditions that could each produce it, rank them by prior likelihood, and for each write the single cheapest experiment that would confirm or kill it.

**Deliverable:** a ranked hypothesis table (`Condition | Prior | Falsifying experiment`). State which hypothesis you'd test first and why it's the best cost/information trade-off.

## Task 5 — Design the failure cases first (API)

Design `POST /transfers` (move money between two accounts) **starting from the failures**. Enumerate ≥6 failure modes before writing any happy path, and for each define a distinct, machine-readable error code plus the design decision it forces (idempotency key, locking, distinct codes for insufficient-funds vs. frozen-account, downstream-down handling).

**Deliverable:** the full error contract (codes + meanings + client guidance) written *before* the success response schema. Add one sentence per code explaining why it must be distinct from the others.

## Task 6 — Threat-model an upload feature (attacker inversion)

For an "upload your profile picture" feature, adopt the attacker's goal: **"How would I abuse this?"** List ≥7 abuse cases (executable disguised as image, oversized file, path-traversal filename, SVG/polyglot stored XSS, zip bomb, content-type confusion on serve, rate-based DoS). Turn each into a control.

**Deliverable:** an `Abuse case → Control` table. Map each abuse case to a STRIDE category and note which controls are preventive vs. detective.

## Task 7 — Run a pre-mortem

Pick a real or hypothetical project ("migrate auth to a new identity provider in Q3"). Run a pre-mortem on yourself: assume it's failed badly six months out, and write ≥8 reasons why. Cluster them, rank by likelihood × impact, and for each top-3 risk assign an owner and a concrete mitigation with a due date.

**Deliverable:** a pre-mortem doc — failure reasons, ranked risk table, and the mitigation plan. Note any reason that, before the exercise, you'd have been reluctant to say out loud (and why the pre-mortem framing unlocked it).

## Task 8 — Via negativa audit

Take a system, module, or process you own. List ≥6 things you could **remove** to improve it — dead code paths, unused config options, a single-use dependency, a feature with low usage and high failure surface, a process gate that's never caught anything. For each, state what it lets fail today and what removing it buys.

**Deliverable:** a `Remove | Failure surface it eliminates | Risk of removal` table. Pick the highest-leverage removal and write the one-paragraph case for doing it.

## Task 9 — Design a chaos experiment

Choose a critical dependency in a system you know (cache, database, a downstream API). Design a **chaos experiment** following the discipline: define the steady-state metric, state the hypothesis, choose the fault to inject (latency, errors, full outage), set the blast radius and abort condition, and predict the result.

**Deliverable:** a one-page experiment plan (steady state, hypothesis, fault, blast-radius limits, abort switch, predicted vs. to-be-measured outcome). State explicitly what a *failed* hypothesis would reveal about your system.

## Task 10 — Inversion vs. contrarianism sort

Here are 8 statements made in a design review. Classify each as **productive inversion** or **mere contrarianism**, and rewrite the contrarian ones into productive inversions:

1. "This will never scale."
2. "If we don't set a timeout here, one slow dependency stalls every request — let's add one."
3. "Microservices are always a mistake."
4. "What happens if this queue fills up? Right now it's unbounded; we should add backpressure."
5. "I don't trust this."
6. "If the cache and DB disagree, which wins? We haven't defined that — let's pick a rule."
7. "Nobody actually needs this feature."
8. "How would an attacker replay this request? There's no nonce; we should add one."

**Deliverable:** the classification table plus rewrites. State the single rule you used to tell them apart.

## Task 11 — Anti-requirement review of a real PR

Find a recent non-trivial PR (yours or a teammate's). Review it *purely through inversion*: what must this change NEVER do, and does the PR guarantee it? Produce ≥5 "must never" checks and verify each against the diff (covered by a test? enforced by a constraint? only hoped for?).

**Deliverable:** an anti-requirement review comment listing each "must never," its current enforcement status, and a concrete request where enforcement is missing.

## Task 12 — Turn an incident into a failure class (organisational inversion)

Take a past incident (real or this one: *"a retry storm during a brief downstream blip amplified load and took the service down"*). Apply the principal-level move: **generalise from the instance to the class.** Identify the failure class, then find ≥3 *other* places in your systems where that same class could occur, and propose a single guardrail (lint rule, default config, checklist item) that prevents it everywhere.

**Deliverable:** a short writeup — instance → failure class → other locations → one systemic guardrail. Explain how the guardrail protects teams who never lived the original incident.

---

### See also

- [Divergent vs. convergent thinking](../01-divergent-vs-convergent/) · [Analogical thinking](../03-analogical-thinking/) · [Constraint-driven creativity](../04-constraint-driven-creativity/)
- [Cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/) · [Risk and failure probabilities](../../06-probabilistic-thinking/03-risk-and-failure-probabilities/)
- [Section overview](../) · [Engineering-thinking roadmap](../../README.md)
