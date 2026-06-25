> Practice tasks for debugging your own reasoning. These are *metacognition* exercises — the deliverable is usually a short written artifact about your own thinking, not code. Rules: (1) do them on **real** decisions and bugs from your actual work, not toy examples; (2) write everything down — articulation is the point, and unwritten reflection lies to you; (3) record predictions *before* you know outcomes, or the exercise is worthless; (4) be specific and numeric where asked — "I was pretty confident" is not an answer, "70% confident" is. Most tasks fit in 15–30 minutes; a few run over days or weeks.

---

## Task 1 — Catch your System 1 in the act

For one full workday, keep a tally. Every time you catch yourself thinking *"obviously it's X"* or *"it's definitely Y"* about a bug or decision **before** you've actually checked, mark it. At day's end, for the 3 most consequential ones, note whether the gut call turned out right.

**Deliverable:** a count, plus a 3-row table (gut call · was it right?). Most people are surprised how often "obviously" was wrong.

---

## Task 2 — Rubber-duck a live bug, transcribed

Take a bug you're currently stuck on. Explain it *in writing*, line by line, to an imaginary listener — the code, what you expect each step to do, what actually happens. Do not skip steps because they're "obvious."

**Deliverable:** the transcript, with the exact sentence where you noticed the bug highlighted (if you solved it mid-explanation, as usually happens). If you didn't solve it, note which assumption you'd never stated before writing it out.

---

## Task 3 — Explain it until it breaks (illusion of explanatory depth)

Pick something you're sure you understand: how a hash map gives O(1), how TLS handshakes work, how your service's auth flow works — your choice. Rate your understanding 1–10 *before*. Then explain it end to end in writing, no hand-waving, no "and then it just works."

**Deliverable:** the written explanation, your before-rating, your honest after-rating, and a list of the specific gaps the explanation exposed. The drop between the two ratings is the illusion of explanatory depth (Rozenblit & Keil) measured on yourself.

---

## Task 4 — Calibrate this estimate

Take a task you're about to start. Instead of a point estimate, write a **confidence interval**: "X% done by [date A], Y% by [date B], could slip to [date C] if [specific risk]." Then start the task. When it's done, record the actual completion.

**Deliverable:** the prediction (written *before* starting) and the outcome. Keep these — Task 11 aggregates them. One data point proves nothing; the habit is the point.

---

## Task 5 — Run the disconfirming test first

Next time you have a debugging hypothesis ("the bug is in the retry logic"), **before** investigating, write down: (a) the hypothesis, (b) the cheapest single observation that would *disprove* it, (c) your confidence %. Then run the disconfirming test *first*, before any confirming work.

**Deliverable:** the a/b/c note, and what the disconfirmer showed. Reflect: did running it first save you time vs. your usual approach of confirming?

---

## Task 6 — Premortem your most recent confident decision

Take a technical decision you made in the last month that you felt confident about. Write the premortem: *"It's six months from now and this decision caused a real problem. Tell the story of what went wrong."* Be concrete — name the failure mode, the trigger, the cost.

**Deliverable:** the failure story, plus one cheap guardrail you could add *now* that would prevent or detect that failure. If you find one, add it for real.

---

## Task 7 — Audit a past wrong conclusion (root-cause your reasoning)

