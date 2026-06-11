# Inappropriate Intimacy — Specification

This chapter turns the smell into numbers. Reviewers say "these two classes know too much about each other" — but how much is too much? Coupling metrics give us a quantitative baseline, an early warning, and a way to compare two refactoring options objectively. Below are the metrics that matter for Inappropriate Intimacy, exact definitions, how to compute them, and thresholds that have held up in real Java codebases.

## 1. CBO — Coupling Between Objects

**Definition.** For a class `C`, CBO is the number of *other* classes to which `C` is coupled. Two classes are coupled when one uses a method or field of the other, or one is the parameter/return type/local variable type of a method in the other. Inheritance and use of language types (`String`, `int`, JDK types in `java.lang`) are typically excluded.

**Formal form.**

```
CBO(C) = |{ D : D != C and C uses D or D uses C }|
```

Many tools (PMD, CK, JaCoCo plugins, NDepend-style ports) compute an *outgoing* CBO (only `C -> D` edges) and an *incoming* CBO (`D -> C`). Sum is the symmetric CBO.

**Why it matters for intimacy.** A class with CBO of 25 is touching a quarter of the system. The probability that at least one of those 25 partners is leaking field-level details into `C` rises sharply with CBO.

**Thresholds (industry-typical).**

| CBO range | Reading |
|-----------|---------|
| 0–5 | Healthy, well isolated |
| 6–12 | Normal for orchestrators, controllers |
| 13–20 | Warning — review for hidden intimacy |
| 21+ | High risk — almost always contains at least one intimate pair |

For domain entities the cap is stricter: anything above 8 is suspicious.

## 2. MPC — Message Passing Coupling

**Definition.** MPC counts the number of method calls from class `C` to methods of other classes. Unlike CBO (which counts *partners*), MPC counts *messages*. Two classes can have CBO = 1 but MPC = 200 — that single partner is being hammered.

**Formal form.**

```
MPC(C) = sum over methods m in C of |{ call sites in m to methods of any D != C }|
```

**Why it matters for intimacy.** High MPC with low CBO means deep dependence on one partner: the textbook Inappropriate Intimacy signature. The two classes are not exchanging information through a small protocol, they are continuously poking each other.

**Thresholds.**

| MPC per method | Reading |
|----------------|---------|
| 0–3 | Healthy |
| 4–7 | Acceptable for coordinators |
| 8–15 | Likely Feature Envy / Intimacy candidate |
| 16+ | Almost certainly intimate; the method belongs on the other class |

A useful derived metric is **MPC / CBO** — average messages per partner. Values above 8 indicate concentrated dependency on a small set of classes.

## 3. Bidirectional edge count

**Definition.** Build the directed coupling graph G where an edge `A -> B` means A uses B. The bidirectional edge count is the number of unordered pairs {A, B} with both `A -> B` and `B -> A` present.

```
BiEdges(G) = |{ {A, B} : A -> B in G and B -> A in G }|
```

**Why it matters.** Inappropriate Intimacy is, by definition, mutual. A unidirectional dependency is normal; two-way coupling is where the smell lives. Bidirectional edges also block independent deployment, independent testing, and clean module extraction.

**Thresholds.**

| BiEdges / total edges | Reading |
|------------------------|---------|
| < 1% | Excellent |
| 1–3% | Tolerable, monitor |
| 3–8% | Cyclic intimacy is forming; refactor in next iteration |
| > 8% | Module is structurally tangled; large-scale rework needed |

For a single pair, any bidirectional edge between *entities* in the domain model (as opposed to associations between Aggregate Root and its parts) is a defect.

## 4. Fan-in and Fan-out

**Definitions.**

- **Fan-out(C)** = number of distinct classes `C` depends on (outgoing degree in the coupling graph). This equals outgoing CBO.
- **Fan-in(C)** = number of distinct classes that depend on `C` (incoming degree).

```
FanOut(C) = |{ D : C -> D }|
FanIn(C)  = |{ D : D -> C }|
```

**Why it matters.**

- High fan-out with low fan-in → the class is a "needy" client; often a God Class in disguise reaching into everything.
- High fan-in with low fan-out → the class is a stable abstraction (good — utilities, value objects, ports). Not intimate per se, but changes ripple widely.
- High fan-in AND high fan-out → an architectural hub; almost always involved in intimacy because it lives at the centre of every cycle.

**Thresholds for application classes.**

| Metric | Healthy | Warning | Refactor |
|--------|---------|---------|----------|
| Fan-out | 0–7 | 8–15 | 16+ |
| Fan-in | 0–10 (entities), 0–50 (utilities) | 11–25 / 51–100 | 26+ / 101+ |

