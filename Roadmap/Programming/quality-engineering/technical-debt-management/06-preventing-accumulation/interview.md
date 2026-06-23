# Preventing Accumulation — Interview Questions

> **Roadmap:** [Technical Debt Management](../README.md) → Preventing Accumulation
> *A debt-prevention interview rarely asks "what is technical debt." It asks "your team ships fast and the codebase is rotting — what do you actually change on Monday?" and then watches whether you reach for a CI gate, an architecture fitness function, or a conversation with the people who set the incentives. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Everyday Prevention](#theme-1--everyday-prevention)
3. [Theme 2 — Automated Gates](#theme-2--automated-gates)
4. [Theme 3 — Preventing Architectural Debt](#theme-3--preventing-architectural-debt)
5. [Theme 4 — Decision and Knowledge Debt](#theme-4--decision-and-knowledge-debt)
6. [Theme 5 — Culture and Incentives](#theme-5--culture-and-incentives)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — The Limits of Automation](#theme-7--the-limits-of-automation)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **prevention vs paydown** (stopping new debt vs removing old debt — different budgets, different owners)
- **mechanism vs culture** (a CI gate vs the incentive that makes people want to pass it honestly)
- **flow vs stock** (the rate debt enters per change vs the total debt already sitting in the repo)
- **gate the new vs boil the ocean** (hold a line on changed code vs try to fix everything at once)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a tool — and who never claim a linter alone will save a codebase.

---

## Theme 1 — Everyday Prevention

### Q1.1 — Prevention is cheaper than paydown. Where does most debt actually enter a codebase, and what does that imply about where to spend prevention effort?

> **Testing:** Whether you see debt as a *flow* problem entering through daily work, not a *stock* problem you periodically clean up.

**A.** Most debt enters not through dramatic bad decisions but through the **steady drip of ordinary changes** — a feature merged with no test, a TODO that becomes load-bearing, a copy-paste that should have been an extraction, an "I'll clean this up later" that never gets a later. Debt is a *flow*, and the flow is the daily pull request. That implies the highest-leverage prevention isn't a quarterly cleanup sprint (that's paydown); it's tightening the **per-change discipline** so each PR adds slightly less debt than it would have. Concretely: a real Definition of Done, the boy-scout rule ("leave the code cleaner than you found it"), tests written *with* the code, and small reviewable PRs. The framing that matters: you can't out-pay-down a high debt-inflow rate, the same way you can't out-earn lifestyle inflation. Fix the inflow first.

### Q1.2 — What belongs in a Definition of Done if its job is to prevent debt, and what makes a DoD a fake?

> **Testing:** Whether you treat DoD as an enforceable contract or as decoration.

**A.** A debt-preventing DoD makes the *invisible* work non-optional, because the invisible work is exactly what gets dropped under deadline pressure: tests for the new behavior, updated docs/ADR if a decision changed, no new linter or complexity violations, error paths handled (not just the happy path), and observability for anything operational. The point is to move "done" from "it works on my machine" to "it's safe for the next person to build on." A DoD is **fake** when it's a wiki page nobody enforces — if "has tests" is in the DoD but a PR with zero tests still merges, the DoD is theater and everyone learns it. The real DoD is whatever the merge gate *actually* blocks on, which is why a serious DoD is largely encoded into CI (Theme 2). A DoD that lives only in human goodwill degrades the first time goodwill collides with a deadline.

### Q1.3 — Explain the boy-scout rule. What's its failure mode, and how do you keep it from becoming a problem?

> **Testing:** Whether you understand opportunistic refactoring *and* its risks — scope creep and review noise.

**A.** The boy-scout rule is: when you touch a file, leave it a little better than you found it — rename one bad variable, extract one tangled function, delete one dead branch. It works because it spreads paydown across normal work at zero ceremony and attacks debt exactly where activity is highest. Its failure mode is **unbounded scope**: a one-line bug fix balloons into a 600-line "while I was in here" refactor that mixes behavior changes with cleanup, becomes unreviewable, and risks regressions. The discipline that keeps it healthy: keep cleanups *small and local*, and **separate refactoring commits from behavior-change commits** so a reviewer can see "this commit changes nothing, this one changes behavior." Tidy First's separation of structural and behavioral change is exactly this rule made reviewable. Unbounded boy-scouting is itself a way to *create* risk while feeling virtuous.

### Q1.4 — Why are small PRs a debt-prevention mechanism and not just a review-speed nicety?

> **Testing:** Whether you connect PR size to review quality, which is where design debt is actually caught.

**A.** Review quality collapses as diff size grows — past a few hundred lines, reviewers skim and rubber-stamp, and "LGTM" stops meaning "I understood this." Since code review is the **last cheap checkpoint** where a human can catch a bad abstraction, a leaky boundary, or a missing test *before* it's merged and built upon, a large PR isn't just slow to review — it's a PR whose design problems sail through unexamined and become tomorrow's debt. Small PRs keep each change inside the window where a reviewer can actually reason about it, which is when prevention happens. They also shrink blast radius and make reverts surgical. So "keep PRs small" is really "keep changes inside the size where human review still functions as a quality gate" — anything larger silently downgrades review from inspection to approval.

### Q1.5 — "Write the test as you go" — why is test-as-you-go prevention, while "we'll add tests later" is debt by definition?

> **Testing:** Whether you understand that deferred tests are a debt that compounds and rarely gets paid.

**A.** Tests written *with* the code are cheap: the author has the full context in their head, the design is still malleable, and writing the test often *exposes* a bad interface before it ossifies (testability pressure improves design). "Add tests later" is a deferral, and like all deferred work it accrues interest — the context evaporates, the code becomes harder to test because it wasn't designed for it, and "later" competes with the next deadline and loses. Worse, untested code keeps being built upon, so the cost of retrofitting tests grows with every dependent change. That's the literal definition of a debt: borrow time now, pay interest later, and the principal is rarely repaid. TDD is the strongest form (the test can't be skipped because it comes first), but even test-after-within-the-same-PR beats "later," because "later" almost always means "never."

---

## Theme 2 — Automated Gates

### Q2.1 — Manual discipline decays. What's the role of automated CI gates in debt prevention, and what should and shouldn't be a gate?

> **Testing:** Whether you understand that prevention has to be *mechanized* to survive deadline pressure and turnover.

**A.** Manual discipline is real but it's the first thing to go under pressure and it leaves with the person who held the standard. **CI gates make the standard a property of the system, not of anyone's willpower** — they apply uniformly, can't be quietly skipped, and turn "please remember to" into "the merge button is red." Good gates are *objective and fast*: linting/formatting (auto-fixable, zero debate), cyclomatic complexity ceilings on new functions, a coverage *ratchet* (Q2.2), duplication thresholds, dependency/vulnerability and license scanning, and basic static analysis. What should *not* be a hard gate is anything subjective or noisy — "is this a good abstraction," "is this name clear" — because those produce false positives that train people to ignore the gate, and they belong in human review. The line: **gate what a machine can judge reliably; review what requires taste.** A gate that's frequently wrong gets bypassed, and a bypassed gate is worse than none because it manufactures false confidence.

### Q2.2 — Explain a coverage ratchet. Why is "must hit 80% coverage" usually the wrong gate?

> **Testing:** The single most important nuance in automated debt gates — direction over absolute level.

**A.** A flat "80% line coverage" threshold is the wrong gate for two reasons: on a legacy repo at 30% it's unreachable and gets disabled; and it's a number you can game with assertion-free tests that execute code without checking anything. A **coverage ratchet** gates the *direction* instead of the *level*: coverage may not *decrease*. Whatever today's number is becomes the new floor, so every PR must at least not make things worse, and the percentage climbs monotonically as the codebase changes. Even better is **patch/diff coverage** — "new and modified lines must be covered at ≥ X%" — which holds new code to a high bar without demanding you retrofit the legacy ocean. This is the **clean-as-you-code** principle (Q2.3): you stop the bleeding on new code first, and the old code improves only as it's touched. Ratchets and diff coverage are why a 30% repo can adopt a strict gate *today* without a six-month backfill project.

### Q2.3 — What is "clean as you code" / "gate new code only," and why is it more effective than enforcing standards on the whole repo at once?

> **Testing:** The core strategy for adopting gates on an existing imperfect codebase — flow vs stock again.

**A.** Clean-as-you-code (SonarQube's term; the same idea as diff/patch gates) means the quality gate applies **only to code added or changed in this PR**, not to the entire existing codebase. New code must be clean — covered, lint-clean, under complexity limits, no new duplication — while the legacy backlog is left alone until someone touches it. It's more effective than a repo-wide gate for three reasons: (1) it's *adoptable immediately* on any codebase regardless of current state, with no backfill blocker; (2) it focuses effort where it's cheapest — fixing code while you're already in it and have context — rather than on dormant code nobody is reading; and (3) it makes the gate *always green-able*, so people don't learn to bypass it. The mechanism is the flow/stock distinction operationalized: stop the **inflow** of new debt unconditionally, and let the **stock** of old debt drain through the boy-scout rule and targeted paydown. Trying to make the whole repo pass at once is the boil-the-ocean trap — it stalls, gets disabled, and teaches the team the gate is negotiable.

### Q2.4 — Which automated checks actually prevent debt versus just generate noise? How do you keep a gate from being ignored?

> **Testing:** Whether you've operated gates in practice and understand signal-to-noise as the thing that determines whether a gate survives.

**A.** Checks that genuinely prevent debt share two traits: **high precision** (when they fail, something is really wrong) and **a clear, often automatic fix**. Strong examples: formatters and most linters (auto-fixable, near-zero false positives), complexity ceilings on new functions, diff coverage, duplication detection, and dependency CVE/license scanning. Weak or noisy gates: broad style rules that fight the formatter, "code smell" detectors with high false-positive rates, and absolute coverage numbers. The way you keep a gate respected is to **protect its signal-to-noise ratio ruthlessly**: tune or remove any rule that's frequently wrong, make violations *blocking but trivially fixable*, fail fast (seconds, not the end of a 40-minute pipeline), and give a clear message plus the fix command. The moment a gate is wrong often enough that people reach for the bypass, it's dead — and a bypassed gate is worse than no gate because it produces false confidence and trains the muscle of overriding red builds. A respected gate is one people *trust*, not just one that's *strict*.

### Q2.5 — Can you "lint your way" to a clean codebase? Where do automated gates stop being useful?

> **Testing:** A preview of Theme 7 — whether you over-trust automation. (Deliberately planted here to see if you self-limit.)

**A.** No — and recognizing the ceiling is itself a senior signal. Automated gates catch what's *mechanically detectable*: formatting, complexity numbers, uncovered lines, duplication, known-vulnerable dependencies. They are blind to the debt that actually sinks codebases: the **wrong abstraction**, a leaky module boundary, a domain model that doesn't match the domain, a god class that's individually within every metric, premature or missing generalization. A function can have low cyclomatic complexity, full coverage, and zero lint warnings and still be a terrible design — metrics measure local syntax, not global structure or fitness for purpose. So gates are *necessary and high-leverage for the floor* — they stop the obvious bleed and free human attention — but they are not *sufficient*. Above the floor, prevention needs architecture fitness functions (Theme 3) for structural rules and human review/design discussion for taste. The mature stance: automate the objective floor so humans can spend their scarce judgment on the things only judgment can catch.

---

## Theme 3 — Preventing Architectural Debt

### Q3.1 — Linters catch line-level issues. How do you prevent *architectural* debt — the kind that's invisible in any single file?

> **Testing:** Whether you know that structural debt needs structural, automated enforcement — fitness functions — not just code review hope.

**A.** Architectural debt — a UI layer reaching straight into the database, a "core" module that quietly depends on a feature module, a cyclic dependency between packages — is invisible at the file level and *erodes gradually*, one "just this once" import at a time, until the architecture diagram is fiction. Hope-and-review doesn't hold the line because no reviewer sees the whole graph on a small PR. The mechanism is the **architecture fitness function**: an automated, executable test of an architectural characteristic, run in CI like any other test. The most common kind is a **dependency rule** — "nothing in `domain` may import `infrastructure`," "no package may have a cyclic dependency" — encoded with a tool like ArchUnit (JVM), Deptrac/PHPArch, ESLint boundaries, `go-arch-lint`, or import-linter (Python). Now an illegal dependency *fails the build* the moment it's introduced, while it's one line to fix, instead of being discovered two years later as an untanglable knot. The principle: make the architecture **executable** so drift is caught at commit time, not at archaeology time.

### Q3.2 — What is evolutionary architecture, and how do fitness functions let an architecture change safely instead of decaying?

> **Testing:** Whether you understand fitness functions as enabling change, not freezing it — the Ford/Parsons/Kua framing.

**A.** Evolutionary architecture (Ford, Parsons, Kua) is the idea that you can't design the perfect architecture up front, so you should design one that can *change safely* as requirements and load evolve — supporting "guided, incremental change across multiple dimensions." The thing that makes change *safe* rather than reckless is the **fitness function**: an objective measure of how well the architecture exhibits a required characteristic (allowed dependencies, layering, max coupling, latency budget, security constraints). Fitness functions act like tests for architecture — they let you refactor structure boldly because any change that violates a protected characteristic fails immediately. Without them, every architectural change is a leap of faith and the architecture decays toward a big ball of mud by default; *with* them, the architecture can evolve continuously while its essential properties are *protected by automation*. The mental model: fitness functions are to architecture what unit tests are to code — they don't prevent change, they make change *safe*, which is the only way an architecture survives years of churn.

### Q3.3 — What is architectural drift / conformance, and how do you detect when reality has diverged from the intended design?

> **Testing:** Whether you know how to *measure* the gap between intended and actual architecture, not just assert one exists.

**A.** **Architectural drift** (or *erosion*) is the gradual divergence of the *as-built* architecture from the *as-designed* one — the diagram says clean layers, the code has shortcuts everywhere. **Conformance checking** is measuring that gap. The lightweight, continuous version is fitness functions in CI (Q3.1): the intended rules are codified, so any divergence fails the build and drift is *prevented* rather than merely measured. For the broader picture you use **dependency-structure analysis** — tools like Structure101, NDepend, Sonargraph, or a dependency-matrix (DSM) view — to visualize cycles, layering violations, and modules whose actual coupling contradicts the intended boundaries. The key insight is that drift is *continuous and silent*, so the only reliable defense is *continuous* checking: a one-time architecture review documents the gap on the day you run it and is stale the next week. Codifying the intended structure as executable rules turns "we should review the architecture someday" into "the build is red right now because someone violated a boundary."

### Q3.4 — Give a concrete example of an ArchUnit-style rule. What classes of debt does this prevent that a linter never could?

> **Testing:** Concrete familiarity — can you actually express an architectural constraint, and do you know its unique value?

**A.** A canonical set: "classes in `..domain..` may not access classes in `..infrastructure..`"; "no class in `..service..` may depend on `..controller..`"; "the package structure must be free of cycles" (`slices().should().beFreeOfCycles()`); "only `..repository..` may import the JDBC/ORM package." Each is a few lines of a normal test that the build runs alongside unit tests. What this prevents that a linter never could: a linter reasons *within a file*; these rules reason over the **whole dependency graph** — relationships *between* modules that no single file reveals. The bug they catch is the slow inversion of a dependency ("the domain now imports the web framework"), the creeping cycle, the layering violation — debt that is structurally invisible locally and only emerges as an aggregate property. They also serve as **executable documentation**: the rules *are* the architecture spec, so they can't drift out of date the way a Confluence diagram does — if the rule is wrong, the build tells you, and if the architecture changes, you change the rule deliberately.

---

## Theme 4 — Decision and Knowledge Debt

### Q4.1 — Not all debt is code. What is *decision debt*, and how do ADRs prevent it?

> **Testing:** Whether you recognize undocumented decisions as a real, compounding liability — not just messy code.

**A.** **Decision debt** is the accumulated cost of choices whose *rationale* was never recorded: six months later nobody knows *why* the system uses eventual consistency here, or *why* this service owns that data, so every team either fearfully preserves a decision they don't understand or blindly reverses one that had good reasons. The interest is paid in repeated re-litigation, accidental regressions of deliberate choices, and onboarding that takes months because the "why" lives only in the heads of people who may have left. **Architecture Decision Records** (ADRs — Michael Nygard's format) prevent this: a short, version-controlled markdown file per significant decision capturing *context, the decision, and consequences*. Because they're tiny, written at decision time (when the context is fresh and free), and live in the repo next to the code, they're cheap to produce and they make the reasoning durable. The mechanism is the same as test-as-you-go: capture the expensive-to-recover context *while it's still cheap*, before the people and the memory disperse.

### Q4.2 — What is docs-as-code, and why does it prevent documentation debt better than a wiki?

> **Testing:** Whether you understand that docs decay unless their lifecycle is coupled to the code's lifecycle.

**A.** Documentation debt is the gap between what the docs say and what the system does — and it's *the default outcome*, because code changes continuously and a separate wiki doesn't. **Docs-as-code** treats documentation as source: it lives in the repo (markdown), changes in the *same PR* as the code change, is *reviewed* alongside the code, and is built/linted/link-checked in CI. That coupling is the prevention mechanism — a docs change can be made a *required part of Done* for changes that affect documented behavior, and broken links or stale snippets fail the build. A wiki rots precisely because its lifecycle is *decoupled* from the code: nothing forces it to change when the code does, so entropy wins. The general principle: documentation stays accurate only when updating it is *part of the same change* that made it inaccurate — anything that puts distance (a separate tool, a separate ticket, a separate person, "later") between the code change and the doc change guarantees drift. Diagrams-as-code (Mermaid/PlantUML in-repo) extends the same logic to architecture diagrams, which are otherwise the fastest-rotting artifact of all.

### Q4.3 — What is knowledge debt and bus-factor risk, and how do you actively prevent it rather than discover it when someone quits?

> **Testing:** Whether you treat knowledge concentration as a managed risk with concrete countermeasures, not a fact of life.

**A.** **Knowledge debt** is critical understanding concentrated in too few heads; **bus factor** is the brutal metric — *how many people can be hit by a bus before the project stalls*. A bus factor of one on a payments service is an outage and a hiring crisis waiting to happen, and you usually *discover* it at the worst possible moment: a resignation, a vacation during an incident. Prevention is deliberate context-spreading, and it's mostly process, not tooling: **pair and mob programming** on critical or unfamiliar areas; **code review as teaching**, deliberately routing reviews of a risky module to people who don't yet know it; **rotating ownership** so no one is the permanent sole maintainer; ADRs and docs-as-code so the "why" survives a departure; and explicitly measuring it — git-based tools (e.g., `git-of-theseus`, bus-factor analyzers) flag files only one person has ever touched. The senior framing: bus factor is a *managed risk*, like any single point of failure — you don't wait for the failure, you measure the concentration and deliberately *de-risk the hotspots* before they bite, the same way you'd add redundancy to any other SPOF.

### Q4.4 — Your team writes ADRs that nobody reads and docs that go stale anyway. What went wrong, and how do you make knowledge artifacts actually pay off?

> **Testing:** Whether you understand that artifacts without a *lifecycle and discoverability* are just more debt — write-only documentation.

**A.** The failure is treating the artifact as the goal instead of the *flow* it has to live in. ADRs nobody reads are usually undiscoverable (buried in a wiki, not in the repo, not linked from the code they govern) and *write-only* — created once and never referenced in review or onboarding. Stale docs are docs whose update isn't coupled to the code change (Q4.2) — they decoupled the lifecycle, so entropy won. The fixes are structural, not exhortative: put ADRs *in the repo* next to the code and link them from the relevant module so they surface where decisions are questioned; reference the ADR in the PR that implements or revisits the decision, so reading them becomes part of the workflow rather than an act of virtue; make doc updates part of Done and *enforce link/build checks in CI* so stale docs fail loudly; and make new ADRs and runbooks part of onboarding so they're *consumed*, which creates pressure to keep them current. The principle mirrors gates and tests: **an artifact only prevents debt if it's embedded in a workflow that forces its use and its maintenance** — a document that nothing in the daily loop reads or updates is itself a form of debt, not a cure for it.

---

## Theme 5 — Culture and Incentives

### Q5.1 — Many engineers say preventing debt is "mostly a cultural problem, not a tooling problem." Do you agree? Defend it.

> **Testing:** Whether you grasp that tools enforce standards but *people decide whether to honor or route around them* — the deepest point on the page.

**A.** Largely yes, with a precise caveat. Tools are *necessary* — they make the right thing the default and the wrong thing visible — but every tool is only as strong as the team's *willingness not to route around it*. A coverage gate is defeated by assertion-free tests; a complexity gate by a culture that reflexively reaches for the bypass annotation; a DoD by a tacit "ship first, clean later that never comes." The gate enforces the letter; only culture supplies the spirit. So the deepest leverage is the **shared belief that quality is part of the job, not a tax on it** — that "done" *includes* leaving the code healthy. Where that belief exists, light tooling suffices because people *want* to pass honestly; where it's absent, no amount of tooling holds because people optimize for whatever they're actually rewarded for (Q5.3) and treat gates as obstacles to be gamed. The precise caveat: culture without mechanism doesn't *scale* — it decays as the team grows and turns over, because it relied on everyone personally holding the standard. So the real answer is **both, in order**: culture sets the intent, tooling makes the intent durable and uniform across people who don't share the founders' instincts. Tooling *encodes* a culture; it can't *create* one.

### Q5.2 — Explain the broken-windows theory as it applies to code. What's the practical implication for prevention?

> **Testing:** Whether you understand that visible decay *licenses* further decay — that standards are contagious in both directions.

**A.** Broken windows (borrowed from criminology, popularized for code by *The Pragmatic Programmer*) is the observation that **visible disorder signals that nobody cares, which licenses more disorder**. In a codebase: one un-refactored mess, one commented-out block left for months, one ignored failing test, one TODO from 2019 — each tells the next engineer "the bar here is low, sloppiness is tolerated," and the bar ratchets *down*. The corrosive part is that it's self-reinforcing: each new window makes the next one feel normal, and a pristine module is psychologically much harder to be the first to dirty than an already-messy one. The practical implication for prevention is that **standards are contagious in both directions**, so you fix small things *promptly* and *visibly* — fast cleanup isn't perfectionism, it's stopping the signal that decay is acceptable before it spreads. It's also why a green build, zero ignored tests, and clean code in the *hot* files matter beyond their direct value: they set the ambient standard newcomers calibrate to. Conversely, the single most demoralizing thing for prevention is a codebase that's *already* full of windows, because every individual's clean-up feels futile against the backdrop — which is the cultural reason boil-the-ocean paydown sometimes *is* worth it: to reset the ambient standard.

### Q5.3 — How can an incentive system manufacture debt even when every engineer is competent and well-meaning?

> **Testing:** Whether you can connect organizational incentives to debt outcomes — that you reward velocity, you get debt, regardless of individual skill.

**A.** Debt is frequently a *rational response to the incentives*, not a competence failure. If the only thing measured, praised, and promoted is **shipping speed and feature count** — story points, ship dates, demo-ability — then cutting corners is the *optimal* move for a rational engineer: the skipped test, the copy-paste, the "temporary" hack all make this sprint look better, and the interest comes due later, diffused across the team and invisible on anyone's performance review. You've built a system where the person who *creates* debt looks productive and the person who *prevents or pays it down* looks slow, because prevention work is invisible (a bug that *didn't* happen, a refactor that kept velocity from decaying) while feature work is demoed. Over time this *selects for* debt regardless of individual virtue — even people who'd rather do it right learn that careful work is punished by the review cycle. The fix is to change what's rewarded: make quality and prevention *legible* — track and celebrate reduced incident rates, lowered change-failure rate, sustained lead time, reduced hotspot complexity; give engineers explicit, protected capacity for health work; and stop treating "spent time making the codebase safer" as time stolen from "real" work. The slogan: **you get the debt your incentives pay for.** If leadership rewards only velocity, no individual heroics will hold the line — the system is producing exactly what it's optimized for.

### Q5.4 — What are paved roads / golden paths, and how do they prevent debt at the level of *defaults* rather than enforcement?

> **Testing:** Whether you know the most scalable prevention is making the right thing the *easy* thing — prevention by construction, not by gate.

**A.** A **paved road** (Netflix's term; "golden path" elsewhere) is the well-supported, opinionated default way to build and run a service — a templated service skeleton with CI, observability, security, linting, the standard libraries, and the org's best practices *already wired in*. The insight is that the most scalable prevention isn't catching mistakes after the fact (a gate) — it's making the correct setup the **path of least resistance** so the debt never gets created. If spinning up a new service from the template already gives you tests, structured logging, dependency scanning, and a sane architecture, engineers get all of that *for free* and would have to go out of their way to do it wrong; the right thing is the *default*, not an act of discipline. This shifts prevention from *enforcement* (expensive, adversarial, gameable) to *construction* (cheap, frictionless, invisible). It compounds: improving the paved road improves every service that adopts it, and it makes gates *humane* because passing them is the default state of a templated project rather than a fight. The deeper point connects to culture: a good paved road *lowers the cost of doing the right thing*, and the cheapest way to win a culture battle is to make virtue require no willpower. You still need a culture that *chooses* the paved road, but a great paved road makes that an easy choice.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — A team ships fast and the codebase is rotting. How do you stop the debt accumulation *without* slowing them to a crawl?

> **Testing:** The central judgment of the topic — prevention that preserves flow, gating new code rather than freezing the team.

**A.** The trap is the false binary "ship fast *or* be clean." The resolution is **stop the bleeding on new code without touching the legacy ocean** — the clean-as-you-code strategy (Q2.3). Concretely, in order: (1) **gate the new, not the old** — add diff-coverage and complexity/lint gates that apply *only to changed code*, so velocity on new work is barely affected (clean new code is roughly the same speed once it's the default) while the inflow of fresh debt stops; (2) **shrink PRs and tighten the DoD** so review actually catches design problems, which is free in time and high in leverage; (3) **boy-scout the hotspots** — let the most-churned files improve opportunistically as they're touched, attacking debt where activity is highest rather than everywhere; (4) make the trend *visible* — show debt inflow flattening — so leadership sees that quality and speed coexist, which protects the practice. What you *don't* do is a feature freeze for a grand cleanup (kills trust and morale and isn't even necessary) or repo-wide retroactive gates (unadoptable, gets disabled). The framing for the interviewer: you're throttling the *flow* of new debt, not paying down the *stock* in one heroic stop-the-world — that keeps the team fast *and* arrests the rot, because the thing that was actually killing them was the daily inflow, not last year's code.

### Q6.2 — You want a coverage gate on a legacy repo sitting at 20%. How do you set it without it being either useless or impossible?

> **Testing:** Direct application of the ratchet/diff-coverage idea to a hostile real-world starting point.

**A.** You never set a flat absolute target like 80% — it's unreachable from 20%, so it gets ignored or disabled on day one, and even "raise it to 25%" invites gaming with assertion-free tests. Two gates, working together: (1) a **ratchet** that pins the *overall* number — coverage may not drop below today's 20%, so the baseline can only rise and no PR is allowed to make it worse; and (2) the real lever, a **diff/patch-coverage gate** — *new and changed lines* must be covered at a high bar (say 80%). New code is held to a strong standard immediately, while the 80% of untested legacy is left alone until someone touches it, at which point the diff gate pulls it up. Over months the overall number climbs *organically* toward the new-code bar as the codebase churns, with no backfill project and no team-stopping mandate. Tactical notes: bootstrap the baseline from the *current* measured number rather than a target; allow a documented, reviewed override for genuinely untestable changes so the gate stays trusted rather than bypassed; and watch for assertion-free gaming by occasionally checking mutation score on hot modules. The principle restated: **gate the direction and the diff, never the absolute level** — that's the only way a 20% repo adopts a real coverage gate *today*.

### Q6.3 — Leadership rewards only ship dates. Engineers know it, and debt is piling up. As a senior/lead, how do you actually change the *outcome*?

> **Testing:** Whether you can operate on the incentive system and speak leadership's language — the highest-leverage and hardest move on the page.

**A.** You can't fix this purely bottom-up, because the engineers are responding *rationally* to the incentives (Q5.3) — exhorting them to "care about quality" while the reward structure punishes it just produces guilt and burnout. The real work is changing what leadership *sees and values*, in their own language: **risk, cost, and predictability**, not "clean code." Concretely: (1) **make debt visible in business terms** — translate it into slipped velocity (lead time creeping up), rising change-failure rate, incident frequency/MTTR, and onboarding time; "feature delivery is 30% slower than a year ago and here's the trend" lands where "the code is ugly" never will. (2) **Reframe prevention as protecting the very thing they want** — sustained delivery speed — using the DORA evidence that high-quality teams ship *faster*, not slower, so quality isn't opposed to velocity, it's how you *keep* velocity. (3) **Negotiate explicit, protected capacity** for health work (a standing fraction of each sprint, or a "fix-it" rotation) so prevention is funded, not heroic moonlighting. (4) **Tie health metrics into how delivery is reported and rewarded** so prevention work becomes legible and stops being invisible. (5) Start where you *do* have authority — put the clean-as-you-code gates in now (Q6.1) so the inflow slows regardless — and use the resulting trend as evidence in the leadership conversation. The honest senior caveat: if leadership genuinely *only* ever rewards dates and won't move even on data, the realistic outcome is bounded — you slow the bleed with gates within your control and you're transparent about the accumulating risk, but **no individual heroics overcome a sustained incentive to ship at all costs.** The system produces what it pays for; the lever that actually changes the outcome is the incentive, and reaching it means persuading the people who own it.

### Q6.4 — A senior engineer wants to introduce architecture fitness functions; the team pushes back ("more gates, more friction, more red builds"). How do you make the case and roll it out?

> **Testing:** Change management for prevention tooling — adoption is itself a skill, and a gate nobody wants is dead on arrival.

**A.** Pushback is usually fear of *noise and friction*, not disagreement that architecture matters — so I'd address that head-on rather than mandate. Roll-out: (1) **start in warn-only / report mode** — run the fitness functions and surface violations without failing the build, so the team sees they're *accurate and few*, not a flood of false positives; trust has to precede enforcement. (2) **Encode only rules the team already agrees on** — "domain mustn't depend on infrastructure," "no package cycles" — so the gate ratifies existing intent rather than imposing a new opinion; nobody argues with a rule they already believe. (3) **Baseline existing violations** so the gate covers *new* drift only (clean-as-you-code again), avoiding a wall of red from pre-existing sins — flip to blocking only after the warn period proves the noise is low. (4) **Sell the upside concretely** — these rules are *executable architecture documentation* that catches a creeping cycle as one fixable line today instead of an untanglable knot in two years, and they make the architecture safe to *evolve* (Q3.2). (5) Keep the rule set *small and high-value* — a few load-bearing constraints, not a hundred fussy ones — because a noisy gate gets disabled and takes the credible ones with it. The meta-point I'd voice: a gate the team doesn't *buy* gets routed around (Theme 5), so adoption *is* the work — I'd rather have three trusted rules everyone honors than thirty resented ones everyone games.

### Q6.5 — Your CI has every gate — lint, coverage, complexity, dependency scan — and is all green, yet the codebase is widely considered hard to work in. What's going on, and what do you do?

> **Testing:** The synthesis question — whether you can hold "gates necessary but insufficient" and act on it (bridge into Theme 7).

**A.** Green gates and a painful codebase is the **classic signature of debt that lives above the line automation can see** (Q2.5, Theme 7). Every gate measures *local, syntactic* properties — line coverage, per-function complexity, lint rules, known-bad dependencies — and a codebase can satisfy all of them while suffering the things that actually make work miserable: wrong abstractions, leaky boundaries, a domain model that fights the domain, god classes that are individually within every metric, pervasive coupling that no single file reveals, tests that cover lines without asserting behavior. The gates are doing their job (holding the floor); they were never going to catch *design*. What I'd do: (1) **find the pain empirically** — pair churn-vs-complexity hotspot analysis (which files are *both* changed constantly *and* hard) with developer survey signals ("where do you dread working?"), because the felt pain points to the structural debt the metrics miss. (2) **Add the structural checks that gates lack** — architecture fitness functions for boundary/cycle/coupling rules (Theme 3) — to catch the *structural* class going forward. (3) **For the design-level debt that no automation catches**, schedule deliberate, human-led work: targeted refactoring of the worst hotspots, design review for the painful modules, and mob sessions to spread the understanding. (4) **Check the tests aren't lying** — high coverage with low assertion quality is a known blind spot; a mutation-testing spot-check on a "well-covered" hot module often reveals the coverage was theater. The framing for the interviewer: **all-green CI means the *floor* is held, not that the *design* is good** — the remaining debt is precisely the part that requires human judgment, so the response is to *add structural automation where it exists* and *deploy scarce human attention where it doesn't*, guided by data on where the pain actually is.

---

## Theme 7 — The Limits of Automation

### Q7.1 — "You can't lint your way to good design." Unpack that. What can metrics and gates *fundamentally* not prevent?

> **Testing:** Whether you genuinely understand the ceiling of mechanical prevention — the load-bearing idea of the whole page.

**A.** Linters, complexity ceilings, and coverage gates operate on *syntax and local structure* — properties computable from the text of a file or function in isolation. **Good design is a global, semantic, contextual property**: whether the abstractions match the problem, whether the boundaries are in the right places, whether the domain model reflects the domain, whether a generalization is earned or premature. None of that is mechanically detectable, because it depends on *what the code is supposed to mean and do*, which the tool has no access to. The sharp illustration: you can write a function with cyclomatic complexity 2, 100% line coverage, and zero lint warnings that is nonetheless a catastrophic design — a wrong abstraction that every future change has to fight. Metrics measure the *proxy* (small, covered, simple-looking), not the *target* (fit for purpose, easy to change), and Goodhart's law bites — push hard enough on a metric and people satisfy the proxy while the target rots (assertion-free tests, functions split arbitrarily to dodge a complexity limit). So gates fundamentally cannot prevent **conceptual debt**: wrong models, wrong boundaries, missing or premature abstractions, accidental complexity in the *design*. They hold a valuable floor and free attention; they can't supply taste. The senior framing: *automate the objective floor so that scarce human judgment is spent on the design questions only judgment can answer* — and treat anyone who claims a tool will guarantee good design as not yet having hit the ceiling.

### Q7.2 — Given that, where do you spend *human* attention for prevention, and how do automation and judgment divide the labor?

> **Testing:** Whether you can construct the *full* prevention system — the right tool for each layer, not a single hammer.

**A.** I divide prevention into three layers by what each can actually judge, and put effort accordingly. **Layer 1 — objective/local: automate fully.** Formatting, lint, complexity ceilings, diff coverage, duplication, dependency CVE/license scanning. Cheap, uniform, deadline-proof; this is the floor and it should be machine-enforced so no human time is spent policing it. **Layer 2 — structural/global: automate with fitness functions.** Dependency rules, layering, cycle-freedom, coupling and latency budgets (Theme 3). Still automatable because the rules are objective even though they span the whole graph — this catches the architectural-drift class that Layer 1 is blind to. **Layer 3 — semantic/contextual: spend the humans.** Abstraction quality, boundary placement, domain modeling, naming, API design, the *earned-ness* of a generalization — caught only by **code review with taste, design discussion, pairing/mobbing, and ADRs** that force the reasoning to be explicit. The division of labor: automation handles the floor and the structure so that **human judgment — the scarce, expensive, non-scalable resource — is reserved for the design questions only judgment can answer**, instead of being burned re-checking formatting. The system works precisely because each layer covers what the layer below cannot: gates free attention, fitness functions guard structure, and humans guard design — and culture (Theme 5) is the substrate that decides whether all three are honored or routed around. A team that pushes everything onto humans drowns; a team that trusts automation to do design ships an all-green ball of mud.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Prevention vs paydown — one line each?** A: Prevention stops *new* debt entering through daily work (a flow); paydown removes *existing* debt already in the repo (a stock).
- **Q: Why a coverage ratchet over a flat 80% target?** A: It gates the *direction* (coverage can't drop), so it's adoptable on any repo today and can't be satisfied by an unreachable absolute number.
- **Q: What's "clean as you code"?** A: Apply the quality gate only to new/changed code, holding the floor on inflow while legacy improves as it's touched.
- **Q: What's an architecture fitness function?** A: An automated, CI-run test of an architectural characteristic (e.g., "domain may not import infrastructure").
- **Q: Name one ArchUnit-style rule.** A: "The package structure must be free of cycles," or "no class in `domain` may depend on `infrastructure`."
- **Q: What is decision debt and its antidote?** A: The cost of choices whose rationale was never recorded; antidote is ADRs written at decision time.
- **Q: Why docs-as-code over a wiki?** A: Docs change in the same reviewed PR as the code, coupling their lifecycle to the code so they don't silently rot.
- **Q: What is bus factor?** A: How many people can be lost before a project stalls; a bus factor of one is a managed single point of failure.
- **Q: Broken-windows theory in code, one line?** A: Visible decay signals nobody cares and licenses more decay, so fix small messes promptly and visibly.
- **Q: How do incentives manufacture debt?** A: Reward only ship speed and rational engineers cut corners, because prevention is invisible and corner-cutting looks productive.
- **Q: What's a paved road / golden path?** A: An opinionated default (templated service with CI, tests, observability wired in) that makes the right setup the path of least resistance.
- **Q: Can you lint your way to good design?** A: No — gates measure local syntax; design (abstractions, boundaries, models) is a global semantic property only human judgment catches.
- **Q: Why does PR size affect debt, not just review speed?** A: Past a few hundred lines reviewers skim, so design problems sail through the last cheap human checkpoint.
- **Q: Diff coverage vs overall coverage?** A: Diff coverage holds *new* lines to a high bar without demanding a legacy backfill; overall is a stock you ratchet, not a target you mandate.
- **Q: Why is a frequently-wrong gate worse than no gate?** A: People learn to bypass it, which kills its signal *and* manufactures false confidence.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Treating prevention as "add more linters" with no awareness of their ceiling.
- Proposing a flat absolute coverage target (e.g., 80%) on a legacy repo.
- Wanting a feature freeze / big-bang cleanup as the *first* move to stop accumulation.
- No mention of incentives or culture — assuming better tools fix a problem the reward system creates.
- Believing all-green CI means the codebase is healthy.
- Conflating prevention with paydown, or code debt with decision/knowledge debt.
- Rolling out a gate by mandate, with no plan for noise, trust, or adoption.

**Green flags:**
- Naming the *distinction* (prevention/paydown, flow/stock, gate-new/boil-the-ocean, mechanism/culture) before reaching for a tool.
- Reaching for ratchets and diff/patch coverage to make gates adoptable on imperfect repos.
- Citing architecture fitness functions for *structural* debt that linters can't see.
- Stating "you can't lint your way to good design" unprompted and dividing labor across automation layers and human judgment.
- Connecting debt outcomes to incentives — "you get the debt your incentives pay for."
- Translating debt into business terms (lead time, change-failure rate, incidents) for leadership.
- Treating gate/artifact *adoption* and signal-to-noise as part of the work, not an afterthought.

---

## Summary

- The bank reduces to four distinctions, repeated in costumes: **prevention vs paydown**, **flow vs stock**, **gate-the-new vs boil-the-ocean**, **mechanism vs culture**. Name the distinction first; the tool follows.
- **Everyday prevention** attacks the *inflow*: debt enters through ordinary PRs, so a real Definition of Done, the boy-scout rule, test-as-you-go, and small reviewable PRs are the highest-leverage daily levers — you can't out-pay-down a high inflow rate.
- **Automated gates** mechanize the floor so it survives deadlines and turnover: ratchets and *diff coverage* over flat targets, **clean-as-you-code** to gate new code only, and ruthless protection of signal-to-noise — a frequently-wrong gate gets bypassed and manufactures false confidence.
- **Architectural debt** needs *structural* automation: **fitness functions** (ArchUnit-style dependency/cycle/layering rules) catch drift that's invisible in any single file and make the architecture safe to *evolve* rather than decay.
- **Decision and knowledge debt** are prevented by capturing expensive context while it's cheap — **ADRs** at decision time, **docs-as-code** coupled to the code's lifecycle, and active **bus-factor** reduction (pairing, ownership rotation, review-as-teaching) — and only if the artifacts are embedded in a workflow that forces their use.
- **Culture and incentives** are the substrate: tools enforce the letter, culture supplies the spirit; **broken windows** spread decay; rewarding only velocity *manufactures* debt regardless of individual skill; and **paved roads** prevent by making the right thing the default rather than an act of discipline.
- **The limit:** you can't lint your way to good design — gates measure local syntax, design is a global semantic property. Automate the objective floor and the structure so scarce human judgment is spent on the design questions only judgment can answer.

---

## Further Reading

- *Building Evolutionary Architectures* (Ford, Parsons, Kua) — the definitive treatment of fitness functions and architecture that changes safely.
- *Accelerate* (Forsgren, Humble, Kim) — the DORA evidence that quality and delivery speed rise *together*, the data you bring to a velocity-obsessed leadership.
- *The Pragmatic Programmer* (Hunt & Thomas) — broken windows, the boy-scout instinct, and the day-to-day craftsmanship behind prevention.
- *Tidy First?* (Kent Beck) — separating structural from behavioral change, the discipline that makes opportunistic cleanup reviewable.
- Michael Nygard, "Documenting Architecture Decisions" — the canonical ADR format for preventing decision debt.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [05 — Paying Down Debt](../05-paying-down-debt/interview.md) — the other half of the loop: removing the *stock* once prevention has slowed the *flow*.
- [03 — The Debt Quadrant](../03-the-debt-quadrant/interview.md) — Fowler's deliberate/inadvertent × prudent/reckless framing that tells you *which* debt is even worth preventing.
- [Technical Debt Management README](../README.md) — where prevention sits in the full debt-management lifecycle.
- [Quality Engineering README](../../README.md) — how debt prevention connects to gates, testing, and architecture across the discipline.
