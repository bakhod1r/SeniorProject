# Language Selection Criteria — Middle

> **What?** A repeatable, defensible *method* for selecting a language — one you can show your lead, argue about, and revisit later. The junior level taught you *which factors matter*; this level teaches you how to **structure the decision** so it's transparent instead of a gut call dressed up as analysis.
> **How?** Turn the criteria into an explicit, weighted comparison: define what you're optimizing for, score each candidate, and make the tradeoffs visible. The output isn't just a winner — it's a written record of *why*, which is the part that survives the next argument.

---

## 1. Why structure beats instinct

A senior engineer's gut is often right — but a gut feeling can't be reviewed, can't be challenged, and can't be reused. When you say "let's use Go," three failure modes follow:

1. Someone with a louder voice says "no, Kotlin," and now it's a popularity contest.
2. Six months later nobody remembers *why* you chose it, so you can't tell if the reasons still hold.
3. You can't tell whether you weighed the real constraints or just reached for the familiar.

A structured decision fixes all three. It externalizes your reasoning into something **a team can inspect, attack, and agree on.** The structure doesn't make the decision *for* you — it makes the decision *honest*.

---

## 2. The weighted decision matrix

The workhorse tool. Steps:

1. **List your criteria** (the factors from `junior.md`, tailored to this project).
2. **Assign each a weight** reflecting how much it matters *here* (they should sum to 100, or use 1–5 — just be consistent).
3. **Score each candidate** on each criterion (say, 1–5).
4. **Multiply and sum.** Highest total wins — *as a starting point for discussion, not a verdict.*

Worked example — a **new payments API service**, candidates Go, Java, Node.js:

| Criterion | Weight | Go | Java | Node.js |
|---|---:|:---:|:---:|:---:|
| Team expertise | 30 | 3 | 5 | 4 |
| Performance / concurrency | 20 | 5 | 4 | 3 |
| Ecosystem (payments, crypto libs) | 20 | 4 | 5 | 4 |
| Correctness / type safety | 15 | 4 | 5 | 2 |
| Hiring availability | 10 | 3 | 4 | 5 |
| Operational consistency | 5 | 4 | 3 | 3 |
| **Weighted total** | **100** | **375** | **460** | **350** |

> Computation for Java: (30×5)+(20×4)+(20×5)+(15×5)+(10×4)+(5×3) = 150+80+100+75+40+15 = **460**.

Java wins here — driven mostly by **team expertise (weight 30)** and correctness, both of which a payments system rightly prizes. Note how the *weights*, not the raw scores, decided it: Go scored highest on performance, but performance was only weight 20, while the team already knew Java cold.

---

## 3. The matrix is a thinking tool, not an oracle

The number is where the conversation **starts**, not where it ends. Two disciplines keep the matrix honest:

**Sensitivity check.** Ask: "how much would a weight have to change to flip the answer?" If dropping "team expertise" from 30 to 20 makes Go win, then your decision is really *about* how much you value existing expertise — so debate *that*, explicitly, rather than the totals. A decision that flips under small weight changes is a *close call*; say so out loud.

**The gut-check override.** If the matrix says Java but every experienced person feels uneasy, the matrix is *missing a criterion*. Don't override the gut silently — find the unnamed factor ("Java's startup time hurts our serverless deploys") and add it as a row. The matrix should *capture* your judgment, not *replace* it. When the number and the gut disagree, one of them is wrong, and finding out which is the actual work.

> **Anti-pattern: reverse-engineering the matrix.** Deciding the winner first, then tuning weights until the spreadsheet agrees. This is worse than no matrix — it launders a bias as analysis. If you catch yourself nudging a weight to "make it come out right," stop: you've already decided, so just say so and defend it directly.

---

## 4. Criteria, expanded into checklists

Each high-level criterion hides sub-questions. When scoring, run these:

**Problem fit**
- Is there a *de facto* standard language for this domain? (ML→Python, browser→JS, embedded→C/Rust)
- Does the language's concurrency / memory / typing model match the workload's shape?

**Team expertise**
- How many people on the team are *fluent* (not just "have touched it")?
- Who reviews the code? Who carries the pager? Do *they* know it?

**Ecosystem** *(deep-dived in [`03-ecosystem-and-tooling-maturity`](../03-ecosystem-and-tooling-maturity/))*
- Do mature libraries exist for your hard requirements (auth, payments, the specific DB, the specific cloud)?
- Are they actively maintained, or one-maintainer projects last touched in 2021?

