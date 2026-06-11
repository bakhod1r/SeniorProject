# When to Refactor to Patterns — Propose the Refactoring

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns](https://refactoring.guru/design-patterns)

Each "before" carries a *real* smell. Your job: propose the right refactoring **to** (or **toward**) a pattern — *or argue to leave it*. State the smell, name the destination, sketch the mechanics, and give a "when NOT to." Worked solution follows each. The discipline is choosing the *minimum* structure that removes the pain — not the fanciest pattern that fits.

---

## Before 1 — Duplicated dispatch across methods

```java
class Employee {
    int type; // 0=ENGINEER, 1=MANAGER, 2=SALES

    int payAmount() {
        switch (type) {
            case 0: return monthlySalary;
            case 1: return monthlySalary + bonus;
            case 2: return monthlySalary + commission;
            default: throw new RuntimeException();
        }
    }
    String title() {
        switch (type) {
            case 0: return "Engineer";
            case 1: return "Manager";
            case 2: return "Sales";
            default: throw new RuntimeException();
        }
    }
}
```

<details>
<summary>Solution</summary>

**Smell:** duplicated conditional dispatch on `type`, plus primitive obsession (an `int` type code). Two methods switch on the same field; a new employee type means editing both.

**Destination:** Replace Type Code with Subclasses / polymorphism — refactor *toward* [Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) (here, `Employee` subclasses, since type is intrinsic).

**Mechanics (tiny steps, tests green each):**
1. Introduce an `EmployeeType` abstraction (or subclasses `Engineer`, `Manager`, `Sales`).
2. Move `payAmount`'s engineer branch into `Engineer.payAmount()`; run tests.
3. Repeat per type for both methods; run tests after each.
4. Delete the dead `switch`es and the `int type`; run tests.

```java
abstract class Employee {
    int monthlySalary;
    abstract int payAmount();
    abstract String title();
}
class Manager extends Employee {
    int bonus;
    int payAmount() { return monthlySalary + bonus; }
    String title() { return "Manager"; }
}
// Engineer, Sales similar
```

**When NOT to:** if there were exactly *one* `switch` on `type` and it never changed, the type code is fine — don't spawn subclasses for a single stable conditional.
</details>

---

## Before 2 — The combinatorial pricing flags

```java
BigDecimal price(Beverage b) {
    BigDecimal p = b.basePrice();
    if (b.hasMilk())      p = p.add(MILK);
    if (b.hasCaramel())   p = p.add(CARAMEL);
    if (b.hasExtraShot()) p = p.add(SHOT);
    if (b.isLarge())      p = p.multiply(LARGE_MULTIPLIER);
    return p;
}
```

<details>
<summary>Solution</summary>

**Smell:** conditional embellishment — optional behaviors that combine. The textbook answer is [Decorator](../../../design-patterns/02-structural/04-decorator/junior.md).

**But weigh it first.** Most of these are additive prices; only `isLarge()` *multiplies* (order-sensitive). If the embellishments stay this simple, the right refactoring is **data-driven, not a full Decorator**:

```java
BigDecimal price(Beverage b) {
    BigDecimal p = b.addOns().stream()
        .map(AddOn::price).reduce(b.basePrice(), BigDecimal::add);
    return b.isLarge() ? p.multiply(LARGE_MULTIPLIER) : p;
}
```

**When TO use Decorator:** the moment ordering and interaction between embellishments becomes real behavior (a large *then* a discount vs a discount *then* large; an add-on that conditionally affects another). Then each wrapper modifying `cost()` of its inner is the clean model. **When NOT to:** for purely additive flags like the milk/caramel/shot here, a Decorator is more machinery than a summed list — over-engineering. Prefer the data-driven version until behavior demands wrappers.
</details>

---

## Before 3 — Status branching that transitions

```java
class Document {
    String state = "DRAFT";
    void publish() {
        if (state.equals("DRAFT"))          state = "MODERATION";
        else if (state.equals("MODERATION")) {
            if (currentUser.isAdmin())       state = "PUBLISHED";
        }
        else if (state.equals("PUBLISHED")) { /* no-op */ }
    }
    void reject() {
        if (state.equals("MODERATION")) state = "DRAFT";
        // ... and more state-branching in render(), edit() ...
    }
}
```

<details>
<summary>Solution</summary>

**Smell:** state-dependent behavior with transitions, the same `state` string branched across `publish()`, `reject()`, `render()`, `edit()`. The branch variable *changes over the object's life* and branches *transition into each other* → [State](../../../design-patterns/03-behavioral/07-state/junior.md), not Strategy.

**Mechanics:**
1. Introduce a `DocumentState` interface with `publish()`, `reject()`.
2. Create `Draft`, `Moderation`, `Published` classes; move each branch's body into the matching state's method; run tests.
3. Transitions become `document.setState(new Moderation())` inside the state methods.
4. Replace the string field with a `DocumentState` field; delete the branching; run tests.

```java
interface DocumentState { void publish(Document d); void reject(Document d); }
class Draft implements DocumentState {
    public void publish(Document d) { d.setState(new Moderation()); }
    public void reject(Document d) { /* already draft */ }
}
```

**When NOT to:** two states and one transition don't justify State — a boolean or a small guard is clearer. Here there are 3+ states across 4 operations, so it pays. Verify the transition graph is genuinely non-trivial first.
</details>

---

## Before 4 — Telescoping constructor

```java
HttpRequest r = new HttpRequest(
    "GET", "/api/users", null, null,
    30_000, true, 3, null, false
);
```

<details>
<summary>Solution</summary>

**Smell:** long parameter list / telescoping constructor with many optionals and positional ambiguity (what is the third `null`? what's `true`?). A frequent source of argument-order bugs.

**Destination:** [Builder](../../../design-patterns/01-creational/03-builder/junior.md).

```java
HttpRequest r = HttpRequest.builder()
    .method("GET").url("/api/users")
    .timeoutMs(30_000).followRedirects(true).maxRetries(3)
    .build();
```

Named, order-independent, optionals omitted instead of `null`-padded.

**When NOT to:** if the constructor had 2–3 *required* parameters and no real optionality, Builder is ceremony — a plain constructor wins. Builder pays specifically because of the *many optional* fields here. Also consider whether some of those args (timeout, retries) want to become a small `RequestPolicy` value object rather than more builder methods.
</details>

---

## Before 5 — The instanceof ladder, duplicated

```java
double area(Shape s) {
    if (s instanceof Circle)    return PI * ((Circle) s).r() * ((Circle) s).r();
    if (s instanceof Square)    return ((Square) s).side() * ((Square) s).side();
    if (s instanceof Rectangle) return ((Rectangle) s).w() * ((Rectangle) s).h();
    throw new IllegalArgumentException();
}
// the same instanceof ladder also lives in perimeter() and describe()
```

<details>
<summary>Solution</summary>

**Smell:** `instanceof` + downcast ladder, *duplicated* across `area()`, `perimeter()`, `describe()`. Adding a `Triangle` means hunting every ladder — shotgun surgery.

**Destination:** plain polymorphism (Replace Conditional with Polymorphism) — push each behavior onto the type:

```java
interface Shape { double area(); double perimeter(); String describe(); }
class Circle implements Shape {
    private final double r;
    public double area() { return Math.PI * r * r; }
    // ...
}
```

Now `Triangle` is one new class; no ladder to edit.

**When NOT to / future signal:** if *many operations* need to traverse a fixed set of shapes and you can't keep adding methods to the `Shape` interface (e.g., shapes are a stable library, operations churn), that's the signal for [Visitor](../../../design-patterns/03-behavioral/10-visitor/junior.md) instead. But don't reach for Visitor yet — three operations on owned types is exactly what plain polymorphism handles best. Visitor trades easy-new-operations for hard-new-types; only take that trade when types are stable and operations explode.
</details>

---

## Before 6 — The chain of handlers as a switch

```java
Response handle(Request req) {
    if (req.needsAuth() && !authed(req)) return DENY;
    if (req.isRateLimited())            return THROTTLE;
    if (req.isCached())                 return cached(req);
    if (req.isMalformed())              return BAD_REQUEST;
    return process(req);
}
// New cross-cutting checks keep getting inserted into this growing if-ladder,
// and the order matters, and different endpoints want different subsets.
```

<details>
<summary>Solution</summary>

**Smell:** a growing ladder of independent checks where *order matters* and *different callers want different subsets*. That last property is the tell.

**Destination:** [Chain of Responsibility](../../../design-patterns/03-behavioral/01-chain-of-responsibility/junior.md) (a.k.a. a middleware pipeline). Each check becomes a handler that either short-circuits or passes along; endpoints compose the subset they need.

```java
interface Handler { Response handle(Request req, Handler next); }
// AuthHandler, RateLimitHandler, CacheHandler, ... composed per endpoint
List<Handler> pipeline = List.of(new AuthHandler(), new RateLimitHandler(), ...);
```

**When NOT to:** if *every* caller runs the *exact same* fixed sequence and it rarely changes, the `if`-ladder is clearer and cheaper than a handler framework — leave it. CoR earns its keep precisely because of the *configurable subset + insertion* pressure here. Without that pressure, it's over-engineering a simple sequence.
</details>

---

## Before 7 — A smell that you should *leave alone*

```java
String formatPhone(String digits) {
    if (digits.length() == 10)
        return "(" + digits.substring(0,3) + ") " + digits.substring(3,6) + "-" + digits.substring(6);
    if (digits.length() == 11 && digits.startsWith("1"))
        return "+1 " + formatPhone(digits.substring(1));
    return digits; // unknown format, return as-is
}
```

<details>
<summary>Solution</summary>

**Decision: leave it — no pattern.** There's a conditional, yes, but: it's in *one* place, not duplicated; it has two stable branches; formatting US phone numbers is not an axis of variation that's been churning. Introducing a `PhoneFormatStrategy` hierarchy here would be speculative generality — more files, more indirection, for a self-contained 5-line function that reads fine.

**The only justified micro-refactor** is a [Decompose Conditional](../../02-refactoring-techniques/04-simplifying-conditionals/junior.md) *if* the branches grow — e.g., extract `formatTenDigit()` for readability. But that's not a pattern; it's tidy-up.

**The lesson of this snippet:** the right answer to "what pattern?" is sometimes "none." Pattern-literate engineers must be able to *not* apply one. Per Metz, the duplication you don't even have here is far cheaper than a `PhoneFormatStrategy` abstraction built on a guess that more formats are coming. If international formats *do* become a real, recurring requirement (a ticket, multiple countries), *then* revisit — likely as a `Region`/locale concept (see [tasks.md](tasks.md) Task 9), not a formatter-per-country hierarchy.
</details>
