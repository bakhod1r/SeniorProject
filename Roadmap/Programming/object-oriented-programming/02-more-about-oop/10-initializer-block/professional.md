# Initializer Block — Professional

> **What?** How `javac` compiles initializer blocks: combining static blocks + static field inits into `<clinit>`, instance blocks + field inits into the prologue of every `<init>`, and how the JVM runs them via JVMS §5.5.
> **How?** With `javap -c -v`, observe the synthesized `<clinit>` and `<init>` methods.

---

## 1. `<clinit>` synthesis

The compiler combines all static field initializers and static blocks (in source order) into a single synthetic method `<clinit>` with descriptor `()V`:

```java
class C {
    static int a = 5;
    static { System.out.println("block 1"); }
    static int b = 10;
    static { System.out.println("block 2"); }
}
```

Compiles to:

```
static {};
  Code:
     0: iconst_5
     1: putstatic     a
     4: getstatic     out
     7: ldc           "block 1"
     9: invokevirtual println
    12: bipush        10
    14: putstatic     b
    17: getstatic     out
    20: ldc           "block 2"
    22: invokevirtual println
    25: return
```

One method, statements in source order.

If the class has no static state, `<clinit>` is omitted entirely. Reading a constant variable (`static final int X = 5`) doesn't require `<clinit>`.

---

## 2. `<init>` and instance prologue

Every constructor compiles to `<init>`. The compiler inserts:
1. The implicit/explicit `super(...)` or `this(...)` call (the very first statement).
2. (Only for `super(...)` paths, not `this(...)`): the *instance prologue* — instance field initializers and instance blocks, in source order.
3. The constructor body.

```java
class C {
    int a = 5;
    { System.out.println("block 1"); }
    int b = 10;
    C() { System.out.println("ctor"); }
}
```

```
public C();
  Code:
     0: aload_0
     1: invokespecial Object.<init>
     4: aload_0
     5: iconst_5
     6: putfield      a
     9: getstatic     out
    12: ldc           "block 1"
    14: invokevirtual println
    17: aload_0
    18: bipush        10
    20: putfield      b
    23: getstatic     out
    26: ldc           "ctor"
    28: invokevirtual println
    31: return
```

The instance prologue is duplicated into every constructor that ends in `super(...)` or has no explicit one. Constructors that delegate via `this(...)` skip the prologue (because the target ctor has it).

---

## 3. JVMS §5.5 — class initialization

> A class or interface T may be initialized only as a result of:
> - A new of T...
> - getstatic/putstatic for a non-final field of T (or for a final field initialized to a non-constant)
> - invokestatic of a method declared by T
> - Initialization of a subclass of T
> - T being designated as the initial class on JVM startup
> - T containing assert statement (if T is a top-level class)

The JVM uses a per-class lock to ensure at-most-once initialization. The 12-step algorithm in JLS §12.4.2 describes the synchronization protocol.

---

## 4. The class init state machine

```
┌─────────────┐
│ unloaded    │
└─────────────┘
       ↓ load
┌─────────────┐
│ verified    │
└─────────────┘
       ↓ first trigger
┌─────────────┐
│ initializing│ — only one thread; others wait
└─────────────┘
       ↓ <clinit> succeeds         ↓ <clinit> fails
┌─────────────┐         ┌─────────────────────┐
│ initialized │         │ erroneous           │
└─────────────┘         └─────────────────────┘
                          subsequent access:
                          NoClassDefFoundError
```

---

## 5. Constant variables don't trigger init

A *constant variable* (JLS §4.12.4) is a `final` variable of primitive type or `String` initialized to a constant expression. Such variables are inlined at compile time:

```java
class A {
    public static final int X = 42;
    static { System.out.println("init"); }
}

System.out.println(A.X);   // doesn't print "init" — X inlined as 42
```

This is why constant interfaces don't trigger initialization on read. Useful and surprising.

---

## 6. Erroneous classes

If `<clinit>` throws (checked or unchecked), the JVM marks the class erroneous. The first throw is wrapped in `ExceptionInInitializerError`. Subsequent attempts to use the class throw `NoClassDefFoundError`.

```java
class Bad {
    static { throw new RuntimeException("boom"); }
}

try { new Bad(); } catch (Throwable t) {
    System.out.println(t);   // ExceptionInInitializerError: RuntimeException("boom")
}

try { new Bad(); } catch (Throwable t) {
    System.out.println(t);   // NoClassDefFoundError: Could not initialize class Bad
}
```

The original cause is in the first error; you can't get it from the second.

---

## 7. Instance prologue inlining

The instance prologue (field inits + blocks) is duplicated into every constructor that ends in `super(...)`. Constructors that delegate via `this(...)` don't get the prologue (the target has it).

```java
class C {
    int a = 5;
    C() { this(0); }              // skips prologue
    C(int x) { /* this is the target — has prologue */ }
}
```

Bytecode of `C()`:
```
0: aload_0
1: iconst_0
2: invokespecial C.<init>(I)V
5: return
```

No `a = 5` here; it's in `C(int)`.

---

## 8. Initializer blocks and `<init>` resolution

The JVM's `<init>` is what `invokespecial` calls. The verifier requires the first instruction to be `aload_0` followed by an `invokespecial` to a `<init>` of the same class (this(...)) or superclass (super(...)). After that, the prologue and constructor body run.

The instance state is "uninitializedThis" until super() returns; reading or writing fields before that is a verifier error.

---

## 9. Anonymous instance initializer (double-brace)

```java
Map<String, Integer> m = new HashMap<>() {{
    put("a", 1);
}};
```

The `{}}` creates an anonymous subclass with an instance initializer. The block is part of `<init>` for the anonymous class.

In bytecode:
- A new anonymous class file is created (e.g., `Outer$1.class`).
- It has `extends HashMap` and an `<init>` that calls `put("a", 1)`.
- Each use site allocates a new instance.

This pattern bloats class count and pins outer references — avoid in modern code.

---

## 10. Static block and enum constants

```java
public enum Day { MON, TUE, WED;
    static { System.out.println("Day init"); }
}
```

The `<clinit>` for `Day` runs:
1. Construct each constant via `Day.<init>("MON", 0)`, `Day.<init>("TUE", 1)`, ...
2. Run the static block.

If a constant's constructor depends on another constant (rare), there can be ordering issues. Generally, avoid forward references between constants.

---

## 11. JIT and `<clinit>`

The JIT compiles `<clinit>` like any other method. Since `<clinit>` runs once per class, it's rarely a JIT priority. Heavy work in `<clinit>` runs in interpreted mode if the class is loaded only once.

For performance-critical init, you might want to defer to a lazy method that runs hot enough to JIT-compile.

---

## 12. Where the spec says it

| Topic                              | Source            |
|------------------------------------|-------------------|
| Class initialization triggers       | JLS §12.4.1       |
| Initialization procedure (12 steps) | JLS §12.4.2       |
| Static initializers                 | JLS §8.7          |
| Instance initializers               | JLS §8.6          |
| Forward references                  | JLS §8.3.3         |
| `<clinit>` and `<init>` in bytecode | JVMS §2.9          |
| Class state transitions             | JVMS §5.5          |
| `ExceptionInInitializerError`       | `java.lang.ExceptionInInitializerError` Javadoc |

---

**Memorize this**: `<clinit>` is synthesized from all static parts in source order, runs once per class load, thread-safe by JVM lock. `<init>` includes the instance prologue (field inits + blocks) for ctors that end in `super(...)`. Failed static init poisons the class. Reading constant variables doesn't trigger init.
