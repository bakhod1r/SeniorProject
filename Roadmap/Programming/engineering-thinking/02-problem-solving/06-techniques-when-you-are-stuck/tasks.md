> These tasks build the *muscle* of getting unstuck — you can't learn it by reading, only by running the moves on real problems. Global constraints: (1) keep a plain-text **attempt log** for any debugging task (timestamp, hypothesis, test, result) — many tasks reference it; (2) when a task says "timebox," set an actual timer; (3) prefer a *real* current problem of yours over a contrived one wherever a task allows it; (4) deliverables are short artifacts (a log, a question, a minimal repro, a one-page writeup), not essays. Do them honestly — the value is in catching your own thrashing, which only works if you don't fake it.

---

## Task 1 — Catalogue your thrashing signature

Over the next week, every time you catch yourself stuck, jot a one-line note: what you were doing, and the physical/behavioral tell (tab count, frustration, re-reading, editing-without-hypothesis, blaming the framework). After 5–7 entries, write your personal **top-3 thrashing signals**.

**Deliverable:** a 3-bullet "my thrashing tells" list you can pin where you work. **Check:** the tells must be *observable in the moment* ("I have 18 tabs open") not vague ("I feel stuck").

---

## Task 2 — Rubber-duck a real bug, on paper

Take a bug you're currently fighting (or the last one that took you over 30 minutes). Explain it *out loud*, line by line, to a duck / mug / empty chair — narrating even the parts you're sure about. Write down the exact sentence where you noticed the gap (if you did).

**Deliverable:** the one sentence that exposed the bug — e.g. "…returns the user, which is set, because— wait, it's async and I never awaited." **Check:** if nothing broke loose, you skipped the parts you were "sure" about; redo it narrating those.

---

## Task 3 — Write the good help question (then notice if it solves itself)

For a current stuck-point, write a help request containing exactly four parts: **goal** (the real X, not your attempted fix), **what you tried** (dead ends), **expected vs. actual** (exact error pasted), and **your current hypothesis**. Time how long it takes.

**Deliverable:** the four-part question. **Check:** note whether you solved it *while writing* — if you did, you wrote it well (that's the point). If you'd still send it, it should be answerable by a stranger with no context.

---

## Task 4 — Build a minimal reproduction by binary search

Take a failing piece of code (yours or a known buggy snippet). Reduce it to the fewest lines that still reproduce the failure by repeatedly cutting roughly half and re-testing. Record the shrink in your log.

**Deliverable:** the minimal repro (aim for under ~15 lines) plus a note on what the *last thing you removed before it stopped failing* told you. **Check:** the repro must still fail on its own, with no external setup beyond what's included.

---

## Task 5 — Change the representation

Pick a problem you currently hold "in your head" (a control flow, a state machine, a data dependency). Externalize it three ways: (a) a box-and-arrow diagram, (b) a table of cases/states, (c) a hand-trace of one concrete input. Note which representation revealed something the others didn't.

**Deliverable:** the three artifacts (photos of paper are fine) and one sentence on what each surfaced. **Check:** at least one representation must reveal a case, branch, or interaction you hadn't been tracking.

---

## Task 6 — Enumerate and verify your assumptions

For a current bug, write a list of everything you're *certain* is true ("input is non-null," "config is loaded," "this field matches the column," "the framework works here"). Then *verify each one* with an actual print/log/debugger — no reasoning, only observation.

**Deliverable:** the assumption list with each item marked VERIFIED / FALSE. **Check:** you must find at least one assumption you'd never actually checked. If every assumption was already verified, you didn't list the obvious ones — the "select isn't broken" ones are the point.

---

## Task 7 — Run the incubation experiment

Next time you hit a genuine wall after real focused effort, *deliberately* stop: take a 15-minute walk (no phone, no problem-talk) or end the day on it and sleep. Before stepping away, write down the problem state. After, note whether anything shifted.

**Deliverable:** two timestamped notes — "state before walk/sleep" and "state after." **Check:** you must have done focused work *first* (incubation only works on a loaded problem); a walk taken before engaging doesn't count.

---

## Task 8 — Apply inversion to a stuck problem

Take a "why won't this work / why does this fail?" problem and reframe it as "how would I *deliberately cause* this exact behavior?" Brainstorm at least five concrete mechanisms that would produce it, then test the most likely two.

**Deliverable:** the inverted question, the five candidate mechanisms, and the result of testing two. **Check:** the mechanisms must be specific and testable ("a stale secret on one node"), not categories ("a config problem"). See [inversion thinking](../../07-creative-and-lateral-thinking/02-inversion-thinking/).

---

## Task 9 — Solve the special case first

Find a problem you find hard in the general form (an algorithm, a recurrence, a tricky query). Solve the *smallest* case by hand (n=1, then n=2), look for the pattern, then generalize. Document the jump from special case to general solution.

**Deliverable:** the worked small cases and the general solution they led to. **Check:** you must derive the general approach *from* the special cases, not solve it abstractly and back-fill — the point is that the small cases reveal the pattern.

---

## Task 10 — Practice the timebox-and-escalate loop

For one real task this week, set a 25-minute timer. At each expiry, answer in your log: "did I gain new information in the last 25 minutes? (Y/N)". On two consecutive N's, *force a switch* — change technique, or write the help question and ask. Run at least three cycles.

**Deliverable:** the log showing the Y/N at each timer, and what you did on the first double-N. **Check:** you must actually switch or escalate on the double-N — riding through it "just one more try" is the exact thrashing this trains you to break.

---

## Task 11 — Work a problem backward

Take a bug or feature where the forward path keeps dead-ending. Start from the desired end state and write the chain of preconditions backward ("for X, I need Y; for Y, I need Z…") until you reach something you can verify is true. Find the first "before" step that *isn't* actually satisfied.

**Deliverable:** the backward precondition chain with the broken link marked. **Check:** the chain must end at a concretely checkable fact, and you must identify *where* reality diverges from the chain. Pairs with [devising a plan](../02-devising-a-plan/).

---

## Task 12 — (Senior/staff) Unstick someone else, and teach the move

Find a teammate (or yourself, retrospectively) who's currently stuck. Pair with them: help diagnose the *type* of stuck, apply the matching technique *with* them, and — critically — name the technique out loud so they learn it ("we're going to change the representation here — let's draw it"). Then step away once they're moving.

**Deliverable:** a 4–5 sentence note: what kind of stuck it was, which technique unstuck it, and how you made the technique transferable rather than just solving it for them. **Check:** the goal is that *they* could run the same move next time unaided — if you just handed them the answer, redo it teaching the method. See [professional](./professional.md).
