# Interface Segregation Principle (ISP) — Interview Questions

> **Category:** [Design Principles → SOLID](../../README.md) — the fourth SOLID principle: many small, client-specific interfaces beat one fat general-purpose interface.

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

### J1. State the Interface Segregation Principle.

**Answer:** *Clients should not be forced to depend on methods they do not use.* Prefer many small, client-specific (role) interfaces over one fat, general-purpose interface. It's the **I** in SOLID, from Robert C. Martin.

### J2. What is a "fat interface"?

**Answer:** An interface that bundles many capabilities, so that classes implementing it — and clients depending on it — are dragged into methods they don't need or can't honestly support.

### J3. What's the canonical bad example?

**Answer:** `interface Worker { work(); eat(); }`. A `RobotWorker` can `work()` but can't `eat()`, so it's forced to implement `eat()` with an empty body or `throw new UnsupportedOperationException()`. The fix: split into `Workable { work(); }` and `Eatable { eat(); }`; the robot implements only `Workable`.

### J4. Where did ISP come from?

**Answer:** Uncle Bob's consulting at **Xerox**. One fat `Job` class exposed every printer operation (print, staple, fax). Code that only printed still depended on the whole class, so changing `staple()` forced the printing code to recompile and redeploy. The fix was role interfaces (`Print`, `Staple`, `Fax`).

### J5. What does a `throw new UnsupportedOperationException()` in an interface implementation usually mean?

**Answer:** The interface is **too fat** for that implementer — it's forced to declare a method it can't honestly support. It's the classic fat-interface smell.

### J6. How does a fat interface relate to LSP?

**Answer:** When an implementer throws on a method it can't support, it's no longer **substitutable** for the interface — any client calling that method (as the contract permits) crashes. So a fat interface forces an **LSP violation**. Segregating the interface fixes both.

### J7. Can one class implement several interfaces to satisfy ISP?

**Answer:** Yes — that's the normal pattern. `class Human implements Workable, Eatable`. ISP segregates the *contracts clients depend on*; it doesn't forbid one class from playing several roles.

### J8. What's a "client" in the ISP definition?

**Answer:** The code that *uses* the interface — the consumer that calls its methods. ISP is judged from the client's side: does *this client* depend on methods it doesn't call?

### J9. Is a five-method interface automatically a violation?

**Answer:** No. ISP is about *unused* dependencies, not method count. A five-method interface is fine if every client uses all five. A two-method interface is too fat if some client uses only one.

### J10. Why is Go often used to illustrate ISP?

**Answer:** Go's interfaces are **structural** — a type satisfies an interface just by having the right methods, no `implements` keyword. So idiomatic Go uses tiny interfaces (`io.Reader`, `io.Writer`) defined at the point of use, and ISP becomes almost automatic.

---

## Middle Questions

### M1. How do you decide where to split a fat interface?

**Answer:** Build the **client/method matrix** — list every client and the method subset it uses — then group methods by the client-sets that use them and cut where usage patterns diverge. The split lines come from the clients, not from guesswork. Name each group after its role.

### M2. What's the precise difference between ISP and SRP?

**Answer:** **SRP** groups a *class* by its **reason to change** (the actor/source of change). **ISP** groups an *interface* by **what its clients use** (no client depends on unused methods). SRP asks "why does this change?"; ISP asks "what does this client use?" They co-occur but are independent.

### M3. What's the difference between a header interface and a role interface?

**Answer:** A **header interface** mirrors *all* of a class's public methods (defined from the implementation outward) — usually fat by default. A **role interface** exposes only what one client role needs (defined from the consumer inward). ISP pushes you toward role interfaces. (Martin Fowler's distinction.)

### M4. Why does a fat interface cause unrelated code to recompile?

**Answer:** A client has a compile-time dependency on the whole interface symbol. Changing *any* method (or adding one) recompiles every client that depends on the interface — even clients that never call the changed method — plus every implementer. Segregation makes the blast radius local to the changed role.

