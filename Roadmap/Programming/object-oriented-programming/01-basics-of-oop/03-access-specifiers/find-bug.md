# Access Specifiers — Find the Bug

> 12 buggy snippets where the bug is *the access modifier*. Read each, identify why it bites, when it bites, and the fix.

---

## Bug 1 — Public mutable field bypassing validation

```java
public class User {
    public String email;

    public void setEmail(String email) {
        if (email == null || !email.contains("@"))
            throw new IllegalArgumentException();
        this.email = email;
    }
}
```

Caller:

```java
User u = new User();
u.email = "not-an-email";       // ✗ skipped validation
```

**Bug.** `email` is `public`. The setter validates — but the field can be assigned directly, bypassing the check. After the assignment, `u.email` holds an invalid value, and the next code that uses it (e.g., sending an email) will fail in confusing ways.

**Fix.** Make the field `private`. The setter is the only way to assign:

```java
private String email;
```

**Lesson.** Validation in a setter is meaningless if the field is `public`. The field's access controls who can write; the setter's logic only protects callers who *use* it.

---

## Bug 2 — `protected` field mutated by a subclass under contention

```java
public abstract class Cache {
    protected long hitCount;          // ⚠ exposed mutable state

    public abstract Object get(String key);
}

public class LoggingCache extends Cache {
    @Override
    public Object get(String key) {
        Object v = lookup(key);
        if (v != null) hitCount++;     // not synchronized
        return v;
    }
}
```

Two threads call `get` simultaneously.

**Bug.** `hitCount++` is not atomic; concurrent increments lose updates. The base class `Cache` exposed `hitCount` as `protected`, with no thread-safety contract. The subclass writer didn't realize.

**Fix.** Make `hitCount` `private` and expose `protected final void recordHit()` that uses `AtomicLong` or `LongAdder`:

```java
public abstract class Cache {
    private final LongAdder hitCount = new LongAdder();
    protected final void recordHit()    { hitCount.increment(); }
    public         long   hits()        { return hitCount.sum(); }
}
```

**Lesson.** `protected` fields are an open invitation for subclasses to break parent invariants — including thread safety. Keep state `private`; expose `protected` methods.

---

## Bug 3 — Singleton with `public` constructor

```java
public class Singleton {
    public static final Singleton INSTANCE = new Singleton();

    public Singleton() { }            // ❌ public constructor defeats the singleton
}

new Singleton();                       // creates a second instance
```

**Bug.** The constructor is `public`. Anyone can create more `Singleton` instances. The "single" guarantee is gone.

**Fix.** Make the constructor `private`:

```java
private Singleton() { }
```

For extra safety against reflection, throw in the constructor:

```java
private Singleton() { if (INSTANCE != null) throw new IllegalStateException(); }
```

Or use `enum Singleton { INSTANCE; ... }` — reflection-resistant.

**Lesson.** A singleton's contract relies on access control. Public constructor → no singleton.

---

## Bug 4 — Package-private accidentally widens with refactor

Original:

```java
package com.example.payment;

class TaxCalculator {
    BigDecimal taxFor(Money amount) { ... }
}
```

Now you move `TaxCalculator` into a sub-package:

```java
package com.example.payment.internal;

class TaxCalculator {     // still package-private
    BigDecimal taxFor(Money amount) { ... }
}
```

But callers in `com.example.payment` no longer see it (different package).

**Bug.** Package-private restricts to the *same* package. Moving the class to a sub-package breaks compilation in callers — the most common "what just happened?" Java refactor surprise.

**Fix.** Either:
- Keep `TaxCalculator` in the original package.
- Make it `public` (and ideally use JPMS to keep it module-internal).
- Make the callers also move into `internal`.

**Lesson.** Java packages don't nest in terms of access. `com.example.payment.internal` and `com.example.payment` are unrelated for access purposes — a class in one cannot package-private access classes in the other.

---

## Bug 5 — Subclass cannot construct because parent constructor is package-private

```java
package com.lib;
public class Base {
    Base() { }                         // package-private constructor
}

// in another package:
package com.app;
public class Child extends Base { }     // ❌ compile error: Base() not visible
```

**Bug.** The parent constructor is package-private. The child class is in a different package, so it can't invoke `super()`. Compile fails.

**Fix.** Either:
- Make `Base()` `protected` (visible to subclasses anywhere).
- Add a `protected Base(...)` constructor that subclasses can call.
- Move `Child` into the same package as `Base` (often the right call for tight coupling).

**Lesson.** A constructor's access controls *who can subclass* (since subclasses must call `super()`). Package-private constructors limit subclassing to the same package.

---

## Bug 6 — Test class in a different package can't see internals

You have:

```
src/main/java/com/example/Order.java     (package-private isPaid())
src/test/java/com/test/OrderTest.java    (different package)
```

`OrderTest` tries to call `order.isPaid()`. Compile error: not visible.

**Bug.** The test is in a different package than the production class. Package-private access doesn't reach.

**Fix.** Move the test to the *same* package:

```
src/test/java/com/example/OrderTest.java
```

Tests in `src/test/java/com/example/` see all package-private members of production code. This is the standard Maven/Gradle layout exactly *for this reason*.

**Lesson.** Tests should mirror the production package layout. Don't widen production access to "make testing easier" — co-locate the tests instead.

---

## Bug 7 — `setAccessible(true)` fails under JPMS

```java
Field f = User.class.getDeclaredField("password");
f.setAccessible(true);                  // throws InaccessibleObjectException
String pwd = (String) f.get(user);
```

