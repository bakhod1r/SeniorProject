# Coupling & Cohesion Metrics — Interview Questions

> **Roadmap:** [Code Quality Metrics](../README.md) → Coupling & Cohesion Metrics
> *A coupling interview rarely asks "what is coupling." It asks "this module has high afferent coupling — what does that mean for changing it," and then watches whether you can separate the kind of dependency from the count of it, compute Instability without fumbling the formula, and resist the urge to rank teams by LCOM. This page is the question bank, with model answers and a note on what each question is really probing.*

---

## Table of Contents

1. [How to Use This Page](#how-to-use-this-page)
2. [Theme 1 — Fundamentals](#theme-1--fundamentals)
3. [Theme 2 — The Types and Ladders](#theme-2--the-types-and-ladders)
4. [Theme 3 — Computable Metrics](#theme-3--computable-metrics)
5. [Theme 4 — Martin's Package Metrics](#theme-4--martins-package-metrics)
6. [Theme 5 — Structural vs Temporal Coupling](#theme-5--structural-vs-temporal-coupling)
7. [Theme 6 — Scenario and Judgment](#theme-6--scenario-and-judgment)
8. [Theme 7 — Governance and Gaming](#theme-7--governance-and-gaming)
9. [Rapid-Fire Round](#rapid-fire-round)
10. [Red Flags and Green Flags](#red-flags-and-green-flags)
11. [Summary](#summary)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## How to Use This Page

Each question carries three things: **Q** (the prompt), **what the interviewer is really testing**, and **A** (a model answer at the depth a strong candidate gives). Don't memorize the answers — internalize the *distinctions* they keep returning to:

- **coupling vs cohesion** (relationships *between* modules vs how related a module's *insides* are)
- **kind vs count** (the *type* of a dependency vs how many there are — content coupling counts the same as data coupling in a fan-in number, but they are not the same risk)
- **afferent vs efferent** (who depends on *me* vs who *I* depend on — they fail in opposite directions)
- **structural vs temporal** (a dependency the compiler can see vs one only the commit history reveals)

Nearly every question in this bank is one of those four distinctions wearing a costume. The candidates who do well are the ones who *name the distinction* before reaching for a number.

---

## Theme 1 — Fundamentals

### Q1.1 — Define coupling and cohesion. Why is "low coupling, high cohesion" the goal?

> **Testing:** Whether you can state the two ideas precisely *and* explain why the pairing matters, rather than reciting a slogan.

**A.** **Coupling** is the degree of interdependence *between* modules — how much one module must know about another's internals to work. **Cohesion** is how well the elements *inside* a single module belong together toward one purpose. They are orthogonal axes: coupling looks outward at the seams, cohesion looks inward at the contents.

We want **low coupling** because it localizes change: if module A barely knows module B, a change in B rarely ripples into A, so I can understand, test, and modify A in isolation. We want **high cohesion** because it localizes *concepts*: when everything in a module serves one job, a requirement change touches one module instead of being smeared across five.

The pairing is not a coincidence — they are two halves of the same force. The classic phrasing is **"maximize cohesion within modules, minimize coupling between them."** If you push related things *into* the same module (cohesion up), you simultaneously remove the cross-module calls that would have existed if they were split apart (coupling down). Low cohesion almost guarantees high coupling, because a grab-bag module has to reach out to many others to do its unrelated jobs. So they rise and fall together: good module boundaries deliver both at once.

### Q1.2 — Give a concrete example of high coupling and one of high cohesion.

> **Testing:** Whether the abstractions are real to you or just vocabulary.

**A.** **High (bad) coupling:** an `OrderService` that reaches into `Inventory`'s database table directly — `SELECT stock FROM inventory WHERE ...` — instead of calling `inventory.reserve(sku)`. Now `OrderService` knows Inventory's *schema*. Rename a column and OrderService breaks, silently and at runtime. The two modules share a hidden contract (the table layout) that no interface declares.

**High (good) cohesion:** a `Money` class whose every method — `add`, `multiply`, `format`, `convertTo` — operates on the same two fields (amount, currency) toward one purpose: representing money correctly. There's no method in there that belongs somewhere else. Contrast a `Utils` class with `parseDate`, `sendEmail`, and `hashPassword` — those share nothing but the file they're trapped in; that's *coincidental* cohesion, the worst kind.

### Q1.3 — Can coupling ever be too low? Is more cohesion always better?

> **Testing:** Whether you treat these as engineering tradeoffs or religious absolutes — a strong senior signal.

**A.** Yes to both cautions. **Coupling can't go to zero and shouldn't** — modules have to collaborate, so the goal is *appropriate* coupling through *narrow, stable interfaces*, not *no* dependencies. Driving coupling artificially low often means introducing layers of indirection, event buses, and dependency-injection ceremony that make a simple call hop through five files. That's *accidental* complexity bought to win a metric. The honest target is: depend on *abstractions*, depend on *few* things, and depend on *stable* things.

And cohesion can be pushed to a pathological extreme: split a class so aggressively that one responsibility is scattered across a dozen one-method classes, and now you've traded low cohesion for high coupling between the fragments — you've just moved the problem to the seams. The Single Responsibility Principle is "one reason to change," not "one method per class." Both metrics describe a *sweet spot*, not a direction to maximize without limit.

---

## Theme 2 — The Types and Ladders

### Q2.1 — Walk the coupling ladder from worst to best. Which is the worst and why?

> **Testing:** Whether you know coupling has *kinds*, ordered by severity — not just "amount."

**A.** From worst (tightest) to best (loosest), the classic structured-design ladder:

1. **Content coupling** — module A reaches *inside* B and modifies B's internals directly (writes B's private state, jumps into the middle of B's code). The worst, because it depends on B's implementation, not its interface; B can't change anything without risking A.
2. **Common coupling** — modules share global mutable state. Any module can corrupt the shared data; failures are non-local and order-dependent.
3. **External coupling** — modules share an imposed external format or protocol (a file layout, a device, a wire format).
4. **Control coupling** — A passes B a *flag* that tells B which branch to take (`render(data, isPdf=true)`). A now knows about B's internal control flow.
5. **Stamp coupling** — A passes B a whole composite (a struct/object) when B only needs one field. B is now coupled to fields it doesn't use.
6. **Data coupling** — A passes B exactly the primitive data it needs, nothing more (`area(width, height)`). The loosest meaningful coupling and the target.

**The worst is content coupling** because it bypasses the interface entirely: there is no contract left to honor, so *any* internal change to B can break A, and the dependency is invisible from B's public surface. (Some taxonomies place a "message coupling" rung below data coupling — interaction only via message passing with no shared data at all — as the loosest of all.)

### Q2.2 — Walk the cohesion ladder from worst to best, with an example of each end.

> **Testing:** Symmetric knowledge — cohesion also has a named spectrum, and you should know both poles cold.

**A.** From worst (least cohesive) to best (most cohesive):

1. **Coincidental** — elements grouped for no reason (a `Helpers` / `Utils` dumping ground). *Worst.*
2. **Logical** — elements grouped because they're the same *kind* of thing, selected by a flag (one `handleEvent(type)` that does keyboard, mouse, and network events).
3. **Temporal** — grouped because they happen at the same *time* (an `init()` that opens a file, seeds a cache, and starts a thread — related only by "runs at startup").
4. **Procedural** — grouped because they execute in sequence, but on different data.
5. **Communicational** — grouped because they operate on the *same data* (read a record, then validate that same record).
6. **Sequential** — the output of one element is the input to the next (a pipeline: parse → transform → emit).
7. **Functional** — every element contributes to *one* well-defined task, nothing more, nothing less (a `sqrt(x)` module). *Best.*

**Worst example (coincidental):** `class Misc { parseCsv(); pingServer(); formatCurrency(); }` — three unrelated jobs in one box. **Best example (functional):** `class JwtVerifier` whose every method exists solely to verify a JWT — decode, check signature, check expiry. There's no method you'd be surprised to find there, and none missing. The ladder matters because moving *up* it usually moves coupling *down*: a functionally cohesive module needs fewer outside collaborators.

### Q2.3 — A function takes a `boolean isAdmin` and branches on it. What coupling kind is that, and how do you fix it?

> **Testing:** Recognizing **control coupling** in the wild and knowing the standard refactor.

**A.** That's **control coupling**: the caller passes a flag that dictates the callee's internal control flow, so the caller has to know *how* the callee branches — a leak of implementation into the interface. The smells that follow are the function doing two jobs and growing more boolean parameters over time (`process(data, isAdmin, dryRun, verbose)` — a "flag soup").

The fix depends on intent. If the boolean selects between two genuinely different behaviors, **split into two functions** (`renderForAdmin()` / `renderForUser()`) so each call site states its intent and neither function carries a branch it doesn't need. If the variation is open-ended, **replace the flag with polymorphism / a strategy** so adding a new mode doesn't mean editing the branch. Either way you've converted control coupling into data coupling or eliminated the dependency on internal flow.

---

## Theme 3 — Computable Metrics

### Q3.1 — Define afferent and efferent coupling, fan-in and fan-out. Which direction is which?

> **Testing:** The single most-confused pair in this whole topic — directionality.

**A.** For a given module:

- **Afferent coupling (Ca)** = the number of *external* modules that depend *on* this one. Arrows pointing **in**. Same idea as **fan-in**. High Ca means "many things lean on me" — I am *used*.
- **Efferent coupling (Ce)** = the number of external modules *this one depends on*. Arrows pointing **out**. Same idea as **fan-out**. High Ce means "I lean on many things" — I am *needy*.

The mnemonic: **a**fferent = **a**rriving (incoming, toward me); **e**fferent = **e**xiting (outgoing, away from me). They're not interchangeable and they imply opposite risks. High **Ca** means I'm *expensive to change* (many dependents to break) but *important*. High **Ce** means I'm *fragile* (many dependencies that can break *me*) and hard to test in isolation. A module that is both high-Ca and high-Ce is a serious problem — central *and* brittle.

### Q3.2 — What is CBO in the CK suite, and what does LCOM try to measure?

> **Testing:** Familiarity with the Chidamber & Kemerer metrics by name, and what each captures.

**A.** **CBO (Coupling Between Objects)** counts, for a class, the number of *other* classes it is coupled to — it uses their methods or fields, or they use its. It's essentially a combined, undirected coupling count for a class (it doesn't split afferent from efferent). High CBO means the class is entangled with many others, so it's hard to reuse, hard to test, and sensitive to changes anywhere in its neighborhood.

**LCOM (Lack of Cohesion of Methods)** tries to measure *cohesion inversely* — a *high* LCOM means *low* cohesion (the name is "lack of cohesion," so up is bad). The intuition: a cohesive class has methods that all touch the same fields; an incohesive one has clusters of methods touching disjoint field sets, which is a sign two responsibilities are hiding in one class. The original LCOM1/LCOM2 had well-known flaws (they can report zero for obviously incohesive classes, and getters/setters distort them), which is why **LCOM4** — based on connected components — is the version most people actually use.

### Q3.3 — Compute LCOM4 for this class. Methods and the fields/methods they touch: `m1` uses field `a`; `m2` uses field `a` and field `b`; `m3` uses field `c`; `m4` calls `m3`. What is LCOM4 and what does it tell you?

> **Testing:** Whether you can actually run the connected-components definition, not just name it.

**A.** **LCOM4 = the number of connected components** in a graph where nodes are the class's methods, and an edge joins two methods if they **share a field** *or* **one calls the other**. Let me build the graph:

- `m1` touches `{a}`.
- `m2` touches `{a, b}`.
- `m3` touches `{c}`.
- `m4` calls `m3` (and touches no field directly).

Edges:
- `m1` — `m2`: share field `a`. ✅ edge.
- `m3` — `m4`: `m4` calls `m3`. ✅ edge.
- Any link between the `{m1, m2}` side and the `{m3, m4}` side? `m1`/`m2` touch `a, b`; `m3`/`m4` touch `c` and each other. No shared field, no call across. ❌ no edge.

So there are **two connected components**: `{m1, m2}` and `{m3, m4}`. **LCOM4 = 2.**

Interpretation: **LCOM4 = 1** means the class is cohesive (everything connects). **LCOM4 = 0** means the class has no methods. **LCOM4 ≥ 2** is the actionable signal — it means the class contains that many *independent responsibility clusters* that don't touch each other, and could likely be **split into two classes** (`{m1, m2}` over fields `a, b`, and `{m3, m4}` over field `c`) with no shared state lost. That's LCOM4 doing exactly its job: surfacing a hidden seam.

### Q3.4 — What routinely fools LCOM, and how do you avoid drawing the wrong conclusion?

> **Testing:** Whether you trust the metric blindly or know its failure modes.

**A.** Several things distort it:

- **Getters and setters** each touch exactly one field and nothing else, so a data class full of accessors can look incohesive (lots of disconnected single-field methods) when it's a legitimately simple struct. Many tools let you exclude trivial accessors.
- **Constructors** often touch *every* field, which artificially *connects* all components and masks real incohesion — a constructor can make a genuinely two-responsibility class report LCOM4 = 1. You usually exclude the constructor from the graph.
- **Utility/static methods** that touch no instance fields show up as isolated nodes, inflating the count without indicating a real responsibility split.
- **Inherited fields/methods** — tools differ on whether they count them, so the same class scores differently across tools.

The discipline: treat a high LCOM as a *question* ("is there a hidden second responsibility here?"), open the class, and check whether the clusters are *semantically* distinct. The metric points; the human decides. Never let an LCOM threshold auto-fail a build without a person confirming the split is real.

---

## Theme 4 — Martin's Package Metrics

### Q4.1 — Define Instability. Give the formula and interpret the two extremes.

> **Testing:** Whether you can state I = Ce / (Ca + Ce) and reason about what 0 and 1 mean.

**A.** **Instability** measures how susceptible a package is to change driven by its dependencies:

```
I = Ce / (Ca + Ce)
```

where `Ce` is efferent (outgoing) coupling and `Ca` is afferent (incoming) coupling. It ranges from 0 to 1.

- **I = 0 (maximally stable):** Ce = 0 — the package depends on *nothing* but many things depend on it (Ca high). It's hard to change *because* changing it ripples outward to all its dependents, and it has no outgoing dependencies that could force it to change. A foundational `core` or `domain` package should sit here.
- **I = 1 (maximally unstable):** Ca = 0 — *nothing* depends on this package, but it depends on many others. It's easy and safe to change because no one will be hurt, and it's at the mercy of everything it imports. A top-level `main` / application-entry / UI package belongs here.

"Stable" here is precise and counterintuitive: it does **not** mean bug-free or high-quality. It means **hard to change** because of the *weight of dependents*. Instability is a structural property, not a quality judgment.

### Q4.2 — Define Abstractness, then explain the Main Sequence and how distance from it is computed.

> **Testing:** The second axis and how Martin combines the two into one actionable number.

**A.** **Abstractness (A)** = (number of abstract classes/interfaces in the package) / (total classes in the package). It ranges 0 (entirely concrete) to 1 (entirely abstract — pure interfaces, no implementation).

Martin's insight is that **A and I should be inversely related**. Plot every package on a graph with I on the x-axis and A on the y-axis. The healthy diagonal line from `(0, 1)` to `(1, 0)` is the **Main Sequence**: it says *stable packages should be abstract* (so dependents lean on abstractions that rarely change) and *unstable packages should be concrete* (it's fine for volatile, depended-upon-by-no-one code to be full of concrete detail).

**Distance from the Main Sequence (D)** measures how far a package strays:

```
D = | A + I − 1 |
```

A package *on* the line has `A + I = 1`, so `D = 0` (ideal). The farther from zero, the more the package is mis-positioned — abstract where it should be concrete, or concrete where it should be abstract. `D` (sometimes normalized as `Dn`) is the single number you can track and threshold, because it folds both axes into "how badly placed is this package."

### Q4.3 — What are the "zone of pain" and "zone of uselessness"? Where on the graph are they?

> **Testing:** The two failure corners and what each one *is*.

**A.** They're the two corners of the I/A graph farthest from the Main Sequence:

- **Zone of pain** — **bottom-left: low I, low A** (stable *and* concrete). Many packages depend on it (low instability), but it's full of concrete implementation with no abstraction to depend on instead. So it's *rigid*: it's painful to change because of all the dependents, yet it has *concrete detail that genuinely needs to change*. Database schemas, concrete utility libraries everyone imports, and mature framework internals live here. The pain is the collision of "everyone depends on me" with "my guts keep needing to change."
- **Zone of uselessness** — **top-right: high I, high A** (unstable *and* abstract). It's highly abstract — interfaces, abstractions — but *nothing depends on it*. Abstractions that no one uses are dead weight: speculative interfaces, over-engineered abstraction layers built for a future that never came, leftover scaffolding. It's "useless" not because it's wrong but because it's effort with no consumers.

The mnemonic: **pain = stable + concrete** (can't change what everyone needs but it needs changing); **uselessness = abstract + nobody cares**.

### Q4.4 — What do the SDP and SAP principles say, and how do they relate to these metrics?

> **Testing:** Whether you know the principles the metrics were invented to *measure*.

**A.** They're the two package dependency principles the metrics operationalize:

- **SDP — Stable Dependencies Principle:** *depend in the direction of stability.* A package should only depend on packages **more stable than itself** — i.e., dependencies should point toward lower Instability (toward I = 0). If an unstable package is depended upon by a stable one, the stable package inherits the instability through the back door, which the metric catches as an arrow pointing the wrong way (a high-I package having dependents).
- **SAP — Stable Abstractions Principle:** *a package should be as abstract as it is stable.* The more stable a package (low I), the more abstract (high A) it should be, so that its stability doesn't make it rigid — you can extend behavior through the abstractions without modifying the stable package. SAP is essentially the Open/Closed Principle at package scale.

Together, SDP + SAP *are* the Main Sequence: SDP governs the *direction* of dependencies (toward stability), SAP governs the *abstractness* that stability demands, and `D = |A + I − 1|` is the yardstick that tells you when a package violates the combination. The metrics aren't arbitrary numbers — each one exists to make a specific design principle measurable.

---

## Theme 5 — Structural vs Temporal Coupling

### Q5.1 — What is temporal (logical) coupling, and how is it different from the structural coupling a compiler sees?

> **Testing:** Whether you know the most valuable coupling signal is *invisible in the code*.

**A.** **Structural coupling** is a dependency the code makes explicit: an `import`, a function call, a shared type. A compiler or static analyzer can see it by reading the source. **Temporal coupling** — also called *logical* or *evolutionary* coupling — is the tendency of two files to **change together in the same commits**, even when there's no visible reference between them. You discover it only by mining version-control history, not by reading the code.

The difference matters because temporal coupling catches dependencies that structural analysis *misses entirely*: a serializer and its deserializer in different modules that must always stay in sync; a config schema and the three readers that parse it; a frontend type and a backend DTO that mirror each other across a network boundary. None of those may share an `import`, yet they're tightly bound — change one without the other and you ship a bug. Temporal coupling is often a *better* predictor of maintenance pain than structural metrics precisely because it captures these hidden contracts. It's the basis of "change coupling" analysis and a core idea in [04 — Code Churn and Hotspots](../04-code-churn-and-hotspots/interview.md).

### Q5.2 — Two files always change together but never reference each other. Is that good or bad?

> **Testing:** Judgment — temporal coupling isn't automatically a defect.

**A.** It depends on whether the co-change is **expected** or **surprising**. Some co-change is structurally inevitable and fine: a class and its unit test *should* change together — that's healthy, the test is supposed to track the code. The dangerous pattern is **two production modules in different parts of the system that co-change with no declared dependency**: that means a hidden contract is being maintained by *developer memory and discipline* rather than by the type system or an interface. It's a latent bug waiting for the day someone changes one and forgets the other — exactly the failure that has no compile error.

So the move is: surface the temporal coupling, ask "*why* do these change together?", and if the answer is a real shared concept, make it **structural and explicit** — extract the shared abstraction so the dependency is visible and the compiler enforces it. Turning invisible temporal coupling into visible structural coupling (then minimizing it) is usually an improvement, because now the dependency can't be forgotten.

### Q5.3 — Explain connascence and why it's a more precise model than the classic coupling ladder.

> **Testing:** Senior-depth vocabulary — connascence as a finer, two-dimensional lens on coupling.

**A.** **Connascence** (Meilir Page-Jones, popularized by Jim Weirich) is a unified model: two components are *connascent* if a change in one **requires a corresponding change in the other** to keep the system correct. It refines coupling along **two dimensions at once**:

1. **Strength** — how hard the coupling is to detect and fix, as a *ladder* from weak to strong:
   - **Static** kinds (visible in the source): *connascence of name* (both must agree on a name) → *of type* → *of meaning/convention* (e.g., both sides agree `-1` means "not found") → *of position* (argument order) → *of algorithm* (both must implement the same checksum).
   - **Dynamic** kinds (only manifest at runtime, *strictly worse* because invisible to static tools): *of execution* (order of calls matters) → *of timing* (race conditions) → *of value* (related values must change together) → *of identity* (must reference the same instance).
2. **Locality** — how far apart the connascent elements are. The *same* kind of connascence is far more acceptable inside one function than across module or service boundaries.
3. **Degree** — how many elements are involved (two call sites vs two hundred).

It's more precise than content→data because it gives you **three rules of refactoring**: minimize connascence overall, prefer **weaker** forms over stronger (convert connascence of position into connascence of name by using named parameters), and **localize** it (strong connascence is tolerable when close, intolerable across boundaries). The classic ladder gives you one axis; connascence gives you strength *and* distance *and* count, which is why it explains *why* the same dependency is fine in one place and a disaster in another.

---

## Theme 6 — Scenario and Judgment

### Q6.1 — A module has high afferent coupling. What does that mean for changing it, and how do you proceed?

> **Testing:** Translating a metric into an operational consequence — the most common scenario phrasing.

**A.** High **afferent coupling (Ca)** means **many other modules depend on this one** — it's a *hub*. The direct consequence: **it is expensive and risky to change**, because every modification has a large blast radius — any of those dependents can break, so changes need broad regression testing and careful release coordination. High Ca is also a *signal of importance*: this module is load-bearing, so it deserves the most stability, the best tests, and the most review.

How I proceed:
1. **Don't treat high Ca as a defect to "fix."** A widely-used `domain` package *should* have high Ca; that's correct design (it should sit at I ≈ 0).
2. **Check its Instability and Abstractness.** If it's stable (low I) and *concrete* (low A), it's in the **zone of pain** — *that's* the real problem, and the fix is to introduce abstractions (interfaces) so dependents lean on a stable abstract surface while the volatile implementation can change behind it.
3. **Stabilize the contract, not the code.** Keep the public interface backward-compatible; evolve internals freely. Treat the interface as a published API with deprecation cycles.
4. **Invest in its test suite** proportional to its Ca — a hub deserves the strongest safety net because the most code depends on it being correct.

The key reframe: high Ca isn't "bad coupling," it's "this is important — protect its interface."

### Q6.2 — How would you find and break a dependency cycle between packages?

> **Testing:** Whether you can detect a cycle *and* know the standard techniques to cut one.

**A.** **Finding it:** build the package dependency graph and run cycle detection — most ecosystems have a tool (`go list` + a cycle checker, `madge --circular` for JS, ArchUnit/`jdepend` for the JVM, `import-linter` for Python, dependency-cruiser, NDepend). A cycle means strongly-connected packages that can't be built, tested, understood, or released independently — they've effectively fused into one unit while pretending to be separate.

**Breaking it** — the canonical moves, roughly in order of preference:

1. **Dependency Inversion** — the most common fix. If A → B → A, define an *interface* in A (or in a third shared package) that B's needed behavior satisfies, and have A depend on the interface while B *implements* it. Now both depend on the abstraction; the concrete arrow that closed the loop is gone. This is the Dependency Inversion Principle doing exactly its job.
2. **Extract a shared package** — pull the types/logic both A and B depend on into a new lower-level package C that both depend on (A → C ← B). The cycle becomes a tree.
3. **Move the misplaced code** — often a cycle exists because *one class is in the wrong package*. Relocating it to the side it really belongs to dissolves the loop with no new abstraction.
4. **Merge** — if two packages are *so* coupled they always change together (high temporal coupling too), the honest answer may be that they're one module pretending to be two; merge them.
5. **Mediate with events** — replace a direct back-call with a published event the other side subscribes to, inverting the runtime dependency (use judiciously; it trades a visible dependency for an invisible one).

Then **lock it in CI** with an architecture-fitness test so the cycle can't silently return.

### Q6.3 — A package is in the "zone of pain." Explain what that means and what you'd do.

> **Testing:** Applying the I/A model to a concrete remediation — the metric becoming an action.

**A.** **Zone of pain = low Instability + low Abstractness:** lots of packages depend on it (so it's hard to change — high Ca, I near 0), but it's full of *concrete* implementation with no abstraction to depend on instead (A near 0). The "pain" is the collision: it's depended-upon like a stable foundation, yet it contains volatile concrete detail that *needs* to keep changing — so every necessary change is expensive and risky.

First I'd ask *why* it's there, because two cases need different responses:

- **It's genuinely volatile concrete code that everyone depends on** (e.g., a concrete `Database` or a god-`Utils` everyone imports). Remedy: **introduce abstractions** — extract interfaces for the parts that change, and let dependents import the interface instead of the concrete class (Dependency Inversion). The concrete implementation moves *behind* the interface and can now churn freely without breaking dependents. This pulls the package toward the Main Sequence by raising A while keeping I low.
- **It's legitimately stable concrete code that *doesn't actually change*** — a mature, frozen library (think a well-tested math kernel). Then a low D "violation" is fine; the metric flags a *risk*, not a sin. If it never changes, the pain never materializes, and adding abstraction would be pointless ceremony.

So the senior answer is: diagnose volatility first. If it changes, abstract it; if it's truly frozen, document *why* the metric is acceptable here and move on. The zone of pain identifies *candidates*; volatility decides which ones actually hurt.

### Q6.4 — A class has CBO of 30 and LCOM4 of 4. What story do those two numbers tell together?

> **Testing:** Reading metrics in combination instead of in isolation — a senior habit.

**A.** Together they describe a **god class**. **LCOM4 = 4** says the class contains *four* independent responsibility clusters whose methods don't share state — four jobs in one box. **CBO = 30** says it's coupled to thirty other classes. Those reinforce each other: a class doing four unrelated jobs *needs* to talk to many collaborators (one set of dependencies per responsibility), which is exactly why CBO is sky-high. The high CBO is a *symptom* of the low cohesion.

The narrative: this is a maintenance hotspot. It's hard to test (30 collaborators to mock), hard to change safely (touched by every feature because it does everything), and almost certainly high-churn. The remedy follows from LCOM4 directly: **split it along the four connected components into four cohesive classes.** Each split-off class takes only the collaborators its responsibility actually needs, so CBO drops *per class* as a natural consequence. I'd confirm by cross-checking the *churn* (is it actually changing a lot?) before investing — a high-CBO/high-LCOM class that never changes is ugly but not urgent. Numbers nominate; churn and risk prioritize.

---

## Theme 7 — Governance and Gaming

### Q7.1 — How do you enforce dependency rules in CI so architecture doesn't erode?

> **Testing:** Whether you can turn coupling principles into an automated, blocking guardrail.

**A.** Codify the rules as **architecture-fitness tests** that fail the build, because a rule that isn't enforced *will* be violated under deadline pressure — entropy is the default. Concretely:

- **Layering / direction rules** with a tool that knows the dependency graph: ArchUnit (JVM), `import-linter` (Python), dependency-cruiser or `eslint-plugin-boundaries` (JS/TS), `go-arch-lint` (Go), NDepend (.NET). Encode statements like "the `domain` layer must not depend on `infrastructure`" and "no package may import `internal/legacy`."
- **No-cycles rule** — assert the package graph is acyclic so a reintroduced cycle fails CI immediately, while it's one commit to revert rather than a year of entanglement.
- **Stable-dependencies checks** — flag dependencies that point toward *less* stable packages (SDP violations), where the tooling supports it.
- **Public-API surface** — fail if a module reaches across a published boundary into another's internals (enforce with module systems / visibility: Java modules, Go `internal/`, package-private).

The principles: make the rule **executable and blocking**, give a **clear failure message** that says *which* dependency broke *which* rule, allow **explicit, reviewed exceptions** (an allow-list with a comment and an owner) so the rule bends consciously rather than being deleted, and **add the rule the moment you fix a violation** so it never regresses. Enforce architecture the same way you enforce tests: in CI, on every change.

### Q7.2 — Your manager wants to rank teams by their code's average LCOM. Talk them out of it (or into it).

> **Testing:** The most important judgment question in the topic — metrics as *management weapons* vs *diagnostic aids*.

**A.** I'd push back firmly, because this is the textbook way to destroy a good metric. The core problem is **Goodhart's Law: when a measure becomes a target, it ceases to be a good measure.** The moment LCOM becomes a *ranking that affects performance reviews*, engineers optimize the number, not the design — and LCOM is trivially gameable:

- Add a private field that every method touches, or route methods through a shared field, and LCOM4 collapses to 1 with *worse* design.
- Inline helper methods to hide disconnected clusters; merge classes that should be separate to dodge a high score.
- Exclude or rename accessors to massage the count.

Beyond gaming, **the comparison is invalid**: LCOM isn't normalized across domains. A team writing data-mapping/DTO code legitimately has higher LCOM (lots of independent field accessors) than a team writing pure algorithmic code — ranking them punishes the domain, not the craft. And it's a **single metric**: cohesion is one facet; a team could have great LCOM and terrible coupling, test coverage, or churn. Optimizing one number locally often *worsens* the system globally.

What I'd offer instead: use LCOM (and CBO, I/A/D, churn) as **diagnostics on the codebase, not scorecards on people** — surface outlier *classes* and *packages* in dashboards the teams own, so they self-direct refactoring. Track *trends* ("is coupling getting worse over time in this service?") rather than cross-team rankings. Tie incentives to *outcomes* — defect rate, lead time, change-failure rate — and let the structural metrics be the *leading indicators* engineers use to investigate, never the bonus formula. Metrics should start conversations, not end careers.

### Q7.3 — A team hits 100% of its coupling thresholds but ships buggy, hard-to-change software. What went wrong?

> **Testing:** Whether you understand that these metrics are *proxies*, not the goal.

**A.** The metrics measured the *shape* of the dependency graph but not the *quality* of the decomposition — and the team optimized the shape. Several things can produce "green metrics, bad software":

- **The module boundaries are wrong.** Metrics reward few dependencies between whatever boundaries you drew, but if those boundaries don't match the domain's real concepts, you get low *measured* coupling and high *conceptual* coupling — modules that don't reference each other in code yet must always change together (high temporal coupling the structural metrics never saw).
- **They gamed the proxy.** Hiding dependencies behind a generic event bus, a `Map<String, Object>` config blob, or reflection makes CBO drop while the *actual* coupling is now worse and invisible to both tools *and* readers.
- **Cohesion was satisfied syntactically, not semantically.** LCOM4 = 1 only proves methods share fields, not that they share a *reason to exist*. You can connect unrelated responsibilities through a shared field and pass.
- **They optimized the measured thing and neglected the unmeasured things** — naming, abstraction quality, error handling, test value. Coupling/cohesion are necessary, not sufficient.

The lesson: these metrics are **proxies for maintainability, not maintainability itself.** Use them as one input alongside human judgment, temporal-coupling analysis, and outcome metrics. When the proxy is green but reality is red, trust reality and find out which dimension the proxy missed.

---

## Rapid-Fire Round

> Short questions to check breadth. One or two sentences each.

- **Q: Coupling vs cohesion in one line?** A: Coupling is interdependence *between* modules (minimize it); cohesion is how related a single module's contents are (maximize it).
- **Q: Afferent vs efferent — which is incoming?** A: Afferent (Ca) is incoming (who depends on me); efferent (Ce) is outgoing (who I depend on).
- **Q: Formula for Instability?** A: `I = Ce / (Ca + Ce)`, from 0 (stable) to 1 (unstable).
- **Q: What does I = 0 mean?** A: Maximally stable — nothing it depends on, many dependents; hard to change because of the blast radius.
- **Q: Formula for Abstractness?** A: abstract types ÷ total types in the package, 0 (concrete) to 1 (fully abstract).
- **Q: Distance from the Main Sequence?** A: `D = |A + I − 1|`; 0 is ideal, larger is worse.
- **Q: Zone of pain?** A: Low I, low A — stable *and* concrete; hard to change yet full of detail that keeps changing.
- **Q: Zone of uselessness?** A: High I, high A — abstract *and* unused; abstractions nobody depends on.
- **Q: Worst coupling kind?** A: Content coupling — reaching inside another module's internals, bypassing the interface entirely.
- **Q: Worst cohesion kind?** A: Coincidental — elements grouped for no reason (a `Utils` dumping ground).
- **Q: What does LCOM4 = 1 mean?** A: Cohesive — every method connects via shared fields or calls; one responsibility cluster.
- **Q: What does LCOM4 = 3 mean?** A: Three independent responsibility clusters — a strong hint to split the class into three.
- **Q: What does CBO measure?** A: How many other classes a class is coupled to (combined, undirected).
- **Q: What is control coupling?** A: Passing a flag that dictates the callee's internal branching (`render(x, isPdf)`).
- **Q: Stamp vs data coupling?** A: Stamp passes a whole object when only a field is needed; data passes exactly the needed primitives.
- **Q: Temporal coupling?** A: Files that change together in commit history despite no code reference — a hidden dependency.
- **Q: SDP in one line?** A: Stable Dependencies Principle — depend toward greater stability (lower I).
- **Q: SAP in one line?** A: Stable Abstractions Principle — a package should be as abstract as it is stable.
- **Q: Why not rank teams by LCOM?** A: Goodhart's Law — it's trivially gamed and not comparable across domains; it diagnoses code, not people.
- **Q: Standard fix for a dependency cycle?** A: Dependency inversion — introduce an interface both sides depend on, breaking the concrete back-edge.
- **Q: Connascence in one line?** A: Two elements are connascent if changing one forces a change in the other; minimize, weaken, and localize it.

---

## Red Flags and Green Flags

> What interviewers infer from *how* you answer, not just whether you're right.

**Red flags:**
- Using "coupling" and "cohesion" interchangeably, or only describing *amount* of coupling with no awareness of *kinds*.
- Mixing up afferent and efferent, or fumbling the Instability formula (`Ce / (Ca + Ce)`).
- Calling a package "stable" to mean "high quality" instead of "hard to change."
- Treating high afferent coupling as automatically a defect to remove.
- Believing structural metrics catch everything — never mentioning temporal/logical coupling.
- Endorsing per-team LCOM rankings, or any single metric as a performance KPI.
- "Just make everything loosely coupled" with no acknowledgment of indirection cost.

**Green flags:**
- Naming the *kind* of coupling (content/control/stamp/data) before discussing the count.
- Computing I, A, D, and LCOM4 correctly and explaining what each *extreme* means.
- Reading metrics *in combination* (high CBO + high LCOM = god class) and cross-checking against churn.
- Bringing up **temporal coupling** and **connascence** unprompted as finer lenses than the classic ladder.
- Framing high Ca as "important, protect the interface" rather than "bad."
- Treating metrics as **diagnostics and conversation-starters**, never as targets — citing Goodhart's Law.
- Caveating tradeoffs ("split for cohesion *but* not so far that you trade it for coupling between fragments").

---

## Summary

- The bank reduces to four distinctions in costumes: **coupling vs cohesion**, **kind vs count**, **afferent vs efferent**, **structural vs temporal**. Name the distinction first; the number follows.
- **Fundamentals:** low coupling localizes *change*, high cohesion localizes *concepts*; they rise and fall together because good boundaries deliver both. Neither should be pushed to a pathological extreme.
- **The ladders:** coupling runs content (worst) → common → external → control → stamp → data (best); cohesion runs coincidental (worst) → … → functional (best). Worst coupling = content (bypasses the interface); worst cohesion = coincidental (no shared reason).
- **Computable metrics:** Ca (incoming) and Ce (outgoing); CBO counts coupled classes; **LCOM4 = number of connected components** of the method/field graph — 1 is cohesive, ≥ 2 means a splittable seam. Watch for constructors and accessors distorting LCOM.
- **Martin's package metrics:** `I = Ce/(Ca+Ce)`, `A = abstract/total`, Main Sequence is `A + I = 1`, distance `D = |A + I − 1|`. **Zone of pain** = stable + concrete (low I, low A); **zone of uselessness** = unstable + abstract (high I, high A). SDP (depend toward stability) + SAP (as abstract as stable) *are* the Main Sequence.
- **Structural vs temporal:** structural coupling is visible to the compiler; **temporal coupling** (files that co-change) reveals hidden contracts and often predicts pain better. **Connascence** refines coupling by strength, locality, and degree — minimize, weaken, localize.
- **Governance:** enforce dependency rules and no-cycles as blocking CI fitness tests; treat metrics as diagnostics on *code*, never scorecards on *people* — ranking teams by LCOM invites Goodhart's Law and is invalid across domains.

---

## Further Reading

- *Agile Software Development: Principles, Patterns, and Practices* (Robert C. Martin) — the source of I, A, D, the Main Sequence, SDP, and SAP.
- *A Metrics Suite for Object Oriented Design* (Chidamber & Kemerer, 1994) — the original CK paper defining CBO and LCOM.
- *Structured Design* (Yourdon & Constantine) — the original coupling and cohesion ladders.
- *Your Code as a Crime Scene* and *Software Design X-Rays* (Adam Tornhill) — temporal/change coupling and hotspot analysis from version control.
- "Connascence" (connascence.io; Jim Weirich's talks; Page-Jones, *What Every Programmer Should Know About Object-Oriented Design*) — the strength/locality/degree model.
- The [junior](junior.md), [middle](middle.md), [senior](senior.md), and [professional](professional.md) pages of this topic — every answer here is grounded in those.

---

## Related Topics

- [01 — Cyclomatic and Cognitive Complexity](../01-cyclomatic-and-cognitive-complexity/interview.md) — the other half of structural quality: complexity *within* a module, complementary to coupling *between* them.
- [04 — Code Churn and Hotspots](../04-code-churn-and-hotspots/interview.md) — temporal coupling, change frequency, and why "complex *and* changing" is where coupling metrics earn their keep.
- [Code Quality Metrics README](../README.md) — where coupling and cohesion sit in the broader metrics landscape.
