# Comparable vs Comparator Contracts — Professional

> **What?** Driving the `Comparable` / `Comparator` discipline across a team and a codebase: the code-review vocabulary you reach for, the lint and ArchUnit rules that catch the silent bugs before review, the migration story from `Collections.sort(list, cmp)` to `list.sort(cmp)`, and the small handful of mentoring conversations that pay back for years.
> **How?** Treat the contract as a *team agreement*: chained `Comparator.comparing` instead of hand-rolled `compare`; `Xxx.compare` instead of subtraction; `compareTo` consistent with `equals` or explicitly documented otherwise. Then wire enough tooling that the agreement holds without daily nagging.

---

## 1. Code-review vocabulary — name the rule, propose the fix

A senior reviewer doesn't argue style preferences. They point at a concrete violation, name the rule, and propose the smallest fix. The vocabulary for comparators is small and stable.

```java
// PR diff under review:
public int compareTo(Trade other) {
    return (int) (this.timestampMs - other.timestampMs);
}
```

> **Reviewer:** Integer overflow trap. Two timestamps a year apart already overflow `int`. Replace with `Long.compare(this.timestampMs, other.timestampMs)`. The fix is one line and removes a whole class of silent bug.

Compare with:

```java
public class OrderSorter {
    public static void sort(List<Order> list) {
        list.sort((a, b) -> {
            int c = a.placedAt().compareTo(b.placedAt());
            if (c != 0) return c;
            return a.total().compareTo(b.total());
        });
    }
}
```

> **Reviewer:** Replace the inline lambda with a chained `Comparator.comparing(Order::placedAt).thenComparing(Order::total)`. Same behaviour, half the lines, and the chain composes if we ever need a third key. Worth lifting to a `private static final Comparator<Order>` so we allocate it once.

Both reviews are short, both point at a rule, both end with a concrete next step. "This comparator is wrong" without a rule and a fix is finger-pointing.

The team's stable vocabulary for this section:

- "Integer overflow on subtraction" → "use `Xxx.compare`".
- "Inconsistent with equals" → "add a tiebreaker or document divergence".
- "Hand-rolled `compare` body" → "replace with `Comparator.comparing` chain".
- "Boxing on primitive key" → "use `comparingInt` / `comparingLong` / `comparingDouble`".
- "`String.compareTo` on human text" → "use `Collator` for the locale".
- "Wrapped nullsLast outside `comparing`" → "decorate the *key* comparator, not the outer comparator".
- "`reversed()` on a chain you wanted to reverse per-key" → "move reversal inline as `Comparator.reverseOrder()`".
- "`TreeSet` with `BigDecimal`" → "normalise scale or pick another collection".

When reviewers consistently use the same eight phrases, the team converges on the same shape of comparator code. Most of the time the author has heard the phrase before and reaches for the fix without push-back.

---

## 2. Static analysis — what tooling catches

Several of these bugs are mechanical. They belong in CI, not in human review.

**SonarQube** ships rules that map directly:

- `java:S2789` — `Optional` and `Comparator` traps around `null` handling.
- `java:S2447` — methods returning `Boolean` instead of `int` from comparators (an adjacent confusion).
- `java:S1244` — floating-point equality (proxy for "use `Double.compare`").
- `java:S128` — switch fall-through (irrelevant to comparators but often appears in the same review).

**PMD** has `SuspiciousEqualsMethodName` and `CompareObjectsWithEquals`, which catch a few of the structural patterns. PMD's regex hooks also let you ban a specific pattern:

```
//MethodDeclaration[contains(./Block, 'compareTo')][.//PrimaryExpression//ReturnStatement//AdditiveExpression]
```

A rough match for "any `compareTo` body that does subtraction". Add this as a custom PMD rule; the first time a junior writes `return this.x - other.x;`, the build fails before review.

