# Designing for Extension & Polymorphism — Tasks

Hands-on exercises, easy → hard. Each has explicit acceptance criteria. Do them in real Java (17+; some need 21 for pattern switches). Verify with `javac`/`javap`/JMH where noted.

---

## Easy

### T1 — Replace a type-switch with polymorphism
Start from:
```java
enum Kind { CIRCLE, SQUARE, TRIANGLE }
record Shape(Kind kind, double a, double b) {}
double area(Shape s) {
    return switch (s.kind()) {
        case CIRCLE   -> Math.PI * s.a() * s.a();
        case SQUARE   -> s.a() * s.a();
        case TRIANGLE -> 0.5 * s.a() * s.b();
    };
}
double perimeter(Shape s) { /* a second switch on the same kind */ }
```
Refactor to a `Shape` interface with `Circle`/`Square`/`Triangle` implementations, each carrying `area()` and `perimeter()`.

**Acceptance:** no `switch (kind)` remains; adding a `Pentagon` requires *only* a new class and zero edits to `area`/`perimeter` callers. Both switches are gone.

### T2 — Strategy via a functional interface
Given an `Archiver` that hard-codes gzip compression, extract a `Compressor` seam.

**Acceptance:** `Compressor` is a single-method `@FunctionalInterface`; `Archiver` takes it via constructor; you can wire `new Archiver(data -> data)` (no-op) and a gzip lambda without changing `Archiver`. The concrete choice lives only in a `main`/factory.

### T3 — Make a class correctly closed
Take a plain `class TaxRule { ... }` with no subclasses intended.

**Acceptance:** the class is `final`; attempting `class X extends TaxRule {}` is a compile error you've verified. Write one sentence justifying the `final` (Bloch Item 19).

---

## Medium

### T4 — Template Method with a `final` skeleton
Implement an abstract `ImportJob` whose `final run()` does `open() → readRows() → validate(row) → persist(row) → close()` in that fixed order. Make `validate` and `persist` `abstract`; `open`/`close` default no-ops.

**Acceptance:** a `CsvImportJob` subclass supplies only `validate`/`persist`; it *cannot* override `run` (compile error if it tries); the step order is guaranteed. Add a test proving `close()` runs even when `persist` throws (use `try/finally` in the template).

### T5 — Sealed type + exhaustive switch (operation-axis growth)
Model `sealed interface Json permits JNull, JBool, JNum, JStr, JArr, JObj`. Write two *external* operations as exhaustive switches: `String toJsonText(Json)` and `int depth(Json)`. Use **no `default` branch**.

**Acceptance:** both compile with no `default`. Add a 7th variant `JDate` and confirm *both* switches now fail to compile until updated. Explain in a comment why this is the desired Expression-Problem behaviour for operation-heavy growth.

### T6 — Abstract Factory for a consistent family
Build a `UiFactory` producing matched `Button` + `Scrollbar`. Implement `DarkUiFactory` and `LightUiFactory`. A `Toolbar` takes a `UiFactory`.

**Acceptance:** `Toolbar` never names a concrete widget; swapping themes is one wiring change; you *cannot* accidentally pair a dark button with a light scrollbar (the factory guarantees the family).

### T7 — Decide and defend: seam or no seam
You're given three scenarios:
(a) one tax calculation, no second planned; (b) two shipping rules now, a third on the roadmap; (c) an `if (user.age() >= 18)` check.

**Acceptance:** for each, write 2–3 sentences: add a seam / don't / not a polymorphism case — and *why*, citing YAGNI, Protected Variations, or "values not types". Correct answers: (a) no seam yet, (b) add the Strategy seam, (c) not polymorphism (value check).

---

## Hard

### T8 — Design an extensible plugin API end to end
Build an `ImageCodec` SPI: `interface ImageCodec { boolean canDecode(byte[] header); BufferedImage decode(InputStream in); }`. An `ImageReader` discovers codecs via `ServiceLoader` and dispatches by header.

**Acceptance:**
- `ImageReader` is compiled *before* any codec exists and references no concrete codec.
- A `PngCodec` in a separate source set/jar is discovered via `META-INF/services/` (or JPMS `provides`) with zero edits to `ImageReader`.
- Dropping a second `BmpCodec` jar adds the format with no recompilation of the reader.
- Write the contract Javadoc: what `canDecode` may assume about the header length, threading, and stream position.

### T9 — Evolve a published seam without breaking implementers
Take the `ImageCodec` from T8, already implemented by `PngCodec` and `BmpCodec` (pretend you don't own them). You must add an `encode` capability.

**Acceptance:** produce *two* evolution strategies and implement one:
1. a `default` method approach, and
2. a separate `Encodable` capability interface with an `instanceof` check at the call site.
Run `japicmp` (or reason explicitly via JLS §13.5.6) to prove your chosen change is binary-compatible — i.e. `PngCodec`/`BmpCodec` still compile and load unchanged. State why adding a plain `abstract encode` would have broken them.

### T10 — Diagnose and fix an unsafe-for-subclassing base class
Given:
```java
public class Cache {
    public Cache() { warmUp(); }                 // (1)
    protected void warmUp() {}
    public void put(K k, V v) { store(k, v); evictIfNeeded(); }   // (2) self-use
    protected void evictIfNeeded() {}
}
```
Two extensibility hazards are present.

**Acceptance:** identify both: (1) overridable call in constructor (override runs before subclass fields init), (2) undocumented self-use (`put` calls `evictIfNeeded`; a subclass can't override safely without knowing). Fix by: removing the constructor callback (or making `warmUp` not overridable), documenting self-use in `@implSpec` Javadoc, and marking non-hook methods `final`. Provide a subclass that *would* have crashed under the original and now works.

### T11 — `javap`/dispatch investigation
For T1's `Shape.area()` call site and T5's `toJsonText` switch, inspect the bytecode.

**Acceptance:** using `javap -c -p`, identify the dispatch instruction for the polymorphic `area()` call (`invokeinterface`/`invokevirtual`) and for the sealed-`switch` (`invokedynamic` against `SwitchBootstraps.typeSwitch` on Java 21, or `instanceof` chain on 17). Write one paragraph: why monomorphic versions of each are effectively free after JIT inlining, and what would make the `area()` site megamorphic.

### T12 — Measure change-cost (capstone)
Take any existing small project (or T8's reader). Implement *the same feature kind* twice — once before introducing a seam (edit existing code) and once after (add a new implementation).

**Acceptance:** report files-touched and lines-changed for each. Show the post-seam feature touches *one new file* and zero existing files. If it doesn't, diagnose whether the seam is on the wrong axis (Expression Problem) or leaking. One paragraph of analysis.

---

## Stretch

### T13 — `non-sealed` controlled re-opening
Design `sealed interface Event permits SystemEvent, UserEvent` where `SystemEvent` is `final` but `UserEvent` is `non-sealed` so application teams can add their own user events while the system-event set stays closed.

**Acceptance:** an exhaustive switch over `Event` handles `SystemEvent` cases precisely but treats `UserEvent` as one open branch; a downstream team adds `LoginEvent extends UserEvent` without modifying the core. Explain the "closed at the top, open in one wing" design intent.

---

### How to verify your work

- `javac` everything; warnings-as-errors (`-Werror -Xlint:all`) for the inheritance tasks.
- `javap -c -p` for T11.
- `japicmp -o old.jar -n new.jar --error-on-binary-incompatibility` for T9.
- For any seam you add, ask: *did adding the new variant touch one new file and zero existing ones?* If not, the seam is wrong-axis or leaking — revisit `senior.md` §2.
