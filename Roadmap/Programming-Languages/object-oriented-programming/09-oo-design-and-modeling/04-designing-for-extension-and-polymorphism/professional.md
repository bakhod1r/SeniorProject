# Designing for Extension & Polymorphism — Professional

> **What?** The team lens: the vocabulary to name extensibility problems in review, the smells that signal a missing or wrong seam, the tooling that enforces extension boundaries (ArchUnit, Error Prone, SpotBugs, Modulith, japicmp/revapi), a refactoring playbook for introducing and evolving seams safely, and — crucially — when *not* to add one.
> **How?** Make "where can this grow, and is that the axis it will grow on?" a standing review question, back it with automated checks on the boundaries that matter, and treat published seams as API governed by binary-compatibility tooling.

---

## 1. Review vocabulary — name the problem precisely

Vague review comments ("this isn't extensible") get ignored. Precise ones get fixed:

| Say this | Instead of | Means |
| --- | --- | --- |
| "This `switch` on `type` repeats in 3 places — *replace conditional with polymorphism*." | "messy switch" | scattered type-branching → one polymorphic dispatch |
| "What's the *axis of change* here — new types or new operations?" | "make it flexible" | forces the Expression-Problem decision |
| "This abstraction *leaks* `PreparedStatement` — depend on a domain type." | "bad interface" | implementation type in a published contract |
| "This base class isn't *designed for inheritance* — `final` it or document self-use." | "don't subclass" | Bloch Item 19 |
| "Speculative seam — *no second implementer*. YAGNI; inline it." | "over-engineered" | a variation point with no predicted variation |
| "Sealing this *plugin point* forbids the extension we built it for." | "wrong" | sealed where open was needed |
| "Adding this method breaks every implementer — make it a `default`." | "breaking change" | implementer-side binary break |

These phrases tie the comment to a principle the author can act on and look up.

---

## 2. Smells that signal a seam problem

In review or static scan, these patterns flag extensibility issues:

- **The repeated type-switch.** The *same* `switch (x.type())` / `if (x instanceof …)` ladder in multiple methods. One is fine; the *third* copy is a polymorphism candidate. Grep for the enum/`getType()` in switches.
- **The shotgun edit.** A pull request that adds one feature but touches eight unrelated files is missing a seam — the variation point isn't isolated. (High *change coupling* in git history; see §5.)
- **`instanceof` ladders with a final `else throw`.** Often a sealed-type-plus-exhaustive-switch begging to exist (no `else`, compiler-checked).
- **`UnsupportedOperationException` in implementations.** The interface is too wide — Interface Segregation violation; the seam doesn't fit its implementers.
- **A `protected` field or a non-`final` class with no documented self-use.** Accidental inheritance surface — fragile base class risk.
- **`new ConcreteThing()` outside the composition root.** A hard-wired dependency where a seam was intended; the class isn't actually closed.
- **Constructor calling an overridable method.** Latent crash in any subclass (see §4 of `senior.md`).

---

## 3. Tooling that enforces extension boundaries

Reviews don't scale; encode the rules.

**ArchUnit** — assert architectural extension boundaries as tests:

```java
@ArchTest
static final ArchRule callers_depend_on_abstractions =
    classes().that().resideInAPackage("..service..")
        .should().onlyDependOnClassesThat()
        .resideInAnyPackage("..service..", "..spi..", "java..");

@ArchTest
static final ArchRule concretes_only_created_in_root =
    noClasses().that().resideOutsideOfPackage("..config..")
        .should().callConstructor(GzipCompressor.class);   // wiring stays in the root

@ArchTest   // SPI implementations must not be referenced by name elsewhere
static final ArchRule spi_impls_are_isolated =
    classes().that().implement(Channel.class)
        .should().onlyBeAccessed().byClassesThat().resideInAPackage("..config..");
```

**Error Prone** — catches the inheritance-design bugs at compile time: `@DoNotCall`, `ConstructorInvokesOverridable`, `MissingOverride`, `DoNotMock`. Turn `ConstructorInvokesOverridable` to an error in any module with public extensible base classes.

**SpotBugs** — `MALICIOUS_CODE`/`FINALIZER` and the *"class is final but declares protected member"* / *"method invokes overridable in constructor"* detectors flag unsafe inheritance surfaces.

**Modulith / jMolecules** — verify that module boundaries (where most real seams live) aren't bypassed; pairs with named SPI packages.

**japicmp / revapi** — for any *published* seam, fail the build on a binary-incompatible change (added abstract method, removed method, narrowed access). This is what makes "don't break implementers" mechanical:

```
$ japicmp -o api-1.4.jar -n api-1.5.jar --only-modified --error-on-binary-incompatibility
```

**`@implSpec` Javadoc + Checkstyle** — require documented self-use on any non-`final` `public`/`protected` method in extensible base classes.

---

## 4. The refactoring playbook: introducing a seam safely

When a missing seam is confirmed (a *real* second variant arrived), introduce it without a big-bang rewrite:

