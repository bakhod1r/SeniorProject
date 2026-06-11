# Composition Over Inheritance — Interview Questions

> **Category:** [Coupling & Cohesion](../../README.md) — prefer assembling behavior from has-a parts over building deep is-a class hierarchies.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. State the principle and its source.

**Answer:** "Favor object composition over class inheritance" — the Gang of Four, *Design Patterns* (1994). Prefer building a class from has-a parts it delegates to over an is-a class hierarchy. The word **favor** matters: it's a default, not a ban on inheritance.

### J2. What's the difference between composition and inheritance?

**Answer:** Inheritance is an *is-a* relationship — `class Car extends Vehicle` inherits the parent's code. Composition is a *has-a* relationship — `class Car { Engine engine; }` holds another object and calls its methods (delegation). Inheritance reuses code via the hierarchy; composition reuses it via a held object.

### J3. Give the is-a vs. has-a test.

**Answer:** Read the relationship aloud. "A *has a* B" → composition. "A *is a* B" (and a B can be substituted by an A everywhere) → inheritance is plausible. If you'd only inherit to reuse some code, that's a has-a in disguise — compose. `Car` *has an* `Engine`; `Car` *is a* `Vehicle`.

### J4. Why is inheritance considered risky?

**Answer:** Four reasons: (1) it's the strongest coupling — a subclass depends on the superclass's *internals* (fragile base class); (2) it's static — fixed at compile time, can't swap per instance; (3) it leaks implementation, breaking encapsulation; (4) it forces a single classification axis, so multiple independent variations cause a class explosion.

### J5. What is the class explosion problem?

**Answer:** When a class varies along several independent axes (e.g., weapon × armor × movement), inheritance needs one subclass per *combination*, so the count is the *product* of the axes (3×2×2 = 12) and grows multiplicatively with duplicated code. Composition makes each axis a separate has-a part, so the count is the *sum* (3+2+2 = 7) and any combination is just a construction.

### J6. What is delegation?

**Answer:** When an object handles a request by forwarding it to a component it holds — e.g., `Character.attack()` calls `this.weapon.attack()`. Delegation is the mechanism that makes composition work: the container delegates the actual behavior to its parts.

### J7. Does "favor composition" mean "never inherit"?

**Answer:** No. It's *favor* — a default. Inheritance is still right for a genuine, substitutable, shallow, stable is-a, and for framework Template-Method hooks (`extends Activity`, `extends TestCase`) where the base was designed for extension.

### J8. What's the "Penguin extends Bird" problem?

**Answer:** If `Bird` has `fly()`, every bird inherits it — but a `Penguin` can't fly. Overriding `fly()` to throw breaks callers expecting any `Bird` to fly. It shows that a sentence sounding like is-a ("a penguin is a bird") doesn't guarantee safe inheritance. The fix: a `Bird` *has a* movement behavior (composition) — penguins get walking, sparrows get flying.

### J9. Name a real-world class you'd build by composition, not inheritance.

