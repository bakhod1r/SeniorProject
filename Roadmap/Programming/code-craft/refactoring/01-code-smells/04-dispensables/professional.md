# Dispensables — Professional Level

> Runtime cost, JVM internals, and detection-tool internals.

---

## Table of Contents

1. [The runtime cost of dispensables](#the-runtime-cost-of-dispensables)
2. [Dead code elimination by the JIT](#dead-code-elimination-by-the-jit)
3. [Inline caching of unused interfaces](#inline-caching-of-unused-interfaces)
4. [Memory cost of Lazy Classes](#memory-cost-of-lazy-classes)
5. [Duplicate code and JIT inlining](#duplicate-code-and-jit-inlining)
6. [Speculative Generality and devirtualization](#speculative-generality-and-devirtualization)
7. [Static analysis tool internals](#static-analysis-tool-internals)
8. [Review questions](#review-questions)

---

## The runtime cost of dispensables

| Smell | Runtime cost |
|---|---|
| Comments | Zero (stripped at compile / not in bytecode) |
| Duplicate Code | Possibly *better* than DRY — easier to inline, fewer call sites |
| Lazy Class | Small — class metadata loaded |
| Data Class | Zero (just data) |
| Dead Code | Zero IF JIT/AOT can prove unreachable; otherwise small (in bytecode) |
| Speculative Generality | Megamorphic call sites if abstraction unused |

> **Counterintuitive insight:** sometimes **duplication outperforms abstraction**. A copy-pasted hot loop that's specialized for its caller may inline better than a shared abstraction that has megamorphic dispatch.

---

## Dead code elimination by the JIT

HotSpot performs **dead code elimination** (DCE) during compilation. Examples eliminated:

- `if (false) { ... }` — branch removed.
- `if (CONST_FALSE) { ... }` — same, after constant propagation.
- Unreachable code after `throw` or `return`.
- Variables computed but never used.

DCE is well-developed; the JIT is aggressive. Source-level dead code (commented-out, unused private methods) doesn't even reach DCE — it's never compiled if the JIT determines no caller exists.

### What DCE *can't* eliminate

- Method bodies of `public` methods (callable from outside).
- Code reached via reflection (`Class.forName`, `Method.invoke`).
- Code referenced by debug info / stack trace generation.

So a "dead" `public` method still occupies bytecode space and class metadata, even if no static caller exists.

### Source-code DCE for delivery

Tools like ProGuard (Java/Android), R8 (Android), Closure Compiler (JS), Webpack tree-shaking (JS) perform DCE at build time, removing unreachable code from the artifact. This shrinks app size, reduces attack surface, speeds up startup.

For server-side Java, ProGuard is usually skipped — server apps care less about size, and reflection commonly defeats DCE anyway.

---

## Inline caching of unused interfaces

If you have an interface with one implementation:

```java
interface PaymentProcessor { void process(); }
class StripeProcessor implements PaymentProcessor { ... }

PaymentProcessor p = new StripeProcessor();
p.process();
```

The JIT sees:
- The call site is monomorphic (only `StripeProcessor` ever appears).
- Devirtualization: direct call to `StripeProcessor.process()`.
- Inlining: `process()` body inlined into the caller.

Net cost: same as direct call. The Speculative Generality is *free at runtime*.

### When it stops being free

If you start passing different implementations (test mocks count!) at the same call site, the IC transitions to bimorphic, then megamorphic. Now the abstraction has runtime cost.

This is why "interface for testability" arguments are sometimes empirically weaker than they sound — adding the interface for tests degrades production performance if mocks reach production paths (e.g., shared call sites with both real and test implementations).

---

## Memory cost of Lazy Classes

Each loaded class in the JVM occupies ~1-2KB of metaspace:
- Class file (compact encoding of fields, methods, constants).
- VTable.
- Method table.
- Reflection metadata.

A codebase with 5,000 classes uses ~10MB of metaspace. A codebase with 50,000 classes uses ~100MB+ — and class loading is on the critical path of startup.

**Lazy Classes accumulate.** A 2-line wrapper class still occupies ~1KB. 10,000 such classes = 10MB of overhead with no value.

Modern frameworks (Spring Boot, Quarkus) trade this off:
- Spring Boot: traditional JVM, more classes, slower startup but flexible.
- Quarkus / native-image: AOT compilation removes unused classes, very fast startup, less flexibility.

---

## Duplicate code and JIT inlining

A duplicated 20-line hot loop in two callers:
- Each caller has its own copy.
- JIT sees each loop in its actual context — can specialize differently per caller.
- Total: two compiled bodies, each optimized for its caller.

A DRY version:
- One method with the loop; two callers.
- JIT may inline the method into both callers (same end result).
- *Or* the JIT keeps the method as a real call site — slower than inline.

The decision turns on:
- **Method size**: small methods inline easily; large methods don't.
- **Caller count**: 2 callers usually inline; 100 callers may not (`InlineSmallCode` budget).
- **Polymorphism at the call site**: monomorphic inlines; megamorphic doesn't.

**Conclusion:** for *cold* code, DRY is fine. For *hot* code, profile before unifying — sometimes leaving a copy is the right call.

---

## Speculative Generality and devirtualization

Recall (from OO Abusers): JIT inline caches start uninitialized and transition based on observed types.

A monomorphic call site (one implementation) is *as fast as* a direct call. So Speculative Generality *that stays monomorphic* costs nothing at runtime.

But:
- If a test mock and a real implementation share the call site, you transition to bimorphic.
- A second real implementation (added later) → bimorphic or polymorphic.
- A third → polymorphic.
- A fourth+ → megamorphic, vtable cost.

The "speculative" abstraction starts fast, can degrade as variants are added.

---

## Static analysis tool internals

### vulture (Python)

`vulture` parses Python source to AST, builds a graph of definitions and references, marks unreachable nodes:

```python
# Example AST traversal:
# Walk: imports, function defs, class defs.
# Walk: function bodies, class bodies, gather Name uses.
# Compute: definitions - uses = unused.
```

Limitations:
- Reflection (`getattr`, `__import__`) defeats it.
- String-based references (`hasattr`, `eval`) defeat it.
- Decorator-based registries (Flask routes, click commands) often appear unused.

Mitigation: whitelist known false positives.

### golangci-lint (Go)

Composes multiple linters: `unused`, `deadcode`, `unparam`, `varcheck`, `structcheck`. Each runs its own pass. The Go compiler's standard lint is fast (sees the whole package); cross-package detection requires `staticcheck`.

### IntelliJ "Unused declaration"

Uses Java's class hierarchy + reference graph. Knows about:
- Reflection annotations (Spring's `@Service`, JPA's `@Entity`).
- Test method conventions (`@Test`).
- Public API exclusion modes (configured per-project).

More accurate than command-line linters but only available in the IDE.

### Token-based duplicate detection (PMD CPD, jscpd)

1. Tokenize source code (strip comments, normalize whitespace).
2. Hash sliding windows of N tokens.
3. Find matching hashes — those are duplicates.

Strengths: language-agnostic (just tokens), fast.
Weaknesses: doesn't recognize semantic equivalence (different syntax, same logic).

For semantic equivalence, you'd need program-graph analysis — much rarer in production tools.

---

## Review questions

1. **Why doesn't dead code consume runtime memory in compiled languages?**
   The compiler / linker can prove unreachability and strip it from the binary. For interpreted languages (Python), unused functions still occupy runtime memory until the module is unloaded.

2. **A method has 100 callers, all with similar logic before the call. Refactor?**
   Probably. Extract a wrapper that does the common logic and calls the method. Performance: fine — JIT inlines small wrappers. Maintenance: huge win.

3. **A class has 200 fields, all `public`. Data Class smell?**
   Yes, and a Large Class smell, and probably an Inappropriate Intimacy smell. Cure: Encapsulate Field, then Move Method to add behavior, then Extract Class.

4. **A `final` class with no public constructor and one static method. Lazy?**
   Possibly. Could be a sealed namespace (Java idiom). Java's standard library has many: `java.util.Collections`, `java.util.Arrays`. Not a smell when it's a documented utility container.

5. **GraalVM native-image on a codebase with lots of reflection — risk?**
   GraalVM AOT-compiles all reachable code. Reflection-only code may be missed → runtime errors. Solution: configure reflection metadata files. Effort scales with reflection usage.

6. **Dead code in JS bundle — why does it matter more than dead Java code?**
   Browsers download every byte. Server-side Java can tolerate megabytes of dead bytecode (loaded once); client JS adds latency (parse + compile per page load). Tree-shaking is critical for JS.

7. **Why is duplicate code "fast" but DRY sometimes slow?**
   Inline caches: a duplicated loop is monomorphic at each call site. A DRY method called from many places may become megamorphic. The duplicate keeps the JIT happy.

8. **`vulture` reports an unused function. Always safe to delete?**
   No. Verify with: `grep -r function_name`, check for reflection (`getattr`, `__init__` re-exports), framework decorators (Flask routes, pytest fixtures). Some frameworks' usage is invisible to static analysis.

9. **Comments don't have runtime cost — so what's the harm?**
   Cognitive cost during reading and editing. The runtime view is incomplete; the human view is what matters for maintainability. Bad comments mislead — sometimes worse than missing comments.

10. **Inline Class — what does the JIT see after?**
    Same code, different layout. If the inlined class was already inlined by the JIT (small monomorphic methods), nothing changes. If the inlined class was a megamorphic abstraction, inlining at the source level helps the JIT specialize.

---

> **Next:** [interview.md](interview.md) — Q&A.