**Error Prone** (Google's javac plugin) has `CompareToSloppy` and `CompareReturnValue` checks that catch the canonical `a - b` and the "compare result used as a magnitude" patterns directly. If you can run Error Prone in CI, do — it costs nothing and catches the bugs by name.

**SpotBugs** carries `CO_COMPARETO_INCORRECT_FLOATING` (use of `<` / `>` on floats in `compareTo`), `EQ_COMPARETO_USE_OBJECT_EQUALS` (compareTo overrides without consistent equals), and `EQ_COMPARING_CLASS_NAMES` (comparator that compares class names — a particular Spring anti-pattern). All three are worth keeping enabled.

**ArchUnit** is the most direct for team-level rules:

```java
@ArchTest
static final ArchRule comparators_are_static_final =
    fields().that().haveRawType(Comparator.class)
            .should().beStatic().andShould().beFinal();
// "Don't allocate a Comparator per call site — make it a constant."

@ArchTest
static final ArchRule comparators_use_factories =
    noClasses().that().resideInAPackage("..domain..")
               .should().callConstructor(Comparator.class);
// Catches anonymous `new Comparator<...>() { ... }` — push toward Comparator.comparing.
```

ArchUnit catches *shape* rules ("comparators are static fields", "no anonymous comparator classes in the domain package"); Error Prone and SpotBugs catch *semantic* rules ("don't subtract in `compareTo`"). Combine them; neither covers everything alone.

---

## 3. Mentoring this contract without sermons

Juniors who have just discovered `Comparable.compareTo` will inevitably write `return a.x - b.x;`. The mentoring move is to attach a *concrete pain* to the rule.

> **Mentor:** Look at this stack trace from the financial-ops incident last quarter — `Comparison method violates its general contract!` thrown by Timsort. Two timestamps 70 days apart overflowed the `int` after the subtraction. Two-character fix (`Long.compare`) and the production incident never happens. That's why we ban subtraction in `compareTo`.

> **Junior:** Should I also rewrite the other comparators?
> **Mentor:** Open the file. If any of them subtract or do floating-point comparison with `<`/`>`, fix them in the same PR. The grep is one line.

```bash
grep -rn 'return.*-.*compareTo' src/main/java
```

That single grep usually surfaces three to five lurking bugs in any non-trivial codebase. Use the search as the teaching moment — the rule is not abstract once a junior has fixed a real instance with their own hands.

The second mentoring conversation is *when not to implement `Comparable`*:

> **Junior:** My IDE suggested I implement `Comparable` on `Order`. I'm picking which field to sort by — I think `placedAt`?
> **Mentor:** That's the smell. The IDE suggests it because the class has fields. *You* haven't told me there's one obvious order on Orders that everyone in the company would agree to. Different teams will want different orders. Don't implement `Comparable`. Put the comparator next to the use case that needs it.

The third — and the one that genuinely changes how juniors think — is the `compareTo`/`equals` divergence trap. Walk through `new BigDecimal("1.0")` vs `"1.00"` in a TreeSet on a whiteboard. Most juniors are surprised. After they've seen it once, they remember it forever.

---

## 4. The `Collections.sort` → `List.sort` migration

`Collections.sort(List<T>, Comparator<? super T>)` was the only way to sort a list before Java 8. Since Java 8 (JEP 269), `List` itself has a `sort` method, and `Collections.sort` is a wrapper. Both still work; the team rule should be the modern form.

```java
// Legacy:
Collections.sort(orders, Comparator.comparing(Order::placedAt));

// Modern (Java 8+):
orders.sort(Comparator.comparing(Order::placedAt));
```

Two reasons to migrate:

1. **Fewer imports.** `Collections.sort` requires `import java.util.Collections;` in every caller. `List.sort` doesn't.
2. **Implementations can override.** `ArrayList.sort` calls `Arrays.sort` on its internal array directly, skipping the `toArray()` copy that `Collections.sort` performs. The difference is small for short lists, real for long ones.

A grep-and-replace is safe in 99% of cases:

```bash
# Find candidates:
grep -rn 'Collections\.sort(' src/main/java

# Transform via sed (review each match):
# Collections.sort(LIST, CMP)   →   LIST.sort(CMP)
```

The 1% of unsafe transforms:

- `Collections.sort(list)` (no comparator) — relies on the natural order. Becomes `list.sort(null)` (which means "natural order") *or* you make the comparator explicit: `list.sort(Comparator.naturalOrder())`. Prefer the explicit form.
- Some libraries return immutable lists (`List.of(...)`, `Arrays.asList(...)`, `Collections.unmodifiableList`) where `sort` throws `UnsupportedOperationException`. The migration exposes those — copy before sort: `new ArrayList<>(list).sort(cmp)`.

`Collections.sort` is *not* deprecated, and pre-Java-8 codebases sometimes can't migrate. But for any team on a modern JDK, `list.sort(...)` is the house style, and the migration is a one-PR cleanup.

---

## 5. Locale gotchas — the silent i18n production bug

A team writes `bySurname = Comparator.comparing(Customer::surname)` and ships to one locale. Three years later the company expands into Turkey, Germany, Spain, and Japan. The address book sorts in approximately UTF-16 code-unit order, which is *wrong* for every one of those locales. Customer-facing UIs show "Ürün" after "Z…" — a frequent customer-support complaint that takes weeks to trace back to a comparator.

The mature team's policy:

- **Any comparator that orders user-facing text uses `Collator`.** Identifiers, machine keys, internal codes use `String.compareTo`. The boundary is "is a human going to read this list?".
- **The locale is a per-request decision.** Don't bake `Locale.US` into a static comparator. Build the `Collator` from the request's locale (often via `LocaleContextHolder` in Spring or an explicit `Locale` parameter).
- **Precompute `CollationKey`s for large sorts.** A million-row export, sorted by surname, takes 8x longer with a per-comparison `Collator.compare` than with a precomputed key.

```java
public static Comparator<Customer> bySurname(Locale locale) {
    Collator c = Collator.getInstance(locale);
    c.setStrength(Collator.SECONDARY);
    return Comparator.comparing(cu -> c.getCollationKey(cu.surname()));
}

// Caller:
Locale userLocale = currentRequest.locale();
customers.sort(Customer.bySurname(userLocale));
```

The `Comparator` factory accepts the locale and returns a *fresh* comparator. No shared mutable `Collator`, no accidental cross-locale leak. Tests pass `Locale.forLanguageTag("tr-TR")` and compare against a fixture; the sort is deterministic.

A common code-review heuristic: any user-facing sort that doesn't take a `Locale` is suspect. Ask the author *which* locale's collation is being used and watch for the pause.

---

## 6. Comparator chains in stream pipelines

`Stream.sorted(Comparator)` and `Stream.min` / `Stream.max` use comparators the same way `List.sort` does. The same chaining rules apply, with one subtlety: the comparator is captured at *pipeline definition time*, not at terminal-operation time. If the comparator captures mutable state, you've already lost.

```java
// Smell — the comparator captures the current 'pivotPrice' once when the stream is built:
BigDecimal pivotPrice = currentMarketPrice();
List<Order> belowPivot = orders.stream()
    .sorted(Comparator.comparing((Order o) -> o.total().subtract(pivotPrice).abs()))
    .toList();
```

If `pivotPrice` is updated in the middle of building this pipeline (concurrent code, a setter elsewhere), the comparator already snapshotted the old value. This is *correct* behaviour for purity but surprises engineers who treat lambdas as "evaluated at use".

A second pipeline subtlety: `sorted()` with a comparator is *terminal-blocking* — the entire stream has to be buffered before any sorted element can be emitted. Long pipelines with `sorted()` upstream of expensive maps don't stream incrementally; they collect, sort, then emit. This is a routine performance gotcha in code reviews; for very large streams, sort *after* mapping to keys (and back), or sort on a `List` rather than a stream.

```java
// More predictable for large data: collect, sort the list, then stream again if needed.
List<Order> sorted = orders.stream()
    .filter(Order::isActive)
    .collect(Collectors.toList());
sorted.sort(Comparator.comparing(Order::placedAt));
```

The aesthetic of "one-line stream pipeline" loses to clarity at the boundary where `sorted` would otherwise hide the buffering cost.

---

## 7. Defining the team's comparator conventions

A short style document, signed off by the team, removes most repeat code-review conversations. Mine looks roughly like this:

```
# Comparator style — house rules

1. Comparators are `private static final` constants on the class
   they order, unless they capture per-request state (locale).
2. Use `Comparator.comparing(...).thenComparing(...)` rather than
   hand-rolled `compare` bodies. The chain reads top-to-bottom.
3. Primitive keys use `comparingInt` / `comparingLong` / `comparingDouble`.
4. Never `return a - b;` in compareTo / compare. Use `Xxx.compare(a, b)`.
5. `compareTo` must be consistent with `equals`, OR the class Javadoc
   must explicitly call out the divergence with rationale and a list
   of collections that should NOT be used with this type.
6. User-facing string sorts use `Collator` derived from the request locale.
7. Per-key reversal is `thenComparing(key, Comparator.reverseOrder())`.
   `.reversed()` on a multi-key chain is almost always a bug.
8. Modern callers use `list.sort(cmp)`, not `Collections.sort(list, cmp)`.
```

Eight rules. Print them, post them in the team's wiki, link them from the PR template. Every rule is mechanical enough that a tool *or* a reviewer can apply it; the goal is that the author has applied them all before review.

---

## 8. ArchUnit and lint as the long-term enforcement

A senior on the team should keep adding *rules*, not *reviews*. After the same comparator mistake has shown up in three PRs, write the rule:

```java
@ArchTest
static final ArchRule no_subtraction_in_compareTo =
    methods().that().haveName("compareTo")
             .or().haveName("compare")
             .should(notContainSubtractionInBody());
```

(Implementing `notContainSubtractionInBody` requires reading the JavaParser AST — ArchUnit doesn't ship a method-body matcher out of the box, but you can write one in 15 lines.)

This rule, once landed, fails the build on *every* future `return a - b;` in any comparator. The same is true for `Locale`-aware string sorts, for the `TreeSet<BigDecimal>` smell, for the `Comparator` allocated on the heap per call.

The lift is real. But every rule replaces dozens of code-review conversations. After two years, the team's review velocity is dominated by *design* discussions, not by "you wrote `a - b` again".

---

## 9. Migrating legacy comparator code — a strangler-fig sketch

A 10-year-old codebase has 200 anonymous-class comparators sprinkled across services. A big-bang rewrite is the wrong move; a strangler-fig migration is the right one.

1. **Inventory.** `grep -rn 'new Comparator<' src/main/java` — count the call sites.
2. **Catalogue patterns.** Each anonymous comparator falls into one of: single-key, multi-key, has-bugs (overflow, locale, nulls), or wraps a primitive. Tag each.
3. **Replace by pattern.** For single-key, `Comparator.comparing(extractor)`. For multi-key, chained `thenComparing`. For has-bugs, write a regression test for the *current* (buggy) behaviour, fix the comparator, decide whether the test should be updated.
4. **Promote frequently used comparators.** If `byPlacedAtThenTotal` appears in five files, lift it to `Order.ORDER_BY_PLACED_AT_THEN_TOTAL` and import.
5. **Run the test suite at each step.** Comparators silently affect ordering, which silently affects assertion order, which silently affects test stability. Treat the migration as a behaviour-preserving refactor.

```java
// Before — found in OrderService.java:
list.sort(new Comparator<Order>() {
    @Override
    public int compare(Order a, Order b) {
        long diff = a.placedAt().toEpochMilli() - b.placedAt().toEpochMilli();
        if (diff != 0) return (int) diff;             // overflow trap
        return a.id().compareTo(b.id());
    }
});

// After — lifted to a constant, fixed:
public static final Comparator<Order> BY_PLACED_AT_THEN_ID =
    Comparator.comparing(Order::placedAt)
              .thenComparing(Order::id);

list.sort(Order.BY_PLACED_AT_THEN_ID);
```

The "after" form removes the overflow bug, names the comparator, makes it reusable, and removes the anonymous class allocation per call site.

---

## 10. The "I added a Comparator and the test broke" investigation

Production teams hit this regularly: a comparator change silently breaks tests that *assert on order*. The investigation is mechanical:

1. **Diff the comparator.** Did the sign of any key flip? Did a tiebreaker disappear? Did the locale change?
2. **Run the failing test with `-XX:+ShowHiddenFrames` or print the actual list.** The assertion message often shows `Expected: [a, b, c] but was [b, a, c]` — exactly the failing pair.
3. **Decide whether the test or the comparator is wrong.** If the test asserts an order that was an *artifact* of stable-sort plus input order, the comparator change exposed a hidden dependency. Either add a tiebreaker (so order is deterministic regardless of input) or weaken the assertion (`assertThat(list).containsExactlyInAnyOrder(...)`).
4. **If the test was right, the comparator regression is real.** Revert and rethink.

The mature move is to weaken the assertions on tests that don't *care* about specific order, so they don't break on incidental comparator changes — and to *strengthen* assertions on tests that *do* care (snapshot tests, deterministic export tests), so they catch the regression early.

---

## 11. Quick rules

- [ ] In review, **name the rule** ("integer overflow", "inconsistent with equals", "boxing on primitive key") and propose the smallest fix.
- [ ] Wire Error Prone, SpotBugs, and Sonar rules that catch the mechanical comparator bugs.
- [ ] Encode the team's `Comparator` shape rules in ArchUnit ("comparators are static final", "no anonymous comparator classes in the domain").
- [ ] Migrate from `Collections.sort(list, cmp)` to `list.sort(cmp)` across the codebase — one-PR cleanup.
- [ ] User-facing string sorts use a `Collator` derived from the request locale; never `String.compareTo` for human text.
- [ ] Comparator chains in streams capture state at definition time; mutable captures are bugs.
- [ ] When a comparator change breaks tests, decide whether the test was *order-sensitive* by design or by accident, then fix the *correct* side.
- [ ] Stable, eight-line team-style document for comparators removes 90% of repeat review comments.

---

## 12. What's next

| Topic                                            | File              |
| ------------------------------------------------ | ----------------- |
| JLS / Javadoc references for both interfaces     | `specification.md` |
| Spot the bug, fix the bug                        | `find-bug.md`      |
| JIT, dispatch, allocation — comparator costs     | `optimize.md`      |
| Hands-on exercises                               | `tasks.md`         |
| Interview Q&A                                    | `interview.md`     |

---

**Memorize this:** the `Comparable` / `Comparator` discipline is a *team agreement* enforced by tooling, not by daily nagging. The vocabulary is small ("overflow", "consistent with equals", "boxing", "locale", "tiebreaker"), the lints are mechanical, the migration story is greppable. Your job as the senior on this section is to name the rule once, write the lint rule twice, and never review the same comparator mistake three times.
