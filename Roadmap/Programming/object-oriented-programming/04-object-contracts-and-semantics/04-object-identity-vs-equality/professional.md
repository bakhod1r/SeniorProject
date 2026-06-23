# Object Identity vs Equality — Professional

> **What?** Driving identity-vs-equality discipline across a team: the code-review vocabulary that catches `==` traps before they ship, the static analysis rules that automate the obvious cases (SonarQube S4973 on strings, SpotBugs `EQ_*` family, Error Prone `ReferenceEquality`, NumberCompareEquality on boxed numerics), the IDE inspections you turn on by default, and the mentoring patterns that stop juniors from learning the bug twice.
> **How?** Wire enforcement into CI for the cases machines catch perfectly; reserve human review for the cases where identity is *intentional* and needs a comment. Treat each violation as a chance to teach the contract, not just patch the bug.

---

## 1. The four classes of `==` defect to look for in review

Identity-vs-equality bugs cluster into four shapes. A senior reviewer learns to recognise them at a glance.

1. **`==` on a `String`, `BigDecimal`, `LocalDate`, `URI`, `UUID`, or other JDK value type.** The fix is `.equals()` (or `Objects.equals`). The defect is mechanical; the question is whether your CI flags it before review.
2. **`==` on a wrapper (`Integer`, `Long`, `Boolean`, `Double`).** Same shape, with the extra wrinkle that the bug *might* be invisible inside `-128..127` and visible outside. Test data that uses small numbers passes; production data with larger numbers fails.
3. **`==` on a domain entity (your own `Customer`, `Order`, `Invoice`).** If the class overrides `.equals`, the fix is the same. If it doesn't, the fix is *either* to override `.equals` *or* to make the identity choice explicit (cycle detection, identity-keyed cache).
4. **`IdentityHashMap` or identity-comparison used for value-equality work.** The mirror image: identity is the wrong contract here. You see this in token registries, cache layers, deduplication code.

In review, name the class of defect. Don't say "this is wrong". Say "this is class 2 — wrapper compared with `==`; safe inside the boxing cache, broken outside. Use `Objects.equals` here". Naming the class is what turns a one-off comment into education.

---

## 2. Static analysis you can wire today

The good news for identity-vs-equality: more of it is mechanically detectable than for SOLID or design principles.

**SonarQube** has multiple rules in this area:

- `java:S4973` — *"Strings and Boxed types should be compared using `equals()`"*. Catches `==` and `!=` between two `String`, `Integer`, `Long`, `Boolean`, `Double`, `Float`, `Character`, `Byte`, `Short` operands. Catches 90% of class-1 and class-2 defects. Default severity is *Critical*.
- `java:S2159` — *"Silly equality checks should not be made"*. Catches `.equals` between obviously incompatible types (e.g., `someString.equals(someInteger)`), which is always `false` and indicates a typo.
- `java:S1244` — *"Floating point numbers should not be tested for equality"*. Catches `f1 == f2` on `float`/`double` (and the equivalent `Float.compare`-vs-`==` mistake).
- `java:S2204` — *"`.equals()` should not be used to test the values of `Atomic` classes"*. `AtomicInteger.equals` returns `Object.equals` (identity), not value equality. Tells you to use `.get()` and compare those.

**SpotBugs** catches semantic identity bugs more aggressively:

- `ES_COMPARING_STRINGS_WITH_EQ` — strings compared with `==`/`!=`.
- `ES_COMPARING_PARAMETER_STRING_WITH_EQ` — same, on a parameter (where the caller controls the object's pool status).
- `EC_BAD_ARRAY_COMPARE` — `arr1.equals(arr2)` instead of `Arrays.equals(arr1, arr2)`.
- `EC_UNRELATED_TYPES` — `.equals` between unrelated types.
- `RC_REF_COMPARISON` — reference comparison of a `Boolean` (or other autoboxed type).

**Error Prone** (Google) has the strongest set:

- `ReferenceEquality` — flags `==` on any reference type with a non-trivial `equals`. Includes domain types if Error Prone can see that `.equals` is overridden. Severity *ERROR* by default.
- `BoxedPrimitiveEquality` — explicit version for `Integer/Long/...` compared with `==`.
- `EqualsIncompatibleType` — `.equals` between obviously-different types.
- `IdentityBinaryExpression` — `if (a == a)` (always true) and similar.
- `StringEquality` — `String` compared with `==`.

**Checkstyle** is weaker on this axis — `StringLiteralEquality` flags `s == "literal"` but not `s1 == s2`. Use it as a backup, not the primary line of defence.

**ArchUnit** can encode rules like *"no `IdentityHashMap` outside the cycle-detection package"* or *"no class outside the domain package may import `String.intern`"*:

```java
@ArchTest
static final ArchRule no_identity_hash_map_outside_graph_walk =
    noClasses().that().resideInAPackage("..")
               .and().doNotResideInAPackage("..graph..", "..serializer..")
               .should().dependOnClassesThat().areAssignableTo(IdentityHashMap.class);
```

Use ArchUnit when the *architectural intent* matters more than the line-level check.

The combined matrix:

| Rule type                       | Sonar | SpotBugs | Error Prone | Checkstyle |
|---------------------------------|-------|----------|-------------|------------|
| String `==`                     | S4973 | ES_COMPARING_STRINGS_WITH_EQ | StringEquality | StringLiteralEquality |
| Wrapper `==`                    | S4973 | RC_REF_COMPARISON | BoxedPrimitiveEquality | – |
| Domain entity `==` (with custom `equals`) | – | – | ReferenceEquality | – |
| `.equals` between unrelated types | S2159 | EC_UNRELATED_TYPES | EqualsIncompatibleType | – |
| Array `.equals` | – | EC_BAD_ARRAY_COMPARE | ArrayEquals | – |
| Float `==` | S1244 | – | – | – |

Wire all four into CI on a fresh project; on a legacy one, enable in stages — turning `S4973` on a 500k-LoC codebase will produce thousands of findings and exhaust the team's patience.

---

## 3. IDE inspections — make the IDE shout at the keyboard

Static analysis catches the bug in CI; IDE inspections catch it as you type. Turn them on by default for the team.

**IntelliJ IDEA inspections to enable:**

- *Probable bugs → Number comparison → "Wrapper compared with `==` or `!=`"* (default off in some profiles — turn it ON, severity WARNING).
- *Probable bugs → "String literal comparison with `==` or `!=`"* — error-level by default.
- *Probable bugs → "Object reference comparison"* — flags `==` between two objects when `.equals` is overridden. Useful but noisy on domain types; tune per project.
- *Inheritance → "Class extends a `Cloneable` class but doesn't override `clone`"* — adjacent issue, related to identity preservation.
- *Java | Code style | "Use `Objects.equals` for `null`-safe equality"* — quick-fix suggestion.

Export `.idea/inspectionProfiles/Project_Default.xml` to the repository so every developer's IDE inherits the same settings. Without the export, "turn the inspection on" is a per-developer setting and identity bugs leak through whichever developers haven't done it.

**VS Code (Red Hat Java extension):** the underlying engine is Eclipse JDT, which has weaker identity-related inspections. Rely on Sonar/SpotBugs via the language server, or run Error Prone via Maven/Gradle in pre-commit.

---

## 4. Code-review vocabulary

When you find a `==` defect in review, use language that names the contract, not just the bug. Examples:

> **Reviewer:** This is `==` on `String`. It works today because the value is a literal, but the moment it comes from the database (next sprint's task), the comparison will silently fail. Use `Objects.equals(a, b)`.

> **Reviewer:** This `IdentityHashMap<Customer, ...>` is comparing customers by Java-object identity. We always reload `Customer` objects through the cache, so the same logical customer is a *different* Java object in different code paths. The contract you want is value equality — switch to `HashMap` and rely on `Customer.equals`.

> **Reviewer:** `if (status == OPEN)` is correct here — enum singleton, `==` is the idiomatic and faster choice. Keep it.

> **Reviewer:** `seen.add(node)` is using `HashSet.add` for cycle detection — that's value equality. For graph traversal, two equal-but-distinct nodes are *not* the same vertex. Switch to `Collections.newSetFromMap(new IdentityHashMap<>())`.

In all four, the reviewer names the *contract* (string equality, value equality, enum identity, identity for cycle detection). The bug is described in terms of the wrong contract chosen, not "use `.equals` instead". This is the difference between teaching the principle and treating the symptom.

---

## 5. Mentoring patterns

Juniors fall into identity bugs in a predictable order:

1. **First exposure:** `if (s1 == s2)` on strings, works in their test, fails in code review. Easy lesson; one explanation usually fixes it.
2. **Second pitfall:** boxed integer comparisons that work for `1`, `5`, `100` and break for `200`. They internalise "always `.equals` for wrappers".
3. **Third pitfall:** they discover `IdentityHashMap` from a senior, mis-apply it to a value-keyed cache, double their memory.
4. **Fourth pitfall:** they write a singleton with `INSTANCE = new Foo()`, the singleton gets serialised/deserialised, identity breaks, and they don't understand why.
5. **Fifth pitfall:** they encounter classloader-induced identity breakage (plugin architecture, app server, OSGi) and lose three days.

Mentor the progression deliberately:

- Always link the bug to a specific concrete moment: "remember when our test for the duplicate-order check passed locally and failed in CI? That was the wrapper cache turning over at 128".
- Teach `Objects.equals` *before* `.equals` so juniors never have to walk through the `NullPointerException` failure mode.
- Teach `IdentityHashMap` *only* with a working cycle-detection example. Until they see why identity is the right contract there, they will misuse it.
- Teach the enum singleton idiom (`enum Singleton { INSTANCE; }`) as the *first* singleton they meet. They never have to learn `readResolve`.

The wrong way to mentor identity-vs-equality is "always use `.equals`". That rule is *correct as a default* but doesn't teach the underlying choice. A junior who follows the rule by reflex will eventually break a graph traversal by using value equality and have no idea why. Teach the contract, not the rule.

---

## 6. Pre-commit hook templates

A team that wants to enforce identity discipline mechanically can wire a pre-commit hook. The example below uses Gradle + Error Prone, but the shape carries to Maven + SpotBugs.

```
# .git/hooks/pre-commit
#!/usr/bin/env bash
set -e
./gradlew --offline -q compileJava
# Error Prone runs as part of compileJava; non-zero exit fails the commit.
./gradlew --offline -q spotbugsMain || {
    echo "SpotBugs found a defect; see report. Identity bugs are common in flagged classes."
    exit 1
}
```

Plus the Gradle config:

```kotlin
plugins {
    id("net.ltgt.errorprone") version "3.1.0"
    id("com.github.spotbugs") version "6.0.7"
}
dependencies {
    errorprone("com.google.errorprone:error_prone_core:2.27.0")
}
tasks.withType<JavaCompile> {
    options.errorprone {
        check("ReferenceEquality",          CheckSeverity.ERROR)
        check("BoxedPrimitiveEquality",     CheckSeverity.ERROR)
        check("StringEquality",             CheckSeverity.ERROR)
        check("EqualsIncompatibleType",     CheckSeverity.ERROR)
    }
}
```

After this, no `s1 == s2` on strings, no `int1 == int2` on `Integer`, no `customer1 == customer2` on a type with overridden `.equals` survives a compile. Identity bugs in those categories are over.

---

## 7. Refactor policies — turning rules on in legacy code

Switching on `S4973` *retroactively* in a 500k-LoC codebase will produce thousands of findings. Don't panic-fix all of them; staged rollout works better.

**Stage 1 — new code only.** Configure Sonar's *"on overall code"* vs *"on new code"* split so the rule only fires on PRs. Existing violations don't block merges; new ones do. Within a few weeks, fresh code is identity-clean.

**Stage 2 — touched files.** Each PR that *modifies* a file with a pre-existing violation must also fix that violation in the touched file. The codebase becomes identity-clean as it churns naturally.

**Stage 3 — backlog burn-down.** Schedule a fixing sprint (1-2 sprints) for the long-tail files that haven't been touched in years. By this point, the count is low enough to be tractable.

**Stage 4 — full enforcement.** Rule fires on all code, blocks any PR with a finding.

The same pattern applies to `IdentityHashMap` misuse, except there's no Sonar rule for it (you write a custom one with the Sonar Java SDK, or use ArchUnit per §2).

---

## 8. The "intentional identity" comment

When `==` is the *correct* contract, code review can't tell at a glance — every reviewer's reflex is "this is a bug". Defuse it with a one-line comment:

```java
// identity by design: cycle detection over the same graph node
Set<Node> seen = Collections.newSetFromMap(new IdentityHashMap<>());

// identity by design: sentinel — there is exactly one EMPTY_RESULT
if (result == EMPTY_RESULT) return;

// identity by design: enum constants are JVM singletons
if (status == Status.OPEN) { ... }
```

The comment is more important than the choice. Six months later, a reviewer flags the line as a `==` bug and reaches for `.equals`. The comment short-circuits the discussion. Add the comment whenever `==` is intentional on a reference type that *isn't obviously* an enum or a `null` check.

Some teams formalise this with an annotation:

```java
@IdentityBased
private final Map<Thread, Session> sessions = new IdentityHashMap<>();
```

The annotation is documentation-only; pair it with a Sonar custom rule that *exempts* annotated sites from the `==` check. Custom Sonar rules are 100 lines of Java; well worth it on a team large enough that "comments get deleted in refactors" is a real risk.

---

## 9. The performance gold-plating trap

Juniors sometimes encounter `==` *advice* in performance contexts ("`==` is one instruction; `.equals` is a method call") and conclude they should switch domain comparisons to `==` for speed. This is wrong on multiple fronts:

- Modern JITs inline `equals` for monomorphic call sites; the dispatch cost is negligible.
- `String.equals` on equal strings is heavily optimised — there's an `==` fast path inside it, the length check is one branch, and the JIT vectorises the character comparison.
- *Saving a nanosecond for the wrong answer is not optimisation.*

The only legitimate identity-fast-path is *interning a key* you look up in a hot `HashMap` (covered in `senior.md` §10). Even there, the win is "the map's `==` short-circuit fires before `.equals`" — not "I use `==` instead of `.equals` in my own code".

When a junior proposes `==` "for performance", redirect them to the actual bottleneck (the profiler, the flame graph, the cache miss). Identity is almost never the answer.

---

## 10. Migrating from a `==`-heavy codebase

You inherit a service with hundreds of `==` on strings. The temptation: a giant find-replace. The risk: some of those `==` are *intentional* (sentinel checks, null checks), and the find-replace will break them.

A disciplined migration:

1. **Run the static analyser** (Sonar or Error Prone) and list every finding.
2. **Classify each finding**: defect (most are), null check (`x == null` — keep), enum compare (keep), sentinel (keep, document), intentional identity (document).
3. **Triage by file**: most defects cluster in a few files. Fix those first for the biggest impact.
4. **Apply IDE quick-fix** (IntelliJ's "Replace `==` with `equals()`" or "Replace with `Objects.equals`") in bulk; verify each replacement actually makes sense (the quick-fix can't tell if a sentinel was intentional).
5. **Add tests**. Each fix should be accompanied by a test that *would have failed* under the old `==` (e.g., load the same string from two sources, compare, assert equal).
6. **Enable the analyser at error severity** so the migration sticks.

Average case: a few hundred fixes per kilo-LoC of legacy Java written before 2010. Most are mechanical. The ones that aren't (intentional identity) are the ones you most want to *document* — they're the bugs the *next* migration is about to introduce.

---

## 11. Anti-patterns and "fake compliance"

- **Wrapping `==` in a helper.** `static boolean eq(Object a, Object b) { return a == b; }` and then `if (eq(a, b))` everywhere. Worse than the original because the violation is hidden behind a friendly name. Static analysers can't see through it. Don't do this; if `==` is intentional, write it inline with a comment.
- **Catch-and-ignore around `.equals`.** Some teams wrap every `.equals` in a try/catch because `BigDecimal.equals` and friends never threw, but their own legacy `.equals` does. The cure is to fix the broken `.equals`, not silence it.
- **Reflexive `Objects.equals` even for primitives.** `Objects.equals(intA, intB)` works (autoboxes both), but it's wasteful and reads worse than `intA == intB`. Use `Objects.equals` *only* when at least one side could be null.
- **Identity-keyed `ConcurrentHashMap`.** There is no concurrent identity map in the JDK. Some teams emulate one with `ConcurrentHashMap<Integer, V>` keyed by `System.identityHashCode(obj)`. *Don't.* Identity hash codes collide; you'll get random wrong-key bugs. Use `Collections.synchronizedMap(new IdentityHashMap<>())` if you need synchronisation, or roll a striped lock.
- **`enum` constants compared with `.equals`.** `Status.OPEN.equals(otherStatus)` is correct, but `==` is faster, NPE-safe (well, NPE on the left-side only) and idiomatic. Code reviews should flag the `.equals` version on enums.

---

## 12. Quick rules

- [ ] Enable Sonar `S4973`, SpotBugs `ES_COMPARING_STRINGS_WITH_EQ` + `RC_REF_COMPARISON`, and Error Prone `ReferenceEquality` + `BoxedPrimitiveEquality` + `StringEquality` on every Java project.
- [ ] Export IDE inspection profiles so every developer's IntelliJ flags identity bugs as they type.
- [ ] In review, name the *contract* (value equality, identity for cycles, enum singleton), not just the bug ("use `.equals`").
- [ ] Teach `Objects.equals` *before* `.equals` so juniors never meet the NPE failure mode.
- [ ] Comment every intentional `==` on a reference type with `// identity by design: <why>`.
- [ ] Use `==` on `enum` constants — it's idiomatic, faster, and NPE-safer.
- [ ] Roll out new identity-vs-equality rules on a legacy codebase in stages: new code → touched files → backlog burn-down → full enforcement.
- [ ] An `IdentityHashMap` outside cycle-detection / sentinel / per-instance tracking is a smell.
- [ ] `==` "for performance" is almost always a misguided optimisation; profile first.

---

## 13. What's next

| Topic                                                          | File              |
|----------------------------------------------------------------|-------------------|
| The canonical `==` vs `.equals()` traps for newcomers          | `junior.md`        |
| Refactoring `==` to `.equals`, identity collections            | `middle.md`        |
| When identity is the right contract, intern pools, classloaders | `senior.md`        |
| JLS §15.21, §5.1.7 boxing cache, identityHashCode spec         | `specification.md` |
| 10 buggy snippets, identity-vs-equality bug taxonomy           | `find-bug.md`      |
| Cost of `==` vs `.equals`, intern footprint, JIT fast-paths    | `optimize.md`      |
| 8 hands-on refactors and design exercises                      | `tasks.md`         |
| 20 interview Q&A                                               | `interview.md`     |

---

**Memorize this:** the identity-vs-equality choice is a *contract*, not a syntax preference. Your job as a senior is to push the obvious cases (`String ==`, wrapper `==`, domain entity `==`) into static analysis and IDE inspections so they never reach review, and to use review for the cases where identity is *intentional* — making sure they're commented, justified, and immune to the next refactor. Teach the contract; the rule "use `.equals`" follows, but the inverse doesn't.
