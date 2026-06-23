# OO Metrics — the CK Suite — Professional

> **What?** The team-and-tooling lens: how to run metrics in CI without provoking the Goodhart backfire, what gates actually work (ratchets, not thresholds), the review vocabulary that turns a number into a conversation, and the concrete tool setup — SonarQube, ck, JDepend, PMD, ArchUnit — that a professional wires into a pipeline.
> **How?** We build a metrics program the way a staff engineer would: measure everything, gate almost nothing, ratchet the worst offenders, surface trends in review, and keep the metric subordinate to human judgement at every step.

---

## 1. The first rule of a metrics program: measure ≫ gate

The single most common way metrics programs fail is **gating on absolute thresholds**, which guarantees the Goodhart gaming described in [`senior.md`](senior.md). The professional inversion:

- **Measure broadly, continuously, visibly.** Every class, every build, on a dashboard.
- **Gate narrowly, on direction, with overrides.** At most: "no PR may *increase* the number of classes above the worst-offender line." Never: "every class must be under 10."

The reason: thresholds are *static* and local, so engineers optimize the threshold. **Ratchets** are *relative* and global — "don't make it worse" — which can't be gamed by cosmetic local edits because they track the whole codebase's distribution. You can't satisfy a ratchet by adding a dummy field; you satisfy it by not regressing.

---

## 2. The ratchet pattern

A ratchet records the current count of violations and fails the build only if the count goes *up*. New code is held to the standard; legacy debt is frozen, not retroactively-failed (which would block all work).

```
Baseline (committed to repo):  classes with CBO > 14 : 37
PR raises it to               : classes with CBO > 14 : 38   → BUILD FAILS
PR lowers it to               : classes with CBO > 14 : 35   → baseline auto-updates to 35
```

SonarQube implements exactly this with **"new code" conditions** in a Quality Gate: leave overall thresholds advisory, set the gate to "Conditions on New Code" so a PR fails only if *the code it touched* regresses. This is the only gate configuration that survives contact with a real team.

---

## 3. Tooling map

| Tool                    | Scope            | Gives you                                                        | Pipeline role                         |
| ----------------------- | ---------------- | --------------------------------------------------------------- | ------------------------------------- |
| **ck**                  | per-class        | full CK CSV (wmc, dit, noc, cbo, rfc, lcom, plus LCOM*, fan-in/out) | ad-hoc deep dives, custom scripts     |
| **SonarQube**           | project, trends  | CC, cognitive complexity, coupling, duplications, dashboards, quality gates | the CI gate + trend dashboard         |
| **JDepend**             | per-package      | Ca, Ce, instability A, abstractness, **distance D**, cycles      | architecture/main-sequence checks     |
| **PMD**                 | rule-based       | `CyclomaticComplexity`, `ExcessiveClassLength`, `CouplingBetweenObjects`, `GodClass` (its own detector) | fast pre-commit linting               |
| **MetricsReloaded**     | IDE (IntelliJ)   | CK metrics live while editing                                    | individual exploration                |
| **ArchUnit**            | structural rules | enforce dependency *direction*, layering, no-cycles as tests     | the gate that *doesn't* backfire      |

The professional combination: **SonarQube** for trend + new-code gate, **ArchUnit** for hard structural rules in the test suite, **ck** for periodic deep audits, **JDepend** for the main-sequence review.

---

## 4. ck in CI — the quickest concrete setup

```bash
# Download the runnable jar, then:
java -jar ck.jar /path/to/project true 0 false metrics/

# Produces metrics/class.csv with columns:
#   class, type, cbo, wmc, dit, noc, rfc, lcom, lcom*, fanin, fanout, ...
```

Then a tiny gate script — fail only on *new* worst-offenders, sorted for human triage:

```bash
# Top 20 by a composite "god-class likelihood": classes high on cbo+wmc+rfc+lcom
awk -F, 'NR>1 {print $1, $3+$4+$7+($8/10)}' metrics/class.csv \
  | sort -k2 -rn | head -20
```

The output is a triage list a human reads — *not* a pass/fail. This is the right altitude for ck: discovery, not gating.

---

## 5. ArchUnit — the gate that can't be gamed

The metrics worth *hard-gating* are **structural and directional**, not numeric — because direction can't be satisfied by cosmetic edits. ArchUnit expresses them as ordinary JUnit tests:

```java
@AnalyzeClasses(packages = "com.acme")
class ArchitectureTest {

    @ArchTest
    static final ArchRule domain_depends_on_nothing_unstable =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat().resideInAPackage("..web..");
    // enforces Stable Dependencies: domain (stable) must not point at web (unstable)

    @ArchTest
    static final ArchRule no_cycles =
        slices().matching("com.acme.(*)..").should().beFreeOfCycles();
    // enforces the Acyclic Dependencies Principle — protects instability math

    @ArchTest
    static final ArchRule controllers_are_thin =
        classes().that().haveSimpleNameEndingWith("Controller")
            .should().haveOnlyFinalFields();   // a proxy for "don't grow state here"
}
```

