# Refactoring Toward Behavioral Patterns — Senior Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

Junior and middle covered the high-frequency refactorings. This file covers the ones that show up when you work over **object structures and small languages**, plus the cross-pattern reasoning that distinguishes a senior:

1. **Move Accumulation to Collecting Parameter** — break a long accumulating method without duplicating the result variable.
2. **Move Accumulation to Visitor** — gather across a heterogeneous structure via double dispatch.
3. **Replace Implicit Language with Interpreter** — when ad-hoc mini-languages accrete.
4. **Chain of Responsibility** — when a run of `if` handlers forms a natural pipeline.

Then: **double dispatch** explained properly, **behavioral pattern interplay** (State+Strategy, Command+Memento for undo), **event-driven design**, and **designing behavioral refactorings for testability**.

---

## Move Accumulation to Collecting Parameter

### Starting smell

One long method accumulates a result into a local variable across several phases. You want to break it into focused sub-methods (Extract Method), but each extracted method needs to contribute to *the same growing result* — so you're tempted to either return-and-merge everywhere or share a field. Both are ugly.

```java
// BEFORE — one method building a report string in a local `result`.
public String buildAuditReport(Account account) {
    StringBuilder result = new StringBuilder();

    // phase 1: header
    result.append("Audit for ").append(account.id()).append("\n");

    // phase 2: transactions (50 lines)
    for (Transaction t : account.transactions()) {
        if (t.isFlagged()) {
            result.append("  FLAG ").append(t.id())
                  .append(" ").append(t.amount()).append("\n");
        }
    }

    // phase 3: balances (40 lines)
    for (Balance b : account.balanceHistory()) {
        result.append("  BAL ").append(b.date())
              .append(" ").append(b.amount()).append("\n");
    }
    return result.toString();
}
```

You can't cleanly extract `appendTransactions` and `appendBalances` if each must *return* a fragment that the caller stitches together — that scatters the assembly logic.

### Motivation

Pass the accumulator (the **collecting parameter**) *into* the sub-methods, so each one contributes to the shared result directly. This is the enabling move that makes Extract Method clean for accumulating code, and it's the conceptual seed of Visitor (a Visitor *is* a collecting parameter that also dispatches on type).

### Mechanical steps

1. **Identify the accumulator** (`result`).
2. **Create a sub-method that takes the accumulator as a parameter** and writes into it, instead of returning a fragment.
3. **Move one phase's body into that sub-method**, passing the accumulator. Run tests.
4. **Repeat** per phase. The original method shrinks to: create accumulator → call each contributor → return.
5. The collecting parameter is now a seam: contributors are independently testable by passing a fresh accumulator.

### After

```java
public String buildAuditReport(Account account) {
    StringBuilder result = new StringBuilder();      // the collecting parameter
    appendHeader(account, result);
    appendFlaggedTransactions(account, result);
    appendBalances(account, result);
    return result.toString();
}

private void appendHeader(Account a, StringBuilder out) {
    out.append("Audit for ").append(a.id()).append("\n");
}
private void appendFlaggedTransactions(Account a, StringBuilder out) {
    for (Transaction t : a.transactions())
        if (t.isFlagged())
            out.append("  FLAG ").append(t.id()).append(" ").append(t.amount()).append("\n");
}
private void appendBalances(Account a, StringBuilder out) {
    for (Balance b : a.balanceHistory())
        out.append("  BAL ").append(b.date()).append(" ").append(b.amount()).append("\n");
}
```

### When NOT to

- **The accumulator is a primitive `int`/`double`.** Java passes primitives by value, so a method can't accumulate into one passed in — return the value and sum at the call site, or wrap it. Collecting parameter shines for mutable accumulators (`StringBuilder`, collections, a typed `Report` builder).
- **A pure functional fold reads better.** `transactions.stream().filter(..).map(..).collect(joining())` may beat a mutable collecting parameter for simple cases.

---

## Move Accumulation to Visitor

### Starting smell

You need to compute something over a **heterogeneous object structure** (an AST, a file tree, a document model with many node types), and the accumulation logic is either (a) spread across every node class as a method, mixing unrelated operations into the nodes, or (b) implemented as a giant `instanceof` cascade outside the structure.

