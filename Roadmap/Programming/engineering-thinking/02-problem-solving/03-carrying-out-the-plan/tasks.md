> Practice exercises for **carrying out the plan** (Pólya's third stage). These build the execution muscle: decompose into checkable steps, verify each as you go, keep a working state, leave a trail, and decide *adapt / persist / kill* deliberately rather than emotionally.
>
> **Global constraints for every task:** (1) Make every step independently verifiable — state *what observable proves it worked* before you take it. (2) Keep a working/shippable state throughout; never leave everything broken at once. (3) Leave a trail (commits, notes, a decision log) you could backtrack from. (4) When a step contradicts an assumption, *stop and decide* — don't force, don't panic-abandon. Where a deliverable is named, produce the actual artifact.

---

## Task 1 — Decompose into checkable steps

Take a real task you're about to start. *Before writing any code*, break it into the smallest steps you can, and for **each** step write the verification: the exact command you'll run and the output that means "correct."

**Deliverable:** a numbered list of steps, each with a `verify:` line (e.g. `verify: curl /users/7/orders → 200, dates descending`). Then execute it, checking each step. Note any step where you *couldn't* state the verification in advance — that's a step you didn't fully understand.

## Task 2 — Barrel-ahead vs. check-as-you-go (timed)

Implement the same small feature twice in two sessions. Session A: write the whole thing, run only at the end. Session B: change one piece, run, confirm, repeat.

**Deliverable:** for each session record total time *and* time-to-locate the first bug. Write 3 sentences on the difference. The point is to *feel* how much cheaper located failures are.

## Task 3 — Build a walking skeleton

Pick a feature that touches at least three layers (e.g. API → service → DB, plus an event). Build a **walking skeleton** first: a thin end-to-end thread that runs and is deployable but does almost nothing (hardcoded response, one row, one event). Only then add real logic, one verified increment at a time.

**Deliverable:** the skeleton committed and running end-to-end *before* any business logic exists. Note when integration risk surfaced compared to your usual bottom-up order.

## Task 4 — Sequence by risk

For a multi-step plan, list its load-bearing assumptions and rank them by `impact-if-false × uncertainty`. Design the **cheapest possible probe** to test the top one (a spike, a one-day dark launch, a back-of-envelope load test) and run it *first*.

**Deliverable:** the ranked assumption list, the probe, and its result. If the probe falsified the assumption, write what you would have wasted had you discovered it after building on top of it.

## Task 5 — Keep main green with expand/contract

Take a change that *cannot* be made safely in one step — rename a column other code reads, or swap an algorithm live traffic uses. Execute it as **expand → migrate → contract**: add the new path alongside the old, migrate readers/writers incrementally with verification at each, remove the old path last.

**Deliverable:** the commit history showing each phase is independently deployable and revertable, with the system never broken in between.

## Task 6 — Define the pass/fail predicate before each step

For your next risky change, write — *before* taking the step — the **pass predicate** and **fail predicate** as observable conditions, plus the **action on fail** (e.g. `fail: p99 regresses > 5% → flag to 0%, investigate`). Put the step behind a flag and ramp it, honoring the predicate you committed to.

**Deliverable:** the written predicates and the actual decision they drove. Reflect: did the pre-committed fail predicate stop you from rationalizing a borderline-bad result?

## Task 7 — The adapt / persist / kill drill

Recall a time a step failed mid-execution. Reconstruct the moment and write out all three options explicitly: what *adapt* would have looked like (reroute, keep verified work), what *persist* would have required (evidence the plan was still best), what *kill* would have meant. Then apply the from-scratch test — *knowing what you knew then, would you choose that plan?*

**Deliverable:** the three options written out and the honest call, with the assumption that broke named. Compare to what you actually did at the time.

## Task 8 — Catch yourself in sunk cost

Find a current piece of work you're continuing partly because of effort already spent. Write one sentence stating the *forward* case for it — why it's the best path *from here*, ignoring everything already invested. If you can't write that sentence in evidence, you've found a sunk-cost trap.

**Deliverable:** the sentence (or the admission that you can't write it) and your decision. See [Cognitive Biases in Code Decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/) and link the bias by name.

## Task 9 — Leave a backtrackable trail

Execute a multi-step change while keeping a **decision log**: one line per non-obvious choice or pivot — *believed X, reality showed Y, decided Z, because.* Use commit messages that explain *why*, not just *what*.

**Deliverable:** the decision log and commit history. Then test it: ask a teammate (or future-you after a day) to read only the trail and reconstruct what you tried. If they can't, the trail was too thin.

## Task 10 — Incident execution under pressure (simulation)

Run a game-day or replay a real incident against the execution disciplines: **mitigate before diagnose**, **one change at a time, verified**, **narrate continuously**, **always a revert**. Have someone observe and count how many times you violated "one change at a time."

**Deliverable:** the narration timeline (the channel log) and the violation count. Write the single habit you'll change before the next incident. Cross-reference the senior/professional incident-command flow.

## Task 11 — Don't abandon at the first obstacle

Deliberately pick a moderately hard task and commit, in advance, to *not* abandoning your initial plan at the first failed step — instead, on each failure, write what the failure *taught* you and adapt. Track how many obstacles you'd normally have quit at but actually rerouted through.

**Deliverable:** a log of each obstacle, the lesson, and the adaptation. Reflect on whether your usual instinct over-abandons. (When truly stuck, escalate to [Techniques When You're Stuck](../06-techniques-when-you-are-stuck/) — persistence is not the same as flailing.)

## Task 12 — Tie it to TDD red-green

For one feature, execute strictly red → green → refactor (Beck): write a failing test, write the least code to pass it, refactor while green, repeat. Each loop is one verified step that ends in a known-good state.

**Deliverable:** the commit history showing tight loops (test, then pass, then tidy). Reflect on how red-green-refactor *is* Pólya's "check each step" mechanized — you never advance from an unverified state. Then move to [Looking Back and Reflecting](../04-looking-back-and-reflecting/) on the finished feature.

> Back to the [Problem-Solving section](../) or the [Engineering Thinking roadmap](../../README.md). Siblings: [Understanding the Problem](../01-understanding-the-problem/), [Devising a Plan](../02-devising-a-plan/), [Debugging as Problem-Solving](../05-debugging-as-problem-solving/).
