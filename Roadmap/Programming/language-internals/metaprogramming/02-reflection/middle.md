# Reflection — Middle Level

> **Topic:** [Reflection](README.md)
> **Focus:** The real mechanics — Go's `Type`/`Value`/`Kind` and settability rules, Java's `Field`/`Method`/`Constructor` and the performance cliff, Python's `inspect`, and *why reflective calls are 10–100× slower* — plus how to cache your way out.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Code Examples](#code-examples)
8. [Pros & Cons](#pros--cons)
9. [Use Cases](#use-cases)
10. [Coding Patterns](#coding-patterns)
11. [Best Practices](#best-practices)
12. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
13. [Performance Notes](#performance-notes)
14. [Test Yourself](#test-yourself)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)
17. [Further Reading](#further-reading)

---

## Introduction

> Focus: **How does reflection actually work in Go, Java, and Python — and what does it cost?**

At the junior level, reflection was "the magic that makes JSON work." At the middle level you stop treating it as magic and start treating it as an API with sharp edges and a price tag. Three questions drive this page:

1. **What are the real objects?** Go gives you `reflect.Type` and `reflect.Value`, distinguished by `Kind`. Java gives you `Class`, `Field`, `Method`, `Constructor`. Python gives you `__dict__`, `type()`, and the `inspect` module. You need to know what each represents and how they fit together.
2. **What are the rules that bite?** Go's **addressability and settability** rules cause more reflective panics than anything else. Java's accessibility and the module system gate what you can touch. You need these in your bones.
3. **What does it cost, and how do you pay less?** A reflective method call in Java can be 10–100× slower than a direct one. The fix is almost always **caching**: resolve the `Field`/`Method`/struct-field *once*, reuse it forever.

In one sentence: **the middle level is where you learn that reflection is a normal API with a settability rulebook and a performance bill, and how to keep both under control.**

This page leans on concrete, runnable code. The lowest-level *why* (how the runtime stores type metadata, how `invokedynamic` rewires call sites) is in `senior.md`; production concerns (module system, GraalVM, security CVEs) are in `professional.md`.

---

## Prerequisites

- **Required:** Comfort with `junior.md` — the two halves of reflection, the type-handle entry point, struct tags vs. annotations.
- **Required:** Solid grasp of pointers/references in your language (Go pointers especially — settability *is* a pointer story).
- **Required:** Understanding of public/private (Java) and exported/unexported (Go capitalization) visibility.
- **Helpful:** Having read the source of one serializer or written a tiny one.
- **Helpful:** Basic benchmarking experience (`go test -bench`, JMH, `timeit`).

You do **not** need: the bytecode/`invokedynamic` internals (`senior.md`), or the module-system/native-image story (`professional.md`).

---

## Glossary

| Term | Definition |
|------|-----------|
| **`reflect.Type` (Go)** | Describes a type: its name, kind, fields, methods, tags. Comparable, usable as a map key. |
| **`reflect.Value` (Go)** | Wraps an actual value and lets you read/set it (subject to rules). Pairs with a `Type`. |
| **`Kind` (Go)** | The *category* of a type: `Struct`, `Ptr`, `Slice`, `Int`, `String`, `Interface`, etc. You switch on `Kind` constantly. Distinct from the named `Type`. |
| **Addressable (Go)** | A value has a memory address you can take. Only addressable values can be set. Values obtained from `reflect.ValueOf(x)` are **not** addressable; from `reflect.ValueOf(&x).Elem()` they are. |
| **Settable / `CanSet` (Go)** | A `Value` can be assigned to. Requires addressability **and** an exported field. |
| **`Elem()` (Go)** | Dereferences: turns a `Value` of a pointer into the `Value` it points to (and similarly for interfaces). The key to getting an addressable struct. |
| **`Class<T>` (Java)** | The runtime handle for a type. Source of `Field`/`Method`/`Constructor` objects. |
| **`Field` / `Method` / `Constructor` (Java)** | Reflective handles for a member. Carry metadata and can `get`/`set`/`invoke`/`newInstance`. |
| **`setAccessible(true)` (Java)** | Disables the access check (`private`) on a member. Subject to the module system. |
| **`getMethods()` vs `getDeclaredMethods()` (Java)** | `getMethods`: all *public* members including inherited. `getDeclaredMethods`: all members declared *in this class only*, any visibility. |
| **`inspect` (Python)** | Standard-library module for higher-level introspection: signatures, source, members, MRO. |
| **`__dict__` (Python)** | The dictionary holding an object's (or class's) attributes. The raw substrate of Python reflection. |
| **MRO** | Method Resolution Order — the linearized chain Python walks to find an attribute/method across base classes. |
| **Reflective dispatch** | Resolving which field/method to use at runtime instead of at compile time. The source of the cost. |
| **Handle caching** | Resolving a `Field`/`Method`/struct-field once and reusing it, instead of looking it up on every call. |

---

## Core Concepts

### 1. Go: `Type`, `Value`, and `Kind` are three different things

People conflate these and get confused. Keep them separate:

- **`reflect.Type`** answers *static* questions: name, kind, fields, methods, tags. It doesn't hold a value.
- **`reflect.Value`** wraps an *actual* value: you can read it (`.Int()`, `.String()`, `.Interface()`) and, if the rules allow, set it.
- **`Kind`** is the *category*. Two different named types (`type Celsius float64`, `type Meters float64`) have *different `Type`s* but the *same `Kind`* (`Float64`). When you write generic reflective code, you almost always switch on `Kind`, not `Type`.

```go
type Celsius float64
v := reflect.ValueOf(Celsius(36.6))
fmt.Println(v.Type())  // main.Celsius   (the named type)
fmt.Println(v.Kind())  // float64        (the category)
```

The "Laws of Reflection" (Go's own framing) are worth memorizing:

1. Reflection goes from interface value → reflection object (`TypeOf`, `ValueOf`).
2. Reflection goes from reflection object → interface value (`.Interface()`).
3. **To modify a reflection object, the value must be settable** — addressable and exported.

### 2. Go: addressability and settability — the rule that panics everyone

This is *the* Go reflection gotcha. Why does this panic?

```go
u := User{Name: "Ada"}
reflect.ValueOf(u).FieldByName("Name").SetString("Grace") // PANIC
```

Because `reflect.ValueOf(u)` makes a **copy** of `u`. The copy lives somewhere temporary with no address you can take — it is *not addressable*. Setting it would be writing into a value that's about to vanish, so Go forbids it. The fix is to reflect over a **pointer** and dereference with `Elem()`:

```go
u := User{Name: "Ada"}
v := reflect.ValueOf(&u).Elem()         // now addressable
v.FieldByName("Name").SetString("Grace") // works
fmt.Println(u.Name)                       // "Grace"
```

Two conditions for `CanSet()` to be true:

1. **Addressable** — you reflected through a pointer and called `.Elem()`.
2. **Exported** — the field name is capitalized. Unexported fields are *never* settable via reflection (and only readable in limited ways). This enforces Go's encapsulation even under reflection.

### 3. Java: `Class` is the root; everything hangs off it

From a `Class` you reach the four member kinds:

```java
Class<?> c = obj.getClass();      // or Foo.class, or Class.forName("...")
c.getDeclaredFields();            // Field[]
c.getDeclaredMethods();           // Method[]
c.getDeclaredConstructors();      // Constructor<?>[]
c.getAnnotations();               // Annotation[]
```

Know the `getX` vs `getDeclaredX` distinction cold:

- **`getFields()` / `getMethods()`** → only `public`, but includes inherited members.
- **`getDeclaredFields()` / `getDeclaredMethods()`** → every visibility, but *only this class* (not inherited).

To touch a non-public member you call `setAccessible(true)` — which the module system may reject (see `professional.md`). To create instances reflectively, prefer `Constructor.newInstance()` over the deprecated `Class.newInstance()`.

### 4. Python: it's all dictionaries, plus `inspect` for the polished view

Python reflection is two layers:

- **Raw layer:** `obj.__dict__` (instance attributes), `type(obj).__dict__` (class attributes/methods), `getattr/setattr/hasattr/delattr`, `dir()`, `vars()`. Everything is an object with a `__dict__`, so reflection is just dictionary access dressed up.
- **Polished layer — `inspect`:** higher-level helpers that hide the rough edges:
  - `inspect.signature(fn)` — parameters, defaults, annotations.
  - `inspect.getmembers(obj, predicate)` — filtered member listing.
  - `inspect.getsource(fn)` — the actual source text.
  - `inspect.isfunction`, `inspect.ismethod`, `inspect.isclass` — type predicates.
  - `type(obj).__mro__` — the resolution order across base classes.

Where Go and Java make you *opt in* to a reflection API, Python makes reflection the path of least resistance — which is why Python frameworks lean on it heavily.

### 5. C#: `Type` plus `MemberInfo` hierarchy

`obj.GetType()` returns a `Type`; from it you get `PropertyInfo`, `FieldInfo`, `MethodInfo`, `ConstructorInfo` (all `MemberInfo` subclasses). Binding flags control visibility:

```csharp
var flags = BindingFlags.NonPublic | BindingFlags.Instance;
FieldInfo f = t.GetField("_secret", flags);
f.SetValue(obj, 42);
```

`Activator.CreateInstance(t)` constructs instances reflectively.

### 6. The performance story (the whole reason `senior.md` exists)

A reflective access does work a direct access never does:

- **Lookup** — find the `Field`/`Method` by name (string hashing, table walks) unless cached.
- **Access checks** — verify visibility on each `invoke`/`get` (mitigated by `setAccessible`).
- **Boxing** — arguments and return values get wrapped in `Object`/`interface{}`, causing allocations.
- **No inlining** — the JIT/compiler can't see through a reflective call, so it can't inline, devirtualize, or specialize it.

Net effect: reflective field reads and method calls commonly run **10–100× slower** than direct ones, and allocate. The two universal mitigations are **caching the handle** and, in Java, upgrading to **`MethodHandle`** (covered in `senior.md`).

---

## Real-World Analogies

**The phone book vs. speed dial.** A direct call is speed dial — the number is wired to a button. A reflective call is looking the person up in the phone book by name every single time. Caching the handle is writing their number on a sticky note after the first lookup: you still dial manually, but you skip the search.

**Go's settability = renting vs. owning.** `reflect.ValueOf(u)` hands you a *photocopy* of a document — you can read it, but scribbling on the copy is pointless, so the system won't let you. `reflect.ValueOf(&u).Elem()` hands you the *original in its folder* (an address), and now your edits stick. "Exported field" is the extra rule that some sections of the original are sealed (unexported) and stay read-only no matter what.

**`inspect` as the museum tour vs. the storeroom.** `__dict__` is the raw storeroom — everything's there but unlabeled and messy. `inspect` is the curated tour: signatures, sources, and members presented cleanly. Same artifacts, friendlier access.

---

## Mental Models

**Model 1: "Type vs. Value vs. Kind = blueprint, brick, category."** The `Type` is the blueprint, the `Value` is an actual brick you can hold (and maybe reshape), and the `Kind` is "it's a brick" vs. "it's a beam." Generic code dispatches on the category (`Kind`), reads/writes the brick (`Value`), and consults the blueprint (`Type`) for layout.

**Model 2: "Settability is a chain of permissions."** To write a Go field via reflection you need *both* keys: addressability (you came through a pointer + `Elem`) **and** export (the field is public). Miss either, and the door stays locked. Visualize a two-lock door.

**Model 3: "Reflection is a tax; caching is the deduction."** Every reflective op pays tax (lookup, checks, boxing). You can't avoid the tax entirely, but caching the handle removes the biggest line item (lookup), and `setAccessible` removes another (per-call checks). Pay once, not per request.

**Model 4: "Python keeps the receipts."** Python never throws away structure, so reflection is cheap *to write* (it's just attribute access) but still not free *to run*. `inspect` is the accountant that organizes the receipts for you.

---

## Code Examples

### Example 1: A reflective struct copier in Go (settability in action)

```go
// CopyFields copies same-named exported fields from src to dst.
// dst must be a pointer to a struct.
func CopyFields(dst, src interface{}) {
	dv := reflect.ValueOf(dst).Elem() // addressable struct
	sv := reflect.ValueOf(src)
	if sv.Kind() == reflect.Ptr {
		sv = sv.Elem()
	}
	dt := dv.Type()
	for i := 0; i < dt.NumField(); i++ {
		name := dt.Field(i).Name
		sf := sv.FieldByName(name)
		df := dv.Field(i)
		if sf.IsValid() && df.CanSet() && sf.Type() == df.Type() {
			df.Set(sf) // only fires when addressable + exported + types match
		}
	}
}
```

Every guard here maps to a rule: `IsValid` (the field exists on src), `CanSet` (addressable + exported), and the type-equality check (no silent coercion).

### Example 2: Reading struct tags the way a serializer does (Go)

```go
func fieldKey(f reflect.StructField) string {
	tag := f.Tag.Get("json")
	if tag == "" || tag == "-" {
		return f.Name // default to field name
	}
	if comma := strings.IndexByte(tag, ','); comma >= 0 {
		tag = tag[:comma] // strip ",omitempty" etc.
	}
	return tag
}
```

This is essentially the first thing `encoding/json` does per field. Now the "magic" is fully demystified: it's tag parsing over reflected fields.

### Example 3: Java — direct vs. reflective, and the cache that saves you

```java
// SLOW: looks up the method on every call
public Object slowInvoke(Object target, String name) throws Exception {
    Method m = target.getClass().getMethod(name); // lookup each time
    return m.invoke(target);
}

// FAST(er): resolve once, reuse, and disable access checks
private final Map<String, Method> cache = new ConcurrentHashMap<>();

public Object cachedInvoke(Object target, String name) throws Exception {
    Method m = cache.computeIfAbsent(name, n -> {
        try {
            Method mm = target.getClass().getMethod(n);
            mm.setAccessible(true);   // skip access check on each invoke
            return mm;
        } catch (NoSuchMethodException e) {
            throw new RuntimeException(e);
        }
    });
    return m.invoke(target);
}
```

The lookup is the expensive part; caching the `Method` removes it. `setAccessible(true)` additionally skips the per-invoke access check. You're still paying for boxing and the lack of inlining — `senior.md` shows how `MethodHandle` reduces even that.

### Example 4: Python `inspect` for a real introspection task

```python
import inspect

def describe(obj):
    print("type:", type(obj).__name__)
    print("mro :", [c.__name__ for c in type(obj).__mro__])
    for name, member in inspect.getmembers(obj, inspect.ismethod):
        sig = inspect.signature(member)
        print(f"  {name}{sig}")

class Repo:
    def get(self, id: int) -> dict: ...
    def save(self, item: dict, *, upsert: bool = False) -> None: ...

describe(Repo())
# type: Repo
# mro : ['Repo', 'object']
#   get(id: int) -> dict
#   save(item: dict, *, upsert: bool = False) -> None
```

`inspect.signature` parsing parameters, defaults, and annotations is what powers CLI generators, RPC frameworks, and pytest fixtures.

### Example 5: A tiny dependency-injection move (Java)

```java
// Construct an object and fill a field annotated @Inject, by reflection.
Constructor<?> ctor = type.getDeclaredConstructor();
ctor.setAccessible(true);
Object instance = ctor.newInstance();

for (Field f : type.getDeclaredFields()) {
    if (f.isAnnotationPresent(Inject.class)) {
        f.setAccessible(true);
        f.set(instance, container.resolve(f.getType()));
    }
}
```

This 8-line sketch is the *entire idea* behind Spring's field injection: reflect, find annotated members, fill them.

---

## Pros & Cons

**Pros**

- **Library-grade generality** without per-type code, now with the mechanics to do it correctly.
- **Tag/annotation-driven configuration** keeps mapping declarative and local to the data.
- **`inspect`/signature introspection** unlocks signature-aware tooling (RPC, CLIs, fixtures).

**Cons (sharpened at this level)**

- **The settability/accessibility rulebook** is easy to get wrong (Go `Elem`, Java module gates).
- **The 10–100× cost** is real and shows up in hot paths; ignoring caching is a classic perf bug.
- **Allocations from boxing** add GC pressure in tight reflective loops.
- **Error site moves to runtime** — a cached `Method` that no longer exists fails far from where it was wired up.

---

## Use Cases

- **Hand-rolled serializers / mappers** where you now correctly handle tags, nested structs, and settability.
- **Config binding** — map a `map[string]any` or env vars onto a struct via reflection + tags.
- **DI containers** — constructor/field injection driven by annotations.
- **Generic validators** — walk fields, read `validate:"..."` tags, apply rules.
- **Test/fixture frameworks** — `inspect.signature` to wire arguments by name and type.
- **Object diffing / cloning** — `CopyFields`-style deep operations across unknown types.

---

## Coding Patterns

**Pattern 1: Resolve once, reuse forever.** Cache the `Field`/`Method`/`StructField` keyed by `(Type, name)` in a `ConcurrentHashMap` / `sync.Map`. Reflection is fine on setup, deadly per request.

**Pattern 2: Reflect through a pointer in Go.** If you intend to set anything, start from `reflect.ValueOf(&x).Elem()`. Make it a habit so you never hit the addressability panic.

**Pattern 3: Switch on `Kind`, not `Type`.** Generic reflective walkers branch on `reflect.Struct`/`Slice`/`Map`/`Ptr`. Handle `Ptr` by `Elem()`-ing and recursing.

**Pattern 4: Pre-flight every name.** Before `invoke`/`Set`, verify the member exists and types match; fail with a message naming the type and member.

**Pattern 5: `setAccessible(true)` once at cache time, not per call.** It both unlocks access and removes the per-invoke check — but do it during resolution, not in the hot path.

---

## Best Practices

- **Build a type-info cache.** Reflect a type once into a small struct (`[]fieldInfo{name, index, tag, kind}`) and iterate *that* on every request. This single move recovers most of the lost performance.
- **Keep the reflective core tiny and tested.** Concentrate `Set`/`invoke` in one module; everything else calls into it.
- **Prefer `getDeclaredX` + explicit visibility handling** over guessing which `getX` returns what.
- **In Go, treat unexported fields as off-limits.** You can't set them and shouldn't try; redesign instead.
- **Measure before and after caching.** A quick benchmark proves the win and guards against regressions.
- **Surface clear errors.** "no method `Save` on `*User`" beats a raw `NoSuchMethodException` three layers deep.

---

## Edge Cases & Pitfalls

- **Go `Set` panic on a copy.** Forgetting the pointer + `Elem()`. The #1 mistake.
- **Go unexported fields.** Readable in limited ways, never settable via reflection; `CanSet()` returns false.
- **Java `getMethods` vs `getDeclaredMethods`.** Looking for a `private` or inherited member in the wrong list returns nothing or the wrong thing.
- **`setAccessible(true)` may throw.** Under the module system it can fail with `InaccessibleObjectException` (see `professional.md`).
- **Boxing surprises.** Reflective numeric `set`/`get` boxes primitives; tight loops allocate heavily.
- **Stale cached handles.** If types are reloaded (hot reload, classloaders), a cached `Method` can dangle. Key caches by `Class`, and clear on reload.
- **Python `dir()` vs `__dict__`.** `__dict__` shows only instance attributes; `dir()` includes class/inherited members and dunder methods. Pick the right one for the question.
- **MRO surprises in Python.** `getattr` follows the MRO, so a subclass attribute can shadow a base one in ways that surprise reflective walkers.
- **Reflecting interfaces vs. concrete types (Go).** `reflect.TypeOf` on an interface value gives the *dynamic* type; a nil interface gives a nil `Type` — guard for it.

---

## Performance Notes

- **The cost is dominated by lookup + checks + boxing + no-inlining.** Caching removes lookup; `setAccessible` removes checks; `MethodHandle` (Java) reduces the rest.
- **Rule of thumb:** uncached reflective method call ≈ 10–100× a direct call; cached ≈ a few× to ~10×; `MethodHandle` (warmed up) can approach direct-call speed.
- **Allocations matter as much as cycles.** Boxed args/returns and reflective `[]Object` arrays churn the GC; in hot loops this often dominates.
- **Reflection at *startup* vs. *steady state*.** Many frameworks reflect heavily at boot (scanning classes, wiring DI). That doesn't hurt throughput but does hurt **startup latency** — a real problem for serverless/CLI (more in `professional.md`).
- **Benchmark honestly.** Warm up the JIT, run enough iterations, and compare against a direct-call baseline — not against an unrealistic best case.

---

## Test Yourself

1. In Go, why does `reflect.ValueOf(u).Field(0).SetString("x")` panic, and what's the fix?
2. What are the two conditions for `CanSet()` to be true in Go?
3. Distinguish `Type`, `Value`, and `Kind`. When do you switch on `Kind`?
4. In Java, what's the difference between `getMethods()` and `getDeclaredMethods()`?
5. Why is an uncached reflective call slow? List at least three contributing factors.
6. What does caching a `Method`/`StructField` remove from the cost, and what does it *not* remove?
7. What does `inspect.signature` give you that raw `__dict__` access doesn't?
8. Why can reflection-heavy frameworks hurt startup latency even if steady-state throughput is fine?

<details>
<summary>Answers</summary>

1. `reflect.ValueOf(u)` copies `u`; the copy isn't addressable, so it isn't settable. Fix: `reflect.ValueOf(&u).Elem()`.
2. Addressability (came through a pointer + `Elem()`) and the field being exported (capitalized).
3. `Type` = the named type/blueprint; `Value` = an actual value you can read/maybe set; `Kind` = the category (`Struct`, `Int`...). Switch on `Kind` for generic code, since many named types share a kind.
4. `getMethods()` returns public members including inherited; `getDeclaredMethods()` returns all visibilities but only those declared on the class itself.
5. Name lookup by string, per-call access checks, boxing of args/returns (allocations), and the inability of the JIT to inline/optimize the call.
6. Caching removes the lookup; it does not remove boxing or the lack of inlining (a `MethodHandle` helps with those).
7. Parsed parameters with names, defaults, kinds (positional/keyword-only), and annotations — a structured signature, not just a list of attributes.
8. Boot-time reflection (class scanning, DI wiring) runs before serving traffic; it's pure startup cost and scales with the number of types/annotations, hurting cold-start latency.

</details>

---

## Cheat Sheet

| Task | Go | Java | Python |
|------|----|----|--------|
| Type handle | `reflect.TypeOf(x)` | `x.getClass()` | `type(x)` |
| Value handle | `reflect.ValueOf(x)` | (the object) | (the object) |
| Make settable | `reflect.ValueOf(&x).Elem()` | `f.setAccessible(true)` | (always mutable) |
| List fields | `t.Field(i)`, `t.NumField()` | `getDeclaredFields()` | `x.__dict__`, `vars(x)` |
| Read field | `v.Field(i)` | `f.get(x)` | `getattr(x,"f")` |
| Set field | `v.Field(i).Set(...)` (settable!) | `f.set(x,v)` | `setattr(x,"f",v)` |
| Read tag/meta | `f.Tag.Get("json")` | annotations | decorators |
| Invoke method | `v.MethodByName("M").Call(...)` | `m.invoke(x,...)` | `getattr(x,"m")(...)` |
| Signature | (parse manually) | `m.getParameterTypes()` | `inspect.signature(m)` |

**Go laws:** ① interface→reflect ② reflect→interface ③ to set, be **settable** (addressable + exported).
**Perf rule:** cache the handle; `setAccessible` once; benchmark against a direct-call baseline.

---

## Summary

The middle level turns reflection from magic into a mechanical, costed API. In **Go** you juggle `Type`, `Value`, and `Kind`, and you live or die by **addressability and settability**: reflect through a pointer and call `Elem()`, and remember only exported, addressable fields are settable. In **Java** everything hangs off `Class`, you must know `getX` vs. `getDeclaredX`, and `setAccessible(true)` unlocks (and speeds up) member access. In **Python**, reflection is just `__dict__` plus the friendly `inspect` module for signatures and members.

The unifying theme is **cost**: uncached reflective access runs 10–100× slower because of lookup, access checks, boxing, and the loss of inlining. The fix is nearly universal — **resolve handles once and cache them**, set accessibility at cache time, and keep reflection out of hot paths. Master the settability rulebook and the caching discipline, and you can use reflection confidently. The next level explains *why* it's slow at the runtime/JIT level and how `MethodHandle`/`invokedynamic` claw the performance back.

---

## Further Reading

- Go: "The Laws of Reflection" and the `reflect` package docs; read `encoding/json`'s `encode.go` field-caching for a production pattern.
- Java: `java.lang.reflect` API, `Class` methods, and the `AccessibleObject` contract.
- Python: the `inspect` module reference and the data-model chapter on attributes and the MRO.
- Then continue to `senior.md` for the runtime mechanics, `MethodHandle`/`LambdaMetafactory`/`invokedynamic`, and lock-free reflective dispatch.
