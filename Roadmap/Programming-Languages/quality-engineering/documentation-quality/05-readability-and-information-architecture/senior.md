# Readability & Information Architecture — Senior Level

> **Roadmap:** [Documentation Quality](../README.md) → Readability & Information Architecture
> *The middle page gave you the tools: Flesch-Kincaid, Vale, a heading hierarchy, progressive disclosure. This page is about the theory underneath them — why readability formulas are weak proxies for comprehension, how cognitive-load theory actually predicts what makes a doc easy, why information foraging governs whether anyone finds the page at all, and why for most readers your search box, not your nav tree, is your real information architecture.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Why Readability Formulas Are Weak Proxies](#why-readability-formulas-are-weak-proxies)
4. [The Cognitive-Load Model of Readability](#the-cognitive-load-model-of-readability)
5. [The Expertise-Reversal Effect — Why Audience Is a Readability Property](#the-expertise-reversal-effect--why-audience-is-a-readability-property)
6. [Information Foraging — Readers Follow the Scent](#information-foraging--readers-follow-the-scent)
7. [IA Structures at Scale — Taxonomy, Facets, Search-First](#ia-structures-at-scale--taxonomy-facets-search-first)
8. [Every Page Is Page One — Topic-Based Authoring and Diátaxis as a Cognitive Boundary](#every-page-is-page-one--topic-based-authoring-and-diátaxis-as-a-cognitive-boundary)
9. [Search Is the Real IA](#search-is-the-real-ia)
10. [Measuring IA Empirically](#measuring-ia-empirically)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **The cognitive science a senior engineer reasons about when "make the docs more readable" stops meaning "shorten the sentences" and starts meaning "reduce what the reader's working memory has to hold, and strengthen the scent that gets them to the right page."**

By the middle level you can run a Flesch-Kincaid pass, lint prose with Vale, build a clean heading hierarchy, and hide detail behind progressive disclosure. That makes you competent. The senior jump is understanding *why those tools work when they work and lie when they lie* — because the moment you put a readability score in a dashboard, someone optimizes the score instead of the reader, and you need to know exactly why that's a trap.

Readability and information architecture are usually taught as two subjects. They are one subject seen at two scales. **Readability** is the cognitive cost of a single page once you're on it; **information architecture** is the cognitive cost of *getting to* that page across the whole corpus. Both are governed by the same fact: human working memory holds only a few items at once, and every avoidable demand on it — a sentence that nests four clauses, a heading that gives no hint of what's below it, a nav tree that forces you to model the authors' org chart — is a tax the reader pays in comprehension or in giving up.

This page grounds all of that in the actual research: **Sweller's cognitive-load theory** (why extraneous load is the enemy), the **expertise-reversal effect** (why the same page can be perfectly readable for a novice and actively annoying for an expert), **Pirolli and Card's information-foraging theory** (why readers behave like predators following a scent), and the honest, well-documented **critique of readability formulas** (why a grade-level number is at best a relative trend, never a target). The throughline is the same one that runs through the rest of [Quality Engineering](../../): the moment a proxy metric becomes a goal, it stops measuring the thing you cared about.

---

## Prerequisites

- **Required:** You've internalized [middle.md](middle.md) — readability formulas mechanically, plain-language editing, heading hierarchy, progressive disclosure, minimalism.
- **Required:** You've read [01 — What Makes Docs Good](../01-what-makes-docs-good/senior.md) and can name the quality attributes (accuracy, completeness, findability, clarity, audience-fit, currency) as distinct, separately-measurable things.
- **Helpful:** A working familiarity with [the Diátaxis framework](../../../code-craft/documentation/) — tutorial / how-to / reference / explanation as four distinct modes, not four labels.
- **Helpful:** You've watched a real user fail to find something in docs you wrote, and felt the gap between "it's documented" and "they found and understood it."

---

## Why Readability Formulas Are Weak Proxies

Flesch Reading Ease, Flesch-Kincaid Grade Level, Gunning fog, SMOG, Coleman-Liau, ARI — they look like they measure comprehension. They do not. Every one of them is a regression fit over exactly two surface features: **average word length** (in syllables or characters) and **average sentence length** (in words). Flesch-Kincaid is literally `0.39 × (words/sentence) + 11.8 × (syllables/word) − 15.59`. That is the whole model. There is no term for whether the content is logically ordered, whether the example is relevant, whether the reader has the prerequisites, or whether the words — short though they may be — name concepts the reader has never met.

This is not a knock invented by skeptics; it's baked into the formulas' own history. They were built for *general prose at school grade levels* — Flesch in 1948 for adult literacy and journalism, Kincaid in 1975 to grade U.S. Navy training manuals, SMOG and Gunning fog for similar plain-prose contexts. They were validated against readers' comprehension of *ordinary sentences*. None of them was ever calibrated on technical documentation, and technical documentation violates their core assumptions in three specific ways:

- **Identifiers and code wreck the syllable count.** `getUserByID`, `kubectl`, `idempotent`, `OAuth2` — the formulas either treat these as monstrous multi-syllable words (inflating "difficulty") or, if you strip code blocks, throw away the very tokens that carry the meaning. A precise API reference can score as "graduate level" purely because the correct nouns are long.
- **Domain jargon is invisible to the model.** "The mutex guards the shared queue" and "the fluffy cat sat on the mat" have nearly identical readability scores. One is trivial to a systems programmer and opaque to everyone else; the formula cannot tell them apart, because it never looks at *what the words mean to this reader* — only how long they are.
- **Sentence length is a blunt instrument.** "Initialize the client, then call `connect()`" is two short clauses and entirely clear. "Don't not disable the flag unless idempotency is off" is short and incomprehensible. Short ≠ clear; long ≠ unclear. The formula rewards the second sentence and would penalize a long, perfectly-ordered explanatory sentence that a senior reader finds *easier* than three choppy fragments.

The correlation between any of these scores and *actual reader success* — task completion, comprehension, time-to-answer — is loose and context-dependent. That is the heart of it: a formula measures **surface form**, and comprehension is dominated by **content, structure, and the reader's prior knowledge**, none of which the formula sees.

So is the number useless? No — it's useful exactly the way a thermometer is useful and a thermostat is dangerous. The honest uses are three: a **relative trend** (this page got a lower grade-level after editing — weak evidence it got simpler, worth a human look), **outlier detection** (this one page scores grade-22 while the rest of the section sits at grade-11 — go read it; probably a runaway sentence or an accidental wall of jargon), and a **cheap, automatable lint signal** that flags candidates for human review. The dangerous use is the one that always gets proposed: making "Flesch-Kincaid ≤ 9" a CI gate or an OKR. The instant it's a target, writers chop sentences at clause boundaries and swap precise long words for vague short ones — the score improves and the prose gets *worse*. This is **Goodhart's Law**, the same failure that turns code coverage into assertion-free tests: *when a measure becomes a target, it ceases to be a good measure.*

> **Key insight:** A readability formula measures the *form* of the text, never the comprehension of the reader. Use it as a trend line and an outlier detector that nominates pages for human judgment — never as a gate or a goal. The day "grade-level ≤ N" becomes a target, your writers will optimize the formula and degrade the docs, because the cheapest way to lower the number is to shorten and dumb down, not to clarify.

---

## The Cognitive-Load Model of Readability

If formulas don't explain readability, what does? The strongest theory we have is **cognitive-load theory (CLT)**, developed by **John Sweller** from the 1980s on. Its starting premise is a hard limit of human cognition: **working memory is tiny** — on the order of a handful of novel elements at once, and they decay in seconds — while **long-term memory is effectively unlimited**. Learning and comprehension happen when working memory successfully processes new material and integrates it into long-term memory as **schemas** (chunked mental models). Anything that consumes working-memory capacity *without* contributing to building those schemas is pure waste. Reading a doc is exactly this process: the reader is trying to build a schema of your system, and working memory is the bottleneck.

CLT splits the load on working memory into three kinds, and the distinction is the whole point:

- **Intrinsic load** — the inherent difficulty of the material itself, given the reader's current expertise. Explaining distributed consensus is intrinsically harder than explaining a `for` loop. You can *sequence* and *chunk* intrinsic load (teach the parts before the whole) but you can't wish it away; some of it is the subject.
- **Extraneous load** — load imposed by *how the material is presented*, contributing nothing to understanding. A diagram on page 3 referenced by text on page 1 (forcing the reader to hold one while hunting the other — the **split-attention effect**); a heading that hides rather than reveals; inconsistent terminology that makes the reader re-check whether "client" and "consumer" mean the same thing; a wall of prose where a table belonged. **This is the load good documentation exists to eliminate.**
- **Germane load** — the productive effort of actually building the schema: working an example, connecting a new idea to one you already hold. You *want* the reader spending capacity here. The design goal is to free up capacity by cutting extraneous load so more of the reader's fixed budget goes to germane work.

Read that list again with a documentation eye and you have a *mechanistic* definition of readability that the formulas can't give you: **a readable doc minimizes extraneous load so that the reader's scarce working memory is spent on intrinsic and germane load — on the actual subject and on understanding it.** Every classic documentation technique is, underneath, an extraneous-load reduction:

- **Signaling** (the *signaling principle*): headings, bolding, summaries, "TL;DR" boxes, and call-outs that flag what matters so the reader doesn't burn capacity figuring out where to look. This page's `> **Key insight:**` boxes are signaling.
- **Worked examples** (the *worked-example effect*): a fully worked example imposes far less load on a novice than "figure it out from the reference," because it doesn't force means-ends search through a huge problem space. A copy-pasteable, runnable snippet is a worked example.
- **Spatial contiguity / no split attention:** put the label on the diagram, the explanation next to the code, the caption under the figure — so working memory doesn't have to hold one element while scanning for its partner.
- **Coherence / minimalism:** every irrelevant sentence, decorative aside, or "interesting but off-topic" paragraph is extraneous load. John Carroll's **minimalism** (*The Nurnberg Funnel*) is cognitive-load theory applied before the term was popular: cut everything that isn't serving the reader's immediate task.
- **Chunking and progressive disclosure:** break intrinsic load into working-memory-sized pieces and reveal them in order, so the reader is never holding more elements than they can process.

> **Key insight:** Readability is not a property of sentences; it's a property of *working-memory cost*. Reframe every editing decision as "does this raise or lower extraneous load?" That question — not the grade-level score — is what predicts whether a real reader will get through the page. Formulas can't see extraneous load at all, which is precisely why they're weak proxies.

---

## The Expertise-Reversal Effect — Why Audience Is a Readability Property

Here is the result that turns "readability" from a single number into a *function of the reader*, and it falls straight out of cognitive-load theory. The **expertise-reversal effect** (Kalyuga, Ayres, Chandler, and Sweller) is one of the most replicated findings in instructional research: **instructional support that helps novices actively hinders experts — and vice versa.**

The mechanism is clean. A worked example, a step-by-step walkthrough, lots of explanatory scaffolding — these reduce extraneous load *for a novice who has no schema yet*. But an expert already *has* the schema. For them, that same scaffolding is now **redundant information** they must process and reconcile against what they already know — which is itself extraneous load (the **redundancy effect**). The expert reading a 40-step tutorial to do a thing they understand isn't being helped; they're being slowed down and irritated, forced to wade through "first, what is a database" to reach the one flag they came for.

This is the rigorous justification for something documentation practitioners assert as a rule of thumb — **know your audience** — and it elevates it from etiquette to a measurable readability property: *the same document has different readability for different readers, and there is no audience-independent "readable."* Concretely:

- A **tutorial** (Diátaxis) is correctly heavy on scaffolding, worked examples, and reassurance — its audience is novices, for whom that support cuts load.
- A **reference** is correctly terse, complete, and scaffolding-free — its audience is practitioners who have the schema and want the fact, for whom scaffolding is redundancy. Padding a reference with tutorial-style hand-holding makes it *less* readable for its actual audience.
- Mixing the two — a reference that keeps re-explaining basics, a tutorial that assumes you already know the system — fails *both* audiences simultaneously, because what reduces load for one raises it for the other.

This is also why "just write it more simply" is wrong as universal advice. Simplifying past the point your audience needs *adds* redundancy load for them. The senior move is not "make it simpler" but "**target the load to the audience's expertise**" — which is exactly what the Diátaxis split institutionalizes, and the cognitive reason that split is more than a filing convention.

> **Key insight:** There is no audience-independent readability. The expertise-reversal effect proves that scaffolding which reduces a novice's load *is* extraneous load for an expert. "Readable" is always "readable *for this reader*," which makes audience-targeting a hard readability property, not a soft preference — and is the cognitive-science foundation under Diátaxis's separation of tutorials from reference.

---

## Information Foraging — Readers Follow the Scent

So far we've reasoned about a single page. But readability is worthless if the reader never reaches the page — and reaching it is governed by a different theory entirely. **Information-foraging theory**, developed by **Peter Pirolli and Stuart Card at PARC** in the 1990s, models information-seeking on **optimal foraging theory** from ecology: just as a predator evolved to maximize energy gained per energy spent hunting, a reader behaves to maximize useful information gained per unit of effort spent looking.

The load-bearing concept is **information scent**: the reader judges, from *proximal cues* (link text, a heading, a snippet, a breadcrumb, a search-result title), how likely a path is to lead to the *distal content* they actually want. They don't read everything and choose; they follow the scent that smells strongest, at every decision point, the way an animal follows the strongest trace of prey. Two predictions follow directly, and both are about your IA:

- **Readers follow the strongest scent, not the correct path.** If a tempting-but-wrong link has stronger scent than the right one, they take the wrong one — then assess, backtrack, and re-forage. Weak or misleading link text doesn't just fail to help; it actively misroutes.
- **Readers leave a "patch" when the scent drops.** Optimal foraging predicts a forager abandons a depleting patch for a richer one. Translated: when a page or a section stops smelling like it contains the answer — vague headings, no obvious next step, walls of undifferentiated text — the reader **gives up on it and leaves** (often to a search engine, often to a competitor's docs). The "patch" you're competing against is the back button.

This reframes information architecture with surgical precision: **IA quality is the strength and accuracy of information scent at every decision point.** Good IA is not a tidy tree that pleases the authors; it's a structure where, at every fork, the cues honestly and strongly signal which branch holds what the reader wants. That immediately indicts the most common IA failures as *scent* failures:

- **Vague headings** ("Overview," "Advanced," "Miscellaneous," "Notes") emit no scent — the reader can't tell what's under them, so a correct path is invisible.
- **Weak link text** ("click here," "this page," "documentation") strips the proximal cue of all meaning; the link can't advertise its destination, so the reader can't smell the right path.
- **Clever, cute, or branded labels** ("Project Apollo," "the Foundry") have strong scent *only* for insiders. To everyone else they're scentless. Jargon-as-navigation is a foraging dead end.
- **Burying the distinguishing word.** "Configuring the production deployment pipeline" carries scent in its first words; "A guide to some things you might want to do" carries none until far too late. Front-load the words that distinguish this path from its siblings.

> **Key insight:** Findability is a foraging problem, and the unit of IA quality is *information scent* at each decision point. Every heading, link, and title is a scent cue the reader uses to decide whether to proceed, and a wrong-but-strong cue misroutes while a weak cue causes abandonment. Optimizing IA means making the scent at every fork strong *and* honest — because readers don't find the best page, they follow the best-smelling path and leave the moment the scent fades.

---

## IA Structures at Scale — Taxonomy, Facets, Search-First

Once a corpus grows past a few dozen pages, *how* you organize it becomes a real architectural choice with real tradeoffs. There are three dominant organizing structures, and mature documentation usually combines them rather than picking one:

| Structure | What it is | Strong scent when… | Weak when… |
|---|---|---|---|
| **Taxonomy (hierarchy)** | One tree; each page has a single home; browse by drilling down | The reader's mental model matches the tree; categories are mutually exclusive | Topics belong in two places; the tree mirrors the org chart, not the reader's task |
| **Faceted** | Multiple independent dimensions (e.g. *language* × *task* × *version*); filter to narrow | Items have several orthogonal attributes; readers arrive with different ones known | Facets are forced/overlapping; cardinality is tiny (a faceted UI over 12 pages is overkill) |
| **Search-first** | The query box is the primary entry; structure exists mostly to scope/rank | The corpus is large and readers know *what* they want but not *where* it lives | Search quality is poor, synonyms are unhandled, or readers need orientation, not an answer |

The classic failure mode is the **single rigid taxonomy that encodes the producer's structure instead of the consumer's.** Docs organized by *internal team* ("Platform Team docs," "Billing Service docs") or by *system component* force the reader to already know your architecture to find anything — they must reverse-engineer your org chart. The consumer organizes by *task and goal* ("set up authentication," "handle a failed payment"), which often cuts across your components. This is precisely the **scent** problem from the previous section: a producer-shaped tree has weak scent for a consumer-shaped query at almost every fork.

Crucially, **you don't get to assert the right structure — you discover it empirically.** Two techniques are the standard tools, and a senior should know both by name and by when to use which:

- **Card sorting** (generative): give participants the set of topics (one per card) and have them group the cards and name the groups. *Open* card sorting (participants invent the category names) tells you how *your users* naturally categorize your content and what language they use for the groups — invaluable when you're designing the IA from scratch. *Closed* card sorting (you supply the categories, they sort into them) validates whether a proposed taxonomy holds up. Card sorting answers *"how should this be organized, in the user's mind?"*
- **Tree testing** (evaluative, a.k.a. "reverse card sorting"): take your proposed navigation tree, stripped of all visual design, and ask participants to *find* where they'd go to accomplish specific tasks ("where would you look to reset a forgotten password?"). It measures **findability of the structure itself**, isolated from page content and visual polish. Tree testing answers *"does this structure actually let people find things?"* — and it routinely reveals that an IA the team was sure was obvious sends most users down the wrong branch.

The pairing matters: **card sort to design the structure, tree test to validate it.** Doing only the first gives you a structure that feels right but you never checked; doing only the second tells you your structure fails without telling you what users expected instead.

> **Key insight:** At scale, IA is taxonomy *plus* facets *plus* search, not a religious choice among them — and the right structure is the *consumer's* task model, not the *producer's* component or org-chart model. You don't argue the structure into existence; you derive it with **open card sorting** (how users group and name) and prove it with **tree testing** (whether users can actually find things in it). A structure you didn't tree-test is a hypothesis, not an architecture.

---

## Every Page Is Page One — Topic-Based Authoring and Diátaxis as a Cognitive Boundary

The web broke a deep assumption that print documentation was built on: that readers start at the beginning and move forward. They don't. **Mark Baker's** principle **"Every Page Is Page One"** names the reality — in a searched, linked world, *any* page can be the first page a reader lands on, arriving cold from a search engine with zero context from the pages "before" it. The book metaphor (chapters, "as we saw earlier," "in the next section") is a lie about how technical content is actually consumed.

This has hard architectural consequences, and they're the foundation of **topic-based authoring** (the model behind DITA, the Diátaxis structure, and essentially every modern docs site):

- **Each topic must stand on its own.** A page can't assume the reader read the previous page, because there *was* no previous page for most arrivals. State the context, link the prerequisites explicitly, and make the page's scope and purpose obvious in the first screenful.
- **Topics are the unit of authoring, reuse, and navigation** — not chapters. A topic addresses one question or one task. This is *also* a cognitive-load decision: a self-contained, single-purpose topic keeps intrinsic load bounded and gives strong, honest scent (its title can accurately advertise its whole content, because it's about one thing).
- **Linking is structural, not decorative.** Because every page is an entry point, the links *out* of a page (to prerequisites, to related tasks, to the reference for a function you mention) are how the reader navigates after landing — they're load-bearing IA, not nice-to-haves. A self-contained page with no exits is a dead end; the foraging reader who needs the next step finds no scent and leaves.

This is exactly where **Diátaxis** earns its keep as more than a filing system. Daniele Procida's framework separates documentation into four modes — **tutorial** (learning-oriented), **how-to** (task-oriented), **reference** (information-oriented), **explanation** (understanding-oriented) — along two axes (acquiring vs applying skill; practical vs theoretical knowledge). Seniors often treat this as taxonomy; the deeper reading is that **the four modes are four distinct cognitive modes**, and the separation is a *cognitive-load boundary*:

- A reader in **how-to** mode has a task and wants steps; explanation woven into the steps is extraneous load that interrupts the task.
- A reader in **explanation** mode wants to understand *why*; step-by-step instructions are the wrong shape and break the conceptual flow.
- A reader in **reference** mode wants a fact fast; narrative scaffolding is redundancy (the expertise-reversal effect again).
- A reader in **tutorial** mode is a novice acquiring a first schema; missing scaffolding leaves them with intrinsic load they can't yet manage.

Mixing the modes on one page forces the reader to context-switch between cognitive modes mid-page — a concrete extraneous-load cost. So the Diátaxis separation isn't bureaucratic tidiness; it keeps each page matched to a single reader-intent and a single load profile. That is *why* it improves readability, and it's the bridge between this page's two halves: the mode boundary is simultaneously a readability decision (load profile per page) and an IA decision (what page a given intent should land on).

> **Key insight:** Assume every page is page one — readers land cold from search with no prior context — so each topic must be self-contained, single-purpose, and richly linked, because its links are how a landed reader navigates onward. Diátaxis's four modes are not four folders; they are four cognitive modes with four load profiles, and keeping them separate is what stops a reader from being forced to switch cognitive gears mid-page. It is a readability boundary and an IA boundary at once.

---

## Search Is the Real IA

Here is the fact that reorders all the priorities above for any non-trivial corpus: **most readers search; they do not browse.** Across web behavior generally and developer-docs behavior specifically, the dominant entry path is a query — either your site's search box or, more often, an external search engine that drops the reader onto a deep page, bypassing your carefully-built navigation entirely. Your beautiful nav tree is, for the majority of arrivals, *never seen*.

The senior consequence is blunt: **for searching readers, your search results are your information architecture.** The structure that actually routes them isn't the sidebar; it's the ranked list of results and the cues on it. Which means the levers that determine findability shift:

- **Page titles and headings are your most important IA**, because they're what search (internal *and* external) indexes and what shows in the results list. The title is the proximal scent cue at the single most important decision point — the search-results page. A page titled "Notes" or "Overview" is unfindable by search no matter how good its content; a page titled "Configure TLS for the gRPC server" advertises exactly its content to a query and a result-skimmer alike. Titles are foraging cues first, decoration never.
- **Synonyms and the vocabulary gap decide whether search works at all.** Readers query in *their* words, not yours — they search "login" when you wrote "authentication," "crash" when you wrote "panic," "delete" when you wrote "deprovision." If search has no synonym handling, every vocabulary mismatch is a zero-result dead end, and a zero-result search is the strongest "leave the patch" signal there is. Synonym lists, redirects, and deliberately seeding the readers' terms *into* the page (in headings, in an explicit "also known as," in the body) are core IA work, not SEO trivia.
- **Search-result snippets are scent cues you partly control.** Clear opening sentences, good meta descriptions, and front-loaded distinguishing words shape what the reader smells before they click — and therefore whether they click the right result or yours at all.
- **Internal search quality is itself an IA decision.** Whether you ship a real index (typo tolerance, stemming, synonyms, ranking by relevance and recency) or a weak substring match is, for searching readers, a bigger IA decision than the entire nav hierarchy.

None of this means the taxonomy is worthless — browsers exist, orientation matters, and a coherent tree still helps the reader who *did* land on your home page. But the senior reprioritization is to stop treating navigation as the primary IA and search as a fallback. For most readers it's the reverse. **Titles, synonyms, and search quality are the IA that does the routing**; the nav tree serves the minority who browse.

> **Key insight:** For any real corpus, search is the dominant entry path, so your *search results* — not your nav tree — are the IA most readers actually use. That makes **page titles** (the top scent cue on the results page) and **synonym handling** (closing the gap between the reader's words and yours) the highest-leverage IA work you can do, and a zero-result search the loudest abandonment signal you can emit. Build the nav tree for browsers; build the titles and search for everyone else.

---

## Measuring IA Empirically

Everything above is falsifiable, which is the senior standard: an IA claim you can't measure is an aesthetic opinion. The instruments mirror the code-quality discipline — you don't *assert* the docs are findable, you *measure* findability — and they split into pre-launch (test the design before shipping) and in-production (watch real behavior):

**Pre-launch, on the design itself:**

- **Tree testing** (covered above) — give the bare nav tree and real tasks; measure, per task, the **success rate** (found the right place), **directness** (got there without backtracking), and **time**. This validates the *structure* before you've spent effort on content or visuals. A task with 30% success and heavy backtracking is a scent failure at a specific fork you can now name and fix.
- **First-click testing** — show a realistic page (or wireframe) and a task; record *where the participant clicks first*. The reason this is a high-value, cheap test: research consistently finds that **getting the first click right is strongly correlated with overall task success** — readers who start down the right path tend to finish; those whose first click is wrong are far more likely to fail entirely. First-click testing isolates whether your top-level scent cues point people the right way on the very first decision.
- **Card sorting** (covered above) — generative, to derive the structure and the users' vocabulary before you commit to a tree.

**In production, on real readers:**

- **Search analytics — the richest, most underused IA signal you have.** Your search logs are a continuous, unprompted record of *what readers want in their own words*. Mine them for: **top queries** (what people most need — does prominent IA reflect it?), **zero-result queries** (content gaps *or* vocabulary gaps — each one is either a page you should write or a synonym you should add), **searches refined immediately** (the first query's scent failed), and **searches followed by a quick bounce** (they found the page and it didn't answer — a content or scent problem on the landing page). Zero-result and refine-immediately queries are the single most actionable findability dataset most teams already have and ignore.
- **Navigation analytics** — paths through the site, but read with care: high traffic to a page is *ambiguous* (popular, or just hard to find so everyone has to dig?), and pageviews are a notorious vanity metric that's easy to game and easy to misread (a spike can mean "great content" or "people kept landing on the wrong page and bouncing"). Read navigation data for *patterns* — common entry points, frequent backtracks, dead-end pages with high exit and no onward clicks — not for raw counts. This is the same caution that [06 — Measuring Docs ROI](../06-measuring-docs-roi/senior.md) applies to all engagement metrics: a number that goes up is not automatically good.
- **Search-success rate** — of searches, what fraction lead to a click and a non-bounce session (a plausible proxy for "found and used the answer"). Trends here, segmented by query, tell you whether search-as-IA is actually working.

The discipline is the same one this whole roadmap insists on: pick instruments that measure the reader's *success*, segment them, watch the *trend*, and refuse to let any single proxy (a grade-level score, a pageview count, a search-success percentage) become a target you optimize in isolation — because the moment it does, Goodhart's Law turns it back into noise.

> **Key insight:** IA is empirically testable — and a claim you can't test is just taste. **Tree-test** the structure and **first-click-test** the entry points *before* launch (first-click correctness predicts task success); then in production, **mine search logs** — zero-result and refined queries are the most actionable findability data you already own — while reading navigation analytics for patterns, not vanity counts. Measure the reader's success, not their motion.

---

## Mental Models

- **A readability score measures the text; comprehension lives in the reader.** Form (word/sentence length) is all the formula sees; content, structure, and the reader's prior knowledge are what actually decide understanding — and the formula sees none of them. Use the score as a thermometer (read the outliers), never a thermostat (a target to optimize).

- **Readability is working-memory cost.** Reframe every editing decision as "does this raise or lower *extraneous* load?" Signaling, worked examples, contiguity, minimalism, chunking — they're all one move: free up the reader's scarce working memory for the subject itself. This is the mechanism the formulas can't see.

- **There is no audience-independent "readable."** The expertise-reversal effect proves the same scaffolding that cuts a novice's load *is* redundant load for an expert. "Readable" is always "for this reader," which makes audience-targeting (and the Diátaxis split) a hard property, not a preference.

- **Readers are predators following a scent.** They don't find the best page; at every fork they take the strongest-smelling cue and abandon a patch the moment the scent fades. IA quality *is* the strength and honesty of scent — in every heading, link, and title — at every decision point.

- **Every page is page one.** Most readers land cold from search with no prior context, so each topic must be self-contained and richly linked (its exits are how a landed reader navigates). The book metaphor is false; the graph metaphor is true.

- **For most readers, search is the IA.** Your nav tree serves browsers; your *titles and synonyms* serve the searching majority. The highest-leverage IA work is usually descriptive titles and a real search index, not a prettier sidebar.

- **An IA claim you can't measure is an opinion.** Tree test and first-click test the design; mine search logs in production. Measure the reader's *success*, segment it, watch the trend — and never let a proxy become the goal.

---

## Common Mistakes

1. **Turning a readability score into a gate or OKR.** "Flesch-Kincaid ≤ 9 in CI" makes writers chop sentences at clause boundaries and swap precise words for vague short ones — the score rises, the prose degrades. Goodhart's Law. Use the score for relative trend and outlier detection feeding *human* review; never as a target.

2. **Stripping (or not stripping) code from the readability calc and trusting the number anyway.** Identifiers inflate syllable counts; jargon is invisible to the model. A correct, terse API reference can score "graduate level" purely because the right nouns are long. The number is noise on technical prose unless read as a relative outlier signal.

3. **"Just make it simpler" as universal advice.** Simplifying past the audience's level adds *redundancy load* for experts (expertise-reversal). The goal isn't simpler; it's load *targeted to the audience* — terse reference for practitioners, scaffolded tutorial for novices, never the same prose for both.

4. **Organizing docs by your org chart or system components.** A producer-shaped tree ("Platform Team," "Billing Service") forces the reader to know your architecture to find anything — weak scent at every fork. Organize by the consumer's *task and goal*, which usually cuts across your components.

5. **Asserting the IA instead of testing it.** A structure the team is "sure is obvious" routinely sends most users down the wrong branch. Open-card-sort to design it, tree-test to validate it. An untested IA is a hypothesis; shipping it as fact is the mistake.

6. **Vague headings and "click here" links.** "Overview," "Advanced," "Notes," "click here," "this page" emit no scent — the reader can't tell where they lead, so correct paths are invisible and they leave. Front-load distinguishing words in every heading, title, and link.

7. **Treating search as a fallback and the nav tree as the IA.** Most readers arrive via search and never see your sidebar. Neglecting page titles (the top scent cue on the results page) and synonym handling (the reader's words vs yours) breaks findability for the majority while you polish navigation for the minority.

8. **Reading pageviews as a quality signal.** High traffic is ambiguous — great content or a page everyone's forced to dig for and bounce off? Pageviews are a vanity metric. Read *patterns* (entry points, backtracks, dead ends, zero-result searches), not raw counts, and measure reader *success*, not motion.

---

## Test Yourself

1. Flesch-Kincaid uses exactly two inputs. Name them, and explain why two short clauses can score "harder" — and a long one "easier" — than their actual comprehensibility warrants on technical prose.
2. Cognitive-load theory splits load into three kinds. Name them, say which one good documentation exists to minimize, and give two concrete documentation techniques that reduce it.
3. State the expertise-reversal effect and use it to justify why a reference page should *not* be written like a tutorial.
4. In information-foraging terms, what is "information scent," and what two reader behaviors does the theory predict when scent is *weak* versus *misleadingly strong*?
5. You're designing the IA for a 400-page docs site. Which research method do you use to *derive* the structure, and which to *validate* it before launch? What does each one tell you that the other doesn't?
6. Argue that for a large corpus, your search results are your real IA. Which two levers does that make the highest-leverage findability work, and why?
7. Your boss wants "Flesch-Kincaid ≤ 8" as a quarterly OKR for the docs team. Give the rigorous objection and the honest alternative use of the same score.

<details>
<summary>Answers</summary>

1. **Average sentence length** (words per sentence) and **average word length** (syllables per word) — nothing else. On technical prose this misfires because the model never looks at *meaning*: long correct identifiers (`getUserByID`, `idempotent`) inflate the syllable term and score as "hard" though they're the precise words a practitioner wants, while a short jargon-dense or double-negative sentence ("Don't not disable the flag unless idempotency is off") scores "easy" and is incomprehensible. Short ≠ clear; long ≠ unclear. Comprehension is dominated by content, structure, and the reader's prior knowledge — none of which the two surface features capture.

2. **Intrinsic** (inherent difficulty of the material given the reader's expertise), **extraneous** (load from *how* it's presented, contributing nothing to understanding), **germane** (the productive effort of building the mental schema). Good docs minimize **extraneous** load so the reader's fixed working memory goes to intrinsic and germane work. Techniques: **signaling** (headings/bolding/summaries that flag what matters), **worked examples** (a runnable snippet beats "figure it out from the reference" for a novice), spatial contiguity (label on the diagram, explanation next to the code — no split attention), minimalism/coherence (cut every off-topic sentence).

3. **Expertise-reversal effect:** instructional support that reduces a *novice's* load becomes *redundant information* — and thus *extraneous* load — for an *expert* who already has the schema (and vice versa). A reference's audience is practitioners who have the schema and want a fact fast; tutorial-style scaffolding is redundancy that *raises* their load and makes the reference *less* readable for the people who actually use it. So reference should be terse, complete, scaffolding-free; tutorial should be the heavily-scaffolded one. Same content, different audience, different correct load profile.

4. **Information scent** is the reader's estimate — from proximal cues like link text, headings, titles, snippets — of how likely a path is to lead to the content they want (the distal target). When scent is **misleadingly strong** on a wrong path, readers take the wrong path, then backtrack and re-forage (active misrouting). When scent is **weak** (vague headings, undifferentiated text, no obvious next step), readers *abandon the patch* — they give up on the section and leave, usually to a search engine or a competitor. Weak scent causes abandonment; wrong-strong scent causes misrouting.

5. **Open card sorting** to *derive*: give users the topics on cards, have them group and name the groups — this reveals how *they* categorize your content and what *vocabulary* they use, which you then base the taxonomy on. **Tree testing** to *validate*: give the bare nav tree (no visuals, no content) and real "where would you go to…" tasks, measuring success rate, directness, and time — this proves whether the structure actually lets people find things. Card sorting tells you what users expected; tree testing tells you whether your structure delivers it. Doing only the sort gives an unchecked structure; doing only the tree test tells you it fails without telling you what users wanted instead.

6. Most readers arrive via search (internal or an external engine that deep-links them past your nav), so the nav tree is never seen by the majority — the **ranked results list and its cues are the structure that actually routes them**. That makes (a) **page titles/headings** highest-leverage, because they're what search indexes and what shows in results — the top scent cue at the most important decision point — so "Notes" is unfindable and "Configure TLS for the gRPC server" advertises itself; and (b) **synonym handling**, because readers query in their words ("login," "crash," "delete"), and an unhandled vocabulary gap is a zero-result dead end, the strongest abandonment signal there is.

7. **Objection:** the score measures only surface form (word/sentence length), not comprehension, and is especially noisy on technical prose; making it a *target* triggers Goodhart's Law — writers will hit ≤ 8 by chopping sentences and swapping precise words for vague short ones, improving the number while degrading the docs. **Honest alternative:** use the same score as a non-gating signal — a *relative trend* (did this page's grade drop after an edit? weak evidence, worth a human look) and an *outlier detector* (this one page is grade-22 in a grade-11 section — go read it) that *nominates pages for human review*, with comprehension judged by people and by task-success measures, never by the number.

</details>

---

## Cheat Sheet

```
READABILITY FORMULAS — what they are, how to use them
  Inputs (ALL of them): avg sentence length + avg word length. Nothing else.
  Flesch-Kincaid = 0.39·(words/sent) + 11.8·(syll/word) − 15.59
  Built for general prose / school grades (Flesch '48, Kincaid '75) — NOT tech docs
  Break on: identifiers/code (syllable blowup), jargon (invisible), short≠clear
  USE: relative trend + outlier detection → human review.  NEVER: a gate/OKR (Goodhart)

COGNITIVE LOAD (Sweller) — the real model of readability
  Working memory is tiny; long-term memory builds schemas. Reading = schema-building.
  INTRINSIC   inherent difficulty (sequence/chunk it; can't remove it)
  EXTRANEOUS  load from presentation — MINIMIZE THIS (what good docs do)
  GERMANE     productive schema-building effort — free up capacity FOR this
  Reduce extraneous: signaling · worked examples · spatial contiguity (no split
    attention) · minimalism (Carroll) · chunking / progressive disclosure

EXPERTISE-REVERSAL  scaffolding helps novices, becomes redundancy (load) for experts
  ⇒ no audience-independent "readable"; tutorial=scaffolded, reference=terse
  ⇒ cognitive reason Diátaxis separates tutorial / how-to / reference / explanation

INFORMATION FORAGING (Pirolli & Card) — findability
  Information SCENT = cue-based estimate (link/heading/title/snippet) a path pays off
  Readers follow strongest scent, not correct path; LEAVE a patch when scent drops
  IA quality = strong + HONEST scent at every decision point
  Kills scent: vague headings (Overview/Advanced/Notes), "click here", cute labels

IA AT SCALE   taxonomy + facets + search (not a religious pick)
  Organize by CONSUMER task/goal, not producer org-chart/components
  DESIGN with open card sort (how users group + their words)
  VALIDATE with tree test (can users find it in the bare tree?)

SEARCH = THE REAL IA   most readers search, never see your nav tree
  Titles/headings = top scent cue on results page → make them descriptive
  Synonyms = reader's words vs yours (login/auth, crash/panic); zero-result = dead end
  Internal search quality (typo/stem/synonym/rank) > the nav hierarchy for searchers

MEASURE IA EMPIRICALLY
  Pre-launch: tree test (structure) · first-click test (first click predicts success)
  Production: SEARCH LOGS (zero-result + refined queries = most actionable) ·
    nav analytics for PATTERNS not vanity counts · search-success rate
  Measure reader SUCCESS, segment, watch trend — never make one proxy the target
```

---

## Summary

- **Readability formulas measure surface form** — average word and sentence length, nothing else — and were built for general prose at school grade levels. They break on technical docs (identifiers inflate syllables, jargon is invisible, short ≠ clear), so their correlation with real comprehension is loose. The honest use is *relative trend + outlier detection* feeding human review; making the score a target is Goodhart's Law and degrades the docs.
- **Cognitive-load theory (Sweller) is the real model of readability.** Working memory is tiny; comprehension is schema-building under that constraint. Load splits into intrinsic, extraneous, and germane — and **good docs minimize extraneous load** (via signaling, worked examples, contiguity, minimalism, chunking) so the reader's scarce capacity goes to the subject itself. Formulas can't see extraneous load, which is exactly why they're weak proxies.
- **There is no audience-independent "readable."** The **expertise-reversal effect** proves scaffolding that helps novices becomes redundancy (extraneous load) for experts — which makes audience-targeting a hard readability property and is the cognitive foundation under Diátaxis's separation of modes.
- **Findability is foraging.** Readers follow **information scent** (Pirolli & Card) — they take the strongest-smelling cue at each fork and abandon a patch when scent fades — so **IA quality is strong, honest scent at every heading, link, and title.**
- **At scale, IA is taxonomy + facets + search organized by the consumer's task**, derived with **open card sorting** and validated with **tree testing** — an IA you didn't test is a hypothesis. And **every page is page one**: readers land cold from search, so topics must be self-contained and richly linked.
- **For most readers, search is the real IA** — your *results list*, not your nav tree, does the routing — making descriptive **titles** and **synonym handling** the highest-leverage findability work. Measure all of it empirically (tree tests, first-click tests, search logs), measure reader *success* not motion, and never let a proxy become the goal.

You now reason about readability and IA as cognitive science with measurable instruments, not as style preferences. The next layer — [professional.md](professional.md) — is about operating this across an organization: information-architecture governance, content models and reuse at scale, localization and accessibility as readability constraints, and running the measurement program as a continuous practice.

---

## Further Reading

- *Cognitive Load Theory* — John Sweller, Paul Ayres, Slava Kalyuga. The authoritative treatment of intrinsic/extraneous/germane load and the effects (signaling, worked-example, redundancy, expertise-reversal).
- "The Expertise Reversal Effect" — Kalyuga, Ayres, Chandler & Sweller (*Educational Psychologist*, 2003). Why instructional support that helps novices hinders experts — the research behind audience-targeting.
- *Information Foraging Theory* — Peter Pirolli (and Pirolli & Card's original PARC papers). Information scent, patches, and the predator model of information-seeking.
- *Every Page Is Page One* — Mark Baker. Topic-based authoring for a searched, linked world; why the book metaphor fails online.
- [Diátaxis](https://diataxis.fr/) — Daniele Procida. The four modes as distinct cognitive modes, not just folders — read with the cognitive-load lens from this page.
- *The Nurnberg Funnel* — John M. Carroll. Minimalism as extraneous-load reduction before the term was mainstream.
- *Information Architecture for the Web and Beyond* — Rosenfeld, Morville & Arango ("the polar bear book"). Taxonomy, facets, search systems, and organizing for the consumer.
- Nielsen Norman Group's writing on **tree testing**, **first-click testing**, and **card sorting** — practical method guides with the empirical findings (e.g., first-click correctness predicting task success).
- "The Burden of Readability Formulas" and similar critiques in the technical-communication literature — the documented case against formula-as-target.

---

## Related Topics

- [01 — What Makes Docs Good](../01-what-makes-docs-good/senior.md) — the quality attributes (clarity, findability, audience-fit) this page gives the cognitive-science mechanism for.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/senior.md) — the same anti-vanity-metric discipline applied to the hardest measurement of all: did the docs pay off?
- [junior.md](junior.md) · [middle.md](middle.md) · [professional.md](professional.md) — the rest of this topic's tier ladder.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: *how* to actually write the readable, well-architected docs whose quality this page teaches you to reason about and measure.