```java
// BEFORE — type-sniffing accumulation outside the structure.
public double totalSize(List<FsNode> nodes) {
    double total = 0;
    for (FsNode n : nodes) {
        if (n instanceof FileNode) {
            total += ((FileNode) n).bytes();
        } else if (n instanceof DirNode) {
            total += totalSize(((DirNode) n).children());   // recurse
        } else if (n instanceof SymlinkNode) {
            total += 0;                                       // links don't count
        }
    }
    return total;
}
```

Each new operation (count files, find largest, collect names) duplicates this `instanceof` cascade. Each new node type breaks *every* cascade.

### Motivation

A **Visitor** moves the operation into one object that visits each node type via a type-specific `visit` method, while the nodes only know how to `accept` a visitor. The accumulation lives in the visitor (acting as a collecting parameter), and adding a new *operation* is a new visitor — no edits to the node classes. The mechanism that makes this work is **double dispatch**.

> Visitor as a pattern, with the full accept/visit dance: [`../../../design-patterns/03-behavioral/10-visitor/junior.md`](../../../design-patterns/03-behavioral/10-visitor/junior.md).

### Double dispatch — the actual mechanism

A normal Java call `x.foo()` dispatches on **one** runtime type: `x`'s. But `instanceof` cascades exist precisely because we need to dispatch on the *node's* type. Visitor achieves dispatch on **two** types — the node's *and* the visitor's — with two ordinary virtual calls:

1. `node.accept(visitor)` dispatches on the **node's** runtime type → lands in `FileNode.accept`.
2. Inside, `FileNode.accept` calls `visitor.visit(this)` — `this` is statically `FileNode`, so it binds the `visit(FileNode)` overload, then dispatches on the **visitor's** runtime type.

The combination selects the right `(node type, operation)` pair without a single `instanceof`. That two-step is *double dispatch*; Visitor is the pattern that institutionalizes it.

### Mechanical steps

1. **Add `accept(Visitor v)` to the node interface**, each node implementing it as `v.visit(this)`.
2. **Define the `Visitor` interface** with one `visit` overload per concrete node type.
3. **Move each `instanceof` branch into the matching `visit` method.** The accumulator becomes a field on a concrete visitor.
4. **Replace the cascade with a traversal** that calls `accept` on each node, passing the visitor. Recursion lives in the visitor or the structure's traversal.
5. **Read the result off the visitor** after traversal.

### After

```java
public interface FsNode { <R> R accept(FsVisitor<R> v); }

public final class FileNode implements FsNode {
    private final long bytes;
    public FileNode(long b) { this.bytes = b; }
    public long bytes() { return bytes; }
    public <R> R accept(FsVisitor<R> v) { return v.visit(this); }
}
public final class DirNode implements FsNode {
    private final List<FsNode> children;
    public DirNode(List<FsNode> c) { this.children = c; }
    public List<FsNode> children() { return children; }
    public <R> R accept(FsVisitor<R> v) { return v.visit(this); }
}
public final class SymlinkNode implements FsNode {
    public <R> R accept(FsVisitor<R> v) { return v.visit(this); }
}

public interface FsVisitor<R> {
    R visit(FileNode f);
    R visit(DirNode d);
    R visit(SymlinkNode s);
}

// One operation = one visitor. Adding "count files" never touches the nodes.
public final class SizeVisitor implements FsVisitor<Long> {
    public Long visit(FileNode f)    { return f.bytes(); }
    public Long visit(DirNode d)     {
        long total = 0;
        for (FsNode child : d.children()) total += child.accept(this);
        return total;
    }
    public Long visit(SymlinkNode s) { return 0L; }
}
```

### When NOT to

- **The structure's classes change more often than the operations.** Visitor optimizes for *adding operations* but makes *adding node types* painful — every new node forces a new `visit` method in *every* visitor. This is the classic "expression problem" trade-off. If node types churn, keep methods on the nodes (or use pattern matching / sealed types, which give exhaustiveness without the visitor boilerplate in modern Java).
- **There are only one or two node types.** The double-dispatch ceremony isn't worth it; a small `instanceof` or sealed-`switch` is clearer.
- **You can use sealed types + pattern matching.** Java's `switch` on sealed interfaces gives compile-time exhaustiveness and dispatch without the accept/visit boilerplate — often the better modern choice. Visitor still wins when you must support *open* sets of operations across a stable, deep hierarchy.

