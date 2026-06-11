# The Legacy Change Algorithm — Professional Level

## Table of Contents

- [Leading legacy work, not just doing it](#leading-legacy-work-not-just-doing-it)
- [Turning the algorithm into a team process](#turning-the-algorithm-into-a-team-process)
- [Slicing a legacy change into incremental PRs](#slicing-a-legacy-change-into-incremental-prs)
- [Reviewing legacy-change PRs: what to look for](#reviewing-legacy-change-prs-what-to-look-for)
- [Decision frameworks you can hand to a team](#decision-frameworks-you-can-hand-to-a-team)
- [Coordinating across people and time](#coordinating-across-people-and-time)
- [Checklists](#checklists)
- [War stories](#war-stories)
- [Pitfalls that bite teams, not individuals](#pitfalls-that-bite-teams-not-individuals)
- [Related Topics](#related-topics)

---

## Leading legacy work, not just doing it

The senior file is about making good decisions on a single change. This file is about a tech lead or staff engineer making the *whole team* good at legacy change — turning a private skill into a repeatable, reviewable, teachable process that survives staff turnover and deadline pressure. The failure mode is a team where one person can safely touch the scary subsystem and everyone else routes their tickets to that person. That bottleneck is an organizational risk, and dissolving it is leadership work.

The Legacy Change Algorithm is unusually good raw material for this, because it's already a *protocol*. Protocols are teachable, checkable, and enforceable in review in a way that "be careful" is not. The job is to operationalize it: bake it into your definition of done, your PR templates, your review rubric, and your estimation conversations, so that the safe path is also the *default* path and the easy path.

> **Key idea:** A senior runs the algorithm well. A professional makes the algorithm the team's default — encoded in process, review, and estimation — so safety doesn't depend on who picks up the ticket.

## Turning the algorithm into a team process

Map each step to an artifact and a checkpoint, so "did you follow the algorithm" becomes an observable fact rather than a trust exercise.

| Step | Team artifact | Where it's checked |
| --- | --- | --- |
| 1 Identify change points | A one-line "change point" note in the PR description | PR review, planning |
| 2 Find test points | The test file(s) that will exercise it, named in the plan | Design review for risky changes |
| 3 Break dependencies | A separate "no-behavior-change" PR or commit | Review labels: `refactor-only` |
| 4 Write characterization tests | New tests committed *before* the behavior change | CI diff: tests added before feature commit |
| 5 Make the change + refactor | The behavioral PR, with old + new tests green | CI; review |

Two cultural commitments make this stick:

**Characterization tests are part of the change, not a follow-up ticket.** The moment "add tests" becomes a separate backlog item, it never happens — the next deadline eats it. The definition of done for a legacy change *includes* the net. If the change is genuinely too risky to net in the available time, that's escalated as a risk decision (see the senior file's "no time for tests" framing), not silently deferred.

**Structural changes ship without behavioral changes in the same diff.** This is [tidy-first](../06-tidy-first-when-and-how/) as a *team* rule, and it's the single highest-leverage convention you can install. When dependency-breaking (step 3) and the feature (step 5) live in separate PRs, reviewers can verify the first is behavior-preserving by inspection and the second by its tests. Mixed diffs are where regressions hide, because the reviewer can't tell which line was supposed to change behavior.

## Slicing a legacy change into incremental PRs

A single legacy change is rarely one PR. The algorithm naturally decomposes into a sequence that is safer to ship and far easier to review than one big diff. The default slicing:

```
PR 1  Break dependencies        label: refactor-only    risk: low   review: "prove nothing changed"
PR 2  Add characterization tests label: tests-only       risk: none  review: "are these pinning reality?"
PR 3  Make the behavior change   label: feature          risk: med   review: "is the new behavior right + old still green?"
PR 4  Tidy / refactor            label: refactor-only    risk: low   review: "tests still green, code clearer?"
```

Why this beats one big PR:

- **Each PR has one job, so review is fast and focused.** A reviewer of PR 1 asks exactly one question — "did behavior change?" — and the answer should be visibly *no* (mechanical refactors, tests untouched and green). A reviewer of PR 3 ignores plumbing and focuses on the actual behavioral delta.
- **Risk is front-loaded and isolated.** PRs 1, 2, and 4 are near-zero-risk. All the behavioral risk concentrates in PR 3, which is small because the plumbing already landed.
- **Rollback is surgical.** If the feature misbehaves in production, you revert PR 3 alone. The dependency-breaking and tests (PRs 1–2) stay — they're permanent improvements you don't want to lose.
- **The team learns from the shape.** A consistent PR sequence is itself documentation of the algorithm.

When the dependency-breaking PR is large (an architectural seam touching many files), slice *it* further — one collaborator extracted per PR — and land each behind the existing behavior so nothing ships until the feature PR flips it on. This is where [large-scale-automated-migrations](../../refactoring/) techniques and feature flags earn their keep.

> **Key idea:** Map the five steps onto a PR sequence: refactor-only → tests-only → feature → tidy. Behavioral risk lives in exactly one small PR; everything else is provably safe.

## Reviewing legacy-change PRs: what to look for

Reviewing legacy changes is a distinct skill from reviewing greenfield code. The reviewer's job is to verify the *algorithm was followed*, not just that the code looks reasonable.

**On a `refactor-only` (dependency-breaking) PR:**

- Does any production behavior change? It must not. Mechanical moves (Extract Interface, Parameterize Constructor) should be recognizable as such.
- Were existing tests touched? If yes, that's a red flag — a behavior-preserving move shouldn't require editing assertions.
- Is the new seam minimal, or did the author redesign the class "while they were in there"? Scope creep here reintroduces risk.

**On a `tests-only` (characterization) PR:**

- Do the assertions pin *actual* current behavior, or the author's *assumption* of correct behavior? A characterization test asserting a suspiciously round number ("of course it returns 100") often encodes a guess, not reality. Ask: "did you run it and read the value, or did you write what you expected?"
- Do the tests cover the branches the upcoming change will touch, plus neighbors? Coverage aimed at the wrong region gives false confidence.
- Are nondeterministic sources (clock, RNG, ordering) controlled, so the tests aren't flaky?

**On the `feature` PR:**

- Is the behavioral delta *small and localized*? If the diff is large, the plumbing leaked in — push back and ask for it as a separate PR.
- Do the *old* characterization tests still pass, and is there a *new* test for the new behavior? Both must be present.
- Does the new behavior match the requirement — and was the requirement itself confirmed? On high-stakes paths, "correct implementation of the wrong spec" is the expensive bug.

| Red flag in review | What it usually means | Ask for |
| --- | --- | --- |
| Big mixed diff (plumbing + feature) | Steps collapsed; risk hidden | Split into refactor-only + feature PRs |
| Characterization test with round/expected values | Author asserted assumptions, not reality | "Did the test print this, or did you guess?" |
| Existing tests edited in a "refactor-only" PR | The refactor changed behavior | Justify each edited assertion |
| No new test in the feature PR | Behavior changed without coverage | A test for the new branch |
| Sprout with no test on the sprouted unit | Defeats the purpose of sprouting | Test-first the new unit |

## Decision frameworks you can hand to a team

Teams need *shared* heuristics so different engineers make consistent calls. Two frameworks travel well.

**Framework A — "How much net?"** Posted near the team's definition of done:

```
Is the change BEHAVIORAL?  No  → ship with review, no characterization needed.
                           Yes ↓
Is the affected path HIGH-STAKES (money / data integrity / security / silent failure)?
   Yes → full algorithm + extra characterization of neighbors + domain reviewer.
   No  ↓
Can the new behavior be SPROUTED beside the old code?
   Yes → sprout into a tested unit; one call-site; minimal legacy edit.
   No  → break the minimal dependencies; characterize the touched branches; change.
```

**Framework B — "Sprout, Wrap, or Break?"** The middle file gives the techniques; the team needs the *selection rule*:

| Situation | Choose | Because |
| --- | --- | --- |
| Adding behavior that sits beside the old logic | **Sprout** | New code is fully tested; legacy gains one call |
| Adding behavior before/after the whole method, untouched | **Wrap** | Old logic never edited |
| The change is *inside* an existing computation | **Break + characterize** | No way around the legacy code |
| Dependency-break is architectural / exceeds budget | **Sprout to defer** + file debt | Don't blow the budget on plumbing |

Handing a team these two diagrams does more for consistency than any amount of "use good judgment," because it makes the judgment explicit and reviewable.

**Framework C — "Is this change behavioral or structural?"** This is the smallest and most-used framework, because it governs the [tidy-first](../06-tidy-first-when-and-how/) rule. Before any commit, the author answers one question: does this change *alter what the program does* (behavioral) or *only how the code is arranged* (structural)? The two never share a commit. A structural change (rename, extract, inject a collaborator) must keep every test green by definition — if a test goes red, the "structural" change wasn't structural. A behavioral change adds or modifies a test deliberately. Making this binary explicit on every commit is what lets a reviewer trust a `refactor-only` label without re-deriving it, and it's the discipline that keeps the PR-slicing in the next section honest.

```
Does the commit change PROGRAM BEHAVIOR?
   No  → structural: all tests stay green, label refactor-only/tidy
   Yes → behavioral: a test changes on purpose, label feature
   "Both" is not an answer — split the commit.
```

## Coordinating across people and time

Legacy work has coordination hazards that solo work doesn't.

**Long-lived dependency-breaking branches rot.** If "break the dependency" is a two-week effort on a hot file, your branch will conflict daily with everyone else's changes. Mitigations: land the seam incrementally behind existing behavior (so `main` is always shippable, per [keeping-the-system-shippable](../../refactoring/)), and communicate that the file is being seamed so others can rebase early.

**Characterization tests can collide with parallel work.** Two engineers characterizing the same subsystem will write overlapping tests and conflict. Coordinate by *area*: claim a subsystem, land its net, then others build on it. The net is shared infrastructure — the first person to add it pays, everyone after benefits.

**The "expert bottleneck" is an organizational smell.** If only one person can safely change the legacy payments code, the algorithm exists to dissolve exactly that. Make them *pair* the next two payments changes rather than do them — the net they build and the process they model spread the capability. Within a few changes, the subsystem has tests and the team has the skill.

**Estimation must include net-building.** When the team estimates a legacy ticket as if it were greenfield, they under-quote by the cost of steps 2–4 and then either blow the estimate or skip the net under pressure. Bake it in: a legacy change estimate has a line item for "establish testability." Over a quarter, that line item *shrinks* as the subsystem accumulates seams and tests — which is the visible ROI of the whole discipline ([07-the-economics-of-tidying](../07-the-economics-of-tidying/)).

## Checklists

**Before starting a legacy change:**

- [ ] Requirement confirmed with the requestor (especially on high-stakes paths).
- [ ] Change point identified and written down — the *minimal* surface.
- [ ] Ripple/caller points considered.
- [ ] Test point chosen; sensing path confirmed (return value? side effect? cross-process?).
- [ ] Sprout vs. Break decision made (Framework B).
- [ ] Estimate includes net-building time.

**Per PR in the sequence:**

- [ ] PR has exactly one job (refactor-only / tests-only / feature / tidy) and is labeled.
- [ ] `refactor-only` PRs: no production behavior change; existing tests untouched and green.
- [ ] `tests-only` PRs: assertions pin *actual* behavior; branches near the change covered; no flakiness.
- [ ] `feature` PR: behavioral delta small; old tests green; new test added; requirement matched.
- [ ] Deferred debt (Sprout call-outs, skipped nets, architectural breaks) filed as tickets.

**Before merging the feature PR:**

- [ ] Full suite green, including the new characterization tests.
- [ ] Rollback plan is "revert this PR" and that's clean (feature isolated from plumbing).
- [ ] `main` was shippable at every intermediate PR.

## War stories

**The silent rounding regression.** A team added a loyalty discount to an order total in one mixed PR — dependency-breaking, the feature, and a "quick cleanup" all together. Tests were added *after* the change and asserted the new expected totals, so they were green and meaningless. Three weeks later finance flagged that high-value orders were off by a few cents — the cleanup had changed a rounding mode, and because the tests were written post-change, nothing caught it. Cost: a finance reconciliation, a customer-facing correction, and a postmortem. Fix that stuck: characterization-before-change became a hard review rule, and structural changes were banned from feature PRs. The regression was *structurally* preventable — not a smarter-engineer problem, a process problem.

**The expert bottleneck.** Every change to a 6,000-line billing engine routed to one engineer because "only she understands it." When she went on leave, three billing tickets stalled for a month. The lead's response wasn't documentation — it was to require the next four billing changes be *paired*, with the net committed first. After four changes the engine had a characterization harness over a corpus of real invoices, and any of six engineers could touch it. The bottleneck wasn't knowledge; it was the *absence of a net*, which made the knowledge feel irreplaceable.

**The "no time for tests" deadline.** Hours before a launch, a critical path needed a one-line change and the loudest voice said "just ship it." The senior on the call reframed it as the senior file prescribes: "30 minutes untested on the payment path, possibly silent wrong charges, or two hours with a net — which risk do you own?" The room chose the two hours. Post-launch, the net caught an unrelated regression the *next* week. The lesson the team kept: the sentence that converts a deadline argument into an owned decision is worth rehearsing.

## Pitfalls that bite teams, not individuals

| Pitfall | Why it's a *team* problem | Counter |
| --- | --- | --- |
| "Add tests" as a follow-up ticket | The next deadline always eats it | Net is in the definition of done |
| Mixed structural + behavioral PRs | Reviewers can't isolate the risky line | Enforce separate, labeled PRs |
| Characterization tests asserting assumptions | Encodes a team-wide false-confidence | Review for "did you run it?" |
| Expert bottleneck on the scary subsystem | Single point of organizational failure | Pair the next changes; build the shared net |
| Estimating legacy as greenfield | Under-quote → skip the net under pressure | Net-building is a line item |
| Sprout sprawl | 20 untested call-outs nobody dares test | Track sprout debt; schedule paydown |
| Long-lived seam branches | Daily conflicts, `main` not shippable | Land seams incrementally behind existing behavior |

> **Key idea:** Most legacy-change disasters are *process* failures (mixed PRs, post-hoc tests, deferred nets, bottlenecks), not skill failures. Lead by fixing the process so the safe path is the default path.

## Related Topics

- [01-what-is-legacy-code](../01-what-is-legacy-code/) — the shared definition the team works from.
- [03-seams-and-enabling-points](../03-seams-and-enabling-points/) — the model behind the dependency-breaking PRs.
- [04-characterization-tests](../04-characterization-tests/) — the mechanics your `tests-only` PRs depend on.
- [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/) — the catalog reviewers check `refactor-only` PRs against.
- [06-tidy-first-when-and-how](../06-tidy-first-when-and-how/) — the rule that structural and behavioral changes never share a diff.
- [07-the-economics-of-tidying](../07-the-economics-of-tidying/) — the ROI argument for estimation and for paying down sprout debt.
- [../../refactoring/](../../refactoring/) — keeping `main` shippable, large-scale migrations, automated mechanical moves.
- [../../design-principles/](../../design-principles/) — designing for testability so future legacy changes are cheaper.
