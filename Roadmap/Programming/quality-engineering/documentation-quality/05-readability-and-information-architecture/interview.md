# Readability & Information Architecture — Interview Questions

> **Roadmap:** [Documentation Quality](../README.md) → Readability & Information Architecture
> *A docs interview rarely asks "what is readability." It asks "users say they can't find anything in our docs — what do you actually do," and then watches whether you reach for a reading-grade target (wrong) or for search logs and tree testing (right). This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Readability Basics](#theme-1--readability-basics)
3. [Theme 2 — Readability Formulas](#theme-2--readability-formulas)
4. [Theme 3 — Prose Linting](#theme-3--prose-linting)
5. [Theme 4 — Information Architecture](#theme-4--information-architecture)
6. [Theme 5 — Search and Validation](#theme-5--search-and-validation)
7. [Theme 6 — Cognitive Load](#theme-6--cognitive-load)
8. [Theme 7 — Scenario and Judgment](#theme-7--scenario-and-judgment)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **reading vs scanning** (prose is consumed nonlinearly under task pressure, not read start-to-finish)
- **measuring vs targeting** (a readability score is a relative signal, never a goal to hit)
- **structure vs search** (how content is organized vs how people actually reach it)
- **intrinsic vs extraneous load** (difficulty inherent to the topic vs difficulty your presentation added)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* — and who reach for evidence (logs, tests, observation) before reaching for an opinion. Docs is a discipline where the loudest opinions are usually the least measured; the senior signal is treating findability as something you *instrument*, not something you *assert*.

---

## Theme 1 — Readability Basics

### Q1.1 — A developer says your tutorial is "hard to read," but every sentence is grammatically correct. What could be wrong?

> **Testing:** Whether you understand readability is about *cognitive access under task pressure*, not grammar.

**A.** Grammar is table stakes; readability is whether a reader under time pressure can extract what they need *without reading every word*. Common culprits with perfect grammar: walls of unbroken prose with no headings or lists to scan; the key fact buried in the middle of a paragraph instead of front-loaded; passive, abstract phrasing that forces the reader to reconstruct who does what ("the configuration is validated" — by whom, when?); and no concrete example, so the reader has to mentally instantiate the abstraction. The fix isn't "simpler words" — it's restructuring for the way docs are actually consumed: scanned, nonlinearly, by someone trying to finish a task and leave.

### Q1.2 — Explain "write for scanning." How does it change the way you draft a page?

> **Testing:** Whether you know the empirical reading behavior, not just the slogan.

**A.** Eye-tracking research (Nielsen Norman Group) shows users don't read documentation linearly — they scan in an F-shaped pattern, fixating on the top, the left edge, headings, links, and the first words of lines and paragraphs, skipping the rest. Writing for scanning means making the page *work when 80% of it is skipped*: descriptive headings that say what the section delivers (not "Overview"), the answer or action front-loaded in the first sentence of each section (the BLUF principle — bottom line up front), one idea per paragraph, bulleted lists for parallel items, bold for the load-bearing terms, and code blocks that can be copied without reading the surrounding prose. In practice this inverts how engineers naturally write: we build up to the conclusion; readers want the conclusion first and the justification available *if* they choose to descend.

### Q1.3 — Why is active voice usually preferred in docs, and when is passive actually correct?

> **Testing:** Whether you apply the rule with judgment instead of dogma.

**A.** Active voice ("the scheduler retries the job") names the actor, so the reader doesn't have to infer who acts — it's shorter, more direct, and removes a class of dangerous ambiguity in instructions ("the file must be deleted" — *by you*, or *by the system*?). For step-by-step procedures it's near-mandatory: "Click Save," not "Save should be clicked." But passive is correct when the actor is genuinely unknown, irrelevant, or obvious, and the *object* is the real subject of the sentence — "The request is rejected if the token is expired" is fine because the system is the implied actor and the rejection is the point. The senior version of this rule is "name the actor when the actor matters," not "never use passive" — blanket passive-banning produces stilted prose and false corrections.

### Q1.4 — What does "plain language" mean in technical docs, and what's the trap in applying it?

> **Testing:** Whether you can distinguish *unnecessary* complexity from *necessary* domain precision.

**A.** Plain language means removing the complexity you *added* — jargon used for status, nominalizations ("perform a validation" → "validate"), throat-clearing ("it should be noted that"), and Latinate words where a plain one is exact ("utilize" → "use"). The trap is conflating that with dumbing down the *domain*. A precise technical term like *idempotent*, *quorum*, or *back-pressure* carries meaning that a "plain" paraphrase would lose, and your audience of engineers knows it. Plain language is about lowering *extraneous* difficulty (the words), never *intrinsic* difficulty (the concept). The correct move with a necessary hard term is to *use it and define it on first appearance*, not to avoid it.

### Q1.5 — Why are concrete examples so disproportionately effective in technical writing?

> **Testing:** Whether you understand the worked-example effect, not just "examples are nice."

**A.** Two reasons. First, the **worked-example effect** from cognitive-load research: novices learn a procedure far faster from a complete worked example than from an abstract description plus a "now you try," because the abstract version forces them to hold the whole pattern in working memory while also applying it. Second, examples are *checkable* — a reader can run the snippet and confirm their mental model, collapsing ambiguity that prose leaves open. The strongest docs pattern is concrete-first: show the canonical example, then generalize the rule from it, rather than stating the rule and hoping the reader instantiates it correctly. An example also doubles as a copy-paste starting point, which is what scanning readers actually want.

---

## Theme 2 — Readability Formulas

### Q2.1 — What does the Flesch–Kincaid Grade Level actually measure?

> **Testing:** Whether you know the formula's mechanics — and therefore its blind spots — before you trust its number.

**A.** Flesch–Kincaid Grade Level is a formula over exactly two surface features: **average sentence length** (words per sentence) and **average word length** (syllables per word). That's it — it maps those two numbers to a US school-grade level. The Flesch Reading Ease score is the same two inputs scaled differently. Critically, the formula has *no model of meaning*: it cannot tell whether your sentences are coherent, whether your terms are defined, whether the structure aids scanning, or whether the content is even true. It rewards short sentences and short words and penalizes long ones — nothing more. Knowing it's *only* those two features is what lets you reason about exactly where it lies.

### Q2.2 — Why are readability formulas unreliable on technical prose specifically?

> **Testing:** The core competency of this theme — formula *limits* on the content you actually write.

**A.** Because the formula's two inputs both misfire on technical content. **Syllable counting punishes domain vocabulary**: "idempotent," "Kubernetes," "authentication," "parameterization" all spike the score as "hard," yet to the target audience they're the *clearest* possible words — the formula calls your precise term a readability problem. Meanwhile **the formula is blind to everything that actually makes technical docs readable or not**: code blocks (often parsed as gibberish or skipped, distorting the count), tables, headings, the presence of examples, whether a procedure is correctly ordered, accurate terminology. So you get the worst of both — it flags good technical writing as "too hard" because of necessary jargon, and it happily passes incoherent or wrong content as long as the sentences are short. A doc can score "grade 8" and be useless, or "grade 16" and be the clearest reference in the codebase.

### Q2.3 — Then are these scores worthless? How would you actually use one?

> **Testing:** Whether you can extract the *real* signal — relative, not absolute — instead of either worshipping or dismissing the number.

**A.** They're not worthless, but they're a **relative diagnostic, not a target**. The legitimate use is *comparative and directional*: a sudden grade-level spike on one page versus the rest of the docs is a useful flag — it usually means runaway sentence length or a sentence-structure problem worth a human look. Tracking the *trend* of a doc set over time can catch drift. What you must never do is set an absolute target ("all docs must hit grade 8") and edit to satisfy the formula, because the cheapest way to lower the score is to chop necessary terms and shatter coherent sentences into choppy fragments — you game the metric and *degrade* the writing. The rule: use the score to *find pages to look at*, then let a human decide; never use it as the pass/fail gate or the editing objective. It's a smoke detector, not a thermostat.

### Q2.4 — A stakeholder mandates "all our docs must be at a Flesch–Kincaid grade 8." What's your response?

> **Testing:** Whether you can push back on a plausible-but-wrong mandate with reasons, not just refusal.

**A.** I'd push back, and explain *why* with the mechanics. A fixed grade target optimizes the two things the formula measures — sentence and word length — which means the team will hit it by deleting precise technical terms and fragmenting sentences, actively making the docs *worse* for an engineering audience. Grade 8 is a *general-public* readability bar (it's where consumer health and government plain-language guidance aim); our audience is engineers, for whom "TLS handshake" is clearer than any grade-8 paraphrase. I'd offer the better version of what they actually want — *readable docs* — by reframing the metric: track the score as a *relative* signal to flag outlier pages, pair it with prose-linting for the patterns that genuinely hurt (passive voice, undefined jargon, walls of text), and validate with the only ground truth that matters — can real users complete tasks and find pages (task success, time-to-answer, search-failure rate). Same goal, instrument that doesn't backfire.

---

## Theme 3 — Prose Linting

### Q3.1 — What is a prose linter, and what kinds of problems does it catch that a readability formula can't?

> **Testing:** Whether you understand rule-based prose checking as a distinct, more useful tool.

**A.** A prose linter (Vale is the standard) applies *rules* to text the way ESLint applies rules to code — pattern matches and curated word lists, run from the command line over Markdown/AsciiDoc/etc. Unlike a readability formula, which only counts syllables and sentence length, a linter catches *specific, named, fixable* problems: banned or off-brand terms ("blacklist" → "denylist," "simply"/"just"/"easy" minimizing language), passive-voice constructions, weasel words, inconsistent capitalization of product names, undefined acronyms on first use, wordy phrases ("in order to" → "to"), and terminology that violates the house style guide. It produces a line-and-column diagnostic you can act on — "line 42: avoid 'simply'" — whereas a formula gives you one opaque number for the whole document with no pointer to *what* to change.

### Q3.2 — How does Vale work, and what is "style as code"?

> **Testing:** Whether you grasp that prose style can be version-controlled and enforced like any other engineering standard.

**A.** Vale reads **styles** — directories of rule files (YAML) that define checks: `existence` (flag these words), `substitution` (replace X with Y), `occurrence`, `sequence`, and so on. You either author your own house style or pull a packaged one (the Microsoft and Google developer style guides ship as Vale styles, as does `write-good` and the inclusive-language `alex` rules). Crucially, **the style lives in the repo** alongside the docs, versioned and reviewed in pull requests — that's "style as code": your editorial standard stops being a PDF nobody reads and becomes executable rules with the same authority as a lint config. A style change is a diff; a disagreement about a rule is a PR discussion; the standard is *the same for everyone* because it's enforced by a machine, not by whichever reviewer happens to care.

### Q3.3 — How would you put prose linting into CI without it becoming a wall of noise people ignore?

> **Testing:** The senior judgment — rolling out an enforcement tool on a large existing corpus without a revolt.

**A.** The failure mode is turning it on at full strictness over a legacy corpus, generating ten thousand warnings, and training everyone to ignore the check — same disease as a noisy code linter. So: **start with severity tiers.** Run most rules at `suggestion`/`warning` (visible, non-blocking) and reserve `error` (build-breaking) for a tiny set of high-confidence, non-negotiable rules — banned/offensive terms, wrong product names. **Lint only the diff**, not the whole repo, so contributors are accountable for what they touch and you don't gate a typo fix on fixing the whole backlog. **Adopt a baseline** for the existing corpus and ratchet — new content meets the bar, old content is improved opportunistically. And **make the rules debatable in PRs**: every false positive should be either a `Vale.Spelling`-style exception or a rule the team agrees to relax, so the signal stays trustworthy. A linter people respect is one that's almost always right when it blocks.

### Q3.4 — A writer says the linter flagged "simply" but their sentence is fine. Is the rule wrong?

> **Testing:** Whether you can hold "the rule is usually right" and "this instance is a false positive" at once — the nuance of any linter.

**A.** Probably the rule is right *as a default* and this is a tolerable exception — both can be true. The reason linters flag "simply," "just," and "easy" is that minimizing language is *frequently* wrong in docs: if the step isn't simple for this reader, the word makes them feel stupid and erodes trust, and the word adds no information either way. So the rule earns its place by catching the 90% case. For the 10% where it's genuinely fine, the right move is a scoped suppression (an inline ignore comment or a refined rule scope), not deleting the rule — because deleting it to satisfy one writer reopens the 90%. The meta-point I'd make in an interview: a good linter relationship is *adversarial-collaborative* — you don't blindly obey it and you don't disable it, you tune it so its blocks stay trustworthy.

---

## Theme 4 — Information Architecture

### Q4.1 — What is information architecture for documentation, and why is it separate from writing?

> **Testing:** Whether you see IA as a discipline distinct from prose quality.

**A.** Information architecture is the *structure* of a doc set — how content is organized, labeled, grouped, and connected — independent of how well any single page is written. It answers: what are the top-level sections and are they labeled the way users think? How is a page found — navigation, search, cross-links? What's the granularity (one giant page vs many small ones)? It's separate from writing because *a corpus of individually excellent pages can still be unusable* if a reader can't locate the right one, and conversely a mediocre page that's instantly findable beats a brilliant one nobody reaches. IA is the difference between "is this page good" and "can the right person get to the right page at the moment they need it" — and the second question is usually the one failing in real doc sets.

### Q4.2 — Explain information scent and information foraging. How do they apply to docs?

> **Testing:** Whether you know the actual theory behind navigation design, not folk wisdom.

**A.** Information foraging theory (Pirolli & Card, from Xerox PARC) models people seeking information like animals foraging for food: we follow **information scent** — the cues (link text, headings, labels, snippets) that signal whether a path leads toward what we want — and we abandon a "patch" when the expected value of continuing drops below the cost of looking elsewhere. The doc implications are direct and concrete: **link and heading text must carry strong scent** — "Configuring retries" leads somewhere obvious; "Advanced" or "More info" or "Click here" carries *no* scent and the forager can't judge it, so they bounce. Every navigation label, every cross-link, every search-result snippet is a scent decision. Weak scent is *the* mechanism behind "I couldn't find it even though it was there" — the page existed but nothing on the path advertised that it was the answer.

### Q4.3 — How does the Diátaxis framework function as an information architecture?

> **Testing:** Whether you understand Diátaxis as a *structural* answer, not just four document types.

**A.** Diátaxis (Procida) splits docs into four modes by user need: **tutorials** (learning-oriented, hold-my-hand), **how-to guides** (task-oriented, "accomplish X"), **reference** (information-oriented, look-it-up), and **explanation** (understanding-oriented, "why"). As an IA, its power is that it gives you a *principled top-level structure and a placement rule*: every page has exactly one home determined by the reader's *situation* (are they studying or working? acquiring a skill or applying it?). This kills the most common IA failure — the page that mixes a tutorial, an API dump, and a design rationale, serving none of them — by forcing separation. It also sets *reader expectations*: someone in the reference section knows not to expect narrative, someone in a tutorial knows not to expect exhaustive edge cases. The framework is less "four folders" and more "a decision procedure for what any given page should and shouldn't contain, and therefore where it lives."

### Q4.4 — What is progressive disclosure, and how do you apply it across a doc set?

> **Testing:** Whether you can manage complexity by *layering* rather than dumping or hiding.

**A.** Progressive disclosure means showing the common, simple path first and revealing depth on demand, so a newcomer isn't drowned and an expert isn't blocked. At the *page* level: the happy path up top, edge cases and exhaustive options below or behind expandable sections; the minimal working example before the full parameter table. At the *corpus* level: a "Getting Started" that gets someone to first success with the smallest possible surface, linking *out* to the deep reference rather than inlining it. The discipline is resisting two opposite failures — the "expert curse" of front-loading every caveat and option (overwhelming the 90% who need the simple case) and the opposite sin of hiding necessary information so deep that experts can't reach it. Done right, the *same* doc set serves the novice and the expert because each finds their layer; the structure carries the complexity instead of the prose.

### Q4.5 — What does "every page is page one" mean for how you write and structure docs?

> **Testing:** Whether you've internalized that readers arrive mid-corpus, not at the front door.

**A.** Mark Baker's "every page is page one" observes that in the search-and-link era, readers almost never enter through your carefully sequenced front page — they land on a deep page directly from Google or an internal search, with no idea what came "before" it. Each page must therefore be **self-sufficient enough to orient a cold arrival**: state its own context and prerequisites, define or link its key terms, and link to the obvious next and adjacent steps, rather than assuming the reader read the previous page in some authored sequence. It does *not* mean duplicating everything onto every page — it means every page declares where it sits and provides exits (links) so a forager who landed in the wrong patch can navigate to the right one. Practically, this is why orphan pages with no inbound context and dead-end pages with no onward links are IA bugs: they assume a linear reader who doesn't exist.

---

## Theme 5 — Search and Validation

### Q5.1 — Someone argues "we don't need good navigation, people just search." Push back or agree?

> **Testing:** Whether you understand that search *is* the dominant access path — and what that actually demands.

**A.** I'd half-agree, then sharpen it: it's true that **search is the primary way most people reach documentation** — for any large doc set, search traffic dwarfs click-through navigation, so treating navigation as the main entry point is fighting reality. But "people search" doesn't make IA *irrelevant*; it relocates the work. Search only works if the content is *structured for it*: pages need titles and headings that match the words users actually type (which you learn from search logs, not by guessing), the search index has to be good, and — because search drops users onto a deep page cold — *every page must orient an arrival* (the "every page is page one" point). So the honest answer is "search is the real IA," and that *raises* the bar: you now have to design findable page titles, harvest real query vocabulary, and make each page self-sufficient. Navigation still matters for browsing and discovery of things users don't know to search for, but the load-bearing structure is what makes search land on the right page.

### Q5.2 — Your search logs are a goldmine. What specifically do you look for?

> **Testing:** Whether you can turn search-log analysis into concrete IA fixes.

**A.** Search logs are the closest thing to users telling you, in their own words, what they want and where you're failing. I'd mine: **zero-result queries** (people searching for things that don't exist in the docs, or exist under different words — both are content/labeling gaps); **high-frequency queries** (your most-wanted topics — they should be effortless to reach and probably deserve prominent placement); **queries followed by no click or immediate re-search** (the results looked wrong — a *scent* failure in titles/snippets even though the page may exist); **the vocabulary mismatch** between what users type and what your headings say (users search "login," docs say "authentication" — the fix is to add the user's word as a synonym or in the title). The throughline: search logs convert "users can't find things" from a vague complaint into a ranked, specific worklist of missing pages, mislabeled pages, and vocabulary gaps.

### Q5.3 — What is tree testing and what does it isolate that other methods don't?

> **Testing:** Whether you know how to validate IA *structure* independent of visual design and content.

**A.** Tree testing (a.k.a. reverse card sorting) gives participants your *navigation hierarchy as plain text only* — no page styling, no search box, no content — and asks "where would you go to do X?" You then measure, per task, whether they reached the right node, how directly, and where they went wrong. What it *isolates* is the **structure and labeling itself**: by stripping visual design and search, it answers "is the categorization and naming intelligible?" without confounds. If people fail a tree test, the problem is your IA's labels or grouping — not the CSS, not the prose. It's the controlled experiment for the hypothesis "our menu structure makes sense," and you can run it on a *proposed* reorg before building anything, which is exactly when it's most valuable.

### Q5.4 — Contrast tree testing, first-click testing, and card sorting. When do you use each?

> **Testing:** Whether you know the IA research toolkit and can pick the right instrument.

**A.** They sit at different points in the design loop. **Card sorting is generative** — give users the topics and let *them* group and label them, to *discover* a structure that matches their mental model (open sort = they name the groups; closed sort = you supply the group names and test fit). **Tree testing is evaluative for findability** — given a structure, can people locate things in it? (above). **First-click testing** measures whether people's *first* click on an interface (a real page or mockup) heads toward the goal, on the well-supported finding that getting the first click right is highly predictive of overall task success. So the flow is: *card sort* to design the categories from users' models → *tree test* to validate the resulting hierarchy before you build → *first-click test* on the implemented page to confirm the design surfaces the right starting move. Generative, then evaluative-structural, then evaluative-visual.

### Q5.5 — How do you validate that a documentation reorganization actually worked, rather than just *feeling* better?

> **Testing:** Whether you treat IA changes as hypotheses to test, with before/after evidence.

**A.** A reorg is a *hypothesis* — "this structure is more findable" — so I'd validate it the way you'd validate any change: baseline, intervene, measure the same things after. **Before:** tree-test the *current* structure and capture quantitative baselines — task-success rate and time-to-find for the top tasks, search-failure and zero-result rates, top support tickets that are really docs-findability problems. **Design and pre-test:** card-sort to inform the new structure, then *tree-test the proposed structure before shipping* — this catches a bad reorg while it's still cheap. **After shipping:** re-run the same tree-test tasks, then watch the in-the-wild metrics move — search-failure rate down, time-to-answer down, "where do I find X" tickets down, fewer zero-result and re-search events in the logs. The discipline is *symmetric measurement* (same tasks/metrics before and after) and not declaring victory on vibes or a stakeholder's relief that the menu looks tidier. If the numbers don't move, the reorg didn't work, however nicer it feels.

---

## Theme 6 — Cognitive Load

### Q6.1 — Define the three types of cognitive load and give a docs example of each.

> **Testing:** Whether you have the model precisely — most people blur the three.

**A.** From cognitive load theory (Sweller), working memory has a hard capacity limit, and three kinds of load compete for it:
- **Intrinsic load** — the difficulty *inherent in the material itself*, given the learner's prior knowledge. Explaining distributed consensus is intrinsically heavy; you can *sequence* it but you can't make the concept trivial.
- **Extraneous load** — difficulty added by *how the information is presented*, unrelated to the content. A disorganized page, undefined jargon, a wall of text, an example split across the page from its explanation (the split-attention effect), inconsistent terminology. This is *pure waste* and the writer's job is to drive it to zero.
- **Germane load** — the *productive* effort the learner spends building a durable mental model (schema) — connecting the new idea to what they know. This is the "good" load you *want* working memory spent on.

The whole game: **minimize extraneous, manage intrinsic (sequence and chunk it), so the freed capacity goes to germane.** Bad docs spend the reader's limited working memory on extraneous load — fighting your layout — leaving nothing for actually learning.

### Q6.2 — How do you actually reduce extraneous cognitive load in a doc?

> **Testing:** Whether you can name the specific, evidence-backed techniques rather than "make it clearer."

**A.** Concrete, research-grounded moves: **eliminate the split-attention effect** — put the explanation *adjacent* to the code/diagram it describes (inline annotations beat a paragraph that references "the function above"); **chunk** — break content into labeled sections so each fits in working memory rather than one undifferentiated wall; **be relentlessly consistent in terminology** — calling the same thing "user," "account," and "principal" forces the reader to spend working memory unifying synonyms; **front-load with examples** (the worked-example effect — a complete example is lower-load than abstract-plus-exercise for novices); **remove the redundant** — a diagram *and* a paragraph that restate each other can *increase* load (the redundancy effect), not reduce it; and **prune the irrelevant** — every tangential aside competes for the same scarce capacity. Each of these is removing a specific tax on working memory, not vaguely "simplifying."

### Q6.3 — Explain the expertise-reversal effect. Why does it mean you can't write one doc for everyone?

> **Testing:** The crux of the theme — that the *same* scaffolding helps novices and *hurts* experts.

**A.** The expertise-reversal effect (Kalyuga) is the finding that **instructional support which helps a novice actively hurts an expert** — and vice versa. The detailed step-by-step worked example, the patient re-explanation of basics, the hand-holding that a beginner needs becomes *extraneous load* for an expert who already has the schema: now they have to wade through redundant explanation to find the one fact they came for, and the redundancy effect means that extra material genuinely *degrades* their performance. The expert wants a terse reference; the novice drowns in that same terse reference. This is *the* reason a single document can't serve both — it's not a style preference, it's a working-memory consequence with experimental backing. It's also the cognitive-science justification for Diátaxis separating tutorials (novice, high-scaffold) from reference (expert, low-scaffold): they are *necessarily* different documents because the optimal load profile inverts with expertise.

### Q6.4 — How does the expertise-reversal effect shape your information architecture, concretely?

> **Testing:** Whether you can translate the cognitive principle into structural decisions.

**A.** It pushes me toward **separate paths by expertise rather than one path that compromises both** — which is exactly progressive disclosure and Diátaxis applied with intent. Concretely: a high-scaffold **tutorial / getting-started** track for newcomers (sequenced, worked examples, every step shown) kept *distinct* from a low-scaffold **reference** track for people who already have the model (terse, exhaustive, scannable, no narrative). Progressive disclosure within a page lets the expert skip the scaffolding (happy path and copy-paste up top; explanation collapsible or below). And I'd let *search and scent* route each reader to their layer — an expert searching a specific function name lands in reference; a novice following the getting-started flow stays in the tutorial. The mistake the effect warns against is the "comprehensive" page that interleaves beginner explanation with expert detail and forces *everyone* to carry the load meant for the *other* audience. Separation isn't redundancy — it's load management.

---

## Theme 7 — Scenario and Judgment

### Q7.1 — "Our users keep saying they can't find anything in our docs." You own this. Walk me through diagnosing and fixing it.

> **Testing:** The headline scenario — whether you reach for evidence and the right model, or for a redesign-by-opinion.

**A.** First, **refuse to redesign on vibes** — "can't find anything" is a symptom with several distinct causes, and I need to know which before touching the structure. I'd triage with data:

1. **Search logs first** — this is users telling me what they want in their words. Zero-result queries (missing content or vocabulary mismatch), high-frequency queries that *should* be trivial to reach, and queries with no click or immediate re-search (the page exists but its title/snippet has no *scent*). This usually splits "can't find" into three buckets: the content doesn't exist, it exists under the wrong words, or it exists but nothing on the path advertises it.
2. **Check whether it's a search problem or a structure problem** — if search traffic dominates (it usually does), a bad search index or poor page titles is the real lever, not the nav tree.
3. **Tree-test the current IA** on the top tasks to see if the *categorization and labels* are the failure — if people can't locate things in the plain-text hierarchy, the labels carry weak scent.
4. **Audit scent** — scan the actual link text and headings for "Advanced," "More," "Misc," "Click here," undescriptive titles — weak-scent labels are a top cause of "it was there but I couldn't find it."

Then fix the cause I *found*: vocabulary gaps → add users' words to titles/synonyms; weak scent → rewrite headings and link text to say what they deliver; genuine structure problem → card-sort + tree-test a new IA *before* shipping; missing content → write it. And I'd **validate the fix** the same way — re-run the tree tests, watch search-failure and time-to-answer move. The senior signal here is the *sequence*: instrument, diagnose the specific failure, fix that, measure — never "I'll reorganize the nav and hope."

### Q7.2 — Leadership wants a single readability KPI for all docs and is leaning toward Flesch–Kincaid grade. Advise them.

> **Testing:** Whether you can redirect a metric request toward something that won't get gamed into worse docs.

**A.** I'd validate the *goal* (readable docs, measurable progress) and then steer them off that *specific* metric, because Flesch–Kincaid as a KPI is actively counterproductive: it scores only sentence length and syllable count, so the cheapest way to "improve" it is to delete the precise technical terms our engineering audience needs and chop coherent sentences into fragments — we'd move the number and degrade the writing, and people optimize the metric they're measured on (Goodhart's law in its purest form). What I'd propose instead is a *small basket of outcome metrics that resist gaming*: **task success rate** and **time-to-answer** from periodic usability/tree tests (can people actually do the thing?), **search-failure / zero-result rate** from logs (can they find the thing?), and **docs-attributable support volume** (are docs deflecting questions?). Keep readability formulas only as a *relative internal flag* to surface outlier pages for human review — never as the headline KPI or the editing target. Same intent — prove docs are working — but instrumented on *outcomes* (did the reader succeed) rather than *surface form* (how long are the words), which is the only kind of docs metric that doesn't backfire.

### Q7.3 — You've inherited a 400-page doc site that grew organically and is a structural mess. How do you approach reorganizing it?

> **Testing:** Whether you approach a large IA migration methodically and with user input, not a heroic solo restructure.

**A.** I'd treat it as research-then-migrate, not a weekend of moving folders. **Understand current reality:** content-audit the 400 pages (what exists, what's duplicated, what's stale, what's actually trafficked — kill the dead weight first, because reorganizing pages nobody reads is wasted motion), and pull search logs and top support tickets to learn what users actually come for and where they fail. **Design from users, not from my taste:** run a card sort so the new top-level categories reflect *users'* mental model and vocabulary, and use Diátaxis as the placement discipline so each page lands in tutorial/how-to/reference/explanation by reader need. **De-risk before building:** tree-test the proposed structure on the top tasks — catch a bad hierarchy while it's still a text outline. **Migrate safely:** prioritize high-traffic content, and *preserve URLs with redirects* (broken inbound links from Google and other sites are a massive findability regression — an underrated way reorgs fail). **Prove it worked:** re-run the tree tests and watch search-failure and time-to-answer post-launch. The throughline is humility about my own mental model — the structure has to match *users'*, which I learn by testing, not by assuming.

### Q7.4 — A senior engineer insists docs should be "comprehensive" — every detail on the main page so nothing's hidden. Where do you land?

> **Testing:** Whether you can defend layering against the seductive-but-wrong "completeness" instinct, with the cognitive-load reason.

**A.** I'd reframe "comprehensive" as "*complete* but *layered*," and make the cognitive-load case. The instinct comes from a real fear — that progressive disclosure *hides* needed information — and I'd grant that hiding necessary detail is a genuine failure mode. But "every detail on the main page" trades one failure for a worse one: it maximizes load for the 90% who need the common case, burying the happy path under edge cases and exhaustive options, and by the expertise-reversal effect it doesn't even serve the experts it's aimed at — they now have to dig through beginner scaffolding to reach the one detail they want. The resolution is *layering, not omission*: the simple path and minimal example up top, the exhaustive reference one click away (not deleted, not on the same screen). Nothing is hidden — everything is *placed* by who needs it and when. I'd offer a concrete test of whether we got it right: can a newcomer reach first success without reading the edge cases, *and* can an expert reach any specific detail in one or two steps? If both, the layering works; "everything on one page" fails the first and, surprisingly to the engineer, often the second too.

### Q7.5 — How do you know your documentation's information architecture is *good*? What would you actually measure?

> **Testing:** Whether your definition of IA quality is outcome-based and measurable, not aesthetic.

**A.** Good IA is invisible — users get to what they need so fast they don't notice the structure — so I measure the *outcomes that proxy for "they got there,"* not whether the menu looks elegant. The measurable signals: **high task-success and low time-to-find** in tree/first-click testing on the top tasks; **low search-failure and zero-result rates** in the logs (people's queries land on real, relevant pages); **few "where do I find X" support tickets** (every one is an IA bug report); **healthy scent** — low bounce/re-search from search results, meaning titles and snippets accurately advertise their pages; and the absence of structural smells — orphan pages, dead-ends, mislabeled "Advanced/Misc" buckets, pages that mix four Diátaxis modes. The unifying idea is that IA quality is defined by *whether the right reader reaches the right page at the moment of need*, which is observable and instrument-able — through tests and logs — not a matter of how tidy the sitemap looks to me. If I can't point to those numbers moving, I can't claim the IA is good, only that it's pretty.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: What does Flesch–Kincaid measure?** A: Only two surface features — average sentence length and average syllables per word; nothing about meaning, structure, or correctness.
- **Q: Use a readability score as a target or a signal?** A: A *relative* signal to flag outlier pages for human review — never an absolute target to edit toward.
- **Q: Why does the formula misfire on technical docs?** A: It penalizes necessary domain terms as "hard" and is blind to code, tables, headings, and accuracy — the things that actually drive technical readability.
- **Q: What is Vale?** A: A command-line prose linter that enforces style rules (banned terms, passive voice, terminology) on Markdown/AsciiDoc, like ESLint for prose.
- **Q: What is "style as code"?** A: Keeping the editorial style guide as versioned, machine-enforced rule files in the repo, reviewed in PRs, instead of a static document.
- **Q: What is information scent?** A: The cues (link text, headings, snippets) that signal whether a path leads to what the reader wants; weak scent causes "it was there but I couldn't find it."
- **Q: Name the four Diátaxis modes.** A: Tutorial (learning), how-to (task), reference (information), explanation (understanding).
- **Q: What is progressive disclosure?** A: Show the common simple path first; reveal depth and edge cases on demand, so novices aren't overwhelmed and experts aren't blocked.
- **Q: "Every page is page one" — meaning?** A: Readers arrive on deep pages via search, so each page must self-orient and link onward, not assume a linear reading order.
- **Q: What does tree testing isolate?** A: The findability of the *structure and labels* alone, stripped of visual design and search.
- **Q: Card sort vs tree test?** A: Card sort *generates* a structure from users' mental models; tree test *evaluates* whether a given structure is findable.
- **Q: The three cognitive loads?** A: Intrinsic (inherent to the material), extraneous (added by presentation — minimize it), germane (productive schema-building — the good kind).
- **Q: Expertise-reversal effect in one line?** A: Scaffolding that helps novices actively *hurts* experts (and vice versa), so one doc can't optimally serve both.
- **Q: Split-attention effect?** A: Forcing readers to integrate separated sources (code here, its explanation elsewhere) adds load; put related material adjacent.
- **Q: Where does search rank among access paths?** A: It's the dominant one for large doc sets — "search is the real IA," which raises the bar on page titles and self-sufficiency.
- **Q: Top thing to mine from search logs?** A: Zero-result queries — they reveal missing content or vocabulary mismatches between users' words and your headings.
- **Q: Active vs passive voice rule?** A: Name the actor when the actor matters (especially in procedures); passive is fine when the actor is unknown, irrelevant, or obvious.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating a readability formula as a target ("we should hit grade 8") instead of a relative signal.
- Not knowing the formula only measures sentence and word length — and therefore why it lies on technical prose.
- Conflating "plain language" with dumbing down necessary domain terms.
- "People just search, so IA doesn't matter" — missing that search *is* the IA and raises the bar.
- Proposing a docs reorg with no user research and no before/after measurement — restructuring on personal taste.
- Blurring the three cognitive loads, or not knowing extraneous is the one to minimize.
- "Make docs comprehensive — everything on one page" with no awareness of expertise reversal or load.
- Turning a prose linter on at full strictness over a legacy corpus and wondering why it's ignored.

**Green flags:**
- Naming the *distinction* (measuring vs targeting, structure vs search, intrinsic vs extraneous) before reaching for a fix.
- Reaching for *evidence* — search logs, tree testing, task-success metrics — instead of opinion.
- Citing the actual mechanism: F-shaped scanning, information foraging/scent, the worked-example and expertise-reversal effects.
- Framing a docs metric request toward *outcomes that resist gaming* (task success, search-failure rate) and warning about Goodhart.
- Connecting Diátaxis and progressive disclosure to the *cognitive-load reason* they exist, not just citing them as frameworks.
- Validating an IA change symmetrically — same tasks and metrics before and after, tree-test the proposal before shipping.
- Knowing readers land on deep pages cold ("every page is page one") and designing for self-orientation.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **reading vs scanning**, **measuring vs targeting**, **structure vs search**, **intrinsic vs extraneous load**. Name the distinction first, and reach for evidence before opinion.
- **Readability basics:** docs are *scanned*, not read — F-shaped, under task pressure. Front-load the answer, write strong descriptive headings, name the actor, and lead with concrete examples (the worked-example effect). Plain language removes *added* complexity, never necessary domain precision.
- **Readability formulas** measure only sentence length and syllable count — so they punish necessary technical terms and are blind to code, structure, and correctness. Use the score as a *relative* flag for human review, never as a target; a grade mandate gets gamed into worse docs (Goodhart).
- **Prose linting** (Vale) catches *specific, fixable* problems formulas can't — banned terms, passive voice, undefined acronyms — as versioned "style as code." Roll it out with severity tiers, diff-only linting, and a ratcheting baseline so the signal stays trustworthy.
- **Information architecture** is findability, separate from prose quality. Information foraging and *scent* explain "it was there but I couldn't find it"; Diátaxis gives a placement rule; progressive disclosure and "every page is page one" handle layering and cold arrivals.
- **Search is the real IA:** most readers arrive via search, which raises the bar on page titles and self-sufficiency. Validate structure with tree testing, first-click testing, and card sorting, and mine search logs (zero-result queries especially) for ranked, concrete fixes.
- **Cognitive load:** minimize *extraneous* (presentation waste), manage *intrinsic* (sequence and chunk), free capacity for *germane* (learning). The *expertise-reversal effect* is why one doc can't serve novice and expert — scaffolding that helps one hurts the other, the science behind separating tutorial from reference.
- **Judgment:** diagnose findability complaints with logs and tree tests before redesigning; redirect metric mandates toward gaming-resistant *outcomes*; validate any reorg with symmetric before/after measurement and preserved URLs.

---

## Further Reading

- *Letting Go of the Words* — Ginny Redish. The canonical guide to writing web content for scanning and task completion.
- *Information Architecture for the Web and Beyond* (the "polar bear book") — Rosenfeld, Morville & Arango. The reference for IA, findability, and organization systems.
- *Every Page Is Page One* — Mark Baker. Why readers arrive mid-corpus and how to structure for it.
- [Diátaxis](https://diataxis.fr) — Daniele Procida. The four-mode documentation framework used as an IA throughout this page.
- *Information Foraging Theory* — Pirolli & Card; and Nielsen Norman Group's articles on information scent and F-shaped reading — the empirical basis for scanning and scent.
- Sweller, Ayres & Kalyuga, *Cognitive Load Theory* — intrinsic/extraneous/germane load and the expertise-reversal effect.
- [Vale](https://vale.sh) docs, plus the Google and Microsoft developer style guides (both packaged as Vale styles) — prose linting and style as code.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — What Makes Docs Good](../01-what-makes-docs-good/interview.md) — the quality attributes that readability and findability serve.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/interview.md) — the outcome metrics (task success, support deflection) that validate the IA decisions here.
- [Documentation Quality README](../README.md) — where readability and information architecture sit in the broader docs-quality landscape.
