# What Makes Docs Good — Interview Questions

> **Roadmap:** [Documentation Quality](../README.md) → What Makes Docs Good
> *A docs-quality interview rarely asks "should we write documentation." It asks "here's a wiki page that's accurate but nobody can find — is it good?", and then watches whether you can separate the quality attributes, judge a page against its genre, and tell reader-rated quality apart from functional quality. This page is the question bank, with model answers and a note on what each question is really probing. Scope: how to **judge** doc quality, not how to write the prose.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — The Quality Attributes](#theme-1--the-quality-attributes)
3. [Theme 2 — Good Differs by Genre](#theme-2--good-differs-by-genre)
4. [Theme 3 — Subjective vs Objective Quality](#theme-3--subjective-vs-objective-quality)
5. [Theme 4 — Minimalism](#theme-4--minimalism)
6. [Theme 5 — Reviewing and Enforcing Quality](#theme-5--reviewing-and-enforcing-quality)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Ownership and Incentives](#theme-7--ownership-and-incentives)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **accuracy vs everything else** (a wrong doc is worse than no doc; the other attributes are negotiable, this one isn't)
- **the genre sets the bar** (a reference and a tutorial are graded on different rubrics; mixing them is the defect)
- **subjective vs objective quality** (what a reader *feels* — useful, clear, findable — vs what you can *measure* — accurate, complete, fresh — and why you need both signals)
- **fitness for purpose vs more docs** (good is "the reader succeeds," not "we wrote a lot"; volume can be negative)

Nearly every question in this bank is one of those distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for an opinion — and who never say "good docs" without asking "good *for whom, doing what*?"

---

## Theme 1 — The Quality Attributes

### Q1.1 — Name the attributes of "good" documentation and rank them.

> **Testing:** Do you have a structured model, or do you think "good docs" is one undifferentiated blob?

**A.** I'd name six and insist they're not equal:
1. **Accuracy** — does it match reality (the current code, API, behavior)? This is the **gate**; the others only matter once this holds.
2. **Findability** — can the reader who needs it actually reach it (search, IA, the right page surfacing at the right moment)? A correct doc nobody finds has near-zero value.
3. **Audience fit** — is it pitched at the reader's actual knowledge level and goal? The same content is "good" for one audience and "useless" for another.
4. **Clarity** — once found and correct, can the reader understand it without re-reading three times?
5. **Completeness** — does it cover what the reader needs to finish the task (no silent gaps, no "and then magic happens")?
6. **Currency** — is it *fresh*, kept in step with the thing it documents over time?

The ranking isn't arbitrary preference; it's a **dependency order**. Accuracy first because everything downstream inherits its truth value. Then findability and audience fit, because an accurate doc the reader can't find or can't parse is wasted. Clarity and completeness refine a doc that's already reaching the right person. Currency is the one that decays without anyone touching the file — it's accuracy *over time*. The senior move is refusing to treat "we have a doc" as the goal; the goal is *the reader succeeds*, and these six are the levers.

### Q1.2 — Why is accuracy non-negotiable when the others are tradeoffs?

> **Testing:** The single most important judgment in the whole topic — that a wrong doc is worse than no doc.

**A.** Because **a wrong doc is worse than no doc**, while a doc that's merely incomplete or slightly unclear is still net-positive. Trace the failure modes. With *no* doc, the reader knows they're on their own: they read the source, ask a colleague, experiment — slow, but they stay skeptical and self-correct. With a *wrong* doc, the reader **trusts it**, acts on it, and ships the bug; the error is laundered through their confidence. The doc didn't just fail to help — it actively misled, and it cost more than the absence would have.

There's a compounding effect too: one discovered inaccuracy poisons trust in the *whole* corpus. After a reader gets burned once, they stop trusting *every* page and go back to reading code — at which point all your other docs, however clear, have lost their value. So accuracy is the property that makes the rest *worth* having. The others are dials you balance against effort and audience; accuracy is a floor you don't go below. This is why "delete the stale page" is often a *quality improvement*, not a loss — removing a confident lie raises the corpus's average truthfulness.

### Q1.3 — A page is accurate, complete, and clear, but it's buried four clicks deep and never shows up in search. Is it good?

> **Testing:** Whether findability is a first-class attribute or an afterthought.

**A.** No — it's a **good document and a bad piece of documentation**. Documentation is a *system* whose job is to deliver the right answer to a reader at their moment of need; a page that can't be reached has failed at that job no matter how excellent its prose. In practice an unfindable page is *negative*: it cost time to write and maintain, it dilutes search results, and worst, the same questions keep getting asked (and re-answered in Slack) because nobody knows the page exists — so it generates the exact support load it was meant to remove. The fix is information architecture and search, not more writing. The principle: **content quality and access quality are different axes, and a doc needs both**. Judging a corpus, I weight "can readers find what they need" as heavily as "is what they find correct."

### Q1.4 — Distinguish completeness from comprehensiveness. Which do you actually want?

> **Testing:** Whether you conflate "covers the task" with "covers everything" — the seam where minimalism enters.

**A.** **Completeness** is *task-relative*: the reader can finish the job they came to do, with no silent gap they fall into. **Comprehensiveness** is *topic-relative*: every fact about the subject is present somewhere. You want **completeness**, and comprehensiveness is often its enemy. A page that documents all forty parameters with equal weight is comprehensive but *incomplete* for the 90% who need the three common ones — they can't see the path through the noise. Real completeness includes the unglamorous parts readers actually stumble on: prerequisites, the error cases, "what to do when it fails," the non-obvious default. The judgment call is *whose* task defines "complete," which routes straight to audience fit. A reference page is complete when every public element is documented; a tutorial is complete when a beginner reaches a working result — same word, two different bars, set by genre.

---

## Theme 2 — Good Differs by Genre

### Q2.1 — Why can't you judge all documentation by one rubric?

> **Testing:** Whether you know "good" is genre-relative — the core idea behind the Diátaxis lens.

**A.** Because docs serve **different reader needs that are partly in opposition**, and a rubric that's right for one is wrong for another. The Diátaxis framework names four modes: **tutorials** (learning-oriented, hold a beginner's hand to a first success), **how-to guides** (task-oriented, get a competent user through a specific job), **reference** (information-oriented, look up precise facts), and **explanation** (understanding-oriented, the "why" and the conceptual model). Their quality criteria genuinely conflict: a tutorial should *omit* options and edge cases so the beginner isn't overwhelmed — but a reference omitting options is *defective*. A reference should be terse, exhaustive, and skimmable — but a tutorial that's terse and exhaustive is a wall that loses the learner. So "good" is a function of *which mode the page is in*. The quality lens isn't one rubric; it's first **identify the genre**, then apply *that genre's* rubric. A page that hasn't picked a genre can't be good, because it's failing at least three rubrics at once.

### Q2.2 — An engineer wrote a "reference" page that opens with a narrative walkthrough and skips half the parameters. Why is that a defect, not a style choice?

> **Testing:** Whether you can call a genre mismatch a *quality defect* with a clear reason.

**A.** It's a defect because the page **violates the contract its genre makes with the reader**. Someone arrives at reference material in *lookup* mode: they know roughly what they want and need a precise, complete, skimmable answer *fast*. A narrative walkthrough forces them to read prose to extract a fact — high friction for the lookup task — and skipping half the parameters means the one they came for might simply be absent, the worst outcome for reference. The author optimized for a *tutorial* experience while readers are in a *reference* posture; the mismatch is the bug. The deeper point: mixing modes degrades *both*. The reference reader is slowed by narrative; a beginner who wandered in still won't learn because it's not actually a structured lesson. This is why "**a reference that reads like a tutorial**" is a recognized anti-pattern — the genres want opposite things, and trying to serve both in one page serves neither. The fix is to *split*: a complete reference table, and, separately, a tutorial or how-to that links into it.

### Q2.3 — How do you use Diátaxis as a *quality lens* rather than a writing template?

> **Testing:** Whether you can apply the framework to *judging* existing docs, which is this topic's scope.

**A.** As a writing template it tells authors where to put new content. As a *quality lens* — which is the judgment skill — I use it to **audit**: take any page and ask three diagnostic questions. First, *what mode is this trying to be?* If it can't be answered, the page lacks a job and that's the first defect. Second, *is it succeeding at that mode's specific criteria?* — a tutorial: does a true beginner reach success; a reference: is it complete and skimmable; a how-to: is it task-scoped, not padded with theory; an explanation: does it build a mental model rather than list steps. Third, *is it leaking into other modes?* — theory bloating a how-to, narrative bloating a reference. The lens also surfaces **coverage gaps at the corpus level**: a project drowning in reference but with no tutorial will have a brutal onboarding curve, even if every reference page is individually flawless. So Diátaxis gives me both a per-page rubric *and* a portfolio view — am I missing a whole quadrant?

### Q2.4 — Give a concrete example where the *same content* is good in one genre and bad in another.

> **Testing:** Whether the genre idea is real to you or just vocabulary.

**A.** Take "all the configuration options with their types, defaults, and constraints." In **reference**, that exhaustive table *is* the quality bar — every option present, precisely specified, alphabetical or grouped for lookup. Drop that identical table into a **tutorial** and it's a defect: the beginner trying to get their first deployment working doesn't need forty options, they need the three that matter and a working example; the full table buries the path and stalls the lesson. Conversely, "here's the one happy-path command, copy-paste it" is *good* in a quickstart tutorial and *bad* in reference, where omitting the other options makes the page incomplete. Same facts, opposite verdicts — because quality is *fitness for the reader's posture*, and the genre is what tells you the posture. That's the whole reason "judge every page by one checklist" fails.

---

## Theme 3 — Subjective vs Objective Quality

### Q3.1 — Documentation quality has a subjective side and an objective side. Define both and explain why you need both.

> **Testing:** The distinction that separates "we measured docs" from "we improved docs."

**A.** **Objective (functional) quality** is what you can verify without a reader's opinion: is it *accurate* (matches the code), *complete* (covers the public surface / the task), and *fresh* (recently updated relative to what it documents). These are machine- or rubric-checkable — link-rot scans, doc-vs-code coverage, last-updated age, lint rules. **Subjective (reader-rated) quality** is what only a reader can report: was it *useful* (did it solve my problem), *clear* (could I understand it), *findable* (did I get to it without a fight). These come from "Was this helpful?" widgets, surveys, support-ticket deflection, user testing.

You need both because **each is blind to the other's failures**. A page can be objectively perfect — accurate, complete, fresh — and subjectively useless because it's written for the wrong audience or impossible to find; your functional metrics stay green while readers suffer in silence. Conversely a page can score great on "helpful?" votes while being subtly *wrong* — readers feel helped right up until it burns them. Functional metrics catch the lies the readers can't see; reader signals catch the friction the metrics can't see. Measuring only one gives a confident, false read on quality. (How to turn these into actual numbers is [06 — Measuring Docs ROI](../06-measuring-docs-roi/interview.md).)

### Q3.2 — Your "Was this page helpful?" thumbs-up rate is 85%. Are the docs good?

> **Testing:** Whether you trust a single subjective metric or interrogate it.

**A.** I'd treat 85% as a *weak* signal, not a verdict, for three reasons. First, **massive non-response bias**: a tiny, self-selected fraction clicks the widget, usually the delighted or the furious, so the number isn't representative. Second, it measures *satisfaction*, not *correctness* — readers happily thumbs-up a confidently-wrong page, so a high score is fully compatible with shipping bugs. Third, it has **no denominator for the people who never arrived** — findability failures don't show up because the unhappiest users left before reaching the page or never found it. So 85% tells me "the people who found this page and chose to vote mostly liked it," which is a sliver of the quality question. I'd triangulate: pair it with functional checks (is the page actually accurate and fresh?) and with *outcome* signals (did support tickets on this topic drop? did task-completion in user testing rise?). One green metric is a prompt to investigate, never a conclusion.

### Q3.3 — Give me an objective signal and a subjective signal that can *disagree*, and what that disagreement tells you.

> **Testing:** Whether you can reason about conflicting signals instead of cherry-picking the flattering one.

**A.** Objective: the page is **fresh and accurate** — updated last week, verified against the API, zero broken links. Subjective: its **"helpful" rate is low** and support keeps fielding the question it supposedly answers. The disagreement is *diagnostic*: the content is *correct* but *not working for readers*. The usual culprits are the attributes objective checks can't see — **audience fit** (it's pitched too high or too low), **clarity** (technically right, cognitively impenetrable), or **findability** (people are answering the question without ever landing on the page). The disagreement tells me where to look: not at the facts (those are fine) but at framing and access. The reverse disagreement — high "helpful" votes but the page is *stale* — tells me readers *like* something that may now be *wrong*, which is more dangerous and argues for a freshness gate the popularity signal would otherwise mask. The value is precisely in the conflict: agreement is comforting, disagreement is information.

### Q3.4 — Can documentation be "high quality" with zero metrics in place? How would you assess a corpus you just inherited?

> **Testing:** Whether quality judgment is a skill you carry, or just dashboard-reading.

**A.** Yes — quality is a property of the docs, not of your instrumentation; metrics just *observe* it. Inheriting a cold corpus, I'd assess on both axes by hand. **Objective, sampled:** pick the highest-traffic pages and the riskiest (security, payments, on-call runbooks) and check them against reality — does the quickstart actually run, do the API examples execute, when were they last touched relative to the code they describe, do the links resolve. **Subjective, by proxy:** read the support channel and ticket tags — *what do people repeatedly ask that a doc should answer?* That's a direct readout of findability and clarity gaps. I'd also run a tiny **task test**: hand a new hire the onboarding doc and watch where they get stuck — five minutes of observation beats a quarter of survey data. The structured judgment is: gate on accuracy/freshness for the *critical* pages first, then triage the rest by traffic. You don't need a dashboard to know docs are bad; you need to *look at them the way a reader does*.

---

## Theme 4 — Minimalism

### Q4.1 — What is minimalism in documentation, and why can *more* docs make a corpus *worse*?

> **Testing:** Whether you understand that volume is not quality — often the opposite.

**A.** Minimalism is John Carroll's principle (from *The Nurnberg Funnel*) that documentation should support the reader's **action and goals**, cutting everything that doesn't, rather than exhaustively narrating the system. The counterintuitive claim — borne out by his research — is that *less* documentation often produces *better* outcomes: learners given lean, action-focused material completed tasks faster than those given comprehensive manuals, because the comprehensive version made them read more to find less.

More docs make a corpus worse through concrete mechanisms, not vibes. **Findability collapses** — every extra page is more haystack around the needle, and search returns five near-duplicate answers of unknown vintage. **Maintenance load rises** — every page is a freshness liability; ten pages on one topic is ten things to keep accurate, and they *will* drift out of sync with each other, so the reader meets contradictions. **Cognitive cost rises** — readers must now *choose* which of several pages to trust. The corpus's value isn't the sum of its pages; past a point, each marginal page has *negative* marginal value because it dilutes and contradicts. So "we wrote a lot of docs" is not evidence of quality, and "we deleted half the docs" can be a quality *win*.

### Q4.2 — What does "action-oriented" mean in practice, and how does it change what you judge a page on?

> **Testing:** Whether minimalism is an abstraction or something you can apply to a real page.

**A.** Action-oriented means the page is organized around **what the reader is trying to *do***, not around the structure of the system or the author's mental table of contents. In practice: it gets to a real task fast, leads with a runnable example over preamble, and cuts throat-clearing ("In this section we will explore...") and theory the task doesn't need. It assumes the reader is a busy adult who wants to *accomplish something*, not a student reading front-to-back. Judging a page through this lens, I stop asking "does this thoroughly describe the feature?" and start asking "**can a reader with a goal get in, do the thing, and get out?**" — which surfaces defects an "is it thorough?" rubric misses: the page that *describes* the API beautifully but never shows you *call* it; the 800-word intro before the first command. Carroll's research is the warrant: people learn by *doing*, so docs that front-load action beat docs that front-load exposition.

### Q4.3 — Minimalism stresses error recovery. Why is "what to do when it breaks" a quality marker, and how does it square with cutting content?

> **Testing:** Whether you grasp the most-cut, highest-value part of minimalism — and that minimalism isn't just "delete things."

**A.** Because **readers spend a large share of their time in the error state**, not the happy path — and that's exactly where docs usually go silent. Carroll's minimalism explicitly says: support **error recognition and recovery**. A doc that shows only the golden path is incomplete in the way that hurts most; the moment something fails — and it will — the reader is stranded, and that's when they file the ticket or give up. So "what the common errors look like and how to get out of them" is a high-value quality marker precisely because it's the most-omitted, most-needed content.

It squares with "cut content" because minimalism isn't "write less of everything" — it's "**cut what doesn't serve the reader's goal, and *invest* in what does.**" Error recovery serves the goal directly; a paragraph of architectural backstory usually doesn't. So minimalism *reallocates*: trim the exposition nobody asked for, spend that budget on prerequisites, the failure modes, and the recovery steps. "Minimal" means *lean toward the reader's task*, not *short for its own sake* — a page can be longer than average and still minimalist if every added line removes a way for the reader to get stuck.

### Q4.4 — Isn't minimalism just an excuse to write less and skip the hard parts?

> **Testing:** Whether you can defend minimalism against its most common misreading.

**A.** No — and the misreading is dangerous because it weaponizes a quality principle into an excuse for laziness. Minimalism is not "write less"; it's "**write exactly what the reader needs to succeed, and nothing that gets in their way.**" Skipping the hard parts — the edge cases, the failure modes, the prerequisites — is the *opposite* of minimalism, because those are the parts most load-bearing for the reader's goal. What minimalism cuts is the *low-value* mass: ceremony, redundant restatement, theory untethered from any task, the obligatory "introduction" that delays the first useful sentence. Done right it's *harder* than writing comprehensively — deciding what to leave out, and getting the few things you keep exactly right, takes more judgment than dumping everything. "We kept it minimal" is only credible if the reader can still finish the task *and* recover from the common errors; if they can't, that's not minimalism, it's an incomplete doc wearing minimalism as a costume.

---

## Theme 5 — Reviewing and Enforcing Quality

### Q5.1 — How do you make doc quality something a team actually maintains, instead of hoping?

> **Testing:** Whether quality is a process you can operationalize, not a virtue you exhort.

**A.** You make it **enforced at the same gates code is**, because anything optional decays. Four levers, roughly in order of leverage:
1. **Docs in code review** — a PR that changes behavior is *incomplete* until its docs change too; the reviewer checks the docs like they check the tests. This is the single highest-leverage move because it puts the doc update *next to* the change that invalidated it, when the author still has the context.
2. **A rubric / Definition of Done** — an explicit, shared checklist for "what makes this doc done" (accurate, has a runnable example, states prerequisites, picked a genre, links resolve), so "good" isn't one reviewer's taste.
3. **A style guide + automated linting (Vale)** — encode the mechanical rules (terminology, voice, banned phrases, heading structure) into a linter so humans never burn review cycles on them and the bar is applied uniformly.
4. **Templates** — a per-genre skeleton (tutorial template, reference template, runbook template) so authors start from a structure that's already shaped for quality, instead of a blank page.

The throughline: **shift quality left and automate the mechanical parts**, so human review is spent on the things only humans can judge — is it accurate, is it clear, does it actually help.

### Q5.2 — Why review docs *in the code review*, alongside the diff? What breaks if you review them separately?

> **Testing:** Whether you understand that doc drift is a timing problem.

**A.** Because **doc rot is created at the exact moment code changes**, and the cheapest time to fix it is *then* — while the author has the context, in the same PR. Couple them and the documentation can't silently fall out of step: the change and its doc update land together, reviewed together, and "the code is merged but the docs lag" simply can't happen. Review them *separately* and you've created a race the docs always lose: the code ships on the team's deadline, the doc update goes on a backlog, the backlog never clears, and three sprints later the page describes behavior that no longer exists. You've also split the context — whoever picks up the doc ticket later has to *reconstruct* what changed and why, badly and slowly, versus the author who knew it cold. So "docs as part of the PR" isn't bureaucracy; it's the only timing that keeps currency from rotting by default. (The freshness/rot side of this is [03 — Freshness and Rot Metrics](../03-freshness-and-rot-metrics/interview.md).)

### Q5.3 — What belongs in a docs Definition of Done or review rubric? What does *not* belong in the automated part?

> **Testing:** Whether you can split mechanical (automatable) from judgment (human) quality.

**A.** A useful DoD mixes both kinds, but the *automated* gate and the *human* gate must hold different things.

**Automate (cheap, objective, no taste required):** links resolve; code samples actually compile/run; required sections present (per the template); terminology and banned phrases (Vale); heading hierarchy and structure; spelling; a freshness/last-reviewed stamp. These are pass/fail and a machine should own them — humans reviewing comma usage is wasted senior time and applies the rule inconsistently anyway.

**Keep human (judgment, not mechanizable):** *Is it accurate* — does it match what the code truly does (a linter can't know intent). *Is it the right genre, and does it stay in it.* *Is it clear to the target audience* — the linter can't feel confusion. *Is it complete for the task, including the error cases.* *Is it actually needed, or are we adding a page that should be a deleted one* (minimalism judgment). What does **not** belong in the automated part is anything requiring a model of the reader or of correctness — automating those produces *cargo-cult quality*: pages that pass every lint and still mislead. The split is the point: machines enforce *consistency*, humans enforce *truth and fitness*.

### Q5.4 — How does a style guide plus a linter like Vale raise quality, and where does it stop helping?

> **Testing:** Whether you know the reach *and the ceiling* of mechanical enforcement.

**A.** A style guide encodes the team's decisions about voice, terminology, and structure; **Vale** turns the mechanizable subset of those decisions into CI rules that flag violations on every PR. The quality lift is real and specific: **consistency at zero marginal human cost** — one term for one concept across thousands of pages, banned weasel-words caught automatically, structure enforced — and it *frees human reviewers* to spend their attention on accuracy and clarity instead of nitpicking style. It also makes the standard *objective and teachable*: new contributors get instant, impersonal feedback instead of a senior's subjective redline.

Where it stops: Vale checks **form, never substance**. It cannot tell you the doc is *wrong*, that the example is for the old API, that the page is pitched at the wrong audience, that a critical step is missing, or that this page shouldn't exist at all. A page can pass every Vale rule and be confidently, dangerously inaccurate. So linting raises the *floor* (no page is sloppy) but does nothing for the *ceiling* (is it true, clear, and useful) — that ceiling is human review's job. Treating a green Vale run as "the docs are good" is exactly the cargo-cult trap.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — You join a team. How would you tell, in a week, whether their docs are actually good?

> **Testing:** Practical, multi-signal assessment under a time box — the heart of "judging" docs.

**A.** I'd sample across both quality axes rather than read everything. **Run the onboarding myself**: follow the setup/quickstart on a clean machine and note every place it's wrong, stale, or leaves me stuck — the single richest signal, because I *am* the test reader and onboarding docs are where rot bites first. **Read the support/help channel and ticket tags**: the questions asked over and over are a direct list of findability and clarity failures; if engineers constantly answer the same thing in chat, the docs aren't doing their job regardless of how they look. **Spot-check the critical pages** (on-call runbooks, security, payments) against reality — those failing is a different severity than a stale tutorial. **Check freshness and ownership**: last-updated dates versus recent code changes, and whether anyone is actually responsible. **Look for genre discipline and a deletion habit**: do pages know what they are, and does the team *remove* stale content (a corpus that only grows is decaying). In a week that gives me a grounded verdict: not "they have a wiki" but "can a reader with a real task succeed, and do the people who maintain it keep it true."

### Q6.2 — An engineer says "the code is self-documenting, we don't need docs." Respond.

> **Testing:** Whether you can rebut a seductive half-truth precisely, without overcorrecting into "document everything."

**A.** I'd grant the kernel of truth and then mark its hard boundary. Self-documenting code is a real and worthy goal *for one specific question*: **"what does this code do?"** Good names, small functions, and clear types make the *local mechanics* legible, and yes, that beats a stale comment restating the obvious. But "self-documenting" answers only the *what*, and readers need three things code structurally *cannot* tell them:
- **Why** — the rationale, the rejected alternatives, the constraint that made this ugly thing necessary. The code shows the decision; it can't show the *reasoning* or what you tried first. (That's what ADRs exist for.)
- **How do I use this** — a consumer of an API or service should not have to read its implementation to call it. "Read the source" is a *failure* of the docs, not a substitute for them; it doesn't scale past the author and it leaks internals.
- **The cross-cutting and the absent** — architecture spanning many files, operational runbooks, the *why a thing is deliberately missing*. None of that lives in any single function.

So the honest position isn't "code self-documents, skip docs" *or* "comment everything"; it's: **let code document the *what*, and write docs for the *why*, the *how-to-use*, and the *big picture*.** Claiming code replaces all docs usually means the author has the whole system in their head and is forgetting that the next reader doesn't.

### Q6.3 — How much documentation quality does an internal throwaway tool need? Defend your answer.

> **Testing:** Whether quality is dogma or **fitness for purpose** — that the right bar *varies*.

**A.** Far less than a public API, and saying so is the *senior* answer, not a cop-out — because doc quality is **fitness for purpose**, and the purpose here is small, short-lived, and known to a tiny audience. Over-documenting a throwaway is itself a quality failure: it's effort spent maintaining pages that'll outlive the tool and then rot, plus it implies a permanence the tool doesn't have. So the proportionate bar is *low* on completeness, polish, and findability.

But the floor isn't *zero*, and one attribute doesn't get discounted by audience size: **accuracy**, scoped to whatever does exist. A correct three-line README — what it does, how to run it, the one gotcha that'll bite the next person — is genuinely *good* documentation for a throwaway tool, because it's fit for purpose. A beautiful 20-page manual for the same tool is *worse* documentation despite being "more," because it's mis-scaled. The two traps are symmetric: under-documenting the thing your on-call successor will inherit at 3 a.m. (the "throwaway" that quietly became load-bearing), and over-documenting the thing that'll be deleted next month. The skill is *calibrating the bar to the stakes and lifespan*, not applying one standard everywhere.

### Q6.4 — A page is heavily read but has a low "helpful" rate. What do you conclude and what do you do?

> **Testing:** Reasoning from conflicting signals to an action, not just naming them.

**A.** High traffic + low helpfulness is a strong, specific signal: **a lot of people need this and the page is failing them** — which makes it high-priority, not low (the failure is being suffered at scale). I would *not* conclude "delete it"; the traffic proves demand. I'd diagnose which attribute is broken, because the fix differs: if it's *inaccurate or stale*, readers feel misled — verify against the code and update. If it's *unclear or wrong-audience*, they can't use correct content — restructure, lead with the example, re-pitch to the actual reader. If it's an *unanswered question* — they keep arriving hoping for something the page doesn't cover — the fix is completeness, often the error/edge cases. I'd confirm with a cheap qualitative pass (read the linked tickets, watch one person use it) before rewriting blind. The meta-point: traffic tells me *importance*, the helpfulness gap tells me *there's a defect*, and only looking at the page tells me *which* defect — so prioritize by traffic, diagnose by attribute, then act.

### Q6.5 — Two pages give contradictory instructions for the same task. Walk me through handling it.

> **Testing:** Whether you treat contradiction as the trust-killer it is, and fix the *system*, not just the page.

**A.** I treat this as a **high-severity** problem, because contradiction is worse than a single wrong page: the reader can't tell which to trust, so it poisons confidence in the *whole* corpus and forces them back to reading code. Steps: (1) **Establish ground truth** — check what the system *actually* does now; one page is stale, possibly both. (2) **Pick a single source of truth** and make the others defer to it — *consolidate*, don't patch both, because two maintained copies will diverge again; ideally there's now *one* page and the other **redirects** to it. (3) **Delete or redirect the loser** rather than leaving a corrected-but-duplicate page around — duplication is the root cause, so removing it is the fix. (4) **Ask why two pages drifted apart** — usually no ownership and no single-source discipline, so the systemic fix is assigning an owner and killing the duplication pattern, not just this instance. The judgment on display is that the *real* defect is the duplication and the missing single-source-of-truth, and that **deleting a page is a valid — often the correct — quality action.**

---

## Theme 7 — Ownership and Incentives

### Q7.1 — Whose job is documentation — the engineers or the technical writers?

> **Testing:** Whether you have a real model of ownership, not a slogan ("everyone owns it" = no one does).

**A.** It's a **division of labor by what each is uniquely positioned to do**, not an either/or — and "everyone owns it" is a trap, because shared-with-no-one ownership means it rots. Engineers must own the **correctness** of docs tied to their code: they're the only ones who know what the code actually does and *why*, and only they can keep a doc in step with a change (which is why docs belong in their PR). Technical writers, where you have them, own what they're uniquely good at: **structure, clarity, consistency, the information architecture, audience fit, and the editorial bar** across the whole corpus — turning an engineer's accurate-but-dense brain-dump into something a reader can actually use, and keeping the corpus coherent rather than a pile of individual pages. The failure mode of "writers own all docs" is that they can't keep up with engineering velocity and they don't know the *why*; the failure mode of "engineers own all docs" is inconsistent, unfindable, audience-blind writing. So: **engineers own accuracy and the *why*; writers own clarity, structure, and the system-level quality.** Where there are no writers, engineers own both — and that's exactly when a rubric, templates, and linting matter most, to substitute for the editorial expertise you don't have on staff.

### Q7.2 — Documentation is chronically under-maintained at most companies. Why, in terms of incentives?

> **Testing:** Whether you can reason about the *systemic* cause, not blame individuals.

**A.** Because the **incentives are misaligned with the work**, and individuals respond rationally to that. The cost of writing and maintaining docs is **immediate and borne by the author**; the benefit is **deferred, diffuse, and reaped by *other* people** (future readers, other teams, on-call successors). Almost nobody is promoted or praised for keeping a wiki fresh; everybody is rewarded for shipping features. So under deadline pressure, docs are the rational thing to cut — the author pays the cost now and someone else, later, pays for the absence. Add a measurement gap: the *cost* of bad docs (slow onboarding, repeated questions, incidents from stale runbooks) is real but rarely attributed back to "docs," so the org doesn't *feel* the loss it's taking. It's a classic **tragedy-of-the-commons / externality** problem: each rational local decision to skip docs degrades a shared resource everyone depends on. That's *why* enforcement (docs-in-PR, a DoD gate) works where exhortation fails — it changes the incentive so the doc update is part of "done," not optional virtue. (Quantifying that hidden cost so leadership *feels* it is [06 — Measuring Docs ROI](../06-measuring-docs-roi/interview.md).)

### Q7.3 — How would you change incentives so docs quality actually improves, not just a mandate to "write more docs"?

> **Testing:** Whether you can design an intervention that targets the real lever, and know that "write more" is the wrong goal.

**A.** I'd target the *incentive*, not issue a *quota* — "write more docs" produces more low-value pages, which (per minimalism) can make the corpus *worse*. Concretely: (1) **Make doc updates part of Definition of Done** so a behavior change isn't "shippable" without its doc change — this removes the choice that lets docs lose to deadlines, and it's enforced at the PR, where context is fresh. (2) **Make doc quality visible and credited** — surface it in code review, recognize it in performance/promotion criteria, so the work stops being invisible labor. (3) **Lower the cost** with templates, linting, and good tooling, because half the "we don't have time" is friction, not unwillingness. (4) **Make the *cost of bad docs* visible** — attribute repeated questions and onboarding drag back to the missing/stale pages so leadership feels the externality they're currently not pricing. (5) **Reward deletion and consolidation, not just creation** — explicitly value pruning stale pages, so the metric isn't page-count. The design principle: change what's *measured and rewarded* and *reduce friction*, rather than mandating volume — you get quality by making the *good* behavior the path of least resistance and the *credited* one, not by demanding more output.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Is a wrong doc better or worse than no doc?** A: Worse — the reader *trusts* it and acts on the error, and one discovered lie poisons trust in the whole corpus.
- **Q: One word for the non-negotiable attribute?** A: Accuracy — it's the gate the other attributes inherit their value from.
- **Q: Reader-rated quality, name three?** A: Useful, clear, findable.
- **Q: Functional quality, name three?** A: Accurate, complete, fresh.
- **Q: The four Diátaxis modes?** A: Tutorial, how-to, reference, explanation.
- **Q: Why is a reference that reads like a tutorial a defect?** A: It breaks the lookup contract — slow to extract facts, and likely incomplete — failing both genres at once.
- **Q: Minimalism in one line?** A: Support the reader's *action*; cut what doesn't serve the goal — less can be more.
- **Q: Most-omitted high-value content per minimalism?** A: Error recognition and recovery — "what to do when it breaks."
- **Q: Does Vale check accuracy?** A: No — only form (style, terms, structure); it can't tell you the page is *wrong*.
- **Q: Single highest-leverage process move for currency?** A: Review docs in the same PR as the code change.
- **Q: "The code is self-documenting" — true for what?** A: The *what*; it can't convey the *why* or how to *use* an API without reading internals.
- **Q: Can deleting a page improve quality?** A: Yes — removing a stale, duplicate, or contradictory page raises the corpus's truthfulness and findability.
- **Q: Why are docs chronically under-maintained?** A: Cost is immediate and on the author; benefit is deferred and on others — a textbook externality.
- **Q: Is "we wrote a lot of docs" evidence of quality?** A: No — past a point each page has negative value (dilutes search, adds maintenance, breeds contradiction).
- **Q: Does an internal throwaway tool need good docs?** A: Proportionate ones — low on polish/findability, but a short *accurate* README; fitness for purpose, not zero.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating "good docs" as one undifferentiated thing with no attributes or ranking.
- Saying a wrong doc is "at least better than nothing."
- Judging all docs by one rubric — no sense that genre sets the bar.
- Equating quality with *volume* ("we have lots of docs," "we should write more").
- Trusting a single metric ("85% helpful, so we're good") with no interrogation of bias or correctness.
- Believing a Vale/lint pass means the docs are *good*.
- Taking "the code is self-documenting" at face value, or overcorrecting to "comment everything."
- "Everyone owns the docs" with no real model of who owns *what*.
- Applying the same quality bar to a throwaway script and a public API.

**Green flags:**
- Naming the *distinction* first — accuracy-as-gate, genre-sets-the-bar, subjective-vs-objective, fitness-for-purpose.
- Insisting on *both* reader-rated and functional signals, and reasoning about what their *disagreement* means.
- Treating findability and audience fit as first-class, not afterthoughts.
- Framing minimalism correctly: cut ceremony, *invest* in error recovery — "less can be more."
- Calling deletion/consolidation a legitimate quality *win*.
- Putting doc review in the PR and splitting mechanical (lint) from judgment (human) enforcement.
- Reasoning about docs decay as an *incentive/externality* problem, not laziness.
- Calibrating the quality bar to stakes and lifespan instead of dogma.

---

## Summary

- The bank reduces to a few distinctions in costume: **accuracy vs everything else**, **genre sets the bar**, **subjective vs objective quality**, and **fitness for purpose vs more docs**. Name the distinction first; the verdict follows.
- **Quality attributes:** accuracy, findability, audience fit, clarity, completeness, currency — ranked by *dependency*, with accuracy the non-negotiable gate because a *wrong* doc is worse than none (it's trusted, acted on, and poisons trust in the whole corpus).
- **Genre:** "good" is genre-relative (Diátaxis — tutorial, how-to, reference, explanation); their criteria conflict, so a reference that reads like a tutorial is a *defect*, and you audit a page by first identifying its mode.
- **Subjective vs objective:** reader-rated (useful/clear/findable) and functional (accurate/complete/fresh) are each blind to the other's failures — you need both, and their *disagreement* is the most informative signal.
- **Minimalism:** support the reader's *action*; more docs can be *worse* (findability, maintenance, contradiction); invest the cut budget in error recovery — "minimal" means lean-toward-the-goal, not short.
- **Enforcement:** shift quality left (docs in the PR), automate the mechanical (Vale, link/sample checks, templates) and keep *truth and fitness* for human review; a green lint run is not "good docs."
- **Ownership/incentives:** engineers own accuracy and the *why*, writers own clarity and structure; chronic neglect is an *externality* (immediate cost, deferred diffuse benefit), so fix it by changing what's measured/rewarded and lowering friction — never by mandating volume.

---

## Further Reading

- *The Nurnberg Funnel: Designing Minimalist Instruction for Practical Computer Skill* — John M. Carroll. The empirical foundation for minimalism and action-oriented docs.
- [Diátaxis](https://diataxis.fr/) — Daniele Procida. The framework behind the genre-as-quality-lens; read it as a *judgment* tool, not just a template.
- *Docs for Developers* (Bhatti, Corleissen, et al.) — practical treatment of audience, reviewing, and measuring documentation quality.
- [Google Technical Writing](https://developers.google.com/tech-writing) and the [Vale](https://vale.sh/) docs — the style-guide-plus-linter approach to mechanical enforcement.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [03 — Freshness and Rot Metrics](../03-freshness-and-rot-metrics/interview.md) — currency as a measurable, enforceable property; the rot side of the accuracy gate.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/interview.md) — turning the subjective/objective signals into numbers, and pricing the externality that drives neglect.
- [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) — the tiered treatment of what makes docs good.
- [Quality Engineering README](../../README.md) — where documentation quality sits in the broader quality-engineering landscape.
