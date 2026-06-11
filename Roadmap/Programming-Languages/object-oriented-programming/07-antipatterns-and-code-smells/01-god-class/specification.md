# God Class — Specification (Authoritative-Sources Reading Guide)

> The God Class is a *design* defect, not a language defect. There is no clause in the JLS that forbids a 5,000-line class — `javac` will compile it happily. So this file does not cite the language spec; it cites the canonical *literature* where every claim made across `junior.md`…`optimize.md` originates. Four bodies of work define this antipattern: **Fowler's *Refactoring*** (the *Large Class* smell and its two cures, *Extract Class* and *Extract Superclass*), **Riel's *OO Design Heuristics*** (the cohesion/responsibility heuristics that say a class should be small and behaviour should sit with data), **Brown et al.'s *AntiPatterns*** (which named *the Blob*), and **Martin's *Clean Code* / *Agile PPP*** (the Single Responsibility Principle, "one reason to change"). Below, each claim this topic makes is mapped to the page-level source, with the detection-metric lineage (Chidamber & Kemerer, Lanza & Marinescu) traced separately because the metrics predate and underwrite the tooling.

---

## 1. The names — who coined what

The same defect appears in four vocabularies. Knowing which book a reviewer is quoting tells you which fix they will reach for.

| Name | Coined in | Emphasis | The cure that book names |
|------|-----------|----------|--------------------------|
| **Large Class** | Fowler, *Refactoring* (1999; 2e 2018), ch. "Bad Smells in Code" | *too many fields / too much code* in one class | *Extract Class*, *Extract Superclass*, *Replace Type Code with Subclasses* |
| **The Blob** | Brown, Malveau, McCormick, Mowbray, *AntiPatterns* (1998), ch. 5 | *one procedural controller* surrounded by passive data classes | refactor toward distributed responsibility |
| **God Class / God Object** | Riel, *OO Design Heuristics* (1996), Heuristic 3.x; popularised under "God" by Brown et al. | *a class that hoards system intelligence* | move behaviour to the data it operates on |
| **SRP violation** | Martin, *Agile Software Development: Principles, Patterns, and Practices* (2002); *Clean Code* (2008), ch. 10 | *more than one reason to change* | split by axis-of-change / actor |

These are not four defects; they are four lenses on one defect. Fowler measures it (size), Brown narrates it (a controller hub draining anemic data classes — note the explicit link to `../02-anemic-domain-model/`), Riel diagnoses it (responsibility misplacement), and Martin gives the test ("one reason to change").

---

## 2. Fowler, *Refactoring* 2e — the smell and its cures

This is the primary source for the *junior/middle* framing and for the entire `optimize.md` refactoring playbook.

### 2.1 The smell: *Large Class*

> *Refactoring*, 2e (Addison-Wesley, 2018), ch. 3, "Bad Smells in Code", §"Large Class".

Fowler's two operational signals, quoted in spirit:

- **Too many instance variables.** "When a class is trying to do too much, it often shows up as too many fields." Duplicated prefixes among field names (`depositAmount`, `depositDate`, `depositAccount`) signal a latent class waiting to be extracted — this is the seed of the *Extract Class* move.
- **Too much code.** A class with too many lines of code is "prime breeding ground for duplicated code, chaos, and death." The same prefix/cluster signal applies to *methods*, not just fields.

Fowler's diagnostic instruction — *look for clumps of fields and the methods that use them* — is exactly the field-clustering step described in `middle.md` §"Map the fields" and `professional.md` §9. The clusters are the seams.

### 2.2 The cures Fowler prescribes for *Large Class*

| Refactoring | *Refactoring* 2e chapter | When to apply to a God Class |
|-------------|--------------------------|------------------------------|
| **Extract Class** | ch. 7 | A subset of fields + the methods using them form a coherent concept → move them to a new class held by the original. The primary cure. |
| **Extract Superclass** | ch. 12 | Two subsets represent variants of one idea → lift shared state/behaviour to a parent. |
| **Replace Type Code with Subclasses** | ch. 12 | A `switch (type)` inside the god class fans out behaviour by a type field → polymorphism. |
| **Extract Function** / **Move Function** | ch. 6 / ch. 8 | Intermediate steps: shrink a fat method, then relocate it toward the data it uses (Information Expert). |
| **Replace Conditional with Polymorphism** | ch. 10 | The god class's giant dispatch `if/else` ladder → subclass or strategy. |

