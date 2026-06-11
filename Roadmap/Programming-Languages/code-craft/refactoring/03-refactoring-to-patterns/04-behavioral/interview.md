# Refactoring Toward Behavioral Patterns — Interview Questions

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

Behavioral-pattern questions are a senior-screening favorite because the *distinctions* (Strategy vs State, Template Method vs Strategy, when a switch should stay a switch) reveal whether a candidate reasons about design or just recites pattern names. Each answer below is the kind you'd give aloud: a crisp claim, the reasoning, and a concrete example.

---

### Q1. What's the actual difference between Strategy and State? They look identical in code.

**Answer.** Structurally they *are* nearly identical — both have a context that delegates to a swappable object behind an interface. The difference is **who drives the swap and why**:

- **Strategy:** the *client* selects the algorithm, once, and the strategies are mutually unaware. There are no transitions. "Pick how to compute shipping" — the chosen strategy never decides to become a different strategy.
- **State:** the *states themselves* drive transitions. The current state both defines behavior *and* decides the next state in response to events. "In `Draft`, calling `publish` moves you to `Moderation` or `Published`."

The one-line test: **does the selected object ever assign the context's next object?** If yes → State. If the client picks and nobody transitions → Strategy. Also, Strategy objects are typically stateless and order-independent; State objects encode a lifecycle graph. (Detail: [junior.md](junior.md), [middle.md](middle.md).)

---

### Q2. When should I replace a `switch` with polymorphism (Strategy) versus a Command map?

**Answer.** Both kill the switch, but they answer different questions:

- Use **Strategy / Replace Conditional with Polymorphism** when the branches are *interchangeable algorithms producing a result* over the same inputs — "compute X different ways." The selection is usually by a *type/category* of the data.
- Use **Replace Conditional Dispatcher with Command** when the switch is *routing actions* — a `switch(actionCode)` where each branch *does* something (often with side effects and its own dependencies), and you want the actions registered in a map keyed by code. The selection is by an *action identifier*, and you may want to queue, log, or undo the actions.

Rule of thumb: Strategy for "how to compute," Command for "which operation to perform." And keep the plain `switch` if there are only a few stable, dependency-free branches — neither pattern earns its keep there ([professional.md](professional.md)).

---

### Q3. What is the lapsed-listener problem, and how do you prevent it?

**Answer.** A subject holds **strong references** to its observers. If an observer is never unsubscribed, the subject keeps it alive forever — the observer is logically dead but physically retained. It's a genuine **memory leak**: in a long-lived app, repeatedly creating-and-discarding observers without deregistering them grows the heap until OOM. Classic in UI frameworks where every view subscribes on open but forgets to unsubscribe on close.

Prevention, best first:
1. **Deterministic paired lifecycle** — return a `Subscription` handle from `addListener` and cancel it on teardown (try-with-resources / `@PreDestroy` / framework lifecycle hook). Most reliable.
2. **Weak references** — the subject holds observers weakly so GC can reclaim lapsed ones; but a listener with no other strong reference vanishes immediately and silently stops firing, so use carefully.
3. **Scoped event buses** that bulk-unsubscribe on scope teardown.

The trap to avoid: registering in a constructor with no corresponding unregister anywhere ([professional.md](professional.md), [find-bug.md](find-bug.md)).

---

### Q4. Template Method vs Strategy — both let me vary steps. Which do I pick?

**Answer.** Both parameterize behavior, but via different axes:

- **Template Method uses inheritance.** A superclass owns the fixed algorithm skeleton (a `final` template method) and subclasses override abstract "primitive operations." The variation is chosen at *construction* (you instantiate `HtmlReport`) and is fixed for that object's life. Good when the skeleton is truly invariant and variants are a closed set known at compile time.
- **Strategy uses composition.** The varying step is a separate object you inject and can swap at *runtime*. Good when you want to mix-and-match steps, configure them externally, or change them on a live object.

Default to **Strategy** because "favor composition over inheritance" — it avoids subclass explosion (one subclass per combination of varying steps) and the fragile-base-class problem. Choose Template Method when there's a single, stable skeleton with a small fixed set of variants and you want the compiler to enforce that subclasses fill in the blanks. They also combine: a template method whose primitive operations are themselves Strategy calls.

