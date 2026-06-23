# Initializer Block — Find the Bug

Twelve buggy snippets. Each compiles. Each is wrong because of an init-block misuse.

---

## Bug 1 — Forward reference

```java
class C {
    int x = y;     // ERROR
    int y = 5;
}
```

**Why?** Forward reference rule (JLS §8.3.3). Reading a field by simple name before its declaration is illegal in initializer expressions.

**Fix:** reorder, or use a constructor:
```java
class C {
    int y = 5;
    int x = y;
}
```

---

## Bug 2 — Heavy work in static block

```java
class Service {
    static final Connection CONN;
    static {
        CONN = DriverManager.getConnection("jdbc:postgres://localhost/db", "user", "pass");
    }
}
```

**Why?** If DB is unreachable at startup, `<clinit>` throws. Class becomes erroneous; service can't start. Hard to diagnose.

**Fix:** lazy init via factory or holder:
```java
class Service {
    private static volatile Connection conn;
    public static Connection conn() {
        if (conn == null) {
            synchronized (Service.class) {
                if (conn == null) conn = DriverManager.getConnection(...);
            }
        }
        return conn;
    }
}
```

---

## Bug 3 — Static block referencing instance

```java
class C {
    int x = 5;
    static {
        System.out.println(x);   // ERROR — no instance during class init
    }
}
```

**Why?** No `this` exists during class initialization.

**Fix:** static block can only reference static state.

---

## Bug 4 — Instance block throws checked exception

```java
class C {
    InputStream in;
    {
        in = new FileInputStream("data.txt");   // ERROR — IOException not declared
    }
}
```

**Why?** Instance block can throw checked exceptions only if every constructor of the class declares them.

**Fix:** declare in constructors:
```java
class C {
    InputStream in;
    {
        try { in = new FileInputStream("data.txt"); }
        catch (IOException e) { throw new RuntimeException(e); }
    }
}
```

Or move to constructor and declare `throws IOException`.

---

## Bug 5 — Static block running before subclass constructor

```java
class Parent {
    static int counter = 0;
    static { System.out.println("Parent static"); }
}
class Child extends Parent {
    static int childCounter = Parent.counter;   // 0
    static { System.out.println("Child static"); }
}

new Child();
```

Output:
```
Parent static
Child static
```

The bug isn't here per se, but: developers sometimes assume Child's static can run before Parent's. It can't. Parent always initializes first.

If you depend on a specific order, document it clearly.

---

## Bug 6 — `this()` skipping instance block

```java
class C {
    int a;
    { System.out.println("instance block"); a = 1; }
    C() { this(0); System.out.println("no-arg"); }
    C(int x) { System.out.println("int x=" + x); }
}

new C();
```

Output:
```
instance block
int x=0
no-arg
```

Note that the block ran via the int constructor, not the no-arg one. This is the prologue skip rule for `this(...)`.

**Why?** Instance blocks are only included in the `<init>` whose first statement is `super(...)`. Constructors that delegate via `this(...)` skip the prologue.

If you want the block to run "every time," ensure it does — usually it does, since the chain ends in a `super(...)` constructor.

---

## Bug 7 — Static block side effects in tests

```java
class Logger {
    static { LogManager.configure(...); }
}
```

**Why?** Tests load classes in unpredictable order. If Logger is loaded after another class that depends on a different config, behavior differs.

**Fix:** explicit setup in tests; don't rely on static blocks for cross-class config.

---

## Bug 8 — `final` field not initialized in all paths

```java
class C {
    final int x;
    {
        if (Math.random() > 0.5) x = 1;
    }
}
```

**Why?** `final` field must be definitely assigned in every constructor. The `if` may not execute, leaving x unassigned.

**Fix:** assign unconditionally:
```java
{ x = Math.random() > 0.5 ? 1 : 0; }
```

---

## Bug 9 — Double-brace pinning outer

```java
class Outer {
    private final byte[] data = new byte[1_000_000];
    public Map<String, Integer> getMap() {
        return new HashMap<>() {{
            put("a", 1);
        }};
    }
}
```

**Why?** Each call to `getMap` creates an anonymous subclass instance. The instance holds an implicit reference to `Outer`, pinning the 1 MB `data` array.

**Fix:** use `Map.of(...)`:
```java
public Map<String, Integer> getMap() {
    return Map.of("a", 1);
}
```

---

## Bug 10 — Static block reference to constant

```java
class A {
    static { System.out.println("A init"); }
}
class B {
    static final int X = A.someInt();   // (some non-constant call)
}

System.out.println(B.X);   // triggers B's init, which triggers A's
```

If you intended `X` to be a constant variable that doesn't trigger A's init, this won't work because `someInt()` isn't a constant expression.

**Fix:** if `X` is meant to be a constant, use a literal value. If it depends on A, accept that A will be initialized.

---

## Bug 11 — Initializer block trying to use parameter

```java
class C {
    int x;
    {
        x = arg;   // ERROR — no `arg` in scope
    }
    C(int arg) { /* ... */ }
}
```

**Why?** Constructor parameters are local to the constructor, not the instance block.

**Fix:** assign in the constructor:
```java
C(int arg) { this.x = arg; }
```

---

## Bug 12 — Static block with `<clinit>` deadlock

```java
class A {
    static { B.foo(); }
    static int a = 1;
}
class B {
    static { A.foo(); }
    static int b = 2;
    static int foo() { return 0; }
}
```

If two threads simultaneously trigger `A` and `B`, they may deadlock waiting for each other's `<clinit>`.

**Why?** Class initialization holds per-class locks; circular dependencies can deadlock.

**Fix:** avoid circular static dependencies. Refactor so init order is clear and acyclic.

---

## Pattern recap

| Bug | Family                             | Cure                                |
|-----|------------------------------------|-------------------------------------|
| 1   | Forward reference                   | Reorder declarations                |
| 2   | Heavy/fragile work in static block  | Lazy init                            |
| 3   | Static block reads instance         | Use only static state                |
| 4   | Instance block checked exception     | Wrap or declare in ctors             |
| 5   | Init order assumption                | Document and rely on parent-first    |
| 6   | `this()` skips prologue              | Aware of skip; restructure if needed |
| 7   | Static block as test config          | Explicit setup                       |
| 8   | `final` not assigned in all paths    | Unconditional assignment             |
| 9   | Double-brace pinning outer            | Use `Map.of`                        |
| 10  | Constant variable rule misunderstood | Use literal values                   |
| 11  | Block referencing parameter          | Move to constructor                  |
| 12  | Circular static dependency            | Break the cycle                      |

---

**Memorize the shapes**: most init-block bugs are about timing assumptions, scope, or parametric mismatches. Static blocks run at class init (once); instance blocks run per `new`. Forward references and parameter scope are common pitfalls. Don't put fragile work in static blocks.