**Answer:** A `Car`: it *has an* `Engine`, *has* `Wheels`, *has a* `Transmission` — none of those is an is-a relationship. A `Stack` *has a* list of items (it should not `extends Vector` — Java's mistake — because that leaks `insertAt`).

### J10. Which language has no inheritance, and how does it reuse code?

**Answer:** Go (and Rust). Go uses struct *embedding* and *interfaces*: you hold/embed a type and call its methods (composition), and achieve polymorphism through interfaces. That Go thrives without inheritance is the strongest practical evidence for the principle.

---

## Middle Questions

### M1. What is the fragile base class problem?

**Answer:** A subclass depends not just on *what* the superclass does but on *how* — specifically which of its own methods the superclass calls internally (self-calls). A behavior-preserving change to the base (same public API) can silently break subclasses that overrode those internally-called methods. Inheritance turns the base's private implementation choices into an unspoken contract.

### M2. Walk through Bloch's broken `InstrumentedHashSet`.

**Answer:** You `extends HashSet` and override `add` (++count) and `addAll` (count += c.size()). Adding three elements via `addAll` reports **6**, not 3: `HashSet.addAll` is internally implemented by calling `add` once per element, so `super.addAll` re-triggers the overridden `add` three more times. The bug exists because the subclass depended on an undocumented self-call. The fix is composition: a class that `implements Set`, *wraps* a `Set`, and forwards — `s.addAll` is a black box that never re-enters the wrapper's `add`, so it counts only at its own boundary (3). Bonus: the wrapper works with *any* `Set`, not just `HashSet`.

### M3. What's the difference between interface inheritance and implementation inheritance?

**Answer:** Interface inheritance = inheriting a *type/contract* (method signatures) for substitutability — `implements Set`. Implementation inheritance = inheriting *code* from a parent for reuse — `extends HashSet`. The principle warns specifically against the *implementation* kind; interface inheritance (subtyping) is healthy. The composed `InstrumentedSet` actually *uses* interface inheritance (`implements Set`) to avoid implementation inheritance.

### M4. What's the real test for a valid is-a?

**Answer:** Substitutability — the Liskov Substitution Principle. A subtype is a valid is-a only if it can replace the supertype *everywhere* with no caller able to tell (no broken behavior, no thrown surprises, no tightened preconditions). `Penguin`/`Bird` and `Square`/`Rectangle` both *sound* like is-a and both *fail* substitutability — so they should be composed, not inherited.

### M5. How do Strategy and Decorator relate to this principle?

**Answer:** They *are* the principle as named patterns. **Strategy** = "one behavior varies" → hold a swappable behavior object behind an interface; replaces "a subclass per variant." **Decorator** = "optional, stackable features" → wrap an object in same-interface wrappers, each adding one behavior, nested; replaces "a subclass per combination." Both pull variation out of the type hierarchy into a held object.

### M6. What are the mechanisms of composition?

**Answer:** Plain delegation (hold + forward), Strategy (swappable behavior behind an interface), Decorator (same-interface wrappers stacking behavior), dependency injection (receive parts via constructor), and mixins/traits (mix implementations in without a single base — Scala/Rust/Ruby/Python).

### M7. What's the cost of composition?

**Answer:** Forwarding boilerplate (hand-written one-line methods to expose the component's interface) and extra indirection / call depth. Inheritance gives those methods for free, which is why people over-inherit. Language features mitigate it: Kotlin `by` delegation, Go embedding, Lombok `@Delegate`.

### M8. When does inheritance genuinely earn its place?

**Answer:** Framework Template-Method hooks (base *designed and documented* for extension — its self-calls are the contract); a genuine, substitutable, shallow, stable is-a; and closed/sealed typed hierarchies (Kotlin `sealed`, Rust `enum`) for exhaustive matching. The common thread: it's about *being a substitutable type*, shallow, and the base built for it.

---

## Senior Questions

### S1. Why did the Gang of Four rank composition first, in coupling terms?

**Answer:** Inheritance is *white-box reuse* — the parent's internals are visible to subclasses, so subclasses couple to implementation (strongest coupling) and the base can't evolve safely; it also breaks encapsulation. Composition is *black-box reuse* — objects accessed only through interfaces, so coupling is the minimum (the published contract), encapsulation is preserved, and the relationship is established at *runtime* (dynamic, swappable) rather than compile time. The recommendation is a coupling-and-binding-time argument, not a slogan.

### S2. Explain the self problem / object schizophrenia.

**Answer:** With inheritance there's one object with one `self`, so a base method's self-call hits a subclass override (open recursion). With delegation-based composition there are *two* objects: when the wrappee self-calls one of its own methods, it calls *its* method, not the wrapper's override — the wrapper's specialization is invisible to the wrappee. The single conceptual entity is split across two `self`s. It's why Decorator can *add* behavior around calls but not *change* the wrappee's internal algorithm. Inheritance's open recursion (powerful, fragile) and composition's self problem (safe, limited) are two sides of one coin — you can't have participation-in-self-calls *and* encapsulation from the same mechanism.

### S3. How do traits/mixins change the calculus?

**Answer:** Traits (Scala, Rust, Ruby `module`, PHP) sit between inheritance and composition: like inheritance they reuse *implementation* and run with the final object's `this` (so *no* self problem), and like composition they don't force a single axis (mix in several, no class explosion). Their cost: they're white-box-ish (can depend on abstract members) and stacking many has resolution-order rules (linearization, diamonds). The lesson: "composition over inheritance" is really "favor weak coupling, dynamic binding, one-axis-per-concern" — traits are a different point in that trade-off space, and which mechanism you pick depends on the language.

### S4. How do Go and Rust compose without inheritance?

**Answer:** **Go:** structs for data, interfaces for contracts (structural, implicitly satisfied), and *embedding* for reuse (promoted methods — but it's composition with auto-forwarding, no virtual dispatch back into the outer type, so no fragile base class or self problem). **Rust:** structs for data, traits for shared behavior contracts (with optional default methods), composition by holding fields. Both cleanly separate substitutability (interfaces/traits) from reuse (composition/embedding) — proving implementation inheritance is unnecessary if you keep those two apart.

### S5. When is composition the *wrong* default?

**Answer:** (1) A true, stable, substitutable is-a with a base designed for extension — framework Template Methods; composing fights the framework. (2) A closed, exhaustively-typed hierarchy (sealed classes / ADTs) where you want the compiler's exhaustiveness check. (3) When the forwarding tax exceeds the coupling benefit on a language without delegation sugar for a shallow, stable, single-axis case. (4) When you genuinely need open recursion (base algorithm calling specialized steps) — inheritance expresses it directly; composition needs an awkward, more-coupled back-reference.

### S6. How is this principle related to OCP and encapsulation?

**Answer:** They're one argument from different angles. You *encapsulate the thing that varies* as an object behind an interface ([Encapsulate What Changes](../../03-module-and-class/01-encapsulate-what-changes/)); you *hold it and delegate* (composition); and then you can *extend by adding components* rather than editing or subclassing ([OCP](../../04-solid/02-ocp-open-closed/junior.md)) — all at minimum coupling ([Minimise Coupling](../01-minimise-coupling/junior.md), the black-box vs. white-box statement). "Composition over inheritance" is the mechanical core of that cluster.

### S7. Why is the composed `InstrumentedSet` more flexible than the inherited one, beyond fixing the bug?

**Answer:** It depends on the `Set` *interface*, not the `HashSet` *class*, so it can wrap any `Set` — `TreeSet`, `LinkedHashSet`, even another wrapper — and stack with other decorators. The inheriting version could only ever instrument a `HashSet`. Composition's black-box coupling buys reusability the white-box version structurally can't have.

---

## Professional Questions

### P1. How do you catch inheritance misuse in code review?

**Answer:** The highest-value question on every `extends`: *"Are you inheriting to be substitutable as the base, or just to reuse its code?"* — reuse means compose. Plus the tells: `extends` with no overrides used polymorphically; a base method some subclasses throw on (LSP break); extending a class you don't own; depth ≥ 3 or `protected` mutable state; subclass-per-combination (Strategy/Decorator in disguise).

### P2. How do you refactor a deep production hierarchy to composition?

**Answer:** Incrementally, never big-bang. (1) Characterize leaf behavior with tests. (2) Identify the *independent axes* the hierarchy crammed into one tree (e.g., channel/format/category/policy). (3) Build composed components (Strategy for destination, Decorators for features, injected policy) *alongside* the hierarchy. (4) Migrate call sites one at a time, tests green. (5) Delete dead leaves, then the base. Each axis becomes a swappable part, unlocking combinations the hierarchy made impossible.

### P3. How do you replace inheritance with delegation safely?

**Answer:** Characterize the subclass's behavior with tests → add a field holding an instance of the former superclass (or the wrapped third-party object) → forward inherited uses to the field (use delegation sugar) → change `extends Y` to `implements <Y's interface>` (extract the interface first) → re-point polymorphism onto the shared interface → small commits, tests at each step. The key rule: *never* do this without characterization tests, because fragile-base self-calls mean current behavior may depend on details you can't see.

### P4. What metrics track inheritance debt, and which ones lie?

**Answer:** Track **Depth of Inheritance Tree (DIT)** and **`protected` member count** (direct measures of fragile-base surface), **change-coupling** between base and subclasses (git ground truth — do they change together?), and **combination-class count trend**. **NOC alone lies** — 12 children of a sealed base is good, 12 children overriding three protected methods is a god-base; read the code. The real metric: can you add a *new combination of behaviors without writing a new class*?

### P5. A teammate `extends ArrayList` to add metrics. What do you say, and why?

**Answer:** Push back: never extend a class you don't own. `ArrayList`'s internal self-calls (e.g., whether `addAll` calls `add`) aren't part of its contract and can change across JDK versions — your overrides could silently miscount after an upgrade with no test failure (a real incident pattern). Wrap an `ArrayList` behind `implements List` and forward; you then control every call and can wrap any `List`.

### P6. Why is "but `extends` is less code than composition" sometimes true, and how do you handle it?

**Answer:** It's genuinely true in a language without delegation sugar — composition needs hand-written forwarding methods that inheritance gives free, which is a real reason teams over-inherit. The fix is tooling, not capitulation: Kotlin `by`, Go embedding, Lombok `@Delegate` generate the forwarding, making the safe choice as terse as the unsafe one. Remove the ergonomic incentive and the argument disappears.

---

## Coding Tasks

### C1. Collapse a class explosion (Python).

**Before** — one class per combination:

```python
class SwordLightWalk(Character): ...
class SwordHeavyFly(Character): ...
class BowLightWalk(Character): ...
# ... 9 more; adding a weapon multiplies them all
```

**After** — behaviors as has-a parts (Strategy):

```python
class Character:
    def __init__(self, weapon, armor, movement):
        self.weapon, self.armor, self.movement = weapon, armor, movement
    def attack(self): return self.weapon.attack()   # delegate
    def move(self):   return self.movement.move()

archer = Character(Bow(), Light(), Fly())   # any combo = a construction
archer.weapon = Sword()                     # swap at runtime — impossible with inheritance
```

Counts go from product (3×2×2=12) to sum (3+2+2=7); a new weapon is one class.

### C2. Fix Bloch's counting bug (Java).

**Before** — broken inheritance:

```java
class InstrumentedHashSet<E> extends HashSet<E> {
    int addCount = 0;
    public boolean add(E e) { addCount++; return super.add(e); }
    public boolean addAll(Collection<? extends E> c) {
        addCount += c.size(); return super.addAll(c);   // double-counts: addAll self-calls add
    }
}
```

**After** — composition (wrap + forward):

```java
class InstrumentedSet<E> implements Set<E> {
    private final Set<E> s; private int addCount = 0;
    InstrumentedSet(Set<E> s) { this.s = s; }
    public boolean add(E e) { addCount++; return s.add(e); }
    public boolean addAll(Collection<? extends E> c) {
        addCount += c.size(); return s.addAll(c);   // s.addAll is a black box → no double count
    }
    public int getAddCount() { return addCount; }
    // ... forward size(), contains(), iterator(), ... to s
}
```

State why: `super.addAll` re-enters the overridden `add`; `s.addAll` cannot re-enter *our* `add`. And the wrapper works with any `Set`.

### C3. Decorator instead of a feature-combination hierarchy (Python).

**Before** — `TimestampedEncryptedFileLogger` etc. (24 classes for 3 destinations × 2³ features).

**After** — destinations as classes, features as decorators:

```python
class FileLogger(Logger):
    def __init__(self, path): self.path = path
    def log(self, msg): open(self.path, "a").write(msg + "\n")

class TimestampDecorator(Logger):
    def __init__(self, inner): self.inner = inner          # has-a Logger
    def log(self, msg): self.inner.log(f"[{now()}] {msg}") # delegate + augment

class EncryptDecorator(Logger):
    def __init__(self, inner): self.inner = inner
    def log(self, msg): self.inner.log(encrypt(msg))

# any combination, no new class:
logger = TimestampDecorator(EncryptDecorator(FileLogger("/var/log/app.log")))
```

6 classes (3 + 3) cover all 24 combinations and every future one.

### C4. Compose in a no-inheritance language (Go).

```go
type AttackBehavior interface{ Attack() string }
type Sword struct{}; func (Sword) Attack() string { return "slash" }
type Bow   struct{}; func (Bow) Attack() string   { return "shoot" }

type Character struct{ Weapon AttackBehavior }       // has-a
func (c Character) Attack() string { return c.Weapon.Attack() } // delegate

knight := Character{Weapon: Sword{}}
archer := Character{Weapon: Bow{}}
```

Point out: Go has no inheritance; polymorphism is via the interface; the `Character` is coupled only to the `Attack()` contract.

### C5. Spot and fix the LSP-breaking base method (Java).

**Before:**

```java
abstract class Payment { abstract void refund(); }
class CashPayment extends Payment {
    void refund() { throw new UnsupportedOperationException(); }  // can't honor it
}
```

**After** — refundability is a composed capability, not a base method:

```java
interface RefundStrategy { void refund(Payment p); }
class Payment { private final RefundStrategy refund;  /* nullable / optional */ }
// jobs filter: payments.stream().filter(Payment::isRefundable)...
```

Explain: a base method some subclasses throw on is an LSP violation; the capability is composed and queried, not inherited and forced.

---

## Trick Questions

### T1. "Composition over inheritance means never use `extends`." True?

**False.** The principle is *favor* — a default, not a ban. Framework Template-Method hooks (`extends Activity`), shallow stable substitutable is-a relationships, and sealed/ADT hierarchies are legitimate inheritance. Banning `extends` outright makes you fight frameworks and lose the compiler's exhaustiveness checks.

### T2. "A penguin is a bird, so `Penguin extends Bird` is correct OO." Right?

**No.** The english sentence is a hint, not a verdict. The test is *substitutability* (LSP): if `Bird` has `fly()`, a `Penguin` can't honor it, so it's not substitutable for a flying `Bird`. Compose the movement behavior instead.

### T3. Inheritance and composition are just two ways to reuse code, equally good. Agree?

**No.** Inheritance is *white-box* (couples to parent internals — strongest coupling, breaks encapsulation, static, fragile base class) and composition is *black-box* (couples only to the public interface — weakest coupling, dynamic, encapsulation-preserving). They're not equivalent; composition is the safer default, which is why GoF ranked it first.

### T4. The composed version is always strictly better, with no downside. Correct?

**No.** Composition costs forwarding boilerplate and indirection, and — crucially — has the **self problem**: a wrapper's override is invisible to the wrappee's internal self-calls, so it can't change the wrappee's internal algorithm (only add behavior around calls). Inheritance's open recursion is a real capability composition lacks. Composition is the *default*, not a universal win.

### T5. "Go has no inheritance, so it can't do polymorphism / OO." Right?

**Wrong.** Go does polymorphism through *interfaces* (structurally satisfied) and reuse through *embedding* (composition with auto-forwarding). It deliberately separates substitutability from reuse — and is an excellent language for it. Same for Rust with traits. They prove implementation inheritance is *unnecessary*.

### T6. "`extends` is one line and composition is thirty — so inheritance is simpler." Sound?

**It's a real ergonomic point but the wrong conclusion.** The forwarding tax is a *tooling* problem, not a fundamental one: Kotlin `by`, Go embedding, and Lombok `@Delegate` generate the forwarding, making composition as terse as `extends` with none of the fragility. Don't trade encapsulation for keystrokes the tooling can save.

### T7. Mixins are just composition. True?

**Not quite.** Mixins/traits reuse *implementation* and run with the final object's `this` (so no self problem) — that's inheritance-like, not delegation. They avoid the single-axis class explosion (composition-like) but reintroduce white-box-ish coupling and resolution-order fragility (the MRO/linearization diamond). They're a *third* point in the trade-off space.

---

## Behavioral Questions

### B1. Tell me about a time you replaced inheritance with composition.

**Sample:** "We had a 6-level controller hierarchy — auth, JSON, pagination stacked as inheritance levels — and a security fix in the base had to be regression-tested against ~40 leaf controllers because each depended on a different slice of inherited behavior. I extracted each concern (auth, serializer, paginator) into an injected component over two quarters, opportunistically as controllers were touched. Afterward each concern could change in isolation, and the regression surface for a base change collapsed. Lesson I now quote: independent concerns stacked as inheritance levels become a change-amplifier."

### B2. Describe a bug caused by inheriting from a class you didn't control.

**Sample:** "We had `MetricsList extends ArrayList` overriding `add` to emit a metric, with `addAll` counting `c.size()`. A JDK upgrade changed how `ArrayList.addAll` used `add` internally, and our metric counts silently drifted — no exception, just wrong dashboards that misinformed a capacity decision. I replaced it with a wrapper that `implements List` and forwards. The lesson: never extend a class you don't own; its self-call structure isn't part of its contract."

### B3. How do you push back when a teammate over-uses inheritance?

**Sample:** "I ask one non-confrontational question on the `extends`: 'Are you inheriting to be substitutable as the base, or just to reuse its code?' If it's reuse, I suggest holding the component and delegating — and if the objection is 'that's more code,' I point them at our delegation sugar (Kotlin `by` / `@Delegate`) so it's just as terse. I cite our default-compose policy so it's a standard, not my opinion."

### B4. When did you decide inheritance was the *right* choice?

**Sample:** "Building on a web framework, the base `Controller` was a documented Template Method — it defined the request lifecycle and called overridable hooks. Composing there would have meant fighting the framework and reimplementing its dispatch. The base was *designed for extension*, the relationship was a genuine substitutable is-a, and the hierarchy was one level deep — so I inherited. 'Favor composition' is a default; framework hooks are the clearest exception."

### B5. How do you keep a large codebase from accumulating inheritance debt?

**Sample:** "Make the safe path the default: composition-by-default policy with three sanctioned `extends` uses, a DIT gate in CI, a ban on extending classes we don't own, and delegation sugar adopted so composition isn't more typing. Culturally I reframe it — separating substitutability from reuse is the senior move, not 'not using the language.' Debt enters one reasonable `extends` at a time, so the defense is at review: every `extends` answers 'substitutable, or reuse?'"

---

## Tips for Answering

1. **Lead with the exact quote and the word *favor*** — it's a default, not a ban. Then give the four risks of inheritance.
2. **Separate interface inheritance from implementation inheritance** — the principle targets the *implementation* kind; this distinction signals depth.
3. **Have Bloch's `InstrumentedHashSet` (count = 6, not 3) ready** — it's the most-asked example; explain the self-call and the black-box fix.
4. **Use substitutability (LSP), not grammar**, as the is-a test — cite `Penguin`/`Bird` and `Square`/`Rectangle`.
5. **Name Strategy and Decorator** as this principle's patterns (variant → Strategy; combination → Decorator).
6. **Mention the costs honestly:** forwarding boilerplate and the self problem — it shows you're not cargo-culting.
7. **Cite Go/Rust** as proof composition suffices, and **delegation sugar** (`by`/embedding/`@Delegate`) as the answer to "but it's more code."

---

[← Professional](professional.md) · [Coupling & Cohesion](../../README.md) · [Roadmap](../../../README.md)
