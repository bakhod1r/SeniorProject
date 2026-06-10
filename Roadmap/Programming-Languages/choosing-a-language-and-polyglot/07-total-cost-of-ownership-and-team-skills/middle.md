# Total Cost of Ownership & Team Skills — Middle

> **What?** TCO broken into its actual line items, each one estimable in real numbers — hiring cost and time-to-fill, salary differences, onboarding/ramp, training, multi-year maintenance, operational compute cost, and tooling. The junior level taught you *that* the iceberg exists; this level teaches you how to **put numbers on the parts under the water.**
> **How?** Treat a language choice like a budget. For each cost line, estimate a figure — even a rough one — over the realistic life of the system (think 3–5 years, not the first sprint). The point isn't false precision; it's making the hidden costs *visible and comparable* so the decision stops being driven by the one cost everyone can feel (writing) and starts accounting for the costs that dominate (everything else).

---

## 1. Cheap to *start* vs cheap to *own*

The most useful framing at this level: a language sits somewhere on a curve from *cheap to start* to *cheap to own*, and they are often inversely related.

| | Cheap to start | Cheap to own |
|---|---|---|
| What it optimizes | First working version, fast | Years of change, safely |
| Typical examples | Python, Ruby, JS (dynamic, terse) | Java, C#, Go, typed/tooled ecosystems |
| Where you feel the win | Sprint 1, the prototype, the demo | Year 2, the refactor, the 3am page |
| The hidden bill | Maintenance gets expensive as it grows | Verbose first draft, slower prototype |

This is not a hard law — TypeScript and modern Python with type hints deliberately try to be *both* — but the tension is real. A startup pre-product-market-fit should bias hard toward *cheap to start*: it may not survive long enough for ownership cost to matter, and shipping fast is survival. A bank's core ledger should bias toward *cheap to own*: it will outlive everyone who wrote it. **The right point on the curve depends on how long the code will live and how much it will change.**

---

## 2. The TCO line items

A defensible TCO estimate has roughly seven lines. Each is a real, separate cost.

| Line item | What it is | How to estimate |
|---|---|---|
| **Initial development** | Building the first version | Engineer-months × loaded cost |
| **Hiring** | Finding and recruiting people | Time-to-fill × cost-of-vacancy + recruiter fees |
| **Salary premium** | Paying more for scarce skills | Market salary delta × headcount × years |
| **Onboarding / ramp** | New hire → productive | Ramp weeks × loaded weekly cost × number of hires |
| **Maintenance** | Years of changes, fixes, upgrades | Annual maintenance % × dev cost × years |
| **Operations / runtime** | Cloud and compute bills | Resource cost × scale × 12 × years |
| **Tooling** | IDEs, licenses, CI, build infra | Annual license/infra cost × seats × years |

Notice initial development — the part everyone fixates on — is *one line of seven*, and usually not the biggest over a multi-year life.

---

## 3. Hiring cost — can you even find people, and how fast?

Hiring has two costs that beginners merge into one: the **cost of the search** and the **cost of the vacancy while you search**.

- **Time-to-fill** is how long the seat sits empty. For a mainstream language, a backend role might fill in **4–8 weeks**. For a niche language, it can stretch to **3–6 months** — or you give up and train someone.
- **Cost of vacancy** is what the company loses while the seat is empty — unshipped work, overloaded teammates. A common rule of thumb prices an unfilled engineering seat at **roughly the salary it would pay**, prorated: a 6-month vacancy on a $180k role is conceptually ~$90k of lost capacity, on top of recruiter fees (often 15–25% of first-year salary if you use an agency).

```
Mainstream language seat:  ~6 weeks to fill   → modest vacancy cost
Niche language seat:       ~20 weeks to fill  → ~3-4x the vacancy cost, repeated per hire
```

The talent pool is the input. Crudely: JavaScript/Python practitioners number in the *millions*; Java/C# in the millions; Go in the *hundreds of thousands*; Rust in the low hundreds of thousands and rising; a genuinely niche language (think OCaml, Elixir, Clojure, Haskell) in the *low tens of thousands* of people who'd take a job in it. **Smaller pool → longer time-to-fill → higher vacancy cost on every hire.**

---

