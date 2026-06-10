# Attributes and Methods — Interview

> 50+ questions covering attributes (fields) and methods at every level. Answers are short enough to give in a real interview but specific enough to demonstrate depth. Each tier escalates from "knows the syntax" to "understands the JVM mechanics."

---

## Junior (1–15)

### Q1. What's the difference between an attribute (field) and a local variable?
A field is per-object state declared inside the class body and stored on the heap inside the object. A local variable is declared inside a method and lives on the call stack until the method returns. Fields receive default values (`0`, `null`, `false`); locals must be definitely assigned before use.

### Q2. What is the default value of an `int` field vs. a local `int`?
A field defaults to `0`. A local `int` has no default — using it without assignment is a compile error. Same rule for all primitives, references default to `null` only as fields.

### Q3. What's the difference between an instance method and a static method?
Instance methods belong to objects and have an implicit `this`; you call them as `obj.method()`. Static methods belong to the class itself, have no `this`, and are called as `Class.method()`. Static methods can't access instance fields.

### Q4. What is a method signature?
The method's name plus the ordered list of parameter types. Return type and exception list are *not* part of the signature for overload resolution. Two methods can coexist in one class only if their signatures differ.

### Q5. Is Java pass-by-value or pass-by-reference?
Always pass-by-value. For object types, the *value* being passed is the reference (a copy). Mutations *through* the reference are visible to the caller; reassigning the parameter is not.

### Q6. What's the difference between overloading and overriding?
- **Overloading**: same name, different signatures, in the same class. Resolved at compile time by static argument types.
- **Overriding**: same signature, in a subclass, replacing the superclass implementation. Resolved at runtime by the receiver's actual class.

### Q7. Can you override a `static` method?
No — `static` methods are not virtual. You can *hide* a static method by declaring one with the same signature in a subclass, but the resolution is at compile time based on the static type of the reference.

### Q8. What does `final` mean on a field?
The field must be assigned exactly once (at declaration, in an instance initializer, or in every constructor path). After that, it cannot be reassigned. `final` reference fields enable the JMM's safe-publication guarantee for immutable objects.

### Q9. What's the convention for getter and setter naming?
- Getter: `getXxx()` for objects/primitives, `isXxx()` (or `hasXxx`, `canXxx`) for booleans.
- Setter: `setXxx(value)`, returning `void`.
- For records: the accessor is the component name with no prefix (`point.x()`, not `point.getX()`).

### Q10. What's wrong with public fields?
You lose the ability to enforce invariants, validate, change the representation, or add behavior on access. A public field is a permanent commitment to a specific data shape. Use private fields with getters/setters (or, better, a record).

### Q11. Can a method have no return statement?
Yes — `void` methods don't need one (you can use `return;` to exit early). Non-`void` methods must return on every path; falling off the end is a compile error.

### Q12. What is the difference between `this` and `super`?
- `this` refers to the current instance.
- `super` refers to the same instance but resolves names in the superclass's scope (use it to call the superclass's method or constructor).

`this()` calls another constructor of the same class. `super()` calls a superclass constructor. Either, if explicit, must be the first statement of the constructor.

### Q13. Can you have a private constructor?
Yes. It prevents direct instantiation from outside the class. Common uses: utility classes (`Math`, `Collections`) prevent instantiation; static factory methods control construction; singletons.

### Q14. Why might a `static` field be initialized to a different value than what you wrote?
The JLS distinguishes the *preparation* phase (defaults are written) from *initialization* (`<clinit>` runs the field initializers and `static {}` blocks). Static initializers run in source order, so a forward reference to a later-declared static may see the default value, not the initialized one.

### Q15. What happens if you write `void` before a constructor?
It becomes a regular method named the same as the class — not a constructor. Calling `new MyClass()` then refuses to compile because the no-arg constructor is missing or you'd see strange behavior (the void method never runs at all).

---

## Middle (16–30)

### Q16. What is Command-Query Separation (CQS)?
A discipline where every method is *either* a query (returns a value, no side effects) *or* a command (mutates state, returns void). Mixing both — a method that mutates and returns — makes the API harder to reason about because callers can't tell from the signature alone what's safe to call.

### Q17. Why is overloading on `int` vs `Integer` a bad idea?
Overload resolution uses three phases: strict (no boxing) → loose (boxing/unboxing) → varargs. `add(0)` always picks `add(int)` because it's an exact match in phase 1. Calling the `Integer` overload requires an explicit cast or `Integer.valueOf(0)` — surprising, easy to get wrong (canonical example: `List.remove(int)` vs `remove(Object)`).

### Q18. How do you choose between returning `Optional`, an empty collection, or throwing?
- `Optional<T>` for "this query may have no result; that's normal."
- Empty collection for "zero is just a possible answer."
- Exception when "no result" is exceptional or indicates programmer error.

