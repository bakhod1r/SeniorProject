# Duplication & Similarity — Professional Level

> **Roadmap:** [Code Quality Metrics](../README.md) → [Duplication & Similarity](./) → Professional
> *The senior page taught you what a clone is and how token and AST detectors find them. This page is about governing duplication across dozens of repos and teams without over-DRYing — where the question stops being "is this duplicated?" and becomes "whose duplication is this, what does removing it cost in coupling, and is the copy a token detector flags even the expensive one?" (it usually isn't).*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [A Sane Duplication Policy: Gate the Diff, Not the Codebase](#a-sane-duplication-policy-gate-the-diff-not-the-codebase)
4. [Why a "0% Duplication" Mandate Causes Harm](#why-a-0-duplication-mandate-causes-harm)
5. [Org-Scale DRY Judgment: the Duplication a Detector Can't See](#org-scale-dry-judgment-the-duplication-a-detector-cant-see)
6. [Deliberate Duplication Across Boundaries](#deliberate-duplication-across-boundaries)
7. [The Shared-Library Trade-off and the God-Library Tax](#the-shared-library-trade-off-and-the-god-library-tax)
8. [Cross-Repo Duplication Detection at Scale](#cross-repo-duplication-detection-at-scale)
9. [Duplication × Churn as a Refactoring-Prioritization Input](#duplication--churn-as-a-refactoring-prioritization-input)
10. [War Stories](#war-stories)
11. [Decision Frameworks](#decision-frameworks)
12. [Mental Models](#mental-models)
13. [Common Mistakes](#common-mistakes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)
18. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Governing duplication across a large or poly-repo organization without over-DRYing — turning a noisy metric into a policy that catches real risk and stays silent on legitimate repetition.**

The senior page framed duplication as a measurable property of one codebase: clone types 1–4, token and AST detection, the duplication percentage, the rule of three. At the professional level the same metric arrives in different rooms. A platform team wants a duplication gate in the shared CI template and has to decide what it fires on. An architect is asked to bless a `common-utils` library that forty services already depend on and is becoming a coordination chokepoint. An incident review finds that a tax-calculation bug was fixed in three services and missed in a fourth — duplication no token detector ever flagged, because the three copies didn't share a single line of text. A team wants to copy a 200-line module into their service rather than depend on another team's package, and someone objects on DRY grounds.

None of these are new *concepts*. They're the senior-tier mechanics, now multiplied by repos, teams, and a release calendar. The skill here is judgment: knowing that the duplication a CPD scan reports is the *cheap* kind, that the expensive kind is conceptual and invisible to tokens, that a hard "0%" mandate manufactures the worst coupling in the system, and that some duplication is load-bearing — it's what keeps two teams able to ship independently. This page is the pragmatic layer that separates a duplication policy that improves the codebase from one that quietly degrades it.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — clone types 1–4, token vs AST detection, the duplication %, the rule of three vs DRY vs AHA, why detectors over- and under-count.
- **Required:** You've owned or contributed to a shared internal library and felt the versioning friction.
- **Helpful:** You've worked in a poly-repo or microservice org where teams ship on independent cadences.
- **Helpful:** You've debugged a bug that was fixed in one place and missed in a near-identical other place.

---

## A Sane Duplication Policy: Gate the Diff, Not the Codebase

The single most important policy decision is **what the gate measures**. The naive choice — fail the build if the repository's overall duplication percentage exceeds N% — is wrong for the same reason a global coverage gate is wrong: it punishes the current author for the accumulated history of everyone before them, it's gameable by adding non-duplicated filler, and it gives no actionable signal ("the number went from 4.1% to 4.2%" tells nobody what to do). A new file copied wholesale can *lower* the global percentage if the denominator grows faster than the duplicated numerator. The metric moves in the wrong direction for the right concern.

The correct gate is **differential**: fail when *this change introduces new duplication*, and stay silent about the duplication that already exists. The unit of enforcement is the pull request, not the codebase.

```
GLOBAL GATE (wrong)
  fail if repo duplication % > 3%
  → punishes inherited debt, gameable by filler, no actionable signal,
    a clean new copy can even lower the % while adding a clone

DIFFERENTIAL GATE (right)
  fail if THIS PR adds a NEW clone ≥ MIN_TOKENS not present on the base branch
  → author owns what they introduce; pre-existing debt is a separate,
    deliberate backlog decision — not a tax on the next unrelated PR
```

Three parameters make a differential gate fire on real risk and stay quiet on noise:

**1. Minimum clone size that doesn't trip on legitimate boilerplate.** Every detector has a threshold — minimum tokens (jscpd `--min-tokens`), minimum lines (PMD CPD `--minimum-tokens`, Simian's threshold). Set it too low and the gate screams about things that are *correctly* repeated: a six-line builder, a standard error-wrap, a table-driven test row, a license header, a logging preamble. These are repetition, not duplication-as-debt — extracting them buys nothing and often hurts readability. A practical floor is on the order of **50–100 tokens** (roughly 8–15 non-trivial lines) for application code; tune it against your own corpus by running the detector and looking at what the lowest-scoring hits actually are. The right threshold is the one where every flagged clone is something a senior engineer would also frown at by eye.

**2. Exclusions for code that is *supposed* to repeat or isn't yours.** Generated code (protobuf stubs, ORM models, OpenAPI clients, `mocks/`), vendored dependencies, migration files (each migration is a frozen historical snapshot — "deduplicating" them is a category error), and to a large degree **test code** should be excluded or held to a far looser threshold. Tests are deliberately repetitive for readability: the [DAMP-over-DRY](../../../code-craft/refactoring/) principle says a test that spells out its own arrange/act/assert is better than one that hides the scenario behind a shared helper. A duplication gate that fails a PR because two tests share a setup block is training engineers to write *worse* tests.

```yaml
# jscpd-style config: the exclusions are the policy
threshold: 0            # differential mode handled by CI diff, not a global %
min-tokens: 70
ignore:
  - "**/*.pb.go"        # generated
  - "**/*_gen.go"
  - "**/mocks/**"
  - "**/vendor/**"
  - "db/migrations/**"  # frozen snapshots, never dedup
  - "**/*_test.go"      # tests: DAMP > DRY (or a separate, looser run)
reporters: [consoleFull, sarif]   # SARIF → inline PR annotation on the new clone
```

**3. The gate annotates, it doesn't just fail.** Emit SARIF (or your platform's annotation format) so the new clone is highlighted *on the diff*, pointing at both copies, with the token count. A red X with no location teaches nothing; an inline "this 30-line block duplicates `pricing/discount.go:88`" lets the author make an informed call — extract, or consciously accept and suppress with a reasoned comment. The gate's job is to force a *decision at the moment of introduction*, when the context is fresh and the cost of choosing is lowest.

> **The professional reality:** a duplication gate is only as good as its silence. If it fires on boilerplate, generated code, and honest test repetition, engineers learn to ignore it or paper over it with extractions that exist solely to satisfy the linter — and those extractions are the wrong-abstraction debt this whole topic warns about. A gate that cries wolf doesn't just fail to help; it actively manufactures the coupling it was meant to prevent.

---

## Why a "0% Duplication" Mandate Causes Harm

A leadership directive of "zero duplication" sounds like rigor. It is, in practice, one of the most reliable ways to *degrade* a codebase, because it inverts the cost model. Some duplication is cheaper than its removal, and a 0% mandate forbids you from making that trade.

The mechanism is **premature abstraction**. To drive duplication to zero you must extract a shared abstraction at the *first* repetition — before the second and third use sites have revealed whether they're truly the same concept or merely similar-looking-today. You extract `applyDiscount(order, rule)` from two call sites. A month later one caller needs to skip discounts for gift cards, the other needs to stack two discounts. You add a `skipGiftCards bool` and a `stackable bool` parameter. Then a tax-exemption flag. The shared function grows a thicket of boolean parameters and `if` branches, each existing to make one caller diverge from the abstraction it was forced to share. This is **the wrong abstraction**, and Sandi Metz's rule is the load-bearing insight of this entire topic: *duplication is far cheaper than the wrong abstraction.* A copy is local and independently editable; the wrong abstraction couples every caller to a shape that fits none of them, and each new requirement makes it worse.

The damage compounds at org scale. A 0% mandate doesn't just produce one bad function — it produces the **god utility library** (covered below), because the only way to dedup code that appears in multiple services is to hoist it into a shared package that all of them depend on. You have converted *duplication* (cheap, local, decoupled) into *coupling* (expensive, distributed, a coordination tax on every team). You traded a problem a tool can see and you can ignore for a problem no tool flags and you can't escape.

The mature stance: **duplication is a smell, not a defect.** A smell is a prompt to *look*, not a rule to *obey*. The rule of three exists precisely to defer the abstraction decision until you have enough evidence to make it well — and sometimes the right answer after three copies is still "keep the copies," because the three contexts are genuinely independent and the abstraction would couple them. A policy that removes your ability to say "this copy is correct" is a policy that guarantees wrong abstractions.

> **The principle:** "0% duplication" optimizes a number a tool can measure at the direct expense of a property no tool can — *appropriate coupling*. The goal was never zero clones; it was a codebase that's cheap to change. Those are different objectives, and past the rule of three they frequently point in opposite directions.

---

## Org-Scale DRY Judgment: the Duplication a Detector Can't See

Here is the inversion that separates senior from professional judgment: **the most expensive duplication in a large organization is almost never the copy-paste a token detector flags.** CPD finds *textual and structural* clones — the same lines, the same AST shape. The duplication that actually costs you money is **conceptual**: the same business rule, invariant, or domain decision implemented independently in several places, sharing *no* tokens, invisible to every similarity tool ever built.

Consider a single business rule: *"orders over $10,000 require a second approver, except for trusted-tier customers, except in the EU where the threshold is €8,000."* In a microservice org that rule can materialize in the order service (Go), the approvals service (Java), the billing reconciliation job (Python), and a frontend guard (TypeScript). Four implementations, four languages, zero shared tokens. A jscpd or Simian scan reports *0% duplication* across them. Yet this is the most dangerous duplication in the system, because when the rule changes — the threshold moves, a new exempt tier appears, regulators add a third region — someone has to find and update *all four*, and nothing tells them the fourth exists. The bug isn't a clone; it's a **divergence**: three copies updated, one missed, and now the system enforces two different versions of the same rule depending on which path you hit.

This reframes what duplication governance is actually for. Token-level detection is the easy 20% — automatable, gateable, mostly cosmetic. The expensive 80% is conceptual duplication, and you fight it with *architecture and documentation*, not a linter:

- **A single source of truth for each business rule** — encode the rule once (a shared decision service, a rules engine, a generated config consumed by all services, a schema with the constraint built in) so the four consumers read one definition instead of re-implementing it. This is genuine DRY: "every piece of *knowledge* has a single, authoritative representation" (Hunt & Thomas) — and *knowledge* means the rule, not the lines of code.
- **Bounded contexts that name where a concept lives** — DDD's contribution to this problem is making it explicit which service *owns* a concept, so a rule has a home and changes have an obvious blast radius.
- **Cross-service contract and consumer-driven tests** — if four services must agree on a threshold, a shared contract test that all four run will catch the divergence a similarity scan never could.

> **The hard part:** the duplication your dashboard graphs is the duplication that matters *least*. The duplication that causes incidents — the same rule, diverged across services — produces a flat 0% on every detector. Spending your governance energy driving the visible number to zero while the invisible divergence accumulates is optimizing the streetlight because that's where the light is. The professional skill is keeping the token gate *cheap and quiet* so you can spend your real attention on the conceptual duplication no tool will ever hand you.

---

## Deliberate Duplication Across Boundaries

The flip side of "conceptual duplication is the expensive kind" is equally counterintuitive: **some duplication is correct, and removing it is the mistake.** Specifically, duplication *across* team or service boundaries is frequently the right call, because the alternative — a shared dependency — is *coupling*, and coupling across an organizational boundary is a coordination cost that often dwarfs the cost of the copy.

The clearest case is a **microservice contract**. Service A produces an event; service B consumes it. They both need a struct describing the event's shape. The DRY instinct is to extract `OrderPlacedEvent` into a shared `events` package both import. But now A and B share a compile-time dependency on the same type. When A needs to evolve the event, it can't change the shared type without breaking B's build; the two teams must coordinate a synchronized upgrade — the precise *temporal coupling* that microservices exist to eliminate. The "duplicated" alternative — each service defines its own copy of the contract and they agree via a versioned schema (protobuf, Avro, JSON Schema) and contract tests — is *more* duplication by token count and *less* coupling by every measure that matters. The schema, not the shared code, is the single source of truth; the per-service structs are deliberate, autonomy-preserving copies. (This is the broader truth behind "[duplication is far cheaper than the wrong abstraction](../../../code-craft/refactoring/)" applied to org structure: a shared *type* across a service boundary is very often the wrong abstraction.)

The general principle, sometimes called the **rule of three teams** by analogy to the rule of three: code shared *within* a team, behind one deployable, with one owner who can refactor all call sites in a single commit, is a strong DRY candidate — the cost of the abstraction is low because one team controls all of it. Code shared *across* teams or *across* independently-deployed services is a coupling decision first and a DRY decision a distant second, because now the abstraction has multiple owners, multiple release cadences, and no one who can change all call sites atomically. **Conway's Law cuts both ways:** sharing code across a team boundary creates a communication and coordination edge that mirrors the dependency, whether you wanted that org structure or not.

> **The reframe:** asking "is this duplicated?" across a service boundary is asking the wrong question. The right question is "do I want a coordination dependency between these two teams?" If the answer is no — and for autonomous services it usually is — then the copy is not debt, it's the *mechanism* of the autonomy, and a well-meaning "let's DRY this up" PR is proposing to delete the boundary. Preserve the copy; share the *schema*.

---

## The Shared-Library Trade-off and the God-Library Tax

When duplication *is* within a boundary where sharing makes sense, the extract-to-library decision still isn't free. Extraction trades a cheap, local cost (the copy) for a set of distributed, ongoing costs that are easy to underestimate.

**Versioning and the diamond-dependency tax.** The moment code lives in a shared library, every change is a *release*, and every consumer is on *some version*. In any non-trivial dependency graph you get the **diamond**: service S depends on libraries X and Y, and both X and Y depend on `shared-core` — but X needs `shared-core@2.0` and Y still requires `shared-core@1.x`, which changed an interface incompatibly. Now S can't build. Resolving diamonds — coordinating lock-step upgrades, maintaining backward-compatible shims, running multiple major versions in parallel — is a tax levied on *every* consumer for the *privilege* of not having duplicated the code. For a small, stable, genuinely-shared concern (a crypto primitive, a date library) that tax is worth paying. For a grab-bag of loosely-related helpers, it is not.

**The god-utility library.** This is the predictable failure mode, and a 0% duplication mandate is its most reliable cause. It starts innocently: two services both need a string helper, so someone makes `internal-utils`. Then everyone has somewhere to put "shared" code, so everything lands there — string helpers, HTTP middleware, a date formatter, a feature-flag client, retry logic, half a logging framework. Within a year `internal-utils` is a 50-module package that *every service depends on*, and it has become the worst object in your architecture:

- **Every service now transitively couples to every other service's helpers.** A change one team needs in the retry logic forces a new `internal-utils` release that *every* consumer must absorb, dragging along unrelated churn in the date formatter and the flag client.
- **It's a single point of coordination and a release bottleneck.** Nobody can move fast because everybody shares it; a breaking change requires an org-wide migration.
- **It accretes a vast transitive dependency surface.** `internal-utils` pulls in HTTP, crypto, JSON, a metrics SDK — so every consumer inherits all of them and the CVE blast radius of the god-library is the union of everything it ever touched.
- **It has no coherent owner.** It's "shared," which means no team owns its design, which means it has no design — just accretion.

The defense is **discipline about what earns library status**, and it is a *higher* bar than "this code appears twice." A shared library should be cohesive (one clear concern, nameable in a sentence without "and"), stable (its interface changes rarely), and genuinely owned (a team is accountable for its evolution and backward compatibility). The honest comparison at the extraction decision is not "DRY good, copy bad" — it's *the one-time cost of the copy* against *the perpetual cost of versioning, diamond resolution, coordinated upgrades, transitive-dependency surface, and the risk of becoming the next god-library.* Past a low threshold of size and a high threshold of true sharedness, **the copy frequently wins.**

> **The org-scale rule:** a shared library is a *commitment to coordinate*, paid forever by everyone who depends on it. Extract when the shared concern is small, stable, cohesive, and owned. When it's a pile of unrelated helpers, you are not removing duplication — you are building a coupling machine, and "we all depend on `internal-utils`" is the sound it makes.

---

## Cross-Repo Duplication Detection at Scale

In a poly-repo org the most interesting duplication crosses repository boundaries — the same auth-middleware copied into fifteen services, the same broken retry loop fanned out by copy-paste — and a per-repo scanner is blind to all of it because each repo individually looks clean. Detecting it requires running similarity analysis over the *union* of repos, which raises real engineering problems and, more importantly, a hard question about what to *do* with the findings.

**The detection mechanics.** Single-repo tools (jscpd, PMD CPD, Simian) can be pointed at a checked-out monorepo or a synced superset of repos, but the cost is combinatorial — clone detection is roughly quadratic in code size, so naive cross-repo scans of a large org don't finish. The scalable approaches index rather than pairwise-compare:

- **Fingerprint indexing** (the SourcererCC / winnowing approach): hash normalized token windows into a fingerprint index, then find collisions. This makes "show me every copy of this block across 300 repos" an index lookup instead of an O(n²) sweep, and it's how at-scale clone detection actually works.
- **Detecting copied-and-mutated code** matters more cross-repo than within a repo, because a helper copied into a new service usually gets lightly edited (renamed, re-namespaced) — Type-2/3 clones. Token-normalized fingerprinting catches these where a literal text diff would miss them.
- **Run it as an offline report, never a blocking gate.** Cross-repo scanning is too slow and too noisy to sit in a PR's critical path; it belongs in a nightly/weekly job that feeds a report or a [code health dashboard](../06-code-health-dashboards/professional.md), not in the merge gate.

**What to do with the findings — the part that's actually hard.** A list of 400 cross-repo clones is not, by itself, a to-do list; treated as one it becomes a mandate to build the god-library. Triage by the *same* boundary logic as the rest of this page:

1. **Same team, same boundary?** This is a legitimate extraction candidate — one owner can refactor all call sites. Highest value, lowest risk.
2. **Across teams / services?** Default to *leaving the copy* unless the shared thing is small, stable, and worth a coordination dependency. Most cross-team clones should stay copies; that's the autonomy working as designed.
3. **A copied *bug*?** This is the genuinely valuable output of cross-repo detection and the reason to run it at all: a fixed-once-missed-elsewhere defect. "This vulnerable/buggy block exists in eleven repos" is an actionable security and correctness finding even when *extracting* the block would be the wrong call. Fix the eleven copies; don't necessarily merge them.

> **The professional discipline:** cross-repo duplication detection's highest-value output is *not* "here's what to DRY" — it's "here's a known-bad block we copied into eleven services, go patch them." Reading the report as an extraction backlog is precisely how a tool meant to find copied bugs ends up mandating the god-library that causes worse ones. Detect widely; extract narrowly; patch copied bugs always.

---

## Duplication × Churn as a Refactoring-Prioritization Input

Duplication in isolation is a weak prioritization signal — most of it is harmless, and you have neither the time nor the mandate to dedup a whole org. The signal sharpens dramatically when you **combine duplication with churn**, exactly as the [hotspot analysis](../04-code-churn-and-hotspots/professional.md) for complexity does. The reasoning is identical: a metric tells you a file is *risky*; version-control history tells you whether anyone is actually *paying* for that risk.

A duplicated block that *never changes* costs almost nothing. The copies sit there; nobody touches them; the "debt" never comes due. Deduplicating it is busywork — you pay the abstraction cost for a maintenance burden that isn't being incurred. A duplicated block that *changes constantly*, by contrast, is where divergence bugs are *born*: every edit is an opportunity for someone to update one copy and forget the others, and high churn means that opportunity arrives weekly. **Duplicated AND high-churn is the quadrant that earns a fix.**

```
                 LOW churn                    HIGH churn
            ┌───────────────────────┬───────────────────────────┐
  DUPLICATED│  harmless copies       │  ★ FIX THIS ★             │
            │  (leave them;          │  divergence bugs are born  │
            │   dedup = busywork)    │  here — copies drift apart │
            ├───────────────────────┼───────────────────────────┤
  UNIQUE    │  fine                  │  watch for complexity      │
            │                        │  (the other hotspot axis)  │
            └───────────────────────┴───────────────────────────┘
```

Operationally, this is a join between your clone report and `git log`:

```bash
# Churn per file over the last 6 months (commit-touch count)
git log --since='6 months ago' --name-only --pretty=format: \
  | grep -E '\.(go|ts|java|py)$' | sort | uniq -c | sort -rn > churn.txt

# Cross-reference: files that appear in BOTH the clone report AND the high-churn
# list are the prioritized targets. High-churn duplicated code is where the next
# "fixed in three services, missed in the fourth" incident is incubating.
```

This also tells you *which kind of fix*. Duplicated-and-churning **within one boundary** → extract (one owner, all call sites, atomic). Duplicated-and-churning **across services** → don't extract (autonomy), but add a **contract/consumer test** so the next divergent edit is caught even though the copies remain. The churn signal converts an undifferentiated 400-clone report into the handful of blocks where duplication is actively generating risk — and that's the list worth a sprint.

> **The prioritization rule:** duplication tells you *what's repeated*; churn tells you *what's changing*; their intersection tells you *where the bugs will come from*. Dedup the intersection, leave the rest, and never let a clone report that ignores churn set your refactoring agenda — it will send you to dedup frozen code while the actively-diverging copies keep shipping bugs.

---

## War Stories

**The 0% mandate that built a coupling nightmare.** A VP, burned by a duplicated bug, mandated "zero duplication" enforced by a hard global gate across every repo. Teams complied the only way the gate allowed: they hoisted every flagged clone into a shared `platform-commons` package. Within a year `platform-commons` was 60 modules — string utils, HTTP middleware, a half-baked ORM wrapper, retry logic, a logging facade — and *every one* of the company's 40 services depended on it. A one-line change one team needed in the retry logic now required a `platform-commons` major release and a coordinated 40-service migration that took a quarter. The duplication number was beautiful; the org had ground to a halt. The post-mortem's verdict: the mandate had converted cheap, local, decoupled duplication into expensive, distributed, *mandatory* coupling — and the god-library it spawned was the single worst component in the architecture. They killed the global gate, split `platform-commons` into small owned libraries, and switched to a differential gate that fired only on new in-repo clones.

**The business rule that diverged across four services.** A fintech enforced a "transactions over $10k need dual approval, except trusted-tier, except €8k in the EU" rule. The rule lived, independently implemented, in the order service, the approvals service, a reconciliation job, and a frontend guard — four languages, zero shared tokens, *0% on every duplication scan*. When compliance added a new exempt customer tier, three teams updated their copy and the fourth (the reconciliation job, owned by a team not in the loop) didn't. For six weeks the system *approved* certain transactions at the edge but *flagged* them as non-compliant in reconciliation — a silent divergence that surfaced only in an audit. No similarity tool could have caught it; the duplication was conceptual. The fix wasn't a dedup — it was extracting the rule into a single decision service all four consumed, plus a contract test all four ran. The lesson the org internalized: the duplication that causes incidents is the kind your dashboard reports as zero.

**The deliberate copy that kept two services decoupled.** Two teams shared an `OrderPlacedEvent`. A well-meaning engineer, citing DRY, extracted it into a shared `events` package both services imported. Three months later the producing team needed to add a field and restructure the event — and discovered they couldn't, because changing the shared type broke the consumer's build, forcing a synchronized cross-team deploy for what should have been an independent change. They reverted: each service now defined its *own* copy of the event struct, with a versioned Avro schema in the registry as the single source of truth and a contract test guarding compatibility. Token count went *up*; coordination cost went to *zero*; the producer could evolve the event behind schema-compatibility rules without ever touching the consumer's repo. The "duplication" the original PR deleted had been the mechanism of the teams' independence — and DRY had quietly proposed to delete the boundary.

---

## Decision Frameworks

**Extract to a shared library, or duplicate? Walk it in order:**

1. **Is it within one team / one deployable, one owner who can change all call sites atomically?**
   - **No (crosses teams or services):** strongly prefer **duplicate**. Share a *schema/contract*, not code. The copy preserves autonomy; the shared type is usually the wrong abstraction. Stop here unless the shared thing is tiny, stable, and clearly worth a coordination dependency.
   - **Yes:** continue.
2. **Have you reached the rule of three (≥3 real, non-speculative uses) AND do they represent the *same concept*, not just similar-looking code?**
   - **No:** **duplicate** and wait. Premature extraction risks the wrong abstraction; you don't yet have the evidence to shape the abstraction well.
   - **Yes:** continue.
3. **Is the candidate cohesive (one concern, nameable without "and"), stable (interface changes rarely), and will it have a real owner?**
   - **No:** **duplicate.** This is god-library fuel — a grab-bag of unrelated helpers with no owner is a coupling machine, not a library.
   - **Yes:** **extract** — and version it, give it an owner, keep it small, and watch the dependency graph for diamonds.

**Should this clone be on my refactoring list at all?**
- Is it *churning*? No → **leave it** (dedup is busywork on frozen code). Yes → it's a candidate.
- Within a boundary and churning → **extract**. Across services and churning → **keep the copies, add a contract test** for the shared invariant.

**What should the duplication *gate* enforce?**
- **Differential, not global:** fail on *new* clones in the diff, never on the repo's total %.
- **Min clone size** ~50–100 tokens, tuned so every hit would also bother a senior by eye.
- **Exclude** generated, vendored, migrations; hold tests to a far looser bar (DAMP > DRY).
- **Annotate the diff** (SARIF) — force a decision at introduction; allow a reasoned suppression.

**Is this even the duplication that matters?**
- A token detector found it → it's the *cheap* kind; gate it quietly and move on.
- It's the same *business rule* across services → the *expensive* kind, invisible to tools; fix with a single source of truth + contract tests, not a linter.

---

## Mental Models

- **The duplication a tool flags is the cheap kind; the expensive kind is conceptual and invisible.** CPD finds shared tokens. The duplication that causes incidents — the same business rule diverged across services — shares no tokens and reports as 0%. Spend your real attention there.

- **Duplication is far cheaper than the wrong abstraction.** (Metz's rule, the load-bearing idea of this topic.) A copy is local and independently editable; a premature shared abstraction couples every caller to a shape that fits none of them and gets worse with each new requirement. Past the rule of three, the copy still sometimes wins.

- **Across a team/service boundary, "is this duplicated?" is the wrong question — "do I want these teams coupled?" is the right one.** Deliberate duplication across boundaries is the *mechanism* of autonomy. Share the schema, not the code.

- **A shared library is a commitment to coordinate, paid forever by every consumer.** Versioning, diamond resolution, lock-step upgrades, a shared transitive surface. Worth it for small, stable, owned, cohesive concerns; a god-library-in-waiting otherwise.

- **Gate the diff, not the codebase.** A global duplication % punishes inherited debt, is gameable, and gives no actionable signal. Fail on *new* clones the author is introducing right now, when the cost of choosing is lowest.

- **Duplication × churn is the real prioritization signal.** Frozen duplication is harmless; churning duplication is where divergence bugs are born. Dedup the intersection; leave the rest.

---

## Common Mistakes

1. **Gating on a global duplication percentage.** It taxes the next author for the whole team's history, is gamed by adding filler, gives no actionable location, and can even *drop* when a clean copy grows the denominator. Gate the *diff* — new clones only.

2. **Setting the minimum clone size so low it fires on boilerplate.** Six-line builders, error-wraps, table-driven test rows, and license headers are *repetition*, not debt. A gate that screams about them gets ignored or papered over with pointless extractions. Tune the threshold until every hit would also bother a senior by eye.

3. **Running the duplication gate over generated code, vendored deps, migrations, and tests.** Generated and vendored code isn't yours; migrations are frozen snapshots (deduplicating them is a category error); tests are deliberately DAMP for readability. Exclude them or hold them to a far looser bar.

4. **Mandating "0% duplication."** It forces premature abstraction, manufactures the wrong-abstraction coupling that's worse than any copy, and — at org scale — spawns the god-library, converting cheap local duplication into expensive distributed coupling. Treat duplication as a smell to investigate, not a defect to eradicate.

5. **DRYing code across a service boundary.** Extracting a shared *type* across services creates exactly the temporal coupling microservices exist to avoid. Each service should own its copy; the *schema* is the single source of truth, guarded by contract tests.

6. **Reading a cross-repo clone report as an extraction backlog.** Most cross-team clones should stay copies (autonomy). The report's real value is finding *copied bugs* — "this broken block is in eleven repos, go patch them" — not "here's what to DRY into `internal-utils`."

7. **Letting `internal-utils` exist.** A grab-bag shared library with no coherent concern and no owner couples every consumer to every other, becomes a release bottleneck, and balloons the transitive CVE surface. Earn library status with cohesion, stability, and ownership — not with "this appears twice."

8. **Deduplicating frozen code while ignoring churn.** A clone that never changes costs nothing; deduping it is busywork. Cross-reference clones with `git log` and spend your effort on the duplicated-*and*-churning quadrant, where divergence bugs actually incubate.

---

## Test Yourself

1. Why is a global "fail if repo duplication > 3%" gate the wrong design, and what does a *differential* gate enforce instead?
2. You're asked to enforce "0% duplication" org-wide. Explain the two distinct ways this *degrades* the codebase, naming the abstraction failure and the org-scale failure it causes.
3. A fintech enforces a complex approval rule, implemented in four services in four languages. A duplication scan reports 0%. Why is this the *most* dangerous duplication in the system, and how do you actually fix it?
4. Two teams share an event type. Make the case for *duplicating* the struct across both services rather than extracting it into a shared package. What becomes the single source of truth?
5. What is the "god utility library," what policy most reliably causes it, and what three properties should gate whether code earns shared-library status?
6. You have a 400-entry cross-repo clone report. Describe your triage. What is the report's *highest-value* output, and which finding type should mostly stay duplicated?
7. How does combining duplication with churn change your refactoring priorities, and what's the right fix for code that's duplicated-and-churning *across* a service boundary (where you can't just extract)?

<details>
<summary>Answers</summary>

1. A **global** gate punishes the current author for the whole codebase's accumulated history, is gameable (add non-duplicated filler to dilute the %), gives no actionable location, and can even *decrease* when a clean new copy grows the denominator faster than the numerator. A **differential** gate fails only when *this PR introduces a new clone* (≥ a min token size, not present on the base branch), so the author owns what they add and pre-existing debt is a separate, deliberate backlog decision — not a tax on the next unrelated change.
2. **Abstraction failure:** to reach 0% you must extract at the *first* repetition, before use sites reveal whether they're the same concept; you get the **wrong abstraction** — a function thick with boolean parameters and branches so each caller can diverge from the shape it was forced to share. Per Metz, that's worse than the duplication. **Org-scale failure:** the only way to dedup code across services is to hoist it into a shared package everyone depends on, converting cheap, local, decoupled *duplication* into expensive, distributed *coupling* — i.e., it spawns the **god-library**.
3. The rule is **conceptually** duplicated across four services but shares *zero tokens*, so every similarity tool reports 0%. It's the most dangerous because when the rule changes, someone must find and update all four with nothing pointing at the fourth — producing a silent **divergence** (three updated, one missed) that enforces two versions of the rule depending on the code path. Fix it by giving the rule a **single source of truth** (a shared decision service / rules engine / generated config) plus **contract tests** all consumers run — not a linter, which is blind to it.
4. A shared package creates a **compile-time dependency**: the producer can't evolve the event without breaking the consumer's build, forcing synchronized cross-team deploys — the temporal coupling microservices exist to eliminate. Each service owning its **own copy** of the struct keeps the teams independently deployable; the **versioned schema** (protobuf/Avro/JSON Schema) in the registry becomes the single source of truth, with a contract test guarding compatibility. More tokens, far less coupling.
5. The **god utility library** is a grab-bag shared package (`internal-utils`/`platform-commons`) that accretes unrelated helpers until *every* service depends on it, making it a release bottleneck, a universal coupling point, and a bloated transitive-dependency/CVE surface with no coherent owner. A **"0% duplication" mandate** most reliably causes it. Code earns library status only if it's **cohesive** (one concern, no "and"), **stable** (interface rarely changes), and **owned** (a team accountable for compatibility).
6. Triage by boundary: (a) **same team/boundary** → legitimate extraction candidate (one owner, atomic refactor); (b) **across teams/services** → mostly *leave as copies* (autonomy) unless small, stable, and worth a coordination dependency; (c) **copied bug** → patch every copy. The report's **highest-value output** is finding **copied bugs/vulnerabilities** ("this bad block is in eleven repos"), which is actionable even when extracting would be wrong. **Cross-team clones** should mostly stay duplicated.
7. Duplication alone is weak signal; **frozen** duplication is harmless and deduping it is busywork. The intersection of **duplicated AND high-churn** is where divergence bugs are born (every edit risks updating one copy and forgetting the rest), so that quadrant earns the fix. For duplicated-and-churning **across a boundary**, you can't extract without coupling the teams — so **keep the copies and add a contract/consumer test** for the shared invariant, catching the next divergent edit while preserving autonomy.

</details>

---

## Cheat Sheet

```
DUPLICATION GATE (policy)
  GLOBAL %  →  WRONG (taxes inherited debt, gameable, no location, can drop on a clean copy)
  DIFFERENTIAL  →  RIGHT (fail on NEW clones in the diff, base-branch comparison)
  min-tokens ~50–100   (tune: every hit should also bother a senior by eye)
  EXCLUDE: generated, vendored, migrations; tests = looser (DAMP > DRY)
  ANNOTATE the diff (SARIF) → decision at introduction, reasoned suppression allowed

THE CORE RULE (Metz)
  duplication is FAR CHEAPER than the wrong abstraction
  → past rule-of-three, the copy still sometimes wins

WHAT THE TOOL SEES vs WHAT COSTS YOU
  token clone   → CHEAP kind   → gate quietly, move on
  same business RULE across services (0 shared tokens) → EXPENSIVE kind
     → 0% on every scanner; fix with single source of truth + contract tests

ACROSS A SERVICE/TEAM BOUNDARY
  "is it duplicated?"  ← WRONG question
  "do I want these teams coupled?"  ← RIGHT question
  → DUPLICATE the struct, share the SCHEMA (protobuf/Avro), contract-test it
  → deliberate copy = the MECHANISM of autonomy

EXTRACT vs DUPLICATE
  cross team/service?        → DUPLICATE (share schema, not code)
  < rule of three / not same concept? → DUPLICATE (avoid wrong abstraction)
  not cohesive/stable/owned? → DUPLICATE (god-library fuel)
  small + stable + cohesive + owned + within boundary → EXTRACT (version it, watch diamonds)

SHARED-LIBRARY TAXES
  versioning + diamond deps (X needs core@2, Y needs core@1) + lock-step upgrades
  + transitive CVE surface + becoming internal-utils

PRIORITIZE WITH CHURN
  duplicated AND high-churn  → FIX (divergence bugs born here)
  duplicated AND frozen      → LEAVE (dedup = busywork)
  within boundary → extract;  across boundary → keep copies + contract test
  join: clone report ⋈ (git log --name-only churn count)

CROSS-REPO DETECTION
  fingerprint index (winnowing/SourcererCC), NOT O(n²) pairwise
  offline report / dashboard, NEVER a blocking gate
  highest value = finding COPIED BUGS, not an extraction backlog
```

---

## Summary

- **Gate the diff, not the codebase.** A global duplication % taxes inherited debt, is gameable, gives no actionable location, and can even drop when a clean copy grows the denominator. Fail only on *new* clones the current PR introduces, above a **min clone size** (~50–100 tokens) tuned so it never fires on legitimate boilerplate, with **generated/vendored/migration code excluded** and **tests held to a looser bar** (DAMP > DRY). Annotate the diff so the author decides at introduction.
- **A "0% duplication" mandate causes harm.** It forces premature abstraction → the wrong abstraction (worse than any copy, per Metz), and at org scale it spawns the **god utility library**, converting cheap local duplication into expensive distributed coupling. Duplication is a smell to investigate, not a defect to eradicate.
- **The expensive duplication is the kind a tool can't see.** The same *business rule* re-implemented across services shares no tokens and reports 0%, yet it's where divergence incidents come from. Fight it with a **single source of truth + contract tests**, not a linter — keep the token gate cheap and quiet so your real attention goes here.
- **Deliberate duplication across boundaries is correct.** Sharing a *type* across services creates the temporal coupling microservices exist to avoid; each service should own its copy with a **versioned schema** as the source of truth. The copy is the mechanism of autonomy — DRYing it deletes the boundary.
- **A shared library is a commitment to coordinate forever** — versioning, diamond dependencies, lock-step upgrades, a shared transitive/CVE surface. Extract only what's **small, stable, cohesive, and owned**; otherwise the copy wins and you avoid the next `internal-utils`.
- **Prioritize with churn.** Duplicated *and* high-churn is the quadrant where divergence bugs are born and the only one that reliably earns a fix; within a boundary → extract, across a boundary → keep the copies and add a contract test. Cross-repo detection's highest-value output is finding **copied bugs**, not an extraction backlog.

You can now govern duplication across an organization as a coupling-and-autonomy decision rather than a number to minimize. The remaining tier — [interview.md](interview.md) — consolidates the topic into the questions that probe whether someone actually understands when *not* to DRY.

---

## Further Reading

- Sandi Metz, ["The Wrong Abstraction"](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) — the essay behind "duplication is far cheaper than the wrong abstraction"; the load-bearing idea of this whole topic.
- Andrew Hunt & David Thomas, *The Pragmatic Programmer* — the original DRY definition: "every piece of *knowledge* has a single authoritative representation." Note that *knowledge*, not *code text*, is the unit — which is exactly why conceptual duplication is the expensive kind.
- Sam Newman, *Building Microservices* — the case against shared code across service boundaries; why a little duplication beats coupling, and contracts/schemas as the source of truth.
- Eric Evans, *Domain-Driven Design* — bounded contexts as the answer to "where does this concept live," the architectural defense against conceptual duplication.
- Adam Tornhill, *Software Design X-Rays* — combining behavioral data (churn) with code metrics to prioritize; the hotspot reasoning applied to duplication.
- The SourcererCC and winnowing/MOSS papers — how clone detection scales to hundreds of repos via fingerprint indexing instead of quadratic comparison.

---

## Related Topics

- [Coupling & Cohesion Metrics → Professional](../03-coupling-and-cohesion-metrics/professional.md) — the metrics behind "extract = more coupling"; instability, the diamond, and why a shared library raises afferent coupling across the org.
- [Code Health Dashboards → Professional](../06-code-health-dashboards/professional.md) — where the offline cross-repo duplication report and the duplication × churn join surface as trends, not blocking gates.
- [Quality Gates](../../quality-gates/) — the broader discipline of designing CI gates that catch real risk and stay silent on noise; the differential-gate pattern generalizes well beyond duplication.
- [Technical Debt Management](../../technical-debt-management/) — what to *do* with prioritized duplication: when paying it down (extract) is worth it, and when accepting it (the deliberate copy) is the correct debt decision.