---

## Replace Implicit Language with Interpreter (briefly)

### Starting smell

A feature started as a flag, then a string convention, then a string with separators, then nested conditions parsing that string — an **implicit language** has accreted. Symptoms: code that `split("|")` then `split(":")` then branches on prefixes; "DSL" smells encoded as magic strings.

```java
// BEFORE — a permission rule encoded as an ad-hoc string mini-language.
boolean allowed(String rule, Context ctx) {
    // rule examples: "role:admin", "role:editor&owner:self", "time:9-17|role:admin"
    for (String orClause : rule.split("\\|")) {
        boolean clauseOk = true;
        for (String term : orClause.split("&")) {
            String[] kv = term.split(":");
            switch (kv[0]) {
                case "role":  clauseOk &= ctx.user().hasRole(kv[1]); break;
                case "owner": clauseOk &= ctx.isOwner(); break;
                case "time":  clauseOk &= ctx.withinHours(kv[1]); break;
            }
        }
        if (clauseOk) return true;
    }
    return false;
}
```

The parser and evaluator are tangled, every new operator edits this method, and there's no way to validate a rule without running it.

### Motivation

When the implicit language is **stable, small, and recurring**, make it explicit: parse rules into an **AST of expression objects**, each with an `interpret(Context)` method. Parsing and evaluation separate; new operators are new node types; rules can be validated, optimized, and explained.

> Interpreter as a pattern, and its (deserved) reputation for narrow applicability: [`../../../design-patterns/03-behavioral/11-interpreter/junior.md`](../../../design-patterns/03-behavioral/11-interpreter/junior.md).

### Sketch (after)

```java
interface Rule { boolean interpret(Context ctx); }

record HasRole(String role)  implements Rule { public boolean interpret(Context c){ return c.user().hasRole(role); } }
record IsOwner()             implements Rule { public boolean interpret(Context c){ return c.isOwner(); } }
record WithinHours(String h) implements Rule { public boolean interpret(Context c){ return c.withinHours(h); } }
record And(Rule a, Rule b)   implements Rule { public boolean interpret(Context c){ return a.interpret(c) && b.interpret(c); } }
record Or(Rule a, Rule b)    implements Rule { public boolean interpret(Context c){ return a.interpret(c) || b.interpret(c); } }
// a separate parser builds the AST once; evaluation is just tree.interpret(ctx).
```

### When NOT to

- **The "language" has one or two forms and won't grow.** Interpreter is heavy: an AST node per grammar rule. For anything non-trivial, reach for a real parser generator or an existing expression library rather than hand-rolling.
- **Performance-critical evaluation.** Tree-walking interpretation is slow; if it's hot, compile the AST to a closure/bytecode or use an existing engine.

---

## Chain of Responsibility — when a run of `if` handlers forms

### Starting smell

A method tries a sequence of handlers: each checks "is this mine?" and either handles or falls through to the next. As an `if`/`else if` ladder it's rigid — order and membership are hard-coded, and you can't reconfigure the pipeline.

```java
// BEFORE — a fixed ladder of "can I handle this?" checks.
Response support(Ticket t) {
    if (t.severity() == CRITICAL) return pager.escalate(t);
    else if (t.category() == BILLING) return billingTeam.handle(t);
    else if (t.isAfterHours()) return onCallBot.autoReply(t);
    else return l1Support.handle(t);
}
```

### Motivation

A **Chain of Responsibility** turns each `if` into a handler object with `setNext`, each deciding to handle or delegate. The chain becomes data you can reorder, insert into, and configure per deployment — without editing the handlers.

> Chain of Responsibility as a pattern, and its relation to middleware pipelines: [`../../../design-patterns/03-behavioral/01-chain-of-responsibility/junior.md`](../../../design-patterns/03-behavioral/01-chain-of-responsibility/junior.md).

### Mechanical steps

1. **Define `Handler`** with `handle(req)` and a `next` link (or a `setNext`).
2. **Extract each `if` branch into a handler** that either handles or calls `next.handle(req)`.
3. **Build the chain** by linking handlers in the desired order, in configuration.
4. **Replace the ladder** with `chain.handle(t)`.

### When NOT to

