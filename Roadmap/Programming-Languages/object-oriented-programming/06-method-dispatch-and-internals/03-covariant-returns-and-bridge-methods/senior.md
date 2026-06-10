# Covariant Returns and Bridge Methods — Senior

> **What?** The full erasure story, what bridges do to vtable slots, where they trip Spring AOP and Mockito, how `MethodHandle` resolves around them, and how covariant returns interact with default methods and interfaces.
> **How?** Two things to internalise: (a) a bridge is a real method with its own slot — it is not a free alias, and (b) reflection-based frameworks that look at "the method" without filtering bridges will misbehave in subtle, environment-specific ways.

---

## 1. Erasure, recap from the dispatch angle

Type erasure (JLS §4.6) turns parameterised types into their bound at the JVM level. `Comparable<Score>.compareTo(Score)` is `Comparable.compareTo(Object)` in bytecode. `Function<String, Integer>.apply(String): Integer` is `Function.apply(Object): Object`.

Each generic interface or class has **one set of erased descriptors** that the JVM uses for dispatch. Any implementation must contribute methods with those descriptors — that's how `invokevirtual` and `invokeinterface` find a target via the vtable / itable (see [../02-vtable-and-itable/](../02-vtable-and-itable/)).

Bridges are the compiler's way to keep two contracts simultaneously:

- The **source contract**: `Score.compareTo(Score)` — what your code reads and writes.
- The **JVM contract**: `Score.compareTo(Object)` — what the JVM dispatches.

Drop either side and something breaks. Drop the source contract and you write `compareTo(Object)` everywhere with casts; drop the JVM contract and overrides don't actually override.

---

## 2. Bridges occupy real vtable slots

A common misreading: "the bridge is just a label, it shares the slot with the real method." False. The bridge is a separate method with its own descriptor, its own bytecode, its own vtable slot.

For `Score implements Comparable<Score>`:

| Slot inherited from         | Method                | Body                                  |
| --------------------------- | --------------------- | ------------------------------------- |
| Object's vtable             | `equals`, `hashCode`, etc. | unchanged                       |
| Comparable (via itable)     | `compareTo(Object)`   | bridge: checkcast + invokevirtual real |
| Score's own slot            | `compareTo(Score)`    | real implementation                   |

The `Comparable` itable entry on `Score` points at the bridge. The bridge then `invokevirtual`s the real `compareTo(Score)`. That `invokevirtual` itself is a virtual dispatch — so subclasses of `Score` overriding `compareTo(Score)` still get picked up correctly.

The JIT typically inlines the bridge body once it has profiled the call site as monomorphic. The bridge is essentially free at hot call sites. At cold call sites — class loading, startup, megamorphic dispatch — you pay one extra invocation.

---

## 3. Spring AOP and bridges — the classic intercept hole

Spring AOP uses JDK dynamic proxies or CGLIB to build a wrapper around your bean and intercept method invocations. With CGLIB, it subclasses your bean and overrides every non-final method. With JDK proxies, it wraps via `InvocationHandler`. Either way, the proxy needs to *find* the methods to intercept.

Pre-Spring 4.0 had a long-running issue (SPR-7414, SPR-9335, others) where a bridge method generated for a covariant return or generic override would be mistakenly chosen by the AOP infrastructure. The symptom: an aspect annotated with `@Around("execution(* com.acme..*())")` ran against the bridge but not against the real method, or vice versa, depending on the caller's reference type.

Spring now uses `org.springframework.core.BridgeMethodResolver` exactly to walk bridges back to their real method before applying advice. From its Javadoc:

> Helper for resolving synthetic bridge Methods to the Method being bridged. Given a synthetic bridge Method returns the Method being bridged. A bridge Method may be created by the compiler when extending a parameterized type whose methods have parameterized arguments.

If you write any framework that intercepts methods via reflection, you must call something equivalent or filter bridges explicitly. The pattern:

```java
Method actual = m.isBridge() ? BridgeMethodResolver.findBridgedMethod(m) : m;
```

Missing this is the root cause of "my `@Transactional` works on `UserService` but not on `GenericService<User>`" tickets.

---

## 4. Mockito and bridges

Mockito 1.x had real bridge-method confusion. Mockito 2.x and later (using ByteBuddy) handle the case correctly *in most situations* — but two patterns still bite:

**Pattern A: stubbing the bridge by accident.**

