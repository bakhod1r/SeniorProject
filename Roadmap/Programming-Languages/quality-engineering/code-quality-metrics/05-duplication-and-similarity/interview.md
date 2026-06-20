# Duplication & Similarity — Interview Questions

> **Roadmap:** [Code Quality Metrics](../README.md) → Duplication & Similarity
> *A duplication interview rarely asks "what is DRY." It says "a tool reports 18% duplication — is that bad?" and then watches whether you reach for a refactor reflexively or ask what kind of duplication, where, and whether merging it would couple things that should stay apart. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Why Duplication Matters](#theme-1--why-duplication-matters)
3. [Theme 2 — Clone Types](#theme-2--clone-types)
4. [Theme 3 — Detection Mechanics](#theme-3--detection-mechanics)
5. [Theme 4 — DRY vs the Wrong Abstraction](#theme-4--dry-vs-the-wrong-abstraction)
6. [Theme 5 — Duplication at Scale](#theme-5--duplication-at-scale)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Policy](#theme-7--policy)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **the duplicated text vs the duplicated decision** (two copies of code vs one rule expressed twice)
- **DRY as knowledge, not characters** (the same algorithm, not the same token sequence)
- **coincidental vs essential duplication** (it looks the same today vs it must change together forever)
- **detector reach vs human reach** (what a tokenizer can see vs the semantic clones it never will)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *ask which kind of duplication* before reaching for "extract a function."

---

## Theme 1 — Why Duplication Matters

### Q1.1 — Why is duplicated code considered a defect risk, not just an aesthetic problem?

> **Testing:** Whether you can name the concrete failure mode, not recite "DRY good."

**A.** The risk is the **maintenance trap**: when one logical decision lives in *n* places, a change has to find and update all *n*, and the moment one copy is missed they silently diverge. The missed copy is the bug — a fix applied to three of four payment-rounding sites, a validation tightened everywhere except the import path. Duplication also multiplies the surface for the *same* defect: a bug in a copied block is now a bug in every copy, and each must be patched independently. So the cost isn't the extra lines; it's that duplication converts a single edit into a search-and-synchronize problem the compiler can't help you with, and the failure mode is the *quiet* one — divergence nobody notices until production.

### Q1.2 — What does a "duplication percentage" metric actually measure, and what are its limits?

> **Testing:** Whether you treat the number as ground truth or as a lossy proxy.

**A.** It's typically **duplicated lines (or tokens) ÷ total**, where a detector flags spans above a minimum size that appear more than once, then sums them. It's a useful *trend* signal — is duplication growing as the codebase grows? — and a useful *triage* signal pointing at hotspots. Its limits are sharp. It counts **textual** duplication, so it over-reports harmless boilerplate (generated code, test fixtures, import blocks) and *under*-reports the dangerous kind: the same business rule re-implemented with different variable names and structure, which no token counter sees. It also has no notion of *churn* — 18% duplication in frozen code is irrelevant; 4% concentrated in the file you edit weekly is not. So the percentage answers "how much repeated text," which is only loosely correlated with "how much synchronization risk."

### Q1.3 — State DRY precisely. What's the common misreading?

> **Testing:** Whether you know DRY is about knowledge, not characters.

**A.** DRY — from Hunt & Thomas's *The Pragmatic Programmer* — is: *"Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."* The unit is a **piece of knowledge** — a business rule, an algorithm, a decision — not a line of code. The common misreading is "never type the same characters twice," which leads people to deduplicate *coincidentally identical* code that encodes *different* knowledge, coupling things that have no reason to change together. The corollary the misreading misses: two blocks of identical text that represent two *independent* decisions are *not* a DRY violation, and merging them is a mistake. DRY is violated when one piece of knowledge is expressed twice — even if the two expressions look nothing alike.

---

## Theme 2 — Clone Types

### Q2.1 — Name the four clone types and give a one-line example of each.

> **Testing:** The vocabulary the entire field is built on; whether you know Type-4 is categorically different.

**A.** The standard taxonomy (from the clone-detection literature, e.g. Roy & Cordy):
- **Type-1 — exact clones.** Identical code except whitespace, layout, and comments. *Copy-paste with nothing changed.*
- **Type-2 — renamed/parameterized.** Type-1 plus systematic renaming of identifiers, types, and literals. *Same structure, `userId` became `accountId`.*
- **Type-3 — gapped/near-miss.** Type-2 plus added, removed, or modified statements — copy-paste-and-edit. *Same skeleton, one extra `if` inserted.*
- **Type-4 — semantic clones.** Different syntax, *same behavior* — two implementations that compute the same thing with no textual resemblance. *A `for` loop and a `reduce` that both sum a list; iterative vs recursive factorial.*

The key distinction: Types 1–3 are points on a *textual-similarity* continuum, so they're detectable by looking at the code's form. Type-4 is **behavioral** similarity with *zero* required textual overlap — a different category entirely, and the one that matters most because that's where duplicated *business rules* hide.

### Q2.2 — Which clone types can a token-based detector catch, and where does it fall off?

> **Testing:** Mapping detector mechanics to the taxonomy — not just naming tools.

**A.** A token-based detector (PMD-CPD, the classic Simian approach) tokenizes the source and looks for repeated token sequences, usually *normalizing identifiers and literals to placeholders*. That normalization is exactly what makes it catch **Type-1 reliably and Type-2 well** — renaming `userId`→`accountId` collapses to the same token stream. It catches **Type-3 partially**: a small inserted statement breaks one long match into two shorter ones, so a gapped clone is found only if each fragment still clears the minimum-clone size. It **cannot catch Type-4** at all — different token sequences are invisible to it by construction. So the practical frontier of token detection is "Type-3 with small gaps," and everything semantic is out of reach.

### Q2.3 — What does an AST-based detector buy you over a token-based one?

> **Testing:** Whether you understand structure vs surface text.

**A.** An AST detector compares **subtrees of the parse tree** instead of token streams, so it matches on *structure* and is naturally insensitive to formatting, comment placement, and — depending on the comparison — statement reordering or differing-but-equivalent syntax. That makes it more robust on **Type-3** (a tree-edit-distance comparison tolerates inserted/removed nodes better than a linear token match) and it can recognize some equivalences a token stream can't, like `i = i + 1` vs `i++`. The costs: it needs a real parser per language (more setup, breaks on unparseable/partial code), it's slower, and it can *over*-match common structural patterns (every guard clause looks alike). It still does **not** reach true Type-4 — two structurally different algorithms with the same behavior have different ASTs.

### Q2.4 — What is a PDG-based detector, and why isn't it the default everywhere?

> **Testing:** Awareness of the semantic frontier and its cost.

**A.** A PDG (Program Dependence Graph) represents data- and control-dependencies between statements rather than their order, so a clone is an *isomorphic subgraph*. Because it abstracts away ordering and intervening statements, it can catch **Type-3 clones that are reordered or interleaved**, and it edges toward **Type-4** — it can match two fragments that compute the same dependencies via different statement sequences. It isn't the default because building PDGs and solving subgraph isomorphism is **expensive** (subgraph isomorphism is NP-hard in general; tools use heuristics), it's hard to scale to a large repo, and the results are harder to present to a developer than "these two line ranges are identical." So PDG detection lives mostly in research and specialized tools; mainstream CI uses token or AST detectors and accepts that semantic clones need humans.

---

## Theme 3 — Detection Mechanics

### Q3.1 — Mechanically, how does a token-based detector find repeated spans efficiently?

> **Testing:** Whether you know the algorithm, not just the tool name.

**A.** The pipeline is: **lex** the source into tokens, **normalize** (drop comments/whitespace; replace identifier and literal *values* with type placeholders so `Type-2` clones collapse), then concatenate the token streams and find **repeated substrings** with a **suffix array** (or suffix tree). A suffix array sorts all suffixes of the token sequence; repeated spans show up as adjacent entries sharing a long common prefix, found via the LCP (longest-common-prefix) array. This gives near-linear-time detection of all maximal repeats over the whole corpus — which is why these tools scan millions of lines in seconds. The minimum-clone-size threshold is applied here: only repeats whose length clears the floor are reported.

### Q3.2 — How do you choose the minimum clone size, and what breaks at each extreme?

> **Testing:** The single most consequential knob, and whether you've actually tuned it.

**A.** Minimum clone size (in tokens or lines) is the floor on what counts as a clone. Set it **too low** (say 25 tokens / a handful of lines) and you drown in **false positives**: getters/setters, log lines, three-line guard clauses, `equals`/`hashCode`, struct literals — all structurally identical, none meaningful. Set it **too high** (say 200 tokens) and you miss real copy-paste of medium functions. The pragmatic default for token detectors is around **100 tokens (~50 lines)**, then tune against *your* code by reading the top reports: if they're all boilerplate, raise it; if obvious copied functions slip through, lower it. There's no universal number — it's a precision/recall dial you set by inspecting output, and it differs by language (Java's ceremony needs a higher floor than Python).

### Q3.3 — Boilerplate keeps showing up as duplication. Is the detector wrong? What do you do?

> **Testing:** Whether you distinguish a true positive from a *useful* finding.

**A.** The detector isn't *wrong* — generated serializers, `equals`/`hashCode`, test fixtures, and import blocks genuinely *are* repeated text, so they're true positives. They're just **not actionable**, because the "duplication" is either machine-generated (DRY already lives in the generator) or intentionally explicit (test data you *want* to read inline). The fix is **exclusion, not extraction**: exclude generated directories and well-known boilerplate from the scan, and raise the minimum size so trivial accessors fall out. The judgment is the point — a duplication report is a list of *candidates*, and a chunk of the skill is recognizing which "clones" are noise so the signal (copied business logic) isn't buried. Suppress noise at the config level so reviewers spend attention on the duplication that carries risk.

### Q3.4 — Why do near-miss (Type-3) clones cause false *negatives*, and how do tools fight back?

> **Testing:** Understanding the gap between "exact match" and "real-world copy-paste."

**A.** Real copy-paste is rarely left untouched — someone inserts a line, renames a thing, tweaks a condition. To a linear token matcher, a single inserted statement **splits one long clone into two shorter fragments**, and if either falls below the minimum size, the clone vanishes from the report — a false negative on what's obviously copied code. Tools fight back by allowing **gaps**: a configurable number of mismatched/inserted tokens within a single reported clone (gapped matching), or by using AST/PDG comparisons whose edit-distance tolerance absorbs small insertions. The trade is precision: the more gap you allow, the more unrelated fragments get stitched into spurious "clones." So Type-3 recall and false-positive rate move together, and the gap setting is where you balance them.

---

## Theme 4 — DRY vs the Wrong Abstraction

### Q4.1 — "Duplication is far cheaper than the wrong abstraction." Explain and defend.

> **Testing:** Whether you know Sandi Metz's point — the canonical senior counterweight to reflexive DRY.

**A.** Sandi Metz's argument: when you deduplicate prematurely, you invent an abstraction to serve two callers, then a third need arrives that *almost* fits, so you add a parameter; a fourth adds a flag; soon the abstraction is a tangle of conditionals serving divergent cases, and every caller is coupled to every other through it. Backing out is expensive because callers now depend on the shared thing. **Duplication, by contrast, is cheap to fix later** — you can always extract once the right shape is *obvious from real usage*. Her practical advice: when you inherit a wrong abstraction, **re-inline it** (push the code back into callers) and tolerate the duplication until the correct seam reveals itself. The deep point: a premature abstraction *hides* the divergence that would have told you these cases were actually different.

### Q4.2 — What is the "rule of three," and is it a law?

> **Testing:** Whether you treat heuristics as heuristics.

**A.** The rule of three (Fowler, *Refactoring*, crediting Don Roberts): the **first** time you write something, just write it; the **second** time you duplicate, wince but tolerate it; the **third** occurrence, refactor to remove the duplication. The reasoning is *information*: two instances give you almost no evidence about which parts are essential and which are incidental, but three reveal the shape of what truly varies versus what's stable, so the abstraction you extract is far likelier to be the right one. It's a **heuristic, not a law** — a third copy of a clearly-stable, security-critical rule (password hashing) warrants extraction immediately, while three copies of trivially-different glue might never warrant it. It's a bias toward *waiting for evidence*, not a counter you blindly increment.

### Q4.3 — Give a concrete case where duplication across services is correct, even encouraged.

> **Testing:** The senior insight that DRY stops at the bounded-context boundary.

**A.** Across **bounded contexts / independent services**, sharing code to avoid duplication often does more harm than the duplication. Suppose Orders and Billing both have a `Customer` concept. If you DRY them into one shared `Customer` library, you've coupled two services that should deploy and evolve independently: a change Billing needs now forces a version bump on Orders, and the shared model accretes fields neither context fully wants. The DDD-correct move is to let each context own its *own* `Customer` model — they look duplicated but encode **different knowledge** (Orders cares about shipping address; Billing about tax status). The shared library would have been a *false* DRY — same name, different meaning. The rule: **DRY applies within a bounded context, not across it**; cross-service code sharing trades duplication for coupling, and at a service boundary that's usually a bad trade. (Shared *contracts* — the wire schema — are the deliberate exception, versioned precisely because they're a real coupling.)

### Q4.4 — How does connascence sharpen the "should I deduplicate this?" decision?

> **Testing:** Whether you have a vocabulary for *coupling*, the thing DRY is really managing.

**A.** Connascence (Page-Jones, popularized by Jim Weirich) names *why two pieces of code must change together*: connascence of **name** (both call `parseDate`), of **algorithm** (both must implement the *same* checksum to interoperate), of **meaning** (both treat `-1` as "not found"), and so on, graded by strength and locality. It reframes the duplication question precisely: deduplicating is worth it when the two copies share **strong, real connascence** — they encode the *same* algorithm and *must* stay identical, so a single source removes a synchronization hazard. But if two copies only share **weak or coincidental** connascence — they happen to look alike today but have no obligation to change together — then merging them *manufactures* connascence that didn't exist, coupling independent code through a shared abstraction. So the test isn't "do these look the same?" but "**are these obligated to change together?**" Connascence gives you the language to answer that instead of pattern-matching on text.

---

## Theme 5 — Duplication at Scale

### Q5.1 — Why is duplicated *business logic* more dangerous than duplicated code, and why won't a tool catch it?

> **Testing:** The Type-4 problem stated in business terms — the most important idea on this page.

**A.** Duplicated business logic is the **same decision implemented in multiple places with no textual resemblance** — the discount cap enforced in the checkout service with an `if`, again in the admin tool via a lookup table, again in a nightly batch job as a SQL `CASE`. It's dangerous because the rule *will* change (legal lowers the cap), and whoever changes it has no mechanical way to find the other two sites — they don't share names, structure, or tokens, so grep and the duplication detector both miss them. This is **Type-4 semantic duplication**, and it's invisible to token and AST detectors by construction. The damage is the silent divergence: checkout now enforces the new cap, the batch job still uses the old one, and the discrepancy surfaces as a financial discrepancy weeks later. The defense is *organizational*, not tooling — make each business rule a single named owner (a domain service, a rules module) so there's an obvious place it lives and an obvious place to change it.

### Q5.2 — A team's god-utility library has near-zero internal duplication but couples the whole codebase. What went wrong?

> **Testing:** Whether you see that aggressive deduplication *creates* coupling.

**A.** They optimized the *duplication metric* and paid for it in **afferent coupling**. Every time someone found two similar helpers, they hoisted the commonality into `utils`/`common`/`core`, so the library has minimal internal repetition — and now *everything* depends on it. The result: that one module has enormous fan-in, any change to it risks the entire system, it can't be reasoned about in isolation, and it's become a magnet that accretes unrelated functions glued together only by "shared-ness." The lesson is that **duplication and coupling are a trade**, not independent goods — driving duplication to zero by centralizing pushes coupling *up*. A healthy codebase tolerates some duplication to keep modules independent; the god-utility is what you get when DRY is pursued without regard to the [coupling](../03-coupling-and-cohesion-metrics/interview.md) it generates.

### Q5.3 — Walk through the extract-vs-duplicate decision for a block that appears in two modules.

> **Testing:** A repeatable decision procedure, not a reflex.

**A.** I'd ask, in order:
1. **Same knowledge or coincidence?** Do these encode the *same decision*, obligated to change together (extract-worthy), or do they merely look alike today (leave them)? This is the whole ballgame.
2. **Same bounded context?** If the two modules are independent services / contexts, sharing code couples them across a boundary that should stay loose — bias toward *duplicate*.
3. **How many, and how stable?** One duplication with an unclear shape → wait (rule of three). Third copy of a stable, critical rule → extract now.
4. **What does the abstraction cost?** If extracting needs three parameters and a flag to fit both callers, that's the wrong-abstraction smell — the cases are diverging, so *duplicate*.
5. **Where would it live?** If the natural home is a god-utility everything already depends on, extracting raises coupling — weigh that against the synchronization risk.

The default when uncertain is **duplicate and wait**: re-inlining a wrong abstraction is expensive, while extracting later from clear duplication is cheap.

### Q5.4 — How do you find Type-4 (semantic) business-rule duplication if tools can't?

> **Testing:** Practical tactics for the unwinnable-by-tooling problem.

**A.** Since detectors don't see it, you attack it through **people and structure**: (1) **domain modeling** — name each business rule and give it one home (a domain service or policy object) so duplication has nowhere to hide; (2) **code review and pairing** focused on "is this rule expressed elsewhere?" — the reviewer who knows the domain is your real Type-4 detector; (3) **tracing a change** — when a rule changes, audit every place that *consumes* the same input or produces the same output, not just textual matches; (4) **architecture tests / fitness functions** that assert, e.g., "only the pricing module references the discount table"; and (5) treating recurring incidents-from-divergence as the signal to consolidate a rule. The honest framing in an interview: *no tool catches this, so the metric will read green while the real risk is unmeasured — which is exactly why duplication % must never be your only signal.*

---

## Theme 6 — Scenario and Judgment

### Q6.1 — A tool reports 18% duplication on a service. Is that bad? What do you check?

> **Testing:** Whether you treat a number as a verdict or as the start of an investigation.

**A.** 18% is **not a verdict** — it's a prompt to look. I'd check, in order:
1. **What's being counted?** Open the top reports. If it's generated code, test fixtures, migrations, and `equals`/`hashCode`, most of the 18% is noise — exclude it and re-measure.
2. **Where is it?** Duplication in frozen, never-touched code costs little; the same percentage concentrated in a high-**churn** file is a real synchronization hazard. Cross-reference with churn.
3. **What type?** Exact copy-paste of a business function is actionable; structurally-similar-but-independent code is fine to leave.
4. **Trend.** Is 18% rising release over release (rot) or stable/falling (under control)?

Only after that do I have an opinion. The wrong answer is "18% is over our threshold, refactor it" — that optimizes the number and risks creating wrong abstractions. The number tells you *where to look*, never *what to do*.

### Q6.2 — Code review: two functions are ~80% similar. Would you merge them? How do you decide?

> **Testing:** The wrong-abstraction judgment applied live.

**A.** Eighty-percent-similar is a **warning, not a mandate** — the 20% difference is the whole question. I'd ask whether the two functions encode the **same decision that must change together**, or two decisions that happen to overlap today. Concretely: if I change this function, *must* the other change identically? If yes — same knowledge — merging removes a real hazard, and I'd extract. If the differences reflect genuinely different cases (different validation rules, different domains), merging means a shared function with a `mode` flag and divergent branches — the wrong-abstraction trap — and I'd **leave them duplicated** and say so in the review. I'd also weigh whether they're in the same module/context (merge is cheaper within one) and how likely a third case is (rule of three). The reviewer who blindly says "DRY violation, merge it" is the one to worry about.

### Q6.3 — A manager mandates "0% duplication." What's wrong with that, and how do you respond?

> **Testing:** Whether you can push back on a metric target with a principled argument.

**A.** A 0% mandate is a **Goodhart trap**: the moment duplication % becomes the target, people will hit it by hoisting every coincidental similarity into shared utilities, manufacturing coupling and wrong abstractions that are *far* more expensive than the duplication they removed — exactly Sandi Metz's "the wrong abstraction." It also pretends the metric is precise when it (a) over-counts boilerplate you *should* keep and (b) is blind to the semantic duplication that actually causes incidents — so 0% textual duplication can coexist with serious duplicated business logic. My response: reframe the goal from *eliminating duplication* to *managing synchronization risk*. Replace the absolute target with a **diff-based gate** ("don't add new large clones"), exclusions for boilerplate, and a focus on **duplication × churn**. The honest one-liner: a 0% mandate optimizes a proxy and will make the real code worse.

### Q6.4 — Six months ago you DRY'd two payment paths into one helper. Now every change needs a flag. What do you do?

> **Testing:** Recognizing and *backing out* a wrong abstraction — the hard, senior move.

**A.** This is a textbook **wrong abstraction**: the accumulating flags are the symptom that the two callers were never really the same case — the abstraction has been *forcing* divergent logic through one path. The senior move is Sandi Metz's: **re-inline it**. Push the shared code back into the two (or more) call sites, deliberately re-introducing the duplication, then delete the conditionals so each path expresses *only* its own logic cleanly. With the cases separated and honest, the *real* commonality (if any) becomes visible, and I can extract a *smaller, correct* abstraction around just the genuinely-shared part — or accept that there isn't one. The instinct to fight here — "we already DRY'd it, adding one more flag is less work" — is the sunk-cost reasoning that lets wrong abstractions metastasize. Backing out *is* the fix.

### Q6.5 — Greenfield service, you copy-paste a validation block into a second handler "for now." Defensible?

> **Testing:** Whether you can *defend deliberate duplication* — the inverse skill.

**A.** Yes — deliberately, and I'd say so in the PR. Early in a service the right abstraction isn't knowable; with only two instances I have almost no information about what truly varies, so extracting now risks a wrong abstraction I'll pay to back out. Copy-paste-and-wait (the rule of three) keeps the two handlers **independent and easy to change** while the design is still moving, and the duplication is *cheap to consolidate* the moment a third case clarifies the shape. The caveat that makes it responsible: this applies to *coincidental* duplication. If the copied block were a **critical, stable rule** — say password hashing or a security check — I'd extract immediately, because there the cost of divergence (a missed copy = a vulnerability) dwarfs the wrong-abstraction risk. So the defense is conditional: duplicate while the shape is uncertain *and* the stakes of divergence are low.

---

## Theme 7 — Policy

### Q7.1 — How would you gate duplication in CI without it becoming counterproductive?

> **Testing:** Designing a policy that survives contact with real teams.

**A.** I'd gate on the **diff, not the absolute**: fail the build only when a change **introduces a new clone above the minimum size**, rather than enforcing a whole-repo percentage. A repo-wide threshold punishes whoever happens to touch a file with pre-existing duplication and pressures people toward bad deduplication to "get under the number"; a diff-based gate (the [ratchet](../README.md) pattern) stops *new* copy-paste cold while never forcing a risky refactor of legacy code. I'd pair it with: generous **exclusions** for generated code, tests, and migrations; a **per-PR override** with justification (deliberate duplication is legitimate, per the wrong-abstraction argument), so the gate informs rather than dictates; and reporting the *trend* to humans rather than blocking on it. The principle: block the regression, advise on the rest.

### Q7.2 — What do you exclude from duplication scanning, and why isn't that "cheating"?

> **Testing:** Whether exclusions are principled or a way to game the metric.

**A.** I'd exclude **generated code** (protobuf/ORM/serializers — DRY lives in the generator, not the output), **test fixtures and data builders** (intentional, readable repetition you *want* inline), **database migrations** (append-only by nature; "deduplicating" them is wrong), and **vendored/third-party** code (not ours to refactor). It isn't cheating because the metric's purpose is to surface **actionable synchronization risk**, and these categories carry none — flagging them is a *false positive* that buries the real signal. The line between legitimate exclusion and gaming is *intent*: excluding generated code sharpens the signal; excluding your own duplicated business logic to make the number look good defeats the purpose. A good rule of thumb — if a reviewer would never act on a flag, excluding its source is housekeeping, not cheating.

### Q7.3 — Why combine duplication with churn, and how would you operationalize it?

> **Testing:** The single highest-leverage refinement to a raw duplication metric.

**A.** Because **risk = duplication × change-frequency**, not duplication alone. Duplicated code that never changes can't drift — the synchronization hazard only fires when someone *edits* one copy and forgets the others, which only happens in code that's actually edited. So a clone in a stable, year-old file is near-zero risk, while a smaller clone in a file touched every sprint is where divergence bugs are born. To operationalize: pull change frequency from `git log` per file, intersect it with the clone report, and **rank clones by (clone size × churn)**. That ranking turns a flat list of hundreds of clones into a short list of "duplicated code you keep touching" — the genuine refactor candidates. It's the same insight as a [complexity](../01-cyclomatic-and-cognitive-complexity/interview.md)×churn hotspot map, applied to duplication: the metric matters most where the code moves.

### Q7.4 — How do you introduce a duplication metric to a large legacy codebase without a revolt?

> **Testing:** Change management around a metric, not just the metric.

**A.** Never flip on a repo-wide threshold against legacy code — it'll fail thousands of pre-existing clones, block everyone, and teach the team to hate the tool. Instead: (1) measure first and **publish the baseline** as information, no gating; (2) turn on a **diff-based ratchet** that only blocks *newly introduced* duplication, so the existing debt is grandfathered and the trend can only improve; (3) configure **exclusions** up front so the first reports aren't all boilerplate noise — credibility dies on a false-positive-heavy first run; (4) rank existing clones by **churn** and tackle only the top handful deliberately, as normal refactoring work, not a mandate; (5) frame it as *risk management*, explicitly stating that some duplication is correct (wrong-abstraction, bounded contexts) so the team trusts that the goal isn't a vanity zero. Block regressions, illuminate the rest, and let the cleanup be opt-in and prioritized.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: What's a Type-1 clone?** A: Identical code apart from whitespace, layout, and comments — pure copy-paste.
- **Q: Type-2?** A: Type-1 plus systematic renaming of identifiers, types, and literals.
- **Q: Type-3?** A: Near-miss / gapped — a copied block with statements added, removed, or modified.
- **Q: Type-4?** A: Semantic clones — same behavior, different syntax, no textual overlap required.
- **Q: Which clone type do token detectors miss entirely?** A: Type-4 (semantic) — different tokens are invisible to them.
- **Q: What data structure makes token clone detection fast?** A: A suffix array (or suffix tree) with an LCP array, finding repeated spans in near-linear time.
- **Q: State DRY in one line.** A: Every piece of *knowledge* has a single authoritative representation — knowledge, not characters.
- **Q: What's the rule of three?** A: Tolerate duplication until the third occurrence, then refactor — wait for enough evidence to abstract correctly.
- **Q: Sandi Metz's warning in one line?** A: Duplication is far cheaper than the wrong abstraction; re-inline a bad abstraction rather than extend it.
- **Q: When is cross-service duplication correct?** A: Across bounded contexts — sharing the code would couple services that must evolve independently.
- **Q: What does connascence add?** A: A vocabulary for *why* two pieces must change together, replacing "looks the same" with "obligated to change together."
- **Q: Why combine duplication with churn?** A: Risk lives where duplicated code is *also frequently edited*; static clones rarely drift.
- **Q: What's wrong with a 0% duplication mandate?** A: It's a Goodhart target that manufactures coupling and wrong abstractions, and ignores semantic duplication entirely.
- **Q: Diff-based gate vs absolute threshold?** A: Block only *newly added* clones; never force refactors of pre-existing legacy duplication.
- **Q: Two things you'd exclude from scanning?** A: Generated code and test fixtures — repetition there carries no synchronization risk.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating DRY as "never repeat characters" rather than "never repeat knowledge."
- Reaching for "extract a function" the instant two things look similar.
- Believing the duplication percentage is precise — unaware it over-counts boilerplate and is blind to semantic clones.
- Not knowing Type-4 exists, or thinking tools catch it.
- Defending a 0% / fixed-threshold mandate with no mention of wrong abstractions.
- Never having heard that *some* duplication (bounded contexts, pre-rule-of-three) is correct.

**Green flags:**
- Asking *which kind* of duplication — coincidental vs essential — before proposing a fix.
- Citing the wrong-abstraction trade ("duplication is cheaper than the wrong abstraction") and the back-out move (re-inline).
- Naming the semantic / Type-4 blind spot unprompted and proposing organizational, not tooling, defenses.
- Combining duplication with churn to rank what actually matters.
- Designing a diff-based gate with exclusions instead of a repo-wide threshold.
- Knowing DRY stops at the bounded-context boundary, and that centralizing trades duplication for coupling.

---

## Summary

- The bank reduces to four distinctions in costumes: **duplicated text vs duplicated decision**, **DRY-as-knowledge vs DRY-as-characters**, **coincidental vs essential duplication**, **detector reach vs human reach**. Ask *which kind* before acting.
- **Why it matters:** duplication is a *maintenance trap* — one decision in *n* places means a change must synchronize all *n*, and the missed copy is the silent bug. The percentage is a lossy proxy, not a verdict.
- **Clone types:** Type-1 (exact), Type-2 (renamed), Type-3 (gapped), Type-4 (semantic). Token detectors catch 1–2 well, 3 partially, **4 never**; AST helps on 3; PDG edges toward 4 but is too costly for default CI.
- **Mechanics:** lex → normalize → suffix array for near-linear repeat-finding; the **minimum clone size** is the precision/recall dial; boilerplate is a true positive but *not actionable* — exclude it.
- **DRY vs wrong abstraction:** the wrong abstraction is costlier than duplication (Metz); wait for the **rule of three**; duplication is correct **across bounded contexts**; **connascence** reframes the question as "must these change together?"
- **At scale:** the dangerous duplication is **semantic business logic** no tool sees; driving duplication to zero builds **god-utilities** that trade duplication for coupling. Default when uncertain: **duplicate and wait**.
- **Policy:** gate on the **diff** not the absolute, **exclude** boilerplate, rank by **duplication × churn**, and frame the goal as managing synchronization risk — never a vanity zero.

---

## Further Reading

- *The Pragmatic Programmer* (Hunt & Thomas) — the original, precise statement of DRY as *knowledge*, not text.
- *Refactoring* (Martin Fowler) — "Extract Function," the rule of three, and the smell catalog for duplication.
- "The Wrong Abstraction" (Sandi Metz, 2016) — the canonical argument that duplication beats premature abstraction, and the re-inline remedy.
- *Domain-Driven Design* (Eric Evans) — bounded contexts; why the same concept legitimately exists twice across them.
- Roy & Cordy, "A Survey on Software Clone Detection Research" — the Type-1..4 taxonomy and detector mechanics (token/AST/PDG).
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [03 — Coupling and Cohesion Metrics](../03-coupling-and-cohesion-metrics/interview.md) — the coupling that aggressive deduplication creates, and why god-utilities are the failure mode.
- [01 — Cyclomatic and Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/interview.md) — the complexity×churn hotspot pattern that duplication×churn mirrors.
- [Code Quality Metrics README](../README.md) — where duplication sits among the metrics, and the diff-based ratchet pattern for gating any of them.
