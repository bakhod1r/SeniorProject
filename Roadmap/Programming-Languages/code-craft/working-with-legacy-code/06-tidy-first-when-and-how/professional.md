# Tidy First — When and How — Professional Level

> **Source:** Kent Beck, *Tidy First?* (O'Reilly, 2023), applied to team practice. This level is about making tidying *survive contact with a team* — PR hygiene, fast reviews, sequencing under deadlines, and the social negotiation around all of it.

---

## Table of Contents

1. [Tidying on a team is a social problem](#tidying-on-a-team-is-a-social-problem)
2. [PR hygiene: structure-only pull requests](#pr-hygiene-structure-only-pull-requests)
3. [Getting structure PRs reviewed fast](#getting-structure-prs-reviewed-fast)
4. [Sequencing: First / After / Later / Never on a team](#sequencing-first--after--later--never-on-a-team)
5. [Tidying under a deadline](#tidying-under-a-deadline)
6. [Dealing with reviewers](#dealing-with-reviewers)
7. [War stories](#war-stories)
8. [Checklists](#checklists)
9. [Pitfalls](#pitfalls)
10. [Related Topics](#related-topics)

---

## Tidying on a team is a social problem

Alone, tidying is a personal habit. On a team, it becomes a *negotiation* with reviewers, a *contention* over the same files, and a *budget* line that competes with features. The professional skill isn't knowing the catalog — you knew that two levels ago. It's making the practice frictionless enough that the team actually does it, and disciplined enough that it never becomes a vector for incidents or a source of merge pain.

Three forces govern tidying-in-the-team:

- **Trust.** Reviewers approve structure PRs fast *only* if they trust that "tidy" really means behavior-preserving. The first time a "tidy" PR ships a bug, that trust — and your fast reviews — evaporate.
- **Throughput.** Tidying must speed the team up overall. If your tidy PRs create merge conflicts for everyone else, you've optimized your code and pessimized the team.
- **Restraint.** Every tidy PR consumes a reviewer's attention. A team that tidies everything starves its feature reviews. Tidying competes for the scarcest resource: review bandwidth.

> **Key idea:** The professional goal is to make structure changes *cheap to trust* — so cheap that reviewers wave them through, conflicts stay rare, and the practice nets out as a speedup. Everything below serves that goal.

---

## PR hygiene: structure-only pull requests

The cornerstone is the **structure-only PR**: a pull request that changes structure and *nothing else*. Done right, it is the cheapest reviewable unit in software.

What makes a structure-only PR trustworthy:

| Signal | Why reviewers trust it |
|---|---|
| **No test files changed** | If behavior were changing, a test would have to change. Unchanged tests are evidence of preservation. |
| **Tests are green** in CI | The existing suite still passes — the safety net held. |
| **Title prefixed `tidy:` / `refactor:`** | Sets the reviewer's frame: check *preservation*, not *correctness of new behavior*. |
| **Each commit is one named tidying** | The reviewer can verify each move against a known refactoring. |
| **Small diff, ideally IDE-generated** | Mechanical refactorings have near-zero defect surface. |
| **No `package.json` / dependency / config changes** | Those are behavior. A pure tidy PR doesn't touch them. |

A good structure-only PR description is almost boilerplate, and that's the point:

```
Title: tidy: guard clauses + explaining constants in PricingService

This PR is STRUCTURE ONLY — no behavior change.
- Flatten nested ifs in shipping() with guard clauses
- Name the free-shipping threshold (was magic 50)
- No test changes; existing suite green in CI

Clears the runway for the "$200 free shipping" feature (#4412) landing next.
```

A reviewer reads that and knows exactly what *not* to worry about. That's how a 30-line diff gets a 60-second approval.

> **Key idea:** "No test files changed" is the single strongest trust signal a structure PR can carry. Protect it fiercely — the day a `tidy:` PR edits a test assertion, you've either mislabeled a behavior change or introduced a bug. Either way, the label is now a lie.

A practical refinement many teams adopt: **commit structure changes to `main` directly or via trivially-approved PRs, and reserve heavyweight review for behavior.** Beck's own workflow leans on a fast lane for structure precisely because structure changes are low-risk and high-frequency.

---

## Getting structure PRs reviewed fast

A structure PR that sits in review for two days has lost its entire value — and worse, it's now a ticking conflict bomb against everyone else's work. Speed is not a nicety; it's load-bearing. Tactics that work:

- **Keep them tiny.** A 20-line structure PR gets reviewed between meetings. A 300-line one gets "I'll look later," and later is never. Smallness *buys* speed.
- **Ship them ahead of the feature, not bundled.** Open the structure PR, get it merged, *then* branch the feature off the tidied base. Don't stack a 4-deep PR chain that one slow reviewer can stall.
- **Make the no-behavior claim self-evident.** State "no test changes; green CI" in the description. Let the reviewer verify the claim in one glance at the file list.
- **Pre-announce in chat.** "Putting up a structure-only PR to flatten `PricingService` before the shipping feature — should be a 2-min review." Reviewers prioritize what they understand the shape of.
- **Automate the easy verdicts.** A CI check that *fails the build if a PR labeled `tidy` touches a test file* makes the trust signal mechanical. Reviewers don't have to police it.
- **Lower the conflict window.** Merge structure PRs *fast* and rebase dependent work immediately. The longer a structure change lives unmerged, the bigger the diff it conflicts with.

The throughput argument to make to skeptical leads: two PRs reviewed in 2 minutes each beat one mixed PR reviewed in 40 minutes and merged a week late. Separation isn't extra process; it's how review gets fast.

A concrete workflow that keeps structure PRs from stalling the feature behind them:

```
  1. branch  tidy/flatten-pricing  off main
  2. open structure-only PR, announce in chat ("2-min review, no behavior")
  3. merge it (same day) → main now has the tidied base
  4. branch feat/free-shipping off the *updated* main
  5. open the feature PR — small, because the runway is clear
```

The anti-pattern to avoid is stacking the feature *on top of* the unmerged structure PR (a PR chain), where one slow reviewer on the structure PR blocks the feature too. Merge structure first, then build on it. The dependency points the right way: features depend on tidy bases, not the reverse.

---

## Sequencing: First / After / Later / Never on a team

The four WHEN options (introduced at the senior level) acquire team-specific tradeoffs. Sequencing is a *scheduling* decision shaped by review bandwidth, conflict risk, and deadline pressure.

| Option | Team tradeoff | When to pick it |
|---|---|---|
| **Tidy First** | Adds a PR to the chain; clears the feature's runway; needs a fast review to not stall | The tidying directly enables the change *and* you can get the structure PR merged quickly |
| **Tidy After** | Risk it becomes "Never" once green; keeps the feature PR focused | You only understood the shape after building the feature; commit to a follow-up PR *immediately* |
| **Tidy Later** | Needs a real backlog mechanism or it's forgotten; avoids bloating today's PR | The tidying is off today's path but you'll revisit the code soon |
| **Never** | Frees review bandwidth for what matters; requires honesty | The code is stable, off your path, or slated for deletion |

The **Tidy First vs. After** call on a team usually comes down to *understanding and review cost*:

- **First** when the mess actively blocks you and the structure PR is small enough to merge same-day. You pay an extra review now to make the feature trivial.
- **After** when you'll only know the right shape once the feature exists, *and* you can get a fast follow-up review. The danger is real: "tidy after" deferred past the deadline is "never" in disguise.

The **Later vs. Never** call is about *return on attention*. Will the team genuinely revisit this code? If yes and the tidying compounds, schedule it (Later). If it's stable code nobody reads, choosing **Never** is the senior, throughput-preserving answer — not laziness.

> **Key idea:** On a team, "Tidy Later" only exists if it has a *home* — a ticket, a label, a backlog rule. A "later" with no mechanism is a "never" you're not being honest about. Pick mechanisms, not intentions.

---

## Tidying under a deadline

Deadlines are where the discipline is tested, and where most teams get it backwards. The instinct under pressure is "no time to tidy — just ship the feature." Often that's *correct* (Never / Later). But sometimes the mess is exactly what's making the feature slow and bug-prone, and skipping the tidy *costs* you the deadline.

A decision frame for crunch time:

- **Is the mess on the critical path of *this* change?** If the tangle is what's making the feature hard, a small Tidy First may be the *fastest* route, not a detour. Flattening before you add the case is often quicker than threading a new branch through a nest.
- **Is the tidying small and reversible?** Under deadline, only do tidyings you're certain are safe and quick — IDE-mechanical ones. This is not the time for One Pile or a speculative New Interface.
- **Can you defer honestly?** If the tidying isn't blocking you, choose **Later** with a ticket, or **Never**. Don't gold-plate while the clock runs.
- **Never sacrifice the *separation* to save time.** The one thing you must not do under deadline is *merge* structure and behavior "to save a PR." That's how deadline bugs become un-revertable. The separation is what protects you precisely when you're rushed and error-prone.

> **Key idea:** Deadlines change *how much* you tidy, never *how* you tidy. You may tidy less, but the structure/behavior separation is non-negotiable — it's the seatbelt, and you don't take the seatbelt off because you're driving fast.

---

## Dealing with reviewers

Reviewers are the gate, and tidying lives or dies on how you work with them.

**The skeptical reviewer ("why are you changing all this?").** They see a 40-line diff and assume risk. Disarm it up front: label the PR `tidy:`, state "structure only, no test changes, green CI," and split anything that *looks* like behavior into its own PR. Once they've approved a few clean structure PRs and nothing broke, they'll start fast-tracking them.

**The reviewer who wants you to "just bundle it with the feature."** They're optimizing for fewer PRs to review. Counter with the throughput and revertability argument: a separate structure PR is a 60-second review, and keeping them apart means a production revert won't take the feature down with the cleanup. Frame separation as *less* total review effort, not more.

**The reviewer who scope-creeps your structure PR ("while you're in here, also rename X, fix Y").** Politely decline in-scope: "Good call — opening a separate tidy PR for that so this one stays a clean, single move." Scope creep is how a 2-minute review becomes a 30-minute one. Protect the smallness.

**You, as the reviewer of someone else's tidy PR.** Verify the trust signals fast (tests unchanged, CI green, each commit a named move) and *approve quickly* — slow-walking structure PRs trains the team to stop separating. Reserve your scrutiny for behavior. If a `tidy:` PR *does* touch a test, that's the one thing to stop and question.

> **Key idea:** Fast, trusting reviews of clean structure PRs are a team asset you build deliberately. Every clean tidy PR you ship, and every clean one you approve quickly, raises the team's trust and lowers everyone's review tax. The practice is self-reinforcing — or self-destructing if the trust signal is ever abused.

---

## War stories

**The "while I'm here" outage.** A developer fixed a one-line null check and, in the same commit, "tidied" a nearby loop into a stream. The stream subtly changed iteration order; a downstream consumer depended on order. Production broke. The revert *also* reverted the null fix, re-opening the original bug. Root cause: structure and behavior in one commit. The fix would have been invisible in two separate commits — the stream change would have failed an order-dependent test *before* the null fix ever shipped.

**The un-bisectable blob.** A team merged a 900-line PR titled "refactor + new export feature." Two weeks later a corruption bug surfaced. `git bisect` landed squarely on the blob — 900 lines mixing renames, moves, and new logic. It took three engineers a day to find the one bad line. A tidy-first sequence would have put the bug in a small, clearly-labeled behavior commit.

**The tidy that paid in an hour.** Before adding a third payment provider, an engineer spent 20 minutes on a structure-only PR: Explicit Parameters to surface a hidden config global, plus a New Interface over the two existing providers. Reviewed in 3 minutes. The actual "add Stripe" PR that followed was 30 lines and obviously correct, because the seam was already there. Tidy First turned a feared two-day integration into an afternoon.

**The compulsive tidier.** An engineer tidied *everything* they touched, including stable code on nobody's path, generating a stream of structure PRs that ate the team's review bandwidth and conflicted with active feature branches. The lead asked them to apply **Never** more often. Throughput *rose*. The lesson: tidying is an investment, and over-investing in low-return code is as wrong as never tidying.

**The trust rebuild.** A team had quietly stopped separating structure from behavior — every PR was a mix, and reviews dragged. A new lead introduced one mechanical rule: CI fails any PR labeled `tidy` that touches a test file. Within a sprint, `tidy:` PRs became something reviewers approved on sight, because the machine guaranteed the trust signal. Feature PRs shrank as the runway-clearing tidy PRs went first. The change wasn't a culture lecture; it was a single guardrail that made the cheap thing also the easy thing.

---

## Checklists

**Before opening a structure PR:**

- [ ] Does this PR change *only* structure? (If any test changed, it doesn't — split it.)
- [ ] Is CI green on the existing, *unchanged* test suite?
- [ ] Is each commit a single named tidying?
- [ ] Is the diff small enough to review in a couple of minutes?
- [ ] Did I prefer IDE-mechanical refactorings where possible?
- [ ] Is it titled `tidy:`/`refactor:` and does the description state "no behavior change"?
- [ ] Can it merge soon, before it conflicts with active branches?

**Deciding First / After / Later / Never:**

- [ ] Does the tidying *enable* the imminent change? → lean **First**
- [ ] Did I only understand the shape after changing it? → **After** (with a committed follow-up)
- [ ] Is it off today's path but I'll be back soon? → **Later** (with a ticket)
- [ ] Is the code stable, off-path, or doomed? → **Never**
- [ ] Do I actually understand the code well enough to tidy safely? (If not, characterize first.)

**Reviewing someone's tidy PR:**

- [ ] Tests unchanged? CI green? → fast-track approve
- [ ] Each commit a recognizable behavior-preserving move?
- [ ] Did a `tidy:` PR sneak in a behavior change? → that's the one thing to stop on.

---

## Pitfalls

| Pitfall | Why it hurts | Remedy |
|---|---|---|
| **Mixing structure and behavior** "to save a PR" | Un-revertable, un-bisectable, slow to review | Always split; the separation is the whole point |
| **Tidy PR that edits a test** | Either mislabeled behavior or a hidden bug | Make CI fail `tidy:` PRs that touch tests |
| **Giant "tidy" PR** | Reviewed slowly, conflicts widely, defeats reviewability | Keep tidyings tiny; one move per commit |
| **"Tidy After" with no follow-up** | Becomes "never"; mess persists | Open the follow-up PR before closing the feature ticket |
| **Compulsive tidying** | Starves review bandwidth, churns stable code | Apply **Never** liberally; tidy where payback is near |
| **Tidying code you don't understand** | "Structure-only" change silently alters behavior | Characterize first ([`../04-characterization-tests/`](../04-characterization-tests/)) |
| **Long-lived structure branch** | Massive merge conflicts for the team | Merge structure PRs fast; rebase dependents immediately |
| **Letting reviewers slow-walk tidy PRs** | Kills the speed advantage; trains people to stop separating | Approve clean structure PRs fast; model the behavior |

---

## Related Topics

- [`../01-what-is-legacy-code/`](../01-what-is-legacy-code/) — the conditions that make tidying necessary in the first place.
- [`../04-characterization-tests/`](../04-characterization-tests/) — the safety net that lets you tidy code you don't fully understand.
- [`../05-dependency-breaking-techniques/`](../05-dependency-breaking-techniques/) — tidyings (Explicit Parameters, New Interface) as seam-creators on a team codebase.
- [`../07-the-economics-of-tidying/`](../07-the-economics-of-tidying/) — the cost/benefit and optionality reasoning behind sequencing decisions.
- [`../../refactoring/`](../../refactoring/) — the broader catalog; tidying is its everyday, small-batch dialect.
- [`../../design-principles/`](../../design-principles/) — coupling/cohesion and YAGNI, the forces that justify (or forbid) a tidying.
