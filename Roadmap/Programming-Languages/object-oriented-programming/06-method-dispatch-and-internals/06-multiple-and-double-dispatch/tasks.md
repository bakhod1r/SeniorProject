# Multiple & Double Dispatch — Tasks

Hands-on, graded easy → hard. Most require only the JDK (`javac`, `java`, `javap`). The last tier uses JMH. Each task has explicit acceptance criteria — you should be able to *prove* the result, not just believe it.

> Set up a scratch directory and use `javac X.java && javap -c -p X` throughout. The whole point of this topic is that you never have to guess which method is dispatched — the bytecode tells you.

---

## Tier 1 — See static binding with your own eyes

### Task 1.1 — The overloading trap, proven
Write a class with `String pick(Object)` and `String pick(String)`, and a method that does `Object o = "hi"; pick(o);`.

- [ ] Run `javap -c -p` and locate the `invokestatic`/`invokevirtual` for `pick`.
- [ ] **Acceptance:** the constant-pool descriptor reads `pick:(Ljava/lang/Object;)...`, proving the `Object` overload was chosen at compile time despite the runtime value being a `String`. Write one sentence explaining why.

### Task 1.2 — Widening beats boxing
Write `g(long)` and `g(Integer)` overloads; call `g(1)`.

- [ ] Predict the output, then run it.
- [ ] **Acceptance:** output is `long`. Explain using the three applicability phases (Phase 1 widening vs Phase 2 boxing). Then change the literal to `Integer.valueOf(1)` and re-run; explain the new result.

### Task 1.3 — `null` ambiguity
Write `h(String)` and `h(Object)`; call `h(null)`.

- [ ] **Acceptance:** prints `String` (most specific reference type). Now add `h(Integer)` and recompile.
- [ ] **Acceptance:** compilation now *fails* with "reference to h is ambiguous". Fix it with a cast and explain why the cast resolves it.

---

## Tier 2 — Build and dissect a Visitor

### Task 2.1 — Minimal Visitor
Implement `Shape` (sealed: `Circle`, `Square`), a generic `Visitor<R>`, `accept`, and an `AreaVisitor implements Visitor<Double>`.

- [ ] **Acceptance:** `new Circle(2).accept(new AreaVisitor())` returns `4π`. No `instanceof`, no casts anywhere.

### Task 2.2 — Count the dispatches in bytecode
Run `javap -c -p` on `Circle` and on the client calling `shape.accept(v)`.

- [ ] **Acceptance:** identify **exactly two** `invokeinterface` instructions across the two methods — one for `accept`, one for `visitCircle` — and annotate which is hop 1 and which is hop 2.

### Task 2.3 — Add an operation, then a type
Add a second visitor `PerimeterVisitor`.

- [ ] **Acceptance:** you edited *zero* existing files (only added a new class). This is Visitor's cheap axis.

Now add a third shape `Triangle`.

- [ ] **Acceptance:** list every file you had to edit (`Shape` permits, `Visitor` interface, *and every existing visitor*). This is Visitor's expensive axis. Write two sentences relating this to the expression problem.

---

## Tier 3 — Pattern switch and the modern path

### Task 3.1 — Switch equivalent
Reimplement `area(Shape)` as a Java 21 pattern `switch` over the sealed `Shape`, with no `default`.

- [ ] **Acceptance:** it compiles without `default` (exhaustiveness). Delete the `Square` case and confirm a *compile error*, proving exhaustiveness checking.

### Task 3.2 — How the switch lowers
Run `javap -c -v` on the switch method.

- [ ] **Acceptance:** find the `invokedynamic ... typeSwitch` and the bootstrap entry naming `java/lang/runtime/SwitchBootstraps.typeSwitch`, plus the `lookupswitch`. Confirm there is **no** chain of `instanceof` opcodes. Write down the case labels passed as bootstrap method arguments.

