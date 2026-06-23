# Shotgun Surgery — Senior

> **What?** How to *detect* Shotgun Surgery at scale instead of by gut feeling — using git churn analysis, temporal coupling, and CodeScene-style "files that change together" metrics — and how to choose the right cure: Strategy, Visitor, polymorphism, sealed types, or *no refactor at all*. Senior-level handling means deciding **which clusters are worth fixing** and **which are paying their cost honestly**.
> **How?** Run a co-change analysis, rank the top clusters, classify each by smell pattern, and apply the lightest structural move that breaks the coupling. Most clusters do not deserve a Strategy hierarchy; some demand a Visitor; a few deserve nothing.

---

## 1. From gut feeling to evidence

Junior detection of Shotgun Surgery is anecdotal: "this last ticket touched too many files". That works for one PR, not for a codebase. The senior move is to ask the version-control history directly: *which files keep getting modified together?* The answer is called **temporal coupling**, and it is the empirical fingerprint of Shotgun Surgery.

A minimal recipe with plain git:

```bash
# 1. List every commit and the files it touched.
git log --pretty=format:"COMMIT %H" --name-only --since="12 months ago" \
  > co-change.raw

# 2. For each pair of files in each commit, increment a counter.
python3 co_change.py co-change.raw \
  | sort -nr \
  | head -50
```

The head of the output is a ranked list of file pairs that change together. The pairs at the top are your Shotgun Surgery suspects. A pair that has co-changed 200 times in 250 of one file's commits has a *bidirectional change probability* of ~80% — that pair is one concept, not two.

CodeScene calls this **change coupling** and visualises it as a hotspot graph. Adam Tornhill's *Software Design X-Rays* and *Your Code as a Crime Scene* document the technique in depth. Gitqualia, Pyrple, and your own scripts produce equivalent rankings. The number you want is **co-change count divided by min(commits on file A, commits on file B)** — a normalised coupling ratio between 0 and 1. Anything above ~0.6 across more than ~20 commits is a strong candidate.

---

## 2. Classifying clusters before refactoring

Once the analysis surfaces a cluster — say `Currency.java`, `MoneyFormatter.java`, `TaxCalculator.java`, `ExchangeRateClient.java`, all co-changing 0.7+ — you do *not* immediately refactor. You classify first.

| Cluster shape                                        | Likely cause                  | Likely cure                          |
|------------------------------------------------------|-------------------------------|--------------------------------------|
| One enum + N switches in different files             | Missing polymorphism          | Replace Conditional with Polymorphism on the enum |
| One DTO + N hand-coded mappers                       | Leaky data shape              | Collapse the boundary or generate the mapper |
| One workflow + N event handlers all touched together | Event-shape change            | Sealed event type, exhaustive handler |
| Cross-cutting concern (logging, auth, metrics)       | Cross-cutting by nature       | Decorator / AOP / middleware, not Extract Class |
| Producer/consumer in different services              | Real distribution boundary    | Versioned contract, no refactor      |
| Test + production code                               | Healthy — tests follow code   | None                                 |

The classification protects you from the most common senior mistake: applying *Strategy* to a cluster that wanted *Inline Class*, or *Visitor* to a cluster that wanted *sealed types*. Diagnosis precedes treatment.

---

## 3. Strategy — when variants change independently

The Strategy pattern is the right cure when:

- The set of variants is **open** (you expect more).
- Each variant changes for its *own* reasons (different teams, different schedules).
- The variants share an interface but **not** code.

```java
public interface ShippingMethod {
    BigDecimal cost(Order o);
    Duration estimatedDelivery(Order o);
}

public final class StandardGround implements ShippingMethod { /* ... */ }
public final class NextDayAir     implements ShippingMethod { /* ... */ }
public final class DroneDelivery  implements ShippingMethod { /* ... */ }

public final class ShippingService {
    public ShippingQuote quote(Order o, ShippingMethod m) {
        return new ShippingQuote(m.cost(o), m.estimatedDelivery(o));
    }
}
```

The shotgun cluster was four files — calculator, estimator, label-generator, manifest-writer — each with a `switch (shippingType)`. The Strategy interface has four methods, one per concern. Each implementation owns its variant's behaviour. The four switches collapse into four delegations.

**When *not* to use Strategy.** If you have *two* variants and a stable boundary (say USD vs EUR for a single-country product) you don't need a hierarchy. A `record` with a tag and a `switch` on a sealed type is lighter and just as OCP-respecting. Strategy earns its keep when implementations are real plugins, often in different modules.