> *Extract Class* (Fowler 2e, ch. 7) is the canonical, mechanical recipe: create the new class; use *Move Field* and *Move Function* to relocate members one at a time, keeping tests green after each move; decide whether to expose the new class or keep it hidden behind the old one's interface. This is precisely the Strangler-style, one-cluster-at-a-time decomposition in `professional.md` §9 and the graded `tasks.md`.

---

## 3. Brown et al., *AntiPatterns* — the Blob

> William J. Brown, Raphael C. Malveau, Hays W. McCormick III, Thomas J. Mowbray, *AntiPatterns: Refactoring Software, Architectures, and Projects in Crisis* (Wiley, 1998), ch. 5, "The Blob".

What this book contributes that Fowler does not:

- **The shape.** The Blob is "a single class with a large number of attributes, operations, or both" that "monopolises the processing", surrounded by **data classes** that hold state but no behaviour. This is the structural picture in `junior.md` §2 (`OrderManager` plus its passive `Order` DTOs) and the explicit bridge to the *Anemic Domain Model* antipattern (`../02-anemic-domain-model/`): the Blob and the anemic model are two halves of the same dysfunction — a procedural hub plus data bags.
- **Root causes.** Brown et al. name them: lack of an OO architecture, no enforcement of design, the path of least resistance ("just add it to the existing class"), and iterative growth without refactoring. These are the "root causes" enumerated in `middle.md` and `senior.md`.
- **The refactored solution.** Reallocate responsibilities so behaviour moves to the data classes, decomposing the Blob into "a set of cooperating, smaller objects" — the same *move-method-toward-Information-Expert* strategy GRASP formalises (see §6).

---

## 4. Riel, *OO Design Heuristics* — why behaviour belongs with data

> Arthur J. Riel, *Object-Oriented Design Heuristics* (Addison-Wesley, 1996).

Riel's heuristics are the "why" beneath `senior.md`. The God-Class-relevant ones:

| # | Heuristic (paraphrased) | What it tells you about the God Class |
|---|--------------------------|----------------------------------------|
| 2.1 | Distribute system intelligence horizontally as uniformly as possible. | A God Class is the *failure* of this heuristic — intelligence pooled in one node. |
| 2.8 | A class should capture **one and only one** key abstraction. | The operational meaning of "single responsibility" at the class level. |
| 2.9 | Keep related data and behaviour in one place. | The Information Expert rule; the antidote to *Feature Envy* (`../03-feature-envy/`). |
| 3.x | Beware classes with much non-communicating behaviour (methods that touch disjoint field subsets). | The informal statement of **low cohesion (high LCOM)** — see `../../03-design-principles/04-cohesion-and-coupling/`. |
| 5.x | Distribute responsibility so no single object becomes a "god". | Riel's explicit warning against the God Object. |
| — | Be suspicious of classes named `Manager`, `System`, `Subsystem`, `Driver`, `Controller`. | The naming smell catalogued in `professional.md` §7. |

Riel is the bridge from the *named smell* to the *measurable property*: "non-communicating methods" is LCOM in prose, written before LCOM had a formula.

---

## 5. Martin — the Single Responsibility Principle

> Robert C. Martin, *Agile Software Development: Principles, Patterns, and Practices* (Prentice Hall, 2002), ch. 8; *Clean Code* (Prentice Hall, 2008), ch. 10 "Classes"; *Clean Architecture* (2017), ch. 7.

- **The definition that matters.** SRP: *a class should have only one reason to change.* Martin later sharpened "reason to change" to **"one actor / one stakeholder group"** (*Clean Architecture*, ch. 7) — the people who request changes, not the abstract responsibilities. A God Class fails because **several actors** (billing, shipping, notifications, audit) all force edits to the same file, which is the organisational signal `professional.md` §8 ties to Conway's Law.
- **Clean Code, ch. 10.** "Classes should be small. The first rule... is that they should be small. The second rule... is that they should be smaller than that." Martin measures size in *responsibilities*, not lines, and uses cohesion as the proxy: when a class loses cohesion (LCOM rises), *split it* — which is *Extract Class* by another name. This is the source of the `optimize.md` "split to raise cohesion" criterion.
- The "G"-series smells in *Clean Code* ch. 17 — esp. **G in the form of "class doing too much"** — are the review-time vocabulary in `find-bug.md`.

