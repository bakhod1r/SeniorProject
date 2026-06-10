# Method Chaining — Professional

> **What?** What `return this` looks like in bytecode, how the JIT inlines fluent setters, how the Stream API constructs and fuses a pipeline, and how `invokedynamic`-based DSLs avoid building tens of thousands of types.
> **How?** Disassemble with `javap -c`, watch JIT events with `-XX:+PrintInlining`, study the JDK's `AbstractPipeline` source for stream internals.

---

## 1. `return this` at the bytecode level

```java
class Builder {
    int x;
    public Builder x(int v) { this.x = v; return this; }
}
```

```
public Builder x(int);
  Code:
     0: aload_0          // this
     1: iload_1          // v
     2: putfield #2      // x
     5: aload_0          // this
     6: areturn
```

Six bytecodes. The JIT inlines and folds: at hot call sites, the body becomes a single field store with no return overhead.

---

## 2. Bytecode of a chained call site

```java
new Builder().x(1).y(2).build();
```

```
0: new Builder
3: dup
4: invokespecial Builder.<init>
7: iconst_1
8: invokevirtual Builder.x
11: iconst_2
12: invokevirtual Builder.y
15: invokevirtual Builder.build
```

Each `invokevirtual` consumes the receiver pushed by the previous `areturn`. The chain is just a sequence of stack-balanced calls.

---

## 3. JIT inlining

For:
```java
new Builder().x(1).y(2).build()
```

The JIT inlines `Builder.x` and `Builder.y` because they're tiny and (post-warmup) monomorphic. The result is roughly equivalent to:
```java
Builder b = new Builder();
b.x = 1;
b.y = 2;
b.build();
```

If `Builder` is `final` and never escapes, EA may scalarize the entire builder — no allocation at all.

---

## 4. Stream pipeline internals

A `Stream<T>` is implemented as a chain of `AbstractPipeline` nodes. Each intermediate operation creates a new pipeline node referencing the previous one:

```
list.stream()                          // ReferencePipeline.Head
    .filter(p)                          // StatelessOp wrapping the filter
    .map(f)                             // StatelessOp wrapping the map
    .toList();                          // TerminalOp
```

Calling the terminal op walks the chain, builds a `Sink<T>` wrapper that combines all stages, then iterates the source through the sink. The JIT often inlines the entire sink chain into one method body, producing a tight loop.

---

## 5. `Spliterator` as the source

A `Spliterator` is a `next + split` iterator. The stream pipeline wraps the source spliterator and pulls elements through the sink chain:

```java
Spliterator<T> src = list.spliterator();
src.forEachRemaining(t -> sink.accept(t));
```

The sink contains the filter, map, and collector logic. The JIT can sometimes inline `forEachRemaining` and the sink, producing zero-allocation streaming.

---

## 6. `invokedynamic` for DSLs

DSLs that generate type-safe APIs at compile time often use `invokedynamic` for late-binding the generated methods. Examples: jOOQ, kotlinx.serialization (in Kotlin), Spring AOP proxies.

For chained method calls, indy reduces the number of bytecode call sites by indirecting through a bootstrap method that returns a method handle for the actual operation.

---

## 7. Lambda capture and chains

```java
String prefix = "X";
list.stream().filter(s -> s.startsWith(prefix)).count();
```

The lambda captures `prefix`. The compiler emits an `invokedynamic` with `LambdaMetafactory.metafactory`. At first call, a hidden class is generated implementing `Predicate<String>`. The hidden class has a `prefix` field set at construction.

Each call to `filter(...)` allocates one instance of this hidden class. In a loop:

```java
for (Item it : items) {
    items.stream().filter(s -> s.startsWith(it.prefix())).count();
}
```

Each iteration allocates a new lambda. The JIT's escape analysis often eliminates this, but not always.

---

## 8. Records and chained `with` methods

JEP 468 (preview) proposes:
```java
record User(String name, int age) {}
User v2 = user.with(age=31);
```

Until that lands, manual `withX` methods compile to:
```
public User withAge(int);
  Code:
     0: new User
     3: dup
     4: aload_0
     5: getfield name
     8: iload_1
     9: invokespecial User.<init>
    12: areturn
```

Each `withX` allocates a new record. The JIT can scalarize when the record doesn't escape.

---

## 9. Generic self-types

For self-typed builders like `Animal<T extends Animal<T>>`, the bytecode uses bridge methods for type-erased call sites:

```java
class Animal<T extends Animal<T>> {
    public T name(String n) { return (T) this; }
}
class Dog extends Animal<Dog> {
    public Dog bark() { return this; }
}
```

```
Dog class file:
  public Dog name(String);    // bridge — calls Animal.name and casts to Dog
  public Animal name(String); // (after erasure) inherited from Animal
```

The bridge allows callers expecting `Dog` (after `name()`) to get back a `Dog`, even though the inherited method's erased return is `Animal`.

---

## 10. CompletableFuture chains

Each `thenX` call wraps the existing future in a new one. Example:

```java
CompletableFuture<A> a = ...;
CompletableFuture<B> b = a.thenApply(this::toB);
CompletableFuture<C> c = b.thenCompose(this::toC);
```

Internally, each step creates a `Completion` node attached to the previous future. When the source completes, the completion chain fires, executing each step.

Allocation per chain step: ~3 objects (Completion node + Function wrapper + result). For high-throughput async pipelines, this adds up. Reactor's `Mono`/`Flux` tend to be more efficient at scale.

---

## 11. Optional chains in bytecode

```java
opt.map(f).map(g)
```

```
0: aload_1
1: getstatic Optional$Empty / getstatic Optional$Some
4: ...
```

`Optional.map` allocates a new `Optional`. The JIT often eliminates this via EA if the resulting Optional is consumed inline.

For long chains in hot paths, the per-step allocation can dominate. Manual null checks are sometimes faster but uglier.

---

## 12. Stream `toList()` (Java 16+)

`Stream.toList()` (newer than `Collectors.toList()`) returns an unmodifiable List. Internally it allocates a sized array, drains the stream into it, then wraps in `ImmutableCollections.ListN`.

Faster than `collect(Collectors.toList())` because it skips the Collector machinery.

---

## 13. Reading the JIT's view

```bash
java -XX:+UnlockDiagnosticVMOptions \
     -XX:+PrintCompilation \
     -XX:+PrintInlining \
     -XX:+PrintFlagsFinal MyApp 2>&1 | grep -E '(stream|filter|map|build)'
```

Look for:
- `inline (hot)` on chain methods → JIT collapses them
- `failed: callee is too large` → method too big to inline
- `failed: not inlineable` → some other reason; investigate

---

## 14. Where the spec touches chains

| Concept                        | Source                       |
|--------------------------------|------------------------------|
| Method invocation expressions   | JLS §15.12                  |
| `invokevirtual`/`invokeinterface` | JVMS §6.5                |
| Lambda metafactory              | `java.lang.invoke.LambdaMetafactory` |
| Stream contract                 | `java.util.stream.Stream` Javadoc |
| Optional contract               | `java.util.Optional` Javadoc |
| Records (JEP 395)               | JLS §8.10                   |
| Pattern matching                | JLS §14.30                  |

---

**Memorize this**: chains are bytecode sequences of stack-balanced calls; `return this` is six bytecodes. The JIT inlines the typical setter chain into direct field stores. Streams pipe through Spliterator/Sink; the JIT often fuses them into a single loop. Lambdas use indy + hidden classes; capturing lambdas allocate per call. Read `javap -c` and `-XX:+PrintInlining` to see what your chains compile to.
