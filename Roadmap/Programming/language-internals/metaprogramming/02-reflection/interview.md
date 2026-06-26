# Reflection — Interview Questions

> **Topic:** [Reflection](README.md)
> **Focus:** Conceptual foundations, language-specific mechanics (Java, Go, Python, C#, Rust), tricky traps, and design judgment — with answers a senior would actually give.

---

## How to use this file

Questions are grouped: **Conceptual**, **Language-Specific**, **Tricky-Trap**, and **Design**. Each has a model answer. Read the question, answer aloud, then compare. The strongest candidates connect the *mechanism* to the *trade-off* — "reflection is slow because the JIT can't inline an opaque target" beats "reflection is slow."

---

## Conceptual

## Question 1

**What is reflection, in one sentence, and what are its two halves?**

Reflection is a program inspecting and/or manipulating its own structure — types, fields, methods, metadata — at runtime. The two halves are **introspection** (read-only: "what type is this? what fields does it have?") and **intercession / dynamic invocation** (acting: reading/writing fields and calling methods by name at runtime). Most real usage is mostly introspection with a little intercession at the end.

---

## Question 2

**Why is the phrase "at runtime" the defining property of reflection?**

Because reflection does things the compiler normally does at *compile time* — resolving a field or method name — but defers them to *runtime*, often because the name is a string or comes from data. This is the entire trade: you gain the ability to handle types you didn't know about when you wrote the code, and you lose the compiler's static checking. A reflective `getattr(x, "nme")` typo becomes a runtime error; `x.nme` is a build error.

---

## Question 3

**Name four categories of tools that depend on reflection and what each uses it for.**

- **Serialization** (Jackson, Gson, `encoding/json`, `System.Text.Json`): walk fields to convert objects to/from JSON.
- **ORMs** (Hibernate, GORM, Entity Framework, SQLAlchemy): map rows to objects by reflecting on fields and tags/annotations.
- **Dependency injection** (Spring, .NET DI): construct objects and fill dependencies via reflective constructors/annotations.
- **Test frameworks** (JUnit, pytest, xUnit): discover test methods by reflection (`@Test`, `test_*`, `[Fact]`).

The unifying pattern: any library that must work with types it has never seen tends to use reflection.

---

## Question 4

**What are the costs of reflection? Give at least four distinct ones.**

1. **Lost compile-time safety** — name typos/type mismatches move from build errors to runtime errors.
2. **Performance** — reflective calls are 10–100× slower; the optimizer can't inline or devirtualize an opaque target, and arguments get boxed.
3. **Tooling breakage** — refactoring (rename), dead-code elimination, tree-shaking, and obfuscation can't see reflective references.
4. **Security** — reflection bypasses access control (`setAccessible`), and reflective dispatch on untrusted input enables RCE (deserialization, Log4Shell).

A fifth: **readability/debuggability** — "find usages" can't locate string-based calls.

---

## Question 5

**Distinguish reflection from code generation. When would you choose each?**

Both solve "do something generic for any type." **Reflection** does it at *runtime* by inspecting metadata — simple build, handles late-bound/arbitrary types, but slower, slower to start, and opaque to shrinkers/native-image. **Code generation** does it at *compile time* by emitting exact code per type — direct-call speed, tool-visible, native-image-friendly, but adds build complexity and needs the types known at build time. Choose codegen when you control the types and care about startup/throughput/native-image (Serde, source generators); choose reflection for arbitrary/late types and build simplicity (Jackson, `encoding/json`).

---

## Question 6

**Why does reflection break dead-code elimination, tree-shaking, and obfuscation?**

All three assume "names are referenced in source, so I can see every use." A reflective call by *string* (`obj[name]()`, `getMethod(name)`) has no source-visible reference. So DCE/tree-shaking may strip a member that's only used reflectively (breaking the app), or conservatively keep everything (bloat), and obfuscation that renames a field breaks any reflective access keyed on the old name. This is why shrinkers need "keep rules" and native-image needs reflection config.

---

## Question 7

**What is the difference between metadata the runtime keeps and the names in your source code?**

Source names like `name` and `save` are normally compile-time-only: the compiler resolves them and they vanish. Reflection only works because the runtime *retains metadata* describing types, fields, and methods. Languages differ: Java/C#/Python keep rich metadata (enabling full reflection); Rust mostly discards it for zero-cost, which is exactly why Rust can't reflect at runtime.

---

## Language-Specific

## Question 8

**(Java) Walk through reading a private field and calling a method by name with `java.lang.reflect`.**

```java
Class<?> c = obj.getClass();
Field f = c.getDeclaredField("name"); // getDeclared* = this class, any visibility
f.setAccessible(true);                // bypass 'private' (may throw under JPMS)
Object v = f.get(obj);
Method m = c.getMethod("greet");      // getMethod = public, incl. inherited
Object r = m.invoke(obj);
```

Key points: `getDeclaredField` vs `getField` (declared-here-any-visibility vs public-incl-inherited); `setAccessible(true)` to defeat `private`; `invoke` boxes args/returns and is slow.

---

## Question 9

**(Java) What's the difference between `getMethods()` and `getDeclaredMethods()`? And `Method.invoke` vs `MethodHandle`?**

- `getMethods()`: all **public** members, **including inherited**. `getDeclaredMethods()`: all members of **any visibility**, **only this class**.
- `Method.invoke`: classic reflective call — boxes args into `Object[]`, runs access checks, returns `Object`, opaque to the JIT (~10–100× slower).
- `MethodHandle`: a typed, directly-invocable reference from `MethodHandles.Lookup`. When stored as a *constant* (`static final`), the JIT can inline through it; with `invokeExact` it avoids boxing — approaching direct-call speed.

---

## Question 10

**(Java) How do `invokedynamic` and `LambdaMetafactory` make reflective dispatch fast?**

Instead of reflectively calling a getter per invocation, you reflect *once* to get a `MethodHandle`, then `LambdaMetafactory` synthesizes a small class implementing a functional interface (e.g. `Function`) that calls the target directly. `invokedynamic` links that call site lazily on first use and caches it. The hot path becomes an ordinary, inlinable, devirtualizable interface call — an order of magnitude over `Method.invoke`. This is how Java lambdas themselves work and how fast serializers (Jackson blackbird) avoid the reflection tax.

---

## Question 11

**(Go) Explain `reflect.Type`, `reflect.Value`, and `Kind`. Why does setting a field sometimes panic?**

`reflect.Type` describes the type (name, fields, methods, tags); `reflect.Value` wraps an actual value; `Kind` is the *category* (`Struct`, `Int`, `Ptr`...). Two distinct named types can share a `Kind`, so generic code switches on `Kind`.

Setting panics because of **addressability/settability**: `reflect.ValueOf(u)` copies `u`, and the copy has no address you can take — it's not addressable, so not settable. Fix: reflect through a pointer and dereference — `reflect.ValueOf(&u).Elem()`. Even then, the field must be **exported** (capitalized); unexported fields are never settable. `CanSet()` is true only when addressable **and** exported.

---

## Question 12

**(Go) How does `json.Marshal` know to output `"user_name"` for a field named `Name`? And why does Go use `reflect` sparingly?**

`json.Marshal` reflects over the struct and reads each field's **struct tag** (`json:"user_name"`), using it as the output key. Tags are the general mechanism behind JSON/YAML/DB-mapping/validation.

Go uses `reflect` sparingly on purpose: it's slow (no JIT relinking like Java's `invokedynamic` exists), verbose, and unsafe (the settability rules and `unsafe` interplay make it easy to corrupt memory). The Go answer to the reflection tax is "cache a per-type plan (what `encoding/json` does) or generate code (`easyjson`, protobuf)."

