# Automated Safety Nets for Refactoring — Junior

> **Source:** Michael Feathers, *Working Effectively with Legacy Code*; Martin Fowler, *Refactoring* (2nd ed.)

## Table of Contents

1. [The one idea that makes refactoring safe](#1-the-one-idea-that-makes-refactoring-safe)
2. [The trapeze and the net](#2-the-trapeze-and-the-net)
3. [What "behavior change" actually means](#3-what-behavior-change-actually-means)
4. [The layers of the net, cheap to rich](#4-the-layers-of-the-net-cheap-to-rich)
5. [Layer 1 — the compiler and static types](#5-layer-1--the-compiler-and-static-types)
6. [Layer 2 — fast unit tests](#6-layer-2--fast-unit-tests)
7. [Layer 3 — characterization tests for code with no specs](#7-layer-3--characterization-tests-for-code-with-no-specs)
8. [A worked characterization-test example](#8-a-worked-characterization-test-example)
9. [Higher layers, in one breath](#9-higher-layers-in-one-breath)
10. [How rich does the net need to be?](#10-how-rich-does-the-net-need-to-be)
11. [When NOT to add to the net](#11-when-not-to-add-to-the-net)
12. [Glossary](#12-glossary)
13. [Review questions](#13-review-questions)
14. [Next](#next)

---

## 1. The one idea that makes refactoring safe

Refactoring means **changing the structure of code without changing its observable behavior**. The whole discipline rests on the second half of that sentence. If you rename a method, extract a function, or replace a tangle of `if`s with a polymorphic call, you are promising one thing: *the program still does exactly what it did before.*

Here is the uncomfortable truth: **you cannot keep that promise by reading the code.** You can be careful, you can be smart, you can be a senior engineer — and you will still occasionally break behavior you did not even know existed. The code does a hundred things; you were thinking about three of them.

So the real question of refactoring is not "did I change behavior?" It is:

> **"If I changed behavior, would something tell me — automatically, quickly, and loudly?"**

That "something" is your **safety net**: a body of automated checks that fail when behavior changes. The net is what converts a scary edit into a routine one.

The single most important consequence of this idea:

> **The richer your safety net, the bolder your refactoring can be.**

With no net, you tiptoe — you make one tiny change, eyeball it, redeploy, pray. With a strong net, you tear walls down and rebuild, run the net in seconds, and *know* within a minute whether you are still green. Same engineer, same brain. The net is the entire difference between fear and confidence.

This topic is the foundation for everything else in this section. IDE refactorings, codemods, and large-scale migrations are all "fearless" only because a net is watching. Without the net, automation just helps you break things faster.

## 2. The trapeze and the net

The classic analogy — and we will keep it short because the code matters more — is the circus trapeze.

A trapeze artist attempts wild, beautiful moves precisely *because* there is a net under them. Remove the net and the same artist becomes cautious, slow, and conservative; the brilliant moves disappear because the cost of one mistake is catastrophic. Add the net and the artist takes risks, falls sometimes, climbs back, and gets better.

Your test suite is the net. The point of the analogy is not "tests are nice." It is **directional**:

- A **bigger, tighter net** lets you attempt **bolder** refactorings.
- A **small or torn net** forces **timid** refactorings — or none at all.

One refinement: a net you do not trust is *worse* than no net, because it gives false confidence. A real trapeze artist who believed in a net full of holes would attempt the bold move and fall through. Most of this topic, at the higher levels, is about **measuring whether your net actually catches you** — not just whether it exists.

## 3. What "behavior change" actually means

Before we build the net, be precise about what it must catch. "Behavior" for refactoring purposes is the program's **observable output for a given input**:

- the value a function returns,
- the exception it throws (and when),
- the rows it writes to a database,
- the HTTP response it sends,
- the message it puts on a queue,
- the file it produces.

What is *not* behavior (and therefore is fair game to change during refactoring):

- which private methods exist,
- the names of internal variables,
- the number of classes,
- how many CPU cycles it takes (usually — performance can be behavior if there is a contract about it).

A safety net's job is to **observe the first list and ignore the second list.** A net that fails when you rename a private variable is not a safety net — it is a straitjacket. A net that passes when you silently return the wrong total is not a net at all. Good nets watch behavior, not structure.

## 4. The layers of the net, cheap to rich

There is no single "the net." It is layered. Each layer catches a different class of mistake, at a different cost, at a different speed. You assemble the layers you need for the change in front of you.

From **cheapest and fastest** to **richest and slowest**:

| # | Layer | Catches | Cost / Speed |
|---|-------|---------|--------------|
| 1 | **Compiler / static types** | Wrong types, missing methods, broken signatures | Free, instant |
| 2 | **Fast unit tests** | Wrong logic in a single unit | Cheap, milliseconds |
| 3 | **Characterization tests** | Any change to *current* behavior of legacy code | Medium |
| 4 | **Contract tests** | Broken agreement between two services | Medium |
| 5 | **Snapshot / approval tests** | Any change in a large output blob | Cheap to write, can be brittle |
| 6 | **Property-based tests** | Violated invariants across many inputs | Medium, high value |
| 7 | **Mutation testing** | *Holes in the net itself* | Expensive, run rarely |
| 8 | **CI gates + coverage** | Net not run; obvious gaps | Cheap signal, imperfect |

A junior should internalize the **ordering**, not memorize the table. You reach for the cheapest layer that will catch the mistake you are worried about. You only climb to expensive layers (characterization, mutation) when the cheap layers cannot help — typically on **legacy code with no tests and no specs.**

The next sections cover the three layers you will use constantly: the compiler, unit tests, and characterization tests.

## 5. Layer 1 — the compiler and static types

The cheapest net in existence is the one you already paid for: **the compiler.** In a statically typed language, an enormous class of refactoring mistakes simply cannot compile.

Rename a method `total()` to `grandTotal()` and miss a caller? The compiler points at the caller:

```java
// After renaming total() -> grandTotal(), this no longer compiles:
order.total();   // error: cannot find symbol: method total()
```

Change a parameter from `int` to `BigDecimal` and forget a call site? Compiler. Remove an enum case and leave a `switch` that handled it? In a language with exhaustive switches, compiler.

This is why IDE-driven refactorings (covered in [IDE Refactorings](../01-ide-refactorings/junior.md)) are so safe: the tool performs a *type-aware* transformation and the compiler verifies the result. The types are the net.

**The limit:** the compiler checks *shape*, not *meaning*. It happily compiles `return a - b;` when you meant `a + b`. It cannot tell that you swapped two arguments of the same type. Static types are a real net layer, but a coarse one. You still need the layers below.

> **When NOT to lean on it:** in dynamically typed languages (Python, Ruby, plain JavaScript) this layer is thin to absent. There, you compensate by leaning harder on tests, and often by adding a type checker (mypy, TypeScript) precisely to recover some of this net before a big refactor.

## 6. Layer 2 — fast unit tests

A **unit test** pins the behavior of a small piece of code with an explicit, human-written assertion of what *should* happen:

```java
@Test
void appliesTenPercentDiscountOverHundred() {
    Order order = new Order(120.00);
    assertEquals(108.00, order.priceAfterDiscount(), 0.001);
}
```

This test encodes intent: "an order over 100 gets 10% off." Now refactor `priceAfterDiscount()` however you like — extract methods, introduce a strategy, rewrite the arithmetic — and run the test in milliseconds. Green means the discount still works.

Good unit tests are the workhorse layer of the net because they are:

- **fast** — you run thousands per second, so you run them after *every* small step,
- **precise** — when one fails, it points near the break,
- **intentional** — they say what behavior *should* be, not just what it currently *is*.

That last property — intent — is what distinguishes a unit test from the next layer.

> **When NOT to:** you cannot write an intent-based unit test if you do not know the intended behavior. On a 12-year-old billing module that nobody understands, "what *should* it do?" has no answer. Writing aspirational unit tests there is guesswork that may *encode a bug as correct* or *flag correct-but-weird behavior as wrong*. That situation is exactly what the next layer is for.

## 7. Layer 3 — characterization tests for code with no specs

Most legacy code has no tests and no specification. You have been asked to refactor it. You do not fully know what it does, and the people who wrote it are gone. You cannot write intent-based unit tests because **you do not know the intent.**

Michael Feathers' answer (in *Working Effectively with Legacy Code*) is the **characterization test**, also called the **golden master** technique:

> A characterization test does not assert what the code *should* do. It asserts what the code **currently does** — including the bugs.

The mental shift is large, so say it out loud: you are going to **pin the existing behavior, exactly as it is, even if it is wrong.** Why preserve a bug? Because refactoring is "change structure, not behavior," and *the current behavior includes the bug.* Your job during refactoring is not to fix the bug — it is to **not accidentally change anything**, good or bad. Once the structure is clean and pinned, you fix the bug *deliberately*, as a separate change, with a test that now asserts the *correct* behavior.

This is the single most important technique in this whole topic for real-world code, so the next section walks through it end to end.

## 8. A worked characterization-test example

Here is a gnarly legacy method. Nobody documented it. You must refactor it, but first you must build a net.

```java
public class ShippingCalculator {
    public double cost(int weightGrams, String country, boolean express) {
        double c = 0;
        if (weightGrams <= 500) c = 4.0;
        else if (weightGrams <= 2000) c = 7.5;
        else c = 7.5 + (weightGrams - 2000) / 1000.0 * 2.0;

        if (country.equals("US")) c = c * 1.0;
        else if (country.equals("CA")) c = c * 1.3;
        else c = c * 1.8;

        if (express) c = c + 5;
        return c;
    }
}
```

**Step 1 — write a test that captures *whatever* it currently returns.** You do not yet know the right answers, so you write deliberately-wrong expectations and let the failures tell you the truth:

```java
@Test
void characterize() {
    ShippingCalculator calc = new ShippingCalculator();
    assertEquals(0.0, calc.cost(300, "US", false), 0.001);  // placeholder, will fail
}
```

**Step 2 — run it, read the failure, copy the *actual* value back in.** The runner reports:

```
expected: <0.0> but was: <4.0>
```

So the real current behavior for `(300, "US", false)` is `4.0`. You pin it:

```java
assertEquals(4.0, calc.cost(300, "US", false), 0.001);
```

**Step 3 — repeat across the input space** so every branch is exercised. Pick inputs that hit each weight tier, each country, and both `express` values:

```java
@Test
void characterizeShippingCost() {
    ShippingCalculator c = new ShippingCalculator();
    // weight tiers, US, standard
    assertEquals(4.0,  c.cost(300,  "US", false), 0.001);
    assertEquals(7.5,  c.cost(1500, "US", false), 0.001);
    assertEquals(13.5, c.cost(5000, "US", false), 0.001);  // 7.5 + 3*2.0
    // country multipliers
    assertEquals(9.75, c.cost(1500, "CA", false), 0.001);  // 7.5 * 1.3
    assertEquals(13.5, c.cost(1500, "DE", false), 0.001);  // 7.5 * 1.8
    // express surcharge
    assertEquals(9.0,  c.cost(300,  "US", true),  0.001);  // 4.0 + 5
    assertEquals(14.75,c.cost(1500, "CA", true),  0.001);  // 9.75 + 5
}
```

Notice we did not judge any of these numbers as "right." `DE` paying a 1.8× multiplier might be a bug — maybe Germany should be 1.3 like Canada. **We do not care yet.** We pinned reality.

**Step 4 — now refactor fearlessly.** Replace the country `if`-chain with a lookup, extract the weight tiers, whatever your design taste demands:

```java
public double cost(int weightGrams, String country, boolean express) {
    double base = baseCost(weightGrams);
    double total = base * countryMultiplier(country);
    return express ? total + 5 : total;
}
```

Run the characterization suite. If it is green, your refactoring is behavior-preserving — *by construction, against the actual old behavior.* If it is red, you broke something; back up. That green bar is the net catching you.

**Step 5 — fix bugs deliberately, afterward.** Now that the structure is clean and pinned, suppose `DE` really should be 1.3. You change the multiplier *and* you change the assertion from `13.5` to `9.75` in the same commit, with a message that says "fix: Germany shipping multiplier 1.8 -> 1.3." That is no longer refactoring — it is a behavior change, done openly, with the net updated to match the *new intended* truth.

That five-step loop — placeholder, read actual, pin it, refactor, fix-later — is the golden master for any small unit.

When the output is too big to assert value-by-value (a 2,000-line generated report, a rendered HTML page), you graduate to **approval testing**, where the net stores a whole "approved" output file and diffs against it. That is the next level's material; for now, know that characterization and approval testing are the same idea — pin current behavior — at different scales.

## 9. Higher layers, in one breath

You will meet these in the middle, senior, and professional files. A one-line map so the names are not strangers:

- **Contract tests** — pin the *agreement* between two services (the shape and meaning of the messages they exchange) so refactoring one side cannot silently break the other.
- **Snapshot / approval tests** — characterization tests for large outputs: store an approved blob, diff against it.
- **Property-based tests** — instead of fixed examples, assert an *invariant* ("reversing a list twice gives the original list") and let the framework throw thousands of random inputs at it.
- **Mutation testing** — the net for your net: deliberately inject bugs into your code and check whether your tests notice. Surviving bugs reveal holes.
- **CI gates + coverage** — run the whole net automatically on every push, and measure (imperfectly) how much code it touches.

## 10. How rich does the net need to be?

Match the net to the **boldness** and **risk** of the change.

- **A tiny, IDE-verified rename** in typed code? The compiler alone is often enough. Don't add tests just to feel safe.
- **Extracting a method** inside a unit that already has decent unit tests? Those tests are your net. Run them; proceed.
- **Restructuring a legacy module with no tests?** Stop. Build characterization tests *first*. The net does not exist yet, so create it before you touch the structure. This is the most common rookie mistake: refactoring legacy code with no net under it.
- **A large-scale, automated migration** across hundreds of files? You need the richest net — full suite, contract tests at boundaries, and ideally mutation testing to confirm the net has teeth — because the blast radius is huge. (See [Large-Scale Automated Migrations](../04-large-scale-automated-migrations/junior.md).)

The rule of thumb: **build the net before the bold move, sized to the move.**

## 11. When NOT to add to the net

A net can be a liability. Watch for these:

- **Over-pinning.** Characterization tests so tight they assert *internal* details (private fields, exact log lines, call order) will fail on a *legitimate* refactoring and block the very change they were meant to enable. Pin **observable behavior**, not internals.
- **Snapshot tests that lock in noise.** If your snapshot includes a timestamp, a random UUID, or hash-map ordering, it fails on every run for reasons unrelated to behavior. Either normalize the noise out or do not snapshot that field.
- **Aspirational unit tests on code you don't understand.** Writing "should-be" tests on legacy code can encode a bug as correct or condemn correct behavior. Characterize first; assert intent only once you know the intent.
- **Testing the compiler's job.** Don't write a unit test to check that a typed method rejects a wrong type — the compiler already does, faster.
- **Gold-plating.** Don't build a mutation-testing pipeline to rename one variable. The cost of the net should be proportional to the risk of the change.

The net is there to **enable** bold refactoring. The moment a piece of the net *prevents* a legitimate refactoring, it has failed at its one job — fix or delete it.

## 12. Glossary

- **Safety net** — the body of automated checks that fail when behavior changes; what makes refactoring safe.
- **Behavior** — observable output for a given input (return value, exception, DB write, HTTP response). Not internal structure.
- **Characterization test** — a test that asserts what code *currently* does (bugs included), used to pin legacy behavior before refactoring.
- **Golden master** — the characterization technique applied to large outputs: store an approved output and diff future runs against it.
- **Approval / snapshot test** — same idea as golden master, framework-assisted; an approved blob is compared against new output.
- **Contract test** — a test verifying the agreed interface between two services so neither can break the other unnoticed.
- **Property-based test** — a test that asserts an invariant over many auto-generated inputs rather than fixed examples.
- **Mutation testing** — deliberately injecting bugs ("mutants") into code to measure whether the test suite catches them; tests the net.
- **Surviving mutant** — an injected bug that no test caught — a hole in the net.
- **Coverage** — the fraction of code executed by the test suite; a signal of net reach, not net quality.
- **CI gate** — an automated rule (in continuous integration) that blocks a merge if the net is red.

## 13. Review questions

1. In one sentence, why can't you guarantee a refactoring is safe just by reading the code carefully?
2. State the directional rule that connects the size of the net to the kind of refactoring you can attempt.
3. Which behaviors must a net observe, and which structural facts should it ignore?
4. List the layers of the net from cheapest to richest, and say which one is free.
5. What is the key difference between a unit test and a characterization test?
6. Walk through the five-step golden-master loop for the `ShippingCalculator` example.
7. Why do you deliberately preserve a bug in a characterization test, and when do you finally fix it?
8. Give two examples of "over-pinning" that would block a legitimate refactoring.
9. Why is a snapshot containing a timestamp a problem, and what are your two options?
10. You must do a tiny rename in typed Java. How much net is appropriate, and why?

## Next

- [Characterization & golden-master mechanics, approval and contract tests](middle.md) — build the net properly.
- Related foundations: [IDE Refactorings](../01-ide-refactorings/junior.md) (the compiler as a net) and [Code Smells: Dispensables](../../01-code-smells/04-dispensables/junior.md) (what the net frees you to delete).
