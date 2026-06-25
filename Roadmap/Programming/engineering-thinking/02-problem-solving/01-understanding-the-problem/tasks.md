> Exercises in Pólya's first stage — *understanding the problem*. Global constraint for every task: **do not solve the problem and do not write production code.** The deliverable is always a *restatement, a list of questions, an extracted requirement, or a set of acceptance criteria* — i.e., evidence that you understood the problem before attacking it. Work concretely; vague answers ("ask the stakeholder more") score zero. Where a task names a deliverable, produce exactly that.

---

## Task 1 — Restate three vague tickets

For each of the following, write (a) a one-sentence restatement in your own words, and (b) the three or more clarifying questions you'd ask before estimating it.

1. "Make the dashboard load faster."
2. "Add notifications when something important happens."
3. "Users should be able to export their data."

**Deliverable:** a short table, one row per ticket, columns = *restatement* / *blocking questions*. A question counts only if its answer would change what you build.

---

## Task 2 — Fill Pólya's grid for a coding problem

Take this prompt: *"Given a string, return the length of its longest substring without repeating characters."*

Without solving it, fill in:

- **Unknown:** what exactly is returned?
- **Data:** what are you given, and what are its bounds/types? (What does "character" mean — bytes? Unicode code points? graphemes?)
- **Condition:** what constraints and edge cases must hold? List at least five (empty string, single char, all-same, etc.).

**Deliverable:** the three-row grid plus an edge-case list. Then note: which row was hardest to fill, and why?

---

## Task 3 — Find the X behind the Y

Each request below is a solution (Y) in disguise. For each, write the most likely real problem (X) and one alternative solution that addresses X directly.

1. "How do I increase the database connection pool to 5000?"
2. "Can you give me read access to the production Kafka topic?"
3. "How do I write a cron job that restarts the service every hour?"
4. "I need a regex to extract all the IP addresses from our access logs."

**Deliverable:** a table with columns *stated request (Y)* / *probable real problem (X)* / *better solution* / *the one question that would confirm X*.

---

## Task 4 — Turn a bug report into a reproduction spec

Bug report, verbatim:

> "The app is super slow and sometimes it just logs me out for no reason. Happened twice today."

You can't fix what you can't see. Write the **reproduction spec** — the specific information you need to reproduce this — covering: what "slow" means and where, what "logs me out" means precisely, when (timestamps), environment, user/account, frequency, and what the user was doing. Then state the *single most likely* hypothesis you'd test first and why.

**Deliverable:** a reproduction-info checklist + one ranked hypothesis. Do **not** propose a code fix.

---

## Task 5 — Hunt the implicit assumptions

Requirement:

> "When a user cancels their subscription, stop billing them and downgrade them to the free plan."

Read it one clause at a time and list every **implicit assumption** and **missing constraint** — aim for at least eight. Hints to probe: timing (immediate vs end-of-period), refunds, data retention, in-flight invoices, feature access during the remaining paid period, re-subscription, what "free plan" includes, proration.

**Deliverable:** a numbered list of assumptions/questions, each tagged *would-cause-an-incident* or *minor*. Connect at least three to [questioning assumptions](../../05-first-principles-thinking/02-questioning-assumptions/).

---

## Task 6 — Write acceptance criteria as your definition of done

Take the (now better-understood) feature: *"Let users apply a discount coupon at checkout."* Without writing code, write **acceptance criteria** as concrete scenarios (Gherkin or a numbered list) covering at least: a valid coupon, an expired coupon, an invalid code, an empty cart, two coupons at once, and the interaction with tax.

**Deliverable:** the acceptance-criteria set. Then identify the *one* scenario whose answer you genuinely don't know — that's the requirement gap you'd escalate before building.

---

## Task 7 — Work the example by hand to find the missing requirement

Prompt: *"Given a list of transactions (each with an amount, positive or negative), return the account's balance over time."*

Do **not** code. Instead, take the input `[+100, -30, -50, +20]` and produce the output by hand. In doing so, surface every ambiguity the prompt left open (Does "balance over time" mean a value per transaction, or just the final balance? Starting balance? What if it goes negative — is that allowed? Are transactions ordered/timestamped?).

**Deliverable:** your hand-worked trace + a list of every requirement the single example exposed.

---

## Task 8 — Reframe a coarse problem (senior)

A team lead says: *"Our service is unreliable. We need to rewrite it."*

This is too coarse to act on. Write **three sharper reframings** of the underlying problem, each phrased as a specific, measurable statement (e.g., about a particular failure mode, recovery time, or dependency), and for each note how the *solution space changes* compared to "rewrite it." The goal is to show that framing determines what solutions are even thinkable.

**Deliverable:** three reframings + the solution-space shift each one creates. Reference the leverage idea from [techniques when you're stuck](../06-techniques-when-you-are-stuck/) if a reframe unlocks the problem.

---

## Task 9 — Separate stated need from real business need (professional)

An executive request: *"Build us an internal AI assistant that can answer any question about our codebase."*

Walk the request up to the business outcome. Write: (a) the stated need, (b) the most likely *real* need, (c) the underlying business goal, and (d) two non-AI solutions that might serve the goal more cheaply. Then write the **one question you'd ask the executive** that would most change the scope.

**Deliverable:** the stated→real→goal chain + alternatives + the highest-leverage clarifying question.

---

## Task 10 — Write a rejectable problem statement

Pick any feature you've built recently (or invent one). Write a **one-paragraph problem statement** that a stakeholder could *disagree with* — i.e., specific enough to be wrong. It must contain: the unknown (desired outcome, measurable), the data (current situation), the conditions/constraints, and an explicit **non-goals** list.

**Deliverable:** the paragraph. Self-check: could someone who disagrees point to the *exact sentence* they disagree with? If not, it's too vague — rewrite it. Tie this to [looking back and reflecting](../04-looking-back-and-reflecting/) by noting how you'd verify, after shipping, that you framed it correctly.

---

## Task 11 — Distribute a shared understanding (professional)

You're leading a feature that spans three teams (frontend, payments, notifications). Design the **minimum set of artifacts** that would make all three teams solve the *same* problem rather than three slightly different ones. For each artifact (e.g., canonical problem statement, non-goals, one worked end-to-end scenario, shared acceptance criteria, a boundary diagram), state in one line *what misunderstanding it prevents*.

**Deliverable:** the artifact list with the failure each one guards against. Then write the single question you'd ask any engineer to *test* whether the understanding actually replicated across teams.

---

## Task 12 — The ambiguity audit

Below is a real-flavored ticket. Produce a complete **ambiguity audit**.

> "Send users a reminder email if they haven't completed their profile within a week of signing up."

Audit it for: undefined terms ("completed"? "a week"?), boundary/timing questions (time zones, exactly one week vs within), failure modes (email send fails, user completes mid-send), idempotency (one reminder or repeated?), scope (deleted/banned users?), and the definition of done. Then convert the ticket into a **precise, testable restatement**.

**Deliverable:** the categorized ambiguity list + the rewritten one-paragraph problem statement. This is the capstone — it exercises restatement, assumption-hunting, edge cases, and definition-of-done together.

---

**Related:** [devising a plan](../02-devising-a-plan/) · [carrying out the plan](../03-carrying-out-the-plan/) · [debugging as problem-solving](../05-debugging-as-problem-solving/) · [decomposition](../../01-computational-thinking/01-decomposition/) · [questioning assumptions](../../05-first-principles-thinking/02-questioning-assumptions/) · back to the [problem-solving section](../) and the [roadmap root](../../README.md).
