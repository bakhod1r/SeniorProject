# Giving & Receiving Feedback — Junior Level

> **Roadmap:** [Code Review](../README.md) → Giving & Receiving Feedback
> *A review comment is a tiny piece of writing with a job to do: change the code and teach the person. Most comments fail at both because nobody ever taught the author the mechanics — "this is confusing" helps no one, "rename `d` to `daysElapsed`" fixes the file.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Be Specific and Actionable](#core-concept-1--be-specific-and-actionable)
5. [Core Concept 2 — Label Severity (Conventional Comments)](#core-concept-2--label-severity-conventional-comments)
6. [Core Concept 3 — Give the Why, and Ask Instead of Command](#core-concept-3--give-the-why-and-ask-instead-of-command)
7. [Core Concept 4 — Suggest Code, and Praise the Good](#core-concept-4--suggest-code-and-praise-the-good)
8. [Core Concept 5 — Receiving: Self-Review First, Respond to Everything](#core-concept-5--receiving-self-review-first-respond-to-everything)
9. [Real-World Examples](#real-world-examples)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How do you write a review comment that actually helps — and take one well?**

You leave comments on other people's pull requests, and you get comments on yours. Nobody sat you down and taught you *how*. So you write the comments you've seen — terse, vague, sometimes a little sharp — and you read your own feedback as a verdict on whether you're any good.

This page is about the **mechanics** of feedback: the concrete, learnable moves that make a comment land. Not the deep interpersonal stuff — empathy, mentorship, defusing a tense disagreement; that's real and important and it lives in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). This is the craft underneath it: how to phrase a comment so the author knows *exactly* what to change, *how badly* it matters, and *why*. And on the receiving side, the two habits that make every review you get faster and kinder.

The payoff is concrete. A reviewer who labels severity and explains the *why* turns a wall of comments into a sorted to-do list. An author who self-reviews first catches half their own bugs before anyone else wastes time on them. These aren't personality traits — they're techniques, and you can start using all of them today.

> **Mindset shift:** a review comment has *two* jobs, not one. Job one is to **improve the code**. Job two is to **teach** — so the author writes it correctly next time without you. A comment that fixes the line but explains nothing did half its job. Always say *why*, and always label *how much it matters* — those two habits do most of the work.

---

## Prerequisites

- **Required:** You've opened a pull request (PR) and you've left at least one comment on someone else's.
- **Required:** You know what a diff is (the red/green view of what a change adds and removes).
- **Helpful:** You've received review feedback that felt vague ("this is messy") and didn't know what to actually do about it. You'll know how to write the opposite by the end.
- **Helpful:** You've felt the small sting of getting your code picked apart. We'll name why that happens and what to do with it.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **Pull request (PR)** | A proposed change submitted for review before it's merged into the main code. Also called a merge request (MR). |
| **Reviewer** | The person reading the change and leaving comments. |
| **Author** | The person who wrote the change and is receiving the comments. |
| **Comment / review comment** | A note attached to a specific line (or the whole PR) asking for a change, a question, or praise. |
| **Severity label** | A short prefix on a comment saying how much it matters — e.g. `nit:`, `suggestion:`, `blocking:`. |
| **nit** | "Nitpick" — a tiny, optional comment (spacing, a name you'd pick differently). Safe to ignore. |
| **blocking** | A comment that *must* be resolved before the PR can merge (a real bug, a security hole). |
| **Conventional Comments** | A small shared standard for labeling comments by type and severity ([conventionalcomments.org](https://conventionalcomments.org)). |
| **Code suggestion** | A GitHub/GitLab feature that lets a reviewer propose an exact code change the author applies with one click. |
| **Self-review** | Reading your *own* diff before you ask anyone else to — the single highest-ROI habit in this whole page. |
| **Approve / Request changes** | The two main verdicts a reviewer gives: green-light, or "fix these first." |

---

## Core Concept 1 — Be Specific and Actionable

A good comment answers one question for the author: **"What, exactly, should I do?"** If they have to guess, the comment failed — even if you were right.

Compare the same concern, written two ways:

```text
BAD:  This is confusing.
GOOD: `d` is unclear here — is it days or a date? Rename to `daysElapsed`
      so the unit is obvious at the call site.
```

The bad version is a *feeling*. The author now has to reverse-engineer what you meant, agree it's confusing, *and* invent the fix — three steps, any of which can stall. The good version is a *to-do item*: it names the problem (`d` is ambiguous), gives the reason (the unit isn't clear), and hands over the exact fix (`daysElapsed`). The author reads it once and acts.

Two more, side by side:

```text
BAD:  Error handling needs work.
GOOD: `os.Open` can return an error here and we ignore it — if the file
      is missing, `f` is nil and the next line panics. Check `err` and
      return it before using `f`.

BAD:  Don't like this loop.
GOOD: This builds the slice with append inside a loop with no pre-sized
      capacity. For the ~10k rows we expect, pre-allocate with
      `make([]Row, 0, len(input))` to avoid repeated re-allocations.
```

Notice the pattern in every "good" version: **point to the exact spot, state the concrete problem, and propose a concrete fix or question.** Vague feedback isn't kinder — it's *more* work for the author and more likely to be ignored or misread.

> **Key insight:** "Specific" means the author could act on your comment **without asking you a follow-up question**. If your comment would generate a reply of "what do you mean?" or "how?", it wasn't specific enough yet. Write the follow-up answer *into* the original comment.

---

## Core Concept 2 — Label Severity (Conventional Comments)

Here's a problem that quietly wrecks reviews: the author can't tell which of your fifteen comments are *required* and which are *whatever-you-think*. So they treat them all as equal — and either over-correct on trivia or accidentally ignore a real bug because it sat next to a comment about spacing.

The fix is one habit: **prefix every comment with a severity label** so its weight is unmistakable. This is the single change that transforms a junior reviewer into a useful one. The widely used vocabulary is called **Conventional Comments** — a tiny shared standard ([conventionalcomments.org](https://conventionalcomments.org)). The labels you'll use most:

| Label | Means | Author must…? |
|---|---|---|
| `nit:` | Nitpick — tiny, optional, take it or leave it | No |
| `suggestion:` | "Consider this" — a genuine idea, author's call | No (but reply) |
| `question:` | "I don't understand this — explain?" | Reply, not necessarily change |
| `issue:` | A real problem that should be addressed | Usually yes |
| `blocking:` | Must be fixed before this can merge | **Yes** |
| `praise:` | Calling out something done well | No — just enjoy it |

The same comment, unlabeled vs labeled:

```text
UNLABELED:  Use a constant for this timeout instead of the magic number.
            (Author thinks: do I HAVE to? Is this blocking? I'll guess.)

LABELED:    nit: could pull `30` into a named const like `requestTimeout`
            for readability — non-blocking, your call.
```

Now the author knows in half a second: optional, skip if you're in a hurry. Contrast a real one:

```text
blocking: this SQL is built with string concatenation of `userId`, which
is a SQL-injection hole. Use a parameterized query before this merges.
```

No ambiguity. This *must* be fixed, and the author knows it without reading your tone of voice into it.

> **Key insight:** the label does a job your prose can't: it sets **expectations** before the author reads a single word of your reasoning. A `nit:` and a `blocking:` might be the same length and the same politeness — the prefix is what tells the author whether to drop everything or move on. Label *every* comment; an unlabeled comment defaults, in the author's head, to "maybe important?" — the worst possible state.

A practical default: if you're not sure whether something is blocking, it probably isn't — use `suggestion:` or `issue:` and say so. Reserve `blocking:` for real correctness, security, or "this will break in production" problems.

---

## Core Concept 3 — Give the Why, and Ask Instead of Command

Two phrasing habits separate a comment that *teaches* from one that just *orders*.

**Give the why.** A comment without a reason is a decree — the author changes the line but learns nothing, so they'll make the same mistake next week and you'll write the same comment again. The *why* is what makes the lesson stick.

```text
NO WHY:    Don't use a global here.
WITH WHY:  A package-level global for the DB connection means tests can't
           swap in a fake, and two tests run in parallel will stomp on
           each other's state. Pass it in as a parameter instead.
```

The first one, the author obeys and forgets. The second one, they *understand* — and now they'll spot the next global themselves. You wrote the comment once instead of forever.

**Ask, don't command.** Phrasing a concern as a question does two things at once: it's easier to receive (it's not an accusation), and it teaches *better*, because it makes the author do the thinking and arrive at the answer themselves.

```text
COMMAND:   This is broken — user can be nil.
QUESTION:  What happens if `user` is nil here? I think the `.Name` access
           on the next line would panic — can we guard it?
```

There's a bonus to asking: sometimes *you're* the one who's wrong. Maybe `user` genuinely can't be nil because it's validated three lines up that you didn't scroll to. "This is broken" makes you look foolish when you're mistaken; "what happens if `user` is nil?" stays correct either way — the author either fixes a real bug or teaches *you* something. Questions are humbler *and* safer.

This is the boundary where mechanics meet tone. The deeper interpersonal craft — reading the room, mentoring, navigating a disagreement that's gotten heated — lives in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). The mechanical version, the part you can do on autopilot: **state the reason, and prefer a question to a command.**

> **Key insight:** "ask, don't tell" is not (only) about being nice. A question transfers the *reasoning* to the author — they discover the bug, so they own the fix and remember the pattern. A command transfers only the *conclusion* — they patch the line and learn nothing. The question teaches; the command just corrects.

---

## Core Concept 4 — Suggest Code, and Praise the Good

**Offer code suggestions for trivial fixes.** For small, unambiguous changes — a rename, a missing nil check, a one-line refactor — don't *describe* the fix in prose and make the author re-type it. GitHub and GitLab have a **suggestion** feature: you write the exact replacement code in a special block, and the author applies it with **one click**. Less friction, fewer round-trips, zero chance of them mistyping your suggestion.

On GitHub you write it as a fenced block tagged `suggestion`:

````text
nit: simpler with the standard helper —

```suggestion
        return errors.Is(err, os.ErrNotExist)
```
````

The author sees a green "Apply suggestion" button. One click, committed, done. Use this for anything small and certain; for larger changes, describe the direction in prose and let the author drive.

**Praise the good things too.** A review that is *only* criticism trains the author to dread your name in the reviewer list. When someone handles an edge case cleanly, names something perfectly, or deletes a pile of dead code — say so. Use a `praise:` label so it doesn't get lost among the fixes.

```text
praise: nice — pulling this into `validateInput` and unit-testing it
separately makes the handler so much easier to follow. Stealing this pattern.
```

This isn't flattery or padding. Praise is *information*: it tells the author which of their instincts are good ones, so they do more of that. A review with zero positive signal teaches only "everything I do is wrong," which is both false and demoralizing — and, practically, it makes people defensive and slower to accept the real fixes.

> **Key insight:** the goal of a review is **better code and a teammate who keeps getting better** — not a maximally long list of flaws. A code suggestion removes friction from a fix; a word of praise reinforces a good habit. Both are part of the mechanics, not soft extras you do when you have spare time.

One more separation that prevents a lot of friction: **distinguish facts from preferences.** A real bug, a security hole, a violated team convention — those are facts; say so plainly (and probably `blocking:` or `issue:`). "I'd have written this with a `switch`" is a *preference*; label it `nit:` or `suggestion:` and let it go if the author disagrees. Dressing up a personal preference as if it were a fact is one of the fastest ways to lose an author's trust — and one of the [review anti-patterns](../08-review-anti-patterns/junior.md) covered later.

---

## Core Concept 5 — Receiving: Self-Review First, Respond to Everything

Half of feedback is *getting* it well. Two mechanical habits do most of the work.

**Self-review before you request review.** Before you add a single reviewer, open your own PR and read the diff top to bottom *as if someone else wrote it*. This is the highest-ROI habit in this entire page, and almost nobody does it. You will catch — every time — a leftover `console.log`, a commented-out block, a typo, a function you meant to rename, a test you forgot to add. You fix those *before* a human spends their attention on them.

Self-review does a second thing that's just as valuable: it's where you **leave your own comments** explaining the tricky bits. Reviewers don't have the context that was in your head. Pre-empt their questions:

```text
(author's own comment on their diff)
note: I'm intentionally NOT caching this — the values change per-request
and a stale cache caused bug #4412. Left it uncached on purpose.
```

That one comment saves a back-and-forth where the reviewer says "should this be cached?", you explain, they agree, two days pass. You answered the question before it was asked.

**Respond to every comment.** When feedback comes in, reply to *each* comment — even if just `Done` or `Fixed in a1b2c3d`. A comment with no reply leaves the reviewer guessing: did you see it? Disagree? Forget? Three states, all bad. Closing the loop on every thread is what lets the reviewer re-review quickly and approve.

```text
Reviewer: question: what happens if `user` is nil here?
You:       Good catch — it'd panic. Added a guard + a test. Fixed in 9f3c1a2.

Reviewer: nit: rename `tmp` to something clearer?
You:       Done — `parsedConfig`.
```

**Don't take it personally — and push back when you're right.** Comments are about the *code*, not about you; a pile of feedback on a PR means people are engaging with your work, not that you're failing. And receiving feedback well does *not* mean obeying every comment. If you think a reviewer is wrong, say so — *with a reason*, the same standard you'd hold them to:

```text
Reviewer: suggestion: use a map here instead of a slice.
You:       I considered it, but order matters for the output and we only
           ever have ~5 items, so the slice scan is simpler and fast enough.
           Keeping the slice — let me know if you see a case I'm missing?
```

That's a healthy disagreement: reasoned, specific, open. The deeper skill of navigating a disagreement that *doesn't* resolve cleanly — when to escalate, how to keep it from getting personal — lives in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). The mechanical version: **respond to everything, push back with reasons, and remember it's the code under review, not you.**

> **Key insight:** **self-review first** is the habit that pays for itself ten times over. Every issue *you* catch in your own diff is one a reviewer doesn't spend attention on — which means they spend it on the things only a second pair of eyes can find. You're not just cleaning up; you're spending the reviewer's limited attention wisely.

---

## Real-World Examples

**1. The vague comment that wasted a week.** A reviewer left "this whole module feels off" on a 600-line PR and approved nothing. The author had no idea what to change, guessed, rewrote a chunk that was fine, and re-requested review — three round-trips over a week. When the reviewer finally got specific ("the `Service` struct does both HTTP parsing and DB writes — split those two responsibilities"), the fix took an hour. The lesson the team took: *vague feedback is slower, not kinder.* A reviewer who can't yet articulate the problem should say "I'll take another pass," not ship a feeling.

**2. The severity label that stopped a fight.** Two engineers kept clashing in reviews — every comment read as an attack. A team lead introduced Conventional Comments. Overnight, the friction dropped: when a comment was prefixed `nit:` the author could see it was offered lightly, and `blocking:` comments stopped feeling like personal jabs because they were obviously about correctness, not taste. Same people, same standards — the *labels* removed the ambiguity that the two were filling in with the worst interpretation.

**3. Self-review catching the embarrassing stuff.** A developer adopted one rule: never request review without reading their own diff first. On the very first PR they caught a hardcoded API key, two debug `print`s, and a function still named `doThingTEMP`. None of it reached a reviewer. Their review turnaround time dropped noticeably — not because reviewers got faster, but because the PRs arrived *clean*, so reviewers could focus on the actual logic instead of pointing at debris. (What reviewers focus on, and in what order, is [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md).)

---

## Mental Models

- **A comment is a to-do item, not a feeling.** Before you submit, ask: "Could the author act on this without asking me anything?" If not, you've written a feeling ("this is messy"), not a task ("extract the validation into its own function"). Rewrite until it's a task.

- **The severity label is the subject line.** Just as you scan email subject lines to triage your inbox, the author scans your `nit:` / `suggestion:` / `blocking:` prefixes to triage your comments. An unlabeled comment is an email with no subject — the author can't sort it, so it sits in "maybe important" purgatory.

- **The why is the seed; the fix is the fruit.** Give only the fix and you feed the author once. Give the *reason* and you teach them to grow their own fixes — you never have to write that comment again. A review full of unexplained fixes is a review you're doomed to repeat.

- **Self-review is the spell-check you run before sending.** You wouldn't email your manager without re-reading it. A PR is the same: read your own diff first and you'll catch the typos, the leftover debug lines, the half-finished thought — the cheap stuff — yourself, so the human reviewer can spend attention on the expensive stuff only they can catch.

---

## Common Mistakes

1. **Vague comments.** "This is confusing," "needs work," "I don't like this." They state a feeling and leave the author to invent the problem *and* the fix. Always name the exact spot, the concrete reason, and a concrete fix or question.

2. **No severity labels.** Without `nit:` / `suggestion:` / `blocking:`, the author can't tell required from optional and treats everything as equally heavy (or equally ignorable). Label every comment; it's the highest-leverage habit in reviewing.

3. **Decreeing without the why.** "Use a constant." "Don't do this." The author obeys and learns nothing, so you'll write the same comment next week. State the reason — that's the part that teaches.

4. **Commanding when you could ask.** "This is broken" is an accusation that's also embarrassing when *you're* the one who missed context. "What happens if X is nil?" teaches better and stays correct even when you're wrong.

5. **Reviews that are 100% criticism.** Zero praise trains authors to dread your name and to read every comment defensively. Call out the genuinely good things — it's information, not flattery.

6. **(Receiving) Not self-reviewing first.** Requesting review on a diff you haven't read yourself wastes a human's attention on debug logs, typos, and leftover TODOs you'd have caught in two minutes. Read your own diff first, every time.

7. **(Receiving) Leaving comments unanswered.** A thread with no reply leaves the reviewer guessing whether you saw it, disagreed, or forgot. Respond to *every* comment, even with just `Done`.

8. **(Receiving) Taking it personally — or obeying blindly.** Both are failures. It's the code under review, not you; *and* "receiving well" includes pushing back with a reason when you think a comment is wrong.

---

## Test Yourself

1. Rewrite this comment to be specific and actionable: *"This function is messy."* (Invent a plausible detail.)
2. You spot a SQL-injection hole built from string concatenation. Which severity label do you use, and why does the label matter as much as the words?
3. A reviewer writes "Use a map here." It's unlabeled. What two problems does the missing label cause for the author?
4. Why is "what happens if `user` is nil here?" often a *better* comment than "this is broken — `user` can be nil," even when you're certain there's a bug? Give two reasons.
5. What is self-review, and why is it called the highest-ROI habit on this page?
6. A reviewer leaves a `suggestion:` you genuinely disagree with. What's the *right* way to receive it — and what's the wrong way (in both directions)?

<details>
<summary>Answers</summary>

1. Example: *"`process()` does three things — parses the request, validates it, and writes to the DB. Could we split out `parseRequest` and `validate` so each is testable on its own? `suggestion:`, not blocking."* Names the exact problem (three responsibilities), gives a reason (testability), proposes a concrete fix, and labels severity.
2. **`blocking:`** — it's a real security hole and must not merge. The label matters because it tells the author *instantly* this is non-negotiable, before they read your reasoning or read tone into your phrasing; the same words without a label leave them guessing how serious it is.
3. (a) The author can't tell if it's **required or optional**, so they either over-correct on something trivial or ignore something important. (b) An unlabeled comment defaults, in the author's head, to **"maybe important?"** — the worst state, because they can't triage it against the other comments.
4. (1) It **teaches better** — the author does the reasoning and arrives at the bug themselves, so they own the fix and remember the pattern. (2) It's **safer for you** — if you turn out to be wrong (context you missed), a question stays correct, while "this is broken" makes you look careless. Bonus: it's easier to receive (not an accusation).
5. **Self-review** is reading your *own* diff, as if a stranger wrote it, *before* requesting review. Highest-ROI because every issue you catch (debug logs, typos, leftover TODOs, missing tests) is one a human reviewer doesn't have to spend attention on — freeing their limited attention for the deep issues only a second pair of eyes can find. It's also where you leave comments explaining your tricky decisions.
6. **Right:** reply with your reasoning and stay open — *"I considered a map, but order matters here and we only have ~5 items, so the slice is simpler — am I missing a case?"* **Wrong (direction 1):** silently ignore it, leaving the thread unanswered. **Wrong (direction 2):** blindly do it even though you think it's worse, just to avoid disagreement. Receiving well means responding *and* pushing back with reasons when warranted.

</details>

---

## Cheat Sheet

```text
GIVING — the five moves
  1. SPECIFIC   point to the exact spot + concrete fix (not "this is confusing")
  2. LABEL      prefix every comment with severity (the #1 habit)
  3. WHY        state the reason so the author learns, not just obeys
  4. ASK        prefer a question to a command ("what if X is nil?")
  5. SUGGEST    use code suggestions for trivial fixes; PRAISE the good

SEVERITY LABELS (Conventional Comments)
  nit:         tiny, optional — author may ignore
  suggestion:  consider this — author's call (but reply)
  question:    I don't understand — explain?
  issue:       real problem, should be addressed
  blocking:    MUST fix before merge  ← reserve for correctness/security
  praise:      something done well — say it!

FACTS vs PREFERENCES
  fact        a real bug / security / broken convention  → say plainly, often blocking
  preference  "I'd use a switch"                          → nit:/suggestion:, let it go

RECEIVING — the four moves
  1. SELF-REVIEW FIRST   read your own diff before requesting review (highest ROI)
  2. EXPLAIN tricky bits  leave your own comments pre-empting questions
  3. RESPOND to every comment (even just "Done")
  4. PUSH BACK with reasons when you're right; it's the code under review, not you

CODE SUGGESTION (GitHub) — one-click apply for the author
  ```suggestion
  the exact replacement code goes here
  ```
```

---

## Summary

- A review comment has **two jobs**: improve the code *and* teach. Doing only the first (fix with no reason) does half the job.
- **Be specific and actionable.** The test: could the author act on it without a follow-up question? "Rename `d` to `daysElapsed`" beats "this is confusing" every time.
- **Label severity** with Conventional Comments (`nit:`, `suggestion:`, `question:`, `blocking:`, `praise:`). This one habit lets the author tell required from optional at a glance — it's the highest-leverage move in reviewing.
- **Give the why** (so they learn it once, not endure it forever) and **ask instead of command** (a question teaches better and is safe even when you're wrong).
- **Suggest code** for trivial fixes (one-click apply) and **praise** the good — praise is information about which instincts to keep, not flattery. And separate **facts** (real bugs) from **preferences** (your style).
- **Receiving:** **self-review first** (the highest-ROI habit — catch your own debris), **respond to every comment**, and **push back with reasons** when you disagree. It's the code under review, not you.

The deep interpersonal layer — empathy, mentorship, handling a disagreement that's turned tense — is real, and it lives in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). Everything on *this* page is the mechanical foundation underneath it: techniques you can apply on autopilot, starting with your next comment.

---

## Further Reading

- [Conventional Comments](https://conventionalcomments.org) — the small standard for labeling comments by type and severity. Bookmark it; it's a five-minute read that changes how you review.
- [Google Engineering Practices — *How to write code review comments*](https://google.github.io/eng-practices/review/reviewer/comments.html) — the industry-standard short guide: be kind, explain reasoning, give guidance not just problems.
- [Michael Lynch — *How to Do Code Reviews Like a Human*](https://mtlynch.io/human-code-reviews-1/) — the best essay on the *feel* of feedback: phrasing, ego, and never saying "you."
- The [middle.md](middle.md) of this topic, which goes deeper into reviewer-author dynamics, calibrating severity across a team, and giving structured feedback at scale.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/junior.md) — *what* you're commenting on; this page is *how* you phrase it.
- [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md) — a small PR makes specific, useful feedback possible; a giant one makes it impossible.
- [08 — Review Anti-patterns](../08-review-anti-patterns/junior.md) — the failure modes: vague comments, unlabeled severity, preference-as-fact, nitpick storms.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the interpersonal layer: tone, empathy, mentorship, and handling disagreement.
- [Static Analysis & Linting](../../static-analysis/) — let tools catch the style nits automatically, so your comments are spent on what only a human can see.