Derived ratio: **Instability I = FanOut / (FanIn + FanOut)** (Martin's instability metric). Values near 0 are stable, near 1 are unstable. Domain entities should sit at I < 0.3; orchestrators at 0.5–0.8.

## 5. RFC — Response For a Class (supporting metric)

**Definition.** RFC = number of methods of `C` plus the number of distinct methods invoked by methods of `C`.

```
RFC(C) = |methods(C)| + |{ external methods reachable in one step from methods(C) }|
```

Tracks the total "surface" a single instance of `C` responds to. High RFC with high MPC is the strongest signal of Inappropriate Intimacy — the class is doing many things, and most of them are someone else's.

**Thresholds.** RFC > 100 in a non-controller class is a strong refactor signal.

## 6. LCOM* and intimacy

LCOM measures cohesion. It is not a coupling metric, but low cohesion paired with high CBO is the classic intimacy footprint — the class has multiple unrelated responsibilities and reaches out to a different partner for each. When triaging intimacy hot spots, sort classes by `CBO * (1 + LCOM)` and review the top of the list.

## 7. Tooling that produces these metrics

| Tool | Metrics emitted | Notes |
|------|-----------------|-------|
| CK (github.com/mauricioaniche/ck) | CBO, RFC, LCOM, WMC, DIT, NOC, MPC | Pure command-line, CSV output, designed for Java |
| PMD (rule category "design") | CouplingBetweenObjects, ExcessiveImports | Integrates with Maven/Gradle directly |
| SonarQube | Coupling, response time, cyclic deps | Web dashboards, history over time |
| Structure101 / NDepend (commercial) | Full coupling matrix, cycle visualization | Best for retro analysis of legacy code |
| jdeps (JDK) | Package-level dependency edges | Free, ships with JDK, scriptable |
| ArchUnit | Boolean enforcement of rules above | Not a metric tool, but breaks the build on violations |

## 8. Putting thresholds on a dashboard

A practical "intimacy gate" for CI:

```
FAIL build if any non-controller class has
    CBO > 20
 OR MPC per method > 15 (average across methods)
 OR FanOut > 16
 OR participates in a bidirectional edge with a domain entity
 OR is part of any package-level cycle
```

Track CBO, MPC, FanOut as time series. A 25% rise quarter-over-quarter is the early warning that intimacy is being introduced before any single threshold is breached.

## 9. Worked example — reading the numbers together

Suppose `OrderService` reports:

| Metric | Value |
|--------|-------|
| CBO | 9 |
| MPC | 124 (across 7 methods, avg 17.7) |
| FanOut | 9 |
| FanIn | 14 |
| RFC | 86 |
| LCOM | 0.6 |
| Bidirectional partners | 1 (`Order`) |

Diagnosis: CBO is acceptable, but average MPC per method (17.7) is in the refactor band; one of the nine partners is being hit constantly. The bidirectional edge with `Order` confirms it: `OrderService` reaches into `Order`, and `Order` calls back into `OrderService`. Refactor — push the intimate behaviour onto `Order` (or extract a new collaborator) and the MPC will halve and the bidirectional edge will disappear.

## 10. Reading list

The smell is named and the cures are catalogued in Fowler; the *why* (knowledge leaking across a boundary) is connascence; the *how much* is the CK suite.

1. **Martin Fowler** — *Refactoring: Improving the Design of Existing Code*, 2nd ed., Addison-Wesley, 2018. The **Inappropriate Intimacy** smell entry, and the four canonical cures it names: **Move Function** (Move Method), **Move Field**, **Extract Class** / **Inline Class**, **Hide Delegate** / **Remove Middle Man**, and **Change Bidirectional Association to Unidirectional**. This is the authoritative source for both the name and the refactoring catalogue.
2. **Martin Fowler** — *Refactoring* 2e, ch. 3 "Bad Smells in Code" (with Kent Beck). Places Inappropriate Intimacy next to its relatives **Feature Envy**, **Shotgun Surgery**, and **Message Chains**, and explains how the same two classes can exhibit several smells at once.
3. **Meilir Page-Jones** — *What Every Programmer Should Know About Object-Oriented Design*, Dorset House, 1995 (and *Fundamentals of Object-Oriented Design in UML*, 2000). The **connascence** taxonomy: Inappropriate Intimacy is high-strength, *dynamic*, *non-local* connascence — exactly the combination you most want to eliminate. Use connascence to argue *which* intimacy is worst.
4. **Shyam R. Chidamber & Chris F. Kemerer** — "A Metrics Suite for Object-Oriented Design", *IEEE TSE* 20(6), 1994. The original definition of **CBO** (Coupling Between Objects) and **RFC** used throughout this chapter. The empirical paper that made coupling measurable.
5. **David L. Parnas** — "On the Criteria To Be Used in Decomposing Systems into Modules", *CACM* 15(12), 1972. Information hiding: intimacy is the *violation* of the criterion this paper sets out. The senior file builds on it directly.
6. **Karl Lieberherr & Ian Holland** — "Assuring Good Style for Object-Oriented Programs" (Law of Demeter), *IEEE Software*, 1989. Getter-chain intimacy (`b.x.y.z`) is a Demeter violation; the law is the local rule, intimacy is the structural consequence.
7. **Joshua Bloch** — *Effective Java*, 3rd ed., Addison-Wesley, 2018. Items 15 (minimize accessibility), 16 (use accessors not public fields), 64 (refer to objects by interfaces). The Java-specific levers that keep CBO down.

See also the in-repo treatments: [`../../03-design-principles/04-cohesion-and-coupling/`](../../03-design-principles/04-cohesion-and-coupling/) for the coupling forces, and [`../../09-oo-design-and-modeling/02-oo-metrics-ck-suite/`](../../09-oo-design-and-modeling/02-oo-metrics-ck-suite/) for the full CK metric suite.

## Memorize this

- CBO counts partners; MPC counts messages; both matter.
- Bidirectional edges between domain classes are intimacy by definition.
- Fan-out > 15 in a domain class is almost always a refactor signal.
- Watch MPC / CBO (messages per partner) — high values mean concentrated, intimate dependence.
- Track metrics over time, not just at a point: a doubling in three months is the real alarm.
- Make at least one threshold a build-failing gate, or the numbers will only ever be looked at after the damage is done.
