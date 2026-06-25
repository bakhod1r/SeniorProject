> Practice for Pólya's fourth stage — *looking back*. These are reflection exercises, not coding katas: run a retro, write a blameless postmortem, extract a general principle, generalize a solution, calibrate an estimate. **Global constraints:** (a) every task produces a *written deliverable* you keep — a `lessons.md` entry, a postmortem, an ADR; (b) for any incident task, the fix must be **systemic** (removes reliance on a human remembering), and you must state how you'd verify the same incident couldn't be caused by a *different* person; (c) for any "extract the lesson" task, write the **general principle**, not the specific fix; (d) keep each deliverable tight — clarity over length. Use real situations from your own work wherever possible; the exercises are far more valuable on your actual mistakes.

---

## Task 1 — The five-minute look-back (build the habit)

Take the **last** ticket you closed. Run Pólya's checklist on it retroactively: (1) re-read the original ticket — did you solve *that* or a drifted version? (2) re-run its edge cases in your head — any unhandled? (3) is there a cleaner derivation? (4) what's the general lesson?

**Deliverable:** a 4-line note answering each. If you find drift or an unhandled edge case, you've just proven why this stage exists. Repeat on your next three closed tickets to make it reflex.

## Task 2 — Catch the scope drift

Find (or recall) a task where what you *shipped* differed from what was *asked*. Write down: the original requirement (verbatim), what you actually built, where the drift entered, and how an upfront verification checklist would have caught it.

**Deliverable:** a short "drift autopsy" + a reusable verification checklist you'll run before closing tickets. Tie it to [understanding the problem](../01-understanding-the-problem/) — the edge cases you enumerate there are what you verify here.

## Task 3 — Extract the general principle

Take three bugs you fixed recently. For each, write **two** versions of the lesson: the *specific fix* and the *general principle* it generalizes to.

> Example — specific: "used `.get()` to avoid the KeyError." General: "any external lookup can miss; design for absence at the boundary."

**Deliverable:** a 3-row table (bug → specific → general). The general column is the one that goes in your `lessons.md`, because it transfers across a whole class.

## Task 4 — Refactor under green

Take a piece of code you wrote that "works but is ugly." First, confirm it has tests (write them if not — you cannot safely refactor without the seatbelt). Then do a make-it-right pass: rename, extract, de-duplicate, name the magic numbers. Tests stay green throughout.

**Deliverable:** the before/after diff + one sentence on what the refactor made clearer. State explicitly why the green tests made this safe.

## Task 5 — Write a blameless postmortem

Take a real incident or a significant bug. Write a postmortem with: summary, timeline, root cause (via 5 Whys), what went well, what went poorly, and action items. Constraint: **no sentence may name a person as a cause** — every "why" must land on the *system*.

**Deliverable:** the full postmortem. Self-check: could the same incident have been caused by a *different* person? If yes, you found a scapegoat — push the analysis deeper until the fix is systemic.

## Task 6 — Turn an instance fix into a systemic fix

Take the incident from Task 5 (or another). Identify the *class* it belongs to, not just the instance. Then design the one systemic change that removes the whole class — and name **at least one other past incident** the same fix would have prevented.

**Deliverable:** "Instance fix / Class / Systemic fix / Also-prevents" — four lines. If you can't name another incident the fix prevents, your fix is probably still too shallow.

## Task 7 — Audit your reasoning, not your output

Pick a bug that took you much longer than it should have. Write the output-level lesson ("the X was missing"), then the **reasoning-level** lesson: what false assumption sent you down the wrong path, and what habit produced it?

**Deliverable:** a paired note (output lesson / reasoning lesson). Connect to [debugging your own reasoning](../../10-metacognition-and-learning/02-debugging-your-own-reasoning/). The reasoning lesson prevents a class of future bugs; that's the higher-value one.

## Task 8 — Calibrate an estimate

Take a recent task where actual effort diverged from your estimate. Record: estimate, actual, the *source* of the gap (what you didn't know or underweighted), and the resulting adjustment to your personal estimation multipliers.

**Deliverable:** a calibration entry. Do this for five tasks and look for a *systematic* bias (e.g., "I underestimate anything touching billing by 3x"). That bias is now actionable forecasting data — a [feedback loop](../../03-systems-thinking/02-feedback-loops/) on your own estimates.

## Task 9 — Generalize a solution to a whole class

Take a solution you wrote for one specific case. Decide whether it should be generalized: has this pattern appeared 2–3 times (extract), or just once (notice, don't extract yet)? If it qualifies, refactor it into a reusable form.

**Deliverable:** the generalized version (or a written justification for *not* generalizing, citing the Rule of Three / premature-abstraction risk). Both answers are correct outcomes — the judgment is the skill.

## Task 10 — Run a real retrospective

Run (or facilitate) a retro on a recently finished project or sprint, using Norm Kerth's Prime Directive to open it. Structure: what worked / what didn't / what we change. Constraint: at least one action item must change the **system or process**, not just exhort the team to "do better."

**Deliverable:** the retro notes + the system-changing action item, with an owner and a date. A retro whose only output is "we'll communicate better" failed this task.

## Task 11 — Make action items actually ship (accountability audit)

Find your team's last 3–5 postmortems or retros. Audit their action items: how many were closed? How many had an owner and a date? How many are surface fixes ("be careful") versus systemic ("CI blocks it")?

**Deliverable:** a one-page audit + a concrete proposal to raise the closure rate (e.g., review open action items in planning, set a closure SLA). If recurrence of the same incident class shows up, name it — that's the cost of unactioned items.

## Task 12 — Start (and seed) a personal lessons log

Create a `lessons.md` (or equivalent) and seed it with the **general principles** from Tasks 3, 7, and 8. Establish the trigger: one entry per genuinely hard problem, written as a transferable principle.

**Deliverable:** the seeded `lessons.md` + a one-line rule for when you add to it. This is your private deliberate-practice ledger — over months it becomes a cheat sheet calibrated to *your* exact gaps. See [deliberate practice](../../10-metacognition-and-learning/03-deliberate-practice/).

---

**How to use these:** Tasks 1–4 build the individual habit (verify, refactor, extract). Tasks 5–8 add the rigorous looking-back of incidents and your own reasoning. Tasks 9–11 push to systemic and team scale. Task 12 makes it all compound. Do them on *real* situations from your work — the value is in reflecting on your actual mistakes, not invented ones.

Related: [carrying out the plan](../03-carrying-out-the-plan/) · [debugging as problem-solving](../05-debugging-as-problem-solving/) · [techniques when you are stuck](../06-techniques-when-you-are-stuck/) · [feedback loops](../../03-systems-thinking/02-feedback-loops/). Back to the [problem-solving section](../) · [roadmap](../../README.md).