- **Every request is always handled by exactly one obvious branch.** A `switch`/map (Command-style dispatch) is clearer than a chain when there's no "try next" semantics. Chain shines when handlers *partially* process and pass along, or when the eligible handler isn't known up front.
- **Unhandled requests are a silent risk.** A chain can fall off the end with nobody handling — add an explicit terminal/default handler so "nobody handled it" is loud, not lost.

---

## Behavioral pattern interplay

Senior judgment is largely about how these patterns *combine*. Four canonical pairings:

**State + Strategy.** They share a structure (context delegates to a swappable object) but differ in *who swaps*. A common combo: a State machine whose individual states *use* Strategies for pluggable sub-decisions. E.g. a `Playing` state holds an `AiStrategy` (easy/hard) — State governs the lifecycle, Strategy governs a decision *within* a state. Don't collapse them: if you find a "state" that the client sets and that never transitions, it was a Strategy.

**Command + Memento → undo/redo.** Command captures *what to do* and how to undo it; Memento captures *the state to restore*. Two designs:
- *Self-undoing command:* each `Command` implements `execute()` and `undo()`, storing whatever it needs to reverse. Simple, but each command must know how to invert itself.
- *Command + Memento:* before `execute()`, the command (or invoker) snapshots the receiver into a Memento; `undo()` restores it. Decouples "do" from "how to reverse," at the cost of snapshot size. Use Memento when reversal is hard to express but state is cheap to snapshot.
> Memento: [`../../../design-patterns/03-behavioral/05-memento/junior.md`](../../../design-patterns/03-behavioral/05-memento/junior.md). Command: [`../../../design-patterns/03-behavioral/02-command/junior.md`](../../../design-patterns/03-behavioral/02-command/junior.md).

**Observer + Mediator.** Pure Observer is many publishers each with their own subscriber lists. When *many* objects must react to *each other*, the web of subscriptions becomes a mesh — extract a **Mediator** that centralizes the wiring, so objects publish to the mediator rather than to each other. Mediator trades distributed coupling for a central coordinator. [Mediator](../../../design-patterns/03-behavioral/04-mediator/junior.md).

**Command + Composite → macro commands.** A `MacroCommand` that holds a list of commands and executes them in order is a Composite of Commands — the basis of batch operations and transactions.

---

## Event-driven design and designing for testability

Observer scaled up becomes **event-driven architecture**: publishers emit events to a bus/broker; consumers subscribe by type. The refactoring instinct is the same (replace hard-coded calls with publish/subscribe), but at this scale you inherit new concerns — ordering, at-least-once delivery, idempotency, the saga/choreography-vs-orchestration question. Those belong to distributed systems; the behavioral-refactoring lens just gets you the *first* decoupling.

**Designing these refactorings for testability** — what a senior optimizes for as they refactor:

- **Strategy / Command / State objects are unit-test seams.** Each former branch becomes a class you can test in isolation with a fake context. If a refactoring *doesn't* improve testability, question whether it earns its complexity.
- **Inject collaborators; never `new` them inside the behavior object.** A Command that `new`s its `PaymentService` can't be tested without real payments. Constructor-inject so tests pass fakes.
- **Make Observer notification observable.** A test should be able to register a probe listener and assert it fired. If your event plumbing can't be subscribed to in a test, it's too coupled.
- **Keep strategies/states stateless or value-immutable.** Shared mutable state in a "stateless" strategy is both a concurrency bug ([find-bug.md](find-bug.md)) and a test-flakiness source.
- **Assert on state transitions explicitly.** For State machines, test the *graph*: from each state, assert which events are legal and which target state results — including that illegal transitions throw.

---

## Next

- **[junior.md](junior.md)** — Strategy, State, Template Method.
- **[middle.md](middle.md)** — Command dispatch, Null Object, Observer.
- **[professional.md](professional.md)** — runtime cost of every pattern here: dispatch, allocation, leaks, JIT.
- **[interview.md](interview.md)** · **[tasks.md](tasks.md)** · **[find-bug.md](find-bug.md)** · **[optimize.md](optimize.md)**.
- Siblings: **[../01-when-to-refactor-to-patterns/junior.md](../01-when-to-refactor-to-patterns/junior.md)** · **[../05-refactoring-away-from-patterns/junior.md](../05-refactoring-away-from-patterns/junior.md)**.
