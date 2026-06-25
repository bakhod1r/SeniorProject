> Interview questions on Pólya's second stage — *Devising a Plan*. These probe whether you can find a strategy before coding: spot a related/known problem, solve a simpler version first, work backward, sequence by risk, and treat the plan as a testable hypothesis. Answers are short with the trap and a follow-up. Cross-references: [Understanding the Problem](../01-understanding-the-problem/), [Carrying Out the Plan](../03-carrying-out-the-plan/), [stuck techniques](../06-techniques-when-you-are-stuck/).

## Q1. What is "devising a plan" in Pólya's framework, and how is it different from coding?

It's the second of his four stages: finding the *connection between the data and the unknown* — a strategy for getting from what you have to what you want, stated before you build. Coding is stage 3 (carrying it out). The plan is *what approach and in what order*; the code is *the literal implementation*.

**Trap:** Saying "the plan is detailed pseudo-code." That's coding-in-disguise — too low an altitude, locks in choices prematurely.
**Follow-up:** *What altitude should a plan sit at?* Decisions and sequence, concrete enough that a peer can spot a flawed step, abstract enough that you haven't committed to syntax.

## Q2. You're handed an unfamiliar problem and have no idea how to start. What do you do?

Run Pólya's questions until one gives a foothold: *Have I seen this before? Do I know a related problem? Can I solve a simpler version? Can I solve part of it? Can I restate it?* The fastest win is usually recognizing the problem is an instance of a **known class** (a graph traversal, a group-by, a scheduling problem) and reducing to its known solution.

**Trap:** Brute-forcing into code while still confused — you'll discover the approach is wrong after wasting effort.
**Follow-up:** *Which question do most people skip?* "Have I seen this before?" — engineers love inventing; reuse is faster.

## Q3. Explain "solve a simpler version first" with an engineering example.

Shrink the problem until it's solvable, then build back up. For "find two numbers summing to a target," solve size-2 (trivial), then size-3 (check all pairs), then any size (a double loop) — now you have a correct, if slow, plan. The smaller solvable problem is a ladder to the hard one.

**Trap:** Treating the simplified version as the *final* answer — it's a foothold to generalize from, not necessarily the shippable solution.
**Follow-up:** *When is the simple version also the final one?* When data is small enough that the brute-force is fast enough — don't optimize what isn't slow.

## Q4. What's the difference between working forward and working backward?

Forward: start from the data, repeatedly ask "what can I compute next?" until you reach the goal. Backward: start from the goal, ask "what would I need just before this?" until you reach the data you have. Forward suits additive features; backward suits problems where the *end state is clear but the first move isn't*.

**Trap:** Only ever working forward. Some problems (a fixed goal, vague path) only crack when you chain preconditions backward from the goal.
**Follow-up:** *What's the formal name for working backward?* Means-ends analysis (Newell & Simon) — compute the difference to the goal, pick an operator that reduces it, recurse on its preconditions.

## Q5. What does "reduce to a solved problem" mean, and why is it powerful?

Transform your problem into one with a known solution. "Detect cycles in our dependency graph" reduces to graph cycle detection (topological sort). When you recognize the reduction, you inherit a correct algorithm, its complexity, and its known pitfalls — for free, instead of re-deriving them and re-discovering their bugs.

**Trap:** Forcing a bad reduction. If the mapping distorts the real constraints, the inherited solution solves the wrong problem.
**Follow-up:** *What if no reduction fits?* Reach for a general strategy: divide & conquer, brute-force-then-optimize, or a spike to learn.

## Q6. You think of one approach immediately. Should you start building it?

Usually no — generate two or three approaches first (divergent), *then* choose (convergent). Listing alternatives is cheap; skipping it is expensive, because the first idea is rarely the best and you won't know unless you've seen others. The second or third option is often dramatically cheaper or lower-risk.

**Trap:** Anchoring on the first plan and rationalizing it. That's confirmation bias, not planning.
**Follow-up:** *When is one approach fine?* Tiny reversible changes — don't brainstorm three ways to fix a typo.

## Q7. How do you choose between two candidate plans?

Score them on **risk** (likely to fail/surprise?) and **reversibility** (cheap to undo?). Two-way doors (reversible): decide fast, correct from data. One-way doors (irreversible — a schema, a public API, a data model): slow down, spike, get review. Spend planning effort proportional to how hard the decision is to take back.

**Trap:** Treating all decisions as equally weighty (slow everything down) or equally cheap (recklessly take a one-way door).
**Follow-up:** *Give a one-way-door example.* A shard key once 40M rows encode it; a public API contract clients depend on.

## Q8. What is the "riskiest-part-first" principle, and why does it matter?