---

## 6. Larman — GRASP: where the responsibilities *should* go

> Craig Larman, *Applying UML and Patterns*, 3e (Prentice Hall, 2004), ch. 17–25 (GRASP).

Fowler/Brown/Riel/Martin tell you a class is *too big*; GRASP tells you *where each piece belongs once you split it*. The two patterns load-bearing for decomposing a God Class:

- **Information Expert** — assign a responsibility to the class that has the information needed to fulfil it. This is the formal justification for *move-method toward the data* (`junior.md`, `middle.md`, `optimize.md`). A god class violates Information Expert by holding behaviour far from the data it touches.
- **High Cohesion** and **Low Coupling** — GRASP's two evaluative patterns; the God Class is the canonical worked example of *low* cohesion. See the dedicated treatment in `../../03-design-principles/04-cohesion-and-coupling/` and GRASP's home at `../../09-oo-design-and-modeling/01-grasp-responsibility-assignment/`.

The decomposition logic across this topic is: *Fowler's Extract Class supplies the mechanics; GRASP's Information Expert supplies the target.*

---

## 7. The detection metrics — Chidamber & Kemerer → Lanza & Marinescu

The numeric thresholds quoted in `senior.md` and wired into CI in `professional.md` are not folklore; they descend from two papers/books.

### 7.1 The CK suite (the metrics themselves)

> Shyam R. Chidamber, Chris F. Kemerer, *A Metrics Suite for Object Oriented Design*, IEEE TSE 20(6), 1994.

