> **What?** Debugging is the systematic reduction of a problem's *search space* — the set of all places the cause could be — using falsifiable hypotheses and binary search until exactly one cause remains.
> **How?** You make the bug fail on demand, divide the search space in half with each test (git bisect, bisect the input, bisect the call stack), change one variable at a time, keep an audit trail, and stop only when you can turn the bug on and off — proof you understand the mechanism.

---

## 1. The systematic loop, stated precisely

A bug is a contradiction between your model of the system and its behavior. Debugging closes that gap. At this level you run the loop deliberately, not by instinct, and you measure each step by how much it shrinks the **search space**.

| Step | The question it answers | The output |
|---|---|---|
| **Reproduce** | When exactly does it fail? | A deterministic recipe |
| **Observe** | What is actually true right now? | Facts (logs, state, traces) — not theories |
| **Hypothesize** | What single belief, if wrong, would explain this? | A falsifiable statement |
| **Predict** | If true, what *must* I see when I test? | A specific expected observation |
| **Test** | (the cheapest experiment that discriminates) | A yes/no that halves the space |
| **Update** | Confirmed or refuted? | A smaller search space, then loop |

The discipline is in **Observe** and **Test**. Agans calls it *"Quit Thinking and Look."* When you find yourself arguing about what *might* be happening, stop — go look. The system holds the answer; theorizing only narrows where to look.

This is the scientific method specialized to code: see [hypothesis and falsifiability](../../09-scientific-and-hypothesis-driven/01-hypothesis-and-falsifiability/) for *why* a hypothesis you can't refute is worthless, and [measure before optimize](../../09-scientific-and-hypothesis-driven/03-measure-before-optimize/) for the same "instrument, don't speculate" reflex applied to performance.

---

## 2. Agans' 9 rules — your operating checklist

David J. Agans, *Debugging: The 9 Indispensable Rules*, distills it to nine rules. Memorize them; reach for them when stuck.

1. **Understand the system.** Read the docs, the code, the protocol. You can't debug a black box you don't understand.
2. **Make it fail.** Get a reliable reproduction. Make it fail on demand before doing anything else.
3. **Quit thinking and look.** Instrument and observe the actual behavior; don't guess your way to a fix.
4. **Divide and conquer.** Binary-search the problem space — halve it with each test.
5. **Change one thing at a time.** And revert what doesn't help, so you keep a clean cause-and-effect line.
6. **Keep an audit trail.** Write down what you did, in what order, and what you saw.
7. **Check the plug.** Question your assumptions — is it even running? Right version? Right config? Right machine?
8. **Get a fresh view.** Ask someone else; describe it out loud. A new perspective sees the obvious thing you've gone blind to.
9. **If you didn't fix it, it ain't fixed.** Bugs that "disappear" without a known cause are still there. Confirm by turning it off and on.

---

## 3. Binary search the problem space — O(log n) beats guessing

Linear guessing inspects suspects one at a time: O(n). **Binary search** halves the candidates with each test: O(log n). For a 1,000-commit regression, that's ~10 tests instead of up to 1,000. This is *the* highest-leverage debugging skill, and it's [decomposition](../../01-computational-thinking/01-decomposition/) applied to a fault.

The trick is always: find a test that splits the remaining suspects roughly in half, regardless of *which* axis the bug lives on.

### Bisect over time — `git bisect`

"It worked last month, it's broken now" + a deterministic test → let git find the commit:

```bash
git bisect start
git bisect bad                  # current commit is broken
git bisect good v2.3.0          # this old tag was fine
# git checks out the midpoint; you test and answer:
git bisect bad   # or: git bisect good
# ... ~log2(N) iterations later:
# a1b2c3d is the first bad commit
git bisect reset
```

Automate it fully with a script that exits 0 (good) / non-0 (bad):

```bash
git bisect run ./repro_test.sh
```

git walks the ~log₂(N) midpoints for you and names the exact commit. Now you have the *diff* that introduced the bug — the search space collapses from "the whole codebase" to "these few changed lines."

### Bisect over input

A 10,000-line file crashes the parser. Don't read all 10,000 lines. Delete the second half, re-run:

- Still crashes? The cause is in the first half. Halve again.
- No longer crashes? The cause is in the second half. Restore it, halve *that*.

A dozen rounds isolates the offending line. The same works for narrowing a failing payload, a problematic config block, or which of 50 feature flags flips the bug.

### Bisect over the stack / the code

Comment out half the pipeline (or set a breakpoint at the midpoint of a call chain) and check whether the corrupted value is already wrong there. If it is, the bug is *upstream*; if not, it's *downstream*. You've halved the call stack.

> The mental model that unifies all three: a bug has a "boundary" between a known-good state and a known-bad state. Each test moves that boundary inward. Binary search is just the optimal strategy for finding a boundary.

---

## 4. Instrument, don't speculate

Rule 3 in practice. Each tool answers a different question:

| Tool | Best for | Cost |
|---|---|---|
| **Log statements** | Cheap, fast checks of "what is this value here?" across runs | Low; pollutes output |
| **Debugger / breakpoints** | Inspecting full state, stepping, conditional breaks | Medium; bad for timing/concurrency bugs |
| **Tracing / spans** | Following one request across functions or services | Higher setup; essential at scale |
| **`assert`** | Catching the violation *at the moment* an invariant breaks, not three frames later | Low; documents assumptions |