Sequence the plan so the *most uncertain* step — the one most likely to invalidate the whole approach — comes first, in its cheapest form. The cost of discovering a fatal flaw scales with how much you've built on top of it. Front-load the discovery so failures are cheap.

**Trap:** Doing the easy, satisfying parts first (build the UI, *then* call the flaky third-party API). You discover the dealbreaker last, with the most code to throw away.
**Follow-up:** *Give the canonical example.* Integrating a payment API: call it in a throwaway script day one, before building anything around the assumption it works.

## Q9. How can a plan be "concrete enough to check but not coding-in-disguise"?

It states the *decisions and the sequence* in words — group by X, sum, then output — without committing to function signatures or syntax. The test: a teammate can read it and point to the step they think will fail, *without* reading code. Too vague ("handle the data") and they can't check it; too detailed (pseudo-code) and they're reviewing code, not strategy.

**Trap:** Equating "detailed" with "good." A plan that's just code with line numbers is brittle and untestable as a *plan*.
**Follow-up:** *What single sentence makes a plan checkable?* The kill-criterion: what observation would prove this approach wrong?

## Q10. When should you NOT make a plan and just start coding?

For small, reversible changes — a typo, a rename, a one-line config tweak you can undo in seconds. Planning has a cost; for changes where being wrong is cheap and instantly reversible, the plan is slower than just trying it. Planning pays off in proportion to how much work you'd throw away if the approach is wrong.

**Trap:** Either extreme — ceremony for trivial changes, or no plan for a risky irreversible one.
**Follow-up:** *Restate the rule.* The bigger the thing you'd discard if wrong, the more the plan is worth.

## Q11. Why call a plan a "hypothesis"?

Because it's your best *guess* at the route, and guesses can be wrong — you find out when you build (stage 3). Framing it as a hypothesis means you write it to be *falsifiable*: each risky step names what would prove it wrong, so failure is detected early and cheaply, and you loop back to re-plan instead of grinding.

**Trap:** Treating the plan as a commitment you must force through even as evidence mounts against it (sunk-cost / plan-continuation bias).
**Follow-up:** *What's a kill-criterion?* A pre-decided observation that means "stop, this approach is wrong" — e.g., "if >5% of queries are cross-shard, the shard key is wrong."

## Q12. A spike and an implementation both produce code. What's the difference, and how does it fit planning?

A spike's *purpose is to learn* — answer one question ("will this API work?", "is this fast enough?") — then it's thrown away. It's a planning tool: when the unknown is "will this even work," the plan is to spike before committing. An implementation is the real, kept thing. Confusing them — shipping a spike to production — is a classic mistake.

**Trap:** Letting the throwaway prototype become the foundation. Spike code has no tests, no error handling; building on it inherits all that.
**Follow-up:** *Where does the spike sit in the plan?* Usually step one of a risky plan — the riskiest-part-first move that retires the unknown before real work begins.

## Q13. Your plan's step 2 turns out to be impossible mid-build. What do you do?

Stop and return to *devising a plan* — don't force a broken approach. The new information (step 2 is impossible) is exactly the input to re-planning; you now know more than you did the first time. The fast plan→build→re-plan loop is the skill, not making a perfect plan up front.

**Trap:** Grinding — hacking around the impossible step instead of acknowledging the plan is invalidated.
**Follow-up:** *How do you avoid this discovery coming late?* Sequence riskiest-part-first so "step 2 is impossible" surfaces early, when little is built on it.

## Q14. How does devising a plan change from a single function to a multi-team initiative?

For a function, you sequence *steps*. For a multi-team program, you decompose along **stable interfaces** so teams work in parallel without blocking, then sequence to retire coordination/integration risk first — often a "walking skeleton" that threads a thin path through every team's surface to prove the seams compose before teams build depth. The plan becomes a strategy doc with assumptions, decision rights, and kill-criteria, written to be steered by others.

**Trap:** Scaling up by writing a bigger step-list. At program scale, the *interfaces and the order of de-risking* are the plan, not the task breakdown.
**Follow-up:** *Why a walking skeleton?* It moves integration risk to the front, while seams are still cheap to change, instead of exploding at a late big-bang integration.

## Q15. How do you keep a plan from being either too vague or too rigid?

State the *next de-risking phase* in detail and the rest as direction. Commit firmly to one-way doors (data model, core interfaces, architectural direction); keep two-way doors (framework choice, low-risk feature order) deferred to the last responsible moment. Name your assumptions so you know exactly what to re-check when reality shifts — that's what lets a plan bend instead of break.

**Trap:** A six-month detailed up-front plan (waterfall in disguise — obsolete by month two) *or* a plan so loose no one can act on it.
**Follow-up:** *What makes a plan "survive contact with reality"?* Not being right, but knowing its assumptions and having named the observations that would change it.