```java
@Mock GenericService<User> service;

@Test void test() {
    when(service.handle(any())).thenReturn("ok");   // which handle()?
}
```

If `GenericService<T>` has `String handle(T value)` and you reflect into the mock at the wrong moment, you might capture the bridge `String handle(Object)` instead of the real `String handle(User)`. Modern Mockito (≥ 3.x) routes through the bridge correctly because ByteBuddy resubclasses with the right descriptor. Pre-2.x or with custom resolvers, you may see `UnnecessaryStubbingException` because the call lands on the real method while you stubbed the bridge.

**Pattern B: `verify` not matching.**

```java
verify(service).handle(user);    // matches real method
```

If the caller used a raw-typed reference, the call actually went through the bridge; Mockito's matcher records the real method's invocation (because the bridge forwards via `invokevirtual` to the real one). Usually fine. But if the test uses `verify(service, times(1)).handle(any(Object.class))`, you may unexpectedly see two invocations recorded — the bridge frame and the real frame — depending on Mockito version and inline-mock mode.

Workaround: always use the strongly typed argument. Never call mocked methods through a raw-typed reference. Pin to a Mockito version that's verified to filter bridges correctly.

---

## 5. Default methods + covariant returns

Java 8 default methods can also be covariant-returned and bridged.

```java
public interface Cloner<T> {
    default T clone() { /* default impl */ return null; }
}

public class DogCloner implements Cloner<Dog> {
    @Override public Dog clone() { return new Dog(); }
}
```

`Cloner<T>` erases to `Object clone()`. `DogCloner.clone()` returns `Dog`. `javap -p -v DogCloner` shows:

```
public Dog clone();
  descriptor: ()LDog;
  flags: (0x0001) ACC_PUBLIC

public java.lang.Object clone();
  descriptor: ()Ljava/lang/Object;
  flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
  Code:
    0: aload_0
    1: invokevirtual #7  // Method clone:()LDog;
    4: areturn
```

Default methods don't change the rule: if an implementer narrows the type, a bridge is generated on the implementing class, not on the interface. The interface's default still has the erased descriptor.

Interface inheritance can compose: `Cloner<T>` could itself extend `Copyable<T>` with the same `T` constraint, and you'd end up with a chain. Each *implementing class* gets the bridges; intermediate interfaces never do.

---

## 6. Covariant returns through interfaces

Two interfaces with related types can refine each other:

```java
interface Animal {}
interface Dog extends Animal {}

interface Factory       { Animal make(); }
interface DogFactory extends Factory { @Override Dog make(); }
```

`DogFactory` is itself an interface; it doesn't generate bytecode for a method body, so it doesn't carry a bridge. The bridge appears on the *concrete class* that implements `DogFactory`:

```java
class LabradorFactory implements DogFactory {
    public Dog make() { return new Labrador(); }
}
```

`LabradorFactory` has two `make()` methods after compilation — the real `Dog make()` and a bridge `Animal make()` (to satisfy `Factory`). One implementing class can carry multiple bridges, one per parent abstract method whose descriptor differs from the concrete one.

The number of bridges on a leaf class equals the number of distinct *wider* signatures inherited from its supertypes. In real codebases this rarely exceeds two or three.

---

## 7. Reflection over the type system — `Method.getGenericReturnType` on bridges

`Method.getReturnType()` returns the *erased* return type (`Object` for a bridge of `compareTo`). `Method.getGenericReturnType()` returns the *signature attribute* (JVMS §4.7.9), which for bridges is empty or the erased type — bridges don't carry generic signatures.

Practical consequence: any framework that decides behaviour based on generic type information (Jackson type adapters, Gson type tokens, JAX-RS resource methods) must *avoid* bridges. The generic information lives only on the real method.

```java
for (Method m : StringToInt.class.getDeclaredMethods()) {
    if (m.isBridge()) continue;
    Type ret = m.getGenericReturnType();          // Integer, properly
    Type[]  args = m.getGenericParameterTypes();  // [String]
}
```

Without the `isBridge()` filter, you'd see `(Object) -> Object` on the bridge and `(String) -> Integer` on the real method, and depending on iteration order you'd register the wrong adapter.

---

## 8. `MethodHandle` API and bridges

`MethodHandles.Lookup.findVirtual` resolves by name + `MethodType`:

```java
MethodHandles.Lookup lookup = MethodHandles.lookup();
MethodHandle byRealType = lookup.findVirtual(Score.class, "compareTo",
    MethodType.methodType(int.class, Score.class));
MethodHandle byBridge   = lookup.findVirtual(Score.class, "compareTo",
    MethodType.methodType(int.class, Object.class));
```

