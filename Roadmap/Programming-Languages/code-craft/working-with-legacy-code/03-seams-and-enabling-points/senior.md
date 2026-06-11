# Seams and Enabling Points — Senior Level

## Table of Contents

- [Seams as a property of design, not a testing trick](#seams-as-a-property-of-design-not-a-testing-trick)
- [Testability is a design property you can measure](#testability-is-a-design-property-you-can-measure)
- [The trade-off space between seam types](#the-trade-off-space-between-seam-types)
- [How the language and runtime shape your available seams](#how-the-language-and-runtime-shape-your-available-seams)
- [The hidden cost of link and preprocessor seams](#the-hidden-cost-of-link-and-preprocessor-seams)
- [Seams vs. proper dependency injection](#seams-vs-proper-dependency-injection)
- [When the enabling point is in the wrong place](#when-the-enabling-point-is-in-the-wrong-place)
- [Judgment: choosing a seam under real constraints](#judgment-choosing-a-seam-under-real-constraints)
- [Heuristics a senior carries](#heuristics-a-senior-carries)
- [Related Topics](#related-topics)

---

## Seams as a property of design, not a testing trick

The junior and middle pages teach seams as a mechanism: find the join, slot in a fake, test the logic. That framing is correct but incomplete. At senior level the deeper truth is that **a seam is the observable shadow of a design decision about coupling.** Code that is full of natural seams is code whose dependencies were made *explicit and replaceable*; code with no seams welded its dependencies in. So when you ask "where are the seams here?" you are really asking "where did the original author make coupling explicit, and where did they hide it?"

This reframing changes how you work. A junior creates seams reactively, one at a time, to get a single test in. A senior reads the *distribution* of seams across a module as a map of its coupling — where it will be cheap to test and change, and where it will be expensive. The expensive regions are precisely the ones with no seams: hardcoded `new`, static singletons, direct I/O, ambient state. Those are the same regions that resist every kind of change, not just testing. Seams and changeability are the same property viewed through two lenses.

> **Key idea:** A seam is the visible trace of explicit coupling. The presence or absence of seams across a module is a coupling map — it predicts where change will be cheap and where it will be expensive, for testing *and* for everything else.

## Testability is a design property you can measure

"Testable" is not a binary and not a virtue you bolt on afterward. It is a structural property: the degree to which you can **control** a unit's inputs and collaborators and **sense** its outcomes without running the whole system. Seams are the joints that provide both. A senior treats testability as a *first-class design constraint*, on par with performance or correctness, because it governs the cost of every future change.

Two failure modes show why this matters:

- **Welded dependencies** (no separation). The unit cannot run in isolation — its constructor opens a socket, its body reads the clock. You cannot reach it. No seam for *control*.
- **Opaque effects** (no sensing). The unit runs fine but its only effect is a private mutation or a fire-and-forget call to the void. You cannot observe it. No seam for *sensing*.

These map exactly onto the [legacy change algorithm](../02-the-legacy-change-algorithm/)'s *separation* and *sensing*. The senior insight is that you can predict which one will bite *before* you write a test, by reading the unit's dependencies. A class that takes its collaborators as constructor parameters and returns its results is testable by construction. A class that news up its collaborators and communicates only through side effects is untestable by construction — and that's a design defect you can name in review, not just a testing inconvenience you discover later.

```
        Can you CONTROL inputs?          Can you SENSE outcomes?
        (separation)                     (sensing)
   ┌───────────────────────────┐    ┌───────────────────────────┐
   │ collaborators injected  → │    │ returns a value        →  │
   │   yes, seam present       │    │   yes, seam present       │
   │ collaborators new'd up  → │    │ only private mutation  →  │
   │   no, must add a seam     │    │   no, must add a seam     │
   └───────────────────────────┘    └───────────────────────────┘
            both yes  ⇒  testable by construction
```

This is why designing for testability and designing for changeability converge. The same moves that add a seam — depend on an interface, inject the collaborator, return a result instead of mutating ambient state — are the moves that reduce coupling. See [../../design-principles/](../../design-principles/) for dependency inversion and inversion of control, which are simply "design so the seams already exist."

## The trade-off space between seam types

The middle page ranks seams object → configuration → link → preprocessor and tells you to prefer object seams. The ranking is right, but a senior must be able to justify it on multiple axes, because the "best" seam depends on which property you're paying for.

| Property | Object seam | Config/text seam | Link seam | Preprocessor seam |
| --- | --- | --- | --- | --- |
| **Visible in source** | Yes — explicit param/field | Partly (the factory) | No | No |
| **Checked by compiler** | Yes (in typed langs) | No (string targets) | Symbol-level only | No |
| **Local to the unit** | Yes | Scattered to config | Build-wide | Build-wide |
| **Production builds == test builds** | Yes (same binary) | Yes | **No** — different binaries | **No** — different programs |
| **Granularity** | Per-collaborator | Per-config-key | Per-symbol/library | Per-flag region |
| **Risk of silent drift** | Low | Medium | High | **Highest** |
| **When forced to use** | Default | Dynamic langs, env switching | Legacy C, 3rd-party binary | Embedded C, no DI |

The decisive axis is **"do production and test exercise the same compiled artifact?"** Object and config seams keep one binary and choose behavior at runtime, so the thing you tested is the thing that ships. Link and preprocessor seams produce *different artifacts* for test and production — and a bug that lives only in the production artifact is, by definition, never exercised by the tests. That single property is why the bottom two are last resorts regardless of how convenient they are in the moment.

> **Key idea:** The seam ranking ultimately reduces to one question — does the test exercise the same artifact you ship? Object and config seams say yes; link and preprocessor seams say no, and that's why they're dangerous, not merely inconvenient.

## How the language and runtime shape your available seams

A senior chooses seams *the language affords cheaply*, not seams from a textbook ranking applied blind. The runtime's binding model determines which seams are first-class and which are hacks.

- **Statically typed OO (Java, C#, Kotlin):** object seams are first-class and compiler-checked. Interfaces, constructor injection, and `protected` overridable methods are the natural vocabulary. Link seams (classpath shadowing) exist but are awkward; preprocessor seams don't.
- **Structurally typed (TypeScript, Go):** object seams are even cheaper because you don't need a declared `implements` — any value of the right shape works. A test double is just an object literal. This lowers the cost of the *preferred* seam, so you almost never need to drop to anything weaker.
- **Dynamic (Python, Ruby, JS):** the runtime *is* a seam — every module attribute is rebindable (monkeypatch). This is enormously convenient and enormously fragile: the patch target is a string with no compiler behind it, so a rename breaks it silently. The senior discipline in dynamic languages is to *prefer explicit injection anyway* and treat monkeypatching as a stepping stone, precisely because the runtime makes the lazy option too easy.
- **Compiled, no DI machinery (C, embedded):** object seams require building your own vtable-by-hand (function pointers in structs). Often the link seam or preprocessor seam genuinely *is* the lightest available option, and the senior accepts the invisibility cost knowingly because the alternative — hand-rolled indirection — has its own cost.

```
Richer binding model ──────────────────────────▶ weaker binding model
TypeScript/Go      Java/C#        Python/Ruby        C / embedded
(structural        (interface     (runtime rebind,   (function ptrs or
 object seams,      object seams,  fragile but free)  link/preproc seams)
 cheapest)          checked)
        ▲                                                    ▲
   prefer object seams almost always              link/preproc may be
                                                  the only cheap option
```

The lesson: the *correct* seam is a function of the language's binding model. Insisting on object seams in embedded C with no infrastructure is as wrong as defaulting to monkeypatching in TypeScript where a typed injection costs nothing.

## The hidden cost of link and preprocessor seams

These deserve a dedicated senior treatment because their danger is *subtle* — they work perfectly in the demo and bite months later.

**Link seams hide behavior.** A reader of `report.c` sees `db_count_where(...)` and has *no signal* that its behavior depends on which `.o` was linked. The seam is real but invisible. Consequences a senior anticipates:

- **Divergence.** The test build links `fake_db.o`; production links `db.o`. Over time the fake drifts from the real implementation's contract — it doesn't replicate a new error case, a new return convention — and the tests keep passing against a fiction. The test suite becomes a confident liar.
- **Debugging opacity.** A new engineer debugging a test failure has to know the *build graph* to understand why behavior differs from production. The seam is in the Makefile, not the code they're reading.

```c
/* report.c — IDENTICAL source in both builds. The seam is INVISIBLE here. */
int active_user_count(void) {
    return db_count_where("status = 'active'");  /* which db_count_where? */
}
```
```makefile
report_prod: report.o db.o        # real
report_test: report.o fake_db.o   # fake — and report.c can't tell you this exists
```

**Preprocessor seams build different programs.** `#ifdef UNIT_TEST` means the source you read is not the source that compiles. The test program and the production program are *literally different programs* that happen to share text. The failure mode is brutal: a bug guarded inside the non-test branch is never compiled in the test build, so no test can ever catch it.

```c
void process(Request *r) {
#ifdef UNIT_TEST
    Clock *clock = fake_clock();    /* tests run THIS */
#else
    Clock *clock = system_clock();  /* production runs THIS — never tested */
#endif
    handle(r, clock_now(clock));
}
```

A senior's rule: link and preprocessor seams are acceptable *only* when (a) no cheaper seam exists for the language, and (b) you minimize the divergence surface — keep the fake's contract tightly aligned with the real one, and add at least one integration test that exercises the *production* artifact end to end so the untested branch isn't entirely dark. The goal is to bound the lie, since you can't eliminate it.

> **Key idea:** Link seams hide *that a seam exists*; preprocessor seams hide *what program you're actually testing*. Both create a gap between the artifact you test and the artifact you ship. Use them only when forced, and always cover the production artifact with at least one integration test.

## Seams vs. proper dependency injection

A frequent senior-level confusion: aren't object seams just DI? They overlap but are not the same, and conflating them leads to over-engineering.

- A **seam** is a *minimal, often temporary* enabling point introduced to get a test in — possibly a `protected` method you'll override in one test subclass, possibly a single parameterized method. It can be ugly and local. Its job is to make *this* change safe.
- **Dependency injection** is a *design stance*: dependencies are systematically declared and supplied from outside, usually wired by a container or composition root. It's a property of the whole architecture.

The relationship is directional. Seams are how you *retrofit* testability into code that wasn't designed with DI. Over time, repeated seam-adding tends to *pull* a module toward DI — each injected collaborator is a step. But you should not introduce a DI framework to add one seam; that's using an architecture-scale tool for a method-scale problem. Conversely, a codebase already built on DI barely needs the concept of "seams" because the seams are everywhere by design — which is the whole point of designing for testability.

| | Seam | Dependency injection |
| --- | --- | --- |
| **Scope** | One unit, one change | Whole architecture |
| **Intent** | Get a test in *now* | Decouple by design |
| **Permanence** | Often temporary/scaffolding | Permanent structure |
| **Tooling** | None — hand or IDE refactor | Often a container/composition root |
| **Quality bar** | "Good enough to test" | "Clean and consistent" |

The judgment: use a *seam* as the tactical move on legacy code; let *DI* be the direction you refactor toward once the tests exist. Subclass-and-override is the canonical "scaffolding seam" — invaluable to get the first test in, but a smell if it's still there a year later instead of having become honest injection.

## When the enabling point is in the wrong place

The middle page notes that enabling points outside the source (build, config, env) are harder to see. The senior concern is sharper: **an enabling point in the wrong place couples your test setup to the wrong layer.**

If the only enabling point is a global environment variable, then *every* test that wants a fake must manipulate global process state — which serializes tests, leaks between them, and makes parallelism unsafe. If the enabling point is a static setter (`ServiceLocator.set(fake)`), tests must remember to reset it in teardown or they poison each other. These are real, recurring sources of flaky suites, and they trace directly to an enabling point that's too *global*.

The senior preference is the **most local enabling point that still works**: a constructor parameter beats a setter beats a static setter beats an env var, because locality bounds the blast radius of the substitution. A fake passed to one constructor affects exactly one object; a fake installed via `LD_PRELOAD` or a global flag affects the entire process. When you must use a global enabling point (sometimes the legacy code forces it), wrap the set/reset in a test fixture that guarantees cleanup, and treat moving the enabling point inward as a refactoring goal.

```
Most local (preferred)  ─────────────────────────▶  Most global (risky)
constructor param   →   method param   →   instance setter
                    →   static setter   →   env var / LD_PRELOAD
   bounded blast radius                       process-wide blast radius,
                                              flaky / non-parallel tests
```

## Judgment: choosing a seam under real constraints

Pulling it together — the senior decision isn't "pick the highest-ranked seam," it's "pick the seam that minimizes total cost given the language, the entanglement, and the lifespan of the change."

- **Default to the object seam** with the most local enabling point the code allows. In typed OO and structural languages this is nearly always achievable and nearly always right.
- **Reach for subclass-and-override** as deliberate scaffolding when the constructor is too entangled to change safely *yet* — but mark it as debt to be refactored toward injection once tests exist.
- **Accept a config/monkeypatch seam** in dynamic languages for speed, knowing it's stringly-typed and fragile; prefer injection for anything long-lived.
- **Drop to link/preprocessor seams only when the language gives you nothing cheaper**, minimize the divergence surface, and cover the production artifact with an integration test so the untested branch isn't dark.
- **Watch the enabling point's locality** as carefully as the seam type — a global enabling point is a flaky-test factory regardless of how clean the seam itself looks.

And the meta-judgment that separates senior from middle: **sometimes the right move is not to add a seam at all.** If a unit needs three scaffolding seams to test one branch, the unit is telling you it's badly factored. The honest fix may be a real refactoring — extract the logic you care about into a small, pure, naturally-testable unit (a Sprout, in [legacy-change-algorithm](../02-the-legacy-change-algorithm/) terms) — rather than threading seams through a tangle you'll have to re-thread next time. Seams get a test in; they don't excuse you from improving the design when the design is the actual problem. That investment decision is the subject of [06-tidy-first](../06-tidy-first-when-and-how/) and [07-the-economics-of-tidying](../07-the-economics-of-tidying/).

> **Key idea:** Choosing a seam is a cost-minimization under language and entanglement constraints — and "add no seam, refactor instead" is a legitimate choice when the unit needs so many seams that it's confessing a design problem.

## Heuristics a senior carries

- **Read seam distribution as a coupling map** — no-seam regions predict expensive change, not just hard testing.
- **Predict separation vs. sensing failures from the dependencies** before writing a test; the moves differ.
- **Decide seam type on the "same-artifact?" axis first** — object/config keep one binary; link/preprocessor split it.
- **Let the language's binding model pick the seam** — structural/typed → object seams; embedded C → link/preprocessor may be the only cheap option.
- **Treat link seams as invisible and preprocessor seams as program-splitting** — bound the divergence, cover the production artifact with an integration test.
- **Use seams tactically; refactor toward DI strategically** — don't add a container to get one test in.
- **Keep the enabling point as local as possible** — global enabling points cause flaky, non-parallel suites.
- **Know when not to add a seam** — many scaffolding seams on one unit means the design, not the test, is the problem.

## Related Topics

- [01-what-is-legacy-code](../01-what-is-legacy-code/) — code without tests; seams are how you start adding them.
- [02-the-legacy-change-algorithm](../02-the-legacy-change-algorithm/) — seams power the *find test points* and *break dependencies* steps; separation/sensing map onto control/sense here.
- [04-characterization-tests](../04-characterization-tests/) — the tests you write *through* the seams you create.
- [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/) — the catalog of moves (Extract Interface, Parameterize Constructor, Subclass and Override) that *create* the seams discussed here.
- [06-tidy-first-when-and-how](../06-tidy-first-when-and-how/) — when to stop adding seams and invest in real refactoring instead.
- [07-the-economics-of-tidying](../07-the-economics-of-tidying/) — the cost/value calculus behind "seam now vs. refactor now."
- [../../design-principles/](../../design-principles/) — dependency inversion and IoC: designing so the seams already exist.
- [../../refactoring/](../../refactoring/) — the behavior-preserving moves that turn scaffolding seams into honest injection.
