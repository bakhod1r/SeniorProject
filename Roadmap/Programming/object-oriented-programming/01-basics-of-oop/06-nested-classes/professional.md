# Nested Classes — Professional (Under the Hood)

> **What's actually happening?** Nested classes compile to *separate* `.class` files (`Outer$Inner.class`, `Outer$1.class` for anonymous), with the parent recorded in the `InnerClasses` attribute. Inner classes carry a synthetic `this$0` field referring to the outer instance. Lambdas use `invokedynamic` + `LambdaMetafactory` to generate a hidden class lazily at runtime. Nest mates (Java 11+) eliminated the synthetic-bridge tax for cross-class private access.

---

## 1. One nested class = one class file

Compiling:

```java
public class Outer {
    public static class Helper { }
    public class Inner { }
    void method() {
        class Local { }
        Runnable r = new Runnable() { public void run() {} };
    }
}
```

Produces:

```
Outer.class
Outer$Helper.class       // static nested
Outer$Inner.class         // inner class
Outer$1Local.class         // local class
Outer$1.class              // anonymous class (numbered per outer)
```

Each is a regular `.class` file — the JVM doesn't have a "nested class" concept. The relationship is recorded via class file attributes.

The `$` separator is purely a `javac` convention. The JVM treats `Outer$Inner` as a class name like any other.

---

## 2. The `InnerClasses` attribute

Every class that contains nested types — and every class that *is* a nested type — has an `InnerClasses` attribute (JVMS §4.7.6):

```
InnerClasses_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 number_of_classes;
    {   u2 inner_class_info_index;        // pool index of the inner class
        u2 outer_class_info_index;         // pool index of the outer (or 0 for local/anon)
        u2 inner_name_index;                // simple name (or 0 for anonymous)
        u2 inner_class_access_flags;        // ACC_PUBLIC, ACC_PRIVATE, etc.
    } classes[number_of_classes];
}
```

Inspecting with `javap -v Outer.class` shows:

```
InnerClasses:
    public static #2= #4; //Helper=class Outer$Helper
    public #5= #7 of #1; //Inner=class Outer$Inner of class Outer
```

This attribute is what reflection uses for `Class.getDeclaredClasses()`, `Class.getEnclosingClass()`, etc.

---

## 3. The synthetic `this$0` field

A non-static inner class has a synthetic field:

```java
public class Outer {
    private int x;
    public class Inner {
        public int getX() { return x; }   // accesses Outer.this.x
    }
}
```

Compiles to:

```
public class Outer$Inner {
    final synthetic Outer this$0;          // the synthetic outer reference

    Outer$Inner(Outer outer) {              // synthetic constructor parameter
        this$0 = outer;
        super();
    }

    public int getX() {
        return this$0.x;
    }
}
```

The synthetic field name `this$0` is a `javac` convention. It's `final` (set once in the constructor) and `synthetic` (flag in the field info).

`Outer.this` in source code compiles to `this$0` in bytecode.

---

## 4. Anonymous classes: name and shape

Anonymous classes get auto-generated names: `Outer$1`, `Outer$2`, etc. — numbered per enclosing class.

```java
public class Outer {
    void method() {
        Runnable r = new Runnable() {
            public void run() { System.out.println("hi"); }
        };
    }
}
```

Compiles to a class `Outer$1`:

```
final class Outer$1 implements Runnable {
    final synthetic Outer this$0;        // captures Outer instance

    Outer$1(Outer outer) {
        this$0 = outer;
        super();
    }

    public void run() { System.out.println("hi"); }
}
```

The constructor takes the captured outer instance. If the anonymous class captures locals (e.g., a method parameter), those become additional constructor parameters and synthetic fields.

---

## 5. Captured locals in anonymous and local classes

```java
public class Outer {
    void method(String prefix) {
        Runnable r = new Runnable() {
            public void run() { System.out.println(prefix); }
        };
    }
}
```

Compiles to:

```
final class Outer$1 implements Runnable {
    final synthetic Outer this$0;
    final synthetic String val$prefix;     // captured

    Outer$1(Outer outer, String prefix) {
        this$0 = outer;
        val$prefix = prefix;
        super();
    }

    public void run() { System.out.println(val$prefix); }
}
```

