# Automated Safety Nets for Refactoring — Senior

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

A senior stops asking "do we have tests?" and starts asking "**does our net actually catch a behavior change, and at what cost?**" This level covers measuring net strength with mutation testing, pinning invariants with property-based tests, *designing* a net for a large refactor, the net-vs-speed trade-off, and building a net for untyped or legacy code where the cheap layers are missing.

---

## 1. The net's strength is not its size — measure it

Coverage tells you which lines *ran*. It says nothing about whether a failure would be *caught*. A suite can execute 100% of a method and assert nothing meaningful about it:

```java
@Test
void runsWithoutCrashing() {
    new ShippingCalculator().cost(1500, "CA", true);  // no assertion!
}
```

100% line coverage of `cost()`, zero behavioral protection. Change `* 1.3` to `* 3.1` and this test stays green. **Coverage measures reach; it does not measure catch.** The tool that measures *catch* is mutation testing.

## 2. Mutation testing — who tests the tests

A mutation tester deliberately introduces small bugs ("**mutants**") into your code and re-runs the suite against each:

- `a + b` → `a - b`
- `<=` → `<`
- `return x` → `return null`
- delete a method call
- negate a condition

For each mutant: if a test **fails**, the mutant is **killed** — the net caught the injected bug. If every test still **passes**, the mutant **survives** — and a surviving mutant is a **hole in your net**: a real behavior change your suite would not detect.

**Java — PIT (pitest):**

```xml
<plugin>
  <groupId>org.pitest</groupId>
  <artifactId>pitest-maven</artifactId>
  <version>1.15.0</version>
  <configuration>
    <targetClasses><param>com.acme.shipping.*</param></targetClasses>
    <mutators><mutator>STRONGER</mutator></mutators>
  </configuration>
</plugin>
```

```
> mvn org.pitest:pitest-maven:mutationCoverage

>> Generated 24 mutations Killed 18 (75%)
>> SURVIVED: ShippingCalculator.java:7
   negated conditional (weightGrams <= 500)
```

That surviving mutant is gold: it tells you no test distinguishes `<= 500` from `> 500`. Add the boundary case `(500)` vs `(501)` and the mutant dies. **Line coverage said you were done; mutation testing proved you weren't.**

**JavaScript/TypeScript — Stryker:**

```jsonc
// stryker.conf.json
{
  "mutate": ["src/shipping/**/*.ts"],
  "testRunner": "jest",
  "thresholds": { "high": 80, "low": 60, "break": 50 }
}
```

```
Mutant survived: src/shipping/cost.ts:7:5
  Original:  if (weight <= 500)
  Mutated:   if (weight < 500)
  ^ no test kills this — boundary untested
```

Mutation score (`killed / total`) is a far better measure of net quality than coverage. A module at 95% line coverage but 50% mutation score has a net full of holes.

> **When NOT to:** mutation testing is *expensive* — it reruns the suite once per mutant, so it scales with `mutants × test-time`. Running it on the whole repo on every push is a cost mistake. Scope it (see professional level): run it on the **module you are about to refactor**, before you start, to find and patch holes; or run it incrementally on changed files in CI; or nightly on a target package. Never blanket-mutate the monorepo per commit.

## 3. Property-based tests — pin invariants, not examples

Example-based tests pin specific input→output pairs. Some behavior is better expressed as an **invariant that must hold for all inputs** — and there the example approach is hopeless because you cannot enumerate the space.

A property-based test states the invariant and lets the framework generate thousands of inputs, **shrinking** any failure to a minimal counterexample.

```java
// jqwik (Java)
@Property
void encodeThenDecodeIsIdentity(@ForAll @AlphaChars String s) {
    assertEquals(s, decode(encode(s)));   // round-trip invariant
}

@Property
void shippingIsMonotonicInWeight(
        @ForAll @IntRange(min = 1, max = 100_000) int w1,
        @ForAll @IntRange(min = 1, max = 100_000) int w2) {
    Assume.that(w1 <= w2);
    // heavier never costs less (an invariant the calc must preserve)
    assertTrue(calc.cost(w1,"US",false) <= calc.cost(w2,"US",false));
}
```

Why this is a powerful net for refactoring: an invariant like "decode(encode(x)) == x" or "cost is monotonic in weight" **survives any restructuring** of the implementation. You can rewrite the encoder completely; the property still holds or it doesn't. Properties catch entire *classes* of regression that no fixed example would.

