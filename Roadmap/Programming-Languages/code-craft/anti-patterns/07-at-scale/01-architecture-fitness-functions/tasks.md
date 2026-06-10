# Architecture Fitness Functions — Practice Tasks

> **Category:** [Anti-Patterns at Scale](../README.md) → **Architecture Fitness Functions**
> **Covers (collectively):** Layering & dependency rules · Cycle-detection gates · Allowed-dependency contracts · Metric thresholds · Evolutionary architecture & CI gating

---

These are **build-it** exercises, not recognition quizzes. For each one you get a problem statement, starting material (a package layout plus a stubbed config or test), acceptance criteria, and a collapsible solution with the full working check and an explanation. The point is to *write the fitness function* — a layering rule, a layered contract, a no-cycle gate, and a baseline-then-forbid-new script for legacy code.

> **How to use this file.** Read the problem, write the check in your editor *before* opening the solution, then **test the test**: plant the violation and confirm your check goes red, fix it and confirm green. A rule you've never seen fail is a rule you have no evidence works. Refer back to [`junior.md`](junior.md) for the concept and [`senior.md`](senior.md) for designing a full suite.

---

## Table of Contents

| # | Exercise | Skill | Tool | Difficulty |
|---|---|---|---|---|
| 1 | [A layering rule in ArchUnit](#exercise-1--a-layering-rule-in-archunit) | Forbidden + layered dependency | ArchUnit (Java) | ★★ medium |
| 2 | [A layered contract in import-linter](#exercise-2--a-layered-contract-in-import-linter) | Ordered layers, one declaration | import-linter (Python) | ★★ medium |
| 3 | [A no-cycle gate](#exercise-3--a-no-cycle-gate) | Cycle detection in CI | ArchUnit + madge | ★★ medium |
| 4 | [Baseline-then-forbid-new for legacy](#exercise-4--baseline-then-forbid-new-for-legacy) | Freeze debt, fail on new | shell + `go list` | ★★★ hard |
| 5 | [Test the test: prove a rule fires](#exercise-5--test-the-test-prove-a-rule-fires) | Defeat the vacuous-pass trap | ArchUnit (Java) | ★★ medium |

---

## Exercise 1 — A layering rule in ArchUnit

**Skill:** forbidden + layered dependency · **Tool:** ArchUnit (Java) · **Difficulty:** ★★ medium

You have a classic layered service:

```
com.shop.web          // controllers, request/response DTOs
com.shop.service      // business logic
com.shop.repository   // data access (JDBC, JPA)
com.shop.db           // raw row mappers, connection helpers
```

The agreed architecture is `web → service → repository → db`, **one direction, no skipping**. Today nothing enforces it, and a controller already reaches straight into `repository`.

**Starter:**

```java
// src/test/java/com/shop/ArchitectureTest.java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.library.Architectures;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.shop")
class ArchitectureTest {

    // TODO 1: forbid web → db directly (the simplest shape)
    // TODO 2: encode the full ordered stack web → service → repository → db
}
```

**Acceptance criteria**
- A **forbidden-dependency** rule proves the simplest shape: no `..web..` class may depend on a `..db..` class.
- A **layered** rule encodes the whole stack so that *any* upward or skipping edge fails (e.g. `repository → web`, `web → repository`).
- Each rule carries a message explaining *why*, so a red build teaches the fix.
- You can articulate why the layered rule subsumes several forbidden rules.

**Hint:** ArchUnit ships `Architectures.layeredArchitecture()` for the ordered case; `noClasses()...dependOnClassesThat()` for a single forbidden edge.

<details>
<summary>Solution</summary>

```java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import com.tngtech.archunit.library.Architectures;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

@AnalyzeClasses(packages = "com.shop")
class ArchitectureTest {

    // (1) The simplest shape: a single forbidden dependency.
    @ArchTest
    static final ArchRule web_must_not_touch_db =
        noClasses().that().resideInAPackage("..web..")
            .should().dependOnClassesThat().resideInAPackage("..db..")
            .because("the web layer must go through service/repository, "
                   + "never reach raw db helpers directly");

    // (2) The whole ordered stack in one declaration.
    @ArchTest
    static final ArchRule layered =
        Architectures.layeredArchitecture()
            .consideringOnlyDependenciesInLayers()
            .layer("Web").definedBy("..web..")
            .layer("Service").definedBy("..service..")
            .layer("Repository").definedBy("..repository..")
            .layer("Db").definedBy("..db..")
            // who may be called BY whom (access is "from above only"):
            .whereLayer("Web").mayNotBeAccessedByAnyLayer()
            .whereLayer("Service").mayOnlyBeAccessedByLayers("Web")
            .whereLayer("Repository").mayOnlyBeAccessedByLayers("Service")
            .whereLayer("Db").mayOnlyBeAccessedByLayers("Repository")
            .as("web -> service -> repository -> db, one direction, no skipping");
}
```

**Explanation.** Rule (1) is the forbidden-dependency primitive: it asserts a single edge (`web → db`) is absent and nothing more. It's binary and unarguable, and it's the right first rule when you only care about one boundary.

Rule (2) does the whole job at once. `layeredArchitecture()` reads as "who may be *accessed by* whom": `Repository` may only be accessed by `Service`, so the controller-into-repository edge fails; `Web` may not be accessed by anyone, catching any reverse import; and because each layer names exactly its allowed callers, a *skip* like `web → repository` is also illegal (Web isn't in Repository's allowed-callers list). That single declaration is equivalent to roughly half a dozen hand-written `noClasses()` rules — and it doubles as documentation, because the layer order *is* the architecture diagram. The `.because(...)` / `.as(...)` messages mean a violation prints not just "rule broken" but the intent, so the next person fixes the code instead of cursing the check.

**Test the test:** with the existing controller-into-repository call in place, run the test and confirm rule (2) goes **red** and names the offending class and line. Route that call through a service method, rerun, confirm green. A layering rule you've only ever seen pass might be matching the wrong packages — make it fail on purpose once.

</details>

---

## Exercise 2 — A layered contract in import-linter

**Skill:** ordered layers in one declaration · **Tool:** import-linter (Python) · **Difficulty:** ★★ medium

Same architecture, Python package:

```
shop/
  web/          # FastAPI routers
  service/      # business logic
  repository/   # SQLAlchemy data access
  db/           # engine, session, raw helpers
```

Rule: `shop.web → shop.service → shop.repository → shop.db`, one direction, no skipping. Currently `shop/web/orders.py` does `from shop.repository.orders import OrderRows` — a skip that bypasses the service layer.

**Starter:**

```ini
# setup.cfg
[importlinter]
root_package = shop

# TODO: one contract that encodes the ordered stack
```

**Acceptance criteria**
- A single **`layers`** contract encodes the full ordered stack (not four hand-written `forbidden` contracts).
- `lint-imports` exits non-zero while the skip exists, and zero once it's routed through `shop.service`.
- The contract names the layers high-to-low; you can explain what edges it forbids.

**Hint:** import-linter's `type = layers` lists layers highest-first; it forbids every lower→higher import, and (with the default behavior) also catches skips when the layers are independent.

<details>
<summary>Solution</summary>

```ini
# setup.cfg
[importlinter]
root_package = shop

[importlinter:contract:layered]
name = Web -> service -> repository -> db, one direction only
type = layers
layers =
    shop.web
    shop.service
    shop.repository
    shop.db
```

Run it:

```bash
$ lint-imports
=========
Contracts
=========

Analyzed 41 files, 312 dependencies.
-----------------------------------

Web -> service -> repository -> db, one direction only BROKEN

----------------
Broken contracts
----------------

Web -> service -> repository -> db, one direction only
------------------------------------------------------

shop.web is not allowed to import shop.repository:
- shop.web.orders -> shop.repository.orders (l.3)
```

The fix — route through a service function — makes it pass:

```python
# shop/web/orders.py  (after)
from shop.service.orders import list_orders   # was: from shop.repository.orders import OrderRows
```

```bash
$ lint-imports
... Web -> service -> repository -> db, one direction only KEPT
Contracts: 1 kept, 0 broken.
$ echo $?
0
```

**Explanation.** The `layers` contract lists the stack highest-to-lowest. In one declaration it forbids *every* edge that points up the stack (`repository → service`, `service → web`, `db → anything-above`) **and** — because higher layers may only reach the layer directly below — it catches the *skip* `web → repository`, which is exactly the violation here. You did not write four `forbidden` contracts; the ordering encodes them all, and the layer list reads as the architecture diagram. The non-zero exit code is what makes it a CI gate: wire `lint-imports` into the required pipeline and the skip can never merge again.

(If you genuinely want to permit a skip — e.g. a thin `web` allowed to call a shared `repository` read model — import-linter's `layers` contract has knobs for that, but the default strict reading is the right starting point.)

**Test the test:** re-add the `from shop.repository...` import, confirm `lint-imports` exits non-zero, then remove it. Confirming the red is how you know the contract targets the real package names — a typo'd `root_package` or a renamed layer would make it pass vacuously.

</details>

---

## Exercise 3 — A no-cycle gate

**Skill:** cycle detection wired into CI · **Tool:** ArchUnit (Java) + madge (TS) · **Difficulty:** ★★ medium

A cycle has crept in. In the Java service, `com.shop.order` imports `com.shop.billing` and `com.shop.billing` imports back into `com.shop.order`. In the TS front end, `cart.ts → checkout.ts → cart.ts`. Add a **no-cycle gate** to both that fails the build, with zero per-edge configuration.

**Starter:**

```java
// ArchitectureTest.java — add a cycle rule
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;
// TODO: forbid cycles across com.shop.* slices
```

```yaml
# .github/workflows/ci.yml — add a madge step
# TODO: fail the build on any import cycle under src/
```

**Acceptance criteria**
- The Java rule fails on *any* cycle across `com.shop` packages, no edges enumerated by hand.
- The CI step fails (non-zero exit) on any TS import cycle under `src/`.
- Both print the cycle they found so it can be fixed.

**Hint:** ArchUnit's `slices().matching(...).should().beFreeOfCycles()`; madge's `--circular` exits non-zero when it finds a cycle.

<details>
<summary>Solution</summary>

**Java — ArchUnit:**

```java
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

@AnalyzeClasses(packages = "com.shop")
class CycleTest {

    @ArchTest
    static final ArchRule no_package_cycles =
        slices().matching("com.shop.(*)..")   // one slice per top-level feature package
            .should().beFreeOfCycles();
}
```

Failure output names the loop:

```
Architecture Violation [Priority: MEDIUM] -
Rule 'slices matching 'com.shop.(*)..' should be free of cycles' was violated -
Cycle detected: Slice order -> Slice billing -> Slice order
  ...com.shop.order.OrderService calls com.shop.billing.Invoicer
  ...com.shop.billing.Invoicer  calls com.shop.order.OrderRepository
```

**TS — madge in CI:**

```yaml
# .github/workflows/ci.yml
jobs:
  architecture:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      # Fails the job (non-zero exit) if ANY cycle exists under src/.
      - name: No import cycles
        run: npx madge --circular --extensions ts,tsx src/
```

`madge --circular` prints the cycle and exits 1:

```
✖ Found 1 circular dependency!

1) cart.ts > checkout.ts > cart.ts
```

**Explanation.** The no-cycle gate is the highest-signal, lowest-config fitness function there is. In ArchUnit, `slices().matching("com.shop.(*)..")` carves the codebase into one slice per top-level feature and asserts the slice graph is acyclic — you enumerate *no* edges; the rule discovers the loop and prints the participating classes. `madge --circular` does the same for the import graph and, crucially, **exits non-zero**, which is what turns it from a report into a gate: a red GitHub Actions job blocks the merge.

Why cycles first? A cycle means two modules can't be built, understood, or tested in isolation — it's the seed of a Big Ball of Mud — and it's almost never a false positive, so the rule rarely annoys anyone. (In Go you'd get this rule for free: the compiler rejects import cycles outright.)

**Test the test:** the cycle is already present, so both checks should be red on first run — confirm they name the loop. Then break the cycle (extract the shared piece into a third package both depend on, or invert one dependency) and confirm both go green.

</details>

---

## Exercise 4 — Baseline-then-forbid-new for legacy

**Skill:** freeze existing debt, fail only on new violations · **Tool:** shell + `go list` · **Difficulty:** ★★★ hard

You want to enforce "nothing in `myapp/internal/web` may import `myapp/internal/db`" — but a scan finds **17 existing violations** across legacy code you can't fix this sprint. If the rule fails on all 17, it never merges. Build a **baseline-then-forbid-new** gate: snapshot today's violations, fail CI only on violations *not* in the baseline, and make the baseline shrink-only.

**Starter:**

```bash
#!/usr/bin/env bash
# arch-check.sh — forbid web -> db, but tolerate today's known violations.
set -euo pipefail
BASELINE="arch-baseline.txt"

# TODO 1: compute today's violating packages (web packages that depend on db)
# TODO 2: if no baseline exists, write it and exit 0 (adoption run)
# TODO 3: fail on any CURRENT violation not in the baseline
# TODO 4: warn (don't fail) when the baseline shrinks, and never let it grow silently
```

**Acceptance criteria**
- First run with no baseline **records** the 17 violations and passes (adoption).
- A *new* `web → db` import fails the build and names the offending package.
- A *removed* violation is allowed; the script tells you to update the baseline (debt paid down).
- The baseline can never silently *grow* — adding a violation to it is a deliberate, visible act.

**Hint:** `go list -deps <pkg>` lists a package's transitive dependencies; iterate web packages, record those whose deps include a `db` package. Compare sorted sets with `comm`.

<details>
<summary>Solution</summary>

```bash
#!/usr/bin/env bash
# arch-check.sh — forbid myapp/internal/web -> myapp/internal/db,
# tolerating a frozen baseline of known-legacy violations.
set -euo pipefail

MODULE="myapp"
WEB_PREFIX="$MODULE/internal/web"
DB_PREFIX="$MODULE/internal/db"
BASELINE="arch-baseline.txt"

# (1) Compute CURRENT violations: web packages whose transitive deps include a db package.
current="$(mktemp)"
for pkg in $(go list "./internal/web/..."); do
  if go list -deps "$pkg" | grep -q "^${DB_PREFIX}"; then
    echo "$pkg"
  fi
done | sort -u > "$current"

# (2) Adoption run: no baseline yet -> record and pass.
if [[ ! -f "$BASELINE" ]]; then
  cp "$current" "$BASELINE"
  echo "Baseline created with $(wc -l < "$BASELINE") known violation(s). Commit ${BASELINE}."
  exit 0
fi

# (3) NEW violations = in current, not in baseline -> FAIL.
new="$(comm -23 "$current" "$BASELINE")"
if [[ -n "$new" ]]; then
  echo "FORBIDDEN: new web -> db dependency introduced:"
  echo "$new" | sed 's/^/  - /'
  echo "Route through the service layer, or (if truly unavoidable) justify it in review"
  echo "and add it to ${BASELINE} as a deliberate, reviewed exception."
  exit 1
fi

# (4) FIXED violations = in baseline, not in current -> baseline shrank, good news.
fixed="$(comm -13 "$current" "$BASELINE")"
if [[ -n "$fixed" ]]; then
  echo "Debt paid down — these are no longer violating; remove them from ${BASELINE}:"
  echo "$fixed" | sed 's/^/  - /'
  exit 1   # fail so the stale baseline MUST be updated; the baseline may only shrink.
fi

echo "ok: no new web -> db dependencies (baseline: $(wc -l < "$BASELINE") frozen)."
```

The baseline file is plain text, committed and reviewed:

```
# arch-baseline.txt — frozen legacy web->db violations. MAY ONLY SHRINK.
myapp/internal/web/legacy/dashboard
myapp/internal/web/legacy/report
myapp/internal/web/admin/audit
... (14 more)
```

**Explanation.** The script splits today's violation set into three buckets against the frozen baseline:

- **New** (`comm -23`: current minus baseline) → **fail**. This is the bleeding you're stopping: any *new* `web → db` edge goes red immediately, named, with the fix spelled out.
- **Fixed** (`comm -13`: baseline minus current) → **fail with a "remove me" message**. This is what makes the baseline **shrink-only**: when someone pays down a violation, the build *insists* they delete it from the baseline, so the file can never carry stale entries and the count only ratchets down. (Failing on improvement feels odd, but it's deliberate — it forces the ledger to stay honest.)
- **Unchanged** → pass.

Adding a violation to the baseline is now a *visible, reviewed* edit to a committed file — never a silent `// nolint`. That's the whole baseline discipline from the [budgets-and-ratcheting](../02-anti-pattern-budgets-and-ratcheting/senior.md) sibling, in 30 lines of shell. The rule ships *today* (debt frozen, not blocking), and the architecture can only get cleaner from here.

> **Why fail on the "fixed" case instead of auto-updating the baseline?** Auto-updating in CI would let the file drift without review and would hide which violations were paid down. Failing forces a human to commit the smaller baseline, keeping the debt ledger an explicit, reviewable artifact.

**Test the test:** (a) delete the baseline, run once, confirm it records 17 and passes; (b) add a fresh `web → db` import, confirm it fails naming the new package; (c) remove the import and confirm green; (d) fix one legacy violation and confirm the script tells you to shrink the baseline.

</details>

---

## Exercise 5 — Test the test: prove a rule fires

**Skill:** defeat the vacuous-pass trap · **Tool:** ArchUnit (Java) · **Difficulty:** ★★ medium

A teammate added this rule a year ago and it's been green ever since. The packages are actually named `com.shop.services` (plural) and `com.shop.persistence`.

```java
@ArchTest
static final ArchRule services_dont_touch_web =
    noClasses().that().resideInAPackage("..service..")          // note: singular
        .should().dependOnClassesThat().resideInAPackage("..web..");
```

**Tasks**
1. Explain why this rule has been green for a year regardless of the code.
2. Fix it so it actually checks the real packages.
3. Add the global guard that would have caught this class of bug for *every* rule.

**Acceptance criteria**
- You can state why the rule passed vacuously.
- The corrected rule targets the real package names.
- A global setting makes "this rule matched zero classes" fail instead of pass.

<details>
<summary>Solution</summary>

**1. Why it's been green:** the glob `..service..` matches a package *segment* named exactly `service`. The real package is `services` (plural), so the selector `that().resideInAPackage("..service..")` matches **zero classes**. `noClasses()` over an empty set is *vacuously true* — there are no classes that violate the rule because there are no classes in scope at all. The rule asserts something about nothing, so it can never fail. It's the textbook "passes but constrains nothing" trap: green for the wrong reason, indistinguishable on the dashboard from a rule that's green because the code obeys it.

**2. Fix — target the real names:**

```java
@ArchTest
static final ArchRule services_dont_touch_web =
    noClasses().that().resideInAPackage("..services..")     // plural, matches reality
        .should().dependOnClassesThat().resideInAPackage("..web..")
        .because("business logic must not depend on the web layer");
```

**3. Global guard — fail on empty selectors:** the root cause is ArchUnit's default that an empty `should` set passes. Disarm that footgun globally with `archunit.properties`:

```properties
# src/test/resources/archunit.properties
# A rule whose selector matched nothing is a bug, not a pass.
archunit.fail.on.empty.should=true
```

Now any rule that matches zero classes — because a package was renamed, a glob has a typo, or a module was deleted — turns **red** instead of silently passing, forcing someone to notice the selector drifted off the real code.

**Explanation.** The deeper lesson is that a rule's *denominator* (what it matched) matters as much as its *numerator* (what passed). The single most common way a fitness-function suite rots is selectors that quietly stop matching anything after a rename — the rules keep "passing" while guarding nothing. Two defenses, both shown here: `archunit.fail.on.empty.should=true` (or `.allowEmptyShould(false)` per rule) so empty selectors fail, and a **naming fitness function** so package/class names can't drift away from what the rules target without their own rule failing.

**Test the test (the meta-lesson):** the only way to *know* a rule fires is to make it fail on purpose. Plant a `services → web` import, confirm the corrected rule goes red, then remove it. Every critical rule in a suite should have been seen red at least once — ideally born from a failing planted violation before the code was fixed.

</details>

---

## Summary

- **Layering rules** come in two forms: the **forbidden-dependency** primitive (one edge, binary, unarguable) and the **layered** declaration (`layeredArchitecture()` / import-linter `layers`) that encodes an ordered stack and subsumes many forbidden rules at once, doubling as a diagram.
- The **no-cycle gate** is the highest-signal, lowest-config fitness function: `slices()...beFreeOfCycles()`, `madge --circular`, or — in Go — the compiler itself. It rarely false-positives and is the right first rule.
- For **legacy code** with violations you can't fix today, **baseline-then-forbid-new** freezes the known set, fails only on *new* violations, and stays **shrink-only** so debt can only ratchet down — the rule ships today instead of never.
- Every rule must be a **CI gate** (non-zero exit blocks the merge) and must be **tested by planting the violation** — a rule you've never seen fail (especially one with a typo'd or empty selector) may be passing *vacuously*, guarding nothing.
- Disarm the vacuous-pass footgun globally: make **empty selectors fail** (`archunit.fail.on.empty.should=true`) and add a **naming rule** so selectors can't silently drift off the real packages.

---

## Related Topics

- [`junior.md`](junior.md) · [`senior.md`](senior.md) — the concept → designing a full suite for a real codebase.
- [`find-bug.md`](find-bug.md) — fitness functions that look right but guard nothing (the failures these exercises defend against).
- [`optimize.md`](optimize.md) — making these scans fast enough to gate on every PR.
- [`interview.md`](interview.md) — the Q&A bank behind these skills.
- [Anti-Pattern Budgets & Ratcheting](../02-anti-pattern-budgets-and-ratcheting/tasks.md) — Exercise 4's baseline idea generalized to any countable anti-pattern.
- [Hotspot Analysis](../03-hotspot-analysis/tasks.md) — choosing which boundary to put a fitness function on first.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — the system-level shapes (Big Ball of Mud) these rules guard against.
