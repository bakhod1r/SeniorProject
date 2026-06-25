> These tasks make you *practice the meta-skill* rather than read about it. Global constraints: (1) every task must produce a concrete written deliverable (a plan, a schedule, a deck, a map, a doc) — not a vague intention; (2) prefer evidence-based methods (active recall, spacing, deliberate practice, Feynman) and explicitly avoid debunked ones (learning styles, pure re-reading); (3) where a task involves judgment, write down your *reasoning*, not just the answer; (4) timebox each task and note where the difficulty actually lived — that reflection is half the exercise.

---

## Task 1 — Audit your last month of learning

List everything you "studied" in the past month and, for each, mark it as **active recall / spacing / deliberate practice** (effective) or **re-reading / re-watching / passive copying** (fluency illusion). Compute the rough percentage split.

**Deliverable:** a two-column table + one paragraph: "What will I move from the passive column to the active column next month, and how?"

---

## Task 2 — Apply the Feynman technique to a concept you think you know

Pick a concept you use regularly and believe you understand (e.g., *how an index speeds up a query*, *what `async/await` actually does*, *how TLS establishes trust*). Explain it in writing, in plain language, to an imagined smart beginner — no jargon you can't immediately unpack.

**Deliverable:** the written explanation, with every spot you stumbled or hand-waved **highlighted**. Those highlights are your real study list — list the gaps separately and write one sentence on how you'll close each.

---

## Task 3 — Build a retrieval schedule for a real fact-set

Choose 15–20 stable, atomic facts you want from memory in flow (e.g., HTTP status semantics, your language's slice/map gotchas, SQL isolation levels, common Big-O). Write each as a recall-forcing card (one atom, your own words, *not* recognition).

**Deliverable:** the 15–20 cards in plain text, plus a spacing schedule (e.g., review at day 1, 3, 7, 21). For three of your facts, justify *why a flashcard is the right tool* (stable + needed-in-flow + forgotten-between-uses). For three other things you considered but rejected, say *why a flashcard is the wrong tool*.

---

## Task 4 — Design a 30-day ramp plan for an unfamiliar codebase

Pick a real codebase you don't know (an open-source project, or one at work). Design a phased ramp using the orient → trace → contribute → model sequence.

**Deliverable:** a dated 30-day plan specifying: the *one path* you'll trace end-to-end; the *small change* you'll ship by day ~20; the 5-box architecture diagram you'll draw by day 5; and the three questions you'll ask whoever knows the system. After day 5 (or simulated), attach the actual diagram.

---

## Task 5 — Escape a tutorial: build the un-guided version

Take any tutorial you've completed (or complete a short one). Then, with the tutorial *closed*, build a **deliberately different** version — change the data model, add a feature it didn't cover, or swap a library.

**Deliverable:** the working project + a short note: where did you get stuck the moment the guide was gone? Each stuck point is a real gap the tutorial had let you skip. List them.

---

## Task 6 — Predict-then-measure on a performance change

Find (or create) a piece of code with a measurable performance characteristic. *Before* changing anything, write down a specific numeric prediction ("adding this index drops the query from ~400ms to ~50ms" or "this cache cuts p99 by 40%"). Then make the change and measure.

**Deliverable:** prediction, measurement, and — most important — a paragraph on the *gap* between them and what it revealed about your mental model. A correct prediction with the wrong reasoning still counts as a gap.

---

## Task 7 — Design your T-shaped portfolio

Map your current skills onto a T: list your breadth areas (working literacy) and your depth area(s) (genuine expertise). Be honest — "I've read about it" is breadth, not depth.

**Deliverable:** the T diagram (ASCII is fine) + a one-year plan: which depth area's bar you'll deepen, which breadth area you'll add, and *what you're deliberately choosing NOT to learn* this year (with the half-life / frequency × cost reasoning behind each cut).

---

## Task 8 — Multi-pass a real paper or deep technical doc

Pick a technical paper or a substantial architecture doc relevant to your work. Read it in the three-pass method: (1) title/abstract/intro/conclusion/headings, (2) figures + key paragraphs, (3) full re-derivation of the hard parts — but **stop at the pass where it stops being worth it.**

**Deliverable:** for each pass you did, 3–5 bullets of what you learned; plus an explicit decision: "I stopped at pass N because ___." Practicing *deciding how deep to go* is the point.

---

## Task 9 — Extract the model from a human's head

Find someone who understands a system you don't. Before meeting them, draw your *best guess* model of that system. In the conversation, ask them to correct your drawing and ask: "What's the scariest part to change? What surprised you? Where do new people always get confused?"

**Deliverable:** the before-and-after diagrams side by side, plus the three highest-value things they knew that *weren't written anywhere*. (Bonus: write those down so they now are — converting tacit knowledge to a team asset.)

---

## Task 10 — Turn one week's learning into a teaching artifact

Take something you learned recently and prepare to teach it (a 10-minute brown-bag, a short doc, or a written explainer for a teammate). Teaching is the Feynman technique at scale and forces you to find every gap.

**Deliverable:** the teaching artifact (slides outline or doc) + a note on which gaps in *your own* understanding surfaced while preparing it. If nothing surfaced, you probably picked something too easy — redo with a harder topic.

---

## Task 11 — Design a learning plan for a brand-new technology

Choose a technology you genuinely need to learn next. Design a plan that explicitly separates **just-in-case** (the foundational model — learn up front) from **just-in-time** (the long tail — look up when needed), and that uses a real project as the deliberate-practice vehicle rather than tutorials alone.

**Deliverable:** the plan, clearly split into "model I'll build now" vs. "things I'll look up when a task needs them," plus the *real project* you'll build to practice on and the feedback loop you'll use to know you're improving (tests? a mentor? predict-then-measure?).

---

## Task 12 — Stress-test a belief you haven't re-examined

Pick a "best practice" or technical belief you've held for years without re-checking (e.g., "microservices scale better," "NoSQL is faster," "you should always use an ORM"). Re-derive it from first principles and check whether it still holds given how things have changed.

**Deliverable:** the original belief, the first-principles re-derivation, and a verdict: *still true / true-but-narrower / outdated*. Note where the belief came from and why it went stale (or didn't). This guards against the most dangerous knowledge: the kind you stopped questioning. See [first-principles thinking](../../05-first-principles-thinking/) and [knowing what you don't know](../04-knowing-what-you-dont-know/).
