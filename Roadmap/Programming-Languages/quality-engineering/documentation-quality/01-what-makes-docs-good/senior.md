# What Makes Docs Good — Senior Level

> **Roadmap:** [Documentation Quality](../README.md) → What Makes Docs Good
> *The earlier tiers gave you a checklist of attributes — accurate, clear, complete, findable. This page is about the theory underneath: why those attributes split into two irreducible halves, why more documentation is often worse, and why a single quality model can never fully capture whether a doc is good. You stop asking "is this doc good?" and start asking "good against which model, measured how, and what does the model miss?"*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Two Quality Standards — The Standards Bodies' View (ISO/IEC 26514 & 82079)](#two-quality-standards--the-standards-bodies-view-isoiec-26514--82079)
4. [Subjective vs Objective Quality — The Two-Axis Model](#subjective-vs-objective-quality--the-two-axis-model)
5. [Minimalism — Why Exhaustive Docs Are Often Worse (Carroll)](#minimalism--why-exhaustive-docs-are-often-worse-carroll)
6. [Audience and Cognitive Load — Modeling the Reader](#audience-and-cognitive-load--modeling-the-reader)
7. [Accuracy as the Non-Negotiable — The Trust Model](#accuracy-as-the-non-negotiable--the-trust-model)
8. [Genre Fit as a Quality Property — Diátaxis as Theory](#genre-fit-as-a-quality-property--diátaxis-as-theory)
9. [Designing Quality In — Templates, Definition of Done, and Linting](#designing-quality-in--templates-definition-of-done-and-linting)
10. [The Limits of Any Quality Model](#the-limits-of-any-quality-model)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **A rigorous, named quality model for documentation — and an honest account of where the model ends and judgment begins.**

By the middle level you can list the attributes of a good doc and spot an obviously bad one. That makes you a competent reviewer. The senior jump is to hold a *model* — to know that documentation quality is not one scale but a small set of distinct, sometimes-conflicting properties, each grounded in research or standards, each with its own measurement and its own failure mode. You can say *why* a wrong sentence is worse than a missing page, *why* a "complete" reference can still be a bad doc, and *why* the tutorial that someone padded with edge cases got worse, not better.

This matters because, like code quality, documentation quality gets reduced to a single gameable number the moment nobody understands the model behind it. "90% docstring coverage" is the documentation equivalent of "90% line coverage": it measures one narrow thing and tempts everyone to optimize the proxy instead of the property. To resist that you need the actual theory — the **ISO** characteristics, **Google's** subjective/objective split, **Carroll's** minimalism, the **cognitive-load** account of audience, and **Diátaxis** as a quality theory rather than a writing template. This page is that theory. The measurable proxies — readability scores, freshness age, coverage, ROI — get their own topics; here we build the model they're proxies *for*.

> **Scope.** This is the *quality theory* of docs — what "good" means and how to reason about it. *How to actually write* a README, ADR, runbook, or reference lives in [Code Craft → Documentation](../../../code-craft/documentation/). When this page says "a tutorial must not branch," that's a quality claim; the craft of writing a non-branching tutorial is the sibling roadmap's job.

---

## Prerequisites

- **Required:** You've internalized [junior.md](junior.md) and [middle.md](middle.md) — the attribute vocabulary (accurate, complete, findable, clear, fresh, audience-fit) and the idea that "we have docs" is not a quality statement.
- **Required:** Comfort with the coverage trap from [Code Coverage](../../code-coverage/) — that a high percentage can hide low quality. The same trap reappears here, exactly.
- **Helpful:** You've owned docs someone else depended on, and watched a reader give up on a page — the felt experience the trust model formalizes.
- **Helpful:** Familiarity with [Diátaxis](../../../code-craft/documentation/) as a writing framework; this page reframes it as a quality framework.

---

## Two Quality Standards — The Standards Bodies' View (ISO/IEC 26514 & 82079)

Before reaching for ad-hoc attribute lists, it's worth knowing that documentation quality has been formalized by standards bodies for decades. Two ISO/IEC standards anchor the field, and a senior should be able to name them and what they actually cover.

**ISO/IEC 26514** — *Design and development of information for users* — is the software-documentation standard (it grew out of the older IEEE/ISO 26514 lineage and sits in the ISO/IEC/IEEE 2651x "systems and software engineering — information for users" family). It treats user documentation as a designed product with a lifecycle: audience analysis, information architecture, drafting, review, and maintenance. Its contribution to a quality model is the insistence that documentation is *engineered*, not written once — it has requirements, a design phase, and verification.

**ISO/IEC/IEEE 82079-1** — *Preparation of information for use (instructions for use) of products* — is broader (it covers instructions for any product, not just software) and is the one that enumerates **quality characteristics of information for use**. Stripped to essentials, it asks that information be:

| Characteristic | What it demands |
|---|---|
| **Complete** | Covers what the audience needs to perform the task safely and fully — no required step omitted |
| **Correct (accurate)** | Technically true; matches the actual product behavior |
| **Concise / minimal** | No more than the audience needs — explicitly an anti-bloat criterion |
| **Consistent** | Terminology, structure, and style don't shift within the corpus |
| **Comprehensible** | Matched to the audience's knowledge and reading ability |
| **Findable / accessible** | The reader can locate the right information and physically access it |

The thing to extract is *not* the exact wording (the standards revise it) but the **shape**: even a formal international standard lands on a handful of characteristics that pull in different directions — *complete* fights *concise*, *comprehensible* depends on a defined audience, *findable* is independent of all the rest. That tension is not a flaw in the standard; it is the actual structure of the problem. Any honest quality model inherits it.

> **Key insight:** The standards give you legitimacy and a vocabulary, not a verdict. ISO/IEC 82079-1 will tell you that "complete" and "concise" are both quality characteristics; it will not tell you where the line is for *your* tutorial. The value of naming the standard is that it ends the argument about *whether* these are real quality attributes — they are, formally — and moves the conversation to *how much* and *measured how*, which is where engineering judgment lives.

---

## Subjective vs Objective Quality — The Two-Axis Model

The single most useful structural idea in modern documentation quality comes from industry research — most visibly **Google's** internal work on measuring documentation quality (later written up by their tech-writing org and echoed in *Docs for Developers*). It splits quality into two axes that must be measured **separately because they fail independently**:

- **Objective (functional) quality** — properties that are *true or false about the document itself*, independent of any reader's opinion:
  - **Accurate** — the content matches reality.
  - **Complete** — it covers what it claims to cover.
  - **Fresh / current** — it reflects the current version of the thing it documents.
  These are, in principle, *verifiable* — often by machine. A code snippet either compiles or it doesn't. A documented endpoint either exists or it doesn't. A page's last-reviewed date either is or isn't within policy.

- **Subjective (reader-rated) quality** — properties that only exist *in a reader's experience*, measurable only by asking readers or watching them:
  - **Findable** — readers can locate it when they need it.
  - **Clear / readable** — readers understand it without undue effort.
  - **Useful** — it actually helped them accomplish their goal.
  These are measured with surveys, "was this helpful?" widgets, task-success studies, search-success rates, and support-ticket deflection — the subject matter of [06 — Measuring Docs ROI](../06-measuring-docs-roi/senior.md) and [05 — Readability & Information Architecture](../05-readability-and-information-architecture/senior.md).

The reason this split is load-bearing — and not just a tidy taxonomy — is that **a document can score perfectly on one axis and fail completely on the other**, and the two failures need totally different fixes:

| | High subjective | Low subjective |
|---|---|---|
| **High objective** | The goal: accurate *and* loved | Correct but unfindable/unreadable — a true page nobody can use |
| **Low objective** | **The dangerous quadrant** — beloved and wrong | Bad on every axis — at least it's honestly bad |

The top-right quadrant ("correct but unusable") is the classic engineer-written reference: every fact is right, and no one can find or follow it. The fix is information architecture and editing, not more facts. The bottom-left quadrant ("beloved and wrong") is far more dangerous: a beautifully written, highly-rated tutorial that teaches an out-of-date or incorrect approach. Readers *trust* it precisely because it scores high subjectively, which means it misleads efficiently. Optimizing the helpful-vote widget would make it *worse*.

> **Key insight:** Subjective and objective quality are orthogonal and must be tracked on separate dashboards. A single blended "doc health score" hides the one combination you most need to catch — high reader satisfaction on inaccurate content. You cannot survey your way to accuracy (readers don't know what they don't know), and you cannot lint your way to clarity (a compiler can't tell you a correct sentence is confusing). You need *both* instruments because each is blind to the other's axis.

This two-axis model is the spine of the rest of this roadmap: [02 — Testable & Executable Docs](../README.md) attacks *objective* accuracy by making snippets run in CI; [03 — Freshness & Rot Metrics](../README.md) attacks *objective* currency; [05](../05-readability-and-information-architecture/senior.md) attacks *subjective* findability and clarity; [06](../06-measuring-docs-roi/senior.md) attacks *subjective* usefulness. Knowing which axis a given technique serves is how you avoid the trap of measuring the same thing three ways while leaving the other axis dark.

---

## Minimalism — Why Exhaustive Docs Are Often Worse (Carroll)

The most counter-intuitive result in documentation theory is that **adding correct, relevant information can lower a document's quality.** This is not an opinion; it's the empirical finding behind **John M. Carroll's minimalism**, developed at IBM in the 1980s and laid out in *The Nurnberg Funnel* (1990).

The *Nürnberg funnel* is a satirical image: a mythical funnel you could pour into a learner's head to make them smart with no effort on their part. Carroll's point is that documentation built on that fantasy — pour in everything, the reader will absorb it — fails, because **learners don't behave the way exhaustive manuals assume.** His studies of people learning real software found that readers:

- **Don't read linearly.** They skip ahead, jump in to do a task, and treat the manual as a reference even when it's written as a course. Long preambles and "read this first" front-matter are mostly skipped.
- **Are action-oriented.** They want to *do* the task, immediately, and learn by doing. Pages of conceptual exposition before the first action get abandoned.
- **Make errors, and recovering from errors is where they spend their time.** Documentation that ignores errors — assuming the happy path — abandons readers exactly when they need help most.

From those observations, minimalism prescribes a different design (Carroll's four principles, paraphrased):

1. **Choose an action-oriented approach** — get readers doing real, meaningful work fast; favor tasks over comprehensive feature tours.
2. **Anchor in real tasks** — tie instruction to things the reader actually wants to accomplish, not the system's internal structure.
3. **Support error recognition and recovery** — anticipate the mistakes readers will make and tell them how to detect and undo them.
4. **Support reading-to-do, reading-to-locate** — make the doc skimmable and navigable, because that's how it'll actually be read.

The radical claim is the "less is more" one: a *shorter* manual that omits exhaustive feature coverage produced **faster task completion and better learning** than the thick, complete manual — Carroll's "minimal manual" studies repeatedly beat the comprehensive original. The mechanism is cognitive: every sentence the reader must wade through to reach the part they need is a tax, and exhaustive docs charge that tax on every reader to serve the rare one who needed the obscure detail.

> **Key insight:** Completeness and quality are not the same axis, and past a point they oppose each other. "Complete" (an objective characteristic) means *nothing required is missing*; it does **not** mean *everything possible is included*. A doc that documents every flag, every edge case, and every internal detail inline is not maximally good — it is often worse than a focused one, because it buries the 90% path under the 10% and violates the "concise/minimal" characteristic the standards also demand. The senior skill is knowing what to *leave out* (or push to reference/appendix) so the common path stays fast.

This is the theoretical reason the [coverage trap](../04-docs-coverage-and-gaps/senior.md) bites here just as it does for code: a "documented everything" metric rewards exactly the exhaustive bloat that minimalism shows degrades real usability. Coverage measures presence; minimalism is about *editing*, which coverage can't see.

---

## Audience and Cognitive Load — Modeling the Reader

Every quality characteristic that involves a reader — *comprehensible*, *clear*, *useful* — is undefined until you name the reader. "Is this clear?" has no answer; "Is this clear *to a backend engineer who has never used our SDK*?" does. So a real quality model requires an **audience model**, and the most useful one is grounded in **cognitive load**.

Cognitive-load theory (Sweller) distinguishes load the material *inherently* carries from load the *presentation* adds:

- **Intrinsic load** — the inherent difficulty of the concept itself (distributed consensus is hard no matter how well you write it).
- **Extraneous load** — load added by *how* it's presented: undefined jargon, bad ordering, a wall of prose, forcing the reader to hold five things in their head at once. This is the load good documentation *removes*.
- **Germane load** — the productive effort of actually building a mental model. The goal is to spend the reader's limited working memory here, not on extraneous load.

A document's clarity, in this framing, is precisely **how little extraneous load it imposes for its target audience** — and "for its target audience" is doing enormous work, because the same sentence is low-load for an expert and high-load for a novice.

That asymmetry produces the most important hazard for senior engineers writing docs: the **curse of knowledge** (Heath & Heath; originally Camerer et al.). Once you know something, you cannot easily simulate not knowing it. The expert author silently assumes the reader shares context they don't — skips the "obvious" setup step, uses an internal acronym undefined, jumps to the advanced form. To the author the doc is perfectly clear; to the novice it has a hole at exactly the step the author couldn't see. The curse of knowledge is *why expert-written docs systematically fail novices*, and why "I find it clear" from the author is near-worthless as a quality signal — the author is the one person guaranteed not to experience the reader's load.

The structural answer is **progressive disclosure** — treat it as a quality property, not just a UI trick. Present the minimum needed to accomplish the common case first, and let the reader *opt into* depth (advanced options, edge cases, internals) only when they want it. This serves both ends of the audience at once: the novice gets a short, low-load path; the expert can drill into the detail they came for. It is the document-structure expression of both minimalism (don't make everyone pay for the rare case) and cognitive-load management (don't overload working memory up front). Layered docs, "Basic / Advanced" splits, collapsible detail, and the tutorial→reference progression are all progressive disclosure.

> **Key insight:** A reader-facing quality attribute is meaningless without a named audience, and the author is the worst possible judge of clarity for that audience because of the curse of knowledge. This is why subjective quality must be measured *on real readers* (task-success studies, [05](../05-readability-and-information-architecture/senior.md)) and never assumed from the author's chair — and why progressive disclosure is a genuine quality property: it's the structural way to serve novice and expert from one document without overloading either.

---

## Accuracy as the Non-Negotiable — The Trust Model

Not all quality attributes are equal. Among them, **accuracy is special: it is the one whose absence makes the document worse than nothing.** A missing doc costs the reader time — they go ask a human, read the source, or experiment. A *wrong* doc costs them time *and* actively sends them in the wrong direction, often confidently. The reader follows the instruction, it fails (or worse, silently does the wrong thing), and they've now spent more effort than if the doc hadn't existed.

State it as a principle and it reorganizes your priorities:

> **A wrong doc is worse than no doc.** Absence is a known gap; inaccuracy is a trap baited with your credibility.

The deeper consequence is the **trust model**, and it is asymmetric in a way that should frighten anyone who owns docs:

- Trust in a documentation corpus is built slowly — over many small confirmations that the docs are right.
- Trust is destroyed in a single event. **One burned reader stops trusting *all* your docs**, not just the page that misled them. Having been bitten once, the rational reader now treats every page as suspect and falls back to reading the source or asking a person — which is to say, your entire documentation effort just lost its return for that reader.

This is why accuracy is the load-bearing wall of the whole quality model: the *value* of all the other attributes — clarity, findability, completeness — is **conditional on the reader trusting the content enough to act on it.** A perfectly clear, beautifully organized, fully complete page that contains one confidently-wrong instruction doesn't just fail on that instruction; it taxes the credibility of everything around it. Subjective quality without objective accuracy is not neutral — it's *dangerous*, because polish makes the wrong thing more persuasive (the "beloved and wrong" quadrant again).

Two senior conclusions follow:

1. **Accuracy must be defended mechanically, not by good intentions.** Humans cannot manually keep prose in sync with changing code; drift is the default. The only durable defenses are *making docs executable* so they can't silently lie ([02 — Testable & Executable Docs](../README.md): doctests, Go testable examples, rustdoc tests, snippet runners in CI) and *measuring rot* so staleness surfaces before a reader hits it ([03 — Freshness & Rot Metrics](../README.md)). These topics exist precisely because accuracy is non-negotiable and unsustainable by hand.
2. **When in doubt, delete or flag.** Given the trust model, a page you can't vouch for is a liability, not an asset. An honestly-empty section ("not yet documented") is safer than a confidently-stale one, because it doesn't spend trust. "We have docs" can be *negative* quality if those docs are wrong.

> **Key insight:** Treat accuracy as a gate, not a dial. The other attributes are dials you tune for diminishing returns; accuracy is a binary gate that, when it fails, doesn't just zero out *that* document — it discounts the trust on your entire corpus. This is the theoretical justification for spending disproportionate quality engineering effort (executable docs, freshness automation) on the *true/false* axis rather than the *nice-to-read* axis.

---

## Genre Fit as a Quality Property — Diátaxis as Theory

The final structural attribute is the least obvious: **a document can be accurate, clear, complete, and findable, and still be defective because it is the wrong *kind* of document for its purpose.** This is the contribution of **Daniele Procida's Diátaxis** — usually taught as a writing framework, but more powerfully understood here as a **quality theory**.

Diátaxis observes that technical documentation serves four distinct needs, defined by two axes (what the reader is doing: *acquiring skill* vs *applying skill*; and what serves them: *practical steps* vs *theoretical knowledge*):

| Mode | Reader's need | Orientation | Failure if mixed in |
|---|---|---|---|
| **Tutorial** | *Learning* by doing | Practical, study | A tutorial that stops to explain theory or branches into options |
| **How-to guide** | *Achieving a goal* | Practical, work | A how-to that teaches concepts instead of giving the steps |
| **Reference** | *Looking up* facts | Theoretical, work | A reference padded with tutorials or opinions |
| **Explanation** | *Understanding* why | Theoretical, study | An explanation cluttered with step-by-step procedure |

The quality claim — and this is the part that turns Diátaxis from style advice into a defect model — is that **mixing modes within one document is a quality defect**, because each mode has *opposite* obligations:

- A **tutorial** must be a guaranteed-success guided path: no choices, no "it depends," no detours into why. Its job is to give a beginner a confidence-building win. The moment it branches ("if you're using X do this, otherwise that") or stops to explain internals, it fails the learner — it raises cognitive load for exactly the audience least able to absorb it (the curse-of-knowledge and cognitive-load sections explain *why* this hurts).
- A **reference** must be austere, complete, and consistent so an expert can scan it. The moment it injects narrative or opinion, it becomes slow to scan — it fails the look-it-up reader.
- A **how-to** assumes competence and gives the goal-directed recipe; padding it with teaching slows the practitioner.
- An **explanation** is free to discuss alternatives and rationale; forcing procedure into it kills the discussion.

So "genre fit" is a real, checkable quality property: *does this document do one job, and does its form match that job?* A page that tries to be tutorial-and-reference-and-explanation at once serves none of those readers well — it's the documentation analog of a function that does three things. This is why the README's quality table lists "quality criteria *per doc type*": the bar for a good reference is **different** from the bar for a good tutorial, and judging one by the other's standard is itself an error.

> **Key insight:** Quality is *genre-relative*. There is no universal "good doc"; there is a good tutorial, a good reference, a good how-to, a good explanation, each with its own obligations — and a document that blurs modes is defective *regardless* of how accurate or clear its individual sentences are. Diátaxis is therefore not just a way to organize docs; it's a way to *diagnose* them: identify the mode, then judge against that mode's standard, and flag mode-mixing as a defect.

The craft of *writing* within each mode — how to structure an ADR, a runbook, a reference page — is the sibling roadmap's domain: [Code Craft → Documentation](../../../code-craft/documentation/). This page's job is only to establish that *fitting the genre is a quality attribute* and mode-mixing is a defect class you can look for.

---

## Designing Quality In — Templates, Definition of Done, and Linting

A quality model is inert until it's built into the production process. The senior move is to stop *inspecting* quality at the end (review catches some defects, late, expensively) and **design quality in** — exactly as you'd shift testing left rather than relying on end-of-line QA. Three mechanisms, in increasing order of automation:

**1. Templates that enforce structure.** A blank page invites mode-mixing and omission; a template encodes the genre's obligations. An ADR template with fixed sections (Context / Decision / Status / Consequences) makes it hard to write a *bad-shaped* ADR — the structure is the quality floor. A runbook template that forces "symptoms / diagnosis / remediation / escalation" prevents the runbook that's all prose and no actionable step. Templates operationalize genre fit: by giving each doc type its own skeleton, they make the right shape the path of least resistance.

**2. A Definition of Done for docs.** Borrow the agile DoD idea: a doc isn't "done" when the prose exists; it's done when it meets explicit, checkable criteria. A reasonable DoD encodes the model's checkable parts, e.g.:
- Code snippets execute (tied to [02 — Testable & Executable Docs](../README.md)).
- Links resolve (a [freshness](../README.md) check).
- It declares its audience and its Diátaxis mode (forces the author to commit to a genre).
- It has an owner and a review-by date (so [rot](../README.md) is detectable).
- A second person can complete the described task using only the doc (a cheap subjective-quality gate that defeats the curse of knowledge).

**3. Automated linting for the machine-checkable attributes.** Some quality is enforceable in CI with zero human effort, and a senior pushes everything that *can* be automated into the pipeline so review can focus on what can't:
- **Prose linters** (e.g. **Vale**) enforce *consistency* — terminology, banned phrases, style-guide rules — the ISO "consistent" characteristic, mechanized.
- **Link checkers** enforce a slice of *freshness*.
- **Executable-snippet runners / doctests** enforce a slice of *accuracy*.
- **Docstring/API coverage tools** (interrogate, godoc gaps, JSDoc) measure *presence* — with the standing caveat below.

> **Key insight:** You cannot lint your way to a good doc, but you can lint your way to a non-*broken* one — and that's the right division of labor. Push the objective, machine-checkable attributes (snippets run, links resolve, terms consistent, presence measured) into automation so they're enforced cheaply and uniformly; reserve scarce human review for the attributes machines are blind to (is it clear? is it the right genre? is it useful? did it leave out the right things?). Designing quality in means the pipeline guards the floor so reviewers can raise the ceiling.

The standing caveat — and it's the same trap as code coverage — is that **coverage and lint pass-rates measure the proxy, not the property.** 100% docstring coverage with one-line restatements of the function name ("`getUser` — gets the user") passes the metric and teaches nothing; Vale-clean prose can still be confusing; all links resolving says nothing about whether the content is right. Automation enforces the *necessary* conditions, never the *sufficient* one. Which is the bridge to the last section.

---

## The Limits of Any Quality Model

A senior holds the model *and* its boundary. Every framework on this page — ISO characteristics, the subjective/objective split, minimalism, cognitive load, Diátaxis — is a lens that makes some defects visible. None of them, alone or together, fully captures "is this doc good," and pretending otherwise produces its own failure mode: optimizing the model instead of the goal.

The limits, concretely:

- **Documentation serves humans, and some quality is irreducibly qualitative.** Whether a tutorial *feels* welcoming, whether an explanation gives the reader a genuine "aha," whether the tone respects the reader's time — these are real quality, and no metric captures them. The map is not the territory; the model is not the doc.
- **Every metric is a proxy, and proxies get gamed (Goodhart's law).** "When a measure becomes a target, it ceases to be a good measure." Docstring coverage, readability scores, helpful-vote rates, freshness age — each is a *signal* that correlates with quality until you make it a target, at which point people optimize the number. Readability scores (Flesch-Kincaid, Gunning fog — [05](../05-readability-and-information-architecture/senior.md)) are the textbook case: you can lower the grade level by chopping sentences into fragments and make the prose *worse* while the score *improves*. The number is a thermometer, not the patient.
- **The axes genuinely conflict, so there's no global maximum — only a chosen balance.** Complete vs concise. Thorough vs low-load. Precise vs accessible. A quality "score" that blends them hides the tradeoff you actually have to make for *this* audience and *this* genre. The model tells you *which* dials exist; it can't tell you the setting.
- **Context dominates.** The right balance for a public API consumed by thousands differs from an internal runbook read by five SREs at 3am. Same model, different weights. "Good" is always *good-for-this-purpose-and-audience*, which is a judgment the model frames but does not make.

> **Key insight:** Use the model to make defects *visible and discussable*, not to render a verdict. Its job is to turn "this doc feels off" into "this is a reference that's drifted into tutorial mode and three of its snippets no longer compile" — specific, actionable, often measurable. But the final call on whether a doc is *good* is a human judgment about whether it served a human, and the most dangerous thing a quality model can do is convince you the number is the answer. Hold the frameworks confidently and the metrics skeptically.

This is the same intellectual honesty the rest of [Quality Engineering](../../) demands of code metrics: the numbers are *evidence*, the model is *structure*, and judgment is irreducible. A senior who can name the frameworks *and* their limits is exactly the person who can run a documentation quality program without it collapsing into a coverage-number theater.

---

## Mental Models

- **Quality is two orthogonal axes, not one scale.** Objective (accurate, complete, fresh — verifiable, often by machine) and subjective (findable, clear, useful — only readers can rate). They fail independently; track them separately. The "beloved and wrong" quadrant is the one a blended score hides.

- **Completeness is not maximization.** "Complete" means *nothing required is missing*; it does not mean *everything possible is included*. Past a point, more correct content *lowers* quality (Carroll's minimalism). The skill is editing *out*, not piling *in*.

- **Clarity is extraneous-load removal, for a named audience.** A doc is clear when it imposes minimal extraneous cognitive load *for its target reader*. "Clear" with no audience is undefined, and the author — cursed with knowledge — is the worst judge of it.

- **Accuracy is a gate, not a dial.** Other attributes tune for diminishing returns; accuracy, when it fails, discounts trust across the *entire* corpus. One burned reader stops trusting all your docs. A wrong doc is worse than no doc.

- **Quality is genre-relative.** There's no universal good doc — only a good tutorial, reference, how-to, explanation, each with opposite obligations. Mode-mixing is a defect regardless of sentence-level quality (Diátaxis as a defect model).

- **The model makes defects visible; it does not render the verdict.** Every metric is a proxy that Goodharts the moment it's a target. Hold the frameworks confidently and the numbers skeptically; "good" is finally a human judgment about whether a human was served.

---

## Common Mistakes

1. **Collapsing quality into one number.** A blended "doc health score" averages away the orthogonal axes and hides the dangerous quadrant — high reader satisfaction on inaccurate content. Report objective and subjective quality on *separate* dashboards.

2. **Equating completeness with quality.** Documenting every flag, edge case, and internal inline produces an exhaustive doc that's *worse* than a focused one — it buries the common path and violates the concise/minimal characteristic. Completeness means nothing *required* is missing, not everything possible is present.

3. **Trusting the author's "I find it clear."** The curse of knowledge guarantees the author can't simulate the target reader's load. Clarity is a *subjective* attribute that must be measured on real readers (task-success, a second person completing the task), never asserted from the author's chair.

4. **Treating accuracy as one attribute among equals.** It isn't — its failure poisons trust in everything else. Spend disproportionate quality-engineering effort (executable docs, freshness automation) on the true/false axis, and prefer an honest gap to a confident staleness.

5. **Judging every doc by one standard.** Grading a reference for "engagement" or a tutorial for "completeness" applies the wrong genre's bar. Identify the Diátaxis mode first, then judge against *that* mode's obligations; flag mode-mixing as its own defect.

6. **Believing the lint pass means the doc is good.** Vale-clean, all-links-resolve, 100% docstring coverage enforce *necessary* conditions, never the *sufficient* one. Automation guards the floor (objective, machine-checkable); humans must still raise the ceiling (clear, right-genre, useful, well-edited).

7. **Optimizing the proxy.** Lowering Flesch-Kincaid grade by fragmenting sentences, padding docstring coverage with name-restatements, gaming helpful-votes — all improve a number while degrading the property (Goodhart). Metrics are evidence, not targets.

---

## Test Yourself

1. Documentation quality splits into two axes that fail independently. Name them, give two attributes of each, and explain which combination a single blended score most dangerously hides.
2. State the principle "a wrong doc is worse than no doc" and explain the *trust model* that makes it true. What's the asymmetry?
3. Carroll's minimalism claims a *shorter* manual can be *better*. Why — and what does this say about the relationship between "complete" and "good"?
4. Why is "is this doc clear?" an ill-formed question, and why is the author the worst person to answer it? Name the cognitive bias.
5. Two documents are each accurate, complete, and clear, yet one is defective. Using Diátaxis, explain how that's possible.
6. You want to "design quality in" rather than inspect it at review. Give one mechanism each for: enforcing genre, defining "done," and automating an objective attribute — and name an attribute that *cannot* be automated.
7. Your org adopts "average readability grade" as a documentation OKR. Predict the failure mode and name the law that governs it.

<details>
<summary>Answers</summary>

1. **Objective (functional)** — accurate, complete, fresh; verifiable, often by machine. **Subjective (reader-rated)** — findable, clear, useful; only readers can rate them (surveys, task-success, deflection). A blended score most dangerously hides **high subjective + low objective** — the "beloved and wrong" doc: highly rated, confidently inaccurate, which misleads efficiently because readers trust it.

2. A *missing* doc costs the reader time (they go find the answer elsewhere); a *wrong* doc costs time *and* actively sends them the wrong way, often confidently — net worse than absence. The **trust model**: trust in a corpus is built slowly over many confirmations but destroyed in one event — **one burned reader stops trusting all your docs** and reverts to reading source/asking people. The asymmetry is slow-to-build, instant-to-destroy, and *corpus-wide* not page-local — so accuracy is a gate whose failure discounts everything else.

3. Real readers don't read linearly, are action-oriented, and spend their time on error recovery. Exhaustive docs tax *every* reader with content that serves the *rare* one, raising cognitive load and delaying the task — so Carroll's minimal manuals produced faster task completion and better learning. Therefore **"complete" ≠ "good"**: complete means nothing *required* is missing; past that point, adding correct content *lowers* quality. Good docs are *edited*, not maximal.

4. "Clear" is a *subjective*, reader-relative attribute — undefined without a named audience (a sentence is low-load for an expert, high-load for a novice). The author is the worst judge because of the **curse of knowledge**: once you know something you can't simulate not knowing it, so you can't perceive the load/holes a novice hits. Clarity must be measured on real target readers, not asserted by the author.

5. **Diátaxis**: each mode (tutorial / how-to / reference / explanation) has *opposite* obligations. A document can have accurate, clear, complete sentences yet **mix modes** — e.g. a reference that breaks into tutorial narrative, or a tutorial that branches and stops to explain internals. It then serves none of its readers well; mode-mixing is a defect *regardless* of sentence-level quality. Quality is genre-relative.

6. **Genre:** templates that encode each genre's structure (ADR sections, runbook symptoms/diagnosis/remediation). **Done:** a Definition of Done for docs (snippets run, links resolve, audience+mode declared, owner+review-date, a second person can do the task). **Automate an objective attribute:** executable snippets/doctests in CI (accuracy), link checkers (freshness), Vale (consistency), coverage tools (presence). **Cannot be automated:** clarity / usefulness / right-genre / good-editing — the subjective, judgment attributes a machine is blind to.

7. People will lower the grade by chopping sentences into fragments and simplifying vocabulary — improving the *number* while making the prose *worse* (less precise, choppier, sometimes less accurate). Governed by **Goodhart's law**: "when a measure becomes a target, it ceases to be a good measure." Readability is a thermometer, not the patient; it's a signal, never an OKR target.

</details>

---

## Cheat Sheet

```
THE TWO-AXIS MODEL (track separately!)
  OBJECTIVE (functional, verifiable)   accurate · complete · fresh
    → defend with: executable docs (02), freshness/rot metrics (03), coverage (04)
  SUBJECTIVE (reader-rated, surveyed)  findable · clear · useful
    → defend with: info architecture (05), ROI / task-success (06)
  DANGER QUADRANT: high subjective + low objective = "beloved and wrong"

STANDARDS VOCABULARY
  ISO/IEC 26514         software user docs as an engineered, lifecycle product
  ISO/IEC/IEEE 82079-1  quality characteristics of information for use:
                        complete · correct · concise · consistent · comprehensible · findable
  (note: complete ⟷ concise and comprehensible⟶audience are built-in tensions)

MINIMALISM (Carroll, The Nurnberg Funnel)
  readers: skip, act first, learn by doing, live in error-recovery
  principles: action-oriented · real tasks · error recovery · reading-to-do
  "less is more": shorter manual → faster tasks. COMPLETE ≠ MAXIMAL.

AUDIENCE / COGNITIVE LOAD
  clarity = minimal EXTRANEOUS load for a NAMED audience
  curse of knowledge → author is the worst judge of clarity
  progressive disclosure = quality property: common case first, depth on demand

ACCURACY = A GATE, NOT A DIAL
  wrong doc is WORSE than no doc; one burned reader distrusts the WHOLE corpus
  → defend mechanically (CI), prefer an honest gap to a confident staleness

GENRE FIT (Diátaxis as a defect model — judge per mode)
  tutorial(learn) · how-to(goal) · reference(look-up) · explanation(why)
  MIXING MODES = a defect, regardless of sentence quality

DESIGN QUALITY IN (shift-left)
  templates (enforce genre) · doc DoD (checkable "done") · CI lint (Vale/links/doctests)
  lint guards the FLOOR (objective); humans raise the CEILING (subjective)

LIMITS
  every metric is a proxy → Goodhart's law (target ⟹ gamed)
  axes conflict (no global max) · context sets the weights · some quality is irreducible
  model makes defects VISIBLE; judgment renders the VERDICT
```

---

## Summary

- **Documentation quality is a small set of distinct properties, not one scale.** The standards bodies formalize this (**ISO/IEC 26514** treats docs as engineered products; **ISO/IEC/IEEE 82079-1** enumerates complete/correct/concise/consistent/comprehensible/findable), and the characteristics genuinely pull against each other — that tension is the structure of the problem, not a defect.
- **The most useful split is objective vs subjective quality** (Google's research, *Docs for Developers*): functional properties (accurate, complete, fresh — often machine-verifiable) and reader-rated ones (findable, clear, useful — only surveyable). They fail independently; a blended score hides the "beloved and wrong" quadrant. The rest of the roadmap is organized by which axis each technique serves.
- **Completeness is not maximization** (**Carroll's minimalism**, *The Nurnberg Funnel*): real readers skip, act first, and live in error-recovery, so exhaustive docs are often *worse* than focused ones. "Complete" = nothing required missing; good docs are edited *down*.
- **Reader-facing quality is undefined without a named audience.** Clarity is extraneous-cognitive-load removal *for that audience*; the **curse of knowledge** makes the author the worst judge, which is why subjective quality must be measured on real readers, and why **progressive disclosure** is itself a quality property.
- **Accuracy is the non-negotiable gate.** A wrong doc is worse than no doc; the trust model is asymmetric — one burned reader distrusts the whole corpus — so accuracy must be defended *mechanically* (executable docs, freshness automation), and an honest gap beats a confident staleness.
- **Quality is genre-relative** (**Diátaxis** as a defect model): tutorial/how-to/reference/explanation have opposite obligations, and mode-mixing is a defect regardless of sentence quality.
- **You design quality in** (templates, a doc Definition of Done, CI linting) so automation guards the objective floor and humans raise the subjective ceiling — **but every metric is a proxy that Goodharts when targeted**, the axes conflict so there's no global maximum, and some quality is irreducibly qualitative. The model makes defects visible; judgment renders the verdict.

You now hold a named, defensible quality model *and* its boundary. The next pages turn its axes into instruments: [05 — Readability & Information Architecture](../05-readability-and-information-architecture/senior.md) for the subjective axis, and [06 — Measuring Docs ROI](../06-measuring-docs-roi/senior.md) for the hardest subjective property of all — usefulness.

---

## Further Reading

- *The Nurnberg Funnel: Designing Minimalist Instruction for Practical Computer Skill* — John M. Carroll. The foundational empirical case that less is more, and that error-recovery and action-orientation beat exhaustive coverage.
- *Docs for Developers* — Bhatti, Corleissen, Lambourne, Nunez & Waters. The industry synthesis; carries the subjective/objective framing and measurement practices into developer docs.
- **Diátaxis** — Daniele Procida, [diataxis.fr](https://diataxis.fr/). The four-mode framework; read here as a *quality/defect* theory, not only an authoring guide.
- **ISO/IEC/IEEE 82079-1** *Preparation of information for use* and **ISO/IEC/IEEE 26514** *Design and development of information for users* — the formal quality-characteristic vocabularies.
- The **Google Developer Documentation Style Guide** and Google's writing on measuring documentation quality — the objective/subjective split in practice at scale.
- *Cognitive Load During Problem Solving* — John Sweller; and *Made to Stick* (Heath & Heath) for the curse of knowledge — the theory under "clarity is audience-relative."

---

## Related Topics

- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the same topic at adjacent depths (attributes → applied review → quality model → org-scale program).
- [05 — Readability & Information Architecture](../05-readability-and-information-architecture/senior.md) — instruments for the *subjective* axis: readability formulas (and their limits), findability, progressive disclosure.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/senior.md) — the hardest subjective property, *usefulness*: ticket deflection, time-to-first-success, and not gaming the proxy.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *how* to author each genre (Diátaxis modes, ADRs, runbooks, references) whose *quality* this page defines.