## 4. Salary differences — scarcity and domain both move the number

Languages don't have one global salary, but two forces push the number:

1. **Scarcity premium.** Fewer practitioners means you bid against everyone else who needs them. Niche-but-loved languages (Rust, Scala, Elixir, Clojure) often command a **10–30% premium** over the equivalent mainstream-language role, partly because the people who learn them tend to be more senior.
2. **Domain correlation.** Some languages cluster in high-paying domains. COBOL pays well not because it's loved but because it runs banks and the people who know it are retiring. Solidity pays well because it sits next to money.

A worked delta over a team and a horizon:

```
Suppose a Rust hire costs $20k/yr more than the Go equivalent.
Team of 8 engineers, 4-year horizon:
   $20,000 × 8 × 4 = $640,000 in extra salary alone.
```

That $640k has to be *bought back* by Rust delivering something Go can't — memory safety in a domain that needs it, compute savings at huge scale, fewer engineers needed because the language prevents whole bug classes. Sometimes it is. Often it isn't. The point is to **make the premium an explicit number you weigh**, not a surprise on the payroll.

---

## 5. Onboarding and training — paid on every hire, forever

Ramp time is the interval from "first day" to "ships without hand-holding." Split it:

- **Codebase ramp** — learning *this system*. Unavoidable in any language.
- **Language ramp** — learning the *language itself*. Avoidable if you hire people who already know it.

```
New hire already fluent:     ~4-6 weeks ramp (codebase only)
New hire learning the lang:  ~3-6 months ramp (language + codebase)
```

Multiply by your hiring rate. A team that grows by 6 engineers a year, on a language that adds 2 months of extra ramp each, burns **~12 engineer-months a year** purely to the language learning curve. On a $200k loaded cost that's **~$200k/year**, recurring, just because the language is one your hires don't arrive knowing. Add formal **training** (courses, conference budget, internal bootcamps) and the line grows.

This is why "we'll just train people" is rarely the cheap answer it sounds like: training isn't free, it's slow, and you pay it *again on the next hire.*

There's a quality dimension too, not just a time one. A new hire ramping on a language with rich documentation, a large Stack Overflow / forum presence, and abundant examples gets unblocked fast and quietly. A new hire ramping on a sparse language hits a question with no good answer, burns a day, and interrupts a senior to ask — so the *real* onboarding cost includes the senior's lost time mentoring, which is more expensive than the junior's own. The thinner the language's learning resources, the more this hidden mentoring tax dominates, and it's almost never in anyone's budget line. When you compare two languages, compare not just "how long to ramp" but "how much senior time does each ramp consume," because that's where the cost actually concentrates.

---

## 6. Maintenance — the multi-year bulk

Maintenance is the largest hidden cost and the one most sensitive to language. A common industry heuristic puts annual maintenance at **15–25% of the original development cost, every year, for the life of the system.** Over five years that can exceed the original build cost entirely.

The language moves this number through:
- **Readability** — can the next person understand it without running it?
- **Type safety** — does the compiler catch the refactor mistake, or does the user?
- **Tooling** — do you get refactoring, linting, and static analysis, or grep and prayer?
- **Failure clarity** — does a bug produce a clear stack trace or a silent wrong answer?

A weakly-typed, weakly-tooled language can quietly **double** the maintenance line at scale, because every change risks breaking something the tools can't see, so changes get slower and more careful (or break things and get even slower). This is the deepest reason "cheap to start" languages can become "expensive to own" — the maintenance multiplier is invisible until the codebase is large.

---

## 7. Operational / runtime cost — a less efficient language costs real money at scale

At small scale, runtime efficiency is irrelevant — the junior rule ("servers are cheap") holds. At *large* scale, it flips, because you're multiplying the per-unit difference by an enormous number.

Suppose language A needs 3× the CPU/RAM of language B for the same throughput (a plausible gap between an interpreted language and a compiled one for CPU-bound work):

```
Workload needs 100 servers in efficient language B.
Same workload in language A (3x heavier): ~300 servers.
Server cost: ~$1,500/yr each (modest cloud instance).

Language B: 100 × $1,500 = $150,000/yr
Language A: 300 × $1,500 = $450,000/yr
Difference: $300,000/yr, every year.
```

