> Interview questions on Pólya's first stage — *understanding the problem*. In a real interview this skill is tested implicitly: the strongest signal you can send is asking sharp clarifying questions *before* coding. Answers below are short and pointed, with the traps and follow-ups interviewers actually use.

---

## Q1. What does Pólya mean by "understanding the problem," and why is it the most-skipped stage?

It's the first of Pólya's four stages in *How to Solve It*: before planning or coding, you make sure you know the **unknown** (what you must produce), the **data** (what you're given), and the **condition** (the rules linking them). It's skipped because coding *feels* like progress and understanding feels like delay — so people start solving a problem they can't yet restate.

**Trap:** Don't recite the four stages as trivia. The interviewer wants to hear that you *practice* it — that you restate problems before attacking them.

## Q2. What are Pólya's three questions, and how do they map to a programming task?

*What is the unknown?* → the output / return value / end state. *What are the data?* → the inputs / arguments / current state. *What is the condition?* → constraints and invariants (complexity bounds, edge cases, what must stay true). Filling all three is the minimum bar for "I understand this well enough to start."

**Follow-up:** "Which is most often missing?" — usually the *condition*; people define inputs and outputs but skip constraints like empty input, concurrency, or performance bounds.

## Q3. You're given a coding problem in this interview. What's the first thing you do?

Restate it in my own words and confirm with you, then nail down inputs, outputs, and constraints with a few questions: input size and ranges, empty/null cases, duplicates, whether input is sorted, expected complexity, and how to handle invalid input. Then I work one concrete example by hand before writing code.

**Trap:** Candidates who silently start coding lose points even with a correct solution. *Asking the clarifying questions is itself the thing being graded.*

## Q4. What is the XY problem? Give an engineering example.

Someone asks about their *attempted solution* (Y) instead of their *actual problem* (X). Example: "How do I disable foreign-key checks during import?" (Y) when the real problem (X) is "imports are too slow." The right fix is batching/deferring constraints in a transaction, not disabling data integrity. The tell is an oddly specific, low-level question; the cure is asking **"what are you ultimately trying to do?"**

**Follow-up:** "How do you avoid *being* the one with an XY problem?" — When asking for help, state the goal, not just your half-built attempt.

## Q5. A ticket says "the export button doesn't work." What do you do before touching code?

I don't theorize — I try to *reproduce* it, because I can't fix what I can't see. I gather: which export (there may be several), what "doesn't work" means (no-op vs error vs wrong output), for which users, with what data, in which browser/version, reproducible or one-off. The goal is to turn a vague report into a specific, observable failure.

**Trap:** Jumping to "I'd check the JavaScript console" is fine but secondary — first establish *what the actual problem is*. A fix for a problem you can't reproduce is a guess.

## Q6. Why are requirements the most expensive place to be wrong?

Boehm's cost-of-change curve: a defect introduced in requirements but caught later costs dramatically more the further downstream it travels — often cited as 10–100× by the time it's in production. A misunderstanding fixed during *understanding the problem* costs minutes; the same one fixed after launch costs a hotfix, a migration, and an incident. It's the cheapest point at which to be wrong.

**Follow-up:** "Why is a comprehension error worse than a coding error?" — A coding error fails loudly (a test breaks); a comprehension error fails silently (the system works, on the wrong problem) and surfaces late.

## Q7. How do you tell the difference between the problem as reported and the real problem?

The report is a *symptom* seen by someone who isn't debugging it. I separate observation from interpretation, reproduce the symptom, and trace it to a defect — which is often nowhere near where the report points. For feature requests, I walk the request up to the underlying need: "what will you do with this once you have it?" until I reach a stable goal.

## Q8. What makes a good clarifying question versus a bad one?

A good one targets something you genuinely can't resolve and whose answer *changes what you build*: "If two users redeem the last coupon simultaneously, who wins?" A bad one is vague or already answered: "Any other requirements?" Prefer questions that force a decision the design depends on. The **five Ws** — especially *why* — are a good scaffold.

**Trap:** Asking many shallow questions is as bad as asking none. Quality and relevance, not volume, is the signal.

## Q9. How do concrete examples and edge cases help you *understand* a problem (not just test it)?

Working one input by hand exposes misunderstandings that abstractions hide — e.g., "running total" might mean the value after each element or just the final sum; an example forces the question. Then I deliberately pick edge cases — empty, single element, max size, duplicates, negatives — and each undefined case is a *missing requirement* discovered before code, not after.

## Q10. Walk me through understanding "reverse the words in a sentence."

I'd ask: is a "word" whitespace-delimited? Multiple spaces collapsed or preserved? Leading/trailing spaces? Punctuation? Unicode? In place or new string? Then an example: `"the sky is blue"` → `"blue is sky the"` — confirming I reverse word *order*, not characters. Unknown = the reordered string; data = the input string + the definition of a word; condition = how to treat whitespace and the chosen complexity.

**Trap:** "the  sky" with two spaces — if you didn't ask, you've assumed an answer the interviewer may have wanted you to surface.

## Q11. What does "definition of done" have to do with understanding a problem?

If I can't state how I'll know the solution is correct, I don't understand the problem yet. Acceptance criteria — ideally concrete, testable scenarios — *are* the encoded understanding. Writing them often surfaces gaps ("what if two coupons are applied?") before any code. It's the engineering form of "measure twice, cut once."

## Q12. How do you surface implicit assumptions in a requirement?

I read each sentence and ask "what is this quietly assuming?" For "when a user deletes their account, remove their data": hard or soft delete? data others depend on? legal holds on invoices? backups included? Each hidden assumption is a future incident. The skill connects directly to systematically questioning assumptions rather than inheriting them.

## Q13. What is "a problem well stated is a problem half solved," and do you believe it?

Charles Kettering's line. Yes — a precise restatement collapses the solution space and exposes the questions you didn't know you had, often making the hard part trivial. The corollary: a *vague* statement is dangerous because everyone can agree with it without agreeing, and the disagreement surfaces later as a bug or a missed requirement.

## Q14. As a senior engineer, how is understanding the problem different from when you were junior?

Junior: making sure *I* understand the task. Senior: managing the risk that a *team* confidently builds the wrong thing. That means separating stated from real business need across stakeholders, reframing coarse problems ("the system is slow") into sharp ones, writing a rejectable problem statement, and distributing one shared understanding so everyone solves the *same* problem. Framing becomes the highest-leverage thing I do.

## Q15. Give a question you'd ask in this interview that would signal seniority.

For a "design a rate limiter" prompt: "Is the limit per-user, per-IP, or global, and is it a hard cap or a smooth throttle? What's the cost of a false positive — blocking a legitimate user — versus a false negative?" It reframes the problem around the *real* tradeoff (who gets blocked and why) instead of jumping to token-bucket-vs-leaky-bucket. The reframe, not the algorithm name, is the senior signal.

**Follow-up the interviewer may add:** "What would you explicitly declare out of scope?" — naming non-goals shows you understand the problem's boundaries, not just its center.

---

**Related:** [devising a plan](../02-devising-a-plan/) · [debugging as problem-solving](../05-debugging-as-problem-solving/) · [techniques when you're stuck](../06-techniques-when-you-are-stuck/) · [questioning assumptions](../../05-first-principles-thinking/02-questioning-assumptions/) · back to the [problem-solving section](../) and the [roadmap root](../../README.md).
