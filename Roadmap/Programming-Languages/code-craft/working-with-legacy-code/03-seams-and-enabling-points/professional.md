# Seams and Enabling Points — Professional Level

## Table of Contents

- [Seams on real systems, not toy classes](#seams-on-real-systems-not-toy-classes)
- [Build-system implications of each seam type](#build-system-implications-of-each-seam-type)
- [Introducing seams without destabilizing main](#introducing-seams-without-destabilizing-main)
- [Coordinating seams across teams](#coordinating-seams-across-teams)
- [When NOT to use a seam: invest in real refactoring](#when-not-to-use-a-seam-invest-in-real-refactoring)
- [Reviewing seam-introducing changes](#reviewing-seam-introducing-changes)
- [Checklists](#checklists)
- [War stories](#war-stories)
- [Pitfalls that bite teams](#pitfalls-that-bite-teams)
- [Related Topics](#related-topics)

---

## Seams on real systems, not toy classes

The worked examples in the junior and middle pages are single classes with one or two welded-in dependencies. Real legacy systems present the same idea at a scale that introduces problems the toy examples never show: the dependency you want to seam is referenced from two hundred call sites, it's a static singleton initialized at process start, the build links it from a third-party binary you can't recompile, and three other teams ship code that constructs the class you're trying to make injectable. The *concept* of a seam doesn't change. The *engineering* of getting one in safely, on a system other people depend on, is the professional skill.

This page is about leading that work: how seams interact with the build system, how to land them on a trunk without breaking everyone, how to coordinate when a seam crosses team boundaries, and — most importantly — how to recognize when adding a seam is the wrong move and the honest answer is to fund a real refactoring.

> **Key idea:** On a real system, the hard part of a seam is rarely the seam itself — it's landing it safely amid call sites, build configuration, and other teams without breaking trunk. The professional skill is the *delivery*, not the technique.

## Build-system implications of each seam type

Each seam type lands its enabling point in a different place, and on a real system that place is owned by different people and tooling. A professional thinks about *who and what the seam touches in the build* before choosing it.

| Seam type | Enabling point lives in | Build impact | Who owns it |
| --- | --- | --- | --- |
| Object (injection) | Source — constructor/param | None beyond normal compile | The code owner |
| Object (subclass/override) | Source — test subclass | None in production build | The code owner |
| Config / text | Config file, env, factory | Config management, deploy pipeline | Code + ops/platform |
| Link | Build script, linker flags, classpath | **Build graph changes; separate test artifact** | Build/platform team |
| Preprocessor | Compiler `-D` flags | **Two compilation variants to maintain** | Build/platform team |

The practical consequence: **object seams are self-contained, link and preprocessor seams pull in the build/platform team.** Choosing a link seam isn't just a code decision — it commits someone to maintaining a separate test-build target, keeping the fake's symbols in sync, and ensuring CI builds and runs *both* the production and test artifacts. If your CI only builds the test artifact (because that's the one with the tests), the production artifact can break the build and nobody notices until release. A professional who introduces a link or preprocessor seam owns making CI build the production artifact too.

Config seams have a quieter but real build cost: every config-driven enabling point is a value your deploy pipeline must set correctly per environment, and a misconfigured production environment can silently select the *test* implementation — an in-memory mailer that drops every receipt. Keep config-driven seam decisions in one obvious factory (as the middle page urges) and fail loudly if the production environment ever resolves to a test double.

## Introducing seams without destabilizing main

The dangerous moment is when adding a seam requires touching code many people depend on — changing a constructor signature, extracting an interface from a class used everywhere. Done naively, this is a giant, conflict-prone PR that breaks the build for everyone. The professional approach lands the seam *incrementally* and keeps trunk green throughout (the [keeping-the-system-shippable](../../refactoring/) discipline).

**Add the seam alongside the old path, don't replace it.** When introducing constructor injection into a class with a parameterless constructor used by two hundred callers, *add* the injecting constructor; keep the old one delegating to it with the real default. Nothing breaks; callers migrate over time.

```java
public class ReportService {
    private final Clock clock;

    // New injecting constructor — the seam. Added, not swapped.
    public ReportService(Clock clock) {
        this.clock = clock;
    }

    // Old constructor preserved, delegates to the new one with the real default.
    // 200 existing callers keep compiling; trunk stays green.
    public ReportService() {
        this(new SystemClock());
    }
}
```

Now you can write tests through the new seam *today*, and migrate the parameterless callers in follow-up PRs at your own pace — or never, if they don't need it. The seam is in; trunk never broke.

**Prefer mechanical, IDE-verified moves for the extraction.** *Extract Interface* and *Parameterize Constructor* (from [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/)) are automated refactorings the IDE can perform provably without changing behavior. Use them rather than hand-editing two hundred call sites, both for safety and to keep the diff reviewable. Remember the recursion from the [legacy change algorithm](../02-the-legacy-change-algorithm/): adding a seam is itself a change to untested code, so make it mechanical so it needs no net of its own.

**Slice the migration.** If you do want to retire the old constructor, that's a separate, later PR (or several), each migrating a batch of call sites — not bundled with the seam introduction. The seam PR is `refactor-only` and inert; the migration PRs are mechanical; the feature that needed the seam is its own PR on top.

```
PR 1  add injecting constructor (old one delegates)   refactor-only, inert
PR 2  write tests through the new seam                tests-only
PR 3  the actual feature change                       feature
PR 4+ migrate old callers off the legacy constructor  mechanical, batched (optional)
```

> **Key idea:** Add the seam *beside* the old path with a delegating default, so trunk never breaks and callers migrate lazily. Never introduce a seam by changing a widely-used signature in one big PR.

## Coordinating seams across teams

When the class you're seaming is constructed or subclassed by other teams, the seam becomes an interface negotiation.

- **Extracting an interface that other teams implement or mock** changes a contract they depend on. Adding a method to that interface breaks every implementor. Coordinate: add via a default method (Java) or a new interface they opt into, and communicate the change before merging.
- **A seam you add can leak into others' tests.** If team B was relying on the concrete type of your class, replacing it with an interface in their composition may force them to update wiring. Give notice; ideally land the seam behind the existing concrete default so their code is untouched until they choose to inject.
- **Link/preprocessor seams are shared global state in the build.** A `-DUNIT_TEST` flag or a classpath stub affects the *whole build*, not your module. If two teams both want to shadow symbols, they collide. These seams require build-team coordination precisely because their enabling point is global.

The general rule mirrors the senior page's locality preference: **the more local the enabling point, the less coordination the seam requires.** A constructor parameter is yours alone. A shared interface is a contract negotiation. A build flag is a platform-wide change. Choose the most local seam that works partly *because* it minimizes the people you must coordinate with.

## When NOT to use a seam: invest in real refactoring

This is the most important professional judgment, and the one juniors most often get wrong. A seam is a means to get a test in; it is not a goal, and it is not free. There are situations where adding a seam is the wrong move and the honest answer is to invest in actual refactoring or a Sprout.

**Signal 1 — you need many scaffolding seams to test one thing.** If testing one branch requires a `protected` override here, a parameterized method there, and a static setter for a singleton, the unit is confessing that it's badly factored. Threading five seams through a tangle just re-creates the problem for the next person. Better: *extract* the logic you care about into a small, pure unit that's testable by construction — a Sprout — and leave the tangle behind it. You add one tested unit instead of five fragile seams.

```java
// Instead of threading 4 seams through a 300-line method to test the pricing rule,
// SPROUT the rule into a pure, naturally-testable unit:
final class NightDiscountRule {
    Money apply(Money amount, int hourUtc) {       // pure: no clock, no I/O, no seam needed
        return hourUtc < 6 ? amount.times(0.95) : amount;
    }
}
// The legacy method calls it in one line; the rule is tested with zero seams.
```

**Signal 2 — the seam would be permanent scaffolding.** Subclass-and-override is excellent *temporary* scaffolding to get the first test in. If it's still there a year later, it has become a smell — an inheritance relationship that exists only for tests, confusing every reader. Either refactor it to honest injection or accept it was supposed to be transitional and finish the transition.

**Signal 3 — the dependency is the actual problem.** Sometimes the reason the code is hard to test is that it shouldn't depend on the thing at all. A domain calculation that reaches out to a database mid-computation doesn't need a *seam* over the database; it needs the data passed in so the calculation becomes pure. The seam would paper over a design defect; the refactoring removes it.

```
Hard to test because...                  Right move
─────────────────────────────────────    ─────────────────────────────────
one welded collaborator, good design  →   add an object seam (inject it)
constructor too entangled to change   →   subclass-and-override as scaffolding (temporary)
needs 4+ seams to test one branch     →   Sprout the logic into a pure unit
depends on something it shouldn't     →   refactor: pass data in, make it pure
```

The decision to refactor instead of seam is an *investment* decision — it costs more now and pays back in reduced future change cost. Frame it that way to the team and to stakeholders, using the economics in [07-the-economics-of-tidying](../07-the-economics-of-tidying/), and keep it as a separate, deliberately-funded effort ([06-tidy-first](../06-tidy-first-when-and-how/)) rather than smuggling it into a feature PR.

> **Key idea:** A seam is a tactic, not a goal. When a unit needs many seams, when the seam would be permanent scaffolding, or when the dependency shouldn't exist, the honest move is real refactoring — funded and tracked as the investment it is.

## Reviewing seam-introducing changes

Reviewing a seam PR has its own checklist distinct from feature review.

- **Is production behavior unchanged?** Adding a seam must be inert. A new injecting constructor with a delegating default should produce byte-for-byte identical production behavior. If the diff changes any existing code path's behavior, it's not a pure seam introduction — split it.
- **Is the enabling point as local as it can be?** Push back on a static setter or env-var enabling point if a constructor parameter would work. Global enabling points cause flaky, non-parallel test suites (senior page).
- **Is a link/preprocessor seam justified?** Only if the language affords nothing cheaper. If it's typed OO code, an object seam should be available — ask why it wasn't used. If a link seam is genuinely needed, verify CI builds the *production* artifact too and that an integration test covers it.
- **Is scaffolding marked as temporary?** A subclass-and-override seam introduced "for now" should carry a ticket to migrate toward injection, or it becomes permanent confusion.
- **Did the author over-seam?** If the PR threads many seams through one unit, ask whether a Sprout/extraction would have been cleaner.

| Red flag | What it means | Ask for |
| --- | --- | --- |
| New seam changes a production code path | Not a pure seam introduction | Split: inert seam PR + behavior PR |
| Static setter / env var enabling point | Flaky, non-parallel tests incoming | Most local enabling point possible |
| Link/preproc seam in typed OO code | Avoidable invisibility | Justify, or use an object seam |
| Subclass-override with no follow-up ticket | Permanent scaffolding | A migration ticket toward injection |
| Many seams threaded through one unit | Design problem papered over | Consider Sprout/extraction instead |

## Checklists

**Before introducing a seam:**

- [ ] Confirmed the unit is hard to test for separation, sensing, or both — and named which.
- [ ] Chosen the most *local* seam the code affords (constructor param > setter > static > env/build).
- [ ] Verified the seam can be added *beside* the old path with a delegating default (trunk stays green).
- [ ] Considered whether a Sprout/extraction beats threading seams (over-seaming check).
- [ ] If link/preprocessor: confirmed no cheaper seam exists, and planned CI coverage of the production artifact.

**While landing the seam:**

- [ ] Used mechanical, IDE-verified refactorings (Extract Interface, Parameterize Constructor) where possible.
- [ ] Seam PR is `refactor-only` and inert; tests, feature, and caller-migration are separate PRs.
- [ ] Trunk is shippable at every intermediate PR.
- [ ] Coordinated with other teams if the seam touches a shared interface or the build.

**For link/preprocessor seams specifically:**

- [ ] CI builds and runs *both* test and production artifacts.
- [ ] The fake's contract is kept tightly aligned with the real implementation.
- [ ] At least one integration test exercises the production artifact end to end.
- [ ] The build-team owners are aware they now maintain a second build variant.

## War stories

**The classpath stub that lied for six months.** A team got a hard-to-test class under test by shadowing it with a stub jar earlier on the test classpath — a link seam. It worked. Then the real class gained a new validation rule; the stub didn't, because nobody remembered the stub existed (invisible in source). Tests stayed green against the old behavior for six months while production rejected inputs the tests "proved" were accepted. The fix that stuck: they replaced the link seam with constructor injection (an object seam visible in the code) and added a rule that link seams require a tracking comment at the call site and an integration test against the real class. The root cause was the seam's invisibility, exactly as the senior page warns.

**The env-var seam that made the suite serial.** A service chose its mailer from an environment variable. Every test that wanted the in-memory mailer set the env var, and forgot to reset it, poisoning later tests — so the team ran the suite serially to "fix" the flakiness, and the suite ballooned to 40 minutes. The real fix was moving the enabling point inward: inject the mailer via constructor so each test controlled its own instance with zero global state. The suite went parallel and dropped to four minutes. The lesson: a global enabling point is a flaky-test and slow-suite factory regardless of how clean the seam looked.

**The over-seamed god method.** An engineer needed to test one pricing rule buried in a 400-line method and proposed four seams — a clock override, an injected FX client, a parameterized tax service, and a static setter for a config singleton — to reach it. In review, a senior asked: "what if you extract the pricing rule into a pure function?" The rule became a 12-line `NightDiscountRule` tested with no seams at all, called from one line in the legacy method. Four fragile seams collapsed into one clean extraction. The team adopted "if you need three or more seams to test one thing, try a Sprout first" as a review heuristic.

## Pitfalls that bite teams

| Pitfall | Why it's a *team* problem | Counter |
| --- | --- | --- |
| Link/preproc seam, CI only builds test artifact | Production artifact breaks silently | CI builds both; integration test on prod artifact |
| Global enabling point (env/static) | Flaky, serial, slow suite for everyone | Most local enabling point; inject |
| Big-bang constructor-signature change | Breaks trunk and everyone's build | Add seam beside old path; migrate lazily |
| Shared-interface seam without notice | Breaks other teams' implementors | Coordinate; default methods; communicate |
| Permanent subclass-override scaffolding | Confuses every future reader | Track and migrate to injection |
| Over-seaming a god method | Re-creates the tangle next time | Sprout/extract a pure unit instead |
| Config seam selecting test double in prod | Silent data loss (e.g. dropped emails) | One factory; fail loudly if prod resolves to a fake |

> **Key idea:** Most seam disasters at team scale come from *global* enabling points and *invisible* (link/preprocessor) seams — both create gaps between what you test and what you ship. Prefer local, visible object seams; when forced off them, cover the production artifact explicitly.

## Related Topics

- [01-what-is-legacy-code](../01-what-is-legacy-code/) — code without tests; seams begin the path to coverage.
- [02-the-legacy-change-algorithm](../02-the-legacy-change-algorithm/) — seams power *find test points* and *break dependencies*; adding a seam is itself an untested change to keep mechanical.
- [04-characterization-tests](../04-characterization-tests/) — the tests you write through the seams you introduce.
- [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/) — Extract Interface, Parameterize Constructor, Subclass and Override: the mechanical moves that create seams safely.
- [06-tidy-first-when-and-how](../06-tidy-first-when-and-how/) — keeping seam introduction (structural) separate from behavior change.
- [07-the-economics-of-tidying](../07-the-economics-of-tidying/) — the investment case for refactoring instead of seaming.
- [../../refactoring/](../../refactoring/) — keeping trunk shippable while landing seams incrementally; mechanical refactorings.
- [../../design-principles/](../../design-principles/) — dependency inversion: designing so seams exist without retrofitting.