Two power moves:

- **Conditional breakpoints.** Don't step through 9,999 good iterations to reach the bad one. Break only when `userId == 42` or `i > 5000`.
- **Assertions as tripwires.** `assert items.all(price >= 0)` fails *exactly* where the bad data appears, collapsing the search space to one frame instead of leaving you to trace a `NaN` backwards.

The principle: **let the program tell you, don't predict what it will say.** Speculation is how you "fix" things that were never broken.

---

## 5. Reproduction when it's hard: flaky bugs

The bugs that hurt are the ones that *don't* reproduce reliably. The cure is to find the hidden variable that flips the outcome and pin it.

| Class | Hidden variable | How to pin it |
|---|---|---|
| **Race condition** | Thread/goroutine interleaving timing | Add delays/`yield` to widen the window; run under a race detector; stress-loop the test |
| **Heisenbug** | Your *observation* changes timing (the log/debugger hides it) | Switch to low-overhead logging or post-hoc tracing; reason from the disappearance — it points at a timing/optimization issue |
| **Environment-dependent** | OS, locale, timezone, clock, env var, dependency version | Diff the two environments; "check the plug" — versions and config |
| **Data-dependent** | One specific record (null, unicode, huge, negative) | Bisect the dataset to the row, then minimize it |
| **Order-dependent** | Test pollution / shared state from a prior step | Run the failing test alone; randomize test order to expose hidden coupling |

Two tactics that turn "sometimes" into "always":

- **Loop it.** Run the failing case 1,000× in a tight loop. A 1-in-200 race becomes near-certain per run and instantly reproducible.
- **Widen the window.** For a suspected race, insert a `sleep` at the suspect point. If the failure rate jumps, you've confirmed the race *and* localized it.

---

## 6. Keep an audit trail

When debugging runs past 20 minutes, your memory becomes the bug. Keep a scratch log:

```
14:02 repro: POST /orders w/ empty cart -> 500. reliable.
14:09 hyp: cart.items is nil, not []. test: log len(items) before total.
14:11 -> items == nil. confirmed. moved up: who builds the cart?
14:20 NewCart() returns zero-value struct; items never initialised. <-- ROOT
14:25 fix: init items=[]; turned bug off. reverted fix -> bug back. confirmed.
```

This trail does three things: it stops you re-running tests you already ran, it records *which* hypotheses you've already falsified (so you don't loop), and it becomes the post-mortem and the PR description for free.

---

## 7. Knowing it's fixed

A fix is verified only when you can **turn the bug on and off** — apply the change, bug gone; revert it, bug returns; reapply, gone. That round-trip proves *your change* is what addressed *this bug*, and that you understand the mechanism rather than having perturbed something coincidentally.

Then ask one more question (Agans Rule 9 plus a [looking-back](../04-looking-back-and-reflecting/) reflex): **did I fix the cause or the symptom?** A `try/catch` that hides the crash, a `?? defaultValue` that papers over the `nil`, a retry that masks the race — these stop the symptom and leave the disease. Fix where the *wrong value originates*, not where it finally explodes.

---

## 8. A worked bisect

**Symptom:** Checkout p99 latency jumped from 80 ms to 1.2 s sometime in the last release; no errors.

1. **Make it fail:** a load test against staging reproduces the 1.2 s p99 consistently. Good — deterministic enough to bisect.
2. **Bisect time:** `git bisect start; git bisect bad HEAD; git bisect good v4.1.0`. Wrote `repro_test.sh` that fails if p99 > 300 ms, ran `git bisect run`. Twelve checkouts later: first bad commit `9f3ac21` — "add audit logging to order service."
3. **Observe the diff:** the commit added a synchronous `auditLog.write()` inside the checkout transaction.
4. **Hypothesize (falsifiable):** "p99 rose because the audit write is synchronous and inside the hot path." **Predict:** removing it from the hot path drops p99 back under 300 ms.
5. **One-thing test:** move the audit write to an async queue. p99 → 75 ms.
6. **Verify:** revert → 1.2 s again; reapply → 75 ms. Bug toggles. Mechanism understood; fix confirmed.

← Back to [Problem-Solving](../) · [Engineering Thinking root](../../README.md) · Next: [Techniques when you are stuck](../06-techniques-when-you-are-stuck/)

---

## Key takeaways

- Run the loop explicitly: reproduce → observe → falsifiable hypothesis → cheapest discriminating test → update.
- Keep Agans' 9 rules as a checklist; "make it fail," "change one thing," and "if you didn't fix it, it ain't fixed" are the ones you'll break.
- **Binary-search the problem space** — over time (`git bisect`), input, and the call stack. O(log n) crushes O(n) guessing.
- Instrument, don't speculate: logs, conditional breakpoints, assertions as tripwires.
- For flaky bugs, find and pin the hidden variable (timing, data, order, environment); loop it or widen the window to make "sometimes" into "always."
- You've fixed it only when you can turn the bug on and off — and only if you fixed the cause, not the symptom.