Don't use `Optional` for collection-shaped results. Don't use `null` as a sentinel — pick one of the three explicitly.

### Q19. What is the "tell, don't ask" principle?
Instead of asking an object for its data and computing the decision, *tell* the object what to do and let it compute. Replaces:
```java
if (account.balance() >= amount) account.setBalance(account.balance() - amount);
```
with `account.withdraw(amount)`. The advantage is atomicity, encapsulation of rules, and a clearer call site.

### Q20. When should you mark a method `final`?
- Security-sensitive methods that subclasses must not override.
- Template-method base methods that must enforce the structure.
- Hot methods on a class that you've decided isn't intended to be subclassed (helps the JIT — though the win is small).

If the class itself is `final`, marking individual methods `final` is redundant.

### Q21. What's the difference between `final` and `effectively final`?
A `final` variable is explicitly declared so. An *effectively final* variable is one that's never reassigned after initialization, even though `final` isn't written. Lambdas and anonymous classes can capture either — both are equally OK; the language relaxed the strict-`final` requirement in Java 8.

### Q22. What does it mean for a method to be `synchronized`?
The method holds an implicit monitor on `this` (or on the `Class` for static methods) for its full duration. At most one thread can execute any `synchronized` method on the same instance at a time. Equivalent to wrapping the body in `synchronized(this) { ... }`.

### Q23. Why might `synchronized` on individual setters not make a class thread-safe?
Each method is atomic, but compound operations (read-then-act, or two related fields modified together) still race. Example: `if (cnt.get() < 100) cnt.set(cnt.get() + 1)` is not atomic even with synchronized accessors. You need either a single atomic compound method on the class or external locking.

### Q24. What is varargs and how is it implemented?
Syntactic sugar for a method that accepts a variable number of arguments. The compiler converts the declaration to take an array:
```java
public void log(String fmt, Object... args)   // method's actual descriptor: ([Ljava/lang/Object;)
```
At each call site, the compiler builds an `Object[]` from the arguments. Cost: one allocation per call. Avoid in hot paths.

### Q25. What's the cost of generic method invocation in terms of bytecode?
Generics are *erased*. After compilation, `<T> T identity(T x)` has descriptor `(Ljava/lang/Object;)Ljava/lang/Object;` — the same as if you'd written it without generics. There is *no* per-type cost; the compiler inserts checked casts at the call site to bring the result back to the static type.

### Q26. When should a setter validate?
**Always.** A setter without validation is just a public field with extra ceremony. The whole reason to have a setter instead of a public field is to enforce invariants. If your setter does nothing but `this.x = x`, expose the field as a record component instead.

### Q27. What's the difference between `==` and `.equals()` for `String`, and why?
`==` compares references. The JVM's *string pool* shares string literals — so two literals are `==`. But `new String("abc") == "abc"` is `false`. Always use `equals()` (or `Objects.equals`) for content equality unless you've explicitly interned the string.

### Q28. What's the issue with returning a mutable collection field?
The caller can mutate the internal state. Either return a copy (`List.copyOf(internal)`) or an unmodifiable view (`Collections.unmodifiableList(internal)` — note this is a *view*, so if the internal list still mutates, the view reflects it).

### Q29. What is method chaining (fluent interface), and what's the trade-off?
Methods return `this` (or an immutable updated copy) so calls can be chained: `builder.uri(u).header("X","1").build()`. Pros: readable, clear intent. Cons: deep stack traces are harder to read, debugging breakpoints on individual chained calls require statement separation, mutating chains can hide thread-safety issues.

### Q30. What's the cost of `throws`-declared checked exceptions?
At the bytecode level, `throws` is just an `Exceptions` attribute in the `method_info` — purely informational. No runtime cost. The cost is at *compile* time: callers must catch or re-declare. Many codebases avoid checked exceptions for this reason and use `RuntimeException` subclasses instead.

---

## Senior (31–42)

### Q31. How would you split a 50-method "God class" into something cleaner?
Walk the methods identifying responsibility clusters: data-access vs business-logic vs presentation; methods touching the same fields; verb groupings. Extract each cluster into a class whose name describes its single responsibility. Use composition (the original class delegates) until you can prove no caller needs the old class, then remove it.

### Q32. When is it justified to keep a *derived* attribute as a stored field?
When (a) computation is expensive (>microseconds), (b) the value is queried very often, (c) every code path that mutates the underlying state can be guaranteed to invalidate the cached value. Even then, lazy memoization (compute on first call, store, return) is usually cleaner than eager updates.

