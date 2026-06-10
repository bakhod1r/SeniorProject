# Access Specifiers — Junior

> **What?** *Access specifiers* (also called *access modifiers*) are keywords that decide **who can see** a class, field, method, or constructor. Java has four levels: `public`, `protected`, *package-private* (no keyword), and `private`.
> **How?** Place the keyword (or omit it for package-private) before the declaration. The compiler enforces the rules at compile time.

---

## 1. The four levels at a glance

| Modifier            | Same class | Same package | Subclass (different package) | Anywhere |
|---------------------|:----------:|:------------:|:----------------------------:|:--------:|
| `private`           | ✓          | ✗            | ✗                            | ✗        |
| *package-private* (no keyword) | ✓ | ✓ | ✗                          | ✗        |
| `protected`         | ✓          | ✓            | ✓                            | ✗        |
| `public`            | ✓          | ✓            | ✓                            | ✓        |

The order from most-restrictive to least-restrictive: **`private` → package-private → `protected` → `public`**.

---

## 2. The default — package-private

If you write nothing, you get *package-private* (also called "default" access):

```java
class Helper {                  // package-private — only visible inside this package
    int    compute(int x) { ... }
    String name = "helper";
}
```

Other classes in the *same* package can see and use `Helper`. Classes in *other* packages cannot — they don't see the class at all.

This is the *default*, but most beginners write `public` everywhere out of habit. Don't. Pick the *narrowest* access that lets your code work.

---

## 3. `private` — visible only within the same class

```java
public class BankAccount {
    private long balanceCents;       // only methods of BankAccount can read/write

    public void deposit(long cents) { balanceCents += cents; }
    public long getBalance()        { return balanceCents; }
}
```

Outside `BankAccount`:

```java
account.balanceCents = 9999;        // ❌ compile error
account.deposit(9999);               // ✓ goes through the method
```

`private` is the **default you should reach for first**. Loosen it only when you have a reason. Most field declarations should be `private`.

A small subtlety: `private` is per-*class*, not per-*instance*. One `BankAccount` instance can read another's `private` fields:

```java
public class BankAccount {
    private long balanceCents;
    public boolean richerThan(BankAccount other) {
        return this.balanceCents > other.balanceCents;   // ✓ legal
    }
}
```

This is by design — `equals`, `compareTo`, etc., would be impossible otherwise.

---

## 4. `public` — visible everywhere

```java
public class Mathx {
    public static int add(int a, int b) { return a + b; }
}

// Anywhere else:
import com.example.Mathx;
int s = Mathx.add(2, 3);
```

`public` is a **commitment**. Every `public` member becomes part of your class's API. Once shipped, callers depend on it; renaming or removing it is a *breaking change*.

Use `public` when:

- The member is genuinely part of the class's API (the methods callers should use).
- The class is a library/framework type meant for outside use.

Don't use `public` "just in case." Tighten access first, loosen later if needed.

---

## 5. `protected` — same package + subclasses

```java
package com.example.shapes;

public class Shape {
    protected double area;          // visible to subclasses, even in other packages

    protected double computeArea() { ... }
}

// Different package, same hierarchy:
package com.example.fancy;
import com.example.shapes.Shape;

public class Circle extends Shape {
    public double doubleArea() {
        return area * 2;            // ✓ — protected access via subclass
    }
}
```

`protected` is the right choice when:

- A subclass *legitimately* needs the field/method to extend the class.
- You're designing a **template method** pattern (the parent calls protected hooks the subclass implements).

Subtle rule: `protected` access from a subclass in a different package only works through the *subclass's own* type, not through arbitrary references. (You can read `subclass.protectedField` but not `someOtherShape.protectedField` from outside the package.)

---

## 6. Package-private — same package only

```java
class InternalHelper {              // class itself is package-private
    int compute(int x) { return x * 2; }
}
```

This is the right level for *internal helpers* — code that supports your public API but isn't itself part of it. Use it generously:

- Helper classes with no callers outside the package.
- Utility methods that the public surface uses internally.
- Test-friendly hooks (a package-private method can be tested by a test class in the same package).

Many JDK internals use package-private heavily. It's a discipline worth adopting.

---

## 7. Top-level classes: `public` or package-private only

A *top-level* class (one not nested inside another) can be only `public` or package-private:

```java
public class Foo  { ... }          // ✓
class Bar         { ... }          // ✓ (package-private)
private class Baz { ... }          // ❌ compile error
protected class Qux { ... }        // ❌ compile error
```

`private` and `protected` apply only to *nested* members (classes, fields, methods, constructors).

A `.java` file can contain at most one `public` class, and its name must match the file name. The other top-level classes (if any) must be package-private.

