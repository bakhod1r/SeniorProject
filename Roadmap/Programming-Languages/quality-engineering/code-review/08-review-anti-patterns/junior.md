# Review Anti-patterns — Junior Level

> **Roadmap:** [Code Review](../README.md) → Review Anti-patterns
> *Most bad code reviews aren't malicious — they're a good intention pointed at the wrong target. This page is a field guide to the seven most common ways review goes wrong, so you can spot them in your own comments before you hit "submit."*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concept 1 — Bikeshedding](#core-concept-1--bikeshedding)
5. [Core Concept 2 — Rubber-Stamping](#core-concept-2--rubber-stamping)
6. [Core Concept 3 — Blocking on Personal Preference](#core-concept-3--blocking-on-personal-preference)
7. [Core Concept 4 — The Nitpick Pile-On & Ego Comments](#core-concept-4--the-nitpick-pile-on--ego-comments)
8. [Core Concept 5 — Scope Creep](#core-concept-5--scope-creep)
9. [Core Concept 6 — The Slow / Ghost Reviewer](#core-concept-6--the-slow--ghost-reviewer)
10. [Core Concept 7 — Gatekeeping](#core-concept-7--gatekeeping)
11. [Real-World Examples](#real-world-examples)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What does a *bad* review look like, and how do I avoid being the reviewer who causes it?**

You already know *how* to review code — you read the diff, you leave comments, you approve or request changes. This page is about the failure modes: the specific, repeatable ways a review goes sideways even when everyone means well.

Here is the thing nobody tells you early on: almost every review anti-pattern is the same mistake wearing a different costume. It's **forgetting what review is for**. Review exists for one reason — to help ship good code. Not to win an argument about tab width. Not to prove you're the smartest person on the team. Not to be a checkpoint that makes you feel important. The moment a comment stops serving "ship good code" and starts serving "be right" or "look busy" or "guard the gate," you've wandered into an anti-pattern.

The seven patterns below are the usual suspects. For each one you'll get the name, a concrete example you'll recognize, *why it hurts the team*, and the fix. None of them require seniority to avoid — they require **noticing**. A junior who never bikesheds and never rubber-stamps is already a better reviewer than a senior who does both out of habit.

> **Mindset shift:** A code review is a **collaboration to ship good code** — not a contest you win, a style war you fight, or a rubber stamp you apply. Two people are on the same side of the table looking at the change together. Almost every anti-pattern on this page comes from forgetting that and treating review as something *done to* the author instead of *with* them. Hold that frame and most of these mistakes evaporate.

---

## Prerequisites

- **Required:** You've left comments on a pull request and approved or requested changes at least once. (You don't need to be good at it yet — that's the point.)
- **Required:** You know what a pull request (PR) / merge request is and what "approve," "request changes," and "comment" do.
- **Helpful:** You've *received* a review that frustrated you. (That feeling is data — it usually means a reviewer hit one of these anti-patterns on you.)
- **Helpful:** You've used a linter or auto-formatter (Prettier, gofmt, Black, ESLint). It matters here because tooling makes a whole category of anti-patterns disappear.

---

## Glossary

| Term | Plain-English meaning |
|---|---|
| **PR / MR** | Pull request / merge request — a proposed code change waiting to be reviewed and merged. |
| **LGTM** | "Looks Good To Me" — shorthand approval. Healthy when you *did* look; dishonest when you didn't. |
| **Bikeshedding** | Arguing about trivial, easy-to-have-an-opinion-on details while ignoring the hard, important ones. |
| **Rubber-stamping** | Approving without actually reading the code. |
| **Nit / nitpick** | A tiny, low-importance comment (a typo, a slightly better name). Fine in small doses; harmful in a pile. |
| **Scope creep** | A PR (or a review) growing beyond its original, focused purpose. |
| **Ghost reviewer** | A reviewer who's been asked but never responds, leaving the author blocked. |
| **Gatekeeping** | Using review as a checkpoint to control or exclude others, rather than to improve the code. |
| **Blocking** | Marking a PR as "request changes," which prevents it from merging until you're satisfied. |
| **Optional / non-blocking comment** | A suggestion the author may ignore; it does *not* hold up the merge. |

---

## Core Concept 1 — Bikeshedding

**Bikeshedding** is spending your review energy on trivial things that are easy to have an opinion about — naming, spacing, comment wording, where the braces go — while the actual substance of the change (Is the logic correct? Is the design sound? Is there a security hole?) gets a glance or nothing at all.

The name comes from a story: a committee meant to approve a nuclear power plant breezes through the reactor design (too complex for anyone to second-guess) but spends hours debating the color of the bike shed out back (everyone has an opinion, the stakes feel safe). The hard, important thing gets rubber-stamped; the trivial thing gets a war.

Here's bikeshedding in the wild — a real review thread on a payments change:

```text
PR: "Add retry logic to the payment-capture call"

reviewer: nit: can we call this `numRetries` instead of `retryCount`?
reviewer: nit: I'd prefer single quotes here to match the rest of the file
reviewer: should this comment end with a period?
reviewer: blank line between these two blocks please

[no comment on: the retry loop has no maximum delay and could
 hammer the payment provider during an outage]
```

Four comments, zero about the part that could take down payments. That last bracketed line is the review that *mattered* and it never happened — the reviewer's attention got eaten by the bike shed.

The harm: the important risk ships unreviewed, the author wastes a cycle on cosmetic changes, and everyone *feels* like a review happened when it didn't. Bikeshedding is dangerous precisely because it's productive-looking.

> **Key insight:** Style opinions are cheap and infinite — everyone has them and they never run out, which is exactly why they expand to fill all your attention. Substance is scarce and hard. If you catch yourself with strong feelings about quote style and no feelings about the logic, you're in the bike shed. Climb out.

**The fix:** Let machines own style. A formatter (Prettier, gofmt, Black) and a linter should decide quotes, spacing, and braces — automatically, on every commit, with zero human debate. Once the tooling owns style, those comments become *impossible to make*, which frees your entire attention for the things only a human can judge: is this correct, is it well-designed, is it safe? (This is why [Static Analysis & Linting](../../static-analysis/) is the single biggest anti-bikeshedding tool you have.)

---

## Core Concept 2 — Rubber-Stamping

**Rubber-stamping** is approving a PR without actually reading it. You see the notification, you trust the author, you click "Approve," you move on. The approval is real; the review is theatre.

```text
[PR opened 9:02 — 14 files changed, +480 −60]
[Approved 9:03 — "LGTM "]
```

A 540-line change reviewed in 60 seconds is not reviewed. **LGTM** ("Looks Good To Me") is meant to mean "I looked, and it's good." When you didn't look, it's a small lie that the rest of the team relies on.

The harm is direct: bugs sail straight through. Your approval told everyone "a second pair of eyes checked this" — so nobody else checks it either. The whole point of review is the *independent* second look, and rubber-stamping removes it while leaving the paperwork that says it happened. When the bug surfaces in production, the trail shows your approval on it.

There's a quieter harm too. Rubber-stamping is contagious: if approvals are known to be meaningless, authors stop trusting them, and the team's whole quality signal degrades into noise.

> **Key insight:** If you approve it, you own it. Your name on the approval means "I stand behind this merging." That's not bureaucracy — it's the entire value of review. An approval you didn't earn is worse than no approval, because it *looks* like safety while providing none.

**The fix:** Review properly, or say you can't. If you genuinely don't have time, that's a legitimate thing to say: *"I can't get to this until tomorrow"* or *"I don't know this area well enough to approve — can you add someone from the auth team?"* Both are honest and helpful. What's not okay is the silent rubber stamp. And if the PR is too big to review properly in a reasonable sitting, that's not your failure — it's a sign the PR is too big, which points straight at [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md).

---

## Core Concept 3 — Blocking on Personal Preference

**Blocking on personal preference** is using "request changes" to hold up a perfectly correct, perfectly reasonable PR because *you* would have written it differently. Not because it's wrong — because it's not how you'd do it.

```text
author's code:
    const active = users.filter(u => u.isActive);

reviewer: I'd use a for-loop here instead of .filter().
          Requesting changes.
```

The author's code is correct, readable, and idiomatic. The reviewer's preference for a for-loop is just that — a preference. But it's attached to a *block*, so now a good change can't merge until the author either argues back or caves and rewrites working code to suit someone's taste.

The harm: you've converted a difference in style into a roadblock. The author is now stuck, the change is delayed, and — worse — they've learned that getting code merged means guessing each reviewer's personal aesthetic. That's exhausting and it slows the whole team down. Multiply it across a team and "blocking on taste" becomes one of the biggest hidden drags on delivery (the kind of thing measured in [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/junior.md)).

> **Key insight:** "I would have written it differently" is not a defect. There are usually several correct, reasonable ways to write any piece of code. Your job as a reviewer is to catch the code that's *wrong* or *unreasonable* — not to enforce the one version that lives in your head.

**The fix:** If the code is correct and reasonable, approve it. If you have a genuinely better approach, offer it as an explicit **suggestion**, not a block: *"Optional: a `.filter()` here might read a bit cleaner — totally your call."* Preference is a suggestion the author can take or leave; reserve "request changes" for things that are actually wrong (bugs, security issues, broken design, missing tests for risky logic). The test is simple: *"If I imagine this merging exactly as written, is anything actually broken?"* If no, don't block.

---

## Core Concept 4 — The Nitpick Pile-On & Ego Comments

A **nit** (nitpick) is a tiny, low-stakes comment: a typo, a marginally better variable name, an extra blank line. One or two nits, clearly labelled as optional, are fine and even helpful. The anti-pattern is the **pile-on**: burying the author under twenty of them, so a small PR comes back looking like it failed an exam in red ink.

Closely related are **ego comments** — comments whose real purpose is to show off how much the reviewer knows, rather than to improve the code.

```text
[PR: a 30-line bug fix. Review returns 23 comments:]

reviewer: nit: rename `i` to `index`
reviewer: nit: this could be a ternary
reviewer: nit: extra space here
reviewer: nit: prefer `const` over `let`
reviewer: Actually, the *real* way to do this is with a monad. When I
          worked at [BigCo] we always... [three paragraphs]
reviewer: nit: alphabetize these imports
... (18 more)
```

The bug fix was fine. But the author opens this and feels buried, judged, and a little humiliated — for a 30-line change. That last comment isn't even about their code; it's the reviewer performing expertise.

The harm is mostly human, and it's serious. Authors who get pile-ons start to dread review, post smaller and rarer PRs, or quietly route around the pile-on reviewer. Morale drops, and over time so does the willingness to share work openly — which is poison for a team. Ego comments add humiliation on top, teaching people that asking for review means exposing yourself to a lecture.

> **Key insight:** The *count* and *tone* of comments are a message in themselves, separate from their content. Twenty nits says "your work is riddled with problems" even when each one is trivial. Be deliberate about the signal you're sending, not just the individual points you're making.

**The fix:** Three habits. **(1) Label nits as optional** — prefix them `nit:` or `optional:` so the author knows they don't block and can batch them or skip them. **(2) Don't pile on** — if there are ten cosmetic things, mention the pattern once (*"a few naming nits throughout — optional, up to you"*) instead of ten separate red marks; better yet, let the linter catch them. **(3) Be kind, and review the code, not the person** — never make a comment whose purpose is to show off. If a comment doesn't help the code get better, don't post it. (The craft of *how* to phrase this lives in [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md).)

---

## Core Concept 5 — Scope Creep

**Scope creep** in review is the "while you're in there..." comment — asking the author to fix, refactor, or add something beyond what the PR set out to do.

```text
PR: "Fix typo in the login error message"

reviewer: While you're here, can you also refactor this whole
          auth module? It's been bugging me for a while.
          And maybe add the 'remember me' feature too?
```

The PR fixed a one-word typo. The reviewer just tried to turn it into a multi-day refactor and a new feature. Each request might be reasonable *on its own* — the auth module may well need work — but bolting them onto an unrelated PR is the problem.

The harm: a small, safe, fast-to-merge change balloons into a big, risky, slow one. The author either says no (awkward) or says yes and watches their quick fix become a week-long detour. The diff grows, the review gets harder, the risk goes up, and the original simple change is held hostage to a bunch of unrelated work. Big PRs are harder to review well — which loops right back to rubber-stamping and pile-ons.

> **Key insight:** "While you're here" is the most expensive phrase in code review. Each addition feels small in the moment, but scope is a ratchet — it only ever clicks *bigger*. A focused PR that does one thing is a gift to everyone, including future-you reading the git history.

**The fix:** Keep the PR focused on its stated job. If you spot something else worth doing — even something genuinely important — **file a separate issue or ticket** and link it: *"Noticed the auth module could use a refactor — I'll file a ticket so we track it properly. Not for this PR."* That way the good idea isn't lost, the current PR stays small and mergeable, and the new work gets its own focused review. Small, single-purpose PRs are a whole topic on their own — see [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md).

---

## Core Concept 6 — The Slow / Ghost Reviewer

The **ghost reviewer** is assigned to a PR and then... vanishes. Hours pass, then a day, then two. The author is blocked, pinging politely, getting nothing back. The review never happens, or happens so late it's almost useless.

```text
Mon 10:00  author: opened PR, requested review from @reviewer
Mon 16:00  author: "hey, gentle bump on this when you get a sec "
Tue 11:00  author: "still blocked on this one if you have time "
Wed         author: [gives up, asks someone else, momentum lost]
```

The harm is sneaky because it's *invisible in the code* — the diff is perfect; the problem is the silence. A blocked PR means the author can't move on (their next task may depend on this one merging), the change goes stale (other people's merges create conflicts), and they're left context-switching and nagging instead of building. One slow reviewer can be the bottleneck for an entire team's flow. Worst case, the author works around you by grabbing whoever's fastest — which quietly trains the team to route important changes to whoever rubber-stamps quickest.

> **Key insight:** A pending review is a *teammate who can't move*. The cost of a slow review isn't just your time — it's all the work waiting downstream of that merge. Reviewing promptly is one of the cheapest, highest-leverage things you can do for your team's velocity, and it costs you almost nothing but attention.

**The fix:** Treat review as real work, not an interruption you'll get to "later." Review promptly — a common healthy norm is *within one working day*, and faster for small PRs. You don't have to drop everything the instant a PR lands, but you do owe a timely response. If you truly can't get to it soon, **say so and hand it off**: *"Swamped today — @other-reviewer, can you take this one?"* A quick handoff unblocks a teammate; silence strands them. (How teams measure and tune this — review latency, time-to-first-review — is [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/junior.md).)

---

## Core Concept 7 — Gatekeeping

**Gatekeeping** is using review as a position of power rather than an act of help — treating the approve button as a way to feel important, to make others prove themselves to *you*, or to keep certain people (newcomers, juniors, people outside your clique) from contributing.

```text
author (new hire, week 2): opens a small, correct PR

reviewer: I don't think you understand how we do things here.
          Read the entire codebase first, then come back.
          (No specific feedback. No path forward. Just "no.")
```

There's no actionable feedback here — no bug named, no fix suggested. The message isn't "here's how to make this better," it's "you don't belong yet, and I decide when you do." The reviewer is guarding a gate, and the gate is the point.

The harm runs deep. Gatekeeping crushes new contributors, who learn that contributing means being made to feel small. It concentrates knowledge and power in a few people (the opposite of what review is *for* — spreading knowledge). It makes the codebase feel like private property rather than a shared thing the team owns together. And it's often invisible to management because, on paper, the gatekeeper is "maintaining high standards." Real standards come with *specific, actionable feedback*; gatekeeping comes with vague disapproval and a closed door.

> **Key insight:** The approve button is a tool for shipping good code, not a throne. The moment review becomes about *your* status — proving you're the guardian, making people earn your blessing — it stops serving the code and starts serving your ego. Good reviewers open doors; gatekeepers guard them.

**The fix:** Review to *help good code ship and to help the author grow* — full stop. If something's wrong, name it specifically and show the path forward. If someone's new, that's a reason to be *more* welcoming and concrete, not less. Ask yourself before posting: *"Is this comment helping the code get better and the author get better — or is it about me?"* If it's about you, delete it. Standards and kindness aren't opposites; the best reviewers have both. (The human side of this — mentorship, tone, navigating disagreement — is covered in [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/).)

---

## Real-World Examples

**1. The semicolon war that shipped a race condition.** A team without an auto-formatter spent a PR's entire review thread debating semicolon style and import ordering — fourteen comments. The change also introduced a concurrency bug that nobody examined, because all the attention went to the bike shed. It shipped, paged someone at 3 a.m., and the post-mortem's first action item was "add Prettier so we never argue about this again." The fix for the bug was, in the end, *tooling that ends the bikeshedding* — letting humans look at the parts a formatter can't.

**2. The approval with someone else's name on the outage.** A senior rubber-stamped a junior's 600-line PR in two minutes — "LGTM, ship it." A null-pointer bug in it took the checkout flow down for an hour. The git blame and the approval log both pointed at the senior. The lesson the team took wasn't "punish the senior," it was "if you approve it, you own it" — and "600-line PRs are too big to review honestly," which sent them straight to splitting PRs smaller.

**3. The ghost that became a bottleneck.** One engineer was the only reviewer for a critical service, and they treated reviews as something to do "when there's time" — which was never. PRs sat for days. The team's throughput quietly collapsed; everything was blocked on one person's queue. The fix wasn't heroics, it was *spreading review duty* and setting a "first response within a day" norm — turning one ghost into several responsive reviewers.

---

## Mental Models

- **The bike shed test.** Before you post a comment, ask: *"Am I commenting on this because it's important, or because it's easy to have an opinion about?"* Trivial-but-easy is the bike shed. Hard-but-important is the reactor. Spend your attention on the reactor.

- **"If you approve it, you own it."** Picture your name next to the bug in the post-mortem. That's literally what an approval means. It reframes the lazy LGTM as what it is: signing your name to something you didn't read.

- **The block test.** Before clicking "request changes," ask: *"If this merged exactly as written, would anything actually be broken?"* If no, it's a preference — downgrade it to an optional suggestion and approve.

- **The mirror question for ego/gatekeeping.** Before posting, ask: *"Is this about the code, or about me?"* Showing off, scoring points, guarding the gate — all fail this test. If the comment doesn't make the code or the author better, it shouldn't exist.

- **A pending review is a stuck teammate.** Don't picture a diff sitting in a queue; picture a person sitting on their hands, unable to start their next task until you respond. That image makes "I'll get to it later" feel as expensive as it actually is.

- **"While you're here" is a ratchet.** Scope only ever clicks bigger, never smaller. Every "could you also..." tightens it. Protect the focused PR; file the extra idea as its own ticket.

---

## Common Mistakes

1. **Treating style comments as part of "thorough" review.** Debating quotes and spacing isn't thoroughness, it's bikeshedding. Real thoroughness is examining logic, design, edge cases, and safety. Hand style to the linter so it stops stealing your attention.

2. **Approving to be nice (or to be fast).** A rubber stamp isn't a kindness — it's a quiet betrayal of everyone who trusts your approval to mean something. If you can't review it properly, say so; don't fake it.

3. **Blocking because "I'd do it differently."** Several correct ways usually exist. Reserve "request changes" for things that are actually wrong; turn preferences into clearly-optional suggestions.

4. **Posting every nit you notice.** Twenty red marks on a small PR demoralizes the author regardless of how trivial each one is. Label nits optional, batch them, or let tooling handle them — and never pile on.

5. **Saying "while you're here..."** You just tried to grow the PR. File a separate ticket for the extra work and keep this change focused on its one job.

6. **Letting a review sit because you're "busy."** The author is blocked the entire time, and their downstream work with them. Review promptly or hand it off; silence is the expensive option.

7. **Using vague disapproval instead of actionable feedback.** "This isn't good enough" with no specifics is gatekeeping, not reviewing. Name the problem, show the fix, open the door — especially for newcomers.

8. **Forgetting you're on the same side as the author.** Every anti-pattern here traces back to treating review as something done *to* the author. You're collaborators trying to ship good code together; act like it.

---

## Test Yourself

1. Define **bikeshedding** in one sentence, and name the single most effective tool for preventing it in code review.
2. What does **LGTM** mean, and when is typing it dishonest?
3. A reviewer writes: "This works, but I'd have used a for-loop instead of `.map()`. Requesting changes." Which anti-pattern is this, and what should the reviewer do instead?
4. You're reviewing a 20-line bug fix and you notice eight tiny cosmetic things plus one piece of genuinely confusing logic. How do you handle the eight, and how do you handle the one?
5. On a PR titled "Fix typo in README," you think the whole docs folder needs reorganizing. What do you do — and what do you *not* do?
6. A teammate's PR has been waiting for your review for two days and they're blocked on it, but you genuinely have no time today. What's the honest, helpful move?
7. What's the one question that catches most ego comments and gatekeeping before you post them?
8. Finish the sentence and explain it: "If you approve it, you ____."

<details>
<summary>Answers</summary>

1. **Bikeshedding** is arguing about trivial, easy-to-have-an-opinion-on details (naming, spacing, braces) while the important, hard stuff (correctness, design, security) goes unexamined. The most effective preventer is an **auto-formatter + linter** that owns style automatically, removing the temptation entirely. See [Static Analysis & Linting](../../static-analysis/).
2. **LGTM** = "Looks Good To Me." It's dishonest when you type it *without actually reading the code* — it tells the team a second pair of eyes checked the change when none did.
3. **Blocking on personal preference.** The code works; a for-loop-vs-`.map()` choice is taste, not a defect. The reviewer should **approve** and, if they care, leave it as an *optional* suggestion (`optional: a for-loop might read cleaner — your call`) rather than blocking.
4. The **eight cosmetic things**: don't post them as eight separate comments (that's a pile-on). Mention the pattern once as optional, or let the linter handle them, or skip them. The **one confusing piece of logic**: that's the substance — comment on it clearly and specifically, since it's the whole reason the review matters.
5. **File a separate issue/ticket** for the docs reorganization and link it so the idea isn't lost. **Do not** ask the author to do it in this PR — that's scope creep; keep the typo fix focused and mergeable. See [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md).
6. Say so and **hand it off**: e.g., *"Sorry I've been slow — I'm swamped today; @other-reviewer, could you take this one?"* That unblocks them immediately. The wrong move is continued silence (ghosting) or a guilty rubber stamp.
7. *"Is this comment about the code, or about me?"* If it's about you — showing off, scoring points, guarding a gate — don't post it.
8. "If you approve it, you **own it**." Your approval is your name standing behind the change shipping; if it breaks, the trail leads to you. That's exactly why a review you didn't actually do is worse than no review.

</details>

---

## Cheat Sheet

```text
THE SEVEN ANTI-PATTERNS  →  THE FIX

1. BIKESHEDDING            arguing trivia (names, spaces, braces),
   (trivia over substance) ignoring logic/design/security
   FIX: let the formatter+linter own style; review what only humans can

2. RUBBER-STAMPING         "LGTM" without reading; review is theatre
   FIX: if you approve it, you OWN it — review properly or say you can't

3. BLOCKING ON PREFERENCE  "I'd write it differently" used to block good code
   FIX: correct + reasonable = approve; preference is a SUGGESTION, not a block

4. NITPICK PILE-ON / EGO   20 tiny demands; showing off
   FIX: label nits optional, don't pile on, be kind, review code not person

5. SCOPE CREEP             "while you're here, also fix X..."
   FIX: file a separate ticket; keep the PR focused on ONE thing

6. SLOW / GHOST REVIEWER   never gets to it; teammate stays blocked
   FIX: review promptly (≈1 day) or hand it off; a pending review = stuck person

7. GATEKEEPING             review as power trip / keeping others out
   FIX: review to help ship + help the author grow; open doors, don't guard them

THREE QUESTIONS THAT CATCH MOST OF THESE
  • Bike shed test:  important, or just easy to opine on?
  • Block test:      if this merged as-is, is anything actually broken?
  • Mirror test:     is this comment about the code, or about me?

THE META-LESSON
  Review = COLLABORATION to ship good code.
  Not a contest. Not a style war. Not a stamp.
  Most anti-patterns = forgetting that.
```

---

## Summary

- A code review is a **collaboration to ship good code** — not a contest, a style war, or a rubber stamp. Almost every anti-pattern below is the same root mistake: forgetting that.
- **Bikeshedding** — arguing trivia (naming, spacing, braces) while ignoring substance. *Fix:* let the formatter and linter own style so your attention goes to logic, design, and safety.
- **Rubber-stamping** — approving without reading; the review becomes theatre and bugs sail through. *Fix:* if you approve it, you own it — review properly or honestly say you can't.
- **Blocking on personal preference** — using "request changes" on correct, reasonable code just because you'd do it differently. *Fix:* approve it; downgrade preferences to optional suggestions.
- **Nitpick pile-on & ego comments** — burying the author in trivia or showing off. *Fix:* label nits optional, don't pile on, be kind, and review the code, not the person.
- **Scope creep** — "while you're here, also fix X." *Fix:* file a separate ticket and keep the PR focused on one thing.
- **The slow / ghost reviewer** — never getting to the PR, leaving a teammate blocked. *Fix:* review promptly or hand it off; a pending review is a stuck person.
- **Gatekeeping** — review as a power trip or a way to keep others out. *Fix:* review to help good code ship and help the author grow; open doors rather than guard them.

Two structural forces dissolve a huge share of these: **tooling** (a linter and formatter kill bikeshedding and most nits) and **small PRs** (focused, reviewable changes prevent rubber-stamping, pile-ons, and scope creep). Get those two right and you've avoided most of this page before you ever write a comment.

---

## Further Reading

- [Google Engineering Practices — *Code Review Developer Guide*](https://google.github.io/eng-practices/review/) — the reference for what a healthy reviewer actually does; read "The Standard of Code Review" and "Speed of Code Reviews."
- Michael Lynch — [*How to Do Code Reviews Like a Human*](https://mtlynch.io/human-code-reviews-1/) — a two-part essay that names many of these anti-patterns and shows kinder alternatives; the single best read for a junior here.
- The origin of **"bikeshedding"** — C. Northcote Parkinson's *Law of Triviality* (the bike-shed-vs-reactor story). A quick search for "Parkinson's law of triviality" gives the original; it explains *why* we gravitate to the trivial.
- The [middle.md](middle.md) of this topic, which goes deeper on the team-level dynamics — how these anti-patterns compound, how to set norms and tooling that prevent them, and how to push back when you're on the receiving end.

---

## Related Topics

- [05 — Giving & Receiving Feedback](../05-feedback-giving-and-receiving/junior.md) — *how* to phrase comments kindly and usefully, which prevents the pile-on and ego anti-patterns.
- [02 — PR Scope & Size](../02-pr-scope-and-size/junior.md) — small, focused PRs structurally prevent rubber-stamping and scope creep.
- [07 — Review Metrics & Tempo](../07-review-metrics-and-tempo/junior.md) — how teams measure review latency so the slow/ghost reviewer becomes visible and fixable.
- [Static Analysis & Linting](../../static-analysis/) — let machines own style; the single biggest cure for bikeshedding and nit pile-ons.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the human side: tone, mentorship, and navigating disagreement without gatekeeping.