Both succeed. They point to *different* methods. `byRealType` invokes the real `compareTo(Score)` directly; `byBridge` invokes the synthetic bridge, which then `invokevirtual`s the real one.

The performance difference at a hot path is nil — the JIT inlines through both — but at a cold path or under reflection-style invocation, `byBridge` pays one extra frame. If you generate `MethodHandle`s programmatically (e.g. for a record-component-based serializer), prefer the strongly typed `MethodType` so you don't accidentally route through bridges.

`MethodHandleInfo` exposes the same view: `info.getMethodType()` shows what you asked for; `info.refKindName()` tells you whether it's `invokeVirtual` or `invokeInterface`. There's no `isBridge` on `MethodHandle` itself — you have to go through `Method` first to detect it.

---

## 9. When a class file has a bridge but no source — accidental complexity

You will occasionally inherit a class with a bridge whose corresponding real method has been refactored away on a parent. This happens after binary-compatible parent changes:

- Parent v1: `Comparable<T> { int compareTo(T t); }`
- Parent v2: someone changes a sealed hierarchy and the subclass's bridge no longer matches a *currently inherited* method.

Recompiling the subclass against the new parent resolves it. But if you ship the old subclass jar against a new parent jar, you may see `AbstractMethodError`: the JVM expects a method with a descriptor that the now-mismatched subclass-bridge doesn't satisfy. Re-build everything on a binary-compatibility change. This is one of the lesser-known reasons "just upgrade the parent jar" can break consumers.

---

## 10. Generics + arrays — when bridges don't help

```java
public interface ArrayBuilder<T> {
    T[] build();
}

public class StringArrayBuilder implements ArrayBuilder<String> {
    @Override public String[] build() { return new String[0]; }
}
```

Erasure of `T[]` is `Object[]`, not `Object`. The bridge here is:

```
public java.lang.Object[] build();
  descriptor: ()[Ljava/lang/Object;
  flags: (0x1041) ACC_PUBLIC, ACC_BRIDGE, ACC_SYNTHETIC
  Code:
    0: aload_0
    1: invokevirtual #7  // Method build:()[Ljava/lang/String;
    4: areturn
```

This *works* — `String[]` is assignable to `Object[]` at the array level (covariance of arrays). But callers using the raw `ArrayBuilder` interface and treating the result as `Object[]` may later assign an `Integer` into it and get `ArrayStoreException`. That's array covariance, not a bridge bug, but the bridge is the entry point where the typed return becomes a wider array. Always parameterise the call site fully and avoid raw `ArrayBuilder`.

---

## 11. Quick rules

- [ ] Treat a bridge as a real method: it has a slot, a body, and a stack frame.
- [ ] Every framework that reflects over methods must filter bridges or resolve them back to the real method (Spring's `BridgeMethodResolver` is the reference pattern).
- [ ] Default methods don't change the bridging rules; bridges appear on *concrete classes*, never on interfaces.
- [ ] Covariant returns through interface hierarchies accumulate bridges on the leaf class — one per distinct wider descriptor.
- [ ] `MethodHandle` lookups can address the real method or the bridge directly; pick the strongly typed `MethodType`.
- [ ] Annotations are *not* copied to bridges by default (some compilers can, depending on `@Inherited` and target); reflection-based annotation scanners must walk to the bridged method.
- [ ] `AbstractMethodError` after a parent upgrade often points at a stale bridge — rebuild the subclass.

---

## 12. What's next

| Topic                                                       | File              |
| ----------------------------------------------------------- | ----------------- |
| Code review, Mockito's automatic handling, ArchUnit         | `professional.md`  |
| JLS §8.4.5, JVMS §4.6, ACC_BRIDGE                           | `specification.md` |
| Ten bugs caused by bridge methods                           | `find-bug.md`      |
| Bridge invocation cost, JIT inlining                        | `optimize.md`      |
| Hands-on exercises                                          | `tasks.md`         |
| Interview Q&A                                               | `interview.md`     |

---

**Memorize this:** a bridge is a real method with its own slot, generated to satisfy the JVM's descriptor-based dispatch when source and bytecode signatures diverge. Every reflection-based framework either filters bridges or resolves through them; Mockito, Spring AOP, Jackson, and JAX-RS all had bridge-related bugs in their early lives.
