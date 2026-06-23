# vtable and itable — Specification

> The JVMS does not require a "vtable" or "itable" by name — those are HotSpot implementation details. What the JVMS does require is *the semantics of method resolution and selection* (§5.4.3.3, §5.4.6) and the bytecode instructions (`invokevirtual`, `invokeinterface`, etc.) that drive them. HotSpot implements those semantics with vtables and itables. This file maps the JVMS sections to the HotSpot source files that translate them into structures you can inspect.

---

## 1. JVMS §2.6 — Frames and method invocation context

§2.6 ("Frames") is where the JVMS sets up the model: each method invocation creates a frame, and the frame contains a reference to the runtime constant pool of the class whose method is being executed. Method resolution happens against that constant pool. This is the abstract base on which `invokevirtual` and `invokeinterface` build.

The JVMS doesn't say "look in a vtable". It says "find the method that satisfies the resolution algorithm in §5.4.3.3 and the selection algorithm in §5.4.6". HotSpot precomputes the answer for `invokevirtual` (a vtable slot index) and partially precomputes it for `invokeinterface` (an itable per implemented interface). That precomputation is the JVM's freedom; the JVMS only constrains the result.

---

## 2. JVMS §4.10 — Verification informs vtable construction

Before a class is linked, its bytecode is verified (§4.10). Verification establishes structural facts the JVM uses during vtable construction:

- Every `invokevirtual` references a method that exists on a class (not an interface) reachable via the receiver's static type.
- Every `invokeinterface` references a method on an interface that the receiver implements.
- Override compatibility (return type, exceptions) is enforced syntactically.

A class that fails verification never gets a vtable — its `Klass` is rejected. This is why broken class files don't cause "method resolution panics" at call time: they're caught at load.

---

## 3. JVMS §5.3 — Class loading triggers vtable allocation

§5.3 describes how a class is loaded: bytes are obtained (§5.3.5), parsed into the internal representation, and linked. Linking (§5.4) is what allocates the vtable in HotSpot — specifically, the "preparation" subphase (§5.4.2) allocates static field storage *and* triggers the methods of `klassVtable` that compute the table size.

The JVMS itself doesn't mandate a per-class table; it just specifies that "preparation" must be done before initialization. HotSpot uses this gap to build its dispatch tables. Other JVMs (J9, Azul Zing, GraalVM SVM) implement preparation differently but produce semantically identical results.

---

## 4. JVMS §5.4.3.3 — Method resolution algorithm

The canonical algorithm for resolving a method reference. Quoting the structure (paraphrased):

1. If `C` is an interface, throw `IncompatibleClassChangeError`.
2. Look up the method in `C` directly by name and descriptor.
3. If not found, recursively look up in `C`'s superclass chain.
4. If not found, look up in the maximally-specific superinterface method.
5. If still not found, look up any non-private, non-static superinterface method.

This is the algorithm that, at link time, decides "for `invokevirtual #M`, the method I'm targeting is method X on class Y". HotSpot caches the answer — that's the vtable index. Subsequent calls don't redo the search.

For `invokeinterface`, §5.4.3.4 (Interface Method Resolution) is the parallel section. The selected method becomes an entry in the itable.

---

## 5. JVMS §5.4.5 — Method overriding

§5.4.5 defines when method `m1` in class `C` overrides method `m2` in superclass `S`:

- Same name.
- Same parameter descriptors (post-erasure).
- The method in `S` is not `private`, `static`, or `final`.
- The method in `C` is accessible to `S` (visibility rules).

This is the spec that says "if you correctly override a method, the call site that pointed at the parent now points at your override". HotSpot implements it by reusing the parent's vtable slot index when patching the subclass's vtable.

Important corner case: if the methods would otherwise override but the visibility check fails (e.g., parent is `package-private` and subclass is in a different package), the subclass method gets a *new* vtable slot rather than overriding. This produces surprising behaviour where `parent.m()` and `child.m()` resolve to different methods even though they have the same name and signature.

---

## 6. JVMS §5.4.6 — Method selection

§5.4.6 is where dynamic dispatch happens. Given the resolved method (from §5.4.3.3) and the actual receiver type, selection finds *the* method to invoke. The algorithm walks the receiver's class hierarchy looking for the most specific override of the resolved method.