### Task 3.3 — Add a type, switch edition
Add `Triangle` to the sealed hierarchy but *do not* touch the switch.

- [ ] **Acceptance:** the switch method now fails to compile (non-exhaustive). Contrast with Task 2.3: the compiler *found the edit for you* here, but you had to hunt manually with Visitor. Note which axis (types vs operations) each makes cheap.

### Task 3.4 — `instanceof` chain comparison
Write the same `area` as an `if/else if` chain of `instanceof` patterns over a *non-sealed* `Shape`.

- [ ] **Acceptance:** add a `Triangle` subtype and confirm the chain compiles *silently* (no error, falls through to the `else`/throw). Explain why this is the most dangerous of the three encodings.

---

## Tier 4 — Symmetric multiple dispatch

### Task 4.1 — Collision handler map
Implement `collide(Body a, Body b)` for `Asteroid` and `Spaceship` using a `Map<Pair<Class<?>,Class<?>>, BiFunction<Body,Body,String>>` with a symmetry fallback (try the swapped key).

- [ ] **Acceptance:** `collide(asteroid, ship)` and `collide(ship, asteroid)` return the *same* result with only one registered entry. Adding a `Comet` requires registering its pairs but editing no existing handler bodies.

### Task 4.2 — Visitor encoding of the same
Encode the same collision matrix with a double-dispatch Visitor (`a.collideWith(b)` → `b.collideWithAsteroid(a)` etc.).

- [ ] **Acceptance:** count the method bodies needed for N=2 (should be N² = 4 directional methods) and state how many you'd need for N=3. Write one sentence on why the handler map scales better for sparse symmetric matrices.

---

## Tier 5 — Performance (JMH)

### Task 5.1 — Benchmark the three encodings
Set up a JMH project benchmarking, over a *heterogeneous* array of shapes, `area` computed via: (a) Visitor, (b) sealed pattern switch, (c) `instanceof` chain. Use a mix that makes the `accept` site megamorphic (3+ shape types, randomly interleaved).

- [ ] **Acceptance:** report `ns/op` for all three with error bars. State which is fastest and whether Visitor went megamorphic (cross-check with `-prof perfasm` or `-XX:+PrintInlining` showing the `accept` site *not* inlined).

### Task 5.2 — Monomorphic vs megamorphic
Re-run Task 5.1's Visitor benchmark with (a) a single shape type only, then (b) the heterogeneous mix.

- [ ] **Acceptance:** show the monomorphic case is substantially faster and explain via inline caching — the monomorphic `accept` inlines both hops; the megamorphic one cannot. Quantify the gap.

### Task 5.3 — `PrintInlining` evidence
Run the Visitor benchmark with `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining`.

- [ ] **Acceptance:** find the line for the `accept` call site and confirm it says `not inlined (virtual call)` or `megamorphic` in the heterogeneous case, versus inlined in the monomorphic case. Paste the relevant lines.

---

## Stretch — cross-language

### Task 6.1 — Groovy runtime dispatch
If you have Groovy, port Task 1.1's `pick(o)` to a Groovy script and run it.

- [ ] **Acceptance:** it prints `String` (runtime dispatch), the *opposite* of Java. One sentence: what does this prove about where overload-resolution timing is decided?

### Task 6.2 — Clojure multimethod
If you have Clojure, implement `collide` with `defmulti`/`defmethod` dispatching on `[(:type a) (:type b)]`.

- [ ] **Acceptance:** adding a `[:comet :asteroid]` method requires *no* edit to existing methods and no `accept` boilerplate. Contrast with Task 4.2's Visitor in two sentences.

---

**Done when:** you can, for any `obj.m(args)`, predict from `javap` which overload was bound at compile time; you can build and dissect a two-hop Visitor; you can convert it to a sealed pattern switch and read its `typeSwitch` bytecode; and you have JMH numbers showing when a Visitor goes megamorphic and loses to a switch.