### Q33. How does the JIT handle a polymorphic call site?
Class Hierarchy Analysis (CHA) tracks how many implementations of each virtual method are loaded. If only one, the JIT inlines speculatively and registers a CHA dependency — if a new class loads, the compiled code is invalidated. With 2–3 implementations, an inline cache caches the receiver class. Beyond that (megamorphic), the JIT falls back to vtable lookup.

### Q34. How do default methods affect the public API of an interface?
Default methods make it possible to add behavior to an interface without breaking implementers. Existing implementations inherit the default; they may override. The risk: a class implementing two interfaces with the same default-method signature gets a compile error and must override. Use defaults to *evolve* an interface, not as the primary mechanism for sharing code.

### Q35. What's wrong with this method?
```java
public List<User> activeUsers() {
    return users.stream().filter(User::isActive).collect(Collectors.toList());
}
```
- Returns a *mutable* list — callers can mutate it and accidentally affect the class's invariants.
- `Collectors.toList()` returns whatever list type the Collector chooses (`ArrayList` today, but unspecified). Use `Collectors.toUnmodifiableList()` or `.toList()` (Java 16+) for an immutable result.

### Q36. How would you make a method idempotent and why does it matter?
Idempotent: running it twice has the same effect as running it once. Achieve via:
- Use of an idempotency key (request ID) that the method records before performing the action.
- "Compare-and-set" patterns: only act if the current state matches an expected one.
- "Upsert" semantics: insert-or-no-op rather than insert-or-fail.

Matters for retries — networks fail; the second call shouldn't double-charge a customer.

### Q37. What's the impact of declaring a method `synchronized` vs using a `ReentrantLock`?
Equivalent in raw performance under uncontended loads. `ReentrantLock` adds: tryLock with timeout, fair locking option, multiple condition variables (`newCondition()`), interruptible acquisition. `synchronized` is harder to misuse (block-scoped), better integrated with thread dumps. Use `synchronized` by default; reach for `ReentrantLock` only when you need its extra features.

### Q38. What does Liskov substitution have to do with method design?
A subclass overriding a method must:
- Accept at least the same inputs (no narrower precondition).
- Produce at most the same outputs (no wider postcondition).
- Not throw new checked exceptions.
- Not mutate state in ways the parent didn't.

Violations break callers who programmed to the parent's contract. Common in inheritance-heavy code (e.g., `Properties extends Hashtable` is the textbook violation).

### Q39. How do `MethodHandle` and `VarHandle` differ from reflection?
- `Method.invoke` performs runtime security checks and goes through a JIT-friendly path only after warm-up.
- `MethodHandle` is type-checked once at lookup; the JIT compiles call sites as if the call were direct.
- `VarHandle` (Java 9+) provides typed memory-ordered access (CAS, getAcquire, setRelease) — replaces `Unsafe`.

For framework / library code, prefer `MethodHandle`/`VarHandle`. They're faster, safer, and the supported migration path away from `sun.misc.Unsafe`.

### Q40. What happens at the JVM level when you `synchronized(obj) { ... }`?
The JVM emits `monitorenter` on `obj` at block entry and `monitorexit` on each exit (including exceptional). HotSpot's lock stages:
1. Lightweight: CAS the mark word to point at a stack-allocated lock record.
2. Inflated: under contention, the lock is upgraded to an `ObjectMonitor` allocated in C++ heap; subsequent acquires use OS-level park/unpark.

Re-entrant: the same thread can acquire repeatedly; the monitor counts nesting.

### Q41. Why might the JIT *not* inline a small method?
- Method is `synchronized` and contended.
- Method is megamorphic at the call site.
- Method is too big (`MaxInlineSize` / `FreqInlineSize` exceeded).
- Compiled code budget exceeded (`InlineSmallCode`).
- Receiver type unknown (e.g., reflection / dynamic proxy).
- Recursive call beyond `MaxInlineLevel`.