For `invokevirtual`: this is equivalent to "look at slot N of the receiver's vtable" because HotSpot precomputed the slot during the resolved method's vtable construction.

For `invokeinterface`: this is "find the itable for the resolved interface in the receiver's klass, then look at slot M of that itable".

For `invokespecial` (super calls, private methods, constructors): selection bypasses §5.4.6 entirely — the resolved method *is* the selected method. No vtable load. This is why `super.m()` is fast.

For `invokestatic`: no receiver, no selection, no vtable.

---

## 7. JVMS §5.4.3.3 — Default methods and the maximally-specific rule

When a class inherits a method from multiple interfaces (one with a default implementation, others not), JVMS §5.4.3.3 defines the *maximally specific* rule:

- Among the inherited methods, find the maximally specific one — the one whose declaring interface is a subinterface of every other candidate's interface.
- If there's exactly one maximally specific method, that's the selected one.
- If there's more than one, throw `IncompatibleClassChangeError` at the call site.

This is the source of the famous "diamond problem" resolution in Java 8+ default methods. The itable stores the selected method; HotSpot sets up the throw at class load time if the selection is ambiguous. See `find-bug.md` Bug 5.

---

## 8. HotSpot source pointers

Mapping JVMS sections to HotSpot source (paths within the OpenJDK repo, `src/hotspot/share/oops/`):

| JVMS section                       | HotSpot source                                  | What lives there                                  |
| ---------------------------------- | ------------------------------------------------ | ------------------------------------------------- |
| §5.3 class loading                  | `classfile/classFileParser.cpp`                  | Bytecode -> in-memory Klass candidate             |
| §5.4.2 preparation, vtable size   | `oops/klassVtable.cpp`                           | `compute_vtable_size_and_num_mirandas`            |
| §5.4.3.3 method resolution         | `interpreter/linkResolver.cpp`                   | `LinkResolver::resolve_method`                    |
| §5.4.5 overriding                  | `oops/method.cpp`, `oops/klassVtable.cpp`        | `Method::is_overriding`, `klassVtable::update`    |
| §5.4.6 method selection            | `oops/klassVtable.cpp`, `oops/klassItable.cpp`   | `index_of_receiver_method`                        |
| `Klass` data structure              | `oops/klass.hpp`                                  | Header of every class metadata                    |
| `InstanceKlass` (full instance class) | `oops/instanceKlass.hpp`                       | Holds vtable, itables, secondary supers           |
| Itable entries                     | `oops/klassItable.hpp`                           | `itableOffsetEntry`, `itableMethodEntry`          |
| Secondary super check              | `oops/klass.hpp::is_subtype_of`                  | The hashed cache + linear scan fallback           |

These files have read-friendly comments. `klassVtable.hpp` opens with a clear explanation of slot allocation; `klassItable.hpp` describes the per-interface offset table layout. Reading them is the closest you can get to the JVM's understanding of these structures.

---

## 9. Where vtables live in memory

The `InstanceKlass` for class `C` is laid out roughly as:

```
[InstanceKlass header fields]
[vtable: ptr, ptr, ptr, ... ]            // contiguous Method* pointers
[itable: header[], entries[]]            // offset table + per-interface method arrays
[secondary supers]
[fields, methods, constant pool refs ... ]
```

This is metaspace memory (since JDK 8 — before that, the permanent generation). The total `InstanceKlass` footprint per loaded class is typically 1-10 KB for ordinary classes, more for ones with many fields or interfaces. Vtables are a meaningful fraction of metaspace in large applications.

The `Klass*` (sometimes a compressed klass pointer in the object header) is what every object instance carries; that's how the JVM gets from "this object" to "this class's vtable" in one load.

See [../04-object-memory-layout/](../04-object-memory-layout/) for the object-side picture and how `mark word + klass pointer` fit into the 12 (or 16) bytes of header.

---

## 10. Diagnostic flags

HotSpot exposes some — but not many — flags for inspecting vtables and itables. Most require `-XX:+UnlockDiagnosticVMOptions`:

