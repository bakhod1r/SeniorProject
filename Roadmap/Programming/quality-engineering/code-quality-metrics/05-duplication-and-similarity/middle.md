# Duplication & Similarity — Middle Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Duplication & Similarity
> *The junior page told you copy-paste is a smell and DRY is the cure. This page makes the smell measurable: the four kinds of clone a tool can find, how token and AST detectors actually find them, what the "duplication %" really divides, and the cases where the right move is to ignore the warning and keep the duplication.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Four Clone Types — a Taxonomy You Can Read](#the-four-clone-types--a-taxonomy-you-can-read)
4. [How Token-Based Detectors Work](#how-token-based-detectors-work)
5. [Line/Hash-Based vs AST-Based Detection](#linehash-based-vs-ast-based-detection)
6. [The Duplication % Metric — What It Divides](#the-duplication--metric--what-it-divides)
7. [Tuning Detection — Killing False Positives](#tuning-detection--killing-false-positives)
8. [DRY vs WET vs AHA — Duplication You Should Keep](#dry-vs-wet-vs-aha--duplication-you-should-keep)
9. [Worked Example — Running CPD on a Type-2 Clone](#worked-example--running-cpd-on-a-type-2-clone)
10. [Mental Models](#mental-models)
11. [Common Mistakes](#common-mistakes)
12. [Test Yourself](#test-yourself)
13. [Cheat Sheet](#cheat-sheet)
14. [Summary](#summary)
15. [Further Reading](#further-reading)
16. [Related Topics](#related-topics)

---

## Introduction

> Focus: **How does a clone detector actually find duplication, and how do I read what it reports?**

At the junior level "duplication" is a single idea: the same code appears twice, extract it. That model is correct but flat — it can't explain *why* the tool flags two functions that don't look identical, *why* it stays silent on two functions that obviously do the same thing, or *why* the duplication number jumped 4% after you added a generated file you never wrote.

The answers come from three things the flat model glossed over: clones come in **four distinct types** (and most tools only catch the first three), detectors operate on a **normalized token stream** (not the raw text your eyes read), and the **duplication %** is a ratio with a configurable numerator and a tunable threshold. This page makes them concrete with real `CPD` and `jscpd` output so you can read a duplication report instead of trusting or dismissing it wholesale.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and can state the DRY principle and the rule of three.
- **Required:** You can read a small code diff and tell which lines changed.
- **Helpful:** You've run *any* static-analysis tool (a linter, SonarQube, a coverage report) and read its output.
- **Helpful:** A rough sense of what "tokenizing" source code means (splitting it into keywords, identifiers, literals, punctuation).

---

## The Four Clone Types — a Taxonomy You Can Read

The clone literature (Roy, Cordy & Koschke) sorts duplication into four types by *how far the copy has drifted from the original*. The number tells you both how easy it is to detect and how confident you can be that it's real duplication worth removing.

**Type-1 — exact clones.** Identical code, character for character, modulo whitespace and comments. The pure copy-paste.

```js
// Type-1: identical except for indentation/comments
function totalA(items){ let s=0; for(const i of items) s+=i.price; return s; }
function totalB(items){ let s=0; for(const i of items) s+=i.price; return s; }
```

**Type-2 — renamed / parameterized clones.** *Same structure*, but identifiers, types, and literals have been changed. Someone copied the block and renamed the variables. To a human skimming, these can look different; to a structural detector they're the same skeleton.

```js
// Type-2: identical structure, renamed variable + different field + literal
function totalPrice(items){ let sum=0;   for(const i of items) sum   += i.price; return sum; }
function totalWeight(rows){  let acc=0.0; for(const r of rows)  acc   += r.weight; return acc; }
```

**Type-3 — gapped clones.** A Type-1 or Type-2 clone that was then *edited* — lines added, removed, or modified in the middle. The copy and the original agree at the head and tail but diverge in a gap. These are the most common real-world clones and the hardest for naive tools, because the detector must tolerate the gap.

```js
// Type-3: same shape as totalPrice, but with an inserted discount line (the "gap")
function totalDiscounted(items){
  let sum = 0;
  for (const i of items) {
    if (i.onSale) i.price *= 0.9;   // <-- inserted line, the gap
    sum += i.price;
  }
  return sum;
}
```

**Type-4 — semantic clones.** *Different code, same behaviour.* No textual or structural overlap — two implementations that compute the same thing by different means. This is the hardest type and is largely **beyond what mainstream tools detect**; it generally requires behavioural or deep semantic analysis, not text or tree matching.

```js
// Type-4: same result (sum of an array), zero structural overlap
function sumLoop(xs){ let s=0; for(let i=0;i<xs.length;i++) s+=xs[i]; return s; }
function sumReduce(xs){ return xs.reduce((a,b)=>a+b, 0); }
```

> **Key insight:** The type number is a *confidence and difficulty scale*. Type-1 and Type-2 are what tools find reliably and what you can mostly trust as real duplication. Type-3 is detectable but tuning-sensitive — the gap size is a parameter. Type-4 is the duplication your tool will almost never report, which is exactly why "0% duplication" never means "no duplication" — it means "no *textual* duplication my detector could see."

---

## How Token-Based Detectors Work

Most production duplication tools — **PMD's CPD** (Copy-Paste Detector), **Simian**, **jscpd** — are *token-based*. They don't compare characters and they don't fully parse the program. They sit in between, and the pipeline is the same across all of them:

1. **Tokenize.** Run a lexer over each file to turn source text into a stream of tokens: `function`, `IDENT`, `(`, `IDENT`, `)`, `{`, `let`, `IDENT`, `=`, `NUMBER`, … Whitespace, comments, and formatting vanish here — which is *why* reformatting a clone doesn't hide it.
2. **Normalize (optionally).** This is the step that catches Type-2. Detectors can collapse every identifier to a single placeholder token (`IDENT`) and every literal to (`LIT`). After this pass, `totalPrice`/`totalWeight` and `sum`/`acc` and `price`/`weight` all become the *same* token, so the two functions produce identical normalized streams.
3. **Find matching subsequences.** Slide over the token streams and find runs that repeat — typically via a *suffix tree* or a rolling hash over windows of tokens. Any repeated run **at least `minimum-tokens` long** is reported as a clone pair.
4. **Map back to source.** Translate the matching token ranges back to file + line ranges so the report points at code you can open.

```
SOURCE          totalPrice(items){ let sum=0; ...
TOKENS          IDENT ( IDENT ) { let IDENT = NUMBER ; ...
NORMALIZED      IDENT ( IDENT ) { let IDENT = LIT    ; ...   <- now matches totalWeight exactly
```

The `minimum-tokens` threshold (CPD's term; jscpd calls the equivalent `--min-tokens`) is the single most important knob: it's the *shortest run of tokens the tool will call a clone*. Set it too low and every `for`-loop header and `if (x == null) return;` gets flagged; set it too high and real clones slip under the radar. Defaults sit around **50–100 tokens** for a reason — that's roughly the length below which "duplication" is just the language's grammar repeating.

> **Key insight:** Token-based detection is a sweet spot. Full parsing is slow and language-specific; raw text matching is fooled by renaming. Tokenizing + normalizing is fast, robust to formatting *and* renaming (Type-2), and only needs a lexer per language — which is why CPD supports dozens of languages and jscpd runs on almost anything. The cost: it has no idea what the code *means*, so Type-4 is invisible to it.

---

## Line/Hash-Based vs AST-Based Detection

Token-based is the mainstream, but it sits between two other families worth knowing because they have opposite strengths.

**Line/hash-based** (the simplest, what many "duplicate finder" plugins and `jscpd`'s fastest mode approximate). Hash each line (or each window of N lines) and look for colliding hashes. Fast and trivial to implement, but brittle: it's essentially Type-1 only. Rename a variable and the line hash changes, so it misses Type-2 entirely, and any reformatting that changes line boundaries throws it off. Useful as a cheap first pass, not as a serious metric.

**AST-based** (structural). Parse each file into an **Abstract Syntax Tree** and look for matching *subtrees*. Because an AST has already thrown away identifier names and formatting and kept only structure, it catches Type-2 naturally and handles Type-3 better — a small edit is a small subtree difference. This is what tools like **Deckard** and IDE "structural search" use, and it's why an AST detector will flag two renamed functions that a line-hash tool calls completely distinct.

| Approach | Catches | Speed | Cost |
|---|---|---|---|
| **Line/hash** | Type-1 | Fastest | Misses renames; sensitive to layout |
| **Token** (CPD, jscpd, Simian) | Type-1, Type-2, much Type-3 | Fast | No semantics; Type-4 invisible |
| **AST** (Deckard, structural search) | Type-1, Type-2, Type-3 well | Slower | Needs a real parser per language |
| **Semantic / behavioural** | up to Type-4 | Slowest, research-grade | Rarely in everyday tooling |

> **Key insight:** Picking a detector is choosing where on the *structure-awareness* axis you sit. More awareness catches more clone types but costs speed and needs a real parser. Token-based wins in practice because it catches the two types you most want (1 and 2) at near-line-scanning speed — but if your codebase is full of renamed-and-lightly-edited copies, an AST tool will surface clones the token tool's normalization missed at the edges.

---

## The Duplication % Metric — What It Divides

Duplication is usually surfaced as a single percentage, and the headline trap is that **different tools divide different things**. You cannot compare two tools' percentages without knowing each numerator.

The general shape is:

```
duplication %  =  duplicated lines (or blocks, or tokens)  /  total lines (or blocks, or tokens)  × 100
```

The variations that bite:

- **SonarQube** reports **duplicated lines density** = duplicated lines ÷ total lines. Crucially, a line counts as duplicated if it falls inside *any* detected duplicated block, and SonarQube counts the lines on *both* sides of a clone pair. Its default block size is around 10 statements/tokens depending on language.
- **jscpd** reports both **% lines** and **% tokens** duplicated, and they differ — token-% is finer-grained because it doesn't round to whole lines. Its summary table gives clones found, duplicated lines, duplicated tokens, and the two percentages side by side.
- **CPD** doesn't headline a single percentage at all by default; it reports *clone instances* with their token counts and locations, and you derive a percentage if you want one.

Typical **thresholds** people set: warn around **3–5%** project-wide, fail CI somewhere around **5–10%** for new code. But the number that actually matters is the **trend on new/changed code**, not the absolute on the whole repo — a legacy codebase can sit at 15% forever, and chasing that to zero is the wrong fight (see the next section). SonarQube encodes exactly this in its "duplication on **new code**" condition in a quality gate.

> **Key insight:** "Duplication %" is not one metric; it's a family with different denominators (lines vs tokens vs blocks) and different counting rules (one side vs both sides of a clone). A 5% from CPD and a 5% from SonarQube are not the same 5%. Always pin down *what's being divided* before you set a threshold or compare two reports — and prefer the percentage **on changed code** as the gate, because that's the only number a developer can act on in a given PR.

---

## Tuning Detection — Killing False Positives

A freshly-installed detector at default settings is *noisy*, and the noise is almost always **legitimate structural repetition the language forces on you**, not real duplication. Three knobs turn the noise off.

**1. Minimum token/line count.** The first and biggest lever. Boilerplate — getters/setters, builder chains, `switch` arms, a sequence of `assertEquals`, struct field assignments — repeats by *nature*, and at a low `min-tokens` every instance trips the detector. Raising `--min-tokens` from, say, 50 to 100 makes the tool ignore short structural repeats and report only runs long enough to be *copied logic* rather than *grammar*.

```bash
# jscpd: raise the floor so 50-token boilerplate stops getting flagged
jscpd --min-tokens 100 ./src

# CPD: same idea, CPD's native flag
pmd cpd --minimum-tokens 100 --files ./src --language java
```

**2. Exclude code you didn't hand-write.** Generated code (protobuf stubs, ORM models, OpenAPI clients, migration files), vendored dependencies, and minified bundles are *expected* to be repetitive and you will never refactor them — counting them inflates the metric and buries the real signal. Exclude them by path.

```bash
jscpd ./src --ignore "**/generated/**,**/*.pb.go,**/migrations/**,**/vendor/**"
```

**3. Decide deliberately on imports and test fixtures.** Long, near-identical *import blocks* and *test setup/fixtures* are a classic false-positive source — every test file legitimately starts the same way. Some teams exclude test directories from duplication entirely (a debated call: duplication in tests can also hide real drift). The point is that it's a *choice*, made once, not an accident you let the default make for you.

The discipline: **a duplication report you haven't tuned is mostly false positives, and a tool that cries wolf gets muted**. Spend the hour to set `min-tokens`, exclude generated paths, and rule on tests *before* you put the number on a dashboard or in a quality gate — otherwise the first thing the team learns is to ignore it.

---

## DRY vs WET vs AHA — Duplication You Should Keep

The hardest part of this topic isn't detection; it's knowing that **some duplication the tool flags is correct and should stay.** The metric measures textual similarity, not whether two pieces of code are *the same idea* — and only the second thing justifies an abstraction.

- **DRY** — *Don't Repeat Yourself*. The original (Hunt & Thomas) is about **knowledge**, not text: "every piece of *knowledge* must have a single, authoritative representation." Two blocks that look the same but encode *different decisions that happen to coincide today* are not a DRY violation — deduplicating them couples two things that should evolve independently.
- **WET** — *Write Everything Twice* (or "We Enjoy Typing"), the tongue-in-cheek opposite, used as a reminder that a little duplication is fine.
- **AHA** — *Avoid Hasty Abstractions* (Kent C. Dodds): prefer duplication over the *wrong* abstraction; wait until the right shape is obvious before extracting.
- **Rule of three** (Fowler): don't extract on the second occurrence — wait for the *third*. Two data points don't reveal the pattern; three start to show which parts genuinely vary and which are stable.

The line everyone quotes here is Sandi Metz's: **"duplication is far cheaper than the wrong abstraction."** The failure mode she's warning about: you DRY up two similar functions into one with a `flag` parameter; then the cases diverge; you add another flag, then a branch, then a third flag — and now one tangled function serves three masters and is harder to change than three honest copies would have been. Backing *out* of a wrong abstraction (re-inlining, then re-splitting) is more expensive than living with the duplication would have been.

So when the detector flags a clone, the senior question isn't "can I remove it?" — it's **"do these two places represent the same decision, such that they must change together?"** If yes, extract. If they're *coincidentally* similar and will drift, mark it `// CPD-OFF` / `// NOSONAR` (with a one-line reason) and keep them apart.

> **Key insight:** The duplication metric is a *prompt to think*, never a verdict. It finds textual similarity; only you can decide whether that similarity reflects shared *knowledge* (extract) or coincidental shape (keep). A high score on a young, still-shifting module is often *healthier* than a premature abstraction would be — extract on the rule of three, when the real seams have revealed themselves.

---

## Worked Example — Running CPD on a Type-2 Clone

Take the Type-2 pair from earlier and run a detector *mentally*, then tune away a false positive.

The two functions, in `totals.js`:

```js
function totalPrice(items){ let sum=0;   for(const i of items) sum += i.price;  return sum; }
function totalWeight(rows){  let acc=0.0; for(const r of rows)  acc += r.weight; return acc; }
```

**Step 1 — tokenize and normalize.** Both become the same normalized stream (identifiers → `IDENT`, literals → `LIT`):

```
IDENT ( IDENT ) { let IDENT = LIT ; for ( const IDENT of IDENT ) IDENT += IDENT . IDENT ; return IDENT ; }
```

Roughly ~30 tokens. Identical after normalization → this is a Type-2 clone.

**Step 2 — apply the threshold.** Run with the default:

```bash
jscpd --min-tokens 50 totals.js
# Found 0 clones.   <-- 30-token match is below the 50 floor; nothing reported
```

Default `min-tokens 50` *misses* it — the clone is real but short. Lower the floor:

```bash
jscpd --min-tokens 25 totals.js
```

```
Clone found (javascript):
 - totals.js [1:1 - 1:62]
   totals.js [2:1 - 2:62]

┌────────────┬────────┬──────────────┬───────────────┐
│ Format     │ Clones │ Duplicated   │ Duplicated %  │
│            │        │ lines        │ (lines/tokens)│
├────────────┼────────┼──────────────┼───────────────┤
│ javascript │ 1      │ 2            │ 100% / ~97%   │
└────────────┴────────┴──────────────┴───────────────┘
```

Now it's caught — proving normalization is what makes Type-2 visible: the raw text differs (`price` vs `weight`, `sum` vs `acc`), but the normalized token streams are identical.

**Step 3 — tune away a false positive.** Suppose the same run also flags two unrelated functions whose *only* overlap is an identical 28-token validation preamble that the framework requires in every handler:

```
Clone found:
 - handlers.js [10:3 - 14:1]   (the required validate-request preamble)
   handlers.js [40:3 - 44:1]
```

That preamble is *boilerplate the framework forces*, not copied logic — a false positive. Two fixes, either valid:

```bash
# Option A: raise the floor above the boilerplate's length so only real clones survive
jscpd --min-tokens 35 .          # 28-token preamble now ignored; the genuine clone (if >35) stays

# Option B: keep the low floor but exclude the noisy file/path
jscpd --min-tokens 25 . --ignore "**/handlers.js"
```

Option A is usually better: it raises the *signal threshold globally* instead of blinding the tool to one file. The judgment call — *is this 28-token match copied logic or required grammar?* — is the entire skill. The tool found a textual match; **you** decided it wasn't duplication worth removing.

---

## Mental Models

- **The clone-type number is a confidence dial.** Type-1/2 are reliable, trustworthy findings. Type-3 is real but tuning-sensitive (the gap is a parameter). Type-4 is the duplication your tool can't see — so "0%" means "0% *detectable text*," never "no duplication."

- **A detector reads the normalized token stream, not your code.** Whitespace, comments, and (with normalization) names and literals are gone before matching starts. That's *why* reformatting and renaming don't hide a clone from a token tool — and why two semantically-identical functions with different structure stay invisible.

- **`min-tokens` is a volume knob, not an on/off switch.** Turn it down and short grammatical repeats roar; turn it up and only copied *logic* comes through. There's no universally correct setting — it's a per-codebase calibration, like a noise gate.

- **The metric is a smoke alarm, not a fire marshal.** It tells you *where to look*. Whether the smoke is a fire (shared knowledge → extract) or burnt toast (coincidental shape → keep) is a judgment the number cannot make for you.

---

## Common Mistakes

1. **Trusting "0% duplication" as "no duplication."** It only means no *textual* clone above your threshold. Type-4 semantic duplication — two different implementations of the same logic — is invisible to mainstream tools and very common.

2. **Comparing percentages across tools.** SonarQube's line-density, jscpd's token-%, and a CPD-derived figure divide different things and count clone sides differently. A 5% here is not a 5% there.

3. **Running at default `min-tokens` and either drowning or missing everything.** Too low floods you with boilerplate false positives; too high silently hides real clones. Calibrate it deliberately for the codebase before gating on the result.

4. **Counting generated and vendored code.** Protobuf stubs, ORM models, migrations, and `vendor/` are *meant* to be repetitive and will never be refactored. Leaving them in inflates the number and buries real signal — exclude by path.

5. **Extracting on the second occurrence.** Two copies don't yet reveal which parts vary. Extracting now risks the wrong abstraction; wait for the rule of three so the real seams show.

6. **DRYing up coincidental duplication.** Two blocks that look the same but encode *different decisions* are not a DRY violation. Merge them and you couple things that should evolve apart — and "duplication is far cheaper than the wrong abstraction."

7. **Gating on whole-repo duplication instead of new-code duplication.** A legacy repo's absolute number won't move and demoralizes everyone. Gate the *trend on changed code* — the only thing a given PR can affect.

---

## Test Yourself

1. Name the four clone types and say which one mainstream tools essentially *cannot* detect, and why.
2. Two functions are identical except that every variable and literal has been renamed. Which clone type is this, and which step in a token detector makes it detectable?
3. Why does reformatting a copied block (changing indentation, adding comments) fail to hide it from a token-based detector but *can* fool a line-hash detector?
4. What is `min-tokens` / `minimum-tokens`, and what happens at the two extremes (very low, very high)?
5. Your duplication metric jumps 4% overnight and you wrote no copy-paste. What's the most likely cause and the fix?
6. The tool flags two similar functions. Under what condition should you *not* deduplicate them, and what's the principle behind that?

<details>
<summary>Answers</summary>

1. **Type-1** (exact), **Type-2** (renamed/parameterized — same structure, different identifiers/literals), **Type-3** (gapped — copied then edited, lines added/removed), **Type-4** (semantic — different code, same behaviour). Tools essentially can't detect **Type-4**: it has no textual or structural overlap, so text- and tree-matching find nothing; it needs behavioural/semantic analysis.
2. **Type-2.** The **normalization** step — collapsing every identifier to `IDENT` and every literal to `LIT` — makes the two normalized token streams identical despite the renaming.
3. A token detector tokenizes first, discarding whitespace and comments, so formatting never reaches the matcher — the token stream is unchanged. A line-hash detector hashes whole lines, so changing line boundaries or content changes the hash and breaks the match.
4. It's the **shortest run of tokens the tool will report as a clone**. Very low → short grammatical repeats (loop headers, getters, `assert` sequences) flood the report with false positives. Very high → real copied logic falls under the floor and is missed.
5. Almost certainly **generated, vendored, or migration code** was added (it's inherently repetitive). Fix: **exclude those paths** (`--ignore`) so only hand-written code is measured.
6. When the two blocks are only **coincidentally similar** — they encode *different decisions that happen to look alike today* and will drift apart. Principle: DRY is about single-sourcing *knowledge*, not text; and "duplication is far cheaper than the wrong abstraction" (plus AHA / rule of three). Keep them separate.

</details>

---

## Cheat Sheet

```
CLONE TYPES (confidence + difficulty scale)
  Type-1  exact (whitespace/comments aside)          easy, trust it
  Type-2  renamed/parameterized — same structure     caught via NORMALIZATION
  Type-3  gapped — copied then edited (lines +/-)     tuning-sensitive (gap = param)
  Type-4  semantic — diff code, same behaviour        tools can't see it → 0% lies

DETECTOR FAMILIES (structure-awareness axis)
  line/hash         Type-1 only           fastest, brittle to rename/layout
  token (CPD/jscpd/Simian)  Type-1/2, much 3   fast, no semantics  ← mainstream
  AST (Deckard, struct-search)  Type-1/2/3 well    slower, needs a parser
  semantic          up to Type-4          research-grade, rare

TOKEN PIPELINE
  tokenize → (normalize IDENT/LIT) → match runs ≥ min-tokens → map to lines

DUPLICATION %  =  duplicated (lines|tokens|blocks) / total × 100
  SonarQube  line density, counts BOTH sides   gate on NEW code, ~3%
  jscpd      reports % lines AND % tokens (differ)
  CPD        clone instances + token counts (derive % yourself)
  ⚠ different denominators → never compare tools' % directly

TUNING (do this BEFORE dashboarding)
  --min-tokens 100      raise floor → ignore boilerplate grammar
  --ignore generated/   exclude generated, vendored, migrations, minified
  tests/fixtures        decide deliberately (exclude or not — a choice)

KEEP-THE-DUPLICATION RULES
  DRY = single source of KNOWLEDGE, not text
  rule of three     extract on the 3rd copy, not the 2nd
  AHA               avoid hasty abstractions
  "duplication is far cheaper than the wrong abstraction" — Sandi Metz
```

---

## Summary

- Clones come in **four types**: Type-1 (exact), Type-2 (renamed — same structure), Type-3 (gapped — copied then edited), Type-4 (semantic — same behaviour, different code). The number is a confidence/difficulty scale; Type-4 is essentially undetectable by mainstream tools, so "0%" only ever means "no detectable *text*."
- **Token-based detectors** (CPD, jscpd, Simian) tokenize source, optionally **normalize** identifiers and literals (this is what catches Type-2), match repeated token runs at least `min-tokens` long, and map back to lines. It's fast, formatting- and rename-robust, and language-cheap — at the cost of seeing no semantics.
- **Line/hash** detection catches only Type-1; **AST** detection catches Type-2/3 better by matching subtrees but needs a real parser. The choice is a position on the structure-awareness axis.
- The **duplication %** is duplicated units ÷ total units, but tools differ on the unit (lines/tokens/blocks) and on counting one vs both sides — so percentages **aren't comparable across tools**. Gate the **trend on new code**, not the whole-repo absolute.
- **Tune before you gate:** raise `min-tokens` to silence boilerplate, exclude generated/vendored/migration paths, and rule deliberately on tests — an untuned report is mostly false positives and quickly gets ignored.
- The metric is a **prompt to think, not a verdict.** DRY is about single-sourcing *knowledge*; coincidental similarity should stay duplicated. Extract on the rule of three, and remember that "duplication is far cheaper than the wrong abstraction."

---

## Further Reading

- *"Comparison and Evaluation of Code Clone Detection Techniques and Tools"* — Roy, Cordy & Koschke. The canonical taxonomy and the source of the Type-1–4 definitions.
- *99 Bottles of OOP* — Sandi Metz & Katrina Owen. The long-form case for "duplication is far cheaper than the wrong abstraction," worked through real refactorings.
- *The Pragmatic Programmer* — Hunt & Thomas. The original DRY chapter; note that it's about *knowledge*, not text.
- "AHA Programming" — Kent C. Dodds (kentcdodds.com). Short, sharp argument for avoiding hasty abstractions.
- PMD CPD docs (`pmd cpd --help`) and the jscpd README — the actual flags (`--min-tokens`, `--ignore`, reporters) for the tools above.

---

## Related Topics

- [junior.md](junior.md) — the DRY principle, copy-paste as a smell, and the rule of three from scratch.
- [senior.md](senior.md) — duplication across services, clone evolution over history, and treating duplication as a debt-prioritization signal rather than a gate.
- [03 — Coupling & Cohesion Metrics](../03-coupling-and-cohesion-metrics/middle.md) — the other side of the coin: deduplicating wrongly *creates* coupling, which these metrics measure.
- [06 — Code Health Dashboards](../06-code-health-dashboards/middle.md) — how the duplication % gets aggregated alongside complexity and churn into a single health view (and why trends beat absolutes).
- [Refactoring](../../../code-craft/refactoring/) — the mechanics of actually removing a clone once you've decided the similarity is shared *knowledge* worth extracting.