This is the professional sweet spot: hard rules on *dependency direction and cycles* (which protect the main-sequence properties), advisory dashboards on *numeric* metrics. You gate what's binary and architectural; you watch what's continuous and judgemental.

---

## 6. Review vocabulary — turning numbers into conversation

Metrics earn their keep in code review when they *objectify* a hunch. The phrasing that works:

| Instead of (taste)            | Say (data + ask)                                                             |
| ----------------------------- | --------------------------------------------------------------------------- |
| "This class is too big"        | "WMC jumped 40 → 87 on this PR — is this one responsibility or several?"     |
| "Too coupled"                  | "CBO went 6 → 19; can we inject these via interfaces instead of `new`?"      |
| "This isn't cohesive"          | "LCOM4 is 3 here — looks like three classes; want to split along the field groups?" |
| "This hierarchy is too deep"   | "DIT 7 — are we using all these parents, or is this yo-yo?"                  |
| "Wrong dependency direction"   | "domain now imports web — that inverts stability; ArchUnit will fail this."   |

The pattern is always **observation (the delta) + open question**, never **number → verdict**. The metric starts the conversation; the engineer who wrote the code finishes it. A reviewer who comments "CBO 19, change it" has misused the tool.

---

## 7. Dashboards a team actually reads

Effective dashboards show **the tail and the trend**, never the mean (means lie on skewed distributions — see [`senior.md`](senior.md)):

- **Top-20 worst classes** by composite signature, with their trend arrows.
- **New-code metric deltas** per PR (the gateable view).
- **Per-package distance-from-main-sequence (D)**, sorted descending, packages with < 5 classes excluded.
- **Hotspot map:** complexity × churn (a class that's *both* complex and frequently-changed is the highest-ROI refactor — this is Adam Tornhill's "behavioral code analysis", and it beats raw CK every time because it weights by how often you actually pay the complexity cost).

> **Complexity × churn** is the single most useful professional metric view. A CC-50 class nobody touches costs nothing; a CC-15 class edited every sprint is bleeding you. Always weight by churn.

---

## 8. Exemptions and noise control

A metrics program loses credibility fast if it flags things everyone agrees are fine. Bake in exemptions:

- **Generated code** (DTOs, gRPC stubs, JOOQ, MapStruct) — exclude from all metrics.
- **Framework-imposed depth/coupling** (JPA entity graphs, Spring base classes) — annotate or exclude.
- **Test code** — separate ruleset; tests legitimately have different cohesion shapes.
- **Façades and orchestrators** — legitimately high CBO/RFC; tag them so the dashboard doesn't cry wolf.

Configure exclusions in `sonar-project.properties` / PMD's `excludes` / ArchUnit's `.that(...)` filters. The goal: every flagged item is genuinely worth a look, so the team keeps trusting the flags.

---

## 9. Rolling out a metrics program without a revolt

1. **Start read-only.** Publish the dashboard for a month, gate nothing. Let people see their own worst classes.
2. **Agree on the worst-offender list, not the threshold.** Pick the top 10 to refactor; ignore the absolute numbers.
3. **Add a new-code ratchet** only after the team trusts the signal. Direction-only, with an override label for justified exceptions.
4. **Add hard ArchUnit rules** for the genuinely non-negotiable structure (no cycles, dependency direction).
5. **Re-derive thresholds quarterly** from your own distribution; never import them.
6. **Review the program itself** — if a metric never catches a real problem, drop it; if engineers game one, remove the gate.

A metrics program is a feedback tool for humans, not a compliance regime. The moment it feels like compliance, it gets gamed and the data goes bad.

---

## 10. When metrics *don't* matter

- **Small, stable, well-understood code** — a 200-line library you'll never touch again. Don't measure it.
- **Spikes and throwaway prototypes** — metrics on code you'll delete are noise.
- **When the team already knows the worst class** — you don't need a tool to tell you about the legendary `OrderManager`; you need time to fix it.
- **When the metric and a senior's reading conflict** — defer to the reading; the metric is the cheaper, dumber signal.

Spend the metrics budget where it pays: large, evolving, multi-team codebases where no one can hold the whole graph in their head.

---

## 11. What's next

| Topic                                            | File               |
| ------------------------------------------------ | ------------------ |
| Canonical sources, empirical literature           | `specification.md` |
| Diagnose smells from a real report                | `find-bug.md`      |
| Refactor toward the main sequence / lower CBO     | `optimize.md`      |
| Hands-on tool runs                                | `tasks.md`         |

---

**Memorize this:** run a metrics program as **measure broadly, gate narrowly**. Hard-gate only *direction and cycles* (ArchUnit), ratchet only *new-code regressions* (SonarQube new-code gate), and keep numeric thresholds *advisory*. Dashboards show the tail and the trend, never the mean, and the highest-ROI view is **complexity × churn**. In review, a metric is an *observation plus an open question*, never a verdict. Exempt generated and framework code so every flag is trustworthy, re-derive thresholds from your own distribution, and when the metric and a senior's reading disagree, the reading wins.
