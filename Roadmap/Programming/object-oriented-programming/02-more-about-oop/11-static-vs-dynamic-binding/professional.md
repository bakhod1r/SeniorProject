# Static vs Dynamic Binding — Professional

> **What?** Bytecode-level details of every `invoke*` opcode, vtable construction, itable searches, and how the JIT and interpreter implement dispatch.
> **How?** With `javap -c -v`, study HotSpot's `klass.cpp`/`vtableStubs.cpp`, and observe runtime behavior with diagnostic flags.

---

## 1. Five `invoke*` opcodes

| Opcode             | Format         | Receiver | Lookup     |
|--------------------|----------------|----------|------------|
| `invokevirtual`    | indexbyte1 indexbyte2 | yes  | Vtable     |
| `invokeinterface`  | indexbyte1 indexbyte2 count 0 | yes | Itable     |
| `invokestatic`     | indexbyte1 indexbyte2 | no  | Direct     |
| `invokespecial`    | indexbyte1 indexbyte2 | yes | Direct     |
| `invokedynamic`    | indexbyte1 indexbyte2 0 0 | varies | CallSite   |

The distinction is in the dispatch mechanism, not the bytecode size.

---

## 2. `invokevirtual` mechanics

JVMS §6.5.invokevirtual:

```
1. Resolve method symbolic ref (at link time, once per call site).
2. Pop receiver and args from operand stack.
3. Receiver's klass is C.
4. Search C and its superclasses for a method matching the resolved (name, descriptor).
5. Invoke the matched method.
```

The "search" is implemented as direct vtable indexing. The vtable index is precomputed during link time and embedded in the call site.

---

## 3. Vtable construction

JVMS §5.4.5 (informally) — when a class is linked:

```
for each method m in C (in declaration order):
    if m has same (name, descriptor) as a method m' inherited from a superclass:
        replace vtable[m'.slot] with C's m
    else if m is non-final, non-private, non-static:
        add new slot, vtable[N++] = m
```

Subclasses extend the parent's vtable. Overrides patch slots.

For interface methods, similar logic builds the itable per implemented interface.

---

## 4. `invokeinterface` mechanics

JVMS §6.5.invokeinterface:

```
1. Resolve interface method ref.
2. Pop receiver and args.
3. Find the receiver's itable for the resolved interface.
4. Look up the method.
5. Invoke.
```

The first step is the search for the right itable. HotSpot uses a small per-call-site cache.

The `count` byte is historical (was used to tell the interpreter how many args to pop), but the modern JVM ignores it.

---

## 5. `invokestatic`

```
1. Resolve method ref.
2. Pop args (no receiver).
3. Push args, jump to method.
```

No receiver, no vtable. Direct dispatch.

If the class isn't initialized, `<clinit>` runs first.

---

## 6. `invokespecial`

Used for:
- Constructors (`<init>`)
- `super.method(...)` (the resolved method is in the superclass)
- `private` method calls (in older bytecode; Java 11+ uses `invokevirtual` for some private dispatches)

```
1. Resolve method ref.
2. Pop receiver and args.
3. Search the resolved class (NOT the receiver's klass) for the method.
4. Invoke.
```

This is what guarantees `super.m()` calls the parent's `m`, even if the receiver has further overrides.

---

## 7. `invokedynamic`

```
1. Resolve the indy CallSite (first call only).
2. Bind the call site to the resolved target.
3. Invoke through the bound target.
```

The bootstrap method is called once. After that, the call site is essentially a direct call (or a small inline cache, depending on the bootstrap).

Used by:
- Lambdas (LambdaMetafactory)
- String concatenation (StringConcatFactory)
- Pattern matching (SwitchBootstraps)
- Records (ObjectMethods)

---

## 8. Method resolution algorithm

JVMS §5.4.5: for an `invokevirtual`-style dispatch:

1. Start with the receiver's class C.
2. If C declares a method matching (name, descriptor), use it.
3. Otherwise, search up the class hierarchy.
4. If still not found, search interface tables (with maximally-specific matching).
5. If still not found, throw `AbstractMethodError` or `IncompatibleClassChangeError`.

For `invokestatic`/`invokespecial`, the resolution is at link time, not runtime.

---

## 9. `OopMap` and dispatch

For GC safety, the JVM maintains OopMaps describing which stack/register slots contain object references at each safepoint. Method dispatch points are safepoints.

This means GC can move objects (compacting) while threads are at dispatch sites, and update references correctly.

---

## 10. Inline cache implementation

HotSpot's inline cache stores at the call site:
- Klass pointer (the receiver's class for which this is bound)
- Target method pointer

On invocation:
1. Compare receiver klass to cached klass.
2. If match → direct call to cached target.
3. If mismatch → slow path (vtable lookup, possibly transition to bimorphic/megamorphic).

For monomorphic sites, this is one compare + one direct call.

---

## 11. JIT compilation tiers

HotSpot's tiered compilation:
- Tier 0: interpreter
- Tier 1-3: C1 (client compiler) — fast compilation, simple optimization
- Tier 4: C2 (server compiler) — slower compilation, aggressive optimization

For dispatch:
- Tier 0: full vtable lookup every call.
- Tier 1-3: inline caches.
- Tier 4: aggressive inlining via CHA, escape analysis, etc.

---

## 12. Devirtualization in C2

C2's devirtualization phase:
1. Look up the receiver's static type bound.
2. Use CHA to find all loaded subclasses that override.
3. If only one (or none), inline as direct call.
4. Otherwise, emit a polymorphic dispatch (with possible deopt).

If a new subclass loads later and overrides, C2 deoptimizes the affected code.

---

## 13. Key bytecode hints to know

- `final void m()` → `invokevirtual` but JIT-friendly.
- `private void m()` → `invokespecial` (or `invokevirtual` since Java 11).
- `static int m()` → `invokestatic`.
- `super.m()` → `invokespecial` to the superclass.
- Lambda → `invokedynamic`.
- Records' equals → `invokedynamic`.

---

## 14. Where the spec says it

| Topic                             | Source            |
|-----------------------------------|-------------------|
| Method invocation                 | JLS §15.12         |
| `invoke*` opcodes                 | JVMS §6.5          |
| Method resolution                 | JVMS §5.4.5        |
| Class file format                 | JVMS §4            |
| JIT documentation                  | OpenJDK Wiki, HotSpot internals |

---

**Memorize this**: dispatch is the JVM's job, expressed via five `invoke*` opcodes. `invokevirtual`/`invokeinterface` are dynamic; others are direct. The JIT inlines monomorphic call sites; CHA enables devirtualization of non-final methods. Read `javap -c` to see what your code compiles to.