---

## 4. Visitor — when *operations* change independently of *variants*

Visitor is the inverse of Strategy. Strategy spreads operations across variants ("each currency knows how to format itself"). Visitor spreads variants across operations ("the JSON serialiser knows how to handle each AST node").

Use Visitor when:

- The data hierarchy is **closed** (a fixed set of AST nodes, event types, shapes).
- The set of **operations** is open (you keep adding new things to *do* with the hierarchy).
- Operations have non-trivial state or dependencies (a serialiser needs a writer; a type-checker needs a symbol table).

Modern Java replaces classical Visitor with **sealed types + pattern matching**:

```java
public sealed interface Expr permits Lit, Add, Mul, Neg { }
public record Lit(int value) implements Expr {}
public record Add(Expr left, Expr right) implements Expr {}
public record Mul(Expr left, Expr right) implements Expr {}
public record Neg(Expr inner) implements Expr {}

public final class Evaluator {
    public int eval(Expr e) {
        return switch (e) {
            case Lit l -> l.value();
            case Add a -> eval(a.left()) + eval(a.right());
            case Mul m -> eval(m.left()) * eval(m.right());
            case Neg n -> -eval(n.inner());
        };
    }
}

public final class Printer {
    public String print(Expr e) {
        return switch (e) {
            case Lit l -> Integer.toString(l.value());
            case Add a -> "(" + print(a.left()) + " + " + print(a.right()) + ")";
            case Mul m -> "(" + print(m.left()) + " * " + print(m.right()) + ")";
            case Neg n -> "-" + print(n.inner());
        };
    }
}
```

Adding a new *operation* (`Optimiser`, `TypeChecker`) is one new class. Adding a new *variant* (`Div`) is one new record — but the compiler then forces every switch to handle it. That's not Shotgun Surgery; that's the compiler giving you a *complete* edit list, which is the opposite problem.

**Strategy vs Visitor — the senior rule.** If you expect new *variants* more than new *operations*, use Strategy. If you expect new *operations* on a fixed *set of variants*, use Visitor (sealed + pattern matching). If you don't know which axis will move, *don't choose yet* — wait for the second example.

---

## 5. Polymorphism via enum methods — the lightest cure

For many shotgun clusters, the right answer is neither Strategy nor Visitor — it's Java's enum, which can carry per-constant behaviour:

```java
public enum OrderStatus {
    OPEN    { public boolean cancellable() { return true;  } },
    SHIPPED { public boolean cancellable() { return false; } },
    DELIVERED { public boolean cancellable() { return false; } },
    CANCELLED { public boolean cancellable() { return false; } };

    public abstract boolean cancellable();
}
```

Now any `switch (status)` asking "can this be cancelled?" becomes `status.cancellable()`. The shotgun disappears without a new file. This is the cheapest possible structural change — and it's the right tool whenever the cluster is "one enum + N switches" and the set of variants is small and stable.

Records-with-sealed-interface are the modern, more flexible variant. Use the enum form when variants have no state; use the sealed-record form when they do.

---

## 6. Detection at scale — what to actually run

A reproducible co-change analysis with just the standard toolchain:

```bash
# Top co-changing pairs in the last 12 months, excluding test files
git log --since="12 months ago" --name-only --pretty=format:"--" \
  | awk '/^--/ { if (n>0) for(i=0;i<n;i++) for(j=i+1;j<n;j++) print files[i] "\t" files[j]; n=0; next } /\.java$/ && !/Test\.java$/ { files[n++]=$0 }' \
  | sort | uniq -c | sort -rn | head -30
```

Pipe that into a `python` script that computes the normalised coupling ratio per pair, and you have a credible Shotgun Surgery heatmap in twenty minutes. The pairs above 0.6 with >20 co-changes are real clusters.

**Production-grade tools** that automate this:

- **CodeScene** — Adam Tornhill's product, the most refined implementation. Visualises hotspots, change coupling, code churn vs complexity, and team boundaries.
- **gitqualia** — open-source CLI that scores temporal coupling and complexity per file.
- **PyDriller** — Python library for mining git repositories; the right primitive when you want to build your own analysis.
- **Jetbrains IntelliJ's Code Vision** — surface co-change indicators inline when you open a file.

The point of any of these is not to produce reports for managers. It is to **point your refactoring attention at the top three hotspots**, fix them, then re-run.

