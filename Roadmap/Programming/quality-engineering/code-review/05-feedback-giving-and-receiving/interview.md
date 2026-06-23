# Giving & Receiving Feedback — Interview Level

> **Roadmap:** [Code Review](../README.md) → Giving & Receiving Feedback
> *A feedback interview rarely asks "is code review good." It hands you a real comment — "this is wrong, fix it" — and watches whether you can rewrite it into something specific, actionable, and labeled; then it tells you the author disagrees with your blocking comment and watches whether you reach for data or for authority. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [How to Use This Page](#how-to-use-this-page)
4. [Giving Feedback](#giving-feedback)
5. [Receiving Feedback](#receiving-feedback)
6. [Resolving Disagreement](#resolving-disagreement)
7. [Mentoring & Calibration](#mentoring--calibration)
8. [Scenarios](#scenarios)
9. [Rapid-Fire](#rapid-fire)
10. [Red Flags / Green Flags](#red-flags--green-flags)
11. [Cheat Sheet](#cheat-sheet)
12. [Summary](#summary)
13. [Further Reading](#further-reading)
14. [Related Topics](#related-topics)

---

## Introduction

Most engineers can spot a bug in a diff. Far fewer can write the comment that gets the bug fixed *without* leaving the author defensive, and fewer still can tell the difference between a comment they should block on and one they should let go. That gap — between *finding* an issue and *communicating* it so it gets resolved cheaply — is what a feedback interview probes. It is also where a lot of senior signal lives, because the failure modes (the reviewer who blocks on everything, the author who argues every nit, the thread that hits round twelve) are invisible in a code sample and only show up in how you talk about the *exchange*.

This page is the question bank for that exchange. The questions cluster around four ideas that nearly every answer returns to:

- **Specific + actionable + rationale** — a good comment names the exact line, says what to do, and explains *why*; a bad one is a vague verdict.
- **Fact vs preference** — block on defects (correctness, security, data loss); defer on taste (naming, style the linter doesn't catch).
- **Author is right by default on taste** — on reversible, preference-level calls, the person doing the work decides; the reviewer advises.
- **Signal preservation** — when everything is "blocking," nothing is; severity labels exist to keep the *important* comments findable.

Internalize those four and most of the bank answers itself. The candidates who do well name the principle before they reach for a phrasing.

> **The line for this page:** this is the *mechanics* of feedback — comment structure, severity labels, disagreement resolution, calibration. The deep work on tone, empathy, psychological safety, and interpersonal conflict belongs to [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/). We will name that boundary where it matters and not pretend to cover it here.

---

## Prerequisites

You will get more out of these questions if you are comfortable with:

- **The review's purpose** — that review is about correctness, maintainability, and knowledge-sharing, not gatekeeping. See [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md).
- **PR scope** — small PRs are easier to give good feedback on; a 2,000-line PR makes every comment worse. See [02 — PR Scope & Size](../02-pr-scope-and-size/interview.md).
- **What a linter already owns** — feedback about formatting and import order is wasted human attention if a tool can enforce it. See [Static Analysis & Linting](../../static-analysis/).
- **The author/reviewer roles** — that the author owns the change and the reviewer is an advisor with a veto reserved for real defects, not a co-author who must approve of every choice.

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the phrasings — internalize the *moves*:

- **Label severity** so the author knows what's a veto and what's a thought.
- **Separate fact from preference** so you block on the right things.
- **Default to the author** on taste, escalate on principle, switch to synchronous after a couple of round-trips.
- **Calibrate depth** to who you're reviewing and protect the consistency of the bar across reviewers.

Nearly every question is one of those moves wearing a scenario. The strongest signal is naming the move out loud.

---

## Giving Feedback

### Q: What makes a code review comment good versus useless?

> **Testing:** Whether you have an explicit model of comment quality, or you just "leave comments."

**A.** A good comment is **specific, actionable, and carries its rationale**. Specific: it points at the exact line or construct, not "the error handling." Actionable: it tells the author what they could *do*, or asks a question that leads somewhere, rather than rendering a verdict. Rationale: it says *why* — the failure mode, the principle, the future maintainer — because the "why" is what lets the author generalize and what makes the comment persuasive instead of an order.

A useless comment fails one of those. "This is wrong" — not actionable, no rationale. "I don't like this" — pure preference with no why. "Refactor this" — actionable-ish but no target and no reason. Compare:

> ❌ "This is fragile."
>
> ✅ "If `items` is empty, `items[0]` panics here — and an empty cart is a normal state, not an error. Guard it with `if len(items) == 0 { return ... }` before the index."

The second names the input that breaks it, the consequence (panic), why it's realistic (empty cart is normal), and the fix. The author can act on it in ten seconds and learns the lesson.

A fourth property I'd add: **ask, don't tell**, where appropriate. "What happens if `cfg` is nil here?" invites the author to discover the bug and often surfaces context I lacked ("it's guaranteed non-nil by the caller — here's the invariant"). It's not softer for softness's sake; it's that a question is frequently more *correct* than an assertion, because the reviewer doesn't have full context.

### Q: What are Conventional Comments / severity labels, and why do they matter?

> **Testing:** Whether you know that *unlabeled* feedback is the root of most review friction.

**A.** Severity labels are a tiny convention where every comment is prefixed with its *type and weight*, so the author instantly knows whether it's a veto or a passing thought. The Conventional Comments scheme is the common vocabulary:

| Label | Meaning | Blocks merge? |
|---|---|---|
| `praise:` | Genuinely good — call it out | No |
| `nit:` | Trivial, take it or leave it | No |
| `suggestion:` | A real improvement, author's call | Usually no |
| `question:` | I don't understand / need context | Only if the answer reveals a defect |
| `issue:` / `blocking:` | A defect that must change before merge | Yes |
| `chore:` | A required mechanical task (changelog, etc.) | Usually yes |

Why they matter: **without a label, the author has to guess the weight of every comment, and they guess wrong in the expensive direction** — either treating a nit as a blocker (wasted rework) or a blocker as a nit (shipped bug). A `nit:` prefix lets the author merge without addressing it and feel fine; a `blocking:` prefix tells them exactly what stands between them and merge. The label converts an ambiguous pile of comments into a sorted to-do list. It also disciplines *me* as the reviewer: if I have to type `blocking:`, I think twice about whether it really is.

> The cost of no labels is silent: the author over-serves trivia to be safe, the review takes three extra round-trips, and the *real* blocker gets the same visual weight as a missing comma.

### Q: How do you decide whether to block a PR on a comment or just suggest?

> **Testing:** The fact-vs-preference distinction — the single most important judgment in giving feedback.

**A.** I separate **facts from preferences**. A *fact* is something demonstrably wrong: it's a correctness bug, a security hole, a data-loss path, a broken contract, a race, a resource leak, a missing test for new behavior. Facts block — there's a right answer and the code is on the wrong side of it. A *preference* is a judgment call where reasonable engineers disagree: naming, structure the code is fine without, "I'd have used a map here," style the linter doesn't enforce. Preferences don't block — they're `suggestion:` or `nit:`, and the author decides.

The test I apply: *"Can I name the concrete harm if this ships unchanged?"* If yes — "this query is O(n) per request and n is unbounded user input" — it blocks. If the honest answer is "it's not how I'd write it," that's preference; I say so and move on. Blocking on preference is the fastest way to turn review into a power struggle and to train authors to stop sending you PRs.

The corollary, which is the differentiator: **on preference, the author is right by default.** They own the change, the call is reversible, and my taste is not a defect in their code.

### Q: What's a code suggestion and when should you use one?

> **Testing:** Whether you minimize the author's cost to act on feedback.

**A.** A suggestion block (GitHub/GitLab's `suggestion` syntax) is a comment that contains the *exact replacement code*, which the author can apply with one click. I use it whenever the fix is small and unambiguous — a guard clause, a rename, a corrected condition, a typo. It collapses the round-trip: instead of "you should null-check here" → author interprets → author edits → I re-review the edit, the author just clicks Apply and the fix is precisely what I meant.

When *not* to use it: when the fix is non-trivial or debatable. Dropping forty lines of replacement code is me rewriting the PR, which steals the author's ownership and often misses context I don't have. For anything beyond a small mechanical change, I describe the problem and let the author solve it — that's their job, and they'll do it better with full context. A suggestion is for *cheap certainty*, not for redrafting someone's work.

### Q: Is praise in code review just being nice, or does it do work?

> **Testing:** Whether you see review as one-directional fault-finding.

**A.** It does real work, and I treat it as part of the job, not a courtesy. Three reasons. First, **calibration**: a `praise:` on a clean abstraction or a well-chosen test tells the author *what to keep doing* — feedback is only half-useful if it only ever says "less of this," never "more of that." Second, **signal about the bar**: praising the good parts of a PR makes the blocking comments land as "this specific thing needs fixing" rather than "the reviewer hates everything," which keeps the author non-defensive and the criticism credible. Third, **it's honest** — if someone solved a hard problem elegantly, saying so is just accurate.

The discipline is that it must be *specific and genuine*. "Nice work!" on every PR becomes noise and reads as rote. "praise: extracting the retry logic into `withBackoff` makes this so much easier to test — nice" names the thing and why it's good. Cheap praise is worse than none; specific praise is one of the highest-leverage things a senior reviewer does for a team's morale and direction.

### Q: What is "piling on" and how do you avoid it?

> **Testing:** Awareness of multi-reviewer dynamics and author overwhelm.

**A.** Piling on is when multiple reviewers independently flag the *same* issue, or when one reviewer leaves twenty comments where five would do, burying the author under volume. The first kind is demoralizing — the author reads "everyone thinks I'm bad at this" — and redundant. The second drowns the important comments in trivia.

To avoid it: **if a problem is already flagged, I +1 it or stay silent rather than re-stating it in my own words.** If I'm a second reviewer and the first has covered correctness, I focus on a different layer (tests, edge cases, docs) instead of re-litigating the same lines. And I *batch and prune* my own comments — before submitting, I re-read my draft review and cut the nits that don't matter, because a review with three sharp comments gets acted on and a review with twenty-five gets resented. Volume is not thoroughness; signal is.

### Q: Why submit a review as a batch instead of comment-by-comment?

> **Testing:** A small mechanical habit with an outsized relationship effect.

**A.** Most tools let you either fire each comment immediately or *queue them and submit once* as a single review (GitHub's "Start a review" / "Submit review"). I always batch. Two reasons. **For the author's experience:** comment-by-comment means their phone buzzes fifteen times and they start fixing comment #2 while I'm still typing comment #11 that contradicts it. A batched review arrives as one coherent pass with an overall verdict (approve / comment / request changes). **For my own quality:** holding the comments until I've read the whole diff lets me delete the three nits I left early that the later code made irrelevant, and notice patterns ("you re-implement this in four places") I'd miss firing line-by-line. Batching makes the review more coherent and the experience less like being pecked.

---

## Receiving Feedback

### Q: What's the single highest-ROI habit for the *author* of a PR?

> **Testing:** Whether you know self-review exists and why it dominates.

**A.** **Self-review before requesting review.** Before I add a single reviewer, I read my own diff line by line in the review UI — not the editor, the actual diff view — as if someone else wrote it. It's the highest-ROI habit because it catches the cheap stuff at the cheapest possible moment: the leftover `console.log`, the commented-out block, the file I didn't mean to commit, the function that's now dead, the unclear name I can fix before anyone wastes attention on it. Every one of those caught in self-review is a round-trip that *doesn't happen*.

It does a second thing: it lets me **pre-empt the reviewer's questions** by leaving my own comments on the diff — "this looks odd but it's working around bug #4521" — which front-loads the context the reviewer would otherwise have to ask for. A self-reviewed PR routinely gets approved in one pass where an un-self-reviewed one takes three. The diff view is a different reading than the editor; bugs hide in the editor and surface in the diff.

### Q: Do you have to respond to every review comment? Even the nits?

> **Testing:** Thread hygiene and respect for the reviewer's time.

**A.** Yes — every comment gets a response, even if the response is one word. Either I make the change and mark it resolved, or I reply with why I'm not (`"keeping it — this matches the pattern in the sibling module"`). The reason is that an *unanswered* comment is ambiguous: the reviewer can't tell if I disagreed, missed it, or silently complied, so they have to re-check, which is exactly the round-trip the response saves. For nits I can apply-and-resolve silently; for anything I'm *not* doing, I owe a one-line reason. Leaving comments dangling — especially declining them without a word — is the fastest way to make a reviewer feel ignored and to make them comment more defensively next time. Closing every thread is basic respect for the person who spent time reading my code.

### Q: A reviewer asks for a change you think is wrong. How do you push back?

> **Testing:** Whether you can disagree technically without it becoming personal or just caving.

**A.** I push back **with rationale, not with authority or annoyance.** I reply on the thread with the *reason* the suggestion doesn't work — the constraint they're missing, the data, the trade-off — and propose either keeping mine or a third option:

> "I considered a map here, but the list is capped at ~8 items and stays ordered for the UI — a map loses ordering and the linear scan is faster at this size. Open to it if you think the cap could grow, though?"

That does three things: it shows I *considered* their point (not reflexive defense), it gives them the information to change their mind, and it leaves the door open. The two failure modes I avoid are **caving** ("ok fine") when I think they're wrong — which ships worse code and teaches me nothing — and **digging in** without engaging their actual argument. If we still disagree after a round, I escalate the *mechanism* (see disagreement resolution), not the volume. The skill is separating "I disagree with this idea" from "I'm being attacked," and keeping the thread about the code.

### Q: How do you separate your ego from your code when feedback stings?

> **Testing:** Emotional maturity — and the honest acknowledgment that this is the hard part.

**A.** The reframe that works for me: **the PR is a proposal, not a verdict on me**, and review is how the team makes the proposal better — including catching my mistakes, which is the *point*, not an insult. A bug I wrote that a reviewer caught is a bug that didn't reach production; that's a win, even though it stings for a second. Concretely, when a comment lands hard, I do two things: I wait before replying if I notice I'm defensive (the worst replies are the instant ones), and I respond to the *technical content* of the comment, deliberately ignoring any tone I might be reading into it.

I'll be honest that this is the genuinely hard part of receiving feedback, and the deep work on it — the psychology, the cases where the feedback really *was* delivered badly, conflict that's gone interpersonal — is a Soft-Skills topic, not something a mechanics page solves with a tip. What the mechanics give me is *structure* that lowers the temperature: severity labels tell me a nit isn't an indictment, and "respond to every comment" gives me a concrete action instead of a feeling to sit in. But the underlying skill — caring about the code's quality more than about being right — is the real thing, and it's a practice, not a trick.

---

## Resolving Disagreement

### Q: A reviewer and author disagree on a blocking comment and the thread isn't converging. How should it resolve?

> **Testing:** The differentiator — do you have a *principled* resolution order, or does it come down to who's more senior/stubborn?

**A.** I resolve it by appeal to **something external to either person's authority, in this order:**

1. **Data / correctness.** If it's a fact — does this actually leak, is this actually O(n²), does this test actually fail — we settle it by *demonstrating* it. A failing test, a benchmark, a profiler trace, the spec. Whoever can show it wins, regardless of seniority. Most "disagreements" evaporate here because they were really an unverified assumption.
2. **Documented principle / style guide.** If it's a question of convention the team has already decided — the style guide, an ADR, an established pattern — we cite that. The team's prior decision outranks both our live opinions; that's *why* the team wrote it down.
3. **Reversibility → defer to the author.** If it's neither a fact nor a documented rule — it's taste, and the decision is cheap to change later — **the author decides.** They own the change. A reviewer's preference is not a defect.

What I explicitly *don't* let decide it: who's more senior, who's more stubborn, or who replied last. Authority is the resolution mechanism of last resort, not first. And there's a meta-rule on top of all three: **after about two round-trips with no convergence, stop typing and switch to synchronous** — a five-minute call resolves what fifteen async comments won't, because most stuck threads are a context gap, not a real disagreement. If even that doesn't resolve it, escalate to a tech lead as a *decision*, not as "make them agree with me."

### Q: What's the "author is right by default" principle, and where does it stop?

> **Testing:** Whether you understand reviewer humility *and* its boundary — both halves matter.

**A.** On **reversible, preference-level decisions**, the author is right by default: they're doing the work, they have the most context on this change, and the reviewer's job is to *advise*, not to impose taste. If the code is correct, secure, and maintainable, "I'd have structured it differently" is not grounds to block. This principle is what stops review from becoming "rewrite it the way I would have."

Where it stops — and this is the half people forget — is at **facts and irreversibility.** The author is *not* right by default about whether their code has a race condition, leaks a secret, drops data, or breaks a published contract. Those aren't preferences; there's a correct answer and the reviewer's veto exists precisely for them. The principle is "defer on taste," not "defer on everything." A reviewer who blocks on taste is a dictator; a reviewer who waves through a data-loss bug because "it's the author's call" has abandoned the job. The line is exactly the fact-vs-preference line: defer on preference, hold firm on fact.

### Q: Describe the two opposite failure modes of disagreement resolution.

> **Testing:** Whether you can name both the dictator and the endless thread — most candidates only see one.

**A.** **The dictator-reviewer:** treats every preference as a blocker, requires the code be rewritten to their taste, and uses the merge veto as a cudgel. The damage is that authors stop owning their work, velocity craters, and people route around that reviewer or stop sending real PRs. The fix is the fact-vs-preference discipline and "author is right on taste."

**The endless thread:** the opposite — nobody will either concede or escalate, so a trivial point generates twenty async comments over three days while the PR rots. The damage is pure waste plus a slow poisoning of the relationship. The fix is the *escalation path*: after a couple of round-trips, switch to synchronous; if still stuck, defer-to-author (if taste) or escalate to a decision-maker (if it's a real conflict over a fact). Both failure modes come from *not having an external resolution mechanism* — the dictator substitutes their authority, the endless thread substitutes infinite patience. The cure for both is the same: settle it on data/principle, defer on taste, escalate on a deadline.

---

## Mentoring & Calibration

### Q: Why is code review described as the main mentoring channel on a team?

> **Testing:** Whether you see review as teaching, not just gating.

**A.** Because it's the one moment where a senior engineer engages with a junior's *actual work* on *real code*, in writing, repeatedly. It's not a hypothetical in a lunch chat — it's "here is the concurrency bug your code actually has, here's why it happens, here's the pattern that avoids it," attached to code they care about because it's theirs and it's about to ship. That specificity and that stakes are why a good review comment teaches more than an hour of generic mentoring. Over months, the *pattern* of comments an engineer receives shapes how they write code — review is where a team's standards are actually transmitted, person to person, far more than any wiki page. Treating review as pure gatekeeping wastes the single best teaching surface a team has.

### Q: Should you review a staff engineer's PR the same way you review an intern's?

> **Testing:** Calibration of comment depth to author seniority.

**A.** The *bar* is the same — correctness and maintainability don't bend for seniority — but the *depth and framing* of comments calibrate to the author. For a junior, I explain the *why* in more detail and may teach the underlying principle ("here's why we don't catch-and-ignore — the error vanishes and you debug blind later"), because the comment is a teaching moment and they may not have the background yet. For a staff engineer, I can be terser and assume shared context ("races on `cache` — needs a lock or a sync.Map"), and I lean more on questions than explanations because they likely know something I don't.

The thing that does *not* change: I don't lower the correctness bar for a senior person, and I don't skip review because they're senior — senior people write bugs too, and "too senior to review" is how the worst incidents happen. I also don't *condescend* to juniors by over-explaining the obvious. Calibration is matching the explanation depth to the person; it is not matching the *standard* to the person.

### Q: Why does consistency of the bar across different reviewers matter?

> **Testing:** Awareness that review quality is a team property, not an individual one.

**A.** Because an inconsistent bar quietly destroys trust in the process. If reviewer A blocks on missing tests and reviewer B waves them through, then whether a bug ships is a coin flip based on who happened to pick up the PR — and authors learn to *shop for the lenient reviewer*, which routes important changes around the careful ones. It also makes the standard feel arbitrary and personal ("A is just picky") rather than a shared team norm. The fixes are structural: write the standards down (a review checklist, a style guide, ADRs) so the bar lives outside any one reviewer's head; **let tooling own the objective parts** so formatting and lint aren't subject to reviewer mood (see [Static Analysis & Linting](../../static-analysis/)); and calibrate as a team — occasionally review the same PR and compare, or discuss disagreements openly. A consistent bar is what makes review feel like a *process* instead of a personality.

### Q: "Everything is blocking." Why is that an anti-pattern even if every comment is technically valid?

> **Testing:** The signal-preservation insight — that severity is information and inflating it destroys the information.

**A.** Because **severity is a signal, and marking everything blocking sets that signal to zero.** Even if every comment is individually correct, when the missing null-check and the variable-naming nit both carry "request changes," the author can no longer tell which one will actually cause an incident. They either treat all twenty as critical — enormous wasted rework on trivia — or they start ignoring the "blocking" flag entirely because it's clearly inflated, and then they *miss the real one*. Both outcomes are worse than honest labeling. It's the boy-who-cried-wolf failure: an alarm that's always on is the same as no alarm.

The discipline is to **spend your blocking budget carefully** — block on the few things that genuinely must change, label the rest honestly as suggestions and nits, and accept that an author merging with three unaddressed nits is *fine*. A review with two `blocking:` comments and ten `nit:`s communicates a clear priority; a review with twelve `blocking:`s communicates nothing except that the reviewer doesn't distinguish. Protecting the meaning of "blocking" is one of the most senior things a reviewer does.

---

## Scenarios

### Q: Rewrite this comment into a good one: "this is wrong, did you even test it?"

> **Testing:** Can you actually produce specific/actionable/rational/non-hostile feedback on demand?

**A.** That comment fails on every axis: not specific (what's wrong?), not actionable (fix *what*?), no rationale, and hostile ("did you even test it" attacks the person). A rewrite names the defect, the trigger, the consequence, and the fix, with a label and zero attack:

> `blocking:` "This breaks when `userID` is empty — `getUser("")` returns `nil` and the next line dereferences it, so an unauthenticated request panics the handler. Can we guard with an early return when `userID == ""`? A test for the empty-ID case would lock it in."

Notice what changed: the verdict ("wrong") became a *named failure mode* (empty `userID` → nil deref → panic), the accusation became a *suggestion* (early return), and "did you even test it" — which is really a valid concern about coverage — became a constructive ask ("a test for the empty-ID case"). Same underlying problem, but now the author can fix it in a minute and doesn't feel attacked. The hostile version gets a defensive reply and a worse relationship; this one gets a fix.

### Q: The author disagrees with your blocking comment and pushes back with a reason. Walk me through what you do.

> **Testing:** Whether you actually *engage* the pushback or just re-assert the veto.

**A.** First, I take the pushback seriously — they may be right, and they have context I might lack. I read their reason and ask: **is this still a fact-level defect given what they just told me?**

- If their reason *resolves it* — "it can't be empty here, the router guarantees a non-empty `userID`, see the middleware" — then I was wrong about the defect. I say so plainly ("ah, missed the middleware guarantee — you're right, dropping this") and unblock. Being wrong gracefully is part of the job.
- If their reason is a *preference argument* against what's actually a fact ("I think a panic is fine here") — I hold, because the line is fact-vs-preference and a handler panic is a fact-level defect. I restate the *concrete harm* once, calmly: "a panic here takes down the request and shows up as a 500 — even if rare, we shouldn't ship a known crash path."
- If we still disagree after that one exchange, I **stop the async thread and switch to a call** — most stuck threads are a context gap a five-minute conversation closes. If even that doesn't resolve it, I escalate to the tech lead as a decision, framed as "we disagree on whether X must block — can you make the call," not "tell them I'm right."

The throughline: I engage their *argument*, I'll concede if they're right, I hold on facts, and I have a mechanism past the impasse. What I never do is re-assert "it's blocking because I said so."

### Q: You're the author getting tough, blunt feedback on your PR. How do you respond?

> **Testing:** Receiving criticism with maturity — and not over-rotating on the bluntness.

**A.** I separate the *content* from the *delivery* and respond to the content. If the feedback is blunt — "this whole approach is wrong, it'll deadlock under load" — the useful question is *is it correct*, not *was it phrased kindly*. So I engage the substance: "you're right that two goroutines take the locks in opposite order — that's a deadlock. Let me reorder the acquisition." If I genuinely don't understand the criticism, I ask for specifics rather than getting defensive: "can you point at where the ordering inverts? I want to make sure I fix the actual case." If part of it is wrong, I push back *with rationale* on that part while accepting the rest — receiving feedback well doesn't mean accepting all of it.

On the bluntness itself: in the moment, I let it go and focus on shipping correct code, because reacting to tone mid-review rarely helps. If a *pattern* of harsh delivery is genuinely hurting the team, that's worth raising — but separately, calmly, and as a Soft-Skills / 1:1 conversation, not as a reply on the PR thread. The mechanics answer is: respond to the technical content, ask when unclear, push back with reasons where warranted, and don't let phrasing you didn't love stop you from extracting the correct technical point out of it.

### Q: A reviewer is bikeshedding — blocking your PR over variable names and bracket placement. How do you handle it?

> **Testing:** Handling the dictator-reviewer / bikeshedding without it becoming a fight.

**A.** I name the category and route it to the right mechanism. Bracket placement and formatting are *objective and tool-ownable*, so the move is to **take it off the human entirely**: "good catch — let's let the formatter/linter own this so it's not a per-PR discussion. I'll add the rule to the config." That converts a recurring style argument into a one-time tooling fix and removes the reviewer's ability to bikeshed it again (see [Static Analysis & Linting](../../static-analysis/)).

For naming and other taste-level points the linter *can't* settle, I invoke author-decides-on-preference, politely: I'll take the suggestions that are genuine improvements, and for the rest, "these are preference-level and I'd like to keep them as-is — happy to revisit if there's a correctness or convention reason." If the reviewer keeps the *block* on pure taste after that, that's the dictator-reviewer anti-pattern, and I escalate the *mechanism*, not the bikeshed: a quick synchronous "can we align on what's blocking here," and if needed, a tech lead deciding "style preferences don't block merge." The key is not to *win the bikeshed* — arguing each name is exactly the trap — but to move the decision to where it belongs: tooling for the objective stuff, author for the taste, escalation for the abuse of the veto.

### Q: Two reviewers leave contradictory feedback on the same lines. As the author, what do you do?

> **Testing:** Composure under conflicting authority and pushing resolution to the right place.

**A.** I don't silently pick one and leave the other reviewer confused, and I don't try to satisfy both contradictory demands. I **surface the contradiction and ask them to resolve it among themselves**, in the open: "Reviewer A suggests extracting this into a separate service, Reviewer B suggests inlining it — these conflict, so I'll hold until you two align. I lean toward inlining because [reason], but it's your call." That does the right thing on three counts: it makes the disagreement *theirs* to settle (it's a reviewer-vs-reviewer question, not mine to adjudicate), it keeps it visible so I'm not seen as ignoring one of them, and it offers my own reasoned lean to help break the tie. If they can't converge, it escalates naturally to a tech lead. What I avoid is being whipsawed — implementing A, then B, then back — which wastes my time and signals I have no judgment of my own.

---

## Rapid-Fire

> Short questions to check breadth. One or two sentences each.

- **Q: Three properties of a good review comment?** A: Specific (exact line), actionable (says what to do), and carries its rationale (the why).
- **Q: `nit:` vs `blocking:`?** A: `nit:` is trivial and the author can ignore it; `blocking:` is a defect that must change before merge.
- **Q: Block on a fact or a preference?** A: Block on facts (correctness, security, data loss); defer on preferences (taste, naming, style).
- **Q: When does the author win a disagreement by default?** A: On reversible, preference-level calls — they own the change; the reviewer advises.
- **Q: Highest-ROI habit for a PR author?** A: Self-review the diff before requesting review — it catches the cheap stuff at the cheapest moment.
- **Q: Do you respond to every comment?** A: Yes — apply-and-resolve, or reply with a one-line reason for declining; never leave threads dangling.
- **Q: After how many async round-trips do you switch to a call?** A: About two — most stuck threads are a context gap a five-minute call closes.
- **Q: What's a code suggestion block for?** A: Small, unambiguous fixes the author can apply in one click; not for redrafting their work.
- **Q: Why batch comments instead of firing them live?** A: One coherent review instead of fifteen notifications, and it lets you prune nits the later code made moot.
- **Q: The cost of "everything is blocking"?** A: Severity stops meaning anything, so the author can't find the comment that actually matters.
- **Q: Calibrate the *bar* or the *depth* to author seniority?** A: Depth and framing, never the correctness bar.
- **Q: Who should own formatting feedback?** A: A linter/formatter, not a human reviewer — it's objective and tool-enforceable.
- **Q: Two opposite disagreement failure modes?** A: The dictator-reviewer (blocks on taste) and the endless thread (nobody concedes or escalates).
- **Q: Is praise real review work?** A: Yes — specific praise calibrates "do more of this" and keeps criticism credible.
- **Q: Reviewer is bikeshedding formatting — first move?** A: Take it off the human: codify the rule in the linter so it's never a per-PR argument again.

---

## Red Flags / Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**

- Leaving verdicts ("this is wrong") with no specifics, fix, or reason.
- Treating every comment as a blocker — no fact-vs-preference distinction.
- Resolving disagreements by seniority or stubbornness instead of data/principle.
- "I'd just override them, I'm the reviewer" — the dictator stance.
- Never self-reviewing; expecting reviewers to catch the leftover `console.log`.
- Caving instantly when pushed back on, even when you believe you're right.
- Reacting to a comment's *tone* instead of its technical content.
- No escalation path — implying threads either get won or run forever.
- Blocking on formatting a linter could own.

**Green flags:**

- Naming the *move* (specific/actionable/rationale, fact-vs-preference, defer-on-taste) before reaching for a phrasing.
- Reaching for severity labels to preserve signal.
- "Author is right by default on taste" *and* knowing where it stops (facts/irreversibility).
- Switching to synchronous after a couple of round-trips — recognizing a context gap.
- Conceding gracefully when the pushback is correct.
- Owning the consistency-of-the-bar problem as a *team* concern, not just personal.
- Using praise deliberately as calibration, not courtesy.
- Cleanly drawing the boundary to Soft-Skills for the deep tone/empathy/conflict work instead of over-claiming.

---

## Cheat Sheet

| Situation | The move |
|---|---|
| Writing a comment | Specific line + what to do + *why*; label its severity |
| Deciding block vs suggest | Block on facts (can you name the harm?); defer on preference |
| Small unambiguous fix | Code suggestion block — one-click apply |
| Author of a PR | Self-review the diff *first*; respond to every comment |
| You think a comment is wrong | Push back with rationale; concede if they're right |
| Disagreement won't converge | Data → style-guide → defer-to-author; call after ~2 round-trips; then escalate as a *decision* |
| Reviewer blocks on taste | Author-decides-on-preference; escalate the mechanism, not the bikeshed |
| Bikeshedding on formatting | Move it to the linter; off the human entirely |
| Reviewing a junior vs senior | Same bar, calibrated explanation depth |
| Tempted to mark all "blocking" | Spend the blocking budget on the few that must change |
| Tone/empathy/conflict runs deep | That's [Soft-Skills](../../../../Soft-Skills/code-review/), not mechanics |

---

## Summary

- **Giving feedback** reduces to three properties — **specific, actionable, with rationale** — plus a severity label so the author knows a veto from a thought. Add praise (specific, genuine) as calibration, don't pile on, and batch your comments.
- **Fact vs preference** is the central judgment: **block on defects** you can name the harm of; **defer on taste**, where the **author is right by default** on reversible calls.
- **Receiving feedback**: **self-review first** (highest ROI — catches the cheap stuff cheaply); **respond to every comment**; push back **with rationale**, concede gracefully, and respond to *content* not tone.
- **Disagreement** resolves by an external order — **data/correctness → documented principle → defer-to-author on taste** — never by authority; switch to **synchronous after ~2 round-trips**, then escalate as a *decision*. Avoid both the **dictator-reviewer** and the **endless thread**.
- **Mentoring & calibration**: review is the **main mentoring channel**; calibrate **depth, not the bar**, to seniority; keep the bar **consistent across reviewers** (write it down, tool the objective parts); and never let **"everything is blocking"** flatten severity to noise.
- **The line:** this is the mechanics. The deep tone, empathy, and interpersonal-conflict work is **Soft-Skills** — name the boundary rather than pretend to cover it.

---

## Further Reading

- [Conventional Comments](https://conventionalcomments.org/) — the `praise:`/`nit:`/`suggestion:`/`question:`/`issue:` labeling scheme referenced throughout; the single most actionable convention on this page.
- Google Engineering Practices — *Code Review Developer Guide* ([The Standard of Code Review](https://google.github.io/eng-practices/review/reviewer/standard.html), [How to Write Code Review Comments](https://google.github.io/eng-practices/review/reviewer/comments.html), and the author-side [Handling Pushback](https://google.github.io/eng-practices/review/developer/handling-comments.html)). The canonical treatment of fact-vs-preference and the resolution order.
- *Unlearning Toxic Behaviors in a Code Review Culture* — Sandya Sankarram, and related talks/essays on review tone and power dynamics; bridges this page toward the Soft-Skills material.
- The [junior.md](junior.md) and [senior.md](senior.md) pages of this topic — junior grounds the comment-writing fundamentals; senior covers calibration, team consistency, and disagreement at scale.

---

## Related Topics

- [01 — What to Look For & In What Order](../01-what-to-look-for-and-order/interview.md) — what generates the feedback this page is about delivering.
- [02 — PR Scope & Size](../02-pr-scope-and-size/interview.md) — small PRs make every comment better; large ones make feedback worse.
- [08 — Review Anti-patterns](../08-review-anti-patterns/interview.md) — the dictator-reviewer, the rubber stamp, the endless thread as named anti-patterns.
- [Soft-Skills → Code Review](../../../../Soft-Skills/code-review/) — the deep tone, empathy, psychological-safety, and conflict work this page deliberately defers.
- [Static Analysis & Linting](../../static-analysis/) — let tooling own the objective feedback so humans review judgment, not formatting.
