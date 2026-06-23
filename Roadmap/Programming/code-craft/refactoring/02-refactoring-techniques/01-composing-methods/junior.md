# Composing Methods — Junior Level

> **Source:** [refactoring.guru/refactoring/techniques/composing-methods](https://refactoring.guru/refactoring/techniques/composing-methods)

---

## Table of Contents

1. [What is "Composing Methods"?](#what-is-composing-methods)
2. [Real-world analogy](#real-world-analogy)
3. [The 9 techniques at a glance](#the-9-techniques-at-a-glance)
4. [Extract Method](#extract-method)
5. [Inline Method](#inline-method)
6. [Extract Variable](#extract-variable)
7. [Inline Temp](#inline-temp)
8. [Replace Temp with Query](#replace-temp-with-query)
9. [Split Temporary Variable](#split-temporary-variable)
10. [Remove Assignments to Parameters](#remove-assignments-to-parameters)
11. [Replace Method with Method Object](#replace-method-with-method-object)
12. [Substitute Algorithm](#substitute-algorithm)
13. [How they relate](#how-they-relate)
14. [Mini Glossary](#mini-glossary)
15. [Review questions](#review-questions)

---

## What is "Composing Methods"?

**Composing Methods** is the family of refactorings that **reorganize the inside of methods** — the body, not the signature. You split a long method into named pieces, inline a method whose body is clearer than its name, name a confusing sub-expression, or replace a tangled algorithm with a clearer one.

These are the most-used refactorings in any codebase. Almost every clean-up of a [Long Method](../../01-code-smells/01-bloaters/junior.md) starts here, and most cures for [Duplicate Code](../../01-code-smells/04-dispensables/junior.md) end with [Extract Method](#extract-method).

Three properties make this category foundational:

- **Local in scope.** They don't move code between classes (that's [Moving Features](../02-moving-features/junior.md)) — they only restructure within a method or its enclosing class.
- **Highly mechanical.** Every modern IDE has a one-keystroke "Extract Method" command. The IDE handles renaming, parameter capture, and call-site updates.
- **Reversible.** Extract Method and Inline Method are exact inverses. Extract Variable and Inline Temp are exact inverses. You can always go back.

> **Key idea:** Composing Methods refactorings rarely change *what* the code does. They change *what the code looks like to a human reader*.

---

## Real-world analogy

### A 600-word email vs. a structured one

You receive an email:

> *"Hey, before you ship the release tomorrow, double-check the staging logs from yesterday around 14:30 UTC because there was a spike in 503s and it might still be ongoing, and also confirm with QA that the smoke pack passed since the new index migration was deployed and we don't want a repeat of the December incident, plus please remind the on-call to keep the #release Slack channel pinned through the weekend in case we need to roll back since Monday is a holiday in 4 timezones..."*

It's all one sentence. By the time you finish reading, you've forgotten what was at the start.

Now compare with the same content **decomposed**:

> Before tomorrow's release:
> 1. **Check staging logs.** Yesterday 14:30 UTC had a 503 spike — confirm it's resolved.
> 2. **Confirm QA smoke pack.** New index migration is in; we don't want another December.
> 3. **On-call coverage.** Pin #release through the weekend (Monday is a 4-timezone holiday).

Same information, but each chunk has a heading. You can skim, refer back, or hand off item 2 to a teammate without re-reading items 1 and 3.

That's exactly what [Extract Method](#extract-method) does to a long method: it adds named headings.

---

## The 9 techniques at a glance

| Technique | What it does | Inverse |
|---|---|---|
| **Extract Method** | Take a fragment, give it a name, replace with a call | Inline Method |
| **Inline Method** | Body is as clear as the name; replace calls with body | Extract Method |
| **Extract Variable** | Give a complex sub-expression a name | Inline Temp |
| **Inline Temp** | Replace a one-use temporary with the expression | Extract Variable |
| **Replace Temp with Query** | Turn a local temporary into a method | (preparation) |
| **Split Temporary Variable** | One temp assigned twice for two purposes → two temps | (cleanup) |
| **Remove Assignments to Parameters** | Don't reassign parameters; introduce a local | (correctness) |
| **Replace Method with Method Object** | Long method with many locals → its own class | (rare reverse) |
| **Substitute Algorithm** | Replace algorithm body with a clearer one | (rewrite) |

---

## Extract Method

### What it does

Take a fragment of code that you can describe with a single phrase ("calculate tax", "format greeting") and turn it into its own method named after that phrase. Replace the fragment with a call.

### When you smell it

- The method is too long to read in one sitting → [Long Method](../../01-code-smells/01-bloaters/junior.md)
- Section comments separating the body (`// --- pricing ---`)
- The same fragment appears in two places → [Duplicate Code](../../01-code-smells/04-dispensables/junior.md)
- An expression is so complex you have to mentally re-parse it on every read

### The mechanics (Fowler's recipe)

1. Create a new method named after **what it does**, not how it does it.
2. Copy the fragment from the source method into the new method.
3. Look at the fragment for any local variables. They become **parameters** of the new method.
4. If the fragment **assigns** to a local variable, the new method must **return** that variable.
5. Replace the fragment in the source method with a call to the new method.
6. Test.

### Java — before / after

**Before:**

```java
class Order {
    private List<LineItem> items;
    private Customer customer;

    public Money total() {
        Money subtotal = Money.zero();
        for (LineItem item : items) {
            subtotal = subtotal.plus(item.price().times(item.quantity()));
        }
        Money discount = Money.zero();
        if (customer.isLoyal() && subtotal.greaterThan(Money.of(100))) {
            discount = subtotal.times(0.10);
        }
        return subtotal.minus(discount);
    }
}
```

The body has two phases: subtotal calculation and loyalty discount. Extract each.

**After:**

```java
class Order {
    private List<LineItem> items;
    private Customer customer;

    public Money total() {
        Money subtotal = subtotal();
        return subtotal.minus(loyaltyDiscount(subtotal));
    }

    private Money subtotal() {
        Money sum = Money.zero();
        for (LineItem item : items) {
            sum = sum.plus(item.price().times(item.quantity()));
        }
        return sum;
    }

    private Money loyaltyDiscount(Money subtotal) {
        if (customer.isLoyal() && subtotal.greaterThan(Money.of(100))) {
            return subtotal.times(0.10);
        }
        return Money.zero();
    }
}
```

`total()` reads as a sentence. Each helper has one job and is independently testable.

### Python — before / after

**Before:**

```python
def total(order):
    subtotal = sum(item.price * item.quantity for item in order.items)
    discount = 0
    if order.customer.is_loyal and subtotal > 100:
        discount = subtotal * 0.10
    return subtotal - discount
```

**After:**

```python
def total(order):
    sub = subtotal(order.items)
    return sub - loyalty_discount(order.customer, sub)

def subtotal(items):
    return sum(item.price * item.quantity for item in items)

def loyalty_discount(customer, subtotal):
    if customer.is_loyal and subtotal > 100:
        return subtotal * 0.10
    return 0
```

### Go — before / after

**Before:**

```go
func (o *Order) Total() Money {
    var subtotal Money
    for _, it := range o.items {
        subtotal = subtotal.Plus(it.Price.Times(it.Quantity))
    }
    var discount Money
    if o.customer.IsLoyal && subtotal.Greater(MoneyOf(100)) {
        discount = subtotal.Times(0.10)
    }
    return subtotal.Minus(discount)
}
```

**After:**

```go
func (o *Order) Total() Money {
    sub := o.subtotal()
    return sub.Minus(o.loyaltyDiscount(sub))
}

func (o *Order) subtotal() Money {
    var s Money
    for _, it := range o.items {
        s = s.Plus(it.Price.Times(it.Quantity))
    }
    return s
}

func (o *Order) loyaltyDiscount(sub Money) Money {
    if o.customer.IsLoyal && sub.Greater(MoneyOf(100)) {
        return sub.Times(0.10)
    }
    return Money{}
}
```

### Why it pays off

- Each extracted name **documents intent** — comments become unnecessary.
- Each helper is **testable in isolation**.
- When you later need to change loyalty rules, you change one method, not search through 80 lines.
- Stack traces point at named methods rather than line numbers in `total()`.

### Common mistakes

- **Naming after the implementation.** `iterateLoyaltyAndApplyMultiplier()` → bad. `loyaltyDiscount()` → good. The name is the headline.
- **Extracting too small.** A two-line fragment that has one job already may not need a name.
- **Capturing too many parameters.** If your extracted method takes 6 parameters, the fragment was probably **sharing too much state** — consider [Replace Method with Method Object](#replace-method-with-method-object).

---

## Inline Method

### What it does

The exact reverse of Extract Method: when a method's body is so simple that the name adds nothing — or worse, the name **misleads** — replace every call with the body and delete the method.

### When you smell it

```java
int rating(Driver d) {
    return moreThanFiveLateDeliveries(d) ? 2 : 1;
}

boolean moreThanFiveLateDeliveries(Driver d) {
    return d.lateDeliveries() > 5;
}
```

`moreThanFiveLateDeliveries(d)` is just `d.lateDeliveries() > 5`. The wrapper method adds no information.

### After

```java
int rating(Driver d) {
    return d.lateDeliveries() > 5 ? 2 : 1;
}
```

### When NOT to inline

- The method is **polymorphic** — subclasses override it. Inlining breaks dispatch.
- The method is **public API** — callers outside your codebase rely on the name.
- The body is non-trivial in performance terms (hot path, allocation, etc.). Wait for [professional.md](professional.md).

### Mechanics

1. Confirm the method is **not polymorphic**.
2. Find every caller.
3. Replace each call with the body.
4. Test.
5. Delete the method.

In IntelliJ, this is `Ctrl+Alt+N` (Inline).

---

## Extract Variable

### What it does

Take a complex sub-expression in the middle of a line and assign it to a well-named local. The line becomes a sentence.

### Before

```java
if (platform.toUpperCase().contains("MAC")
    && browser.toUpperCase().contains("IE")
    && wasInitialized()
    && resize > 0) {
    // do something
}
```

### After

```java
boolean isMacOs = platform.toUpperCase().contains("MAC");
boolean isInternetExplorer = browser.toUpperCase().contains("IE");
boolean wasResized = resize > 0;

if (isMacOs && isInternetExplorer && wasInitialized() && wasResized) {
    // do something
}
```

Each named boolean is **a fact about the world**. The `if` reads as English.

### Comparison: comment vs. extracted variable

A comment that says *"this checks for IE on Mac"* will rot when someone changes the expression. An extracted variable named `isInternetExplorerOnMac` won't — the IDE will refuse to let you delete the variable while it's still referenced.

> **Rule:** if you're tempted to write a comment explaining what an expression means, name the expression instead.

### Python idiomatic note

Python often achieves the same effect with a generator expression or a one-line helper:

```python
is_mac = "MAC" in platform.upper()
is_ie = "IE" in browser.upper()
was_resized = resize > 0
if is_mac and is_ie and was_initialized() and was_resized:
    ...
```

---

## Inline Temp

### What it does

Reverse of Extract Variable: a temp that is assigned once from a simple expression and used once is just noise.

### Before

```java
double basePrice = anOrder.basePrice();
return basePrice > 1000;
```

### After

```java
return anOrder.basePrice() > 1000;
```

### Caveat

If `anOrder.basePrice()` is **expensive** or has side effects, leave the temp — it caches the result. If the temp is **named meaningfully**, it might still pull weight as documentation.

---

## Replace Temp with Query

### What it does

You have a local variable holding the result of an expression. Extract the expression into a method and use the method everywhere.

### Before

```java
double basePrice = quantity * itemPrice;
if (basePrice > 1000) {
    return basePrice * 0.95;
} else {
    return basePrice * 0.98;
}
```

### After

```java
private double basePrice() {
    return quantity * itemPrice;
}

double total() {
    if (basePrice() > 1000) {
        return basePrice() * 0.95;
    } else {
        return basePrice() * 0.98;
    }
}
```

### Why this matters

It is **a precondition for Extract Method**. If your fragment uses local temps, those temps become parameters when extracted. Replace them with queries first and the parameters disappear — extraction becomes trivial.

### Caveat — performance

Calling `basePrice()` three times now multiplies twice. For arithmetic, this is invisible (JIT will inline and the Java compiler may even constant-fold). But for an expression like `database.fetchUser(id).getName()`, recomputing per call is a perf disaster. See [professional.md](professional.md).

---

## Split Temporary Variable

### What it does

A single temp variable assigned **twice** — once for one purpose, once for another — should become **two** named variables.

### Before

```java
double temp = 2 * (height + width);  // perimeter
System.out.println(temp);

temp = height * width;  // area
System.out.println(temp);
```

### After

```java
final double perimeter = 2 * (height + width);
System.out.println(perimeter);

final double area = height * width;
System.out.println(area);
```

### Why

A single name lying about what it holds is **worse than no name at all**. After splitting, each variable can be `final` (Java) / `const` (TypeScript) / unassigned-after-init (Go), reducing the surface for bugs.

> A loop counter (`i`) or accumulator (`sum`) that is genuinely reassigned across iterations is **not** a Split Temporary Variable case — that's its purpose.

---

## Remove Assignments to Parameters

### What it does

```java
int discount(int inputVal, int quantity, int yearToDate) {
    if (inputVal > 50) inputVal -= 2;     // <-- mutates a parameter
    if (quantity > 100) inputVal -= 1;
    ...
    return inputVal;
}
```

The parameter `inputVal` is now **two things**: the original input and the running discount. Reading the method, you can't easily answer "what was the caller's value?"

### After

```java
int discount(int inputVal, int quantity, int yearToDate) {
    int result = inputVal;
    if (inputVal > 50) result -= 2;
    if (quantity > 100) result -= 1;
    ...
    return result;
}
```

### Language differences

- **Java:** `final` parameters make this a compile-time check. Many style guides require it.
- **Python:** parameters are local references; reassigning them never affects the caller. But mutating a passed-in `list` *does*, so the rule still applies for clarity.
- **Go:** value parameters are copies; reassigning is local. The smell is the **clarity** loss, not a correctness bug.

---

## Replace Method with Method Object

### What it does

Some methods can't be extracted because they have **too many local variables in tangled relationships**. The cure is to promote the whole method into its own class:

- Each local becomes a **field** of the new class.
- The method body becomes the `compute()` method (or `__call__`, or any single entry point).
- Now you can freely Extract Method on the body — locals are now fields, no parameter passing needed.

### Before

```java
class Account {
    int gamma(int inputVal, int quantity, int yearToDate) {
        int importantValue1 = (inputVal * quantity) + delta();
        int importantValue2 = (inputVal * yearToDate) + 100;
        if ((yearToDate - importantValue1) > 100) {
            importantValue2 -= 20;
        }
        int importantValue3 = importantValue2 * 7;
        // ... 50 more lines of importantValue4, importantValue5 ...
        return importantValue3 - 2 * importantValue1;
    }
}
```

### After

```java
class Gamma {
    private final Account account;
    private final int inputVal;
    private final int quantity;
    private final int yearToDate;
    private int importantValue1;
    private int importantValue2;
    private int importantValue3;

    Gamma(Account account, int inputVal, int quantity, int yearToDate) {
        this.account = account;
        this.inputVal = inputVal;
        this.quantity = quantity;
        this.yearToDate = yearToDate;
    }

    int compute() {
        importantValue1 = (inputVal * quantity) + account.delta();
        importantValue2 = (inputVal * yearToDate) + 100;
        importantThirdAdjustment();
        importantValue3 = importantValue2 * 7;
        // ... freely extracted helpers ...
        return importantValue3 - 2 * importantValue1;
    }

    private void importantThirdAdjustment() {
        if ((yearToDate - importantValue1) > 100) {
            importantValue2 -= 20;
        }
    }
}

class Account {
    int gamma(int inputVal, int quantity, int yearToDate) {
        return new Gamma(this, inputVal, quantity, yearToDate).compute();
    }
}
```

This is also called the **"Command object" trick** when the method represents a request to do something.

> Note: a `Gamma` object is **single-use**. The fields hold partial state during one computation. Don't reuse instances across requests.

---

## Substitute Algorithm

### What it does

The method's job is right; its implementation is wrong-headed. Replace the entire body with a clearer algorithm.

### Before — found by name then linear scan

```java
String foundPerson(String[] people) {
    for (int i = 0; i < people.length; i++) {
        if (people[i].equals("Don")) return "Don";
        if (people[i].equals("John")) return "John";
        if (people[i].equals("Kent")) return "Kent";
    }
    return "";
}
```

### After

```java
private static final Set<String> CANDIDATES = Set.of("Don", "John", "Kent");

String foundPerson(String[] people) {
    for (String p : people) {
        if (CANDIDATES.contains(p)) return p;
    }
    return "";
}
```

### Mechanics

1. Make sure you have **good tests**. Substitute Algorithm is the most behavior-affecting refactoring in this category, even when the result is supposedly equivalent.
2. Write the new body next to the old (or in a new method).
3. Run tests.
4. Switch the call. Run tests. Delete the old.

### When to use

- The current algorithm has clear bugs.
- The current algorithm has unclear correctness — you can't reason about it.
- The new algorithm is dramatically simpler **and** equally correct.

### When NOT

- You aren't sure the new algorithm handles all the same edge cases. Tests must demonstrate this.
- The old algorithm is hot-path optimized for reasons that aren't in the code (legacy bench data). Check version history.

---

## How they relate

```
                          Long Method
                              │
                              ▼
            ┌──── Extract Method ──┐
            │                      │
            │  needs:               │
            │  - Replace Temp w/ Query
            │  - Split Temp Variable
            │  - Remove Param Assignments
            │
            ▼
   if too tangled to extract:
            │
            ▼
   Replace Method with Method Object
            │
            ▼
   now Extract Method works freely
```

The **inverses** sit opposite each other:

```
Extract Method <----> Inline Method
Extract Variable <----> Inline Temp
```

Almost every cleanup of [Long Method](../../01-code-smells/01-bloaters/junior.md) starts with **Extract Method** and uses **Replace Temp with Query** + **Extract Variable** as preparation steps.

---

## Mini Glossary

- **Behavior-preserving** — after the refactor, the same input produces the same output (and the same observable side effects). This is the cardinal rule of refactoring.
- **Local variable / temp** — a variable whose scope is one method.
- **Query method** — a method that returns a value and has no side effects. Pure functions in OO clothing.
- **Method Object / Command object** — a class whose only job is to hold the state and parameters of one execution. Single-use.
- **Inverse refactoring** — a refactoring that undoes another. Extract Method ↔ Inline Method.

---

## Review questions

1. What does Extract Method do? When would you use it?
2. What's the difference between Extract Variable and Replace Temp with Query?
3. Why is Replace Temp with Query often a precondition for Extract Method?
4. When should you NOT inline a method?
5. What's a "Method Object" and when does it become necessary?
6. Why is mutating a parameter inside a method a smell?
7. What's the difference between Split Temporary Variable and a normal loop counter?
8. When does Substitute Algorithm risk breaking behavior?
9. Which refactorings in this category are exact inverses of each other?
10. Which Code Smells are usually cured by techniques in this category?

---

## Next

- **Want depth on real-world triggers and trade-offs?** → [middle.md](middle.md)
- **Want architecture-scale and IDE tooling?** → [senior.md](senior.md)
- **Want bytecode/JIT effects?** → [professional.md](professional.md)
- **Want practice?** → [tasks.md](tasks.md), [find-bug.md](find-bug.md), [optimize.md](optimize.md)
- **Interview prep?** → [interview.md](interview.md)