**Performance** *(deep-dived in [`02-performance-vs-productivity-tradeoffs`](../02-performance-vs-productivity-tradeoffs/))*
- What's the *actual* latency/throughput requirement, in numbers?
- Where will time actually be spent — CPU, I/O, network? (Often the language barely matters because you're I/O-bound.)

**Hiring & maintenance** *(deep-dived in [`07-total-cost-of-ownership-and-team-skills`](../07-total-cost-of-ownership-and-team-skills/))*
- Can you hire for it in your location / budget within a reasonable window?
- What does the maintenance picture look like in 3 years?

**Risk / reversibility**
- If this choice is wrong, how hard is it to migrate out? (See [`06-migrating-between-languages`](../06-migrating-between-languages/).)
- Is the language's future secure, or are you betting on a fad? (See [`08-language-longevity-and-lock-in-risk`](../08-language-longevity-and-lock-in-risk/).)

---

## 5. Hard constraints come first — they short-circuit the matrix

Before you build any matrix, run the **deal-breaker filter**. Some requirements are binary: a language either satisfies them or it's out, no scoring needed.

```
Must run natively in the browser?          → JS / TS / WASM only.
Must produce a single static binary?        → Go, Rust, etc.; not Python/Ruby/Node.
Must call into an existing C++ engine
  with zero serialization overhead?         → C++, Rust, or a language with strong FFI.
Hard real-time, no GC pauses allowed?       → Rust, C, C++, Zig; not Java/Go/C#.
Must run on this embedded chip's toolchain? → whatever the vendor supports.
```

Apply these *first*. They often cut the field from a dozen options to two or three — and there's no point scoring "team expertise" for a language that physically cannot meet a hard requirement. **Filter, then score.**

---

## 6. Worked decision: the "default language" question

A common real scenario: your company has no standard, and three teams have each picked differently. Leadership asks for a **default backend language** to reduce sprawl. This is selection at a different altitude — you're not choosing for one service but for *the typical future service*.

The criteria shift:
- **Consistency / sprawl reduction** becomes a heavy weight (the whole point).
- **Breadth of fit** matters more than peak fit — the default must be *good enough* for many problems, not perfect for one.
- **Hiring and onboarding** dominate because the default touches everyone.
- **Performance** matters *less* — exceptional-performance services can be the *exception* that opts out.

The right answer is often a "boring," broadly-capable language (Java, Go, C#, Python) rather than the most exciting one — because a default is judged by its worst-case fit across many teams, not its best-case fit for one. **The altitude of the decision changes the weights.** Selecting for one service and selecting an org default are different problems wearing the same words.

---

## 7. Documenting the decision (the part people skip)

Capture the decision in an **ADR (Architecture Decision Record)** — a short, dated markdown file in the repo:

```markdown
# ADR-014: Backend language for the Payments service

## Status: Accepted (2024-03-12)

## Context
We need a language for the new payments API. Constraints: PCI-relevant,
must integrate with our Java fraud-scoring service, team is Java-heavy.

## Decision
Java (Spring Boot).

## Rationale
- Team expertise (weight 30): the on-call team is fluent in Java.
- Correctness (weight 15): strong typing + mature testing matters for payments.
- Ecosystem (weight 20): best-in-class payment & crypto libraries.
- Go scored higher on raw performance, but performance is not our bottleneck
  here (we're I/O-bound on the DB and external PSP calls).

## Consequences
- Consistent with fraud-scoring service (shared libraries, shared on-call knowledge).
- Accept slower cold-start; not deploying this on scale-to-zero serverless.
- Revisit if latency SLOs tighten below 10ms p99.
```

This single file is worth more than the matrix itself. A year later, when someone asks "why is payments in Java?", the answer is *written down, dated, and reviewable* — including the revisit trigger. The decision becomes a thing the org can *learn from* instead of re-litigate.

---

## 8. Common mistakes at this level

**False precision.** Presenting "Java 460, Go 375" as if the 85-point gap is meaningful. These are subjective 1–5 scores; treat the totals as *coarse* signals. A 10-point gap is a tie. Report ranges and confidence, not decimals.

**Criteria that don't discriminate.** If every candidate scores 4 on "has a package manager," that row is dead weight — it adds nothing and dilutes the criteria that *do* differ. Drop criteria where all candidates are roughly equal.

**Forgetting whose scores they are.** "Team expertise: Go = 3" — for *whom*? Score for the actual humans who'll build and maintain this, not an abstract average engineer.

**Optimizing the build, ignoring the run.** The matrix is heavy on "how nice to write" and silent on "how expensive to operate, hire, and maintain." Those long-tail costs usually dwarf the writing experience.

---

## 9. Quick rules

- [ ] Run the **deal-breaker filter** before any scoring — hard constraints short-circuit the matrix.
- [ ] Build a **weighted matrix**; the *weights* encode what this project actually values.
- [ ] Do a **sensitivity check** — know which weight would flip the answer, and debate *that*.
- [ ] When the **number and the gut disagree**, find the missing criterion; never override silently.
- [ ] Never **reverse-engineer** weights to justify a pre-made choice.
- [ ] **Write an ADR** with a revisit trigger. The reasoning is the deliverable, not the winner.

---

## 10. What's next

| Topic | File |
|---|---|
| When criteria conflict irreconcilably and there's no clean winner | `senior.md` |
| Selection as an org-wide political and economic decision | `professional.md` |
| Build and defend your own decision matrices | `tasks.md` |
| Interview framing of structured selection | `interview.md` |

---

**Memorize this:** the weighted matrix doesn't make the decision — it makes the decision *honest*. Filter on hard constraints first, score what genuinely differs, and write the ADR with a revisit trigger. The number starts the conversation; your judgment finishes it.