Pick a recent time you were confidently wrong (a misdiagnosed bug, a bad estimate, a design that didn't work out). Run a *reasoning* postmortem — not "what was the technical mistake" but "**what in my thinking let me be wrong**":

- What did I assume that turned out false?
- What evidence did I ignore or explain away?
- Was I ego-invested, rushed, tired, anchored?

**Deliverable:** the analysis, ending with one *named* personal failure mode (e.g., "I anchor on my first hypothesis"). This is the seed of your failure-mode inventory.

---

## Task 8 — The "what would change my mind?" drill

List 3 technical beliefs you currently hold strongly (e.g., "we should migrate off the monolith," "this service doesn't need caching," "library A is better than B for us"). For each, write the *specific, concrete observation* that would change your mind.

**Deliverable:** a 3-row table (belief · what would flip it). Flag any belief for which you *couldn't* name a disconfirmer — those are unfalsifiable, and you should hold them far more loosely than you do.

---

## Task 9 — Notice and escape a rabbit hole

For one week, whenever you start diving into a sub-problem, write a one-line note first: *"Going into [X] to find out [Y]; if not relevant in 30 min, back out."* Set a timer. When it fires, decide consciously: continue or climb out?

**Deliverable:** your notes for the week, plus a count of how many times the timer caught you in a hole you'd otherwise have stayed in. Reflect on the sunk-cost pull you felt when deciding to back out.

---

## Task 10 — Map your intuition's valid zone

List 5 things your gut tells you confidently at work (e.g., "this code will have a concurrency bug," "this estimate is too optimistic," "this candidate is strong," "this vendor will be a pain"). For each, score it against Kahneman & Klein's two conditions: *Is the environment regular? Did I get prolonged practice with fast, clear feedback?*

**Deliverable:** a 5-row table (gut call · regular env? · fast feedback? · trust it or verify?). The ones that fail either condition are where your confident intuition is least reliable — mark how you'll compensate.

---

## Task 11 — Build and score your calibration log (multi-week)

Over 2–4 weeks, log every prediction you make at work with a confidence % — estimates, bug-cause guesses, "this'll work" calls. Aim for 20+. When outcomes land, record right/wrong. Then bucket by confidence and compute hit rates.

**Deliverable:** a table grouped by confidence band:

| Confidence | # predictions | # correct | Actual hit rate |
|---|---|---|---|
| ~90% | | | |
| ~70% | | | |
| ~50% | | | |

Compare stated vs. actual. If your 90%s hit at 60%, you're overconfident by 30 points — and now you know to discount. (This is the *Superforecasting* loop run on yourself.)

---

## Task 12 — Start a decision journal and seed it

Create a decision journal. Add your *next 3* non-trivial technical decisions using this template:

```
Date · Decision · Confidence % · Key assumption ·
Disconfirmer (what would prove this wrong) ·
Alternatives considered (steelmanned) · Revisit date
```

**Deliverable:** 3 completed entries with future revisit dates on your calendar. The value lands later — on the revisit date, audit whether your *reasoning* (not just the outcome) held up.

---

## Task 13 — (Senior+) Red-team your own design

Take a design or RFC you authored. Spend 30 minutes with one job: **break it.** Attack it on load, failure modes, 2-year maintenance, adversarial users, and reversibility. Then steelman the *strongest alternative you rejected* — write its best case better than its advocates would.

**Deliverable:** the list of weaknesses found (a real design has at least one) and the steelman. If your design survived untouched, you red-teamed too gently — go again.

---

## Task 14 — (Staff+) Debug a group decision

Recall a recent team decision that went poorly, or observe a live decision meeting. Diagnose the *group* reasoning failure: groupthink? HiPPO anchoring? information cascade? diffusion of doubt (everyone assumed someone else checked)? shared blind spot?

**Deliverable:** the named group failure mode, plus one concrete *process* change (independent estimates first, devil's-advocate role, leader-speaks-last, team premortem, decision review) that would have caught it — and a note on how you'd introduce it without blaming anyone.

---

## Related

- [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md)
- Turn these into trained reflexes → [Deliberate practice](../03-deliberate-practice/)
- [Knowing what you don't know](../04-knowing-what-you-dont-know/) · [Cognitive biases in code decisions](../../04-critical-thinking/03-cognitive-biases-in-code-decisions/) · [Debugging as problem-solving](../../02-problem-solving/05-debugging-as-problem-solving/)
- Back to [Metacognition & learning](../) · [Engineering Thinking](../../README.md)