Diagnose with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`.

### Q42. What's the cost of autoboxing inside a method?
Each box allocates a wrapper (16 B + alignment, with `Integer` cache for `-128..127`). In a hot loop, `Long sum = 0L; for (Long x : longList) sum += x;` may allocate millions of `Long` objects. Use primitive types or specialized streams (`LongStream`) on hot paths.

---

## Professional (43–52)

### Q43. Walk through what happens when you call `account.deposit(100)` at the bytecode level.
```
aload_1                   ; push reference to account
ldc2_w 100L              ; push long 100
invokevirtual #N         ; method ref for BankAccount.deposit(J)V
```
At runtime: load reference, load argument, look up `deposit` in `BankAccount`'s vtable (resolved on first call), invoke. JIT inlines if monomorphic.

### Q44. What is an inline cache and why does it matter for method calls?
A small structure at each polymorphic call site that caches `(receiver_class → target_method)`. On a match, the call is essentially direct. On a miss, the IC is updated or the call falls back to vtable lookup. Monomorphic ICs are ~1 ns; polymorphic (2–3 entries) are slightly more; megamorphic loses the IC entirely. They explain why "the second call is faster" — the IC has populated.

### Q45. How are bridge methods generated and when are they needed?
The compiler generates bridge methods (flagged `ACC_BRIDGE | ACC_SYNTHETIC`) when erasure of generic types or covariant return types would otherwise prevent override resolution at runtime. Example: `IntBox extends Box<Integer>` overrides `Integer get()`, but the JVM also needs an `Object get()` method to handle calls through `Box<?>`. The bridge calls the actual method.

### Q46. What does `invokedynamic` do under the hood?
Each `invokedynamic` site references a *bootstrap method* and *static arguments*. The first time the call site executes, the JVM calls the bootstrap method, which returns a `CallSite` (typically a `ConstantCallSite` pointing at a `MethodHandle`). The site is then "linked" — subsequent calls invoke the handle directly. Lambdas use `LambdaMetafactory.metafactory` as the bootstrap; string concatenation (Java 9+) uses `StringConcatFactory`.

### Q47. What's the layout cost of an `Optional<Integer>` field?
- The `Optional` is itself an object: 16 B header + a reference field = ~24 B aligned.
- The wrapped `Integer` is another 16 B + 4 B int + 4 B padding = 24 B (unless cached).
- The owning class adds 4 B (compressed) reference to the Optional.

So a single Optional<Integer> field costs ~52 B of heap. Use a primitive with a sentinel or separate boolean if memory matters.

### Q48. Why is `String.hashCode()` cached in a field?
The first call computes the hash from the chars (linear in length, ~1 ns/char). To avoid recomputing on subsequent calls (HashMap lookups), `String` stores the result in a field initialized to `0`. On the next call, if the cached value is non-zero, return it. The race condition (two threads computing simultaneously) is benign: both compute the same value, so whichever wins the write wins.

### Q49. What's the difference between `getfield` and `getstatic` in performance?
Both resolve the field reference (constant-pool entry) on first use to a direct offset. After resolution:
- `getfield` is a single load at `obj + offset`.
- `getstatic` is a single load at `class_data_base + offset`.

Equally fast on hot paths. The one nuance: `getstatic` references the class's static area, which lives in metaspace; the JIT loads it once and caches. `getfield` requires a non-null receiver — under default JIT modes, it includes an implicit null check.

### Q50. How does the JMM affect the visibility of attribute writes?
Without explicit synchronization:
- A thread that writes a non-`volatile`, non-`final` field has *no guarantee* that another thread will ever observe the new value.
- A thread reading the same field may see a stale value indefinitely, or even an "out of thin air" value (reordered with a later write).
- The compiler may reorder reads/writes; the CPU may further reorder.

Fix: use `volatile`, `synchronized`, `Atomic*`, or rely on `final` fields' safe-publication guarantee.

### Q51. What is a `final` field's special memory-model guarantee?
JLS §17.5: if a constructor finishes without letting `this` escape, then any thread that observes the constructed reference is guaranteed to see all `final` fields fully initialized. This holds even without explicit synchronization. Non-final fields don't get this — readers may see default values for them. This is the cornerstone of safe immutable publication.

### Q52. What's the cost of a `volatile` field read on x86 vs ARM?
- x86 has Total Store Ordering (TSO): ordinary reads are already ordered (no read-read or read-write reordering). A `volatile` read is a plain load. A `volatile` write needs a `mfence`/`lock-prefixed` instruction (~10 ns) to provide StoreLoad ordering.
- ARM (and POWER) use weak memory models. Both `volatile` reads and writes need explicit memory barriers (`dmb ish`), making them noticeably more expensive.

This is why "make it volatile" can be nearly free on Intel but not on ARM-based servers.

---

## Behavioral / design round (bonus)

- *"How do you decide when a class needs another method vs another class?"* — capability-clustered methods that share state belong together; if a method touches data only when accompanied by other methods using the same data, group them. If a single method works on data that's not yours, move it.
- *"How do you handle a 30-parameter method?"* — group co-traveling parameters into a record (`PaymentRequest`); use a builder if construction has multiple modes; split modes into named methods if a boolean controls them.
- *"Tell me about a time you regretted a method signature."* — concrete example, what broke (callers, version migration, framework integration), how you fixed it (adding a new method, deprecation, parameter object), what you do differently now.

The pattern in all of these: **specifics beat generalities**. "I prefer immutable" is filler; "I made `Order` immutable to fix a race condition where two threads could mutate `lines` during checkout" is signal.