The captured `prefix` becomes a synthetic constructor parameter and a final field. This is why captured locals must be effectively final — the field is final.

---

## 6. Lambdas: not actually nested classes

A lambda is *not* a nested class. It compiles to:

1. A static method on the enclosing class containing the lambda body.
2. An `invokedynamic` instruction at the lambda's site, referencing the static method via `LambdaMetafactory.metafactory`.

First time the `invokedynamic` is executed, the bootstrap creates a *hidden class* implementing the target functional interface. Subsequent uses get a cached reference to that class.

```java
Runnable r = () -> System.out.println("hi");
```

Compiles approximately to:

```
private static synthetic void lambda$0() {
    System.out.println("hi");
}

// at the assignment site:
invokedynamic #N{ ..., bootstrap=LambdaMetafactory.metafactory }
```

The hidden class is generated at runtime. It can be unloaded if its `MethodHandles.Lookup` becomes unreachable. This is how lambdas avoid the metaspace leak that plagued early bytecode-generation tools.

---

## 7. Lambda capture: scalar replacement

If a lambda captures local state, the synthetic class has fields for the captured values. But the JIT often eliminates the allocation entirely:

```java
public int sum(List<Integer> nums, int multiplier) {
    return nums.stream().mapToInt(n -> n * multiplier).sum();
}
```

The lambda captures `multiplier`. The JIT:

1. Inlines the lambda body at the `mapToInt` call site.
2. Performs *escape analysis* — proves the captured-state object never escapes.
3. *Scalar-replaces* — stores `multiplier` in a register/stack slot instead of a heap allocation.

The result: no heap allocation per lambda use. Confirm with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations`.

For anonymous classes, the JIT cannot do this — the class is real, the allocation is real.

---

## 8. Nest mates (JEP 181)

Pre-Java 11, cross-class `private` access required compiler-generated bridge methods:

```java
// Pre-11:
public class Outer {
    private int counter;
    static int access$008(Outer o) { return o.counter++; }   // synthetic bridge
    public class Inner {
        void increment() { Outer.access$008(this$0); }
    }
}
```

The bridge:

- Was `package-private` (so `Inner` could call it).
- Cluttered the class file.
- Showed up in stack traces and reflection.

JEP 181 (Java 11+) introduced **nest mates**. Two new attributes:

- `NestHost` (on each nest member): index of the nest host class.
- `NestMembers` (on the nest host): list of nest member classes.

The verifier accepts cross-class `private` access between nest mates without bridges.

```java
// Post-11:
public class Outer {
    private int counter;
    public class Inner {
        void increment() { this$0.counter++; }   // direct access, no bridge
    }
}
```

The class file shows `NestMembers: Outer$Inner` on `Outer`, and `NestHost: Outer` on `Outer$Inner`.

---

## 9. Local classes inside generic methods

```java
public class Outer {
    public <T> List<T> uniqueOf(List<T> in) {
        class Seen {
            Set<T> values = new HashSet<>();
            boolean add(T t) { return values.add(t); }
        }
        Seen seen = new Seen();
        return in.stream().filter(seen::add).toList();
    }
}
```

The local class `Seen` is generic over the enclosing method's type parameter `T`. The compiler captures `T`'s erasure — `Seen$T` is `Object` after erasure.

Nested generics work, with the same erasure caveats as other generic code.

---

## 10. The `EnclosingMethod` attribute

For local and anonymous classes, the class file has an `EnclosingMethod` attribute (JVMS §4.7.7):

```
EnclosingMethod_attribute {
    u2 attribute_name_index;
    u4 attribute_length;
    u2 class_index;        // enclosing class
    u2 method_index;       // enclosing method (or 0 if not in a method)
}
```

Reflection uses this for `Class.getEnclosingMethod()`. Useful for debugging — you can ask "which method declared this anonymous class?"

For anonymous classes inside a constructor, `getEnclosingMethod()` returns null (constructors aren't methods); use `getEnclosingConstructor()` instead.

---

## 11. Reflection API for nested types

```java
Outer.class.getDeclaredClasses()       // direct nested classes (NOT including inherited)
Outer.class.getClasses()               // public nested classes (including inherited)
Outer.Inner.class.getEnclosingClass() // returns Outer.class
Outer.class.getEnclosingMethod()       // null for top-level; method object for local/anon
Outer.class.getNestHost()              // the nest leader (Outer for itself)
Outer.class.getNestMembers()           // array of all nest members
Outer.class.isAnonymousClass()         // true for anonymous
Outer.class.isLocalClass()             // true for local
Outer.class.isMemberClass()            // true for static nested or inner
```

These reflect the various class file attributes. Frameworks like Jackson use them to decide how to handle nested types in serialization.

---

## 12. Performance: lambda vs anonymous class

Microbenchmark (JMH):

```java
@Benchmark
public Runnable lambda() {
    int captured = state;
    return () -> work(captured);    // typically scalar-replaced
}

