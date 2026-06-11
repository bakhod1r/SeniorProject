# OO Metrics — the CK Suite — Specification Reading Guide

> OO metrics are not defined by the Java Language Specification — they live in the *software-engineering literature*. This guide maps every metric and claim in this topic to its canonical source, so you can trace each definition to the paper or book that established it. The four pillars are **Chidamber & Kemerer 1994** (the CK suite), **Robert C. Martin** (package metrics & the Main Sequence), **McCabe 1976** (cyclomatic complexity), and **Hitz & Montazeri 1996** (LCOM4). Tooling references close the file.

---

## 1. The CK suite — primary source

**Shyam R. Chidamber and Chris F. Kemerer**, *"A Metrics Suite for Object Oriented Design"*, **IEEE Transactions on Software Engineering**, vol. 20, no. 6, pp. 476–493, June 1994.

This is the origin of WMC, DIT, NOC, CBO, RFC, and LCOM. Read it for:

| Section of the paper                  | What it defines                                            |
| ------------------------------------- | --------------------------------------------------------- |
| Theoretical basis                     | Grounds the suite in Wand & Weber's ontology and Bunge's measurement theory |
| WMC definition                        | Σ of method complexities; complexity weighting left open  |
| DIT definition                        | Depth to the root of the inheritance tree                 |
| NOC definition                        | Count of immediate subclasses                             |
| CBO definition                        | Count of non-inheritance-related classes coupled to       |
| RFC definition                        | Response set = methods of class ∪ methods called by them  |
| LCOM definition                       | P − Q over method pairs (the original, "LCOM1")           |
| Viewpoints / analytical evaluation    | Each metric assessed against Weyuker's complexity properties |

The earlier conference version is **Chidamber & Kemerer, OOPSLA 1991**, *"Towards a Metrics Suite for Object Oriented Design"* — read the 1994 TSE version, which is the refined, citable one.

---

## 2. The critiques you must read alongside it

The CK definitions are ambiguous; the corrective literature is part of the canon:

- **N. Churcher & M. Shepperd**, *"Comments on 'A Metrics Suite for Object Oriented Design'"*, IEEE TSE 21(3), 1995. Demonstrates that "method" and the LCOM counting rules admit multiple interpretations → different numbers on identical code. This is *why* tools disagree.
- **M. Hitz & B. Montazeri**, *"Chidamber and Kemerer's Metrics Suite: A Measurement Theory Perspective"*, IEEE TSE 22(4), 1996. Exposes LCOM1's pathologies and introduces the **connected-components LCOM (LCOM4)** used today.
- **B. Henderson-Sellers**, *Object-Oriented Metrics: Measures of Complexity*, Prentice Hall, 1996. Defines the normalized **LCOM3 / LCOM\*** and surveys the field.

---

## 3. Empirical validation — what was actually established

- **V. Basili, L. Briand & W. Melo**, *"A Validation of Object-Oriented Design Metrics as Quality Indicators"*, IEEE TSE 22(10), 1996. The most-cited validation: on student C++ projects, WMC, CBO, RFC, DIT correlated with fault-proneness — modest effect sizes, student population.
- **R. Subramanyam & M. S. Krishnan**, *"Empirical Analysis of CK Metrics for Object-Oriented Design Complexity"*, IEEE TSE 29(4), 2003. WMC and CBO predictive of defects in industrial C++/Java.
- **K. El Emam et al.**, *"The Confounding Effect of Class Size on the Validity of Object-Oriented Metrics"*, IEEE TSE 27(7), 2001. **Critical reading:** shows class *size* confounds most CK metrics — control for size and much predictive power vanishes. This is the source of the "size is the confound" point in [`senior.md`](senior.md).

The honest takeaway, traceable to these papers: CK metrics are weakly-to-moderately predictive, size-confounded, and not a fault oracle.

---

## 4. Cyclomatic complexity — McCabe

**Thomas J. McCabe**, *"A Complexity Measure"*, **IEEE Transactions on Software Engineering**, vol. SE-2, no. 4, pp. 308–320, December 1976.

Defines **v(G) = E − N + 2P** on the control-flow graph (edges, nodes, connected components), and for a single method the practical form **1 + decision points**. The paper proposes the ≤ 10 guideline *with explicit hedging* ("some have been as high as 15") — read it to see that "CC < 10" is a recommendation, not a law. CC is the standard weight for WMC.

