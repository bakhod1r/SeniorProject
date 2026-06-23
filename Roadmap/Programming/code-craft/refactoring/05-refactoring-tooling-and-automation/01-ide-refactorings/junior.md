# IDE & Automated Refactorings — Junior

> **Source:** Martin Fowler, *Refactoring* (2nd ed.); JetBrains IntelliJ IDEA & ReSharper refactoring docs

An **automated refactoring** is a code transformation that your IDE (or language server) performs for you, with a guarantee that the program still does the same thing afterward. You press a key, answer a prompt, and the tool rewrites your code — and every place that depended on the old shape — in one atomic, reversible step.

This is the single biggest force-multiplier a junior engineer can pick up. The difference between "I'm afraid to rename this method because it's used in 40 places" and "I rename it in 200ms and move on" is the difference between code that rots and code that stays clean. The tool does the tedious, error-prone work; you keep your attention on the design.

This page teaches you *what* the automated refactorings are, *why* they are safe (the answer is "AST"), and *how* to use them fluently from the keyboard.

---

## Table of Contents

1. [What "automated refactoring" actually means](#1-what-automated-refactoring-actually-means)
2. [Why AST-based refactoring is safe (and find-and-replace isn't)](#2-why-ast-based-refactoring-is-safe-and-find-and-replace-isnt)
3. [The catalog, with before/after](#3-the-catalog-with-beforeafter)
   - [3.1 Rename](#31-rename)
   - [3.2 Extract Method / Function](#32-extract-method--function)
   - [3.3 Extract Variable / Constant](#33-extract-variable--constant)
   - [3.4 Inline](#34-inline)
   - [3.5 Change Signature](#35-change-signature)
   - [3.6 Move (class / member)](#36-move-class--member)
   - [3.7 Extract Interface / Superclass](#37-extract-interface--superclass)
   - [3.8 Pull Up / Push Down](#38-pull-up--push-down)
   - [3.9 Introduce Parameter & Encapsulate Field](#39-introduce-parameter--encapsulate-field)
4. [Keyboard fluency](#4-keyboard-fluency)
5. [Trust, but verify with tests](#5-trust-but-verify-with-tests)
6. [Where the tool can't help](#6-where-the-tool-cant-help)
7. [Glossary](#7-glossary)
8. [Review questions](#8-review-questions)
9. [Next](#9-next)

---

## 1. What "automated refactoring" actually means

Refactoring is *changing the structure of code without changing its behavior*. You can do it by hand — select text, retype it, fix the callers. Or you can ask the IDE to do it.

When the IDE does it, three things are true that are *not* true when you do it by hand:

1. **It understands your code as a tree, not as text.** It knows that the `total` on line 12 is the same variable as the `total` on line 30, and that the `total` in the unrelated method on line 80 is a *different* variable that happens to share the name.
2. **It updates every reference.** Rename a method and every call site — across every file in the project — is updated in the same step.
3. **It is atomic and reversible.** One transformation, one undo. Either it all happens or none of it does.

A useful mental model: an automated refactoring is a *guaranteed behavior-preserving edit*. The IDE is willing to make that guarantee because it does not edit text — it edits the **abstract syntax tree** (AST) and the **semantic model** (which name refers to which declaration), then prints valid code back out.

```java
// You ask: "Rename `calc` to `calculateTotal`"
// The IDE does NOT do a text search for "calc".
// It finds the *declaration* of the method, finds every *resolved reference*
// to that exact declaration, and rewrites all of them — and nothing else.
```

That last sentence is the whole game. Hold onto it.

---

## 2. Why AST-based refactoring is safe (and find-and-replace isn't)

Let's make the contrast concrete. Suppose you want to rename a field `name` to `customerName`.

**Find-and-replace approach** (text-level — dangerous):

Your editor searches for the string `name` and offers to replace it. But the string `name` appears in:

```java
class Customer {
    private String name;            // ✅ you want this
    String getName() {              // ❌ "Name" inside getName — wrong, different casing but a naive regex catches it
        return name;                // ✅ you want this
    }
    String hostname;                // ❌ "name" is a substring of hostname
    // ... and in a comment:
    // "the name field holds..."    // ❌ a comment, not code
    // ... and in a string literal:
    String label = "name";          // ❌ a UI label, must NOT change
    // ... and in a totally unrelated class:
}
class Server {
    private String name;            // ❌ a DIFFERENT `name`, in a DIFFERENT class
}
```

A text replace cannot tell these apart. It sees seven occurrences of the characters `n-a-m-e` and treats them identically. You either over-replace (break `hostname`, mangle the string literal, rename the unrelated `Server.name`) or you click through each one manually and inevitably miss one.

**AST-based approach** (semantic — safe):

The IDE parses the file into a tree. It knows:

- `Customer.name` is a **field declaration**.
- The `name` in `return name;` is a **reference that resolves to** `Customer.name`.
- `hostname` is a *different identifier* — `name` is not a node there, it's just characters inside another node.
- The text inside `"name"` is a **string literal node**, not a name reference.
- The comment is a **comment node**, not code.
- `Server.name` resolves to a **different declaration**.

So when you Rename `Customer.name`, the IDE rewrites exactly two places — the declaration and the one real reference — and leaves the other five alone. (It will *offer* to update matching comments and string literals as a separate, opt-in checkbox, because sometimes you do want that, but it's never silent.)

This is why we say automated refactorings are **reference-aware**, **scope-aware**, and **reversible**:

| Property | What it means | Why it matters |
|---|---|---|
| **Reference-aware** | Operates on resolved declarations/references, not on characters | Updates the *right* occurrences, across files, and skips look-alikes |
| **Scope-aware** | Knows that two same-named things in different scopes are different | Won't bleed a rename from one class into another |
| **Atomic & reversible** | One transformation, one undo | A mistake is one Ctrl+Z away, not 40 careful re-edits |
| **Validating** | Refuses or warns when the edit would not compile or would collide | Catches name clashes before they become bugs |

> **When NOT to rely on it:** the guarantee only covers references the tool can *see*. References that live in strings, reflection, config files, or other languages are invisible to it (see [§6](#6-where-the-tool-cant-help)). For those, AST refactoring is not enough.

---

## 3. The catalog, with before/after

These are the workhorse refactorings. Every modern IDE has them; the names are nearly universal because they come straight from Fowler's catalog. Learn the shape of each, and learn the *one* keystroke that triggers it.

### 3.1 Rename

The most-used refactoring, full stop. Rename a variable, parameter, field, method, class, package, or file — and every reference follows.

```java
// BEFORE
int d;                       // elapsed time in days
int calc(int d) { return d * 24; }

// Rename `d` -> `days`, `calc` -> `hoursIn`
// AFTER
int days;
int hoursIn(int days) { return days * 24; }
```

The IDE updates the parameter name *and* the body reference together because it knows they are the same symbol. If a new name would clash with an existing one in scope, it warns you before doing anything.

**When NOT to:** when the name is also used as a string key the tool can't see — e.g. a JSON field name, a Spring bean id, an HTTP route, a reflectively-loaded class name. Renaming the Java symbol leaves the string stale. See [§6](#6-where-the-tool-cant-help).

### 3.2 Extract Method / Function

Select a block of statements and turn it into its own named method. The IDE works out which local variables need to become **parameters** and which become the **return value**.

```java
// BEFORE
void printOwing(Invoice invoice) {
    printBanner();
    double outstanding = 0;
    for (Order o : invoice.orders) {
        outstanding += o.amount;          // <-- select these
    }                                     // <-- three
    System.out.println("amount: " + outstanding); // <-- lines
}

// Extract the selection as `calculateOutstanding`
// AFTER
void printOwing(Invoice invoice) {
    printBanner();
    double outstanding = calculateOutstanding(invoice);
    System.out.println("amount: " + outstanding);
}

double calculateOutstanding(Invoice invoice) {
    double outstanding = 0;
    for (Order o : invoice.orders) {
        outstanding += o.amount;
    }
    return outstanding;
}
```

Notice the IDE figured out that `invoice` must be passed in and `outstanding` must be returned. It does this by analyzing **data flow**: which variables are read from outside the selection, and which are written inside and used afterward. This is canonical Extract Function — see [`../../02-refactoring-techniques/01-composing-methods/junior.md`](../../02-refactoring-techniques/01-composing-methods/junior.md).

**When NOT to:** if your selection writes to *two* local variables that are both used afterward, there's no single return value. The IDE will refuse (Java has one return slot). That's a signal the block isn't a clean unit — rethink the boundary.

### 3.3 Extract Variable / Constant

Pull a sub-expression into a named local variable (or a `static final` constant). Great for naming a magic value or an opaque condition.

```java
// BEFORE
if (platform.toUpperCase().indexOf("MAC") > -1
        && browser.toUpperCase().indexOf("IE") > -1) { ... }

// Extract Variable on each clause
// AFTER
boolean isMacOs    = platform.toUpperCase().indexOf("MAC") > -1;
boolean isIE       = browser.toUpperCase().indexOf("IE") > -1;
if (isMacOs && isIE) { ... }
```

**Extract Constant** is the same idea but produces a class-level `static final`:

```java
// BEFORE
double finalPrice = basePrice * 0.98;
// Extract Constant
private static final double DISCOUNT_FACTOR = 0.98;
double finalPrice = basePrice * DISCOUNT_FACTOR;
```

The IDE offers to replace **all occurrences** of the same expression in scope with the new variable — accept it when the occurrences are genuinely "the same thing," decline it when two identical-looking expressions mean different things.

**When NOT to:** "replace all occurrences" can over-merge. `width * 2` for a margin and `width * 2` for a border are textually identical but conceptually unrelated; merging them couples two things that should change independently.

### 3.4 Inline

The inverse of Extract. **Inline Variable** replaces a variable with its value; **Inline Method** replaces calls with the body. Use it when the indirection earns nothing.

```java
// BEFORE
int basePrice = anOrder.basePrice();
return basePrice > 1000;
// Inline Variable `basePrice`
// AFTER
return anOrder.basePrice() > 1000;
```

```java
// BEFORE
int rating(Driver d) { return moreThanFive(d) ? 2 : 1; }
boolean moreThanFive(Driver d) { return d.deliveries() > 5; }
// Inline Method `moreThanFive`
// AFTER
int rating(Driver d) { return d.deliveries() > 5 ? 2 : 1; }
```

Inline is often a *cleanup step before a bigger move*: inline a bad helper, then re-extract a better one. (See [`../../02-refactoring-techniques/01-composing-methods/junior.md`](../../02-refactoring-techniques/01-composing-methods/junior.md).)

**When NOT to:** inlining a method that's called in many places duplicates the body everywhere and can change behavior if the method is overridden in a subclass — the IDE warns about this.

### 3.5 Change Signature

Add, remove, reorder, or rename parameters of a method — and update every call site consistently. You can supply a default value for a newly-added parameter so existing callers still compile.

```java
// BEFORE
double charge(int quantity, boolean isWeekend) { ... }
// call sites:  charge(5, true);  charge(2, false);

// Change Signature: add `double rate` as first param, default 1.0
// AFTER
double charge(double rate, int quantity, boolean isWeekend) { ... }
// call sites auto-updated:  charge(1.0, 5, true);  charge(1.0, 2, false);
```

This is one of the highest-leverage automated refactorings, because doing it by hand means visiting every caller and getting the argument order exactly right. See [`../../02-refactoring-techniques/05-simplifying-method-calls/junior.md`](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md).

**When NOT to:** if the method is called reflectively or via a framework that binds by parameter count/name (some DI or serialization frameworks), the tool can't update those invisible callers.

### 3.6 Move (class / member)

Move a method or field to a different class, or a class to a different package — references and imports update automatically.

```java
// BEFORE — overdraftCharge logic lives on Account but reads only AccountType data
class Account {
    AccountType type;
    int daysOverdrawn;
    double overdraftCharge() {
        if (type.isPremium()) return daysOverdrawn * 1.0;
        return daysOverdrawn * 1.75;
    }
}
// Move Method `overdraftCharge` to AccountType (it belongs with the data it uses)
// AFTER
class AccountType {
    double overdraftCharge(int daysOverdrawn) {
        if (isPremium()) return daysOverdrawn * 1.0;
        return daysOverdrawn * 1.75;
    }
}
// Account.overdraftCharge now delegates; callers updated.
```

See [`../../02-refactoring-techniques/02-moving-features/junior.md`](../../02-refactoring-techniques/02-moving-features/junior.md). This is the cure for the **Feature Envy** smell — [`../../01-code-smells/05-couplers/junior.md`](../../01-code-smells/05-couplers/junior.md).

**When NOT to:** moving a class can break code that loads it by its fully-qualified name from a string (reflection, config). The class moves; the string doesn't.

### 3.7 Extract Interface / Superclass

Select a set of members and pull them up into a new interface or abstract superclass, which the original class then implements/extends.

```java
// BEFORE
class EmailNotifier {
    void send(String to, String body) { ... }
    void retry() { ... }
}
// Extract Interface `Notifier` exposing send(...)
// AFTER
interface Notifier { void send(String to, String body); }
class EmailNotifier implements Notifier {
    public void send(String to, String body) { ... }
    void retry() { ... }
}
```

The IDE can then offer to **change usages to the interface** where only `send` is needed — widening your code's flexibility without you editing every reference by hand. See [`../../02-refactoring-techniques/06-dealing-with-generalization/junior.md`](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md).

**When NOT to:** don't extract an interface just because you *can*. An interface with one implementer that nobody mocks is speculative generality. Extract when a second implementation or a test double actually needs it.

### 3.8 Pull Up / Push Down

In an inheritance hierarchy, **Pull Up** moves a member from a subclass into the superclass (deduplicating identical members across siblings); **Push Down** moves a member from the superclass into the subclass(es) that actually use it.

```java
// BEFORE — both subclasses have the same field
class Salesman extends Employee { String name; }
class Engineer extends Employee { String name; }
// Pull Up Field `name` into Employee
// AFTER
class Employee { String name; }
class Salesman extends Employee { }
class Engineer extends Employee { }
```

See [`../../02-refactoring-techniques/06-dealing-with-generalization/junior.md`](../../02-refactoring-techniques/06-dealing-with-generalization/junior.md).

**When NOT to:** pulling up a method whose body references a field that exists only in *one* subclass won't compile in the superclass — the IDE flags this. Push down, or pull up the field first.

### 3.9 Introduce Parameter & Encapsulate Field

**Introduce Parameter** takes a value computed inside a method and lifts it into a parameter, so the caller decides it.

```java
// BEFORE
void greet() { System.out.println("Hello, default user"); }
// Introduce Parameter `name`
// AFTER
void greet(String name) { System.out.println("Hello, " + name); }
```

**Encapsulate Field** makes a public field private and routes all access through a getter/setter, rewriting every direct read/write.

```java
// BEFORE
public int low; public int high;
// access: range.low = 5;  int x = range.high;
// Encapsulate Field
// AFTER
private int low; private int high;
public int getLow() { return low; }  public void setLow(int v) { low = v; }
// access auto-rewritten: range.setLow(5);  int x = range.getHigh();
```

See [`../../02-refactoring-techniques/05-simplifying-method-calls/junior.md`](../../02-refactoring-techniques/05-simplifying-method-calls/junior.md).

**When NOT to:** encapsulating a field that's serialized by field name (some frameworks) can change the serialized form — the getter/setter route may not match what the serializer expects.

---

## 4. Keyboard fluency

The whole point of automated refactoring is *speed*. If you reach for the mouse and hunt through a context menu, you've lost it. Learn the keystrokes for your IDE and drive everything from the keyboard.

| Refactoring | IntelliJ IDEA (mac) | VS Code |
|---|---|---|
| Rename | `⇧F6` | `F2` |
| Extract Method | `⌘⌥M` | `Ctrl+.` → Extract |
| Extract Variable | `⌘⌥V` | `Ctrl+.` → Extract |
| Extract Constant | `⌘⌥C` | `Ctrl+.` |
| Inline | `⌘⌥N` | `Ctrl+.` |
| Change Signature | `⌘F6` | (via extension) |
| **Refactor This menu** | `⌃T` | `Ctrl+Shift+R` |

Two habits to build immediately:

1. **Learn "Refactor This" (`⌃T` in IntelliJ).** It pops a context-sensitive menu of *only the refactorings legal at the cursor*. You don't have to memorize all 20 keystrokes — you memorize one, and pick from the list. As you notice which ones you use constantly, learn their direct keys.
2. **Refactor in tiny steps.** Don't try to restructure a 200-line method in one heroic edit. Extract one variable. Run tests. Extract one method. Run tests. Rename it. Each step is individually safe and individually reversible. A sequence of ten safe steps gets you somewhere a single risky edit never would.

---

## 5. Trust, but verify with tests

The IDE's guarantee is real but bounded: it preserves behavior *for the references it can see*. So the discipline is:

> **Trust the tool for the mechanical edit. Verify with a test that behavior actually held.**

In practice:

- **Have tests before you refactor.** If the area has no tests, write a couple of **characterization tests** first — tests that pin the current behavior, even behavior you're not sure is "correct." They're your safety net. (See [`../03-automated-safety-nets/junior.md`](../03-automated-safety-nets/junior.md).)
- **Run tests after each refactoring step**, not just at the end. If step 7 of 10 broke something, you want to know it was step 7, not "somewhere in the last ten edits."
- **Watch the preview.** Refactorings like Rename and Change Signature offer a *preview* of every change. For anything touching many files, skim it. The tool flags "conflicts" and "occurrences in strings/comments" separately — read those warnings; they're exactly where the guarantee thins out.

The combination — semantic tool + fast tests — is what lets you refactor confidently. Neither half is enough alone.

---

## 6. Where the tool can't help

The AST guarantee covers references the compiler/analyzer can resolve. Anything *outside* that model is invisible. The big four:

1. **Reflection & dynamic dispatch by name.** `Class.forName("com.app.Account")`, `method.invoke(...)`, `obj.getClass().getMethod("calc")`. The string `"calc"` is just text to the IDE. Rename the method and the string goes stale — you get a runtime `NoSuchMethodException`, not a compile error.

2. **Cross-language boundaries.** A field name that also appears in a SQL column mapping, an HTML/JSX template, a JSON contract, or a dependency-injection config (Spring XML, bean ids). The Java side renames; the SQL/template/config side doesn't. Same for a JPA `@Column` that maps a renamed field to a fixed DB column name.

3. **String-based keys.** Map keys, feature-flag names, event names, resource bundle keys, environment variables. `config.get("max_retries")` — rename nothing; the string is the contract.

4. **Semantics-changing edge cases.** Overload resolution (Change Signature can quietly make a call bind to a *different* overload), variable shadowing (a Rename that makes a local shadow a field), and overridden methods (Inline into a class that has subclasses). Good IDEs warn; lesser ones don't.

When the change you need crosses one of these boundaries, an IDE refactoring is the *wrong* tool — or at least not the *whole* tool. You either:

- Use a **codemod / AST transform** that you can target at the right language and the right pattern — see [`../02-codemods-and-ast-transforms/junior.md`](../02-codemods-and-ast-transforms/junior.md); or
- For a project-wide change across many repos/files, reach for **large-scale automated migration** — see [`../04-large-scale-automated-migrations/junior.md`](../04-large-scale-automated-migrations/junior.md); or
- Do it by hand with **characterization tests** guarding you — see [`../03-automated-safety-nets/junior.md`](../03-automated-safety-nets/junior.md).

> **The rule:** if the references live where the type-checker can see them, let the IDE do it. The moment they leak into strings, config, or another language, stop trusting the green checkmark and verify with a test.

---

## 7. Glossary

- **AST (Abstract Syntax Tree):** the tree representation of source code that the parser builds. The IDE refactors the tree, not the text.
- **Semantic model / symbol resolution:** the layer that answers "which declaration does this name refer to?" Rename relies entirely on it.
- **Reference:** a use of a declared symbol (variable, method, type). Automated refactorings update *resolved* references.
- **Scope:** the region of code where a name is valid. Scope-awareness is why two same-named locals in different methods stay separate.
- **Language Server (LSP):** a process that provides language smarts (completion, rename, etc.) to any editor over a standard protocol — see [senior.md](senior.md).
- **Codemod:** a scripted, AST-based bulk transformation you author yourself for patterns the IDE doesn't offer — see [`../02-codemods-and-ast-transforms/junior.md`](../02-codemods-and-ast-transforms/junior.md).
- **Characterization test:** a test written to capture *existing* behavior before you change code, so you can detect accidental changes.

---

## 8. Review questions

1. In one sentence, why is an automated Rename safe where a find-and-replace of the same name is not?
2. You Extract Method on a block that writes to two locals both used afterward. The IDE refuses. Why, and what does that tell you about the block?
3. Give two concrete places where a renamed Java field's old name silently survives because the IDE can't see it.
4. What does "refactor in tiny steps, run tests after each" buy you over one big edit?
5. When you Encapsulate Field, what exactly does the IDE rewrite, and what does it leave alone?
6. Why does the Rename preview list "occurrences in comments and strings" as a *separate, opt-in* group?

---

## 9. Next

- **[middle.md](middle.md)** — map the full catalog to Fowler's named refactorings, per-language differences, and the small-steps workflow in depth.
- **[senior.md](senior.md)** — how the language server resolves references under the hood, why dynamic languages give weaker guarantees, and designing code so the tools *can* help.
- Related techniques: [`../../02-refactoring-techniques/01-composing-methods/junior.md`](../../02-refactoring-techniques/01-composing-methods/junior.md) · [`../../02-refactoring-techniques/02-moving-features/junior.md`](../../02-refactoring-techniques/02-moving-features/junior.md)
- When the IDE isn't enough: [`../02-codemods-and-ast-transforms/junior.md`](../02-codemods-and-ast-transforms/junior.md) · [`../03-automated-safety-nets/junior.md`](../03-automated-safety-nets/junior.md)
