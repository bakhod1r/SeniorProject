# Maintainability Index — Middle Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Maintainability Index
> *The junior page told you the MI is a 0–100 score and green means "fine." This page opens the box: the actual formula, the three metrics feeding it, the Halstead software-science measures most engineers have never computed by hand, and why two tools score the same file differently — on purpose.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [The Original Formula, Term by Term](#the-original-formula-term-by-term)
4. [Halstead Metrics — Operators, Operands, and What They Build](#halstead-metrics--operators-operands-and-what-they-build)
5. [Halstead, Worked on a Tiny Snippet](#halstead-worked-on-a-tiny-snippet)
6. [The Comment Variant and the SEI Four-Metric Form](#the-comment-variant-and-the-sei-four-metric-form)
7. [The Visual Studio Rescale and the Color Bands](#the-visual-studio-rescale-and-the-color-bands)
8. [Why Two Tools Disagree — radon, SonarQube, and Friends](#why-two-tools-disagree--radon-sonarqube-and-friends)
9. [Per-Function vs Per-File](#per-function-vs-per-file)
10. [Worked Example — Halstead → MI, End to End](#worked-example--halstead--mi-end-to-end)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **What is the MI actually computing, and why do tools disagree about it?**

At the junior level the Maintainability Index is a single number with a traffic-light color. That model is enough to read a dashboard but not enough to *trust* it — it can't explain why a 40-line function with no branches still scores "yellow," why renaming variables changes the score, or why SonarQube says one thing and `radon` says another about the same file.

The answers are all inside the formula. The MI is not a measurement in the way a thermometer measures temperature; it is a **regression line fitted in the early 1990s** to expert maintainability ratings, combining three inputs: **Halstead Volume** (how much "stuff" the code says), **cyclomatic complexity** (how much it branches), and **lines of code** (how big it is). This page makes each term concrete, walks a full Halstead-then-MI calculation by hand, and explains the rescales and tool differences so that when you see "MI = 62" you know exactly what was counted, what was ignored, and what the number is allowed to claim.

---

## Prerequisites

- **Required:** You've read [junior.md](junior.md) and know the MI is a composite, higher-is-better score.
- **Required:** You understand **cyclomatic complexity** as a decision-point count — if it's fuzzy, read [01 — Cyclomatic & Cognitive Complexity → middle](../01-cyclomatic-and-cognitive-complexity/middle.md) first.
- **Helpful:** Comfort with logarithms (`ln` natural log, `log2` base-2) — the formula leans on both.
- **Helpful:** You've run a metrics tool (`radon mi`, SonarQube, a Visual Studio "Calculate Code Metrics") at least once and seen a real score.

---

## The Original Formula, Term by Term

The Maintainability Index as it is universally cited comes from Oman & Hagemeister (1992) and the polishing work that followed. The three-metric form is:

```
MI = 171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)
```

- **HV** — **Halstead Volume** of the module (defined in the next section).
- **CC** — **cyclomatic complexity** (McCabe's V(G): decision points + 1).
- **LOC** — **lines of code** (source lines; tools vary on whether blanks/comments count — hold that thought).
- **`ln`** — natural logarithm.

Read the coefficients as *weights and directions*, not magic:

- **`171`** is the intercept — the maximum score the line produces when the three penalties are near zero. It isn't a meaningful "perfect code" constant; it's just where the fitted regression crosses the axis. This is the number people point at when they call the MI arbitrary.
- **`−5.2·ln(HV)`** penalizes **volume**: the more operators and operands the code contains, the lower the score. The `ln` means the penalty grows *fast at first, then flattens* — going from a tiny function to a medium one hurts more per unit than going from large to huge.
- **`−0.23·CC`** penalizes **branching**, and it is **linear**, not logarithmic. Each additional decision point subtracts a flat 0.23. Note how *small* this is: complexity has to climb a long way to move the MI much. This is the formula's most criticized weakness — the metric most engineers care about is barely weighted.
- **`−16.2·ln(LOC)`** penalizes **size**, and it is the **heaviest** term by far. Sheer length dominates the MI. Two functions with identical logic but different line counts can land in different color bands purely on size.

> **Key insight:** The MI is overwhelmingly a function of **size and volume**, with complexity contributing a thin linear sliver. That single observation explains most of its blind spots: a long, simple, repetitive file scores *badly*, and a short, viciously complex one can score *well*. The formula measures "how much code is here," dressed up as "how maintainable is it."

---

## Halstead Metrics — Operators, Operands, and What They Build

The one input that's genuinely unfamiliar is **Halstead Volume**, so it's worth understanding the whole Halstead family — Maurice Halstead's 1977 *software science*. Everything starts from counting two kinds of tokens.

**Operators** — the things that *do*: `+ - * / = == < && || ! return if while for ( ) [ ] , ;`, function-call operators, keywords that drive control flow. **Operands** — the things *operated on*: variable names, constants, literals, type names.

From the counts come four base quantities:

| Symbol | Name | Meaning |
|---|---|---|
| **n₁** | distinct operators | how many *different* operators appear |
| **n₂** | distinct operands | how many *different* operands appear |
| **N₁** | total operators | every operator occurrence, with repeats |
| **N₂** | total operands | every operand occurrence, with repeats |

From those four, the derived measures:

```
Vocabulary   n = n₁ + n₂
Length       N = N₁ + N₂
Volume       V = N · log2(n)
Difficulty   D = (n₁ / 2) · (N₂ / n₂)
Effort       E = D · V
```

What each one *means*:

- **Vocabulary (n)** — the size of the distinct symbol set. How many different "words" the code uses.
- **Length (N)** — total token count. How many "words" it utters in total.
- **Volume (V)** — `N · log2(n)`. The intuition: to write `N` tokens drawn from a vocabulary of `n`, each token needs `log2(n)` bits to identify it, so `V` is the **information content in bits** — the size of the program measured in how much you must say, not how many lines. This is the **HV** the MI consumes.
- **Difficulty (D)** — `(n₁/2)·(N₂/n₂)`. Rises with more distinct operators and with operands that get *reused* a lot (high `N₂/n₂`). The model says reusing the same variable many ways is error-prone.
- **Effort (E)** — `D · V`. Halstead's proxy for mental effort to write/understand; `E/18` was his (dubious) estimate of seconds to comprehend.

> **Key insight:** Halstead Volume is **not lines and not complexity** — it's a token-information measure. A one-line expression packed with distinct operators and operands can have higher Volume than three lines of plain assignments. This is why two functions of equal LOC and equal cyclomatic complexity can still earn different MIs: the Volume term sees the *density of distinct tokens* that the other two terms are blind to.

---

## Halstead, Worked on a Tiny Snippet

Counting is the part everyone hand-waves, so do it once, slowly. Take:

```python
def max2(a, b):
    if a > b:
        return a
    return b
```

**Operators** (distinct → n₁, with the occurrences that make up N₁):

| Operator | Occurrences |
|---|---|
| `def` (function def) | 1 |
| `()` (parameter grouping / call) | 1 |
| `if` | 1 |
| `>` | 1 |
| `return` | 2 |
| `:` | 2 |

Distinct operators **n₁ = 6**; total operator occurrences **N₁ = 1+1+1+1+2+2 = 8**.

**Operands** (distinct → n₂, occurrences → N₂):

| Operand | Occurrences |
|---|---|
| `max2` | 1 |
| `a` | 3 |
| `b` | 3 |

Distinct operands **n₂ = 3**; total operand occurrences **N₂ = 1+3+3 = 7**.

Now plug in:

```
n = n₁ + n₂ = 6 + 3 = 9
N = N₁ + N₂ = 8 + 7 = 15
V = N · log2(n) = 15 · log2(9) = 15 · 3.170 ≈ 47.5
D = (n₁/2)·(N₂/n₂) = (6/2)·(7/3) = 3 · 2.333 = 7.0
E = D · V = 7.0 · 47.5 ≈ 332.5
```

So this four-line function has **Volume ≈ 47.5 bits**, Difficulty 7.0, Effort ≈ 333.

Two things to notice. First, **tokenization is a judgment call** — whether `def` is one operator, whether `()` counts once or twice, whether `:` is an operator at all. Different tools make different choices, and *that is the root of why tool numbers differ* (next sections). Second, even a trivial function has non-trivial Volume; the measure climbs quickly with distinct symbols.

---

## The Comment Variant and the SEI Four-Metric Form

The three-metric formula has a well-known sibling that adds a **comment term**. The Software Engineering Institute (SEI) four-metric form:

```
MI = 171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC) + 50·sin(√(2.4·CM))
```

where **CM** is the **fraction of lines that are comments** (0 to 1, e.g. 0.3 for 30%).

The added term `50·sin(√(2.4·CM))` *rewards* commenting — but with a deliberately weird shape. `sin(√(2.4·CM))` peaks when `2.4·CM ≈ (π/2)²`, i.e. around **CM ≈ 1.03**, just past 100% comments, so within the real 0–100% range the bonus is **monotonically increasing** and tops out near `+50·sin(√2.4) ≈ +43` at full comment density. The `sin` was fitted, not derived; the practical effect is a bounded "comment credit" of up to ~16 points for normal (10–40%) comment ratios.

This variant is where a lot of tool disagreement starts: a tool that uses the comment form and a tool that uses the three-metric form will score a heavily-commented file very differently, even before tokenization differences.

> **Key insight:** There is **no single canonical MI**. At minimum there are two published formulas (with and without the comment term), and tools further diverge on what counts as a line and a token. "The MI" is a *family* of related scores, not one defined quantity — which is exactly why an absolute MI threshold is fragile and a *trend on one tool's definition* is what you should watch.

---

## The Visual Studio Rescale and the Color Bands

Raw MI is awkward: the three-metric form can go **negative** for large files (the size term is unbounded below), and "−40" reads as nonsense on a dashboard. Microsoft's Visual Studio popularized a **clamp-and-rescale** so the score sits cleanly in 0–100:

```
MI_VS = max(0, MI · 100 / 171)
```

The `100/171` maps the natural ceiling (171) onto 100; the `max(0, …)` floors anything negative at 0. So a raw MI of 85 becomes `85·100/171 ≈ 49.7`; a raw MI of 120 becomes `≈ 70`; anything raw-negative becomes 0.

Visual Studio then attaches the familiar **color bands** to the rescaled value:

| Rescaled MI | Band | Visual Studio reading |
|---|---|---|
| **0–9** | 🔴 red | low maintainability |
| **10–19** | 🟡 yellow | moderate |
| **20–100** | 🟢 green | good maintainability |

Note how *generous* green is — 20 to 100 is one band. The thresholds were chosen so that most ordinary code lands green, and only genuinely large/dense modules drop into yellow or red. This is also why "green" carries little information: it spans 80% of the range.

> **Key insight:** When someone quotes an MI as a 0–100 number with red/yellow/green, they are almost certainly quoting the **Visual Studio rescale**, not the raw Oman–Hagemeister value — and the *bands* (0–9 / 10–19 / 20–100) are VS conventions, not universal truth. Always know which scale you're looking at; a "62" means opposite things depending on whether it's raw or rescaled.

---

## Why Two Tools Disagree — radon, SonarQube, and Friends

Run three tools on one file and you can get three MIs. This isn't a bug; it's the inevitable result of the formula being underspecified. The disagreements come from four independent choices:

**1. Which formula.** Three-metric vs the comment variant — already shown to diverge on commented code.

**2. The rescale.** Python's **`radon`** uses its own normalization, *not* the VS one. Radon computes the comment-form MI and rescales to 0–100 via roughly `MI = max(0, 100 · raw / 171)` but with its own handling, then ships **its own band convention** — by default radon's ranks are **A (100–20), B (19–10), C (9–0)**, which look like the VS letters but anchor the boundaries at the same 20/10 cutoffs. So radon's "A" ≈ VS green. Tools that don't rescale at all report raw MI and can show negatives.

**3. Tokenization — how HV is counted.** This is the big one. Each tool's parser decides what an operator is, what an operand is, whether keywords/punctuation/whitespace count. SonarQube, `radon`, and a C# analyzer tokenize *the same source* into *different* n₁/n₂/N₁/N₂, so they compute *different Volumes*, so different MIs — exactly the `def`/`()`/`:` ambiguity from the worked snippet, multiplied across a file.

**4. What counts as LOC.** Physical lines? Logical statements? Are blank lines and comment-only lines included? Since the LOC term is the *heaviest* (`−16.2·ln(LOC)`), small definitional differences here move the score the most.

There's a further wrinkle: **SonarQube deprecated and removed its Maintainability Index** years ago. Modern SonarQube reports maintainability as a **SQALE-based rating (A–E)** derived from *remediation effort* (estimated time to fix code smells) ÷ estimated development cost — a completely different model from the Halstead/MI composite. So "SonarQube's maintainability score" today is **not** an MI at all; comparing it to a radon MI is comparing two unrelated metrics that happen to share the word "maintainability."

> **Key insight:** Two tools giving different MIs for the same file is *expected*, because each tool fixes a different set of the formula's free choices (formula variant, rescale, tokenizer, LOC definition). The only valid comparison is **same tool, same config, over time** — cross-tool MI comparison is meaningless, and cross-*metric* comparison (radon MI vs SonarQube rating) is a category error.

---

## Per-Function vs Per-File

The formula doesn't specify its *scope*, and that choice changes everything.

- **Per-file MI** sums Halstead counts, total CC, and total LOC across the whole file, then applies the formula once. This is what dashboards usually show. Its hazard is the **size term**: a large file is penalized hard by `−16.2·ln(LOC)` *regardless of internal quality*, so a tidy 600-line module of small, clean functions can score red purely for being long. The aggregation hides the per-function picture.

- **Per-function MI** applies the formula to each function/method separately. This localizes the score — you learn *which* function is the problem — and the size term behaves more sensibly because each unit is small. The hazard flips: tiny functions can produce extreme or even meaningless MIs (a one-line getter has near-zero Volume and `ln` of a tiny LOC, pushing the raw score above 171 before clamping).

Tools split on this. `radon mi` reports **per-file** by default. Visual Studio reports a **roll-up at multiple levels** (method, type, namespace, assembly) by aggregating. The right granularity depends on the decision: per-function to find the bad method, per-file to triage which files to open.

> **Key insight:** A per-file MI is dominated by file *size*; a per-function MI is dominated by function-level *density and branching*. They answer different questions. If a file scores red, check whether it's red because one method is genuinely bad or simply because the file is long — the per-function breakdown tells you which, and the fix is completely different (refactor the method vs split the file).

---

## Worked Example — Halstead → MI, End to End

Tie it all together. Compute the MI for this function from scratch, three-metric form, then VS-rescale it.

```python
def classify(score):
    if score >= 90:
        return "A"
    elif score >= 80:
        return "B"
    else:
        return "C"
```

**Step 1 — Cyclomatic complexity.** Decision points: `if`, `elif` → 2 branches. `CC = 2 + 1 = 3`.

**Step 2 — LOC.** Source lines of code (the body + signature, non-blank): **7**.

**Step 3 — Halstead.**

Operators (n₁ distinct / N₁ total): `def`(1), `()`(1), `if`(1), `>=`(2), `return`(3), `elif`(1), `else`(1), `:`(4).
→ **n₁ = 8**, **N₁ = 1+1+1+2+3+1+1+4 = 14**.

Operands (n₂ distinct / N₂ total): `classify`(1), `score`(3), `90`(1), `80`(1), `"A"`(1), `"B"`(1), `"C"`(1).
→ **n₂ = 7**, **N₂ = 1+3+1+1+1+1+1 = 9**.

```
n = 8 + 7 = 15
N = 14 + 9 = 23
V (HV) = N · log2(n) = 23 · log2(15) = 23 · 3.907 ≈ 89.9
```

**Step 4 — Plug into the three-metric MI.**

```
MI = 171 − 5.2·ln(89.9) − 0.23·(3) − 16.2·ln(7)
   = 171 − 5.2·(4.499)  − 0.69      − 16.2·(1.946)
   = 171 − 23.39        − 0.69      − 31.52
   ≈ 115.4
```

**Step 5 — Visual Studio rescale and band.**

```
MI_VS = max(0, 115.4 · 100 / 171) = max(0, 67.5) ≈ 67.5  → 🟢 GREEN (20–100)
```

So `classify` scores **~67 (green)**. Sanity-check the term contributions: LOC contributed −31.5, Volume −23.4, complexity only −0.69. Even with three branches, complexity barely dented the score — size and volume did the work. That's the formula's fingerprint, visible in a single function.

---

## Mental Models

- **The MI is a regression line, not a ruler.** It was *fitted* to expert opinions in the early '90s, not derived from first principles. The `171`, the `5.2`, the `16.2` are curve-fit coefficients. Treat the output as "a rough risk estimate from a dated model," not a measurement.

- **Volume is information, not length.** Halstead Volume = `N·log2(n)` = bits to express the program. A dense one-liner can out-Volume three plain statements. It's the one input that sees token *density*.

- **The formula is mostly a size gauge.** `−16.2·ln(LOC)` dominates, `−5.2·ln(HV)` is second, and `−0.23·CC` is a rounding error by comparison. If the MI moved, suspect size first.

- **"0–100 with red/yellow/green" = Visual Studio dialect.** That presentation is the `max(0, MI·100/171)` rescale with VS's 0–9/10–19/20–100 bands. Raw MI has no upper bound and goes negative.

- **Same tool over time, never tool vs tool.** Each tool fixes the formula's free choices differently, so absolute cross-tool MIs are incomparable. A *trend* on one configuration is the only trustworthy signal.

---

## Common Mistakes

1. **Comparing MIs across tools.** radon's 65 and a C# analyzer's 65 are not the same measurement — different tokenizer, possibly different formula and rescale. Only compare a metric to itself over time on one tool.

2. **Confusing SonarQube's maintainability rating with MI.** Modern SonarQube uses a SQALE remediation-effort rating (A–E), *not* the Halstead/MI composite — it removed MI long ago. They share a word, not a method.

3. **Reading raw MI on a 0–100 mental scale.** Raw three-metric MI exceeds 100 for small functions and goes negative for large files. If a tool reports 140 or −12, it's giving you raw values, not the VS rescale.

4. **Assuming green means good.** The green band is 20–100 — 80% of the rescaled range. A green score rules out "alarmingly large/dense," nothing more. Plenty of bad code is green.

5. **Trusting MI to reflect complexity.** With a 0.23 linear weight, cyclomatic complexity barely moves the MI. A high-complexity function can score green. If you care about branching, read CC *directly* — don't infer it from the MI.

6. **Ignoring scope.** A per-file red score might just mean "long file," not "bad code." Always check the per-function breakdown before refactoring — the file might need *splitting*, not *fixing*.

---

## Test Yourself

1. Write the three-metric MI formula and say which term has the *largest* weight and which is *linear*.
2. Define n₁, n₂, N₁, N₂ and give the formula for Halstead Volume. Why is Volume "information in bits"?
3. For the snippet `x = a + b * a`, count n₁, n₂, N₁, N₂ (treat `=`, `+`, `*` as operators; `x`, `a`, `b` as operands).
4. Convert a raw MI of 154 to the Visual Studio scale. What band is it in?
5. Two tools report MI 71 and MI 44 for the *same* file. Give two distinct reasons this can happen with neither tool being wrong.
6. A 700-line file of small, simple functions scores red per-file but every function scores green per-function. What's going on, and what's the fix?

<details>
<summary>Answers</summary>

1. `MI = 171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)`. Largest weight: the **LOC** term (`−16.2·ln(LOC)`). Linear term: **CC** (`−0.23·CC`); the other two are logarithmic.
2. n₁/n₂ = distinct operators/operands; N₁/N₂ = total operator/operand occurrences. `V = N·log2(n)` where `N = N₁+N₂`, `n = n₁+n₂`. It's bits because identifying each of `N` tokens from a vocabulary of `n` needs `log2(n)` bits, so `V` is the total bits to spell out the program.
3. Operators: `=`(1), `+`(1), `*`(1) → **n₁ = 3, N₁ = 3**. Operands: `x`(1), `a`(2), `b`(1) → **n₂ = 3, N₂ = 4**. (So n=6, N=7, V = 7·log2(6) ≈ 18.1.)
4. `max(0, 154·100/171) = max(0, 90.06) ≈ 90` → 🟢 **green** (20–100).
5. Any two of: different formula variant (comment term vs not); different rescale/normalization; different **tokenizer** counting operators/operands differently → different HV; different LOC definition (blanks/comments in or out). All are legitimate config differences.
6. The per-file MI is dominated by the heavy `−16.2·ln(LOC)` size term, so sheer length forces it red even though no function is bad (each scores green individually). The fix is to **split the file**, not refactor the functions — the problem is size, not internal quality.

</details>

---

## Cheat Sheet

```
THE FORMULA (three-metric, Oman–Hagemeister)
  MI = 171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)
       └ intercept   └Volume   └complexity  └size (HEAVIEST term)
  comment variant: + 50·sin(√(2.4·CM))    CM = comment-line fraction

HALSTEAD
  n₁ distinct operators   N₁ total operators
  n₂ distinct operands    N₂ total operands
  n = n₁+n₂ (vocabulary)  N = N₁+N₂ (length)
  V = N·log2(n)           ← Volume = HV, "bits to express the program"
  D = (n₁/2)·(N₂/n₂)      E = D·V

VISUAL STUDIO RESCALE + BANDS
  MI_VS = max(0, MI·100/171)
   0– 9  🔴 red      low
  10–19  🟡 yellow   moderate
  20–100 🟢 green    good     ← spans 80% of range; weak signal

WHY TOOLS DIFFER (all legitimate)
  formula variant · rescale · TOKENIZER (HV) · LOC definition
  radon  : comment-form, own A/B/C ranks at 20/10 cutoffs, per-file
  SonarQube: NO MI — SQALE remediation rating A–E (different metric)

GOTCHAS
  green ≠ good (band is huge)        CC barely weighted (0.23 linear)
  size dominates MI                  compare SAME tool over time only
  per-file red may just mean "long"  → split, don't refactor
```

---

## Summary

- The Maintainability Index is a **regression line from the early 1990s**: `MI = 171 − 5.2·ln(HV) − 0.23·CC − 16.2·ln(LOC)`, fitted to expert ratings, not derived. The coefficients are weights — the **LOC term dominates**, Volume is second, and **complexity is barely weighted** (linear `0.23`).
- **Halstead Volume** is the unfamiliar input: from operator/operand counts (n₁, n₂, N₁, N₂) you get vocabulary `n`, length `N`, and `V = N·log2(n)` — the program's **information content in bits**, sensitive to token *density* the other terms ignore.
- A **comment variant** adds `+50·sin(√(2.4·CM))`, rewarding comments. There is **no single canonical MI** — at least two formulas, plus per-tool choices.
- **Visual Studio** clamps and rescales: `MI_VS = max(0, MI·100/171)`, with bands **0–9 red / 10–19 yellow / 20–100 green**. "0–100 with traffic lights" is the VS dialect; raw MI exceeds 100 and goes negative.
- Tools disagree **by construction** — different formula, rescale, **tokenizer**, and LOC definition. radon and Visual Studio each pick differently; modern SonarQube reports a **SQALE rating, not an MI at all**. Compare *same tool over time*, never tool-to-tool.
- **Scope matters:** per-file MI is dominated by size; per-function MI by density and branching. A red file may just be *long* — check the per-function breakdown before deciding to refactor versus split.

---

## Further Reading

- Oman, P. & Hagemeister, J. — *Metrics for Assessing a Software System's Maintainability* (1992). The source of the formula and its coefficients.
- Halstead, M. — *Elements of Software Science* (1977). The operator/operand model and Volume/Difficulty/Effort definitions, from the source.
- Welker, K. — *The Software Maintainability Index Revisited* (CrossTalk, 2001). The SEI four-metric form and a candid look at the metric's limits.
- `radon` documentation — the **Maintainability Index** section: exact formula, ranks, and per-file behavior in a tool you can run today.
- Visual Studio docs — *Code metrics – Maintainability Index range and meaning*. The `max(0, MI·100/171)` rescale and the 0–9/10–19/20–100 bands.

---

## Related Topics

- [01 — Cyclomatic & Cognitive Complexity → middle](../01-cyclomatic-and-cognitive-complexity/middle.md) — the CC term inside the MI, computed and critiqued on its own.
- [06 — Code Health Dashboards → middle](../06-code-health-dashboards/middle.md) — how MI gets aggregated alongside other metrics, and why trends beat absolutes.
- [junior.md](junior.md) — the plain-language MI: what the score means and how to read the colors.
- [senior.md](senior.md) — why composite indices are statistically weak, how to validate (or retire) the MI, and what to track instead.