### M5. Can a class with one responsibility still violate ISP?

**Answer:** Yes. A cohesive single-responsibility class (e.g., a `File`) can still expose a large API that forces a small client to depend on methods it doesn't use. SRP is satisfied; ISP is violated. The two are orthogonal.

### M6. What is "interface explosion" and how do you avoid it?

**Answer:** Over-segregating into one interface per method regardless of client usage, fragmenting the system into ceremony. Avoid it with the rule: **split where clients differ, not where methods differ.** Methods always used together by the same clients stay in one interface.

### M7. How do you give a client several roles without re-fattening?

**Answer:** Compose **upward** — build a composite interface *from* the small roles (e.g., Go's `io.ReadWriteCloser` made of `Reader + Writer + Closer`). Clients needing one role still depend on one; clients needing the union ask for the composite. Don't reach back for a fat interface.

### M8. How does structural typing change the cost of ISP?

**Answer:** In structural languages (Go, TS), a type satisfies an interface automatically by having the methods — so you can declare a minimal interface at the call site and ISP is nearly free. In nominal languages (Java, C#) you must declare `implements`, so segregation is a deliberate (modest) design cost.

---

## Senior Questions

### S1. What is ISP "really" about, at a theoretical level?

**Answer:** **Cohesion measured from the client side.** Methods belong in the same interface only if some client uses them together; binding methods no client uses together manufactures coupling no client needs. It's the Common Reuse Principle projected onto a single contract — package methods together iff they're used together.

### S2. Explain the structural link between ISP and LSP.

**Answer:** A fat interface promises more than an implementer can deliver. The implementer escapes by throwing/stubbing/returning-null — all of which break substitutability (LSP). So the **ISP violation is the cause and the LSP violation is the symptom**. A narrow role interface is one an implementer can always honor in full, which is the precondition for LSP. ISP *makes LSP achievable*.

### S3. How do ISP and DIP work together?

**Answer:** DIP says depend on abstractions; ISP says make those abstractions *small and client-shaped*. DIP without ISP inverts onto a fat abstraction — you're still coupled to unused methods, one indirection away. DIP *with* ISP inverts onto a narrow role interface, which is also **more stable** (small surface → fewer reasons to change). ISP is what makes DIP's inverted dependencies actually stable.

### S4. When is a large (whole) interface the *correct* choice?

**Answer:** When every client uses (nearly) all of it — then it's cohesive, not fat (there's no *unused* dependency to remove). Or when the methods form a genuine indivisible role (a `Collection`), or when splitting would create composites that always travel together. ISP targets *unused* methods, not method count.

### S5. Precisely reconcile ISP and SRP — are they the same?

**Answer:** No — they're orthogonal projections of cohesion. SRP partitions the *implementation* by **reason-to-change** (actor axis); ISP partitions the *contract* by **direction of use** (client axis). A one-responsibility class can serve clients with disjoint needs (ISP-dirty, SRP-clean); a multi-responsibility class can be consumed fully by each client (SRP-dirty, ISP-clean). Apply SRP to factor the work, ISP to shape the boundary.

### S6. What's the production payoff of segregating a throwing interface?

**Answer:** It turns a **runtime** `UnsupportedOperationException` landmine into a **compile-time** "this type doesn't have that method." Once `Robot` implements only `Workable`, there's no `eat()` to call wrongly — the bug becomes unrepresentable. Moving a class of crashes from prod to the compiler is one of ISP's highest-value wins.

### S7. Compare nominal and structural typing for ISP.

**Answer:** Structural typing (Go, TS) makes ISP the path of least resistance — define the minimal interface at the consumer, any matching type satisfies it for free; risk is *accidental* satisfaction. Nominal typing (Java, C#) requires deliberate `implements` declarations — the lazy path yields header interfaces, but you get explicitness and no accidental satisfaction. In structural languages, take ISP for free; in nominal ones, spend the cost where clients genuinely differ.

---

## Professional Questions

### P1. How do you enforce ISP in code review?

**Answer:** The decisive moment is a **new method added to an existing interface** — ask *"will every current client use this? If not, it's a new role."* For new interfaces, check role-vs-header. And treat any **forced stub/throw** on an interface method as a defect against the interface, not a quirk of the implementer. Push back on "just add it to the interface that's already there" — that's how fat interfaces are born.

### P2. How do you safely segregate a fat interface that's load-bearing in production?

**Answer:** Expand-then-contract: **MAP** the client/method matrix → **GROUP** into roles → **INTRODUCE** the roles and make the fat interface *extend* them (nothing breaks) → **MIGRATE** clients one test-guarded commit at a time to the narrow role → **SHRINK/delete** the fat interface. Never big-bang; keep the system compiling at every commit.

### P3. What's the difference between cargo-culted ISP and real ISP?

**Answer:** Cargo-culted ISP is "one interface per class" — header interfaces mirroring single implementations that narrow nothing (clients still depend on the whole surface). Real ISP narrows what *clients* depend on, driven by multiple clients with different needs. The question is never "does this class have an interface?" but "does this client depend on methods it doesn't use?"

### P4. How do you detect fat interfaces mechanically?

**Answer:** Lint for `UnsupportedOperationException`/`NotImplementedError`/`return null` in interface impls (highest-signal smell); flag interfaces whose method-set mirrors one class with one implementation (header interface); static-analyze per-client method-usage fraction; use build-graph/change-coupling to find high-blast-radius interfaces. Tools find *suspects*; the client/method matrix draws the actual split lines.

### P5. Tell me about the recompilation cost of a fat interface in a real system.

**Answer:** In a monorepo, one fat `DataAccess` interface depended on by 40 services means a change to *any* method (even one no service calls, like `migrateSchema()`) recompiles and re-tests all 40. It's the Xerox problem at scale — CI time explodes for unrelated changes. Segregating into role interfaces localizes the blast radius to the clients of the changed role.

### P6. When might you *not* introduce a segregated interface at all?

**Answer:** When there's one implementation and one caller — introducing any interface may be speculative generality (a YAGNI / simple-design violation). ISP earns its keep once *multiple clients with different needs* exist. Before that, a role interface narrows nothing real and just adds indirection.

---

## Coding Tasks

### C1. Fix the fat `Worker` interface (Java).

**Before:**

```java
interface Worker { void work(); void eat(); }

class RobotWorker implements Worker {
    public void work() { /* ... */ }
    public void eat()  { throw new UnsupportedOperationException(); }  // SMELL
}
```

**After:**

```java
interface Workable { void work(); }
interface Eatable  { void eat();  }

class HumanWorker implements Workable, Eatable {
    public void work() { /* ... */ }
    public void eat()  { /* ... */ }
}
class RobotWorker implements Workable {        // only the role it can honor
    public void work() { /* ... */ }
}
```

State the reasoning: `RobotWorker` no longer depends on `eat()` (ISP), and there's no throwing method to break substitutability (LSP fixed too).

### C2. Spot and split the fat multi-function device (Python).

**Before:**

```python
class IMultiFunctionDevice(ABC):
    @abstractmethod
    def print_doc(self, d): ...
    @abstractmethod
    def scan(self, d): ...
    @abstractmethod
    def fax(self, d): ...

class SimplePrinter(IMultiFunctionDevice):
    def print_doc(self, d): ...
    def scan(self, d): raise NotImplementedError   # SMELL
    def fax(self, d):  raise NotImplementedError    # SMELL
```

**After:**

```python
class IPrinter(ABC):
    @abstractmethod
    def print_doc(self, d): ...
class IScanner(ABC):
    @abstractmethod
    def scan(self, d): ...
class IFax(ABC):
    @abstractmethod
    def fax(self, d): ...

class SimplePrinter(IPrinter):                  # implements ONLY what it supports
    def print_doc(self, d): ...

class AllInOne(IPrinter, IScanner, IFax):
    def print_doc(self, d): ...
    def scan(self, d): ...
    def fax(self, d): ...
```

### C3. Use structural typing to define a client-shaped interface (Go).

**Task:** A logging function needs only to *write*. Don't make it depend on a fat `File`.

```go
// Define the minimal role AT THE POINT OF USE:
type Writer interface{ Write(p []byte) (int, error) }

func logLine(w Writer, line string) {
    w.Write([]byte(line + "\n"))   // depends ONLY on Write
}
// *os.File, *bytes.Buffer, net.Conn all satisfy Writer implicitly — no edits needed.
```

State: the concrete `*os.File` can read/seek/close, but `logLine` depends on exactly one method. Structural typing gives ISP for free.

### C4. Segregate at a DIP boundary (TypeScript).

**Before** — use cases depend on a fat store:

```typescript
interface OrderStore {
  find(id: string): Order;
  save(o: Order): void;
  exportCsv(): string;
}
```

**After** — each use case depends only on its role:

```typescript
interface OrderReader { find(id: string): Order; }
interface OrderWriter { save(o: Order): void; }
interface OrderExporter { exportCsv(): string; }

class PlaceOrder {
  constructor(private writer: OrderWriter) {}      // not coupled to find/export
  run(o: Order) { this.writer.save(o); }
}

class SqlOrderStore implements OrderReader, OrderWriter, OrderExporter { /* ... */ }
```

`PlaceOrder` depends on a one-method, stable abstraction (ISP + DIP together).

### C5. Refactor a legacy fat interface without breaking callers (Java).

**Task:** Segregate `OrderStore` (find/save/export) while keeping the system compiling.

```java
// STEP 1 — introduce roles; fat interface EXTENDS them. Nothing breaks.
interface Reader   { Order find(OrderId id); }
interface Writer   { void  save(Order o); }
interface Exporter { String exportCsv(); }
interface OrderStore extends Reader, Writer, Exporter {}   // still has every method

// STEP 2 — migrate each client to the narrow role it needs, one at a time:
class PlaceOrder {
    private final Writer writer;     // was OrderStore
    PlaceOrder(Writer writer) { this.writer = writer; }
}
// STEP 3 — once no client depends on OrderStore directly, delete it.
```

Explain: this is **expand-then-contract** — the fat interface composed of roles keeps everything compiling while you migrate clients incrementally.

---

## Trick Questions

### T1. "ISP means interfaces should always be small." True?

**Misleading.** ISP means no client should depend on methods it *doesn't use*. A large interface every client uses fully is fine (cohesive, not fat). A two-method interface with one unused method for some client is a violation. Judge by *unused dependency*, not by size.

### T2. "Extracting an interface from a class applies ISP." Right?

**No.** "Extract Interface (all members)" produces a **header interface** that mirrors the class — clients still depend on the whole surface, just via an interface name. ISP narrows what *clients* depend on; you extract from the *client's needs*, not the class's method list.

### T3. "ISP and SRP are basically the same principle." Agree?

**No.** Both descend from cohesion but cut on different axes: SRP groups the implementation by **reason to change** (actor); ISP groups the contract by **what clients use** (consumer). A one-responsibility class can still expose a fat interface, and vice versa — they're orthogonal.

### T4. "Throwing `UnsupportedOperationException` is a fine way to handle methods a class can't support." Correct?

**No — it's the canonical fat-interface smell, and it breaks LSP.** The implementer becomes non-substitutable; any client calling the method (as the contract allows) crashes at runtime. The fix is to segregate the role so the class never declares the method it can't honor.

### T5. "More interfaces is always more SOLID." True?

**No.** Over-segregation (one interface per method, ignoring client usage) is **interface explosion** — fragmentation and ceremony. ISP says package methods together iff some client uses them together. Both too-fat and too-fragmented violate ISP.

### T6. "A no-op default method fixes a fat interface." Does it?

**No.** Java/C# default methods remove the *compile* pain of stubs but **not the ISP violation** — clients still depend on methods they don't use, and a silent no-op (`eat()` that does nothing) can be a worse bug than an honest throw. Defaults are a migration aid, not segregation.

---

## Behavioral Questions

### B1. Tell me about a time a fat interface caused a production problem.

**Sample:** "We had a `PaymentMethod` interface with `refund()`. A new gift-card type couldn't be refunded, so it threw `UnsupportedOperationException`. Months later a batch refund job iterated all payment methods and crashed mid-batch on the first gift card, leaving it half-processed. I split a `Refundable` role; gift cards don't implement it, and the batch job's parameter became `List<Refundable>` — so non-refundable methods were excluded at compile time. The runtime landmine became unrepresentable. Lesson: a forced throw is an ISP smell *and* an LSP break."

### B2. How do you push back when a teammate fattens an interface?

**Sample:** "I ask one non-confrontational question in review: 'Will every current client use this new method?' If only the new feature needs it, I suggest a separate role interface so we don't couple the existing clients to a method they'll never call. I cite our team convention — a method not used by all clients goes on a new role — so it's a standard, not my opinion."

### B3. Describe refactoring a fat interface that was already in production.

**Sample:** "A monorepo `DataAccess` interface had ~20 methods and 40 service consumers; a change to `migrateSchema()` recompiled all 40, none of which used it. I mapped the client/method matrix, grouped into role interfaces, and used expand-then-contract — the fat interface extended the new roles so nothing broke, then I migrated each service to the narrow role it used over a couple of weeks. CI time for unrelated changes dropped dramatically once clients stopped depending on the whole surface."

### B4. When did you decide *not* to introduce a segregated interface?

**Sample:** "A teammate wanted a role interface per method on a service that had exactly one implementation and one caller. I pushed back: ISP narrows what *multiple* clients depend on, but here there was one client using everything — the interfaces would narrow nothing and just add indirection (YAGNI). We kept the concrete type and agreed to segregate the day a second client with different needs appeared."

### B5. How do you keep interfaces from fattening over years on a large team?

**Sample:** "Make the role-shaped path the default: name interfaces by role not by class, a written rule that a method not used by all clients goes on a new role, treat every forced stub/throw as an interface defect in review, and lint for `UnsupportedOperationException` in impls. Fat interfaces grow one reasonable-looking PR at a time, so the defense is at review — every new method on a shared interface has to justify that *all* clients will use it."

---

## Tips for Answering

1. **Quote the definition exactly:** *"Clients should not be forced to depend on methods they do not use."* Stress it's judged from the **client's** side.
2. **Lead with the `Worker { work(); eat(); }` / Robot example** — it's the canonical illustration and shows the fat-interface smell instantly.
3. **Name the smell:** empty bodies, `return null`, and especially `throw new UnsupportedOperationException()` — and connect that throw to the **LSP** violation.
4. **Distinguish ISP from SRP precisely:** ISP = group by *what clients use*; SRP = group by *reason to change*. Orthogonal projections of cohesion.
5. **Distinguish role interfaces from header interfaces** (Fowler) — "Extract Interface from a class" is the anti-pattern.
6. **Mention structural typing** (Go's `io.Reader`/`io.Writer`, Rob Pike's proverb) — ISP is nearly automatic there.
7. **Connect to DIP:** ISP makes the abstractions DIP depends on small and stable.
8. **Warn about over-segregation** — "split where clients differ, not where methods differ" — to show balanced judgment.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md) · **Sibling:** [DIP](../05-dip-dependency-inversion/junior.md)