| Metric | CK definition | God-Class signal |
|--------|---------------|------------------|
| **WMC** — Weighted Methods per Class | Σ cyclomatic complexity over methods | high → the class does too much work |
| **RFC** — Response For a Class | methods declared + methods invoked | high → wide reach |
| **CBO** — Coupling Between Objects | count of coupled classes | high → fan-out hub |
| **LCOM** — Lack of Cohesion in Methods | (CK's original pair-based form) | high → really several classes |

LCOM was refined later: **LCOM4** (Hitz & Montazeri, 1995 — connected components of the method/field graph) and **TCC/LCC** (Bieman & Kang, 1995) are the cohesion variants the tools actually compute, because CK's original LCOM has known degeneracies. The full CK treatment, with formulas, lives at `../../09-oo-design-and-modeling/02-oo-metrics-ck-suite/` — this topic *uses* those metrics; it does not re-derive them.

### 7.2 The God-Class *detection strategy* (the metric that names the smell)

> Michele Lanza, Radu Marinescu, *Object-Oriented Metrics in Practice* (Springer, 2006), ch. 4–5.

Marinescu's **God Class detection strategy** is a *composite* predicate, not a single threshold — which is why `senior.md` insists on "two or more metrics over threshold":

```
GodClass  ⟺  ATFD > FEW           (Access To Foreign Data — reaches into other classes' data)
          AND WMC ≥ VERY_HIGH     (does a lot)
          AND TCC < ONE_THIRD     (Tight Class Cohesion is low — methods don't cohere)
```

- **ATFD** (Access To Foreign Data) is the formal expression of *Feature Envy* (`../03-feature-envy/`) accumulated at class scale.
- **TCC** (Tight Class Cohesion, Bieman & Kang) replaces LCOM in this strategy because it is normalised to [0,1].

This three-part rule is exactly what **PMD's `GodClass` rule** implements (`category/java/design.xml/GodClass`) and what **SonarQube** surfaces as a maintainability issue. The tooling is downstream of this 2006 formulation.

---

## 8. Detection tooling — what implements the above

| Tool | What it computes / enforces | Lineage |
|------|------------------------------|---------|
| **PMD** | `GodClass`, `ExcessiveClassLength`, `TooManyMethods`, `TooManyFields`, `CouplingBetweenObjects`, `CyclomaticComplexity` | Lanza & Marinescu strategy + CK |
| **SonarQube** | maintainability rating, complexity per class/function, cognitive complexity, duplicated blocks | CK + SonarSource rules |
| **ck (the *ck* metrics tool, Aniche)** | per-class CK suite (WMC, RFC, CBO, LCOM, LCOM*, TCC, LCC) as CSV for analysis/CI gates | direct CK 1994 implementation |
| **ArchUnit** | custom JUnit-runnable rules: "no domain class > N public methods", "domain must not depend on infrastructure" | structural assertions, not metrics |
| **Checkstyle** | `ClassDataAbstractionCoupling`, `ClassFanOutComplexity`, `JavaNCSS`, `MethodCount` | size/coupling backstops |
| **IntelliJ "Metrics Reloaded" / JArchitect / NDepend** | interactive WMC/CBO/LCOM dashboards | CK |

The point of this table for a reviewer: *don't argue about whether a class is "too big" — let the tool that implements Marinescu's strategy decide, and treat its output as evidence.* The concrete rule XML and quality-gate JSON live in `professional.md`; this file records *why those numbers exist*.

---

## 9. Where this topic deliberately does **not** rely on the spec

- The JLS imposes hard limits (e.g. **65535 constant-pool entries**, method bytecode ≤ 64 KB — JVMS §4.7.3) that a truly monstrous god method can hit, producing `code too large`. That is a *symptom* surfacing at compile time, not a definition of the smell. A God Class is a problem at 300 lines, long before any JVMS limit.
- No language keyword prevents a God Class. `sealed`, `final`, modules, and access modifiers help you *enforce a decomposition once you've designed it* (see the SOLID spec guide at `../../03-design-principles/01-solid-principles/specification.md`), but they cannot detect the smell. Detection is metric-based (§7); prevention is architectural (`professional.md`).

---

## 10. Reading list

1. **Martin Fowler, *Refactoring: Improving the Design of Existing Code*, 2nd ed.** (Addison-Wesley, 2018) — ch. 3 "Bad Smells in Code" (*Large Class*); ch. 7 *Extract Class*; ch. 12 *Extract Superclass* / *Replace Type Code with Subclasses*; ch. 6/8 *Extract & Move Function*. The single most important source for this topic.
2. **Robert C. Martin, *Clean Code*** (Prentice Hall, 2008) — ch. 10 "Classes" (SRP, "classes should be small"); ch. 17 (the G-smells).
3. **Robert C. Martin, *Agile Software Development: Principles, Patterns, and Practices*** (Prentice Hall, 2002) and **_Clean Architecture_** (2017), ch. 7 — SRP as "one actor / one reason to change".
4. **William J. Brown et al., *AntiPatterns*** (Wiley, 1998) — ch. 5 "The Blob": shape, root causes, and the data-class coupling that ties it to the Anemic Domain Model.
5. **Arthur J. Riel, *Object-Oriented Design Heuristics*** (Addison-Wesley, 1996) — Heuristics 2.1, 2.8, 2.9, and the "one key abstraction" / "Manager-suffix suspicion" rules.
6. **Craig Larman, *Applying UML and Patterns*, 3rd ed.** (Prentice Hall, 2004) — GRASP: *Information Expert*, *High Cohesion*, *Low Coupling* — where the extracted responsibilities should land.
7. **S. R. Chidamber, C. F. Kemerer, *A Metrics Suite for Object Oriented Design*,** IEEE TSE 20(6), 1994 — the WMC/RFC/CBO/LCOM definitions.
8. **M. Hitz, B. Montazeri (1995)** and **J. Bieman, B. Kang (1995)** — LCOM4 and TCC/LCC, the cohesion variants the tools actually compute.
9. **Michele Lanza, Radu Marinescu, *Object-Oriented Metrics in Practice*** (Springer, 2006) — ch. 4–5, the *God Class detection strategy* (ATFD + WMC + TCC) that PMD's `GodClass` rule implements.
10. **Michael Feathers, *Working Effectively with Legacy Code*** (Prentice Hall, 2004) — characterization tests and seams: the safety net that makes *Extract Class* on a live god class non-destructive (the practical companion to `professional.md` §9).

---

**Memorize this:** The God Class has four canonical names — Fowler's *Large Class* (measured by size), Brown's *Blob* (a procedural hub + anemic data), Riel's *God Object* (misplaced system intelligence), Martin's *SRP violation* (more than one actor demands changes). The fix every source converges on is the same: **Extract Class** (Fowler's mechanics) moving each responsibility **toward its Information Expert** (Larman's target), with detection delegated to the **Lanza–Marinescu strategy** (ATFD + high WMC + low TCC) that PMD and SonarQube implement on top of the **CK metrics**.
