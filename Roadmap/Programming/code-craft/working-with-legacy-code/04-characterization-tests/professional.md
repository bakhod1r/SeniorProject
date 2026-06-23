# Characterization Tests — Professional Level

## Table of Contents

- [The scenario: a legacy pricing engine under deadline](#the-scenario-a-legacy-pricing-engine-under-deadline)
- [Step 0 — establish a beachhead](#step-0--establish-a-beachhead)
- [Step 1 — broad golden master before any surgery](#step-1--broad-golden-master-before-any-surgery)
- [Approval-testing tooling in practice](#approval-testing-tooling-in-practice)
- [Taming non-determinism in the real module](#taming-non-determinism-in-the-real-module)
- [CI integration](#ci-integration)
- [Reviewing and maintaining golden masters](#reviewing-and-maintaining-golden-masters)
- [Team workflow and conventions](#team-workflow-and-conventions)
- [Pitfalls from the field](#pitfalls-from-the-field)
- [Retiring the scaffolding](#retiring-the-scaffolding)
- [Related Topics](#related-topics)

---

## The scenario: a legacy pricing engine under deadline

You own a change to `PricingEngine`, a 1,400-line class at the center of a checkout system. It has three tests, all trivial. Product needs a new "loyalty tier" discount shipped in two weeks. The class reads the clock, hits a currency-rate service, formats money by locale, and produces a `PriceBreakdown` object with two dozen fields. Nobody on the current team wrote it, and the original author left.

This is the realistic shape of characterization work: not a tidy five-branch function, but a load-bearing legacy module you must change *safely, under time pressure, without a complete understanding of it.* The plan below is the one a professional actually runs.

```
 Day 1        Day 2-3            Day 4-7              Day 8-10        Day 11-14
 ┌──────┐     ┌──────────┐       ┌──────────────┐    ┌──────────┐    ┌─────────┐
 │ seam │ ──▶ │ golden   │ ──▶   │ refactor +    │ ─▶ │ add new  │ ─▶ │ retire  │
 │ for  │     │ master   │       │ split, net    │    │ behavior │    │ dead    │
 │ I/O  │     │ baseline │       │ stays green   │    │ via TDD  │    │ scaffold│
 └──────┘     └──────────┘       └──────────────┘    └──────────┘    └─────────┘
```

---

## Step 0 — establish a beachhead

You cannot golden-master a class that calls a live currency service and reads the wall clock — the output changes every run. Before any characterization, introduce the minimum seams to make the engine *deterministic from the outside*. This borrows directly from [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/); here we just apply it.

```java
// BEFORE: hidden inputs baked in
class PricingEngine {
    PriceBreakdown price(Cart cart) {
        BigDecimal rate = CurrencyService.getInstance().rate(cart.currency()); // network
        LocalDate today = LocalDate.now();                                     // clock
        ...
    }
}

// AFTER: smallest possible seam — inject the two non-deterministic collaborators.
// "Parameterize Constructor" with a delegating old constructor keeps every
// existing caller compiling, so the seam is a zero-risk preparatory commit.
class PricingEngine {
    private final CurrencyService currency;
    private final Clock clock;

    PricingEngine(CurrencyService currency, Clock clock) {
        this.currency = currency;
        this.clock = clock;
    }
    PricingEngine() {                              // preserves existing callers
        this(CurrencyService.getInstance(), Clock.systemUTC());
    }

    PriceBreakdown price(Cart cart) {
        BigDecimal rate = currency.rate(cart.currency());
        LocalDate today = LocalDate.now(clock);
        ...
    }
}
```

Commit this seam *by itself*, reviewed as a pure preparatory refactor ("no behavior change, enables testing"). Now in tests you pass a fixed `Clock` and a `FakeCurrencyService` returning canned rates, and the engine is reproducible.

> **Key idea:** The first deliverable of legacy characterization is usually a *seam commit*, not a test. You cannot photograph a moving subject; hold it still first.

---

## Step 1 — broad golden master before any surgery

With the engine deterministic, generate a wide golden master *before touching the logic*. The goal is maximal safety while your understanding is minimal, exactly the broad-first strategy from [senior.md](./senior.md).

```java
class PricingEngineCharacterizationTest {

    private PricingEngine engine() {
        Clock fixed = Clock.fixed(Instant.parse("2026-05-10T00:00:00Z"), ZoneOffset.UTC);
        return new PricingEngine(new FakeCurrencyService(Map.of("USD", "1.0", "EUR", "0.9")), fixed);
    }

    @Test
    void characterizePricingGrid() {
        List<String> rows = new ArrayList<>();
        int[]    quantities = {0, 1, 2, 10, 11};
        String[] currencies = {"USD", "EUR"};
        String[] tiers      = {"NONE", "SILVER", "GOLD"};
        String[] coupons    = {"", "SAVE10", "BOGUS"};

        for (int q : quantities)
          for (String cur : currencies)
            for (String tier : tiers)
              for (String coupon : coupons) {
                  Cart cart = new Cart(q, new BigDecimal("19.99"), cur, tier, coupon);
                  PriceBreakdown b = engine().price(cart);
                  rows.add(String.format("q=%d cur=%s tier=%s coupon=%-6s -> %s",
                                         q, cur, tier, coupon, render(b)));
              }

        Approvals.verify(String.join("\n", rows));  // golden master via ApprovalTests
    }
}
```

That `5 × 2 × 3 × 3 = 90`-row master is reviewable in a diff, exercises every tier/coupon/quantity-boundary interaction, and becomes the net under which all later refactoring happens. You *read the 90 lines once, by eye*, accept that they describe current behavior (bugs and all), and approve them. From that moment, any refactor that changes a single cell turns the build red.

---

## Approval-testing tooling in practice

Hand-rolling the received/approved diff (as in [middle.md](./middle.md)) works but you will not maintain it across hundreds of masters. Use a real approval library; they all implement the same loop and integrate with your test runner and diff viewer.

| Ecosystem | Library | How a mismatch surfaces |
|---|---|---|
| Java / JVM | **ApprovalTests** (`Approvals.verify`) | Writes `*.received.txt`, opens a diff tool, fails until you rename received → approved |
| .NET | **Verify** / ApprovalTests.Net | `*.received` vs `*.verified`; diff tool on mismatch |
| Python | **ApprovalTests.Python**, or `pytest`'s **syrupy** snapshots | `snapshot` fixture; `--snapshot-update` to re-approve |
| JS / TS | **Jest `toMatchSnapshot`**, or **approvals** | Inline or file snapshots; `jest -u` to update |
| Go | **goldie**, `cupaloy` | `-update` flag rewrites golden files |

The mechanics, illustrated with Jest snapshots (the most widely seen form of approval testing):

```javascript
// pricing.characterization.test.js
const { price } = require("../pricingEngine");
const { fixedClock, fakeRates } = require("./helpers");

test("characterize pricing grid", () => {
  const rows = [];
  for (const q of [0, 1, 2, 10, 11])
    for (const cur of ["USD", "EUR"])
      for (const tier of ["NONE", "SILVER", "GOLD"]) {
        const breakdown = price(
          { qty: q, unit: 19.99, currency: cur, tier },
          { clock: fixedClock, rates: fakeRates }   // seams injected
        );
        rows.push(`q=${q} cur=${cur} tier=${tier} -> ${JSON.stringify(breakdown)}`);
      }
  // First run: Jest writes the snapshot file and passes.
  // YOU MUST still read the written .snap by eye before committing it.
  expect(rows.join("\n")).toMatchSnapshot();
});
```

A critical workflow nuance: Jest *passes* on the first run when it writes a new snapshot. That is a footgun for characterization — the framework's "approval" is silent and automatic, so it is entirely on you to open the generated `__snapshots__/*.snap` and review it before committing. Many false safety nets enter codebases because someone ran `jest -u`, saw green, and committed a snapshot of behavior nobody actually inspected.

> **Key idea:** Snapshot tools make *capturing* a baseline trivial and make *reviewing* it easy to skip. The professional discipline is: a snapshot is not approved until a human has read it. Re-approval (`-u`, `--snapshot-update`) is a deliberate, reviewed act, never a reflex to make the build green.

---

## Taming non-determinism in the real module

The toy `Clock` injection from [senior.md](./senior.md) is the easy 80%. Real modules leak non-determinism through more channels. Handle each at its source where you can; scrub only what you cannot inject.

| Channel | Real-world symptom | Professional handling |
|---|---|---|
| Wall clock | Late fees, "valid until" dates drift | Inject `Clock`; one fixed instant per suite |
| Currency / pricing feed | Totals change with the market | Inject a fake returning frozen rates |
| Locale / time zone | CI in UTC, dev in CET → different money formatting | Pin locale explicitly in the test; never rely on default |
| Generated IDs | New UUID per `PriceBreakdown` | Inject an ID generator, or scrub `<UUID>` |
| Floating point / `BigDecimal` scale | `19.990000001` jitter across JVMs | Format to fixed scale before capture |
| Map/set ordering in serialization | Snapshot lines reorder randomly | Serialize with sorted keys |
| Concurrency | Output order depends on scheduling | Force single-threaded execution in the characterization run |

The decision rule the team should write down: **inject if the source is a collaborator you can pass in; scrub if it is woven so deep that injecting it is riskier than the change you came to make.** Scrubbing is debt — it hides part of the output from the net — so it is the exception, logged with a comment explaining *why injection was infeasible*.

A worked scrubber for the pricing engine, showing the discipline of scrubbing *narrowly*:

```java
/** Replace ONLY the genuinely non-deterministic fragments. Everything else
 *  (totals, discounts, currency codes) must remain visible to the net. */
static String scrub(String breakdown) {
    return breakdown
        .replaceAll("\\b[0-9a-f]{8}-[0-9a-f-]{27}\\b", "<UUID>")   // generated ids
        .replaceAll("generatedAt=\\S+", "generatedAt=<TS>");       // any leaked clock
    // NOTE: we do NOT touch numbers — a wrong total MUST still fail the test.
}
```

The comment is load-bearing. The next engineer who reaches for a broader regex ("let me just scrub all the numbers, the test is flaky") is being told, in the code, exactly which fragment is safe to normalize and which is the behavior under protection. Over-scrubbing here would quietly punch a hole in the net at the most important spot — the money.

---

## CI integration

A characterization suite earns its keep only by running on every change. Wiring decisions that matter:

- **Run them in the normal test job**, tagged so they are visible. In JUnit, `@Tag("characterization")`; in Jest, a filename convention (`*.characterization.test.js`). This lets you run or exclude them selectively without losing them.
- **Fail the build on `*.received`/`*.snap` mismatch.** That is the entire point. A characterization failure is a *behavior change*; CI must stop and demand a human decision.
- **Never auto-approve in CI.** `jest -u`, `--snapshot-update`, ApprovalTests' auto-rename must be *disabled* on CI. Approval is a developer action on a developer's machine, reviewed in the PR. CI that silently re-approves is a net with the safety catch removed.
- **Block "untracked received files."** Add a CI guard that fails if any `*.received.*` file exists after the test run, catching the case where a developer forgot to either approve or fix.
- **Keep them fast and hermetic.** Because you injected the clock, currency service, and I/O, the suite should run in-memory with no network — fast enough to live in the main pipeline, not a nightly job.

```yaml
# CI guard: fail if any approval test left an un-reviewed received/snapshot artifact
- name: Run tests
  run: ./gradlew test            # JEST_CI=true / CI=true prevents -u auto-update
- name: Reject un-approved approval artifacts
  run: |
    if find . -name "*.received.*" | grep -q .; then
      echo "Un-approved approval output present — review and approve locally."; exit 1
    fi
```

> **Key idea:** On a developer's laptop, approval is interactive and human-reviewed. On CI, approval must be impossible — CI only *checks*, it never *blesses*. Conflating the two is how garbage baselines get committed.

---

## Reviewing and maintaining golden masters

A golden master is a checked-in artifact that lives and changes with the code, so it needs the same review rigor as code — arguably more, because diffs to it encode behavior changes.

**Reviewing a master in a PR:**

- A change to an approved file is a **behavior change** and must be justified in the PR description. "Refactor: extract method" should produce *zero* master diff. If the master moved during a refactor, the refactor was not behavior-preserving — that is a red flag, not a rubber stamp.
- When a master *should* change (you fixed a bug, added the loyalty tier), the diff should be **small and legible** — exactly the cells you intended. A 1-line logic change that rewrites 800 lines of master means the master is too coarse and is hiding the real change in noise. Split it.
- Reviewers diff the *master*, not just the code. The master diff is the clearest statement of what behavior actually changed.

**Keeping masters healthy over time:**

- **Split by concern.** One master per cohesive behavior (pricing grid, money formatting, coupon validation) rather than one mega-file. Failures then point at the right area and diffs stay readable.
- **Keep them reviewable.** A master nobody can read in a diff is decoration. Cap size; prefer boundary-rich small grids over dense enumerations.
- **Re-baseline deliberately.** When you intentionally change behavior, regenerate and *re-review* the affected master in the same PR. The re-baseline is the documentation of the change.
- **Prune incidental capture.** If a master pins a log line's wording or a field order nobody cares about, narrow it so unrelated tidies do not trip it.

---

## Team workflow and conventions

The technique fails without shared conventions, because the failure modes (false confidence, frozen bugs, unreadable masters) are social as much as technical. Establish:

| Convention | Concrete form |
|---|---|
| Naming | `characterize*` / `*CharacterizationTest`; masters under `approved/` or `__snapshots__/` |
| Suspected bugs are tagged | `@Tag("pinned-bug")` + a tracking ticket; never silently defended forever |
| Seam-first commits | Preparatory seam commits are separate from characterization commits, both separate from behavior changes |
| Refactor ⇒ zero master diff | A PR labeled "refactor" that changes a master is sent back |
| Approval is a human act | Re-baselining is reviewed; CI may never auto-approve |
| Scaffolding is disposable | Pure characterization tests may be deleted once specification tests cover the same behavior |

Walk a teammate through the loop the first time pairing, not in a wiki — the "assert wrong, read the reveal, paste, does-this-surprise-me" rhythm is muscle memory that does not transmit well in prose. The single most important cultural point to instill: **green here means *unchanged*, not *correct*** ([senior.md](./senior.md) covers why), so nobody mistakes a passing characterization suite for a quality guarantee.

It helps to give the team a one-paragraph definition of done for a characterization task, so "I added some tests" cannot pass for finished:

> A characterization change is done when: the non-determinism is injected (or narrowly scrubbed with a justifying comment); the change region's branches are pinned and confirmed via a coverage run; suspected bugs are tagged, not silently defended; the golden masters were read by a human and are small enough to diff; and CI fails on mismatch without any path to auto-approval.

Print that, link it from the PR template, and the technique stops degrading into "snapshot everything and hope" — the most common way teams adopt the *form* of characterization testing while missing its *substance*.

---

## Pitfalls from the field

- **The blessed-garbage master.** Someone ran `--update`, saw green, committed a 2,000-line snapshot nobody read. The suite now faithfully defends behavior no human has ever verified. *Cure:* mandatory human review of new/changed masters; small reviewable masters.
- **The refactor that silently fixed a bug.** A "cleanup" PR changed a master cell from a wrong value to a right one. It merged because the reviewer assumed master diffs were fine. *Cure:* refactor PRs must produce zero master diff; any diff is scrutinized.
- **The brittle mega-master.** One file pins everything; every change rewrites hundreds of lines; engineers start re-approving without reading. *Cure:* split by concern, narrow projections.
- **Characterizing a moving target.** Tests flake because the clock/RNG/locale was never injected. Team loses trust, marks them `@Disabled`. *Cure:* seam-first; inject before you capture.
- **Eternal scaffolding.** Years later, thousands of `characterize_case_N` tests freeze every implementation detail; the module is now *harder* to improve than before it had tests. *Cure:* treat characterization tests as disposable; retire them as specification tests take over.
- **Pinning at the wrong layer.** Byte-comparing rendered HTML when you only care about the total. Every CSS tweak breaks the "pricing" tests. *Cure:* pin the parsed, semantic projection, not the rendering.

---

## Retiring the scaffolding

Two weeks in, the loyalty tier is shipped. The engine has been split into `PricingEngine`, `DiscountPolicy`, and `MoneyFormatter`, each now small and covered by *intent-revealing specification tests* (`goldTierGets15PercentOnOrdersOver200`). At this point a chunk of the original broad golden master pins implementation detail of a structure that no longer exists.

A professional closes the loop by **deliberately deleting the redundant scaffolding**, keeping only the masters that still earn their place (e.g. the money-formatting grid across locales, which a spec test would express clumsily). This is not throwing away safety — it is upgrading from "behavior is frozen" to "behavior is specified," which is strictly better. Leaving the scaffolding forever is the slow path to a codebase where nothing can change without a wall of red.

> **Key idea:** Characterization tests are the safety harness for a renovation. You wear them while the walls are open; you take them off when the building stands and proper specification tests hold the structure. Keeping the harness on forever is its own failure mode.

---

## Related Topics

- [01-what-is-legacy-code](../01-what-is-legacy-code/) — The "no tests" definition that makes characterization necessary.
- [02-the-legacy-change-algorithm](../02-the-legacy-change-algorithm/) — Where in the module to invest characterization effort.
- [03-seams-and-enabling-points](../03-seams-and-enabling-points/) — Finding the seams that make a real module observable and deterministic.
- [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/) — The exact moves (Parameterize Constructor, Extract Interface) used in Step 0.
- [../../craftsmanship-disciplines/](../../craftsmanship-disciplines/) — TDD and specification testing, the practices that *replace* characterization scaffolding once code is clean.
- [../../refactoring/](../../refactoring/) — The behavior-preserving transformations the golden master protects.