---

## Question 13

**(Python) Why is reflection "trivial and pervasive" in Python? Show the core primitives.**

Because everything is an object with a `__dict__`, so inspecting/modifying structure is just normal attribute access — no special reflection API ceremony.

```python
type(x)                 # the type
x.__dict__              # instance attributes as a dict
dir(x)                  # all attribute/method names
getattr(x, "name")      # read by string name
setattr(x, "name", v)   # write by string name
hasattr(x, "name")      # existence check
getattr(x, "save")()    # call a method by name
import inspect; inspect.signature(fn)  # parsed parameters/defaults/annotations
```

`inspect` is the polished layer (signatures, source, members, MRO) over the raw `__dict__` substrate.

---

## Question 14

**(Python) What's the difference between `dir(x)`, `vars(x)`/`x.__dict__`, and `inspect.getmembers`?**

- `x.__dict__` / `vars(x)`: only the *instance's own* attributes, as a dict.
- `dir(x)`: a list of *all* accessible names — instance, class, inherited, and dunder methods — as strings.
- `inspect.getmembers(x, predicate)`: name/value pairs filtered by a predicate (e.g. `inspect.ismethod`), the structured way to enumerate members.

Pick `__dict__` for "what data does this instance hold," `dir` for "what can I reference," `getmembers` for "give me the methods with their objects."

