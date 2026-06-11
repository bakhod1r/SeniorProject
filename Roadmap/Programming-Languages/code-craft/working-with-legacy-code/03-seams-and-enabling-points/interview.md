# Seams and Enabling Points — Interview Questions

A Q&A bank for interviews probing how you make untested code testable by finding or creating seams. Questions run junior → staff. Each has a model answer and most have follow-ups. The goal is to rehearse *reasoning aloud* — the follow-ups exist to catch recited definitions.

## Table of Contents

- [Q1. What is a seam? Give Feathers' definition.](#q1-what-is-a-seam-give-feathers-definition)
- [Q2. What is an enabling point?](#q2-what-is-an-enabling-point)
- [Q3. Name the seam types and rank them.](#q3-name-the-seam-types-and-rank-them)
- [Q4. Make this welded-in class testable.](#q4-make-this-welded-in-class-testable)
- [Q5. Why is `new` inside a method a testing problem?](#q5-why-is-new-inside-a-method-a-testing-problem)
- [Q6. Explain the three forms of object seam.](#q6-explain-the-three-forms-of-object-seam)
- [Q7. Show a link seam in C and its enabling point.](#q7-show-a-link-seam-in-c-and-its-enabling-point)
- [Q8. Why are link and preprocessor seams dangerous?](#q8-why-are-link-and-preprocessor-seams-dangerous)
- [Q9. Are object seams just dependency injection?](#q9-are-object-seams-just-dependency-injection)
- [Q10. How does the language/runtime shape your seam choice?](#q10-how-does-the-languageruntime-shape-your-seam-choice)
- [Q11. The enabling point is an env var. What's wrong and how do you fix it?](#q11-the-enabling-point-is-an-env-var-whats-wrong-and-how-do-you-fix-it)
- [Q12. How do you add a seam without breaking trunk for 200 callers?](#q12-how-do-you-add-a-seam-without-breaking-trunk-for-200-callers)
- [Q13. When would you NOT add a seam?](#q13-when-would-you-not-add-a-seam)
- [Q14. How do you choose between subclass-override and interface injection?](#q14-how-do-you-choose-between-subclass-override-and-interface-injection)
- [Q15. Monkeypatching in Python — convenient but what's the catch?](#q15-monkeypatching-in-python--convenient-but-whats-the-catch)
- [Q16. How do you review a seam-introducing PR?](#q16-how-do-you-review-a-seam-introducing-pr)
- [Q17. A link seam made the test suite lie. Diagnose and fix.](#q17-a-link-seam-made-the-test-suite-lie-diagnose-and-fix)
- [Q18. Relate seams to the legacy change algorithm.](#q18-relate-seams-to-the-legacy-change-algorithm)

---

## Q1. What is a seam? Give Feathers' definition.

**Level:** Junior

**Model answer.** Feathers: *a seam is a place where you can alter behavior in your program without editing in that place.* Two halves matter. "Alter behavior" — you can make the program do something different. "Without editing in that place" — you don't change the lines at the seam itself; you change which behavior runs from somewhere else. The fabric analogy: a seam is the stitched line where you swap a sleeve without cutting the cloth. In code it's the join where you can substitute a collaborator without rewriting the method that uses it.

**Follow-up — "Why does 'without editing in that place' matter so much?"** Because the whole point is to leave the risky legacy logic *untouched* while you test it. If you had to edit the code to swap behavior, you'd be changing the very thing you're trying to safely characterize — defeating the purpose. The seam lets you control behavior from outside while the code under test stays exactly as it ships.

## Q2. What is an enabling point?

**Level:** Junior

**Model answer.** Every seam has an enabling point — the place where you *choose* which behavior the seam uses. The seam is the join; the enabling point is the switch. Wall-socket analogy: the socket is the seam, the plug you choose is the enabling point. In code the most common enabling point is a constructor parameter or method argument — in a test you pass a fake, in production you pass the real thing, and the code in between never changes.

**Follow-up — "Can the seam and enabling point be the same place?"** Yes — with a parameterized method, the argument *is* both the seam and the enabling point. That's the simplest arrangement, though it pushes the choice of collaborator up to every caller, which gets noisy if many methods need it.

## Q3. Name the seam types and rank them.

**Level:** Junior → Middle

**Model answer.** Four types: **object seam** (swap a collaborator via interface injection, subclass-and-override, or method parameter), **link seam** (swap a library/object file at link time), **preprocessor seam** (`#ifdef`/macros in C/C++), and **text/config seam** (runtime rebinding like monkeypatching, or config-driven factories). Preference order: object seam first, then config, then link, then preprocessor. Object seams win because they're visible in the source, checked by the compiler (in typed languages), and local to the unit. The bottom two live in build files and configuration where they're easy to forget.

**Follow-up — "Give me the single axis that justifies the ranking."** Whether the test exercises the *same compiled artifact* you ship. Object and config seams keep one binary and choose behavior at runtime, so what you tested is what ships. Link and preprocessor seams produce *different artifacts* for test and production — a bug living only in the production artifact is never exercised by the tests. That gap is why they're last resorts.

## Q4. Make this welded-in class testable.

**Level:** Junior → Middle

**Given:**

```java
public class Checkout {
    public double finalise(Order order) {
        double total = order.subtotal();
        if (total > 100.0) total = total * 0.9;
        new SmtpMailer().send(order.customerEmail(), "Receipt", "Paid " + total);
        return total;
    }
}
```

**Model answer.** The `SmtpMailer` is welded in with `new`, so testing the discount sends a real email. I introduce an object seam: depend on a `Mailer` interface and inject it at the constructor — the enabling point.

```java
public class Checkout {
    private final Mailer mailer;                 // the seam
    public Checkout(Mailer mailer) {             // the enabling point
        this.mailer = mailer;
    }
    public double finalise(Order order) {
        double total = order.subtotal();
        if (total > 100.0) total = total * 0.9;
        mailer.send(order.customerEmail(), "Receipt", "Paid " + total);
        return total;
    }
}
```

Now the test plugs a fake in at the enabling point and senses the result without sending mail:

```java
@Test void appliesDiscountOver100() {
    Checkout checkout = new Checkout(new FakeMailer());
    assertEquals(180.0, checkout.finalise(orderOf(200.0)), 0.001);
}
```

`finalise` didn't change between test and production — behavior was altered without editing in that place.

**Follow-up — "Production has 200 callers of `new Checkout()`. How do you avoid breaking them?"** Add the injecting constructor *beside* a preserved no-arg constructor that delegates with the real default — `public Checkout() { this(new SmtpMailer()); }`. Trunk stays green, callers migrate lazily, and I can test through the seam today.

## Q5. Why is `new` inside a method a testing problem?

**Level:** Junior

**Model answer.** `new SomeService()` inside a method *welds* the dependency in — there's no place to substitute it, so no seam. To test the surrounding logic you'd have to run the real service (real DB, real network, real email), which is slow, unreliable, has side effects, and may be impossible to sense. The dependency was created at the point of use, leaving the test no enabling point to choose a different implementation. The fix is to move the *creation* outward (inject it) so the *use* site stays but the *choice* of implementation moves to an enabling point a test can reach.

**Follow-up — "So is `new` always bad?"** No — `new` for value objects and data with no side effects is fine; you don't seam a `new BigDecimal(...)`. The problem is `new` on a *collaborator with external effects or nondeterminism* — a service, a clock, an I/O gateway. Those are what you push to an enabling point.

## Q6. Explain the three forms of object seam.

**Level:** Middle

**Model answer.** In order of preference: **interface injection** — depend on an interface, pass the concrete impl at the constructor; cleanest, visible, compiler-checked; default choice. **Subclass and override** — when the constructor is too entangled to change, expose the awkward operation as a `protected` method and override it in a test subclass; the enabling point is the override (which subclass you instantiate); less clean because the seam hides in an inheritance relationship, so it's best as temporary scaffolding. **Parameterize the method** — pass the collaborator as a method argument; seam and enabling point coincide; minimal disturbance, good when only one method needs the dependency, but noisy if many do.

**Follow-up — "When is subclass-and-override the *right* first move despite being less clean?"** When the class is constructed in many places or its construction is tangled, so changing the constructor safely *right now* is expensive. Subclass-override gets the first test in without touching construction; then, with tests in place, you refactor toward honest injection. It's scaffolding — invaluable transiently, a smell if it's still there a year later.

## Q7. Show a link seam in C and its enabling point.

**Level:** Middle

**Model answer.** The source calls a symbol it doesn't define; the build chooses which object file supplies it.

```c
/* report.c — calls a linked symbol, no knowledge of the implementation */
#include "db.h"
int active_user_count(void) {
    return db_count_where("status = 'active'");  /* the seam: a linked symbol */
}
```
```makefile
report_prod: report.o db.o          # links the REAL db
	$(CC) -o $@ $^
report_test: report.o fake_db.o     # links the FAKE — same symbols, canned data
	$(CC) -o $@ $^ test_main.o
```

The enabling point is the Makefile — it decides which `.o` supplies `db_count_where`. `report.c` is byte-identical in both builds; behavior was altered without editing in that place. On Linux `LD_PRELOAD` is a runtime variant (enabling point = env var), and on the JVM classpath order is a link seam.

**Follow-up — "What's the danger that's invisible reading `report.c`?"** Nothing in `report.c` signals that its behavior depends on which object was linked. The seam is real but invisible in the source. A reader — or a debugger — has to know the *build graph* to understand why test and production behave differently. That invisibility is the link seam's core hazard.

## Q8. Why are link and preprocessor seams dangerous?

**Level:** Middle → Senior

**Model answer.** Both create a gap between the artifact you test and the artifact you ship. **Link seams hide that a seam exists** — the source gives no hint behavior depends on the link, so the fake can silently drift from the real implementation's contract while tests stay green against a fiction. **Preprocessor seams build a different program** — `#ifdef UNIT_TEST` means the source you read isn't the source that compiles; the test program and production program are literally different programs sharing text, and a bug guarded in the non-test branch is never compiled into the test build, so no test can catch it. The unifying problem: production and test don't exercise the same compiled artifact.

**Follow-up — "If you're forced to use one — legacy C, no DI — how do you bound the risk?"** Three things: keep the fake's contract tightly aligned with the real implementation so they don't drift; ensure CI builds and runs *both* the test and production artifacts (not just the test one); and add at least one integration test that exercises the *production* artifact end to end so the untested branch isn't entirely dark. You can't eliminate the gap, but you can bound the lie.

## Q9. Are object seams just dependency injection?

**Level:** Senior

**Model answer.** They overlap but aren't the same. A **seam** is a minimal, often temporary enabling point introduced to get a test in — it can be a single `protected` override or one parameterized method, local and even ugly; its job is to make *this* change safe. **DI** is a design stance: dependencies are systematically declared and supplied from outside, usually via a composition root or container; it's a property of the whole architecture. Seams are how you *retrofit* testability into code not built with DI. Repeated seam-adding tends to pull a module toward DI, but you shouldn't introduce a DI framework to add one seam — that's an architecture-scale tool for a method-scale problem. Use seams tactically; let DI be the direction you refactor toward once tests exist.

**Follow-up — "So in a codebase already built on DI, does the seam concept matter?"** Barely — the seams are everywhere by design, which is the whole point of designing for testability. The seam concept earns its keep precisely on legacy code that *wasn't* built that way; it's the retrofitting vocabulary.

## Q10. How does the language/runtime shape your seam choice?

**Level:** Senior

**Model answer.** The runtime's binding model determines which seams are first-class. **Structurally typed (TypeScript, Go):** object seams are cheapest — any value of the right shape works, a fake is just an object literal, no declared `implements` needed; you almost never drop below object seams. **Statically typed OO (Java, C#):** object seams are first-class and compiler-checked via interfaces and injection. **Dynamic (Python, Ruby, JS):** the runtime *is* a seam — every module attribute is rebindable (monkeypatch), hugely convenient but fragile because the target is a string with no compiler behind it. **Compiled, no DI (C, embedded):** object seams need hand-rolled function pointers, so a link or preprocessor seam is often genuinely the lightest option, and you accept the invisibility cost knowingly. So the *correct* seam is a function of the binding model — insisting on object seams in embedded C is as wrong as defaulting to monkeypatching in TypeScript where typed injection costs nothing.

**Follow-up — "Python lets you monkeypatch anything. Why prefer injection anyway?"** Because the runtime makes the lazy, fragile option too easy. A monkeypatch target is a string — a rename of the real symbol breaks the patch silently with no compiler to catch it. Explicit injection is more honest and survives refactoring. Monkeypatching is a fine stepping stone to get a test in fast, but not a destination for long-lived code.

## Q11. The enabling point is an env var. What's wrong and how do you fix it?

**Level:** Senior

**Model answer.** An env-var (or static-setter) enabling point is *global*, so every test that wants a fake must manipulate global process state. That serializes tests, leaks between them when teardown is forgotten, and makes parallelism unsafe — a classic source of flaky, slow suites. The fix is to move the enabling point *inward* to the most local place that works: inject the collaborator via constructor so each test controls its own instance with zero global state. Locality bounds the blast radius — a fake passed to one constructor affects one object; a fake selected by an env var affects the whole process.

**Follow-up — "You can't change the legacy code to inject right now. Interim fix?"** Wrap the set/reset of the global enabling point in a test fixture that *guarantees* cleanup (try/finally, an `@AfterEach`, a context manager), so it can't poison other tests, and put "move enabling point inward" on the refactoring backlog. The fixture contains the damage; the refactor removes the cause.

## Q12. How do you add a seam without breaking trunk for 200 callers?

**Level:** Senior → Staff

**Model answer.** Add the seam *beside* the old path, don't replace it. To inject a `Clock` into a class with a parameterless constructor used by 200 callers, *add* the injecting constructor and keep the old one delegating with the real default:

```java
public ReportService(Clock clock) { this.clock = clock; }   // new seam
public ReportService() { this(new SystemClock()); }         // preserved; 200 callers still compile
```

Trunk never breaks; I can test through the new seam today; callers migrate lazily or never. I'd use mechanical IDE refactorings (Extract Interface, Parameterize Constructor) for the extraction so it's provably behavior-preserving, and I'd slice it: an inert `refactor-only` PR adds the seam, a `tests-only` PR uses it, the feature is its own PR, and migrating old callers off the legacy constructor is separate batched PRs (optional).

**Follow-up — "Why never bundle the seam with the feature?"** Because a mixed diff hides the risky line — the reviewer can't tell which change was supposed to alter behavior versus inert plumbing. Keeping the seam introduction inert and separate lets the reviewer verify it changed nothing by inspection, and review the feature on its own small diff. That separation is where regressions stop hiding.

## Q13. When would you NOT add a seam?

**Level:** Senior → Staff

**Model answer.** A seam is a tactic, not a goal, and three signals say "refactor instead." **One — you need many seams to test one thing:** if testing one branch wants a `protected` override, a parameterized method, *and* a static setter, the unit is confessing it's badly factored; threading five fragile seams re-creates the problem, so instead *extract* the logic into a small pure unit (a Sprout) testable with zero seams. **Two — the seam would be permanent scaffolding:** subclass-override is great *temporary* scaffolding, but if it's still there a year later it's an inheritance relationship existing only for tests, confusing every reader — finish the migration to injection. **Three — the dependency shouldn't exist:** a domain calculation that reaches into a database mid-computation doesn't need a seam over the DB; it needs the data passed in so it becomes pure. The seam would paper over a design defect; the refactoring removes it.

**Follow-up — "How do you justify refactoring-instead-of-seaming to a deadline-pressured stakeholder?"** Frame it as an investment with a cost and a payback, not as perfectionism: "I can thread four seams in and it'll be fragile and the next person re-threads them, or I extract one pure unit now for slightly more effort and every future change here is cheap." Use the economics framing and keep it as a separate funded effort, not smuggled into the feature PR.

## Q14. How do you choose between subclass-override and interface injection?

**Level:** Middle → Senior

**Model answer.** Default to **interface injection** — it's visible, compiler-checked, and local, and it produces honest decoupling. Reach for **subclass-and-override** only when changing the constructor *right now* is too risky or expensive: the class is constructed in many tangled places, or creation is welded to other logic you can't safely touch yet. Subclass-override gets the first test in *without* touching construction, buying you the net you need to *then* refactor toward injection. So the rule is: injection is the destination; subclass-override is the scaffolding you use to reach it when you can't start there.

**Follow-up — "What's the smell if subclass-override sticks around?"** An inheritance hierarchy that exists purely to enable tests — readers see a `protected fetchRaw()` overridden only in test code and wonder what production subclass uses it (none). It signals an unfinished migration. Either complete the move to injection or, if it must stay, document loudly that it's a test seam.

## Q15. Monkeypatching in Python — convenient but what's the catch?

**Level:** Middle

**Given:**

```python
def test_charge_sends_receipt(monkeypatch):
    sent = {}
    monkeypatch.setattr("billing.emailer.send",
                        lambda to, body: sent.update(to=to, body=body))
    charge(Customer(email="a@b.com"), 50)
    assert sent["to"] == "a@b.com"
```

**Model answer.** It's a text/config seam where the runtime is the enabling point — no interface, no constructor change, the test rebinds `billing.emailer.send` for its duration. The catch: the patch target is a *string* (`"billing.emailer.send"`) with no compiler behind it. Rename the real `send`, or move `emailer`, and the patch silently targets the wrong thing or fails to patch — the test may pass against un-patched real code, or break confusingly. It's also coupled to the import path, so it breaks if `billing` imports `emailer` differently. Convenient for a fast test; fragile for long-lived code, where I'd prefer explicit injection.

**Follow-up — "When is monkeypatching the *right* call?"** As a stepping stone — getting a characterization test in *fast* on legacy Python you can't yet restructure, or patching something genuinely awkward to inject (a third-party module function). Treat it as transitional, not a destination, and migrate to injection for code you'll maintain.

## Q16. How do you review a seam-introducing PR?

**Level:** Staff

**Model answer.** Distinct checklist from feature review. **Is production behavior unchanged?** Adding a seam must be inert — a new injecting constructor with a delegating default should produce identical production behavior; if any existing path's behavior changes, it's not a pure seam introduction, split it. **Is the enabling point as local as possible?** Push back on static-setter or env-var enabling points if a constructor parameter would work — global enabling points cause flaky, non-parallel suites. **Is a link/preprocessor seam justified?** Only if the language affords nothing cheaper; in typed OO an object seam should exist, so ask why it wasn't used, and if link is genuinely needed, verify CI builds the production artifact and an integration test covers it. **Is scaffolding marked temporary?** A subclass-override "for now" needs a migration ticket. **Did they over-seam?** Many seams through one unit → ask whether a Sprout/extraction is cleaner.

**Follow-up — "Single most common pushback?"** Either a global enabling point (env/static setter) that'll make the suite flaky, or a mixed PR where the seam isn't inert because a behavior change rode along with it. Both are "split and localize" asks.

## Q17. A link seam made the test suite lie. Diagnose and fix.

**Level:** Staff

**Model answer.** Symptom: tests green for months, but production behaves differently. Diagnosis: a link seam (e.g. a stub jar shadowing the real class on the test classpath, or a `fake_db.o` linked into the test build) drifted from the real implementation. The real class gained a new rule; the fake didn't, because the seam is invisible in source and nobody remembered it existed. Tests kept passing against the *old* behavior — a confident liar. The structural cause is that test and production exercised different artifacts. Fix: replace the link seam with a *visible* object seam — constructor injection of an interface, so the dependency is explicit in the source and the test double is obviously a stand-in. If a link seam genuinely must stay, require a tracking comment at the call site, keep the fake's contract aligned, and add an integration test against the *real* implementation so drift surfaces.

**Follow-up — "How would you prevent this class of bug going forward?"** A review rule: link and preprocessor seams require justification (no cheaper seam available), a visible marker at the seam, CI that builds the production artifact, and an integration test on it. And bias the whole team toward object seams, whose visibility makes this drift structurally hard.

## Q18. Relate seams to the legacy change algorithm.

**Level:** Senior → Staff

**Model answer.** Seams are the mechanism behind two of the algorithm's five steps. *Find test points* needs a place to **sense** the effect; *break dependencies* needs a place to achieve **separation** so the code runs in a harness — and both "control" and "sense" are exactly what a seam provides. The algorithm's *separation* maps to a seam for control (inject a fake collaborator) and *sensing* maps to a seam for observation (a return value, or a sensing method). So the chain is: legacy code (no tests) → find a seam → break the dependency through it → write a characterization test through it → change the code safely. Seams are also why adding them must be done carefully: introducing a seam is *itself* a change to untested code, so you use mechanical, IDE-verified moves so it needs no net of its own.

**Follow-up — "The algorithm says break the *minimal* dependencies. How does that constrain seam choice?"** It pushes you to the *fewest, most local* seams that reach your test point — not to seam everything. You add a seam for the one collaborator blocking separation or sensing for *this* change, using the cheapest visible technique, and resist redesigning the class while you're in there. Minimal dependency-breaking and minimal seaming are the same discipline.

---

### How to use this bank

- **Junior/middle (Q1–Q7, Q15):** be exact on the definition, the seam/enabling-point distinction, the four seam types, and turning a `new`-welded class into an injected one.
- **Senior (Q8–Q14):** show you reason about the same-artifact axis, the language's binding model, enabling-point locality, and — crucially — *when not to seam*.
- **Staff (Q16–Q18):** show you protect the *team* — reviewing seam PRs, diagnosing seam-induced drift, and tying seams back to the broader legacy-change discipline.
- Reason aloud and invite the follow-up; naming a seam type without the trade-off behind the ranking is exactly what these questions probe.