@Benchmark
public Runnable anonymous() {
    int captured = state;
    return new Runnable() {          // always allocates
        public void run() { work(captured); }
    };
}
```

Typical results:

- Lambda: ~5 ns/op, ~0 bytes allocated per call.
- Anonymous: ~15 ns/op, ~24 bytes allocated per call.

For high-throughput code, lambdas are decisively faster. For one-shot listeners or rare callbacks, the difference is invisible.

---

## 13. Memory layout of inner classes

Object layout for an inner-class instance (with compressed oops):

```
offset  size
   0    12   object header
  12     4   this$0 (compressed reference to outer)
  16     ?   instance fields...
```

So an inner class adds 4 bytes (compressed) or 8 bytes for the outer reference, plus padding. For a tree of small inner-class objects, this can add up.

A `static` nested class has the same layout as a top-level class — no `this$0`.

---

## 14. Hidden classes and lambdas

JEP 371 (Java 15+) introduced *hidden classes* — classes the JVM doesn't link to a name in any class loader. Lambda implementations are hidden classes.

Properties:

- Cannot be referenced by name from bytecode.
- Have a defined `MethodHandles.Lookup` that's the only handle to them.
- Can be unloaded when their lookup is GC'd.
- Listed via `Class.isHidden()` (Java 15+).

The lambda use case: each lambda's synthetic implementation is a hidden class, generated lazily, unloadable. This solves a long-standing issue (every lambda used to leak metaspace until JEP 371).

---

## 15. Tools you should know

| Tool                                | What it shows                                         |
|-------------------------------------|-------------------------------------------------------|
| `javap -v Outer.class`              | InnerClasses, NestHost, NestMembers attributes          |
| `Class.getDeclaredClasses()`        | Reflection-level nested types                          |
| `Class.getNestMembers()`            | Java 11+ nest membership                              |
| `-XX:+UnlockDiagnosticVMOptions -XX:+PrintEliminateAllocations` | Confirms scalar replacement of lambdas |
| `-Xlog:class+load`                   | Shows hidden classes being defined                    |
| JFR `jdk.ObjectAllocationInNewTLAB`  | Allocation hotspots from anonymous-class instances    |
| JOL `ClassLayout.parseClass(...)`    | Object layout including `this$0`                       |

---

## 16. Professional checklist

For each nested type:

1. What does `javap` show? Confirm the class file shape matches your source intent.
2. For non-static inner: is the `this$0` retention intentional?
3. For anonymous classes: would a lambda fit? Is the JIT scalar-replacing?
4. For lambdas: is escape analysis succeeding? Confirm with `-XX:+PrintEliminateAllocations`.
5. For local classes: is generic capture causing erasure surprises?
6. For sealed nested: is `permits` complete and the switch exhaustive?
7. For private nested: is reflection-based access (Jackson, etc.) properly configured for JPMS?
8. For lambda hot paths: is the bootstrap call cached? (It is, after the first invocation.)
9. For nest mates: is your build target Java 11+? Older targets emit synthetic bridges.
10. Memory: any inner classes retaining heavy outer instances?

Professional nested-class use is *informed* by what the compiler and JVM actually do — not by folklore. Each form has a measurable cost (allocation, retention, dispatch); the right form depends on the call pattern and lifetime.