---

## 7. The "delete the smell" option

Not every Shotgun Surgery cluster needs a Strategy or a Visitor. Sometimes the right move is to *delete code*.

```java
// Six files contain the same hand-rolled DTO mapper.
// Each is 40 lines of "from.field = to.field".

// Senior move 1 — generate it instead.
@Mapper
public interface UserMapper {
    UserDto toDto(User user);
    User toEntity(UserDto dto);
}

// Senior move 2 — delete the boundary.
// If the API actually exposes the entity (minus the password), use a record projection.
public record PublicUser(long id, String email, String name) {
    public static PublicUser of(User u) { return new PublicUser(u.id(), u.email(), u.name()); }
}
```

Six files of mapping become *zero files of mapping* (option 1) or *one file of projection* (option 2). The shotgun disappears because the target disappears. Senior engineers reach for this when the cluster is mostly *ceremonial* — code written because "we have always had a DTO layer", not because it earns its complexity.

---

## 8. Refactor sequencing — don't refactor all the clusters at once

A real codebase has maybe ten Shotgun Surgery hotspots. You do not refactor them in parallel. You pick the one with the highest cost and the lowest risk and you do that one *to completion*, including:

1. A baseline metric — current co-change ratio on the cluster.
2. The refactor itself.
3. A re-measured ratio after the change has landed and the team has done a few PRs against it.

The post-measurement is non-negotiable. Without it, you cannot tell whether the refactor *removed* the smell or just *moved* it. A common failure mode is to "Extract Class `Currency`" and discover six months later that every caller now imports both `Currency` and `CurrencyHelper` and the helper is the new shotgun. Measure, or you didn't refactor.

```bash
# Before — currency cluster co-change ratio
0.71 (Currency.java <-> MoneyFormatter.java, 47 / 66 commits)

# Six months after Extract Class + Move Method
0.18 (Currency.java <-> MoneyFormatter.java, 4 / 22 commits)
```

That delta is your evidence. It also lets you defend the time spent in a sprint review.

---

## 9. Architectural reach — when the cluster crosses module boundaries

Sometimes the cluster doesn't live inside one module. Adding a field touches the OpenAPI spec, the Java DTO, the JavaScript client, the database migration, and the contract test. Each lives in a different repository or build module. This is *real* Shotgun Surgery — the kind that motivates schema registries, code generation, and contract-first APIs.

The senior pattern: **define the contract once, generate everything else**.

```yaml
# user.yaml — the single source of truth
type: object
required: [id, email, name]
properties:
  id:    { type: integer, format: int64 }
  email: { type: string,  format: email }
  name:  { type: string }
```

```
openapi-generator-cli generate -i user.yaml -g java       -o services/user
openapi-generator-cli generate -i user.yaml -g typescript -o web/src/api
```

Adding `phone` is one edit on `user.yaml`. The Java DTO and the TypeScript model regenerate. The shotgun becomes a single shot. CodeScene will then show the YAML file as the new hotspot — which is correct, because it *is* now where the concept lives.

---

## 10. Quick rules

- [ ] Don't refactor without a co-change number — gut feeling lies.
- [ ] Strategy when *variants* are open, Visitor (sealed + pattern matching) when *operations* are open.
- [ ] Enum methods are the cheapest cure; reach for them before any pattern.
- [ ] If the shotgun lives in mapping code, **delete the mapping** before refactoring it.
- [ ] Measure before *and* after; an un-measured "refactor" might have moved the smell, not removed it.
- [ ] Refactor one cluster to completion before opening another.

---

## 11. What's next

| Topic                                                            | File              |
| ---------------------------------------------------------------- | ----------------- |
| Event-driven amplifiers, microservice contract versioning        | `professional.md`  |
| Change-coupling metrics, CodeScene workflow                      | `specification.md` |
| Ten scattered-change bugs with diagnoses                         | `find-bug.md`      |
| CI/build/test cost of shotgun changes                            | `optimize.md`      |
| Eight hands-on exercises with validation                         | `tasks.md`         |
| Twenty interview questions                                       | `interview.md`     |

---

**Memorize this:** Shotgun Surgery is *empirical* — it lives in the git history, not in your hunch. Mine the co-changes, classify the top three clusters by shape, pick the lightest possible cure (enum methods → sealed types → Strategy → Visitor → delete the boundary), measure the coupling ratio before and after, and only then move to the next hotspot.
