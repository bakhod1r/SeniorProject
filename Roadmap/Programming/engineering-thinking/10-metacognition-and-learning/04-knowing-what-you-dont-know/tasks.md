> Practical exercises for mapping the edges of your own competence. Constraints for all tasks: use a **real** system you currently work on (not a toy), write deliverables down (a paper or text file beats a thought — unwritten gaps stay invisible), and where a task asks for a number, commit to the number *before* you check the answer so you can measure your own calibration. Several tasks have a reflective or numeric deliverable; do those honestly, including when the result is unflattering. Aim to actually run at least 6 of these over two weeks, not just read them.

---

## Task 1 — Map your known unknowns

Pick a system you work on. In 20 minutes, list every part you *know* you don't fully understand (auth flow, deploy pipeline, that one legacy module, a third-party integration). For each, write *how* you'd close it: ask / read / pair / spike / test.

**Deliverable:** a checklist of ≥8 known unknowns, each with a closing action. **Reflective:** which one have you been avoiding, and why? Avoidance usually marks the most important gap.

---

## Task 2 — Run the 2×2 quadrant on a current task

Take a task you're about to start. Fill all three reachable boxes of the known/unknown grid: known knowns, known unknowns, and your *best guess* at where unknown unknowns might hide (areas you've never touched in this task). 

**Deliverable:** the filled grid. **Numeric:** estimate what fraction of the task's total risk lives in the bottom-right (unknown unknown) box. Revisit after the task ships and check.

---

## Task 3 — Convert one unknown unknown into a known unknown

Force exposure on a system area you've never explored. Read a file/module you've avoided, or trace a request path end-to-end through code you don't own. Write down every surprise — each was an unknown unknown until just now.

**Deliverable:** a list of ≥3 surprises ("I didn't know X existed / behaved that way"), plus what you'll do about the riskiest one.

---

## Task 4 — Run a pre-mortem on an upcoming change

Before your next non-trivial launch, sit for 15 minutes and write the story of how it failed three months from now. Don't filter — write every plausible disaster. Cluster them; mark which were *new* to you.

**Deliverable:** ≥6 failure stories. **Reflective:** which one had you genuinely not considered before writing it? That one is the point of the exercise. Turn it into a tracked risk with an owner.

---

## Task 5 — Calibrate yourself with a prediction log

Start a log. Over one week, record ≥10 engineering judgments with a confidence number ("80% this refactor breaks the export job"; "60% the migration needs a maintenance window"). At week's end, score outcomes.

**Numeric deliverable:** compare your average stated confidence on the items you got right vs wrong. Are your "90%"s really 90%? Most people discover over-confidence in unfamiliar areas. Note your personal bias direction.

---

## Task 6 — Estimate with a range and named assumptions

Take a task someone asked you to estimate. Instead of a single number, produce: (a) a low–high range, (b) the one or two assumptions that, if false, blow up the estimate, (c) a spike you could run to collapse the biggest unknown.

**Deliverable:** the three-part estimate. **Reflective:** how much wider is your honest range than the single number you'd have blurted out under pressure?

---

## Task 7 — Get an outsider design review

Take a design you understand well and route it past someone with *no* context on the system — ideally a different team. Collect their "naive" questions verbatim.

**Deliverable:** the list of their questions. **Reflective:** how many exposed an assumption you'd stopped noticing? The questions you couldn't immediately answer are your blind spots (the Johari "blind" quadrant) made visible.

---

## Task 8 — Audit your last incidents for unknown unknowns

Pull your team's last 5–10 incident reports (or postmortems you remember). Classify each root cause: "known-hard thing done badly" vs "a thing nobody knew was true."

**Numeric deliverable:** the ratio. Most teams find unknown unknowns dominate. **Reflective:** what process (pre-mortem, game day, outsider review) would most cheaply have surfaced the biggest one *before* it fired?

---

## Task 9 — Find your danger zone

Identify an adjacent domain where you feel "competent enough" because of your real strength in a neighboring area (e.g. strong backend → "I can handle the infra/SQL/security"). Take a concrete task in that adjacent area and *deliberately* slow down: read the docs on failure modes, verify each assumption.

**Deliverable:** ≥2 things you'd have gotten wrong by relying on your transferred confidence. **Reflective:** write the one-sentence rule you'll use next time you cross that boundary.

---

## Task 10 — Practice the three sentences

For one full week, consciously use "I don't know," "I'd have to check," and "Let me make sure I understand: ..." whenever they're true — especially in meetings where bluffing is tempting. Tally each use.

**Numeric deliverable:** count of each over the week. **Reflective:** did anything bad happen (it almost never does), and did anyone follow your lead in admitting their own gaps? Note the social effect.

---

## Task 11 — Build (or seed) a risk register

For a system you own or co-own, start a small risk register: ≥5 known unknowns, each with a statement, blast radius, owner, and a decision rule ("if X, then we do Y"). Make at least one entry something a recent incident or game-day *taught* you.

**Deliverable:** the register. **Reflective (for senior+):** is there a "What we don't know" section in your team's design docs? If not, draft one and propose it.

---

## Task 12 — "What would an expert ask?" walkthrough

Take a plan or design you're confident in. Mentally simulate the most senior engineer you know reviewing it, and write down the ten questions they'd ask. Answer them honestly.

**Deliverable:** the 10 questions with your answers — and a clear mark on every question you *couldn't* answer. **Reflective:** each unanswerable question is a known unknown you just surfaced; pick the most dangerous one and close it this week. Feeds directly into [deliberate practice](../03-deliberate-practice/).

---

## See also

- [Knowing what you don't know — junior](./junior.md) · [middle](./middle.md) · [senior](./senior.md) · [professional](./professional.md) · [interview](./interview.md)
- [Learning how to learn](../01-learning-how-to-learn/) — your known-unknowns list is a study plan
- [Debugging your own reasoning](../02-debugging-your-own-reasoning/) · [Deliberate practice](../03-deliberate-practice/)
- [Probabilistic thinking](../../06-probabilistic-thinking/) · [Questioning assumptions](../../05-first-principles-thinking/02-questioning-assumptions/)
- [Section root](../) · [Engineering Thinking](../../README.md)
