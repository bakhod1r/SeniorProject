# Coupling & Cohesion Metrics — Professional Level

> **Roadmap:** [Code Quality Metrics](../README.md) → Coupling & Cohesion Metrics
> *The senior page taught you what afferent/efferent coupling, instability, abstractness, and LCOM measure. This page is about using those numbers to govern architecture across many teams — turning "this package is unstable" into a CI gate that blocks a cyclic dependency, a map that tells you where to cut a service seam, and an argument that a team boundary is in the wrong place. At org scale the dependency graph stops being a diagram and becomes the thing your deploy independence, your blast radius, and your org chart are all secretly arguing about.*

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Enforcing Dependency Rules as a Gate](#enforcing-dependency-rules-as-a-gate)
4. [Reading the Dependency Graph to Guide Team Boundaries](#reading-the-dependency-graph-to-guide-team-boundaries)
5. [Coupling Metrics and Where to Cut a Seam](#coupling-metrics-and-where-to-cut-a-seam)
6. [Detecting and Sequencing the Worst Structural Debt](#detecting-and-sequencing-the-worst-structural-debt)
7. [Temporal Coupling Across Services](#temporal-coupling-across-services)
8. [The Limits and the Gaming](#the-limits-and-the-gaming)
9. [War Stories](#war-stories)
10. [Decision Frameworks](#decision-frameworks)
11. [Mental Models](#mental-models)
12. [Common Mistakes](#common-mistakes)
13. [Test Yourself](#test-yourself)
14. [Cheat Sheet](#cheat-sheet)
15. [Summary](#summary)
16. [Further Reading](#further-reading)
17. [Related Topics](#related-topics)

---

## Introduction

> Focus: **Using coupling and cohesion analysis to govern architecture at organizational scale — as a CI gate, as input to where teams and services should be split, and as a way to find and sequence the structural debt that actually hurts.**

The senior page framed these metrics as analysis: you could compute a package's instability `I = Ce / (Ca + Ce)`, plot it against abstractness on the main sequence, spot the zone of pain, and read LCOM as a cohesion smell. At the professional level the question changes from *"what does this number say?"* to *"what should this number be allowed to do?"* — and the answers show up in different meetings: an architecture review where someone proposes a new service and you ask "what's its afferent coupling, i.e. who will be unable to deploy without it?"; a CI pipeline that fails a PR because it introduced a cycle between two modules that must stay independently releasable; a reorg where two teams keep blocking each other and the dependency graph shows exactly why; a quarter of debt-paydown work where you have to pick *which* of forty bad structural smells to fix first.

None of this is a new metric. It's the same Ca/Ce/I/A and LCOM from the earlier tiers, now wired into automation, read against the org chart, and weighted so the worst damage gets fixed first. The discipline here is judgment: these numbers are excellent **diagnostics that point at architectural risk** and dangerous **targets that get gamed** the moment you put them on a leaderboard. This page is the pragmatic layer — how to enforce structure without ranking humans, and how to let the graph inform Conway's-law decisions instead of pretending the org chart and the architecture are unrelated.

---

## Prerequisites

- **Required:** [senior.md](senior.md) — afferent/efferent coupling, instability, abstractness, the main sequence, the zone of pain, LCOM, fan-in/fan-out.
- **Required:** You've worked in a codebase large enough that no one holds the whole dependency graph in their head.
- **Helpful:** You've owned a CI pipeline and can add a gate that blocks a merge.
- **Helpful:** You've felt two teams block each other's releases and wondered whether the architecture or the org chart was at fault. (It's usually both — that's the point.)

---

## Enforcing Dependency Rules as a Gate

Coupling metrics computed in a report you read quarterly change nothing. Coupling rules enforced on every pull request change the architecture, because they stop a regression *before it lands* instead of cataloguing it after. The shift is from **measuring coupling** to **governing it** — and the mechanism is a **fitness function**: an automated test that asserts a structural property and fails the build when it's violated.

The two properties worth gating on first, because they're unambiguous and high-value, are **no cycles** and **layering is respected**.

**Banning cycles.** A dependency cycle between modules means neither can be understood, tested, built, or deployed without the other — they are one unit pretending to be two. In JVM-land, [ArchUnit](https://www.archunit.org/) makes this a plain JUnit test:

```java
@AnalyzeClasses(packages = "com.acme.shop")
class ArchitectureTest {

    @ArchTest
    static final ArchRule no_cycles =
        slices().matching("com.acme.shop.(*)..")
                .should().beFreeOfCycles();

    @ArchTest
    static final ArchRule layering =
        layeredArchitecture().consideringAllDependencies()
            .layer("Web").definedBy("..web..")
            .layer("Domain").definedBy("..domain..")
            .layer("Persistence").definedBy("..persistence..")
            .whereLayer("Web").mayNotBeAccessedByAnyLayer()
            .whereLayer("Domain").mayOnlyBeAccessedByLayers("Web")
            .whereLayer("Persistence").mayOnlyBeAccessedByLayers("Domain");
}
```

That `layering` rule encodes a one-directional dependency policy — web depends on domain, domain on persistence, never the reverse — and any PR that makes the domain import a controller fails CI with the exact offending class named. The `no_cycles` rule slices the package tree and asserts the slice graph is a DAG.

In the JS/TS world, [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) does the same against the module-import graph, expressed as rules in a config:

```js
// .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-stays-pure",
      comment: "Domain must not import from web or infra layers.",
      severity: "error",
      from: { path: "^src/domain" },
      to:   { path: "^src/(web|infra)" },
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: { orphan: true, pathNot: "\\.d\\.ts$" },
      to: {},
    },
  ],
};
```

```bash
depcruise --config .dependency-cruiser.js src   # exits non-zero on any "error" rule
```

The same job exists in most ecosystems: `import-linter` (Python) for layered-contract enforcement, `go-arch-lint` or build tags (Go), `NetArchTest` (.NET), `eslint-plugin-boundaries` (TS). The tool matters less than the discipline: **the dependency rules live in version control next to the code, run on every PR, and fail the build with a named violation.**

Why a gate beats a dashboard: a dashboard tells you coupling *got worse* — after the cycle is already merged, depended on by three more modules, and ten times harder to remove. A gate makes the cheapest possible moment — the PR that introduces the regression — the moment you catch it. This is the architectural twin of a coverage ratchet, and it is the most concrete thing this entire roadmap can hand the [Quality Gates](../../quality-gates/) discipline. It is also the operational form of debt prevention: see [Technical Debt Management → preventing accumulation](../../technical-debt-management/06-preventing-accumulation/) — a structural fitness function is exactly "stop the debt before it accumulates," automated.

**Introducing a gate into an existing mess.** The honest problem is that almost no large codebase passes these rules on day one. You do not turn on `no-circular` as an error over a codebase with eighty existing cycles — that's a red build no one can fix in one PR, so it gets disabled and you've taught the org that the gate is a nuisance. Instead you **ratchet**: snapshot the current violations into a baseline (`depcruise --output-type baseline`, or ArchUnit's `FreezingArchRule` which records known violations to a store file), fail the build only on *new* violations beyond the baseline, and burn the baseline down over time. The rule is *"no worse than today,"* enforced from today, with the existing debt visible and shrinking — not *"perfect now,"* which is always declined.

> **The professional reality:** the value of an architecture rule is not the report it produces; it's the PR it rejects. A rule that runs in CI and blocks merges shapes behavior because engineers get the feedback while the change is cheap to alter. A rule that produces a weekly PDF shapes nothing. If you can only do one thing with coupling metrics at org scale, make "no new cycles, layering respected" a required check — frozen to a baseline so it's adoptable on legacy code.

---

## Reading the Dependency Graph to Guide Team Boundaries

Here is the most important and least-taught use of coupling metrics: the module dependency graph is a map of where your *coordination cost* lives, and coordination cost is dominated by where dependencies **cross team lines**.

**Conway's law** observes that systems tend to mirror the communication structure of the organizations that build them. The professional corollary — sometimes called the *inverse Conway maneuver* — is that you can use the dependency graph to check whether your team boundaries and your architecture agree, and to deliberately shape one to fit the other. The metric that matters for this is coupling *attributed to teams*, not to packages.

The key reframing: **coupling that lives inside one team is cheap; coupling that crosses team lines is expensive.** A tight cluster of mutually dependent modules owned by a single team is, at worst, a refactoring task that team can schedule on its own. The identical cluster split across three teams is a standing coordination tax — every change needs cross-team alignment, every release needs synchronization, every incident needs three on-call rotations in the same call. Same edges in the graph; wildly different cost, decided entirely by who owns which node.

So the analysis a senior architect actually runs is: overlay ownership on the dependency graph and look for the **mismatches**.

- **High cross-team coupling on a specific edge** → either the boundary is wrong (these two modules should be one team's, because they change together) or the interface between them is too rich (it should be a narrow, stable contract). Adam Tornhill's *Software Design X-Rays* operationalizes the change-coupling-meets-ownership version of this with explicit "inter-team coupling" and knowledge-map analyses.
- **A module with high afferent coupling owned by a team that treats it as a side project** → a structural risk: many teams depend on something no one is funded to maintain. The Ca tells you the blast radius; the ownership tells you whether anyone owns the blast.
- **One team's code split across many low-cohesion packages that other teams reach into** → the boundary leaks; the team can't change its own internals without breaking callers.

The output of this analysis isn't "team X is bad." It's a small set of candidate moves: *give this cluster to one team; turn this rich cross-team interface into a versioned contract; consolidate this leaky boundary.* You are using the metric to reduce the number and richness of edges that cross org lines — which is the same thing as reducing how often two teams must talk to ship.

> **The principle:** the dependency graph and the org chart are two drawings of the same system. When they disagree, you pay for it in coordination — in meetings, in blocked releases, in "we can't ship until their team merges." Coupling metrics, *grouped by owner*, are how you find the disagreements. The cheap coupling to ignore is inside a team; the expensive coupling to attack is the kind that crosses a team line.

---

## Coupling Metrics and Where to Cut a Seam

The modular-monolith and microservices conversations are, underneath the buzzwords, conversations about **seams** — places where the dependency graph is naturally thin enough to cut. Coupling metrics are the instrument that tells you *where the thin places are*, which is the difference between extracting a service along a real boundary and tearing a hole through a tightly-coupled core.

**Afferent coupling is the blast radius of a change.** A module's Ca is the count of things that depend on it. When you change that module's behavior or interface, those are the things that can break. Read at the level of a *candidate service*, Ca answers the most important pre-extraction question: *if I pull this out and put a network boundary in front of it, how many callers does that boundary now sit between, and how many of them will I have to coordinate with on every change?* A candidate with low, stable afferent coupling — few callers, through a narrow interface — is a clean seam. A candidate with sprawling afferent coupling reaching into its internals is not a seam; it's load-bearing, and putting a network call in the middle of it converts in-process method calls into a distributed-systems problem without giving you the independence you extracted it for.

This is why "should this be a service?" is partly a coupling question:

| Signal from the graph | Reading |
|---|---|
| Low efferent coupling (depends on few things) | The module is self-contained; it won't drag half the system across the boundary with it. |
| Afferent coupling concentrated through a **narrow, stable interface** | A clean seam — callers depend on a contract, not on internals. |
| Afferent coupling reaching into many **internal** symbols | Not a seam — extraction would expose internals as an API or break callers. |
| Part of a dependency **cycle** with a neighbor | Cannot be independently deployed at all until the cycle is broken first. |
| Instability `I` near 1 (very dependent) but high Ca | The zone-of-pain inverse: many things lean on something that itself leans on everything — fragile to move. |

The **modular monolith** is the pragmatic middle that this analysis usually recommends: enforce the *boundaries* with the dependency gates from the previous section (modules may only talk through their public packages, no cycles, layering respected) so you get the independence and clear ownership of services, *without* paying the distributed-systems tax until a module's coupling profile and scaling needs actually justify a network boundary. You let the coupling metrics tell you when a module has earned its way out: persistently thin afferent coupling through a stable contract, independent scaling pressure, a team that owns it end-to-end. Microservices extracted along seams the graph identified are sustainable; microservices drawn on a whiteboard against the grain of the dependency graph become a distributed monolith — all the network latency, none of the independence — which is the worst of both.

> **The hard-won lesson:** you don't decide service boundaries and then discover the coupling. You read the coupling and then decide the boundaries. Afferent coupling is the single most useful number here because it *is* the blast radius — extract along low, narrow, stable Ca, and never put a network call in the middle of a cycle or a rich internal dependency.

---

## Detecting and Sequencing the Worst Structural Debt

At org scale a coupling report surfaces dozens of problems, and the failure mode is treating them as a flat to-do list. The professional skill is **triage**: identifying the few structural problems that cause disproportionate damage and sequencing their removal so each fix unblocks the next. Three patterns dominate the "fix first" list.

**1. Cycles.** A dependency cycle is the highest-priority structural debt because it poisons everything downstream: nothing in the cycle can be tested, built, reasoned about, or deployed in isolation, and the cycle tends to *grow* (once A↔B exists, adding A→C and B→C feels free). Find them with the same tools you gate on (`depcruise --output-type dot` then look for back-edges; ArchUnit `beFreeOfCycles`; `madge --circular`; `go list` + a cycle check; language-specific graph tools). Sequence cycle removal *before* anything else, because many other refactors are blocked until the cycle is gone — you cannot independently deploy or test either participant while they're fused.

**2. God modules.** A module with enormous afferent coupling — half the system depends on it — is a god module: a single change to it risks a system-wide blast radius, and its Ca makes it nearly impossible to modify safely. These rank by *Ca × change-frequency*: a high-Ca module that never changes is tolerable (stable foundation); a high-Ca module that changes constantly is a recurring system-wide hazard. Marrying coupling with churn here is the high-signal move, and it's why [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/professional.md) is the natural partner of this topic: *coupling tells you the blast radius, churn tells you how often the bomb goes off.* The intersection — high coupling **and** high churn — is your prioritized list.

**3. The zone of pain.** From Martin's main sequence: modules that are simultaneously **concrete** (low abstractness `A`) and **heavily depended upon** (low instability `I`, i.e. high Ca) sit in the *zone of pain* — rigid, hard to change, yet many things lean on them, so every forced change ripples. Distance from the main sequence, `D = |A + I − 1|`, ranks how far a package has drifted into either the zone of pain (`A≈0, I≈0`) or the useless zone (`A≈1, I≈1`). Use `D` as a *sorting key for investigation*, never as a grade.

The sequencing logic that ties these together: **break cycles first** (they block other work and corrupt the graph), **then attack the high-Ca × high-churn god modules** (biggest recurring blast radius), **then address zone-of-pain packages by descending `D`** (rigidity under load). Each step is justified to stakeholders not as "the number is bad" but as "this is what's blocking independent deploys / causing the recurring incident / forcing every team to coordinate." That framing — and the prioritization mechanics — belong to [Technical Debt Management](../../technical-debt-management/); coupling metrics are the *evidence* that feeds it.

> **The triage discipline:** never present a flat list of forty coupling violations. Present three: the cycle blocking deploy independence, the high-coupling high-churn module behind the recurring incident, and the worst zone-of-pain package under active change. Sequence so each fix unblocks the next. A ranked, justified short list gets funded; a coupling report gets archived.

---

## Temporal Coupling Across Services

Static coupling — imports, calls, references — is only half the graph. The other half is **temporal coupling** (a.k.a. change coupling): files, modules, or *services* that consistently change together even when no static dependency connects them. You mine it from version control: if `service-orders` and `service-billing` are modified in the same commit or the same PR 70% of the time, they are coupled in practice no matter what the architecture diagram claims.

This matters most in **distributed systems**, where it's the silent killer of the independence microservices were supposed to buy. The whole promise of services is independent deployability; temporal coupling is the measurement that tells you whether you actually have it. If shipping a feature routinely requires a coordinated change across three services — a new field added to the producer, the contract, and every consumer in lockstep — you have a *distributed monolith*: the network boundaries are real but the change-independence is fictional, so you pay the latency and operational cost of services while still coordinating releases like a monolith.

Temporal coupling across services usually traces to one of a few causes, each with a different fix:

- **A shared schema or contract that isn't versioned** → every consumer must change when the producer does. Fix with backward-compatible, versioned contracts (tolerant readers, additive-only schema changes) so the producer can ship without lockstep consumer updates.
- **A leaked internal model** → the service exposed its internals as its API, so callers couple to its implementation. Fix by narrowing the published contract.
- **A genuine business invariant spanning services** → the split is in the wrong place; these two services change together because they're really one bounded context. The temporal coupling is telling you the seam was cut wrong — and the static-coupling seam analysis from earlier in this page is how you'd reconsider it.

Detecting it is the same version-control mining used for in-repo hotspots, lifted to the service/repo level: compute the co-change frequency of services across the commit history (CodeScene does this across repositories; a simple script over `git log` does it for one). High inter-service co-change is the metric that earns the most respect in a distributed-systems review, because it measures the thing teams actually care about — *can we deploy independently?* — rather than a diagram's good intentions.

> **The distributed-systems reality:** static coupling tells you what *can* reach what; temporal coupling tells you what *actually changes together*. In microservices the second number is the one that decides whether you have independent deployability or a distributed monolith. Two services that always ship together are one service with extra network calls — and no architecture diagram will admit that, but the commit history will.

---

## The Limits and the Gaming

Every metric on this page is easy to compute and easy to misread, and at org scale the misreadings get expensive because someone wires them to incentives. The professional obligation is to use them as diagnostics and refuse to let them become targets — *Goodhart's law* ("when a measure becomes a target, it ceases to be a good measure") is not a cute aphorism here; it's the specific way these numbers get destroyed.

**Instability and abstractness are arithmetic, not judgment.** `I = Ce / (Ca + Ce)` and `A = abstract types / total types` are trivially computed and trivially gamed. A package can score a "perfect" distance-from-main-sequence `D ≈ 0` and still be terrible code — the main sequence says nothing about whether the abstractions are *the right ones*, only about the ratio of abstract to concrete types. A team told to "reduce instability" can add pointless interfaces to inflate `A`, or merge unrelated modules to change `Ca`/`Ce`, improving the number while making the design worse. The metric measures a real property; it does not measure design quality, and the gap between those is where gaming lives.

**Never rank teams by LCOM (or by any of these).** This is the single most damaging move available. LCOM (lack of cohesion of methods) has *multiple incompatible definitions* (LCOM1 through the Henderson-Sellers LCOM4, plus Hitz–Montazeri), each producing different numbers, several with known pathologies — a class with a single method, or with a constructor that touches every field, scores misleadingly. The instant LCOM becomes a number on a team scorecard, engineers optimize the formula (split cohesive classes to dodge a threshold, add field-touching methods to fool a definition) rather than improving cohesion. You will have made the code worse *and* taught people that the metric is a weapon, which poisons every future use of it. **These numbers point at code to go look at; they never grade the humans who wrote it.**

The honest posture for all of them:

- **Trends over absolutes.** "Instability of this package rose over the last quarter" is a signal worth investigating; "this package's instability is 0.7" is a number without a verdict. Watch direction, not the snapshot.
- **Thresholds trigger a human look, not a gate fail.** Use a high `D` or a high LCOM to *route attention*, not to block a merge. The two things worth *gating* are the unambiguous structural facts — cycles and layering violations — not the judgment-laden ratios.
- **No single metric, ever.** Coupling × churn × ownership together tell a story; any one alone is gameable and misleading. The intersection is robust precisely because gaming all three at once means actually fixing the design.

> **The anti-gaming rule:** put cycles and layering in the gate (objective, hard to game, high value); keep instability, abstractness, and especially LCOM as *investigation routers* read as trends, never as grades and never on a per-team scoreboard. The moment any of these becomes a target someone is rewarded for hitting, it stops measuring what you wanted and starts measuring how clever people are at beating formulas.

---

## War Stories

**The cycle that blocked independent deploys.** Two services, `orders` and `inventory`, were split for independent deployability — but `orders` called an `inventory` endpoint synchronously *and* `inventory` called back into `orders` to confirm reservations. A change to either's contract required deploying both in lockstep; a rollback of one forced a rollback of the other. The architecture diagram showed two boxes; the deploy pipeline showed one. The fix was to break the cycle by inverting the back-edge — `inventory` emitted a reservation event that `orders` consumed asynchronously, instead of calling back — and only then could each service deploy on its own cadence. The cycle, not the network, was what fused them; the static-coupling analysis named it and the temporal-coupling data (they shipped together 90% of the time) proved it.

**The coupling metric that revealed a team-boundary mismatch.** A platform team owned a "shared utilities" package with enormous afferent coupling — nearly every feature team imported it — but treated it as a low-priority side project. Cross-team change-coupling analysis showed that 40% of feature teams' PRs touched this package, meaning feature teams were constantly making changes to code another team nominally owned, and routinely blocked waiting for review from a team that wasn't staffed for it. The metric didn't say "the platform team is bad"; it said *the ownership boundary and the dependency boundary disagree*. The resolution split the package: the genuinely stable primitives stayed with the platform team behind a frozen interface, and the volatile pieces feature teams kept changing were moved into the feature domains that actually owned that logic. Cross-team coupling on that edge dropped, and the blocked-on-review waits disappeared.

**The ArchUnit rule that held the line.** A team adopting a domain/persistence layering wrote one `layeredArchitecture` rule asserting the domain may never import persistence, froze it to a baseline of three known violations, and made it a required PR check. Over the next year, the rule rejected dozens of PRs that tried to import a repository directly into a domain entity "just this once" for a deadline — each rejection a five-minute conversation and a small redesign instead of another erosion of the boundary. Two years later the domain was still cleanly isolated and trivially unit-testable without a database, and the baseline had been burned to zero. No heroics, no big refactor — just a rule in CI that made the wrong thing impossible to merge, which is the only thing that reliably holds an architectural boundary against deadline pressure.

---

## Decision Frameworks

**Should I gate on this metric in CI? Ask:**
- Is it an *objective structural fact* (a cycle exists; a layer was crossed)? → **gate on it.** These are unambiguous and high-value.
- Is it a *judgment-laden ratio* (instability, abstractness, LCOM, `D`)? → **don't gate; route to human review** as a trend. Gating it invites gaming.
- Does the codebase pass it today? → if no, **freeze a baseline** and gate on "no worse than today," burning the baseline down. Never turn on a red gate no one can fix in one PR.

**Should this become a separate service? Ask (coupling lens):**
- Is its afferent coupling low and through a *narrow, stable interface*? → clean seam; extractable.
- Does its afferent coupling reach into *internals*? → not a seam; extraction exposes internals as an API. Stay a module.
- Is it in a *cycle* with a neighbor? → break the cycle first; you can't independently deploy a cycle.
- Has it earned it — independent scaling pressure, end-to-end team ownership? → if no, keep it a module in the monolith and let coupling tell you when it's ready.

**Which structural debt do I fix first? Sequence:**
1. **Cycles** — they block other work and corrupt the graph.
2. **High Ca × high churn (god modules)** — biggest recurring blast radius.
3. **Zone-of-pain packages by descending `D`** — rigid and heavily depended on, under active change.

**Are my services actually independent? Ask:**
- Do two services co-change in the same PR most of the time (temporal coupling)? → you have a distributed monolith; find the shared/unversioned contract or the mis-cut seam.

**Should I rank teams by a cohesion/coupling metric? Ask:**
- ...no. Use the numbers to find code to look at, never to grade people. The instant it's a scoreboard, it's gamed.

---

## Mental Models

- **A gate beats a dashboard.** A rule that *rejects the PR* shapes the architecture; a report that *describes* the regression after it merges shapes nothing. The value of a coupling rule is the merge it blocks, not the chart it draws.

- **Coupling inside a team is cheap; coupling that crosses a team line is expensive.** Same edge in the graph, wildly different cost — decided by who owns the nodes. Conway's law means the org chart and the dependency graph are two drawings of one system; attack the edges where they disagree.

- **Afferent coupling is the blast radius.** Ca is literally how many callers a change can break. Read it before drawing a service boundary: extract along low, narrow, stable Ca; never put a network call in the middle of a cycle or a rich internal dependency.

- **Static coupling is what *can* reach what; temporal coupling is what *actually changes together*.** In distributed systems the second number decides whether you have independent deployability or a distributed monolith. The commit history tells the truth the architecture diagram won't.

- **Cycles first, then high-coupling-high-churn, then zone of pain.** Triage structural debt so each fix unblocks the next. A ranked, justified short list gets funded; a flat report of forty violations gets archived.

- **These metrics point at code, never at people.** Diagnostics that route attention. The moment one becomes a per-team target, Goodhart's law converts it from a measurement into a thing people are clever at beating.

---

## Common Mistakes

1. **Turning on a hard gate over a legacy codebase.** `no-circular: error` on a repo with eighty cycles is a red build no one can fix in one PR, so it gets disabled and the org learns the gate is a nuisance. **Freeze a baseline** (`FreezingArchRule`, `depcruise` baseline) and gate on "no new violations."

2. **Gating on judgment-laden ratios.** Putting an instability or LCOM threshold in CI invites gaming — pointless interfaces to inflate abstractness, merged modules to shift `Ca`/`Ce`. Gate only the objective facts (cycles, layering); route the ratios to human review as trends.

3. **Ranking teams by LCOM (or any of these).** LCOM has multiple incompatible definitions and known pathologies; the moment it's a scoreboard, people optimize the formula and make the code worse. These numbers find code to look at; they never grade humans.

4. **Drawing service boundaries before reading the coupling.** Deciding the microservices on a whiteboard and discovering the coupling later produces a distributed monolith — network latency without independence. Read afferent coupling first; cut along the thin, stable seams.

5. **Ignoring temporal coupling because the static graph looks clean.** Two services with no static dependency can still ship together every time (shared unversioned contract, mis-cut seam). The commit history reveals the distributed monolith the import graph hides.

6. **Treating a coupling report as a flat to-do list.** Forty violations presented equally get archived. Triage to three — the cycle blocking deploys, the high-Ca high-churn module behind the recurring incident, the worst zone-of-pain package — and sequence them.

7. **Reading the org chart and the architecture as unrelated.** When two teams keep blocking each other, the cause is almost always cross-team coupling in the graph. Overlay ownership on the dependency graph and you'll see exactly which edge to fix.

---

## Test Yourself

1. You want to stop new dependency cycles from landing, but the codebase already has dozens. What's the adoption strategy, and what's the specific mechanism in ArchUnit or dependency-cruiser?
2. Two teams constantly block each other's releases. How would you use coupling metrics — and crucially, *grouped by what* — to diagnose whether the team boundary or the interface is the problem?
3. You're evaluating whether a module should become a microservice. Which coupling metric is the blast radius of a change, and what shape of that metric signals a clean seam versus a non-seam?
4. Why are cycles the first structural debt to remove, ahead of god modules and zone-of-pain packages? What unblocks once a cycle is gone?
5. Your microservices have a clean static dependency graph, but every feature still requires deploying three of them together. What metric explains this, where does it come from, and what does it mean you actually have?
6. Why should you gate CI on cycles and layering violations but *not* on instability or LCOM thresholds? Frame it in terms of Goodhart's law.
7. A manager proposes ranking teams quarterly by the average LCOM of the code they own. Give two concrete reasons this backfires.

<details>
<summary>Answers</summary>

1. **Ratchet to a baseline.** Don't turn on a hard error over existing debt — snapshot current violations and gate only on *new* ones beyond the snapshot, then burn it down. Mechanism: ArchUnit's `FreezingArchRule` (records known violations to a store, fails only on new ones); dependency-cruiser's `--output-type baseline` plus a known-violations file. The rule becomes "no worse than today," which is adoptable; "perfect now" is always declined.
2. Compute coupling/change-coupling **grouped by team/owner**, not by package — overlay ownership on the dependency graph and find the edges where dependencies cross team lines. High cross-team coupling on an edge means either the *boundary* is wrong (the two modules change together and should be one team's) or the *interface* is too rich (make it a narrow, versioned contract). Coupling inside one team is cheap; coupling across teams is the expensive coordination tax.
3. **Afferent coupling (Ca)** is the blast radius — the number of callers a change can break. A **clean seam** has low, stable Ca concentrated through a *narrow public interface*; a **non-seam** has Ca reaching into many *internal* symbols (extraction would expose internals as an API or break callers) or participates in a cycle (can't be independently deployed at all).
4. A cycle means neither participant can be tested, built, reasoned about, or deployed in isolation — they're one unit pretending to be two — and cycles tend to grow. Removing it **unblocks independent deployment and testing of both participants**, which many subsequent refactors depend on. God modules and zone-of-pain packages are painful but don't fuse two things together the way a cycle does.
5. **Temporal (change) coupling** — mined from version control as the co-change frequency of services across commit/PR history. A clean static graph with high inter-service co-change means you have a **distributed monolith**: real network boundaries but fictional change-independence, usually caused by a shared unversioned contract, a leaked internal model, or a seam cut through a real business invariant.
6. Cycles and layering violations are **objective structural facts** — unambiguous, high-value, hard to game. Instability and LCOM are **judgment-laden ratios** that are trivially gamed (add interfaces to inflate abstractness; split classes or add field-touching methods to dodge an LCOM threshold). By **Goodhart's law**, the moment a ratio becomes a gated target, people optimize the formula rather than the design, so it stops measuring quality. Gate the facts; route the ratios to human review as trends.
7. (a) LCOM has **multiple incompatible definitions** (LCOM1–4, Henderson-Sellers, Hitz–Montazeri) with known pathologies (single-method classes, constructors touching all fields), so the "average LCOM" is a meaningless aggregate that doesn't reliably track cohesion. (b) Making it a **scoreboard triggers Goodhart's law** — engineers split cohesive classes or game the field-access pattern to beat the number, making the code *worse* while the metric improves, and poisoning trust in the metric for any honest future use.

</details>

---

## Cheat Sheet

```
GATE ON THESE (objective, hard to game, high value)
  cycles            ArchUnit slices()...beFreeOfCycles()
                    depcruise rule { to: { circular: true } }  / madge --circular
  layering          ArchUnit layeredArchitecture()...mayOnlyBeAccessedByLayers(...)
                    depcruise from: domain  to: web|infra  severity: error
  ADOPT ON LEGACY   freeze a baseline (FreezingArchRule / depcruise baseline),
                    gate on "no new violations," burn it down

DO NOT GATE (judgment-laden, gameable) — route to human review as TRENDS
  instability  I = Ce / (Ca + Ce)
  abstractness A = abstract types / total types
  distance     D = |A + I - 1|        sorting key for investigation, never a grade
  LCOM         multiple defns, pathologies — NEVER rank teams by it

AFFERENT COUPLING (Ca) = BLAST RADIUS
  low + narrow + stable interface  → clean seam, extractable as a service
  reaches into internals           → not a seam; stay a module
  in a cycle                       → can't deploy independently; break cycle first

TEAM BOUNDARIES (Conway)
  group coupling BY OWNER, overlay on the dep graph
  coupling inside a team   = cheap
  coupling across teams    = expensive (coordination tax) → attack these edges

STRUCTURAL-DEBT SEQUENCE
  1. cycles                         (block other work; corrupt the graph)
  2. high Ca x high churn           (god modules; biggest recurring blast radius)
  3. zone of pain by descending D   (rigid + heavily depended on, under change)

DISTRIBUTED SYSTEMS
  static coupling   = what CAN reach what
  temporal coupling = what ACTUALLY changes together (mine git log)
  services that always ship together = distributed monolith
```

---

## Summary

- **Move from measuring to governing.** A coupling report you read quarterly changes nothing; a **fitness function** in CI that fails the build on a new cycle or a layering violation changes the architecture, because it catches the regression in the PR — the cheapest possible moment. ArchUnit (JVM), dependency-cruiser (JS/TS), import-linter (Python) and friends make the rules live in version control and run on every merge. This is the most concrete thing this roadmap hands [Quality Gates](../../quality-gates/) and the automated form of [debt prevention](../../technical-debt-management/06-preventing-accumulation/).
- **Gate the facts, not the judgments.** Cycles and layering are objective and hard to game — gate them (frozen to a baseline so legacy code can adopt). Instability, abstractness, and LCOM are judgment-laden ratios — route them to human review as *trends*, never as gates, and **never rank teams by them**: the instant a metric is a scoreboard, Goodhart's law turns it from a measurement into a thing people beat.
- **Read coupling against the org chart.** Conway's law means the dependency graph and the org chart are two drawings of one system. **Coupling inside a team is cheap; coupling that crosses a team line is expensive** — group coupling by owner, overlay it on the graph, and attack the edges where ownership and dependency disagree.
- **Afferent coupling is the blast radius — read it before cutting a seam.** Extract services along low, narrow, *stable* Ca; never put a network boundary in the middle of a cycle or a rich internal dependency. The modular monolith is the default; let coupling tell you when a module has earned a network boundary, lest you build a distributed monolith.
- **Triage structural debt; don't list it.** Break **cycles first** (they fuse units and block independent deploys), then attack **high-Ca × high-churn god modules** (the [churn](../04-code-churn-and-hotspots/professional.md) intersection — biggest recurring blast radius), then **zone-of-pain packages by descending `D`**. A ranked, justified short list gets funded.
- **In distributed systems, temporal coupling is the real test.** Static coupling says what *can* reach what; **temporal (change) coupling**, mined from commit history, says what *actually ships together* — and that's what decides whether you have independent deployability or a distributed monolith.

You can now operate coupling and cohesion metrics as an org-scale governance tool: gating structure in CI, informing where teams and services should split, and sequencing the structural debt that matters. The remaining tier — [interview.md](interview.md) — consolidates the whole topic into the questions that probe whether someone genuinely understands it. For the dashboards that surface these signals as trends, see [06 — Code Health Dashboards](../06-code-health-dashboards/professional.md).

---

## Further Reading

- Robert C. Martin, *Clean Architecture* — the package coupling/cohesion metrics, instability, abstractness, and the main sequence, with the dependency-rule reasoning that the gates enforce.
- Adam Tornhill, *Software Design X-Rays* — change coupling, inter-team coupling, and behavioral hotspots; the operational source for the ownership-overlay and temporal-coupling analyses on this page.
- [ArchUnit](https://www.archunit.org/) and its user guide — slices, layered-architecture rules, `FreezingArchRule` for baselining onto legacy code.
- [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) — forbidden-dependency rules, circular-dependency detection, and baseline support for JS/TS.
- Neal Ford, Rebecca Parsons, Patrick Kua, *Building Evolutionary Architectures* — fitness functions as the general technique for governing architectural characteristics in CI.
- Mel Conway, "How Do Committees Invent?" (1968) and Manny Lehman's laws of software evolution — the original Conway's law and the dynamics behind growing structural debt.
- Chidamber & Kemerer (1994) and Brian Henderson-Sellers' *Object-Oriented Metrics: Measures of Complexity* — the CK suite and the competing LCOM definitions (and why they disagree).

---

## Related Topics

- [junior.md](junior.md) · [senior.md](senior.md) · [interview.md](interview.md) — the rest of this topic's tier set.
- [04 — Code Churn & Hotspots](../04-code-churn-and-hotspots/professional.md) — churn × coupling is the high-signal intersection for prioritizing god modules and structural debt.
- [06 — Code Health Dashboards](../06-code-health-dashboards/professional.md) — surfacing coupling and cohesion as trends (not grades) across an org.
- [Technical Debt Management](../../technical-debt-management/) — prioritizing, justifying, and sequencing the structural debt these metrics reveal; [preventing accumulation](../../technical-debt-management/06-preventing-accumulation/) is the home of the "stop it in CI" idea.
- [Quality Gates](../../quality-gates/) — the discipline of CI checks that fitness functions for cycles and layering plug directly into.
