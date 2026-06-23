# Readability & Information Architecture — Middle Level

> **Roadmap:** [Documentation Quality](../README.md) → Readability & Information Architecture
> *The junior page argued that docs should be clear and findable. This page makes both **measurable**: the readability formulas (and exactly why they lie about technical prose), a prose linter you can put in CI, and the IA principles — Diátaxis, information scent, progressive disclosure — that decide whether a reader finds the answer or gives up.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Readability Formulas — What They Measure](#readability-formulas--what-they-measure)
4. [Why the Score Lies About Technical Docs](#why-the-score-lies-about-technical-docs)
5. [Prose Linting — Readability as a CI Gate](#prose-linting--readability-as-a-ci-gate)
6. [Plain-Language Principles](#plain-language-principles)
7. [Information Architecture — Findability & Scent](#information-architecture--findability--scent)
8. [Diátaxis as IA, Progressive Disclosure, Minimalism](#diátaxis-as-ia-progressive-disclosure-minimalism)
9. [Worked Example — A Score, a Vale Rule, and an IA Restructure](#worked-example--a-score-a-vale-rule-and-an-ia-restructure)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What can I actually measure about readability and structure — and where do the numbers stop being trustworthy?**

The junior page made the case that good docs are clear and findable. Both words sound subjective, and that is exactly the problem a middle engineer has to solve: you cannot gate, track, or argue about a property you can only *feel*. So this page does two things. First, it turns "clear" into numbers — the **readability formulas** (Flesch Reading Ease, Flesch-Kincaid, Gunning fog, SMOG) and an **automated prose linter** (Vale) that you wire into CI like any other check. Second, it turns "findable" into engineering — **information architecture**: information scent, the Diátaxis split as a structural rule, progressive disclosure, chunking, and minimalism.

The honest through-line is that the readability *number* is a far weaker instrument than it looks. A formula that rewards short words will mark a perfectly clear paragraph as "hard" the moment it uses `idempotent` or `Kubernetes` — words your audience knows cold and you cannot replace. So we treat the score as a **directional smell**, never a target, and lean on the linter and the IA principles, which catch the failures that actually cost readers time.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can name the quality attributes of a doc (accuracy, clarity, findability, currency).
- **Required:** Comfortable editing a YAML config and running a CLI tool in CI.
- **Helpful:** You've felt the pain of a doc you couldn't navigate — searched, scrolled, gave up.
- **Helpful:** A passing familiarity with [Diátaxis](https://diataxis.fr/) (tutorial / how-to / reference / explanation).

---

## Readability Formulas — What They Measure

Every classic readability formula is a small arithmetic model over three surface features of text: **syllables**, **words**, and **sentences**. They differ only in how they weight those counts. None of them reads meaning — they are counting machines, and understanding that is the whole key to using them correctly.

**Flesch Reading Ease** outputs a 0–100 score where *higher is easier* (a magazine sits around 60–70):

```
RE = 206.835 − 1.015 × (words / sentences) − 84.6 × (syllables / words)
```

Two ratios drive it: average **sentence length** (words per sentence) and average **word length** (syllables per word). Long sentences and polysyllabic words both push the score down.

**Flesch-Kincaid Grade Level** rescales the same two inputs into a US school grade (8.0 ≈ a typical 13-year-old reader):

```
FKGL = 0.39 × (words / sentences) + 11.8 × (syllables / words) − 15.59
```

**Gunning fog** swaps "syllables" for a count of **complex words** (3+ syllables, with some exclusions), again over sentence length:

```
fog = 0.4 × [ (words / sentences) + 100 × (complex words / words) ]
```

**SMOG** (Simple Measure of Gobbledygook) is built for shorter samples and predicts grade from the count of polysyllabic words across 30 sentences. It is the formula health and safety writers reach for because it was calibrated for higher comprehension.

> **Key insight:** Strip away the constants and *every* one of these formulas is the same two knobs — **shorter sentences** and **shorter/simpler words** → "easier" score. They share a blind spot precisely because they share inputs: nothing in any of them looks at vocabulary appropriateness, logical order, accuracy, or whether the sentence is even grammatical. You are measuring two surface ratios and nothing else.

---

## Why the Score Lies About Technical Docs

The formulas were calibrated on general prose — newspapers, military manuals, school texts — and they work reasonably there. Technical documentation violates their core assumption: that **long words signal difficulty**. In our world, the long words are often the *clearest* possible choice.

Consider a sentence aimed squarely at backend engineers:

```
The idempotent handler deduplicates retried webhook deliveries
using the Stripe-signature header.
```

That is crisp, exact, and instantly readable *to its audience*. But `idempotent`, `deduplicates`, `webhook`, and `Stripe-signature` are polysyllabic, so Flesch-Kincaid will score it around **grade 14–16** ("college / hard"). The formula sees four scary words; the reader sees four words they use daily. The score is simply measuring the wrong thing.

The failure runs both ways, which is worse:

- **False alarm (the case above):** unavoidable domain terms tank the score even though comprehension is perfect. If you "fix" it by chasing the number, you replace precise terms with vague ones and make the doc *worse*.
- **False pass:** a sentence can be short, monosyllabic, and score "easy" while being logically incoherent — *"Set the flag. It will not work. Try the other one."* Grade 3 reading level, zero information transferred. The formula can't see that the meaning collapsed.

This is the same trap that runs through this whole roadmap and is set out in [01 — What Makes Docs Good](../01-what-makes-docs-good/middle.md): a cheap proxy gets mistaken for the property it proxies. A readability score is to clarity what line coverage is to test quality — a weak, gameable signal that is genuinely useful only when you refuse to optimize for it directly.

> **Key insight:** Use readability scores as a **directional smell, never a target.** A *rising* grade level across edits is a real signal — your sentences are sprawling, your clauses nesting. The *absolute* number is nearly meaningless for technical prose; "grade 14" on an SRE runbook tells you the topic has long words, not that the writing is bad. Track the trend, ignore the threshold, and never put a hard grade-level gate in CI.

---

## Prose Linting — Readability as a CI Gate

If the formula is too blunt to gate on, what *do* you put in CI? A **prose linter** — a tool that checks writing against explicit, rule-based style criteria the way ESLint checks code. **[Vale](https://vale.sh/)** is the de facto standard: it reads your `.md`/`.rst`/`.adoc`, applies a set of style rules, and emits errors/warnings with file-and-line locations, so it slots straight into a pull-request check.

Vale's value is that its rules target *specific, defensible* problems instead of a single opaque number:

- **Passive voice** — flag it so writers default to active (`"the request is validated"` → `"the server validates the request"`).
- **Weasel words** — `easily`, `simply`, `just`, `obviously`. These lie to the reader (if it were obvious they wouldn't be reading) and Carroll's minimalism school treats them as noise.
- **Sentence length** — warn past, say, 30 words. This is the *one* readability formula input worth gating on, because long sentences genuinely hurt comprehension regardless of vocabulary.
- **Banned / preferred terms** — `whitelist` → `allowlist`, `master` → `primary`, `e.g.` → `for example`.
- **House terminology** — enforce *your* product's spelling: `GitHub` not `Github`, `npm` not `NPM`, your feature's canonical name.

A Vale rule is a small YAML file. Here is a `substitution` rule that enforces house terminology and inclusive language:

```yaml
# styles/House/Terms.yml
extends: substitution
message: "Use '%s' instead of '%s'."
level: error
ignorecase: true
swap:
  whitelist:   allowlist
  blacklist:   denylist
  Github:      GitHub
  Javascript:  JavaScript
```

And an `existence` rule that flags weasel words as a warning:

```yaml
# styles/House/Weasel.yml
extends: existence
message: "'%s' is a weasel word — cut it or be specific."
level: warning
ignorecase: true
tokens:
  - easily
  - simply
  - just
  - obviously
  - of course
```

You don't have to write these from scratch. Vale ships curated packages for the **Google** and **Microsoft** developer style guides plus `write-good` and `proselint`; you enable them in `.vale.ini` and add a thin house layer on top:

```ini
StylesPath = styles
MinAlertLevel = warning
Packages = Google, write-good

[*.md]
BasedOnStyles = Vale, Google, House
```

> **Key insight:** The prose linter — not the readability score — is your real **readability gate**. It encodes *specific, reviewable* rules a human can argue with ("we allow passive voice in the security section"), it produces line-level diagnostics a writer can act on, and it makes style a property the build enforces rather than a debate in every review. This is exactly the docs-as-code move from [Code Craft → Documentation](../../../code-craft/documentation/): treat prose like source, lint it like source.

---

## Plain-Language Principles

Under the linter sits a small, durable set of writing rules that the **[Google](https://developers.google.com/style)** and **[Microsoft](https://learn.microsoft.com/style-guide/)** developer style guides both converge on. A middle engineer should know them because most of them are *automatable* (you can encode them as Vale rules) and all of them are defensible in review:

- **Active voice, not passive.** *"Run the migration"* beats *"The migration should be run."* Active voice names the actor and is shorter — it's the single highest-leverage habit.
- **Present tense.** *"The command returns a token"*, not *"will return."* Docs describe how the system behaves *now*; the future tense adds words and false distance.
- **Second person, imperative.** Address the reader as *you* and give instructions as commands: *"Set `TIMEOUT` to 30."* Avoid *"the user should"* — the reader is the user.
- **One idea per sentence.** The fix for a long sentence is usually a period, not a comma. This also directly improves the readability score, which is the rare case where chasing the number and helping the reader coincide.
- **Lead with the point (BLUF — bottom line up front).** Put the conclusion first, the caveats after. Readers scan; reward the scan.
- **Define a term once, then use it consistently.** Don't elegantly vary `request` / `call` / `invocation` for the same concept — synonyms that read well in an essay create ambiguity in a reference.

These are not stylistic preferences; they are comprehension mechanics. Active voice and one-idea sentences reduce the working-memory load on the reader, which is the actual thing readability formulas are *trying* and failing to measure.

---

## Information Architecture — Findability & Scent

Readability is about the sentence. **Information architecture (IA)** is about everything above the sentence: how pages are organized, named, linked, and surfaced so a reader can *find* the right one. A perfectly written page nobody can locate has zero value — and in practice **findability fails far more often than prose does.**

The central concept is **information scent** (from Pirolli & Card's *information foraging* theory): readers decide whether to click a link or open a page by sniffing the cues — the link text, the heading, the first line — for a "smell" of the answer they want. Strong scent means the label honestly predicts the content. Weak scent means the reader can't tell, so they either click wrong (and bounce) or give up.

```
Weak scent:   "Advanced Topics"  →  reader has no idea if their answer is in there
Strong scent: "Rotating API keys without downtime"  →  reader knows instantly
```

This makes IA quality concrete and even reviewable:

- **Findability** — can a reader locate the page from the entry points they actually use (search, nav, a Google result landing them deep in the site)?
- **Information scent** — do headings and links *predict* their target? Vague labels (`Misc`, `Other`, `Advanced`) are scent failures; specific, verb-led labels are scent wins.
- **Navigation structure** — is the hierarchy shallow and grouped by the reader's task, not your internal team org chart?
- **Search as primary navigation** — accept that for any large doc set, **search is the front door**, not the sidebar tree. Most readers arrive by searching, so titles and first paragraphs must be self-describing out of context. A page that only makes sense after reading the three pages "before" it is broken for the searcher.

> **Key insight:** **Every page is page one** (Mark Baker). You do not control where a reader enters — search and external links drop them onto an arbitrary page with no preamble. So every page must stand alone: a self-explaining title, enough context in the opening lines to orient a cold reader, and links out to prerequisites rather than an assumption that they were already read. Designing for a linear reader who starts at the top is designing for a reader who doesn't exist.

---

## Diátaxis as IA, Progressive Disclosure, Minimalism

The most powerful IA decision in technical docs is the **Diátaxis** split (Daniele Procida): separate content into four modes — **tutorial** (learning-oriented), **how-to** (task-oriented), **reference** (information-oriented), and **explanation** (understanding-oriented) — and *never mix them on one page*. [01 — What Makes Docs Good](../01-what-makes-docs-good/middle.md) treats this as a quality lens; here it's a **structural rule**, because mixing modes is fundamentally an IA failure.

A reader is always in exactly one mode. Someone mid-incident running a how-to does **not** want three paragraphs explaining the design rationale wedged between step 4 and step 5 — that's the wrong mode, and it costs them time when they have none. Someone trying to *understand* the system doesn't want a numbered procedure. Diátaxis is information architecture: it gives every piece of content a home defined by *the reader's mode*, which is exactly what scent and findability need.

Two more IA tools complete the toolkit:

- **Progressive disclosure** — show the common path first; tuck edge cases, advanced options, and deep config behind "Advanced" sections, collapsible blocks, or linked pages. The 80% case stays uncluttered; the 20% is one click away. This is *layering by likelihood*, and it directly serves the scanning reader.
- **Chunking** — break content into labeled, scannable units (short sections, descriptive headings, tables, lists) so a reader can jump to the chunk they need instead of reading linearly. Headings are navigation, not decoration; they are the scent trail through a page.

Underneath all of this is **minimalism** (John Carroll, *The Nurnberg Funnel*): documentation should support *action*, so cut everything that doesn't help the reader do the task. Carroll's research found that learners skip preamble and dive for the doing — so front-load the action, support error recovery, and ruthlessly delete throat-clearing. Minimalism is why "Introduction to the Introduction" sections, restated headings, and "as we all know" filler are not just ugly but *measurably* harmful: they bury the scent the reader is following.

> **Key insight:** Diátaxis, progressive disclosure, chunking, and minimalism are one idea wearing four hats — **match the structure to what the reader is doing right now, and remove everything else.** The reader's *mode* and *task* are the organizing axes of good IA, not your subsystem boundaries or the order in which you happened to build the features.

---

## Worked Example — A Score, a Vale Rule, and an IA Restructure

Take this paragraph from a draft "Getting Started" guide:

> *"In order to be able to make use of the authentication system, it is necessary that the API key, which can be obtained from the dashboard, is provided by the user within the Authorization header of each and every request that is sent to the service."*

**1. Compute Flesch-Kincaid by hand.** Count the surface features. It's one sentence (`sentences = 1`); 45 words (`words = 45`); count syllables — `authentication` = 5, `Authorization` = 5, `obtained` = 2, etc. — totaling roughly 78 (`syllables ≈ 78`).

```
FKGL = 0.39 × (45 / 1) + 11.8 × (78 / 45) − 15.59
     = 0.39 × 45      + 11.8 × 1.733     − 15.59
     = 17.55          + 20.45            − 15.59
     ≈ 22.4
```

Grade **22** — past a doctorate. The formula screams "unreadable," and *this time it's right*, but notice **why** it fired: not the vocabulary (`authentication` is fine for this audience) but the **45-words-in-one-sentence** ratio. The sentence-length input is doing the real work; that's the input worth trusting.

**2. The Vale rule that catches it before review.** Don't rely on a human spotting the run-on. Encode the limit:

```yaml
# styles/House/SentenceLength.yml
extends: occurrence
message: "Sentence is too long (%s words). Aim for under 30; split it."
level: warning
scope: sentence
ignorecase: false
max: 30
token: \b(\w+)\b
```

Now any 30+ word sentence trips a warning in the PR. The same `.vale.ini` would also flag `In order to` (→ `To`) and `make use of` (→ `use`) via the Google package's wordiness rules — three real fixes, all caught mechanically.

**3. Rewrite — plain language wins.** Apply active voice, present tense, second person, one idea per sentence:

> *"To authenticate, send your API key in the `Authorization` header of every request. Get your key from the dashboard."*

Two sentences, ~22 words total. Flesch-Kincaid drops to roughly grade **9** — and, far more importantly, a human reads it in one pass. The *meaning* didn't change; the surface ratios and the cognitive load both did.

**4. The IA restructure.** Suppose that paragraph lived on a single sprawling page titled **"Authentication"** that also contained: a 5-step first-key tutorial, a full table of every auth error code, and three paragraphs on *why* the team chose bearer tokens over sessions. That's all four Diátaxis modes on one page — an IA failure. Split by reader mode:

```
BEFORE  (one page, four modes mixed, weak scent)
  Authentication
    ├─ narrative on what auth is
    ├─ 5-step "get your first key" walkthrough
    ├─ full table of 30 error codes
    └─ rationale: why bearer tokens

AFTER  (four pages, strong scent, progressive disclosure)
  Tutorial:    "Make your first authenticated request"   (learning)
  How-to:      "Authenticate an API request"             (task — the rewrite above)
  Reference:   "Authentication error codes"              (lookup table)
  Explanation: "Why we use bearer tokens"                (understanding)
```

Now the incident responder lands on the how-to (via search) and isn't slowed by the rationale; the newcomer follows the tutorial; the debugger jumps to the error table. Each title has strong scent and stands alone — **every page is page one.** The prose rewrite fixed one sentence; the IA restructure fixed whether anyone finds the right sentence at all.

---

## Mental Models

- **A readability score is a thermometer, not a diagnosis.** It tells you the temperature (two surface ratios) and nothing about the disease. A high reading means "long words and/or long sentences are present" — which on technical prose is often perfectly healthy. Watch the *trend*, never the *threshold*.

- **The prose linter is the real readability gate.** Specific, reviewable, line-level rules a writer can act on and a team can argue with — that's enforceable quality. A single grade-level number is neither specific nor defensible.

- **Information scent is the reader's nose.** Readers don't read; they sniff link text and headings for the smell of their answer and follow the strongest trail. Vague labels (`Misc`, `Advanced`) are odorless; specific, verb-led labels lead the reader home.

- **Every page is page one.** Search and deep links mean you never control the entry point. Each page must orient a cold reader and link to its prerequisites — designing for a top-to-bottom reader is designing for a ghost.

- **Diátaxis is IA, not just taxonomy.** A reader is in exactly one mode (learning / doing / looking up / understanding). Giving each mode its own page is how you stop one reader's needs from being noise to another's.

---

## Common Mistakes

1. **Gating CI on a readability grade level.** Putting "fail the build if FKGL > 10" in the pipeline punishes docs for using the precise domain terms their audience needs. The score is a directional smell; gate on the **prose linter** (sentence length, passive voice, banned terms) instead.

2. **Chasing the score by removing jargon.** Replacing `idempotent` with "it's safe to do twice" to lower the grade level trades a precise word the audience knows for a vague paraphrase. You improved the number and degraded the doc.

3. **Mixing Diátaxis modes on one page.** Wedging design rationale into a step-by-step procedure, or a tutorial into a reference table, forces every reader to wade through content meant for a different mode. Split by what the reader is *doing*.

4. **Vague headings and link text.** `Advanced Topics`, `Misc`, `More`, `Click here` — all scent failures. The reader can't tell if their answer is behind the link, so they bounce. Name the content: `Rotating keys without downtime`.

5. **Writing for the linear reader.** Assuming "they read the previous page" breaks every reader who arrived via search or a deep link — i.e. most of them. Make each page self-orienting; link prerequisites rather than assuming them.

6. **Treating the style guide as taste.** "Active voice, present tense, second person" sound like preferences but are comprehension mechanics — and most are automatable as Vale rules. Encode them so they're enforced, not re-litigated in every review.

---

## Test Yourself

1. What three surface features do *all* the classic readability formulas count, and why does sharing those inputs give them a shared blind spot?
2. A clear, correct sentence aimed at SREs scores "grade 16" on Flesch-Kincaid. What is the formula actually reacting to, and should you rewrite it?
3. Why is a prose linter (Vale) a better CI gate than a readability grade level? Give two concrete rule examples.
4. State the "every page is page one" principle and the reader behavior (search, deep links) that forces it.
5. Your "Database" page contains a setup walkthrough, a config-option reference table, and an essay on the storage engine's design. What IA principle is violated and how do you fix it?
6. What is *information scent*, and what does a "scent failure" look like in a heading or link?

<details>
<summary>Answers</summary>

1. **Syllables, words, and sentences.** Every formula is arithmetic over those three (reducing to "sentence length" and "word length"). Because none of them inspects meaning, vocabulary appropriateness, logical order, or accuracy, they *all* share the blind spot of rewarding short words even when long ones are clearer — and passing short text even when it's incoherent.
2. It's reacting to the **polysyllabic domain terms** (long words → harder score), not to any real difficulty for the SRE audience. This is a false alarm; **do not rewrite** to chase the number — you'd replace precise terms with vague ones. (Do still check the sentence-length input, which is the trustworthy part.)
3. Because the linter encodes **specific, reviewable, line-level** rules a writer can act on and a team can argue with, whereas a grade level is one opaque, gameable number that punishes necessary jargon. Examples: a `substitution` rule mapping `whitelist`→`allowlist`; an `occurrence` rule warning on sentences over 30 words; or an `existence` rule flagging weasel words (`simply`, `just`, `obviously`).
4. **Every page must stand alone** because you don't control the entry point. Search results and external/deep links drop readers onto an arbitrary page with no preamble, so each page needs a self-explaining title, enough opening context to orient a cold reader, and links to prerequisites rather than an assumption they were read.
5. It mixes **Diátaxis modes** (how-to + reference + explanation) on one page — an IA failure that makes every reader wade through content for a different mode. Fix: split into a tutorial/how-to page, a reference page, and an explanation page, each with a self-describing, strong-scent title.
6. **Information scent** is the cues (link text, heading, first line) a reader sniffs to predict whether a page/link holds their answer, from information-foraging theory. A scent failure is a vague label — `Advanced`, `Misc`, `More`, `Click here` — that doesn't predict its content, so the reader clicks wrong or gives up.

</details>

---

## Cheat Sheet

```
READABILITY FORMULAS  (all = arithmetic over syllables/words/sentences)
  Flesch Reading Ease  206.835 − 1.015(w/s) − 84.6(syl/w)   higher=easier (0–100)
  Flesch-Kincaid GL    0.39(w/s) + 11.8(syl/w) − 15.59        → US grade level
  Gunning fog          0.4[(w/s) + 100(complexwords/w)]       → grade (3+ syll words)
  SMOG                 polysyllable count over 30 sentences   → grade (health/safety)
  USE AS: directional smell (watch the TREND). NEVER a CI gate or a target.
  WHY IT LIES: rewards short words → flags unavoidable jargon as "hard."

PROSE LINTER = THE REAL GATE  (Vale)
  rule types:  substitution (term swaps)  existence (banned/weasel)
               occurrence (sentence length)  conditional
  gate on:     sentence length, passive voice, weasel words, banned terms,
               house terminology   (specific + reviewable + line-level)
  packages:    Google, Microsoft, write-good, proselint  + thin house layer

PLAIN LANGUAGE  (Google/Microsoft style guides)
  active voice · present tense · second person/imperative
  one idea per sentence · bottom-line-up-front · one term, used consistently

INFORMATION ARCHITECTURE
  information scent   labels must PREDICT content (no "Misc"/"Advanced"/"Click here")
  every page is page one   search+deep links → each page self-orients
  search = front door   titles/first lines self-describing out of context
  Diátaxis as IA     tutorial / how-to / reference / explanation — never mix on a page
  progressive disclosure   common path first, edge cases behind "Advanced"/links
  chunking           labeled, scannable units; headings ARE the scent trail
  minimalism (Carroll)   support the action; cut preamble and filler
```

---

## Summary

- The classic readability formulas — **Flesch Reading Ease, Flesch-Kincaid, Gunning fog, SMOG** — are arithmetic over three surface counts: **syllables, words, sentences**. They reduce to two knobs: shorter sentences and shorter words score "easier."
- That shared input is a shared blind spot. On technical prose the formulas **lie**: unavoidable domain terms tank the score on perfectly clear text (false alarm), and short incoherent text passes (false pass). Treat the score as a **directional smell, watch the trend, never gate or target it.**
- The real readability gate is a **prose linter** like **Vale** — specific, reviewable, line-level rules (passive voice, sentence length, weasel words, banned/house terms) you wire into CI like ESLint. Lean on Google/Microsoft style packages plus a thin house layer.
- **Plain-language principles** (active voice, present tense, second person, one idea per sentence, BLUF) are comprehension mechanics, and most are automatable as lint rules.
- **Information architecture** decides findability via **information scent** (labels must predict content), **every page is page one** (search and deep links mean each page must stand alone), and **search as the front door**.
- **Diátaxis is IA**: give tutorial / how-to / reference / explanation their own pages and never mix modes. Add **progressive disclosure**, **chunking**, and **minimalism** (Carroll — support the action, cut the rest). The worked example showed all of it: a sentence rewritten from grade 22 to grade 9, a Vale rule to catch the run-on, and a four-mode page split so the reader actually finds the answer.

---

## Further Reading

- **[Google Developer Documentation Style Guide](https://developers.google.com/style)** and the **[Microsoft Writing Style Guide](https://learn.microsoft.com/style-guide/)** — the two authoritative sources for plain-language rules; both are mineable for Vale config.
- **[Diátaxis](https://diataxis.fr/)** — Daniele Procida. Read it here as an *architecture* spec, not just a content taxonomy.
- **[Vale documentation](https://vale.sh/)** — rule types (`existence`, `substitution`, `occurrence`, `conditional`), packages, and CI integration.
- *The Nurnberg Funnel* — John M. Carroll. The origin of minimalism: support the action, cut the preamble.
- *Every Page is Page One* — Mark Baker. Why you must design for readers who arrive in the middle.
- *Information Foraging* — Pirolli & Card. The research behind information scent.

---

## Related Topics

- [junior.md](junior.md) — the qualitative case: what "clear" and "findable" mean before you measure them.
- [senior.md](senior.md) — designing a doc set's IA at scale, taxonomy/search strategy, and treating readability as a system property.
- [01 — What Makes Docs Good](../01-what-makes-docs-good/middle.md) — Diátaxis as a quality lens and the coverage-trap framing this page reuses.
- [06 — Measuring Docs ROI](../06-measuring-docs-roi/middle.md) — when readability and findability fail, this is the cost they impose.
- [Code Craft → Documentation](../../../code-craft/documentation/) — the writing-craft sibling: how to *write* each genre, docs-as-code tooling, and the Vale-in-CI setup from the author's side.