Classic refactoring-friendly properties: round-trip (serialize/deserialize), idempotence (`f(f(x)) == f(x)`), commutativity, "result is always sorted," "total equals sum of parts," and **oracle/model-based** ("the new fast implementation always agrees with the old slow one") — which is itself a characterization technique at scale.

> **When NOT to:** don't force a property where a single example is clearer. "User 42's invoice renders this exact HTML" is an example, not an invariant; wrapping it in a generator adds noise. Use properties for genuine universal laws.

## 4. Designing the net for a big refactor

Before a large, risky refactoring, you **design the net deliberately** instead of trusting whatever tests happen to exist. A senior playbook:

1. **Measure the existing net where you'll cut.** Run mutation testing on the target module *now*. The surviving mutants are exactly the behaviors your refactoring could break silently. Patch the worst holes *before* touching structure.
2. **Add characterization tests at the seams** the refactor will cross — the public methods and the observable effects (DB writes, emitted events). Pin reality, not intent (you're not fixing bugs in this pass).
3. **Add an oracle/parallel-run net for replacements.** If you're swapping an algorithm, keep the old one and assert the new one agrees on a large generated input set — a property-based oracle. This is the strongest possible net for "rewrite without changing behavior."
4. **Pin the boundaries** the cheap layers miss — branch edges, empty/null/overflow inputs, locale and timezone, concurrency if relevant.
5. **Make the net fast enough to run constantly** during the refactor (see §5). A net you run only nightly does not enable the tight refactor loop.

Then refactor in small steps, green bar after each. The net you designed is what lets the steps be *bold*.

## 5. The net-vs-speed trade-off

A richer net is a slower net, and **net speed governs refactoring tempo.** Refactoring is a loop: small change → run net → read result. If the net takes 20 minutes, you stop running it after every step, you batch changes, and a regression now hides among ten edits instead of one. The net's *latency* is part of its quality.

Resolve the tension by **tiering** the net:

- **Inner loop (seconds):** the fast unit + characterization tests around the code you're touching. Run on every step, ideally on save.
- **Outer loop (minutes):** the full suite, integration, contract tests. Run before commit / in CI.
- **Background (hourly/nightly):** mutation testing, exhaustive property runs, full cross-service contract verification.

The skill is keeping the inner loop genuinely fast. Slow inner-loop tests (hitting a real DB, sleeping, network) push you toward fakes/in-memory seams for the *fast* layer, while the *slow* layer still exercises the real thing. A net that is rich but only runs nightly silently demotes itself to "audit," not "net."

> **When NOT to optimize for speed:** the integration/contract layer is *supposed* to be slower because it tests the real boundary. Don't mock it into a fast-but-fake test that passes when the real boundary is broken. Keep that layer real; keep it in the outer loop.

## 6. Building a net for untyped and legacy code

Where the cheap layers are weak, you compensate at the higher layers.

**Untyped code (Python, Ruby, JS).** The compiler layer is thin. Two senior moves:
- **Reintroduce a type layer before the refactor** — add mypy/TypeScript and turn on strict mode just enough to recover the "did I break a call site?" net the compiler would have given you for free.
- **Lean harder on characterization + property tests**, because you've lost the structural net and must replace it with behavioral nets.

**Legacy code with no tests (the *Working Effectively with Legacy Code* problem).** The hardest case: you must change untested code, but you can't add a net without changing the code, and you can't safely change the code without a net. The escape:
- Find or create a **seam** to sense behavior without altering the path under test.
- Apply the **golden master**: capture current output over a wide input sweep into an approved file. For sprawling I/O, capture the whole effect (rendered report, DB dump) — characterization at scale.
- Use **mutation testing on the new characterization suite** to confirm it actually has teeth before you trust it for a big move. A characterization suite with surviving mutants is a net with holes; patch them first.

The senior insight throughout: **on legacy/untyped code the net does not come for free — you build it deliberately, and you verify the net itself with mutation testing before you bet a refactor on it.**

## 7. When the net is the wrong investment

- **Over-pinning at the seams** — characterization tests that assert internal call order will fail on the legitimate refactor; pin observable effects only.
- **Mutation testing everything, always** — cost explodes; scope it to the change.
- **Property tests for non-properties** — a forced invariant is harder to read than the example it replaced.
- **A rich net nobody runs** — if it only runs nightly, it stopped being a net for the inner loop. Tier it.

## Next

- [CI gates, coverage as signal vs goal, mutation cost management, tooling and team practices](professional.md).
- Related: [Refactoring to Patterns: Behavioral](../../03-refactoring-to-patterns/04-behavioral/junior.md) (bold structural moves the net underwrites).