---

## Question 15

**(C#) How does `System.Reflection` access non-public members, and what's the codegen alternative?**

Via `BindingFlags`: `t.GetField("_secret", BindingFlags.NonPublic | BindingFlags.Instance).SetValue(obj, v)`. `Activator.CreateInstance(t)` constructs reflectively. The codegen alternative is **source generators** (e.g. `System.Text.Json`'s source-generation mode), which emit serialization code at compile time — required for NativeAOT/trimming, where reflection must be declared via `[DynamicallyAccessedMembers]` or it gets trimmed away.

---

## Question 16

**(Rust) Why does Rust have almost no runtime reflection, and what does it use instead?**

Rust follows a **zero-cost** philosophy: you don't pay at runtime for things you didn't ask for, and the compiler discards most type metadata, so there's nothing to reflect over at runtime. Instead, Rust does the same jobs at *compile time* with **macros** and `#[derive(...)]`. Serde's `#[derive(Serialize)]` generates exact serialization code while compiling — same output as a reflective serializer, but no runtime field-walking, no metadata, and (as a bonus) closed-world by construction, so no native-image reflection-config problem. There's limited runtime type identity via `std::any::Any`/`TypeId` (downcasting), but it's nothing like Java/Python reflection.

---

## Question 17

**(Cross-language) Rank Java, Go, Python, and Rust by how much they encourage runtime reflection, and why.**

- **Python** — most: everything's an object, reflection is just attribute access, frameworks lean on it heavily.
- **Java / C#** — full, explicit reflection libraries; powerful but verbose; the ecosystem (Spring/Hibernate) is built on it.
- **Go** — has `reflect` but discourages it (slow, verbose, unsafe); confined mostly to library internals; prefers codegen.
- **Rust** — least: essentially no runtime reflection by design; uses compile-time macros.

The axis is the language's stance on the runtime-cost vs. flexibility trade and how much type metadata it retains.

---

## Tricky-Trap

## Question 18

**Does Python's GIL or "everything is an object" make `getattr`/`setattr` thread-safe for compound updates?**

No. Reflection being "easy" in Python says nothing about thread-safety. `getattr` then `setattr` is two operations; another thread can interleave between them, and the GIL only makes individual bytecode ops atomic, not compound read-modify-write sequences. Reflection and concurrency are orthogonal — a reflective counter increment races exactly like a direct one.

---

## Question 19

**(Trap) You cached a `Method`, so reflection is now as fast as a direct call. True?**

False. Caching removes the *lookup* cost, getting you to roughly 10–30× of direct — but the **structural** tax remains: arguments are still boxed into `Object[]`, results boxed, and the JIT still can't inline or devirtualize an opaque `Method.invoke`. To approach direct-call speed you need a *constant* `MethodHandle` (with `invokeExact`, no boxing) or a `LambdaMetafactory`-synthesized lambda. Caching is necessary but not sufficient.

---

## Question 20

**(Trap, Go) This compiles and runs but panics. Why?**

```go
u := User{Name: "Ada"}
v := reflect.ValueOf(u)
v.FieldByName("Name").SetString("Grace")
```

`reflect.ValueOf(u)` makes a copy; the copy isn't addressable, so the field isn't settable, and `SetString` panics with "using unaddressable value." Reflect through a pointer: `v := reflect.ValueOf(&u).Elem()`. And the field must be exported (it is here) — an unexported field would *still* be unsettable even with the pointer fix.

---

## Question 21

**(Trap, Java) Your app works on the JVM but a teammate's `setAccessible(true)` throws `InaccessibleObjectException` in another environment. What changed?**

The module system (JPMS). `setAccessible(true)` is no longer unconditional: deep reflection into another module's package requires that package to be **opened** (`opens pkg;` in `module-info.java`, or a runtime `--add-opens`). It "worked" where the package happened to be open (e.g. unnamed module / `--add-opens` already present) and fails where it isn't. The right fix is a qualified `opens` declaration, not a broad `--add-opens ...=ALL-UNNAMED`.

---

## Question 22

**(Trap) A reflective code path passes all tests on the JVM, the GraalVM native build succeeds and the binary boots — then it crashes in production. What happened?**

The reflective path wasn't in the native-image **reflection config**. Native-image is closed-world: it only includes metadata for reflectively-accessed members you *declare* (via `reflect-config.json`, usually generated by the tracing agent). If your test workload never exercised that branch, the agent never recorded it, so the metadata is absent — and the binary throws `NoSuchMethodException`/`ClassNotFoundException` only when that branch runs. Fix: drive the agent with full representative traffic, merge runs, and test the *native binary*.

---

## Question 23

**(Trap) Why does renaming a field with your IDE's "rename" sometimes silently break serialization?**

Because the IDE's rename updates *source-visible* references but can't see reflective/string ones — a JSON tag value, a `getattr(x, "oldName")`, a config key. After rename, the struct field changes but a tag or string still says the old name, so nothing fails to compile; the data is simply wrong or missing at runtime. Reflection hides usages from refactoring tools.

---

## Question 24

**(Trap) Is `reflect`-based code in Go safe from memory corruption?**

Mostly, but not entirely. Plain `reflect` enforces settability/export rules that keep you safe. The danger is the common `reflect` + `unsafe` combination some high-performance libraries use to bypass those rules (e.g. setting unexported fields via `unsafe.Pointer`). That bypass can corrupt memory, break the GC's assumptions, or violate type safety. "Reflection is safe" holds only for the standard `reflect` API used as intended.

---

## Question 25

**(Trap) Reflection sees the declared type of a variable. True or false?**

False — it sees the **runtime (dynamic) type**. A variable declared as `Animal` holding a `Dog` reflects as `Dog`; a Go `interface{}` reflects to its concrete dynamic type (and a nil interface yields a nil `Type`). This is usually what you want, but it surprises people expecting the static type, and it means reflective behavior can vary with what's actually assigned.

---

## Design

## Question 26

**Design a generic JSON serializer. Where does reflection go, and how do you keep it fast?**

- **Discover once, run fast forever.** On first encounter of a type, reflect to build a *compiled plan*: an ordered list of `(key, accessor)` where `key` comes from struct tags/annotations and `accessor` is a fast getter. Cache the plan keyed by type (`sync.Map`/`ClassValue`).
- **Make accessors direct.** In Java, build accessors via `LambdaMetafactory` so the hot path is direct calls, not `Method.invoke`. In Go, cache a per-type encoder closure (what `encoding/json` does); if that's not enough, offer a codegen path.
- **Keep reflection at the boundary.** Only the registration step reflects; encoding loops over the cached plan.
- **Provide a codegen alternative** for native-image/startup-sensitive users, plus reflection config/keep rules.

The headline: reflect at registration, emit a fast artifact, never reflect per element.

---

## Question 27

**You're choosing between Jackson (reflective) and a source-generated serializer for a new serverless service. How do you decide?**

Decision drivers: **deployment shape and startup budget.** Serverless cold start punishes boot-time reflection (class scanning, accessor building), and if you target native-image, reflective libraries need config and risk runtime gaps. A **source generator** emits direct code, has near-zero startup reflection, is native-image-friendly, and is tool-visible. So for serverless/native-image I'd lean source-generated (or a framework like Quarkus/Micronaut that relocates reflection to build time). For a long-lived JVM service where startup is amortized and types are dynamic, Jackson's flexibility and ecosystem maturity usually win. State the trade-off explicitly: flexibility/build-simplicity vs. startup/throughput/closed-world friendliness.

---

## Question 28

**An endpoint lets clients invoke a handler by name: `getMethod(req.name).invoke(handler)`. Review it.**

This is a serious security flaw: reflective dispatch on attacker-controlled input. A crafted name can invoke unintended methods (side effects, privilege escalation), and the pattern is the same shape as the deserialization/Log4Shell/Spring4Shell RCE vectors. The fix is *not* "validate the string better" — it's **don't reflect on untrusted input**. Map the action string to a known allow-list of handler instances: `Map<String,Handler>`, look it up, reject unknowns. No reflection on input, no arbitrary class loading, no constructor side effects.

---

## Question 29

**When would you deliberately choose reflection over an interface or generics?**

When the set of types is *open or unknown at compile time* and you can't enumerate them in an interface/generic — e.g. a serializer, ORM, DI container, or plugin system that must handle types added later, possibly by third parties. If the types are known and bounded, prefer an interface (polymorphism) or generics (compile-time parametric code): they're faster, type-safe, and tool-friendly. Reflection earns its cost specifically at the "any type, including future ones" boundary.

---

## Question 30

**How would you govern reflection across a large codebase to keep it from becoming a liability?**

- **Confine it.** Reflection lives in clearly-owned boundary modules (serialization, DI, config binding), never sprinkled through business logic.
- **Cache and benchmark.** Mandate per-type caching/`MethodHandle` for hot paths; benchmark against direct-call baselines in CI.
- **Declare access intentionally.** Use JPMS `opens` / native-image config / `[DynamicallyAccessedMembers]` in source, reviewed; audit and minimize `--add-opens` and `setAccessible`.
- **Ban reflection on untrusted input** as a code-review rule; allow-list instead.
- **Budget startup.** Measure cold start; relocate boot-time reflection to build time (AOT) where it matters.
- **Prefer codegen for new startup/native-image-sensitive components.** Treat reflective libraries' tightening platform support as tracked tech debt.

---

## Quick-fire round

1. **Introspection vs. intercession?** Read-only inspection vs. acting (set/invoke by name).
2. **Why is reflective `invoke` slow even when cached?** Boxing + the JIT can't inline an opaque target.
3. **Go's two conditions for `CanSet`?** Addressable (via pointer + `Elem`) and exported.
4. **What gives `json.Marshal` the output key?** The struct tag.
5. **Java's fast reflective primitive?** `MethodHandle` (constant) / `LambdaMetafactory` lambda.
6. **Why does Rust lack runtime reflection?** Zero-cost philosophy; uses `derive` macros at compile time.
7. **`setAccessible(true)` post-Java-9 needs?** The package to be `opens`-ed (or `--add-opens`).
8. **Native-image needs what for reflection?** `reflect-config.json` reachability metadata.
9. **One security rule?** Never reflect on attacker-controlled names; allow-list.
10. **Reflection vs. codegen one-liner?** Runtime flexibility vs. compile-time speed/closed-world.