**Bug.** Java 9+: `setAccessible(true)` is constrained by JPMS. The target package must be `opens` to the caller. If `User` is in a module that doesn't `opens` its package to the caller, this throws.

**Fix.** Either:
- Add `opens com.example.user to com.app;` in the target module's `module-info.java`.
- Use `MethodHandles.privateLookupIn(User.class, MethodHandles.lookup())` (still requires opens, but it's the modern API).
- Run with `--add-opens com.example.user/com.example.user=ALL-UNNAMED` (a runtime crutch).

**Lesson.** Pre-9 reflection ignored access modifiers; post-9 it doesn't. Migrate frameworks to declare what they need.

---

## Bug 8 — Public class with package-private dependency

```java
package com.example;

public class Order {
    public Tax getTax() { return tax; }    // returns package-private type
    private Tax tax;
}

class Tax { ... }                          // package-private
```

External caller:

```java
import com.example.Order;
Order o = ...;
Order.Tax t = o.getTax();                  // ❌ Tax isn't visible
```

**Bug.** `Order` is `public` but its return type `Tax` is package-private. Callers outside the package cannot use the return type — they can call `getTax()` but the result is `var`-only or `Object`.

**Fix.** Either make `Tax` `public` (full API), or have `Order.getTax()` return a public type (an interface, a record, a `BigDecimal`).

**Lesson.** A public method's *signature types* must also be public. The compiler doesn't catch this at the production class — the consumer's compile error reveals the inconsistency.

---

## Bug 9 — `protected` static method called via wrong type

```java
package com.parent;
public abstract class Parent {
    protected static int helper() { return 42; }
}

package com.child;
public class Child extends Parent {
    public int useViaParent() {
        return Parent.helper();             // ❌ compile error from outside parent package
    }
}
```

**Bug.** `Parent.helper()` is `protected static`. `Child` (in a different package) sees it via *its own type* (it inherits the static), but calling `Parent.helper()` directly is rejected — the compiler enforces "protected access through subclass type."

**Fix.** Call via the subclass's own type:

```java
return Child.helper();         // ✓ works (or even just `helper()` — implicit)
```

Or qualify with the subclass:

```java
return helper();
```

**Lesson.** `protected` static access in different packages goes through the *subclass*. The compiler's rule is rigid — the receiving type matters.

---

## Bug 10 — Public field mutated through reflection bypasses `final`

```java
public class Constants {
    public static final int MAX = 100;
}

Field f = Constants.class.getDeclaredField("MAX");
f.setAccessible(true);
f.setInt(null, 999);                        // bypasses final
System.out.println(Constants.MAX);          // could print 100 — JIT inlined the constant
```

**Bug.** `MAX` is a constant. The compiler may have *inlined* the value `100` into reading bytecode at compile time. Reflection updates the field's stored value, but inlined call sites still see `100`. Behavior is non-deterministic.

**Fix.** Don't mutate `final` fields via reflection. If a constant must be configurable, make it non-final and use `VarHandle` for atomic updates.

**Lesson.** `final` is a contract the JIT relies on for inlining. Breaking it via reflection is undefined behavior. Java 17+ flags such operations as warnings; future versions will reject them.

---

## Bug 11 — Module exports an internal package

```java
module com.lib {
    exports com.lib.api;
    exports com.lib.internal;       // ❌ leak
}
```

Now consumers can use `com.lib.internal.Helper` directly. You ship a 1.1 release that renames `Helper`. Customer apps break.

**Bug.** You exported the *implementation* package alongside the API. JPMS gave you strong encapsulation, but you opened the front door.

**Fix.**

```java
module com.lib {
    exports com.lib.api;
    // do not export internal — strong encapsulation enforced
}
```

For frameworks that need reflective access:

```java
module com.lib {
    exports com.lib.api;
    opens com.lib.internal to com.fasterxml.jackson.databind;
}
```

**Lesson.** Module `exports` decisions are part of your API. Audit them as carefully as `public` keywords.

---

## Bug 12 — Nested class shadows outer field

```java
public class Outer {
    private int counter = 10;

    public class Inner {
        private int counter = 20;            // shadows Outer.counter

        public int sum() {
            return counter;                  // ??? Inner's, Outer's?
        }
    }
}
```

**Bug.** The inner-class field `counter` shadows the outer's. `sum()` returns 20, not 30 or 10. A reader skimming the code might assume the inner accesses the outer's `counter`. Easy to misread; easy to introduce when refactoring.

**Fix.** Rename one of them (clearer for everyone) or qualify with `Outer.this.counter`:

```java
return Outer.this.counter + counter;        // 10 + 20 = 30
```

**Lesson.** Access modifiers don't prevent name *shadowing*. A nested class with the same field name as the enclosing class compiles silently. Use distinct names or qualified access.

---

## Pattern summary

| Bug type                                        | Watch for                                            |
|-------------------------------------------------|------------------------------------------------------|
| Over-public state (1, 2)                        | `public` / `protected` mutable fields                |
| Construction control (3, 5)                     | `public` constructors when you want a singleton; package-private when subclasses are needed |
| Package-related (4, 6, 9)                       | Sub-packages; tests in different packages; protected static |
| Reflection / JPMS (7, 10)                       | `setAccessible(true)`; `final` constants mutated      |
| Public/private mismatches (8, 11)               | Public APIs returning hidden types; modules exporting internals |
| Shadowing (12)                                  | Same field names across nesting                       |

These bugs come from access modifier choices that *seemed* right at the time but didn't account for downstream callers, threading, modules, or subclass behavior. Static analyzers catch many of them; code review catches more; tests confirm the rest.
