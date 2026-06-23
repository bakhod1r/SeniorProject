# OO Metrics — the CK Suite — Tasks

> Hands-on exercises graded easy → hard. The point is to **run real tools** (ck, SonarQube, JDepend, PMD) on real code, then *interpret* the output — never just collect numbers. Each task has explicit acceptance criteria. Pick any small open-source Java project (Spring PetClinic, JUnit, a past assignment) as your sample, or one of your own.

---

## Task 1 (easy) — Compute the CK metrics by hand

Take this class and compute, by hand, its unweighted WMC, CC-weighted WMC, RFC, and LCOM4.

```java
public class Cart {
    private List<Item> items = new ArrayList<>();
    private Customer customer;

    public void add(Item i)        { items.add(i); }
    public void remove(Item i)     { items.remove(i); }
    public Money subtotal() {
        Money sum = Money.ZERO;
        for (Item i : items) sum = sum.plus(i.price());   // calls Item.price, Money.plus
        return sum;
    }
    public String customerName()   { return customer.name(); }   // calls Customer.name
}
```

**Acceptance criteria.** You produce: unweighted WMC = 4; CC-weighted WMC = 1+1+2+1 = 5 (the `for` adds 1); RFC = local {add, remove, subtotal, customerName} ∪ called {List.add, List.remove, Item.price, Money.plus, Customer.name} = 9; LCOM4 = 2 (`add`/`remove`/`subtotal` share `items`; `customerName` touches only `customer` → two components). You can explain *why* LCOM4 = 2 suggests a possible split (or why you'd leave it — a cart legitimately holds both).

---

## Task 2 (easy) — Run `ck` on a project

Download `ck` (github.com/mauricioaniche/ck), build or grab the jar, and run:

```bash
java -jar ck.jar /path/to/your/project true 0 false out/
```

Open `out/class.csv`.

**Acceptance criteria.** You can answer: which class has the highest CBO? The highest WMC? The highest LCOM? Are they the *same* class (god-class signature) or different? Print the top 5 by CBO and by WMC and note any overlap.

---

## Task 3 (easy) — PMD's design ruleset

Run PMD with the `design` category on the same project:

```bash
pmd check -d /path/to/project -R category/java/design.xml -f text
```

**Acceptance criteria.** You collect every `CyclomaticComplexity`, `GodClass`, `CouplingBetweenObjects`, and `ExcessiveClassLength` violation, and you cross-check: does PMD's `GodClass` detector flag the same class your ck CBO+WMC+LCOM analysis flagged in Task 2? Reconcile any disagreement (tools count differently).

---

## Task 4 (medium) — JDepend and the Main Sequence

Run JDepend on the project's packages:

```bash
java jdepend.textui.JDepend /path/to/classes
```

For each package it reports Ca, Ce, A (abstractness), I (instability), and D (distance).

**Acceptance criteria.** You produce a table of packages sorted by **D descending** (packages with < 5 classes excluded). For the worst package, you classify it: zone of pain (low I, low A), zone of uselessness (high I, high A), or just off-sequence — and you state *one concrete refactor* that would lower its D (extract an interface to raise A, or invert a dependency to raise I).

---

## Task 5 (medium) — Reproduce the instability math by hand

Pick two packages from Task 4. For each, by reading the imports, count Ca and Ce yourself and compute I = Ce/(Ca+Ce). Count abstract types / total for A. Compute D = |A + I − 1|.

**Acceptance criteria.** Your hand-computed I, A, D are within rounding of JDepend's. Where they differ, you can explain why (JDepend's counting of inner classes, the JDK exclusion, etc.). This proves you understand the formulas, not just the tool.

---

## Task 6 (medium) — SonarQube trend, not snapshot

Stand up SonarQube (Docker: `docker run -d -p 9000:9000 sonarqube`), run the scanner on your project at **two different commits** (e.g. HEAD and HEAD~50).

**Acceptance criteria.** You produce a before/after for cognitive complexity, coupling, and duplication, and you identify **one class whose complexity *increased*** between the two commits. You can articulate why the *delta* is more useful than either absolute number (decay is a slope, not a snapshot).

---

## Task 7 (medium-hard) — Build a composite "worst offenders" list

From the `ck` CSV (Task 2), write a script that ranks classes by a composite god-class score (e.g. normalize cbo, wmc, rfc, lcom each to 0–1 and sum) and prints the top 20.

```bash
# starter — replace with proper per-column normalization
awk -F, 'NR>1 {print $1, $3+$4+$7}' out/class.csv | sort -k2 -rn | head -20
```

**Acceptance criteria.** You produce a ranked top-20. Then you **open the #1 file and read it** — and write a one-paragraph verdict: is it a genuine god class, a legitimate orchestrator/façade (high coupling by design), or a false alarm (generated code, framework base)? The exercise is incomplete until you've confirmed by reading.

---

## Task 8 (hard) — Complexity × churn hotspots

Combine complexity with git history. Get each file's change frequency:

```bash
git log --format=format: --name-only --since="12 months ago" \
  | grep '\.java$' | sort | uniq -c | sort -rn > churn.txt
```

Join `churn.txt` against the `ck` CSV (by class/file path) and rank by `complexity × churn`.

**Acceptance criteria.** You produce a top-10 "hotspot" list (high complexity *and* frequently changed) and explain why these beat raw CK rankings: a complex class nobody touches costs nothing; a moderately complex class edited every sprint bleeds the team. Identify the single highest-ROI refactoring target.

---

## Task 9 (hard) — Set defensible thresholds on your own distribution

Using the full `ck` CSV, compute the distribution of CBO across all classes. Find the 90th and 95th percentiles.

**Acceptance criteria.** You report the percentiles and propose a project-specific "investigate above X" CBO line *derived from your data*, not from a blog. You can explain why this beats an imported threshold (it's calibrated to your codebase's structural baseline — a UI-heavy project has higher baseline coupling than a library).

---

## Task 10 (hard) — A ratchet, not a gate

Write a CI check (shell or a small script) that records the current count of classes above your Task-9 CBO line as a committed baseline, and **fails the build only if the count increases**.

**Acceptance criteria.** Demonstrate: a PR that adds a high-CBO class fails; a PR that lowers an existing one updates the baseline and passes; a cosmetic edit that doesn't change the count passes. You can articulate why a ratchet resists Goodhart gaming where an absolute threshold does not (you can't satisfy "don't regress" with a dummy field).

---

## Task 11 (hard) — ArchUnit structural gate

Add ArchUnit tests that enforce *direction* (a stable package must not depend on an unstable one) and *no cycles between packages*.

**Acceptance criteria.** You have a passing `@AnalyzeClasses` test asserting (a) your domain package doesn't depend on your web package, and (b) `slices()...should().beFreeOfCycles()`. You can explain why these *structural* rules are safe to hard-gate while numeric CBO is not (direction and cycles are binary and can't be cosmetically gamed, and they protect the instability math).

---

## Stretch goal

Take the worst class from Task 7, refactor it to lower CBO and LCOM (split by field-group / inject dependencies via interfaces), re-run `ck`, and show the before/after numbers **plus** a paragraph arguing the design is genuinely better — not just that the numbers moved. This is the whole discipline in one exercise: move the design, let the numbers follow, never the reverse. See [`optimize.md`](optimize.md).