| Flag                                            | What it shows                                                  |
| ----------------------------------------------- | -------------------------------------------------------------- |
| `-XX:+PrintVtables`                              | Vtable contents on class load. Internal/diagnostic. Verbose.   |
| `-XX:+PrintItables`                              | Itable contents on class load. Internal/diagnostic. Verbose.   |
| `-XX:+PrintCompilation`                          | When JIT compiles a method.                                    |
| `-XX:+PrintInlining`                             | Inlining decisions per call site; marks (megamorphic) etc.    |
| `-XX:+PrintMethodData`                           | Per-call-site type profiles C2 uses.                           |
| `-Xlog:class+load=info`                          | Each class as it loads (good for startup-time analysis).       |
| `-XX:+TraceClassResolution`                      | Each class-resolution event.                                   |
| `-XX:+TraceItables` (older builds)               | Trace of itable lookup events.                                 |

Most of these are too verbose for normal use; pipe to a file and grep for the class of interest.

For programmatic inspection, **HSDB** (`jhsdb hsdb`) is the supported tool. The CLI form is `jhsdb clhsdb` (command-line HSDB), useful in scripts: `printvtbl <klass>`, `printitbl <klass>`.

---

## 11. Bytecode dispatching — quick reference

| Bytecode          | JVMS section | Uses vtable? | Uses itable? | Cost model                |
| ----------------- | ------------ | ------------ | ------------ | ------------------------- |
| `invokestatic`    | §6.5         | No           | No           | Direct call               |
| `invokespecial`   | §6.5         | No           | No           | Direct call               |
| `invokevirtual`   | §6.5         | Yes          | No           | One indexed load          |
| `invokeinterface` | §6.5         | No           | Yes          | Secondary super + indexed |
| `invokedynamic`   | §6.5         | Indirect     | Indirect     | Method handle, varies     |

`invokedynamic` is special — it uses a `CallSite` and `MethodHandle`. Lambdas and string concat use it. The first invocation runs a bootstrap method that produces a `MethodHandle`, which the JVM then dispatches like a direct call (with the JIT inlining aggressively). The vtable/itable comes into play only if the method handle's target is itself a virtual or interface method.

---

## 12. What changes across JDK versions

- **JDK 8** introduced default methods; itables had to handle method selection per JVMS §5.4.3.3 (maximally specific rule). HotSpot's `klassVtable.cpp` got the miranda-method tweaks.
- **JDK 9** moved class metadata fully into metaspace; vtables are now in metaspace, not permgen.
- **JDK 17** introduced sealed types. Vtable structure unchanged, but CHA's job became easier.
- **JDK 21** integrated the hashed secondary-super check (referenced in HotSpot as JEP 8180450 / "Hash-Based Secondary Supers"). Itable lookup got faster for classes with many implemented interfaces.
- **CDS / AppCDS** (8+) precompute class loading work, including vtable layout, into a shared archive — startup speedup.
- **GraalVM Native Image** compiles vtables into static data at AOT time; no runtime construction.

The JVMS itself is stable across these — the spec doesn't change; the implementation does.

---

## 13. Cross-references in this section

- [../01-jvm-method-dispatch/](../01-jvm-method-dispatch/) — bytecode-level dispatch semantics, the abstraction one level above vtables.
- [../03-covariant-returns-and-bridge-methods/](../03-covariant-returns-and-bridge-methods/) — the generic-erasure story that adds vtable slots.
- [../04-object-memory-layout/](../04-object-memory-layout/) — `Klass*` in the object header, mark word, alignment.
- [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/) — design-level rationale for hierarchies that the vtable then implements.

---

## 14. Quick rules

- [ ] JVMS specifies *semantics* (resolution, selection); HotSpot implements them with vtables and itables.
- [ ] §5.4.3.3 = resolution; §5.4.5 = override rules; §5.4.6 = dynamic selection.
- [ ] HotSpot source: `klass.hpp`, `instanceKlass.hpp`, `klassVtable.cpp`, `klassItable.cpp`, `linkResolver.cpp`.
- [ ] Vtables live in metaspace, allocated during the "preparation" linking subphase.
- [ ] Diagnostic flags exist but are verbose; HSDB is the user-friendly tool.
- [ ] JVMS doesn't mention "vtable"; the word is HotSpot's.

---

**Memorize this:** the JVMS gives you the *semantic contract* (resolve at link time, select at call time, respect overriding and default-method rules). HotSpot's `klassVtable.cpp` and `klassItable.cpp` are how those rules become array indices. Knowing both — the spec and the implementation — lets you predict performance and read other JVMs' (Zing, J9, Native Image) trade-offs sensibly.
