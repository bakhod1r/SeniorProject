# Maintainability Index — Interview Questions

> **Roadmap:** [Code Quality Metrics](../README.md) → Maintainability Index
> *A Maintainability Index interview is rarely "recite the formula." It's "your exec wants to rank teams by MI — what do you say," and then it watches whether you can defend the formula's mechanics, expose its provenance, and still extract the one thing it's good for. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — What MI Is](#theme-1--what-mi-is)
3. [Theme 2 — The Formula and Its Ingredients](#theme-2--the-formula-and-its-ingredients)
4. [Theme 3 — Halstead Metrics](#theme-3--halstead-metrics)
5. [Theme 4 — The Critique](#theme-4--the-critique)
6. [Theme 5 — Correct Use](#theme-5--correct-use)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Better Alternatives](#theme-7--better-alternatives)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *stance* they keep returning to:

- **a composite is not a measurement** (MI fuses three signals into one number, and fusion destroys the information you'd need to act)
- **the constants are empirical, not physical** (171 and the coefficients came from a 1990s regression on a specific corpus; they don't generalize)
- **relative trend beats absolute grade** (MI = 64 means nothing; MI fell from 64 to 59 on the same file with the same tool means something)
- **decompose to act** (you never fix "MI"; you fix the complexity or the length term that moved it)

Nearly every question in this bank is one of those four ideas wearing a costume. The candidates who do well are the ones who can *recite the formula accurately* and *then immediately explain why you shouldn't trust its absolute value* — both halves, in the same breath.

---

## Theme 1 — What MI Is

### Q1.1 — What is the Maintainability Index, in one minute?

> **Testing:** Can you state the goal and the shape of the metric without reaching for the formula?

**A.** The Maintainability Index is a **single composite score that tries to summarize how hard a piece of code will be to maintain**, computed from three lower-level metrics: Halstead Volume (a size/vocabulary measure), Cyclomatic Complexity (a branching measure), and Lines of Code. It was introduced by Oman and Hagemeister in the early 1990s as a regression fit against expert maintainability ratings. The original formula is *unbounded* and can go negative; the version most engineers actually see is **Microsoft Visual Studio's rescaled 0–100 version**, where higher is better. The honest one-minute version is: it's a rough, much-criticized proxy — useful as a *relative trend on one codebase with one tool*, and actively misleading as an absolute grade.

### Q1.2 — What does the 0–100 scale mean, and what are the Visual Studio bands?

> **Testing:** Whether you know the scale you're quoting is a *vendor convention*, not a law.

**A.** Visual Studio rescales the raw MI into **0–100, where higher is more maintainable**, and buckets it into three color bands:
- **20–100: green** ("good maintainability"),
- **10–19: yellow** ("moderate"),
- **0–9: red** ("low maintainability").

The thing to flag is how *coarse* those thresholds are: the entire "this is fine" range is 20–100, an 80-point band, while the alarming zone is squeezed into 0–9. That asymmetry tells you the metric was never meant to grade fine-grained quality — it's a smoke detector for the genuinely awful, not a thermometer for "is this 72 or 78." Treating the boundaries (especially the 20 and 10 cutoffs) as meaningful precision is the first mistake people make.

### Q1.3 — Is a file with MI 85 "more maintainable" than one with MI 70?

> **Testing:** Whether you'll resist the natural reading of a bigger number as straightforwardly better.

**A.** Not reliably — and that's the central trap. The MI is a *monotonic* function of its inputs, so on average lower complexity and length push it up, but a 15-point gap can be dominated entirely by the **LOC term** (the file is just shorter), not by anything you'd recognize as "maintainability." A short, dense, deeply-nested function can score *higher* than a long, flat, obvious one, because length is heavily weighted and clarity isn't measured at all. So I'd say: the 85 file is probably smaller and/or less branchy, but I wouldn't conclude it's easier to maintain without looking at *which term* drove the difference. The number ranks the inputs, not the actual maintenance experience.

---

## Theme 2 — The Formula and Its Ingredients

### Q2.1 — Write the Maintainability Index formula and explain each term.

> **Testing:** The core technical knowledge — can you reproduce it accurately and explain *what each term does*?

**A.** The classic (Oman–Hagemeister / SEI three-metric) form is:

```
MI = 171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)
```

where **HV** is Halstead Volume, **CC** is Cyclomatic Complexity, and **LOC** is Lines of Code (averaged or summed per module depending on the tool). Reading it term by term:
- **171** is the intercept — the empirical "ceiling" the regression started from. Trivial code lands near it.
- **−5.2·ln(HV)** penalizes *vocabulary and size* — more distinct operators/operands and more total tokens lower the score, but only **logarithmically**, so doubling the volume costs a fixed amount, not a doubling.
- **−0.23·CC** penalizes *branching* — each unit of cyclomatic complexity subtracts a small, **linear** amount.
- **−16.2·ln(LOC)** penalizes *length* — also logarithmic, but with by far the **largest coefficient**, which is why length tends to dominate the result.

The everyday Visual Studio variant wraps this in a clamp-and-rescale: `MAX(0, MI_raw × 100 / 171)`, mapping it onto 0–100. There's also a four-metric variant that adds a *percent-comments* term, but the three-metric form above is the one to know.

### Q2.2 — Which term usually dominates, and why does that matter?

> **Testing:** Whether you understand the *weighting*, not just the symbols — this is where the critique starts.

**A.** **Lines of Code dominates**, because of that `−16.2·ln(LOC)` coefficient — it's roughly three times the Halstead coefficient and the cyclomatic term is almost negligible by comparison. The practical consequence: MI is, to a first approximation, **a length metric with two minor adjustments**. You can move a file's MI more by deleting blank lines or splitting it than by genuinely untangling its control flow. This matters because it inverts the metric's marketing — it's sold as a *maintainability* score, but it behaves mostly like an inverse size score, and "shorter" and "more maintainable" are not the same thing. A 30-line regex with no spaces can outscore a clear 120-line function.

### Q2.3 — Why are the HV and LOC terms wrapped in a logarithm but CC is linear?

> **Testing:** Whether you can reason about the *shape* of the model, not just recite it.

**A.** The logarithm encodes **diminishing returns on size**: going from a 10-token to a 100-token expression is a big maintainability jump, but going from 1,000 to 1,090 tokens barely registers — `ln` compresses large values so the penalty grows slowly at scale. Cyclomatic complexity is left linear because the model treats *each additional independent path* as a roughly constant extra increment of testing/understanding burden — branch number 12 costs about what branch number 3 cost. Whether either choice is *empirically justified* is exactly the part that doesn't generalize (the coefficients were fit to one corpus), but the intent is: size hurts with diminishing marginal pain, branching hurts at a steady rate.

### Q2.4 — What's the difference between the raw formula and what Visual Studio shows?

> **Testing:** Whether you know the number on your screen has been transformed — a common source of cross-tool confusion.

**A.** The **raw Oman–Hagemeister formula is unbounded and can go negative** — a genuinely horrible file can score −40. Visual Studio applies `MAX(0, raw × 100 / 171)`, which **floors negatives at 0 and rescales to a 0–100 ceiling**. Two consequences worth stating: first, the clamp means everything truly terrible piles up at 0, so VS *can't distinguish* a −5 file from a −200 file — they're both "0." Second, because of the rescale, a "VS MI of 60" is *not* comparable to a "raw MI of 60" from some other tool, and it's not even comparable across tools that each rescale differently. The transform is the first reason two tools report different MI for the same file.

---

## Theme 3 — Halstead Metrics

### Q3.1 — What are Halstead's operators and operands, and how do you get Volume?

> **Testing:** Whether you actually know what feeds the HV term, not just that "Halstead Volume" is an input.

**A.** Halstead's metrics count two kinds of tokens in source code:
- **operators** — the "verbs": `+`, `=`, `if`, `while`, function-call parens, `;`, and so on,
- **operands** — the "nouns": identifiers, literals, constants.

From four counts — **n₁** (distinct operators), **n₂** (distinct operands), **N₁** (total operators), **N₂** (total operands) — you derive:
- **Vocabulary** `n = n₁ + n₂`,
- **Length** `N = N₁ + N₂`,
- **Volume** `V = N × log₂(n)`.

Volume is "program length times the bits needed to encode each token from the vocabulary" — intuitively, the size of the program measured in information, not just line count. That `V` is the **HV** plugged into the MI formula.

### Q3.2 — Why is Halstead Volume tokenizer- and language-dependent?

> **Testing:** The deepest reason MI doesn't transfer across languages or tools — the inputs themselves aren't standardized.

**A.** Because **"what counts as an operator vs an operand" is a judgment call, and every tool makes it differently**. Is `[]` one operator or two? Does a method call count its `.`, its name, and its parens as one operator or three? Are keywords like `return` operators or ignored? Halstead never nailed this down precisely, so each tool's tokenizer encodes its own rules — and the same source file produces *different* n₁/n₂/N₁/N₂, hence different Volume, on different tools. Worse, the conventions are *language-specific*: Python's `for x in xs` and C's `for(;;)` aren't tokenized comparably, so a Python HV and a C HV aren't on the same scale to begin with. This is the root cause of "the tools disagree" — the disagreement starts at the very first count, before any formula runs.

### Q3.3 — Halstead also defines "difficulty" and "effort." Do those feed the MI?

> **Testing:** Whether you know exactly which Halstead quantity MI uses — a precise-knowledge check.

**A.** No — the MI uses only **Volume**. Halstead's broader system also defines **Difficulty** `D = (n₁/2)·(N₂/n₂)` and **Effort** `E = D × V` (and even predicted time and bug counts from those), but the standard three- and four-metric MI formulas pull in **Volume alone**. That's worth knowing because people sometimes assume MI "includes Halstead complexity/effort" — it doesn't; it takes the one Halstead quantity that's essentially an information-theoretic size measure, which is part of why MI ends up so size-dominated. The Difficulty and Effort numbers, which are the more behaviorally interesting Halstead outputs, are left out entirely.

### Q3.4 — How seriously should I trust Halstead numbers on their own?

> **Testing:** Calibrated skepticism — Halstead is even shakier than CC, and a senior should say so.

**A.** Lightly. The Halstead metrics rest on a **psychological model from 1977** (effort and bug counts derived from token statistics) that has **not held up well empirically** — the predicted-bugs and predicted-time formulas in particular are not something I'd put weight on. As a *rough size/vocabulary signal*, Volume is fine and stable enough to use as one input among several. But I wouldn't report Halstead Difficulty or Effort to a team as a quality verdict, and I'd never compare them across languages. The defensible use is the same as MI's: a same-tool, same-language relative signal, never an absolute or cross-context grade.

---

## Theme 4 — The Critique

### Q4.1 — Where did the constant 171 come from, and why is that a problem?

> **Testing:** The single most important critique — the provenance of the magic numbers.

**A.** The 171, and the 5.2 / 0.23 / 16.2 coefficients, came from a **regression that Oman and Hagemeister fit in the early 1990s against subjective maintainability ratings of a specific corpus** — a body of (largely C and Pascal) systems, including Hewlett-Packard code of that era. The problem is that those constants are **artifacts of that dataset and that period**, not universal constants of software. There's no reason a coefficient tuned on 1990s C should describe a 2020s TypeScript React app, a Go microservice, or a Rust crate — different languages, idioms, library densities, and line conventions. So the formula carries four decimals of false precision over numbers that were never meant to generalize. Quoting "MI = 64" as if the 64 means something absolute is trusting a 30-year-old curve fit on code unlike yours.

### Q4.2 — Why is "composite metric collapses signal" a fundamental objection, not a nitpick?

> **Testing:** Whether you understand the information-theoretic flaw, not just that "MI is inaccurate."

**A.** Because **fusing three independent signals into one scalar is lossy by construction** — and the loss is exactly the part you need to act. If a file is MI 45, I cannot tell *why*: is it long but simple, short but deeply nested, or token-dense with a moderate length? Those three files have completely different remediation (split it / flatten the branching / simplify the expressions), but they can all produce MI 45. A single number throws away the decomposition that would tell me what to do. So the objection isn't "the number is a bit off" — it's "the number is **un-actionable** by design," because it deliberately discards the per-component breakdown that any real fix depends on. A vector `(LOC, CC, HV)` carries strictly more usable information than their weighted sum.

### Q4.3 — Walk me through the LOC-domination critique with a concrete example.

> **Testing:** Whether you can make the abstract weighting argument bite with a real case.

**A.** Take two functions. **Function A**: 120 lines, flat, linear top-to-bottom, well-named locals, cyclomatic complexity 3 — the kind of boring code you can read at 2 a.m. **Function B**: 25 lines, but four levels of nested ternaries and short-circuits, cryptic single-letter names, cyclomatic complexity 11. Because the `−16.2·ln(LOC)` term punishes A's length hard and the `−0.23·CC` term barely touches B's branching, **B can score a *higher* MI than A** — the metric calls the unreadable 25-liner "more maintainable" than the obvious 120-liner. That's the LOC-domination critique in one example: MI rewards *brevity* and is nearly blind to *clarity*, so it can rank code in the exact opposite order of how a human would. Anyone optimizing for the number is incentivized to write shorter, denser, worse code.

### Q4.4 — Two tools report different MI for the same code. Who's wrong?

> **Testing:** Whether you understand there's no canonical MI — disagreement is expected, not a bug.

**A.** Probably **neither** — there is no single canonical Maintainability Index. The tools can differ on every layer: which **formula variant** (three-metric vs four-metric-with-comments), whether they **clamp/rescale** like Visual Studio or report raw, how they **count Halstead tokens** (Q3.2), how they **count LOC** (physical vs logical, comments/blanks in or out), and whether they aggregate **per-method, per-file, or per-module**. Any one of those flips the number. So "who's wrong" is the wrong question; the right takeaway is that **MI is only comparable within a single tool, configured one way, on one codebase**. The moment you compare an MI from `radon` to one from Visual Studio to one from SonarQube, you're comparing three different metrics that happen to share a name.

### Q4.5 — If MI is this flawed, why does anyone use it?

> **Testing:** Fairness and balance — a senior critiques without dismissing, and can state the legitimate value.

**A.** Because, used narrowly, it does one thing acceptably: as a **single same-tool trend line, it's a cheap, glanceable smoke alarm**. When a file that sat at MI 70 for a year drops to 45 over a quarter, that's a real, automatable signal that *something* is accreting — even if the absolute 45 is meaningless, the *delta on the same ruler* is informative and free to compute in CI. It also has the soft virtue of being a *single number a non-engineer will look at*, which sometimes gets a quality conversation started. So the honest position isn't "MI is useless" — it's "MI is a usable relative trend and a terrible absolute grade," and almost every real-world abuse comes from using it as the latter.

---

## Theme 5 — Correct Use

### Q5.1 — State the one legitimate way to use MI in a sentence.

> **Testing:** Whether you can compress the correct-use rule into something quotable.

**A.** **Track MI as a relative trend, with the same tool and the same configuration, on the same codebase, and only ever drill from it down to its components to decide what to do** — never use it to grade, compare across teams or languages, or set a numeric target. That's the whole rule: *same ruler, watch the slope, decompose to act.* Everything correct about MI usage is a corollary of that sentence; everything wrong with it in practice is a violation of one clause of it.

### Q5.2 — Why "same tool, same codebase" — what breaks if you relax it?

> **Testing:** Whether you connect the comparability constraint back to the Theme-4 mechanics.

**A.** Because MI's absolute value is **uncalibrated across tools and languages** (different formula variants, token counts, LOC definitions, rescaling — Q4.4). The instant you change the tool, the language, or the project, the number is measured on a *different, silently incompatible scale*, so any comparison is noise. Hold all of that fixed and the *only* thing varying is your code over time — now a change in MI actually reflects a change in the code, which is the one inference MI can support. Relax it and you get the classic failures: "Team A's codebase has MI 72 and Team B's has 68, so A writes better code" — pure artifact of the two codebases' languages, sizes, and the tools' conventions, not a quality difference.

### Q5.3 — "Decompose to components to act" — what does that look like in practice?

> **Testing:** Whether you actually know what to *do* after MI flags something — the part that separates dashboard-watchers from engineers.

**A.** MI is a *trigger*, never a *diagnosis*. When a file's MI drops, I ignore the composite and look at the **three underlying numbers**:
- if **LOC** jumped, the file is sprawling → split it, extract modules, look for a missing abstraction;
- if **Cyclomatic Complexity** jumped, control flow is tangling → flatten nesting, extract methods, replace conditionals with polymorphism or table lookups;
- if **Halstead Volume** jumped, expressions are getting dense/clever → simplify expressions, introduce well-named intermediates.

The MI told me *where to look*; the components tell me *what's wrong*; the fix targets the component, not "the MI." I'd never write a ticket that says "raise this file's MI to 60" — I'd write "this 600-line file's complexity is concentrated in `processOrder`; extract the validation and pricing branches." The number opens the investigation and then gets out of the way.

### Q5.4 — Should MI ever appear in a performance review or a team scorecard?

> **Testing:** The ethical/organizational line — does the candidate know aggregating MI to people is illegitimate?

**A.** **No.** Two compounding reasons. First, it's **not comparable across people or projects** (different code, languages, tools — Q5.2), so the ranking is meaningless from the start. Second, and worse, **any metric attached to evaluation gets gamed** — Goodhart's law: tell engineers their MI is judged and they'll inflate it by deleting comments, collapsing lines, and writing terser, *less* readable code, actively degrading the thing you claimed to measure. MI in a scorecard is negative-value: it produces a false ranking *and* corrupts the codebase. The correct organizational use is the opposite of evaluative — a *blameless trend* the team watches on its own code to decide where to invest refactoring time.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — An exec wants to rank teams by Maintainability Index. What do you say?

> **Testing:** The flagship judgment question — can you say "no" to a plausible-sounding bad idea and offer something better?

**A.** I'd push back, clearly and constructively. The pitch: "MI can't rank teams, because the number isn't comparable across codebases — it's mostly a length metric tuned on 1990s C, computed differently per language and tool, so 'Team A 72 vs Team B 68' reflects their *codebases*, not their *craft*. And the moment it's used for ranking, people will game it by writing shorter, denser, worse code — so you'd get a false ranking that also damages the code." Then I'd redirect to what the exec actually wants, which is "where is maintenance risk and is it getting worse": I'd offer **per-team trend lines on their own codebases** (is quality drifting?), **change-failure rate and lead time** (DORA — outcomes, not proxies), and **churn × complexity hotspot maps** (where the firefighting actually is). Same goal, defensible signals, no incentive to write bad code. The skill being tested is refusing the literal request while serving the underlying need.

### Q6.2 — A PR drops a file's MI by 5 points. Is that bad? Do you block it?

> **Testing:** Whether you treat MI as a conversation-starter, not a gate — and whether you decompose.

**A.** **Five points alone tells me nothing — I look at why.** First I check *which term moved*: if the author added a genuinely necessary feature and LOC rose, a 5-point MI drop is the cost of doing business and I don't care. If instead the drop is driven by **cyclomatic complexity** — a new deeply-nested conditional, a fourth responsibility crammed into one function — *that's* worth a comment, not because of the 5 points but because of what the 5 points revealed. So I'd never auto-block on the delta. I'd let MI **surface** the change in code review (a small annotation: "complexity in this function rose"), then make a human judgment on the actual diff. The number routes my attention; the diff decides the outcome. Blocking a PR purely because a composite dropped 5 is cargo-culting.

### Q6.3 — Would you put a hard MI gate in CI — fail the build below a threshold?

> **Testing:** Whether you understand why a *threshold* on this metric specifically is a bad gate.

**A.** **No — not a hard gate on the absolute value.** A threshold like "fail if MI < 20" inherits every flaw at once: it's an uncalibrated number, so the threshold is arbitrary; it's LOC-dominated, so it punishes legitimately large-but-simple code and waves through short-but-cryptic code; and as a gate it becomes a *target*, so people game it (delete comments, merge lines) instead of improving anything. What I'd consider instead is a **regression-style, relative check**: warn (not fail) if a file's MI drops sharply *relative to its own baseline* in a single PR — that respects the only inference MI supports and routes a human to look. And even that I'd treat as a soft signal feeding code review, not a build-breaker. If I want a *hard* CI gate, I'd gate on something more direct and defensible — like a cyclomatic-complexity ceiling per function — not on the composite.

### Q6.4 — Leadership says "our average MI is 68, industry-good is 70, let's get to 70." How do you respond?

> **Testing:** Whether you can dismantle the "industry benchmark" fallacy specifically.

**A.** I'd dismantle two assumptions. First, **"industry-good is 70" isn't a real benchmark** — there's no calibrated cross-industry MI scale; the number depends entirely on the tool, the formula variant, and the language mix, so an external "70" and our "68" aren't the same measurement. Comparing them is comparing two differently-calibrated thermometers. Second, **"average MI" hides everything that matters** — a healthy 75 average can contain three catastrophic 8s that cause all the incidents, and chasing the *average* up to 70 would have us polishing already-fine files while the real hotspots rot. So "get to 70" optimizes a meaningless target by the wrong mechanism. I'd reframe: forget the average and the external number, **find the lowest-MI files that are also high-churn** (the ones we keep editing and keep breaking), and invest there — measured by whether incidents and change-failure rate in those files go down, not whether a vanity average ticks up.

### Q6.5 — A vendor dashboard shows your repo "MI: 58, grade C." Your principal engineer says the codebase is healthy. Who's right?

> **Testing:** Whether you trust calibrated human judgment over an uncalibrated number, and can explain *why* both can be "right."

**A.** They can **both be right, because they're measuring different things on different scales**. The dashboard's "58, grade C" is a composite, LOC-dominated, vendor-rescaled number with a vendor-invented letter grade slapped on top — the *grade* especially is marketing, an absolute verdict the metric can't actually support. The principal's "healthy" is a judgment from reading the code, the incident history, and how fast features ship — far higher-quality evidence. If the repo is large and uses a verbose language, MI 58 may just mean "big," not "bad." So I'd trust the engineer's verdict and treat the 58 as, at most, a prompt to ask *which files* drag it down and whether any of those are *also* the ones causing pain. The lesson: never let a tool's absolute grade override calibrated human judgment plus outcome data — use it to aim the human's attention, not to overrule them.

---

## Theme 7 — Better Alternatives

### Q7.1 — If not MI, what do you actually look at to gauge maintainability?

> **Testing:** Whether the candidate has a real alternative toolkit, not just complaints.

**A.** I'd unbundle MI back into things that are *directly actionable* and add signals it ignores:
- **The components themselves, separately** — per-function **cyclomatic/cognitive complexity** and file **length**, reported as distributions, not fused. These tell me *exactly* what to fix and where, which the composite can't.
- **Churn × complexity hotspots** — overlay how often a file changes with how complex it is; the high-churn *and* high-complexity quadrant is where maintenance pain actually concentrates.
- **Defect/incident history** — which files keep showing up in bug fixes and post-mortems. This is *outcome* data, the ground truth maintainability is a proxy *for*.
- **Outcome metrics (DORA)** — change-failure rate and lead time tell me whether the system is *actually* hard to change safely.

The throughline: prefer **decomposed, actionable signals and real outcomes** over a single composite proxy. MI tries to *predict* maintainability from code shape; these measure the components precisely or measure the outcome directly.

### Q7.2 — Why are churn × complexity hotspots better than a flat MI scan?

> **Testing:** Whether the candidate understands that *risk is the intersection of complexity and change*, not complexity alone.

**A.** Because **complexity only hurts where you have to touch it.** A gnarly file that nobody has edited in three years is low-priority — it's stable, it works, leave it. The same gnarliness in a file that changes every sprint is a *recurring tax* and a defect generator. Churn × complexity (popularized by Adam Tornhill's "behavioral code analysis") finds exactly that intersection: high-complexity, high-change files — the ones where refactoring *pays back*. A flat MI scan, by contrast, treats every low-scoring file equally and will happily send you to refactor a stable, ugly, untouched corner while the genuinely dangerous high-churn hotspot sits in the green because it happens to be short. Hotspots prioritize by *risk* (likelihood × impact of future change); MI prioritizes by a static shape score that ignores change entirely.

### Q7.3 — How does defect history beat a code-shape metric like MI?

> **Testing:** The proxy-vs-ground-truth distinction — the deepest point in the whole topic.

**A.** Because **defect history is the outcome; MI is a guess at the outcome.** Maintainability metrics exist to *predict* "will this code be costly and error-prone to change." Defect history *records what actually happened* — which files were hard enough that they kept breaking, which modules eat the most fix-time. When you have the real outcome, leaning on a weak proxy for it is backwards. So if a file scores a healthy MI but appears in a third of last quarter's incidents, **the incidents win** — the proxy is simply wrong about that file. The caveat is that defect history is *lagging* (it needs the bugs to have happened) and can be biased by where you look, so I'd use it *together with* leading signals like complexity and churn — but as the arbiter of which files are genuinely painful, recorded outcomes beat any static formula.

### Q7.4 — Could you build a "better MI" by re-fitting the regression on modern code?

> **Testing:** Whether the candidate sees that the problem is the *composite approach*, not just stale constants — a depth check.

**A.** You could *improve* it — re-fitting the coefficients per language on a modern, labeled corpus would beat 1990s constants, and that's roughly what a careful tool should do. But it **doesn't cure the fundamental disease**: even with perfect constants, a single composite still **collapses three signals into one un-actionable scalar** (Q4.2), still can't tell me *which* component moved, and the instant it's used as a target it still gets gamed. A better-calibrated number is still a number that throws away the decomposition I need to act and invites the abuse I want to avoid. So I wouldn't spend effort perfecting the composite; I'd **report the components directly and overlay churn and defects.** The honest conclusion is that the composite framing is the limitation — re-fitting polishes a tool whose core idea (one score for maintainability) is the part that doesn't serve engineers.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Higher MI — better or worse?** A: Better, on the conventional 0–100 scale; the raw formula is unbounded and can go negative.
- **Q: The three inputs to MI?** A: Halstead Volume, Cyclomatic Complexity, and Lines of Code.
- **Q: Which input dominates?** A: Lines of Code, via the large `−16.2·ln(LOC)` coefficient — MI is mostly an inverse size metric.
- **Q: Where did 171 come from?** A: An early-1990s regression by Oman & Hagemeister against expert ratings of a specific (largely C/Pascal) corpus.
- **Q: Halstead Volume formula?** A: `V = N × log₂(n)` — total tokens times log of vocabulary size.
- **Q: Does MI use Halstead Effort or Difficulty?** A: No — only Volume.
- **Q: Visual Studio's bands?** A: 20–100 green, 10–19 yellow, 0–9 red.
- **Q: Why do two tools disagree on MI?** A: Different formula variants, token-counting rules, LOC definitions, and clamp/rescale — there's no canonical MI.
- **Q: Can MI compare two different codebases?** A: No — only same-tool, same-config, same-codebase trends are valid.
- **Q: One-line correct use?** A: Watch the trend on one ruler; decompose to components to act; never grade or target.
- **Q: Gate CI on absolute MI?** A: No — uncalibrated, LOC-dominated, and instantly gamed; at most a relative regression warning.
- **Q: Better alternative in three words?** A: Churn × complexity hotspots (plus defect history).
- **Q: MI in a performance review?** A: Never — not comparable across people and guaranteed to be gamed.
- **Q: Why is a composite worse than its parts?** A: Fusing to one scalar discards the per-component breakdown you need to act.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Reciting the formula but treating its constants as physically meaningful.
- Reading a higher MI as straightforwardly "more maintainable code."
- Comparing MI across teams, languages, or tools without flinching.
- Proposing a hard MI threshold as a CI gate.
- Defending MI as a target to optimize toward ("let's hit 70").
- Not knowing MI is LOC-dominated, or that Halstead Volume is the only Halstead input.
- Having only complaints about MI and no actionable alternative.

**Green flags:**
- Reciting the formula *and* immediately explaining why its absolute value can't be trusted — both halves.
- Naming LOC domination and the 1990s-regression provenance unprompted.
- Framing MI as a *same-ruler relative trend*, not a grade.
- Decomposing to components (LOC/CC/HV) to decide what to actually fix.
- Refusing the "rank teams by MI" request while serving the underlying need with hotspots / DORA / defect history.
- Distinguishing a *proxy* (MI) from *ground truth* (defect and incident history) and preferring the outcome.
- Invoking Goodhart's law about gaming the moment MI becomes a target.

---

## Summary

- The bank reduces to four ideas in costumes: **a composite is not a measurement**, **the constants are empirical not physical**, **relative trend beats absolute grade**, and **decompose to act**. State the formula accurately, then state its limits in the same breath.
- **What MI is:** a single 0–100 (Visual Studio) composite of Halstead Volume, Cyclomatic Complexity, and LOC; a coarse smoke alarm, not a fine thermometer.
- **The formula:** `MI = 171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)` — the LOC term dominates, so MI behaves mostly like an inverse size metric; VS clamps and rescales it to 0–100.
- **Halstead:** operators vs operands → Volume `V = N·log₂(n)`; tokenizer- and language-dependent, which is the root of tool disagreement; MI uses Volume only, not Difficulty or Effort.
- **The critique:** the constants are a 1990s curve fit that doesn't generalize; the composite collapses the signal you need to act; LOC domination can rank a cryptic 25-liner above a clear 120-liner; and there's no canonical MI, so tools legitimately differ.
- **Correct use:** same tool, same config, same codebase, *relative trend only* — then drill into the components to decide what to fix; never a grade, target, gate, or scorecard.
- **Judgment:** refuse "rank teams by MI" and "hit 70"; treat a PR's MI drop as a conversation-starter that routes you to the diff, not an auto-block.
- **Better alternatives:** the components reported directly, **churn × complexity hotspots** (refactor where complexity meets change), and **defect/incident history** (ground truth beats any code-shape proxy).

---

## Further Reading

- Oman, P. & Hagemeister, J., *"Metrics for Assessing a Software System's Maintainability"* (1992) — the original regression and where the constants come from.
- *Software Engineering Institute / Visual Studio* documentation on the Maintainability Index — the 0–100 rescale and the 20/10 band thresholds you'll actually see in tools.
- Halstead, M., *Elements of Software Science* (1977) — the source of operators/operands, Volume, Difficulty, and Effort.
- Tornhill, A., *Your Code as a Crime Scene* / *Software Design X-Rays* — churn × complexity hotspots, the strongest practical alternative.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — Cyclomatic and Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/interview.md) — the CC term that feeds MI, and the more directly-actionable complexity metrics that often replace it.
- [06 — Code Health Dashboards](../06-code-health-dashboards/interview.md) — how MI is presented (and misused) on dashboards, and what to show instead.
- [Code Quality Metrics README](../README.md) — where the Maintainability Index sits among the metrics worth (and not worth) tracking.