---

### Q5. What are the trade-offs of Introduce Null Object?

**Answer.** **Pro:** it removes repeated `if (x != null)` checks by giving "no value" a polymorphic, do-nothing implementation, so callers just call methods. The default behavior is defined once, not re-derived at every call site, and you eliminate a whole class of NPEs.

**Con / the danger:** it makes absence *invisible*. A Null Object silently does nothing where a missing value might actually indicate a bug — "user not found" shouldn't quietly behave like an empty user that lets the request proceed. It can mask errors that should have surfaced.

So: use Null Object when *neutral behavior is genuinely correct* (a free-tier plan with 0% discount). When absence is exceptional or must be handled differently, prefer `Optional` (forces the caller to acknowledge absence at compile time) or explicit handling. The choice is "should missing silently default, or be confronted?" ([middle.md](middle.md)).

---

### Q6. You see a class that directly calls four other services when an order is placed. What refactoring, and what's the risk?

**Answer.** **Replace Hard-Coded Notifications with Observer:** the order service publishes an `OrderPlaced` event; the four services subscribe. The publisher stops depending on its consumers (dependency inversion), and new reactions become new subscribers with no edit to the publisher.

The risk — and the senior caveat — is **transactional/ordering requirements**. If "reserve inventory" *must* succeed-or-rollback atomically with the order, that's not a fire-and-forget notification; hiding a required, ordered step behind an event makes partial failure silent and ordering unspecified. Keep mandatory, atomic steps as direct calls (or model them as a transaction/saga); use Observer for *optional, independent* reactions like analytics and email. Also handle listener exceptions (isolate them) and listener lifecycle (avoid the lapsed-listener leak).

---

### Q7. Explain double dispatch and why Visitor needs it.

**Answer.** A normal Java call dispatches on *one* runtime type — the receiver's. But operations over a heterogeneous structure (an AST, a file tree) need to dispatch on *two*: the node's type *and* the operation. Visitor gets two-axis dispatch from two ordinary virtual calls:

1. `node.accept(visitor)` dispatches on the **node's** runtime type → lands in, say, `FileNode.accept`.
2. There, `visitor.visit(this)` — `this` statically typed `FileNode` — binds the `visit(FileNode)` overload, then dispatches on the **visitor's** runtime type.

The pair selects the right `(node, operation)` method without any `instanceof`. That's double dispatch. Visitor needs it because Java (single-dispatch) can't otherwise pick a method based on two runtime types. The trade-off: Visitor makes *adding operations* easy but *adding node types* hard (every visitor needs a new `visit`) — the expression problem ([senior.md](senior.md)).

---

### Q8. When would you refactor toward State but it would be a mistake to do so?

**Answer.** State is a mistake when the "states" don't actually transition or there are only one or two. Concretely:

- If selection is "pick behavior" with **no lifecycle and no state changing the next state**, you want **Strategy**, not State — building state classes implies a transition graph that doesn't exist.
- If a single boolean flag toggles behavior in one or two methods, four state classes is ceremony; an `if` is clearer.
- If you need persisted, audited transitions with guards across many entity types, hand-rolled State classes under-serve you — reach for a dedicated state-machine library.

The tell that you genuinely need State: a `status` field that *many* methods branch on *and mutate*, forming an implicit graph nobody can see. Then State makes the graph explicit and localizes each transition.

---

### Q9. Is a Strategy ever a performance problem? When?

**Answer.** Usually no — a monomorphic or bimorphic Strategy call site is inlined by the JIT and costs nothing after warmup. It becomes a problem when the call site is **megamorphic** (many concrete types flow through it) *and* it's in a **hot inner loop**. Then the JIT can't inline; it emits an indirect (vtable/itable) call that the CPU may mispredict (~10–20 cycles), and a dense `switch` on an `int`/enum — a single well-predicted jump — can beat it.

Secondary cost: allocating a fresh strategy per call. Stateless strategies should be singletons/flyweights, not `new`'d each time. The professional answer is "measure with JMH; the cost is real only at megamorphic hot sites, and the fix is usually to keep the conditional *there* specifically, not to abandon the pattern everywhere" ([professional.md](professional.md)).

---

