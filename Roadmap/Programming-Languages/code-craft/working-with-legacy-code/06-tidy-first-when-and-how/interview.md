# Tidy First — When and How — Interview Questions

> **Source:** Kent Beck, *Tidy First?* (O'Reilly, 2023). Questions run junior → staff. Each has a model answer and follow-ups. Related: [`../../refactoring/`](../../refactoring/), [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/), [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/).

---

## Table of Contents

1. [Q1 — What is a tidying? (junior)](#q1)
2. [Q2 — Tidying vs. refactoring (junior)](#q2)
3. [Q3 — The structure/behavior rule (junior)](#q3)
4. [Q4 — Name and demo five tidyings (junior→mid)](#q4)
5. [Q5 — How do you keep a tidying safe? (mid)](#q5)
6. [Q6 — Why separate commits/PRs? (mid)](#q6)
7. [Q7 — First / After / Later / Never (mid→senior)](#q7)
8. [Q8 — When is tidying premature? (senior)](#q8)
9. [Q9 — The coupling/cohesion "why" (senior)](#q9)
10. [Q10 — Reviewability and throughput (senior)](#q10)
11. [Q11 — Tidying under a deadline (senior)](#q11)
12. [Q12 — One Pile and over-abstraction (senior)](#q12)
13. [Q13 — Tidying as optionality / economics (staff)](#q13)
14. [Q14 — Rolling out tidy-first on a resistant team (staff)](#q14)
15. [Q15 — Tidying code you don't understand (staff)](#q15)
16. [Q16 — Design a CI guardrail for tidy PRs (staff)](#q16)

---

<a id="q1"></a>
## Q1 — What is a tidying? (junior)

**Question.** What does Kent Beck mean by a "tidying"?

**Model answer.** A tidying is a small, safe change to the *structure* of code — how it reads — that makes the next change easier, *without* changing what the code does. Examples: a guard clause, an explaining variable, deleting dead code, adding blank lines to group statements. The defining traits are that it's tiny (seconds to minutes), behavior-preserving (existing tests pass unchanged), and aimed at making future change cheaper.

**Follow-up — "How is it different from a comment cleanup or formatting?"** Formatting and comment cleanups *are* tidyings — they're structure-only. The umbrella is "any small behavior-preserving structural improvement." What's *not* a tidying is anything that changes output or side effects; that's a behavior change.

---

<a id="q2"></a>
## Q2 — Tidying vs. refactoring (junior)

**Question.** Is a tidying just refactoring? Why coin a new word?

**Model answer.** A tidying *is* refactoring — specifically "refactoring in the small." Beck coined the term because "refactoring" had come to mean everything from renaming a variable to a two-week module rewrite, and that ambiguity made people *plan* for cleanups that should just happen. "Tidying" names the small end: changes so cheap and safe you do them constantly, without ceremony. Same behavior-preserving discipline, smaller scale, no planning overhead.

**Follow-up — "So when do you need 'big' refactoring?"** When the structural change is large enough to carry real risk and coordination cost — restructuring across many files, changing an architecture. Those need tests, planning, and buy-in. Tidyings don't. The full catalog and mechanics live in [`../../refactoring/`](../../refactoring/).

---

<a id="q3"></a>
## Q3 — The structure/behavior rule (junior)

**Question.** State the single most important rule of "Tidy First" and justify it.

**Model answer.** **Never mix a structure change and a behavior change in the same commit (or PR).** Justification: the two have different risk profiles and different verification. A structure change is verified by *existing tests still passing*; a behavior change is verified by a *new or changed test*. Merge them and you lose both signals — the reviewer can't trust the suite (it changed) and can't isolate the new logic. You also lose revertability: a production revert of a mixed commit takes the cleanup *and* the fix down together.

**Follow-up — "Give me a concrete failure from mixing."** A dev fixes a null check and "while there" rewrites a loop as a stream. The stream changes iteration order, breaking a downstream consumer. Reverting the outage reverts the null fix too, re-opening the original bug. Two commits would have caught it: an order-dependent test fails on the *structure* commit, before the fix ever ships.

---

<a id="q4"></a>
## Q4 — Name and demonstrate five tidyings (junior→mid)

**Question.** Name five tidyings and show a one-line before/after for two of them.

**Model answer.** Guard Clauses, Dead Code, Explaining Variable, Explaining Constant, Chunk Statements, Extract Helper, Normalize Symmetries, Cohesion Order, Explicit Parameters, New Interface/Old Implementation, Reading Order, One Pile (any five).

Guard Clauses:
```java
// before
if (u != null) { if (u.active()) { return u.name(); } } return "?";
// after
if (u == null) return "?";
if (!u.active()) return "?";
return u.name();
```

Explaining Constant:
```python
# before
if attempts >= 3: lock()
# after
MAX_ATTEMPTS = 3
if attempts >= MAX_ATTEMPTS: lock()
```

**Follow-up — "Which do you reach for most, and why?"** Extract Helper and Explaining Variable/Constant — they're the highest-leverage for readability and they're IDE-mechanical (Extract Method, Extract Variable), so they're behavior-preserving by construction.

---

<a id="q5"></a>
## Q5 — How do you keep a tidying safe? (mid)

**Question.** Walk me through how you perform a tidying so you're confident it's safe.

**Model answer.** A tight loop: (1) confirm the test suite is green; (2) apply *one* tidying — preferably via an IDE refactoring so it's mechanical; (3) re-run the suite — it must pass *unchanged* (no test edits); (4) commit with a `tidy:`/`refactor:` message. The key safety property is that I never touch a test during a structure change. If I find myself editing a test, that's my tripwire that I've crossed into behavior and need to stop and split.

**Follow-up — "What if there are no tests?"** Then I can't safely guarantee behavior preservation by running them. I either limit myself to IDE-mechanical refactorings (which are safe by construction) or I write characterization tests first to pin current behavior — see [`../04-characterization-tests/`](../04-characterization-tests/) — before tidying by hand.

---

<a id="q6"></a>
## Q6 — Why separate commits/PRs? (mid)

**Question.** Beyond "it's cleaner," what concrete benefits come from separate structure and behavior commits?

**Model answer.** Four concrete ones: **(1) Bisecting** — `git bisect` lands on a small, single-purpose commit, so the bad line is obvious instead of buried in a mixed blob. **(2) Reverting** — you can pull the bug fix and keep the cleanup, or vice versa. **(3) Review speed** — the structure PR is a 60-second skim (tests unchanged, green CI), so reviewers spend their attention on the behavior PR. **(4) History as narrative** — the log reads as deliberate moves, not "wip" mud. The throughput win is real: two fast PRs beat one slow mixed one.

**Follow-up — "Doesn't this slow you down with extra PRs?"** Net, it speeds the *team* up. Total review time drops because structure PRs are near-instant, and you avoid the slow, dangerous review of a tangled diff. The cost is a little more git mechanics; the payoff is faster reviews and safer reverts.

---

<a id="q7"></a>
## Q7 — First / After / Later / Never (mid→senior)

**Question.** Beck gives four options for a tidying you've spotted: First, After, Later, Never. Explain each and what drives the choice.

**Model answer.**
- **Tidy First** — tidy *before* the behavior change, when the tidying directly removes an obstacle and the payback is *immediate* (you change this code in the same task). Flatten the nest, then add the case as a one-liner.
- **Tidy After** — change first, tidy second, when you only understood the right shape *after* working in the code. Risk: it slides into "never" under deadline, so commit to the follow-up.
- **Tidy Later** — worthwhile but *off today's path*; you'll revisit soon, so schedule it (ticket/note) rather than bloat today's PR.
- **Never** — the code is stable, off your path, or doomed; tidying it is cost with no return. Often the correct answer.

Three questions drive it: Do I understand the code? Will I touch it again soon? Is the tidying coupled to (enables) the change I'm making?

**Follow-up — "What's your default and why?"** Lean toward **Never** for code I'm not touching, and **Tidy First** for code that's actively blocking the change I'm making. The compounding payoff is highest when the tidying enables an imminent change; it's zero for code nobody reads.

---

<a id="q8"></a>
## Q8 — When is tidying premature? (senior)

**Question.** Tidying is good — so when is it *wrong* to tidy?

**Model answer.** When the payback isn't near or probable. Specific failure modes: tidying with **no imminent change** (aesthetics-only, hypothetical payoff); **speculative generality** (adding interfaces/abstractions no requirement asks for — YAGNI); **tidying code you can't characterize** (your "structure-only" change might silently alter behavior); a "quick tidy" that **balloons the PR** and destroys the reviewability you tidy *for*; and tidying a **throwaway** slated for deletion. It's the mirror of premature optimization: effort on a dimension that isn't on the critical path.

**Follow-up — "How do you resist the urge when code offends you?"** I ask: is there a change headed for this code soon? If not, I consciously choose **Never** (or jot a *Later* note if I'll genuinely be back). Tidying is an investment; investing in low-return code starves the high-return work. Restraint is the senior move.

---

<a id="q9"></a>
## Q9 — The coupling/cohesion "why" (senior)

**Question.** Underneath the catalog, what is tidying actually *for*, in design terms?

**Model answer.** It's about **coupling** and **cohesion** — the cost drivers of change. Coupling is how much changing one element forces changing others; cohesion is how much the things that change together live together. Almost every tidying reduces coupling or raises cohesion on the path you're about to walk: Explicit Parameters removes coupling to a global; Cohesion Order co-locates things that change together; Extract Helper names and localizes a concept; New Interface decouples callers from an implementation. Software's lifetime cost is dominated by the sum of change costs, and coupling inflates every one of them. Tidying is a targeted, local investment that lowers the coupling exactly where you're about to pay it.

**Follow-up — "So tidying is just applying SOLID/DRY?"** It's the *small-batch, opportunistic* application of those forces. The design principles (see [`../../design-principles/`](../../design-principles/)) are the physics; tidyings are the everyday moves that nudge a local region toward lower coupling and higher cohesion, right before you need it.

---

<a id="q10"></a>
## Q10 — Reviewability and throughput (senior)

**Question.** Argue that separating structure from behavior makes the *team* faster, not just the individual.

**Model answer.** Code review is most teams' throughput bottleneck. A mixed PR forces the reviewer to answer two questions per line — "is this behavior-preserving?" and "is the new behavior right?" — and they can't lean on the test suite because it changed. That's slow and error-prone, which is why big mixed PRs sit for days. Split it: the structure PR asks only "preserving?" — answerable from "tests unchanged, CI green" in under a minute — and the behavior PR is small because the runway's clear, so the reviewer reads only genuinely new logic. Two 2-minute reviews beat one 40-minute review that ships a week late. Reviewability is a property you *design into* a change set, and structure/behavior separation is the main lever.

**Follow-up — "What's the failure mode if reviews are slow even when split?"** Structure PRs that sit unmerged become conflict bombs against everyone's branches. So splitting only pays if structure PRs are *also* merged fast — which is why I keep them tiny, pre-announce them, and push the team to fast-track clean ones.

---

<a id="q11"></a>
## Q11 — Tidying under a deadline (senior)

**Question.** It's crunch time. Do you still tidy? How does the deadline change your behavior?

**Model answer.** Deadlines change *how much* I tidy, never *how*. I tidy *less* — leaning on **Never** and **Later** — but I never sacrifice the structure/behavior separation, because that separation is exactly what protects me when I'm rushed and error-prone. The one nuance: if the mess is *on the critical path* of this change — the tangle is what's making the feature slow and risky — then a small **Tidy First** is often the *fastest* route, not a detour. Flattening before threading a new branch through a nest can be quicker than threading it. Under deadline I restrict myself to IDE-mechanical tidyings I'm certain are safe — no One Pile, no speculative interfaces.

**Follow-up — "A teammate says 'no time, just bundle the cleanup with the fix.'"** That's the one thing I won't do. Bundling is how a deadline bug becomes un-revertable. The separation is the seatbelt — you don't remove it because you're driving fast. I'd split it even if I tidy almost nothing.

---

<a id="q12"></a>
## Q12 — One Pile and over-abstraction (senior)

**Question.** Most tidyings *split* code into smaller pieces. When would you do the opposite — inline things?

**Model answer.** That's the **One Pile** tidying. When logic has been chopped into so many tiny pieces — one-line helpers, premature indirection — that you have to jump around to follow it, you *inline* the fragments back into one place so you can see the whole thing, understand it, and then re-split along *better* lines with names that carry weight. It treats over-fragmentation as a smell, not a virtue. One Pile is usually *temporary*: gather → understand → re-extract. It's the honest acknowledgment that abstraction has a cognitive cost, and that more, smaller functions isn't automatically better.

**Follow-up — "Isn't inlining a behavior risk?"** It's still structure-only if done mechanically (the IDE's Inline refactoring) and verified by unchanged green tests. The risk is no different from any tidying: keep it small, lean on automated refactorings, and watch the test diff stays empty.

---

<a id="q13"></a>
## Q13 — Tidying as optionality / economics (staff)

**Question.** Frame the decision to tidy as an economic one. Why does Beck reach for finance metaphors?

**Model answer.** A tidying is a cost paid *now* for a benefit reaped *later* — cheaper future changes. That's an investment, so finance applies. Specifically, tidying buys an **option**: you spend a small premium now to make a *possible* future change cheaper; if that change never comes, the option expires worthless. The **discount rate / time-value** matters — a benefit far in the future is worth less than one tomorrow — which is exactly why "Tidy First" wins when the payoff is *imminent* and loses when it's distant or speculative. And **reversibility lowers the cost of being wrong**, so small reversible tidyings are *cheap* options: if the future doesn't materialize, you risked little. The four WHEN choices map to bets with different horizons: First = pays off this turn; After = pay the premium once the bet's confirmed; Later = defer to when the payoff nears; Never = decline.

**Follow-up — "When does the option math say 'definitely don't tidy'?"** When the probability you'll touch the code again is low *and* the premium (review attention, conflict risk) is non-trivial. Distant, unlikely payoff plus real present cost = decline. The full time-value treatment is in [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/).

---

<a id="q14"></a>
## Q14 — Rolling out tidy-first on a resistant team (staff)

**Question.** You join a team that ships big mixed PRs and reviews are slow. How do you introduce tidy-first without a mandate war?

**Model answer.** I'd make it *easy and demonstrably faster*, not a policy fight. Concretely: (1) **Model it** — start opening my own structure-only PRs, tiny, labeled `tidy:`, merged same-day, and let people see they're trivial to review. (2) **Show the receipts** — point to a feature PR that was small and obviously-correct *because* a tidy PR cleared the runway first. (3) **Make trust mechanical** — add a CI check that fails `tidy:` PRs touching test files, so reviewers can fast-track them without policing. (4) **Fast-track as a reviewer** — approve others' clean structure PRs in minutes, reinforcing the behavior. (5) **Reach for the economic argument** with leads: two 2-minute reviews beat one 40-minute one. I'd avoid framing it as "the right way" and frame it as "the faster way," because throughput is what wins skeptics.

**Follow-up — "A senior insists separating is 'extra process.'"** I'd grant their concern (more PRs *is* more git mechanics) and reframe the ledger: net review time *drops*, reverts get surgical, and bisects get precise. I'd offer to measure review turnaround before/after on a few PRs — let the data, not the argument, settle it.

---

<a id="q15"></a>
## Q15 — Tidying code you don't understand (staff)

**Question.** You need to tidy a gnarly module to make a change, but you don't fully understand its behavior. What's your sequence?

**Model answer.** I don't tidy blind — a "structure-only" change to code I can't characterize might silently alter behavior, and I have no test to catch it. So: (1) **Pin behavior first** with characterization tests — capture what the code *actually* does today, warts included (see [`../04-characterization-tests/`](../04-characterization-tests/)). (2) With the net in place, **tidy in tiny IDE-mechanical steps**, re-running the (now-existing) tests after each, watching they stay green and unchanged. (3) Often the right first move is **Tidy After**: make the behavior change, *then* tidy, because working in the code is what finally reveals its shape. Sometimes I'll **One Pile** the fragments to see the logic whole before re-splitting. The throughline: never reshape code whose behavior you can't verify.

**Follow-up — "What if even adding characterization tests is blocked by tight coupling?"** Then I need a *seam* first — break a dependency so the code is testable. Explicit Parameters and New Interface/Old Implementation are tidyings that double as seam-creators; the broader toolkit is [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/). Seam → characterize → tidy → change.

---

<a id="q16"></a>
## Q16 — Design a CI guardrail for tidy PRs (staff)

**Question.** Design an automated guardrail that makes "structure-only" PRs trustworthy without relying on reviewer vigilance.

**Model answer.** The strongest mechanical trust signal is *"a structure PR changes no tests."* So the core check: **if a PR is labeled `tidy`/`refactor`, fail the build if it modifies any test file or any behavior-bearing config** (dependency manifests, migrations, feature flags). Sketch:

```bash
# CI step: enforce structure-only PRs labeled `tidy`
if pr_has_label "tidy"; then
  changed=$(git diff --name-only origin/main...HEAD)
  if echo "$changed" | grep -E '(^|/)(test|spec)/|\.test\.|\.spec\.|package\.json|migrations/'; then
    echo "::error:: A 'tidy' PR must not change tests, deps, or migrations."
    exit 1
  fi
fi
```

Complement it with: require the existing suite to be green (no skips added), and optionally a coverage check that the diff touches no test assertions. The point is to convert the human discipline ("don't mix") into a machine invariant, so reviewers can fast-track `tidy:` PRs *because the CI already guaranteed the trust signal*.

**Follow-up — "What can this guardrail NOT catch?"** A behavior change that needs *no* test change to express it — e.g., a tidying that subtly alters iteration order where no test pins the order. CI can prove "no tests changed," not "behavior unchanged." That gap is exactly why characterization tests and small IDE-mechanical steps still matter: the guardrail enforces the *labeling discipline*, but behavior preservation ultimately rests on a good test net plus mechanical refactorings.

---

> **Closing note for candidates.** The interview signal that separates levels: juniors recite the catalog; mids can keep changes separated and explain *why*; seniors reason about coupling, risk, reversibility, and *when not to tidy*; staff frame it economically, roll it out socially, and make the discipline mechanical with tooling. Across all levels, the one answer that must never waver: **structure and behavior go in separate commits.**