---

## 8. Constructors have access too

```java
public class Singleton {
    private Singleton() { }                // private constructor — only this class can call

    public static final Singleton INSTANCE = new Singleton();
}

new Singleton();                            // ❌ compile error
Singleton.INSTANCE;                          // ✓
```

Common patterns:

- `private` constructor for singletons, utility classes (no instances), or static-factory-only classes.
- Package-private constructor when you want the package's classes to instantiate freely but block outsiders.
- `protected` constructor when only subclasses (and same-package) should construct.

If you make a class non-instantiable (utility class), declare `private Singleton() { throw new AssertionError(); }` so reflection + a stray new can't sneak through.

---

## 9. Why bother? — the value of access control

Access modifiers are a tool for **encapsulation**. They let you say:

- "These fields are mine — outsiders can't read or write them, so I can change them later without breaking callers." (`private`)
- "These methods are the API — clients depend on them; I commit to keeping them stable." (`public`)
- "These hooks are for subclasses — they may extend or override; outsiders shouldn't touch them." (`protected`)
- "These helpers are internal to my module — feel free to use them within this package." (package-private)

Without access control, every refactor risks breaking unknown callers. With it, you have a shrink-wrapped boundary.

---

## 10. Read access vs write access

The same modifier governs both reading and writing. If you want, e.g., everyone to *read* a field but only the owning class to *write* it, expose a getter and keep the field `private`:

```java
public class Config {
    private String url;            // hidden — only the class writes it

    public String url() { return url; }   // public read access
}
```

This is the textbook reason for getters: asymmetric access (read public, write private) without exposing the field.

---

## 11. Order matters in a declaration

```java
public static final String NAME = "foo";   // visibility first, then static, then final
```

The conventional order (and what most style guides require):

```
[visibility] [static] [final] [synchronized] [native] [strictfp] Type name
```

The compiler doesn't enforce this order, but tools and humans both expect it.

---

## 12. Quick rule of thumb (the pragmatic default)

When in doubt, follow this default order:

1. **Fields**: `private`. Always. Loosen only with a real reason.
2. **Methods**: `private` if it's an internal helper; `public` if it's the API; package-private otherwise.
3. **Classes**: package-private unless something outside the package needs the class. Then `public`.
4. **Constructors**: `public` for instantiable classes; `private` for singletons/utilities; package-private for "controlled" construction.

Tighten first. You can always loosen later. *Tightening* later is much harder — it breaks every existing caller.

---

## 13. Examples putting it together

```java
package com.example.banking;

public class BankAccount {                  // public API class
    private final long id;                   // hidden state
    private long balanceCents;               // hidden state, mutable

    public BankAccount(long id) {            // public constructor
        this.id = id;
    }

    public long getBalance() {               // public reader
        return balanceCents;
    }

    public void deposit(long cents) {        // public mutator
        if (cents <= 0) throw new IllegalArgumentException();
        balanceCents = Math.addExact(balanceCents, cents);
    }

    void debit(long cents) {                 // package-private — used by InternalTransfer
        balanceCents = Math.subtractExact(balanceCents, cents);
    }

    private void log(String msg) {           // private helper
        System.out.println(id + ": " + msg);
    }
}

class InternalTransfer {                     // package-private support class
    static void move(BankAccount from, BankAccount to, long cents) {
        from.debit(cents);                   // ✓ package-private access
        to.deposit(cents);
    }
}
```

Each modifier is doing real work — outsiders see a tight `BankAccount` API, the package collaborates internally without exposing transfer logic, and `log` stays inside.

---

## 14. Common beginner mistakes

| Mistake                                | Symptom                             | Fix                              |
|----------------------------------------|-------------------------------------|----------------------------------|
| Making everything `public`              | Refactors break callers everywhere | Tighten access by default        |
| Keeping fields `public`                 | Invariants get bypassed             | `private` + getter/setter        |
| Using `protected` to "share with friends" | Subclasses become required for access | Use package-private instead    |
| Hidden static field defaults to package | Surprised that another package can't see it | Decide intentionally — `public`/`private`/none |
| Compiler-rejected `private` on top-level class | Doesn't work for top-level | Use package-private or `public` |

---

## 15. Cheat sheet

```
private          → only this class
(none)           → only this package
protected        → this package + subclasses (incl. other packages)
public           → everyone
```

Default for fields: `private`.
Default for methods: as narrow as possible.
Default for classes: package-private unless externally needed.
Default for constructors: `public` for normal use; `private` for singletons/utility.

That's the entire vocabulary of access control. Master the four levels and you've fortified the boundary that all the other OOP rules rely on.