1. **Confirm the variation is real.** Two concrete behaviours now, not "might". Otherwise stop — adding the seam is the smell.
2. **Characterize with tests.** Pin current behaviour for *every* existing branch before moving anything. This is your safety net.
3. **Extract the abstraction (IDE-assisted).** *Extract Interface* / *Extract Method* on the varying logic. Keep the original as the first implementation.
4. **Replace conditional with polymorphism** *one switch at a time*. Move each branch's body into the matching implementation; the switch becomes a dispatch. Run tests between each.
5. **Push creation to the composition root.** Replace inline `new`/`switch`-to-pick with injection of the chosen implementation.
6. **Add the new variant.** Only now write the second implementation — the feature that triggered the work. It touches *no* existing code: the proof the seam works.
7. **Lock the boundary.** Add the ArchUnit rule (§3) so the closed callers stay closed.

For the *inverse* (a `switch` that should stay): if branching is over a closed domain set, `seal` the type and convert `if/else throw` to an exhaustive `switch` — now the compiler guards completeness. See [../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/](../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/).

---

## 5. Measuring extensibility — change-cost, not gut feel

"Extensible" should be measurable, so you can show the seam paid off:

- **Files-touched-per-feature.** From git: for the last N features of the same *kind* (e.g. "add a payment method"), how many files changed? A working seam drives this toward *one new file*. Rising count = the seam is wrong-axis or leaking.
- **Change coupling (temporal coupling).** Mine `git log` (e.g. `code-maat`, `git-of-theseus`) for files that *always change together*. A caller that changes every time a new variant is added is not actually closed.
- **CK metrics on the abstraction.** NOC (number of children) shows real polymorphic use; a seam interface with NOC=1 after months is speculative. DIT/CBO on the base class flag over-deep or over-coupled hierarchies. See [../02-oo-metrics-ck-suite/](../02-oo-metrics-ck-suite/).
- **Cyclomatic complexity of the would-be switch.** A method whose CC climbs by 2 every release *is* the conditional-explosion signal; track it.

Bring these numbers to the design discussion: "the last four payment integrations each touched the `Checkout` class — the seam is in the wrong place" is an argument; "feels rigid" is not.

---

## 6. When extensibility is the *wrong* call

A professional pushes back on seams as often as they add them. Decline the seam when:

- **One implementation, no roadmap for a second.** The seam is speculative generality. Inline it; add the seam *when* the second arrives (the refactor in §4 is cheap with tests).
- **The variation is over values, not types.** No `Adult`/`Minor` classes for an age check.
- **The "flexibility" is configuration nobody will use.** Every plugin point is attack surface, test surface, and documentation burden. An SPI used by exactly your own team is just indirection.
- **It's a leaf with no callers to protect.** OCP protects *callers*; a seam on a class nothing depends on closes nothing.
- **The team can't maintain the contract.** An SPI is forever. If you can't commit to binary-compat governance, don't publish one.

"We don't need a seam here yet" is a senior position, not a junior one. The cost of a wrong seam (frozen on the wrong axis, see `senior.md` §2) exceeds the cost of adding the right one later.

---

## 7. Governing a published SPI

If your team ships an extension point others depend on, it needs lightweight governance:

- **Mark the API surface.** Dedicated `..spi..`/`..api..` packages or a module that *only* exports the seam; everything else is internal (JPMS makes this enforceable — see [../../05-advanced-language-features/02-jpms-modules/](../../05-advanced-language-features/02-jpms-modules/)).
- **Compatibility gate in CI.** japicmp/revapi fails the build on binary breaks (§3).
- **Evolution policy in writing.** New capability → `default` method or capability sub-interface, never a new abstract method. Deprecate-then-remove over two minor versions; never silent removal.
- **A reference implementation + TCK.** Ship a test kit that any provider runs to prove conformance — turns the prose contract into executable spec, the only real defense against leaky-abstraction drift.
- **Document self-use and threading.** Implementers need to know what you call, when, and on which thread. See [../03-thread-safe-object-design/](../03-thread-safe-object-design/) for the concurrency half of a provider contract.

---

## 8. Review checklist

- [ ] Repeated type-switches identified and either justified (lone/stable) or flagged for polymorphism.
- [ ] Each new seam has a *real* second implementer or concrete roadmap — no speculative seams.
- [ ] Axis of change named: types-grow (polymorphism) vs operations-grow (sealed+switch).
- [ ] Abstractions are minimal and free of implementation types (no leaks).
- [ ] Non-`final` base classes document self-use; no overridable calls in constructors.
- [ ] Concrete construction confined to the composition root (ArchUnit-enforced).
- [ ] Sealed used for complete sets; plain interface/SPI for outsider-extension.
- [ ] Published seams under japicmp/revapi; evolution via `default`/capability/versioning.
- [ ] Change-cost trend (files/feature) flat or falling for the seam's feature kind.

---

## 9. What's next

| Topic | File |
| --- | --- |
| OCP/PV/Bloch/GoF/JLS canonical sources | `specification.md` |
| Rigid-switch, leaky-abstraction, unsafe-subclass bugs | `find-bug.md` |
| Measuring and removing conditional explosion | `optimize.md` |
| Design-an-extensible-API exercises | `tasks.md` |

---

**Memorize this:** make "where can this grow, and on which axis?" a standing review question; name the problem precisely (repeated type-switch, leaky abstraction, undesigned inheritance, speculative seam); enforce the boundaries with ArchUnit + Error Prone + japicmp rather than vigilance; measure extensibility by files-touched-per-feature and change coupling; and push back on seams with no real second implementer — a wrong-axis seam costs more than the right one added later.
