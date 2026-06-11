# Dependency-Breaking Techniques — Professional Level

## Table of Contents

- [The professional reality](#the-professional-reality)
- [The smallest safe step, under deadline](#the-smallest-safe-step-under-deadline)
- [A protocol for breaking a dependency on a hot system](#a-protocol-for-breaking-a-dependency-on-a-hot-system)
- [Reviewing dependency-breaking changes](#reviewing-dependency-breaking-changes)
- [When *not* to break the dependency](#when-not-to-break-the-dependency)
- [Coordinating across a team and a shared codebase](#coordinating-across-a-team-and-a-shared-codebase)
- [Pitfalls and how they bite in production](#pitfalls-and-how-they-bite-in-production)
  - [Over-introducing interfaces](#over-introducing-interfaces)
  - [Leaking test seams into production](#leaking-test-seams-into-production)
  - [Widening visibility you can't take back](#widening-visibility-you-cant-take-back)
  - [Flaky tests from shared static state](#flaky-tests-from-shared-static-state)
  - [The over-mock trap](#the-over-mock-trap)
- [War stories](#war-stories)
- [Checklists](#checklists)
- [Related Topics](#related-topics)

---

## The professional reality

On a real system, breaking a dependency is never the whole task — it's the price of admission for a change someone is waiting on. The feature, the bug, the incident is the goal; the dependency break is overhead you incur to do it *safely*. That framing governs every decision:

- You rarely get to "do it properly" in one pass. You get to make the system **a little more testable in the area you're touching**, ship the actual change, and leave a trail for the next person.
- The code is shared. Your seam-introducing edit lands in the same files three other people have open. Blast radius and merge cost are first-class concerns.
- The change runs in production. A test-only hook that escapes into a code path that executes at 2 a.m. is an incident, not a code smell.
- You're judged on shipping safely, not on technique purity. The best dependency break is the one nobody notices because it was small, obvious, and correct.

> **Key idea:** In professional work the dependency-breaking technique is a means to ship a real change under real constraints. Optimize for the smallest safe step that unblocks the test you need *for this change* — not for the cleanest possible design of the whole class.

---

## The smallest safe step, under deadline

The single most useful professional instinct: **what is the minimum edit that lets me write the one test I need, that I can make without a test to protect it?** Concretely:

1. **Scope to the change, not the class.** If you're fixing how overdue notices are worded, you need a seam on the *mailer*, not on the database, the clock, and the feature flags too. Break the one dependency in the path of your change. Leave the rest.
2. **Prefer the compiler-verified move.** Extract Interface and Extract Method are performed by the IDE and proven by the compiler. On untested code under deadline, these are the only edits you can fully trust. Reach for them first.
3. **Keep the production diff near-zero.** The ideal dependency break adds a constructor overload or an interface and changes *nothing* about runtime behavior. A reviewer should be able to see at a glance that production cannot have changed.
4. **Default the new path to the old behavior.** Keep the no-arg constructor, the overload that supplies `LocalDate.now()`, the `client or GLOBAL`. Existing callers keep working; you've only *added* a seam.
5. **Write the characterization test immediately**, while the seam and your understanding are fresh. A seam with no test is just a design change you didn't need.

```java
// Smallest safe step: add an injecting ctor, keep the old one delegating.
// Production diff is two lines; behavior is provably unchanged.
public InvoiceService(EmailSender sender) { this.sender = sender; }   // +
public InvoiceService() { this(new SmtpEmailSender(...)); }           // was the body
```

If the minimal step would still be risky (you must widen visibility, add a static setter, or restructure a constructor), prefer to **Sprout** the new behavior into a fresh tested method/class and call it from the legacy code, rather than forcing a risky break into untested territory.

---

## A protocol for breaking a dependency on a hot system

A repeatable sequence that keeps you safe when the code is load-bearing and you have no net:

```
  1. Pin behavior at the edge first.
       Write the ugliest end-to-end / characterization test you can,
       even a slow one. ANY test beats none as a backstop.

  2. Make the safest seam.
       Extract Interface / Extract Method (IDE + compiler verified).
       Production behavior cannot change → safe without unit tests.

  3. Inject or substitute.
       Parameterize Constructor (keep old ctor) or pass a fake in.

  4. Write the focused unit/characterization tests.
       Now sense/separate cleanly. Lock the current behavior.

  5. Make the actual change the ticket asked for.
       Now protected by tests at two levels.

  6. Pay down the scaffolding (if any) in a SEPARATE follow-up.
       Replace static setters / test-only overrides with real DI.
       Smaller, reviewable, revertible.
```

Two professional rules layered on top:

- **Separate the refactor commit from the behavior-change commit.** "Introduce seam (no behavior change)" and "Fix overdue wording" should be different commits — ideally different PRs. A reviewer can verify the first changed nothing and focus scrutiny on the second. If something breaks in production, you can revert the behavior change without losing the seam.
- **Never ship the scaffolding move and the cleanup in the same crunch.** Get tests in, ship the fix, file the follow-up to remove the static setter. Trying to reach the clean design in one deadline-pressured PR is how scaffolding becomes permanent.

---

## Reviewing dependency-breaking changes

When you review (or self-review) one of these PRs, the questions are specific:

| Check | What you're looking for |
|-------|-------------------------|
| **Did production behavior change?** | A "seam-only" PR should be provably behavior-neutral. If the diff touches logic, it's mislabeled — split it. |
| **Did visibility widen?** | `private`→`protected`/`public`, package-private test setters. Each one is a permanent API surface. Is it justified and minimal? |
| **Is the new interface earning its keep?** | One-method interface with one real impl *and a needed fake* = fine. One-impl interface with no fake = interface mania; push back. |
| **Can a test seam execute in production?** | Could the overridable method, factory, or setter be reached by prod code? If yes, it's a latent bug, not a seam. |
| **Is the fake recording what the test asserts?** | Sensing tests need recording fakes; a constant-returning override that "passes" may not be testing anything. |
| **Is static/global state reset?** | Static setters without teardown = future flaky test. Require `@AfterEach`/fixture cleanup. |
| **Is the new constructor cheap?** | Constructors should assign injected fields and do nothing else. Real work in a constructor is the root cause you're trying to remove. |
| **Are there tests?** | A seam with no accompanying test is incomplete. The seam was a means; the test is the deliverable. |

A good reviewer also watches *scope*: a PR titled "fix tax rounding" that extracts six interfaces and rewires the constructor graph has lost the plot. Smallest safe step applies to reviewers too — they should send sprawling "while I was in there" refactors back to a dedicated PR.

---

## When *not* to break the dependency

Breaking a dependency is a cost, and a professional knows the cases where paying it is the wrong call:

- **The collaborator is already fast, deterministic, and harmless.** If a method depends on a pure `TaxCalculator` with no I/O, don't extract an interface to fake it — use the real one. Faking a pure function adds indirection and a test that proves nothing the real object wouldn't.
- **A higher-level test already covers the path cheaply.** If a fast integration test through an in-memory database (Testcontainers, H2, an embedded broker) already exercises the logic with acceptable speed, you may not need to break the dependency at all. The point is *coverage you can trust*, not seams for their own sake.
- **The code is about to be deleted or rewritten.** Don't invest in seams for a module slated for replacement this quarter. Pin its behavior with a black-box characterization test at the edge and leave the internals alone.
- **Breaking it would require a riskier edit than the change itself.** If the only way to reach the dependency is to widen visibility across a published API or relax a `sealed` modifier the security team owns, the cost may exceed the benefit. Sprout the new behavior beside the old code instead, and test *that*.

> **Key idea:** The goal is trustworthy coverage of the change you're shipping, not a maximally seamed class. If a cheaper, less invasive path gives you that coverage, take it and leave the dependency intact.

A related judgment call: the *level* at which to break. Breaking a dependency low (deep inside a class, via Subclass-and-Override) gives a fast, focused unit test but couples you to internals. Breaking it high (at the module boundary, via an injected interface) gives a more durable test but a larger edit. Under deadline, break at whatever level the *one test you need* requires — and note in the PR that a higher-level seam is the eventual destination.

---

## Coordinating across a team and a shared codebase

Dependency-breaking edits touch widely-used classes, so coordination matters:

- **Land seam edits fast and merge often.** Extract Interface and Parameterize Constructor touch signatures and ripple to call sites. The longer such a branch lives, the worse the merge. Make the mechanical seam edit its own small PR, get it in within a day, then build your feature on top.
- **Announce signature-shaping moves.** "I'm extracting a `Payments` interface off `PaymentGateway` this afternoon" saves three people a rebase. Renames and interface extractions are exactly the edits that turn into ugly conflicts.
- **Establish team conventions for test seams.** Agree on how test-only hooks are marked (a `@VisibleForTesting` annotation, a naming convention like `forTest`, package-private visibility) so they're greppable and reviewable, and so nobody mistakes them for production API.
- **Don't unilaterally relax `final`/`sealed`.** Those modifiers are often deliberate (security, API stability, performance). Removing them for a test is a design decision the owning team should sign off on. Prefer Extract Interface, which needs no such relaxation.
- **Track the scaffolding debt.** Every static setter or test-only override is debt. A `// TODO: replace with injection (JIRA-1234)` plus an actual ticket keeps it from ossifying. Teams that skip this end up with a permanent layer of test hooks nobody dares remove.

> **Key idea:** A dependency-breaking edit is a *change to shared infrastructure*. Treat it like one: small PR, fast merge, clear convention, owner sign-off for anything that relaxes intentional constraints.

---

## Pitfalls and how they bite in production

### Over-introducing interfaces

The reflex "to test it, extract an interface" produces a codebase where every class has a mirror `IFoo`/`FooImpl` with exactly one implementation. The costs are real: navigation jumps through indirection, "go to implementation" becomes a two-step, and the interface implies a flexibility that doesn't exist. Extract an interface where you genuinely need a *seam for a fake* — not as a ritual.

```java
// Smell: interface with one impl and no fake that needs it.
interface UserMapper { User map(Row r); }      // pure function, no I/O
class UserMapperImpl implements UserMapper { ... }
// Just test UserMapperImpl directly; the interface buys nothing.
```

### Leaking test seams into production

The dangerous failure mode: a seam meant for tests is reachable by production code. An overridable `createConnection()` factory, a `setInstanceForTest`, a `protected` hook — if any production path can hit it, you've shipped a hole.

```java
// Leak: a "test" setter with public visibility and no guard.
public static void setClock(Clock c) { CLOCK = c; }   // anyone can call this in prod

// Safer: package-private, annotated, and never referenced by prod code.
@VisibleForTesting
static void setClock(Clock c) { CLOCK = c; }
```

Make seams **as private as the test mechanism allows** (package-private beats public; protected only when override is the mechanism), and audit that no production code path reaches them.

### Widening visibility you can't take back

Making a method `protected` so a test can override it is permanent: subclasses outside your control may now depend on it, especially in a library. You've converted an implementation detail into part of your inheritance contract. Before widening, ask whether Extract Interface + injection (which widens nothing) gets you there instead.

### Flaky tests from shared static state

Introduce Static Setter and Encapsulate-then-mutate-globals create state that survives between tests in the same process. One test installs a fake clock, forgets to reset, and a test three classes away fails *only when run in a certain order* — the worst kind of flake to diagnose.

```java
@AfterEach
void reset() {
    AuditLog.setInstanceForTest(new AuditLog());   // mandatory; not optional
}
```

Treat every static mutation as requiring a matching reset, and prefer injection so the state isn't global in the first place.

### The over-mock trap

It's tempting, once everything is fakeable, to mock *every* collaborator and assert on every interaction. The result: tests that pass when the code is wrong and fail when you refactor harmless internals — tests coupled to implementation, not behavior. Break the dependencies you must (real I/O, nondeterminism, slowness); for everything else prefer real objects and assert on outcomes. (See the mocking-strategies discipline in the broader curriculum and [`../04-characterization-tests/`](../04-characterization-tests/).)

---

## War stories

**The 600-line servlet.** A team needed to change pricing logic buried in a `doPost` that took `HttpServletRequest`/`HttpServletResponse` and did everything inline. The instinct was to mock the servlet API — dozens of `when(request.getParameter(...))` lines, brittle and unreadable. The fix was **Adapt Parameter**: a tiny `PricingInput` interface with the four fields the logic used, plus a `ServletPricingInput` adapter. The pricing logic moved into a plain method taking `PricingInput`. Tests became three lines with a lambda fake. The servlet shrank to "build input, call method, write response." The dependency break *and* a real design improvement, in one move — and the framework type stopped infecting the test suite.

**The singleton that ate the test suite.** A `Config.instance()` singleton was read in 40 places. Someone added a `setInstanceForTest` to unblock one test, shipped it, and didn't reset it. Within a sprint the CI suite was intermittently red depending on test order. The lesson cost two days of bisecting flakes. The repair: mandatory `@AfterEach` reset added to a shared base test class, then a slow migration to pass `Config` in by constructor so the global identity disappeared. The static setter was the right *first* move and the wrong *permanent* one — exactly the scaffolding/destination distinction.

**The factory method NPE.** An engineer applied Extract-and-Override-Factory-Method to skip a heavy `KafkaProducer` in tests, with the override reading a subclass field for the topic name. Tests threw `NullPointerException` that made no sense — because the base constructor called the override *before* the subclass field initialized. The fix was to stop overriding-from-constructor and use **Parameterize Constructor** instead, passing the fake producer in. The trap is subtle enough that it's worth a code-review checklist item of its own.

**The interface graveyard.** A codebase had adopted "extract an interface for everything to make it mockable." Two years later it had 300 single-implementation interfaces, "go to definition" landed on the interface every time, and new engineers couldn't tell which abstractions were real seams versus mechanical noise. The cleanup deleted ~70% of them. The lesson: a seam is justified by a *fake that needs it*, not by a policy.

**The leaked test hook in production.** To test a retry path, an engineer added a `protected boolean shouldRetry()` seam, defaulting to real logic, overridden in tests to force the retry branch. Months later someone subclassed the class for an unrelated production feature and inadvertently inherited — and relied on — `shouldRetry()` returning the test-friendly default in one code path. A latent double-charge bug shipped. The seam had been correct *as a test mechanism* and wrong *as production API*. The fix made the decision a constructor-injected `RetryPolicy` so there was no protected hook to inherit. The general rule it taught the team: an overridable seam whose default is reachable in production must be treated as a public extension point, reviewed as such — or, better, replaced by injection so the hole never exists.

**The "we don't need the seam" save.** A team almost spent two days extracting interfaces across a payments module to unit-test a rounding change — until someone pointed out an existing Testcontainers integration test ran the whole path against a real Postgres in 800 ms. They added one assertion to that test, shipped the rounding fix the same afternoon, and filed the seam work as optional cleanup that never became urgent. The lesson: confirm what coverage you *already* have before paying to break a dependency.

---

## Checklists

**Before you start**

- [ ] What specific change does the ticket require? What is the *one* test I need to make it safely?
- [ ] Which single dependency is in the path of that test? (Break that one, not all of them.)
- [ ] Do I already have *any* backstop test? If not, can I write a quick end-to-end one first?

**Choosing the move**

- [ ] Is there a compiler-verified move (Extract Interface, Extract Method) that gets me the seam? Prefer it.
- [ ] Can I keep production behavior provably unchanged (keep old ctor, add overload, default to global)?
- [ ] Does the language allow it? (`final`/`sealed`/`static` may force Extract Interface + inject.)
- [ ] If I must use scaffolding (static setter, test override), is it the *last* resort and clearly temporary?

**Before you commit**

- [ ] Production diff is minimal and behavior-neutral (or behavior change is in a *separate* commit/PR).
- [ ] No test seam is reachable by a production code path.
- [ ] Visibility widening is minimal, justified, and marked (`@VisibleForTesting`, package-private).
- [ ] Static/global mutations have a matching reset in teardown.
- [ ] The new constructor only assigns injected fields.
- [ ] A characterization/unit test actually exercises the new seam.

**Follow-up hygiene**

- [ ] Scaffolding (static setters, test-only overrides) has a tracked ticket to migrate to injection.
- [ ] Team is aware of any signature-shaping (interface extraction, ctor changes) to avoid merge pain.
- [ ] No new single-impl interface exists *without* a fake that needs it.

---

## Related Topics

- [`../02-the-legacy-change-algorithm/`](../02-the-legacy-change-algorithm/) — the loop these moves live inside; Sprout/Wrap for when even the smallest safe break is too risky.
- [`../03-seams-and-enabling-points/`](../03-seams-and-enabling-points/) — seams as the underlying concept; enabling points and how to keep them out of production.
- [`../04-characterization-tests/`](../04-characterization-tests/) — the deliverable every dependency break exists to enable; over-mocking pitfalls.
- [`../06-tidy-first-when-and-how/`](../06-tidy-first-when-and-how/) — separating the tidy/refactor commit from the behavior change, which this page applies to seams.
- [`../../design-principles/`](../../design-principles/) — Dependency Inversion as the destination; Interface Segregation against interface mania.
- [`../../design-patterns/`](../../design-patterns/) — Adapter (Adapt Parameter) and Factory (Extract-and-Override-Factory) as the patterns these moves realize.
- [`../../refactoring/`](../../refactoring/) — the behavior-preserving moves (Extract Method, Replace Method with Method Object) that form your compiler-as-test safety net.