### Q10. A `switch(actionCode)` has 40 cases. Refactor to Command. What do you check before doing it?

**Answer.** Before refactoring, confirm the pattern pays off:
- Do the branches carry **behavior and dependencies** (not just return a constant)? If they're trivial value-returns, a map of lambdas or an enum is lighter.
- Do you need **open extensibility** (plugins add actions) or **exhaustiveness** (compiler proves all handled)? Command map gives the former; a sealed-`switch` gives the latter. You can't fully have both.

The mechanical refactoring: define a `Command` interface; extract each case into a command class with its own injected dependencies; register commands in a `Map<String, Command>`; replace the switch with a lookup-and-`execute`; handle the missing-key case explicitly. The payoff: the dispatcher stops depending on every service, each command is unit-testable in isolation, and adding an action is a new class with no edit to the dispatcher ([middle.md](middle.md)).

---

### Q11. How do Command and Memento combine to implement undo?

**Answer.** Command captures *what to do*; the question is how to *reverse* it. Two designs:

- **Self-undoing command:** each `Command` implements `execute()` and `undo()`, storing whatever it needs to invert itself (e.g. the old value before it overwrote). Simple, but every command must know its own inverse — hard for complex operations.
- **Command + Memento:** before `execute()`, snapshot the receiver's relevant state into a **Memento**; `undo()` restores it. This decouples "do" from "how to reverse" — you don't have to express an inverse, just restore a snapshot. Cost: snapshot size and memory (an undo stack of mementos can be large; store diffs if so).

Use self-undoing when the inverse is cheap to express; use Memento when reversal is hard but state is cheap to capture. A `MacroCommand` (Composite of commands) extends this to undoing batches ([senior.md](senior.md)).

---

### Q12. Your codebase has a Strategy with exactly one implementation that's never swapped. What do you do?

**Answer.** **Inline it back to a conditional / direct code** — this is refactoring *away from* a pattern, and it's a legitimate, senior move. A Strategy interface with a single implementation and no runtime swapping adds indirection, files, and a layer of misdirection ("which impl is used?") with zero benefit; the flexibility it promises is never exercised. Kerievsky explicitly treats over-applied patterns as a smell. Remove the interface, fold the one implementation inline, and the code gets simpler and faster. Re-introduce the abstraction *when a second variant actually appears* ([professional.md](professional.md), [`../05-refactoring-away-from-patterns/junior.md`](../05-refactoring-away-from-patterns/junior.md)).

---

### Q13. When does a chain of `if` handlers become Chain of Responsibility rather than a Command map?

**Answer.** Chain of Responsibility fits when handlers have **"try, maybe handle, else pass along"** semantics — each handler decides whether the request is its responsibility, and unhandled requests flow to the next. You don't know up front which handler will take it, the pipeline order matters, and you want to reconfigure/insert handlers without editing them (logging → auth → rate-limit → business, i.e. middleware).

A **Command map** fits when each request maps to *exactly one known handler* by key — pure dispatch, no "pass it on." If you can compute the handler directly, use a map; if handlers must be *tried in order* and may decline, use a chain. The risk with chains: falling off the end unhandled — add an explicit terminal handler so "nobody handled it" is loud ([senior.md](senior.md)).

---

### Q14. Two strategies share a bug because they share a mutable field. What went wrong and how do you fix it?

**Answer.** A Strategy meant to be a shared singleton was given **mutable per-call state** as instance fields. When the same instance is used concurrently (or even reentrantly), calls clobber each other's state — a race condition or logic corruption. The pattern's contract is that stateless strategies are safely shareable; this one broke that contract.

Fixes: (a) make the strategy **truly stateless** — pass per-call data as method parameters, never store it in fields; (b) if it genuinely needs per-invocation state, **create a fresh instance per call** (giving up the singleton optimization) or use a local/`ThreadLocal`; (c) make the fields `final` so the compiler catches reassignment. The same lesson applies to State objects used as singletons ([find-bug.md](find-bug.md)).

---

## Next

- **[junior.md](junior.md)** · **[middle.md](middle.md)** · **[senior.md](senior.md)** · **[professional.md](professional.md)**
- Practice: **[tasks.md](tasks.md)** · **[find-bug.md](find-bug.md)** · **[optimize.md](optimize.md)**