**Cognitive Complexity** (CC's nesting-aware successor) is specified in: **G. Ann Campbell**, *"Cognitive Complexity: A New Way of Measuring Understandability"*, SonarSource white paper, 2018 — the basis for SonarQube's cognitive-complexity metric.

---

## 5. Package metrics and the Main Sequence — Martin

**Robert C. Martin**, *Agile Software Development: Principles, Patterns, and Practices*, Prentice Hall, 2002 — chapters on the package-design principles. This is the canonical source for:

| Concept                       | Definition                                            |
| ----------------------------- | ----------------------------------------------------- |
| Afferent coupling **Ca**      | Classes outside the package depending inward          |
| Efferent coupling **Ce**      | Classes inside the package depending outward          |
| **Instability** I = Ce/(Ca+Ce)| 0 = stable, 1 = unstable                              |
| **Abstractness** A            | abstract types / total types in package               |
| **Main Sequence**             | the line A + I = 1                                    |
| **Distance** D = \|A+I−1\|    | distance from the Main Sequence                       |
| Zone of Pain / Uselessness    | (I≈0,A≈0) and (I≈1,A≈1)                               |
| SDP, SAP, ADP                 | Stable Dependencies / Stable Abstractions / Acyclic Dependencies Principles |

The same material appears, refined, in **Robert C. Martin**, *Clean Architecture*, Prentice Hall, 2017 (Part IV, "Component Principles"). Both are citable; the 2002 book is the original derivation.

---

## 6. Coupling strength — connascence

**Meilir Page-Jones**, *What Every Programmer Should Know About Object-Oriented Design*, Dorset House, 1995 (and *Fundamentals of Object-Oriented Design in UML*, Addison-Wesley, 2000). Defines **connascence** and its strength ordering (name → type → meaning → position → algorithm → execution → timing → value → identity). This is the dimension CBO cannot see — see [`senior.md`](senior.md). The modern treatment is at connascence.io (Jim Weirich's talks popularized it).

---

## 7. Where this connects to design principles

The metrics are the *measurable shadow* of principles defined elsewhere in this roadmap:

- **CBO, fan-in/out, instability** ⇄ [cohesion and coupling](../../03-design-principles/04-cohesion-and-coupling/) and [SOLID](../../03-design-principles/01-solid-principles/) (Dependency Inversion, Stable Dependencies).
- **LCOM** ⇄ cohesion (the Single Responsibility Principle's measurable form).
- **DIT / NOC** ⇄ the [fragile base class problem](../../03-design-principles/06-fragile-base-class-problem/) and [refused bequest](../../07-antipatterns-and-code-smells/04-refused-bequest/).
- **WMC + CBO + RFC + LCOM together** ⇄ [god class](../../07-antipatterns-and-code-smells/01-god-class/).

The original sources for those principles are listed in their own `specification.md` files; the foundational coupling/cohesion text is **Constantine & Myers**, *Structured Design*, Prentice Hall, 1979.

---

## 8. Reference tools (and their docs)

| Tool        | Reference                                                          |
| ----------- | ----------------------------------------------------------------- |
| **ck**      | M. Aniche, *ck — code metrics for Java*, github.com/mauricioaniche/ck |
| **SonarQube** | docs.sonarsource.com — Metric Definitions; Cognitive Complexity white paper |
| **JDepend** | clarkware.com/software/JDepend.html — implements Martin's Ca/Ce/A/I/D |
| **PMD**     | pmd.github.io — `design` ruleset (`CyclomaticComplexity`, `GodClass`, `CouplingBetweenObjects`, `ExcessiveClassLength`) |
| **Metrics / MetricsReloaded** | Eclipse Metrics plugin; IntelliJ MetricsReloaded |
| **ArchUnit** | archunit.org — structural/dependency rules as tests               |

For the **complexity × churn** hotspot model referenced in [`professional.md`](professional.md): **Adam Tornhill**, *Your Code as a Crime Scene* (Pragmatic Bookshelf, 2015) and *Software Design X-Rays* (2018) — behavioral code analysis.

---

## 9. Numbered reading list

1. **Chidamber & Kemerer**, *A Metrics Suite for Object Oriented Design*, IEEE TSE 20(6), 1994 — **the** primary source for all six CK metrics.
2. **McCabe**, *A Complexity Measure*, IEEE TSE SE-2(4), 1976 — cyclomatic complexity.
3. **Hitz & Montazeri**, *CK Metrics: A Measurement Theory Perspective*, IEEE TSE 22(4), 1996 — LCOM4.
4. **Churcher & Shepperd**, *Comments on...*, IEEE TSE 21(3), 1995 — the definitional ambiguities.
5. **Henderson-Sellers**, *Object-Oriented Metrics*, Prentice Hall, 1996 — LCOM3/LCOM\*, the survey.
6. **Basili, Briand & Melo**, *A Validation of OO Design Metrics*, IEEE TSE 22(10), 1996 — empirical validation.
7. **El Emam et al.**, *The Confounding Effect of Class Size*, IEEE TSE 27(7), 2001 — size as confound.
8. **Robert C. Martin**, *Agile Software Development: Principles, Patterns, and Practices*, Prentice Hall, 2002 — Ca/Ce/I/A, the Main Sequence, package principles.
9. **Robert C. Martin**, *Clean Architecture*, Prentice Hall, 2017 — Part IV, refined component metrics.
10. **Meilir Page-Jones**, *What Every Programmer Should Know About OO Design*, Dorset House, 1995 — connascence.
11. **Constantine & Myers**, *Structured Design*, Prentice Hall, 1979 — original coupling/cohesion theory.
12. **Adam Tornhill**, *Software Design X-Rays*, Pragmatic Bookshelf, 2018 — complexity × churn hotspots.

The metrics are *operationalizations* of design principles. The 1994 paper gives you the six definitions; the critiques (4, 5) tell you how to count them safely; the validations (6, 7) tell you how much to trust them; Martin (8, 9) lifts coupling to the architecture scale; Page-Jones (10) supplies the strength dimension the counts miss. Read in that order and you can defend or doubt any number a tool prints.