At 10 servers the $20k/year gap is noise next to one engineer's salary. At 1,000 servers the gap is *millions* and can pay for a team to maintain a faster language. **Operational cost is a real TCO line, but its weight scales with your fleet** — which is exactly why it's a junior non-issue and a senior decision-flipper (see [`senior.md`](senior.md)). Estimate it at your *expected* scale, not today's.

---

## 8. Tooling cost — usually small, occasionally a trap

Most modern languages have free, excellent open-source tooling, so this line is often near zero. Watch for the exceptions:
- **Commercial ecosystems** with per-seat license costs (some enterprise IDEs, some proprietary runtimes or app servers).
- **Build/CI cost** — a language with slow compiles burns CI minutes and engineer wait-time. A 10-minute build × dozens of pushes a day × a team is a real, if diffuse, cost.
- **Observability gaps** — if your APM/tracing vendor doesn't support the language well, you pay in custom instrumentation. (Tooling maturity has its own topic: [`03-ecosystem-and-tooling-maturity`](../03-ecosystem-and-tooling-maturity/).)

---

## 9. Putting it together — a rough 4-year comparison

You don't need a perfect model; you need the *shape*. Sketch the lines for two candidates and look at where they actually differ:

```
4-year TCO sketch, ~8-person team, moderate scale (~100 servers)

                     Mainstream Lang     Niche-but-loved Lang
Initial dev          $1.6M               $1.4M  (a bit faster to write)
Hiring (vacancy)     low                 high   (long time-to-fill)
Salary premium       baseline            +$640k
Onboarding/training  low                 +~$400k over 4 yrs
Maintenance          baseline            depends on tooling
Operations           $600k               $400k  (if more efficient)
                     -----------         -----------
Rough total          ~lower              ~higher unless scale/safety pays it back
```

The niche language wins *only* if its advantages — runtime savings at large scale, bug classes eliminated, fewer engineers needed — buy back the salary and onboarding premium. The model's job is to show you **what the niche language has to deliver to be worth it**, in dollars, so the debate stops being about syntax.

---

## 10. Common mistakes at this level

**Modeling only initial development.** It's one of seven lines and rarely the biggest. A model that stops at "engineer-months to build it" has measured the tip of the iceberg with a ruler.

**Using today's scale for the operations line.** Compute cost is irrelevant at 10 servers and decisive at 1,000. Model your *expected* scale, with a range.

**Ignoring time-to-fill.** A salary that looks affordable is worthless if the seat sits empty for six months. Vacancy cost is part of hiring cost.

**Treating onboarding as one-time.** It recurs on every hire. Multiply by your real hiring rate over the horizon.

**False precision.** These are estimates with wide error bars. Use ranges, do a sensitivity check (which assumption, if wrong, flips the answer?), and present it as "here's the shape," not "here's the number." (Same discipline as the decision matrix in [`01-language-selection-criteria`](../01-language-selection-criteria/).)

---

## 11. Quick rules

- [ ] Model **all seven lines**, over a realistic **3–5 year** life — not just initial development.
- [ ] Place the language on the **cheap-to-start vs cheap-to-own** curve based on how long the code lives.
- [ ] Price **hiring as vacancy cost + recruiter fees**, driven by **time-to-fill**.
- [ ] Make any **salary premium** an explicit `delta × headcount × years` number.
- [ ] Count **onboarding/training per hire**, multiplied by your hiring rate.
- [ ] Model **operational cost at expected scale**, not today's — it flips at large fleets.
- [ ] Present **ranges and a sensitivity check**, never false precision.

---

## 12. What's next

| Topic | File |
|---|---|
| Talent market as a hard constraint; runtime cost flipping decisions at scale | `senior.md` |
| Org economics, Conway's law, standardization, the leadership case | `professional.md` |
| Interview questions on TCO | `interview.md` |
| Build a multi-year TCO model and a hiring-difficulty estimate | `tasks.md` |

---

**Memorize this:** TCO is seven line items over years — initial dev, hiring, salary premium, onboarding, maintenance, operations, tooling — and a language can be cheap to start but expensive to own. Put rough numbers on every line at your expected scale, and the niche language only wins if its advantages buy back the salary, vacancy, and onboarding premium it costs.
