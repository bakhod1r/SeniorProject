# Inversion of Control (IoC) — Interview Questions

> **Category:** [Design Principles → Coupling & Cohesion](../../README.md) — the broad principle where the *flow of control* is inverted: a framework calls into your code instead of your code calling a library.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions. The IoC / DI / DIP / service-locator distinctions are the most-tested material — nail them.

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

### J1. What is Inversion of Control, in one sentence?

**Answer:** IoC is the principle where the *flow of control* is inverted — instead of your code calling into a library, a framework calls into your code. Slogan: *"Don't call us, we'll call you"* (the Hollywood Principle).

### J2. What's the difference between a library and a framework?

**Answer:** **Direction of control.** A library is code *you call* — you own the loop and decide when to invoke it. A framework is code that *calls you* — it owns the loop and calls your registered code back. It's not about size; it's about who's in charge.

### J3. What is the Hollywood Principle?

**Answer:** "Don't call us, we'll call you." It's the slogan for IoC: you register your code with the framework and *it* calls you back at the right time, instead of you calling it.

### J4. Give an everyday example of IoC.

**Answer:** Any of: a web framework calling your route handler when a request arrives; a test runner (JUnit/pytest) calling your test methods; a button's `onClick` callback the UI loop invokes; `array.forEach(fn)` calling your function for each element; React calling your component's `render`/`useEffect`. In each, *you supply code; something else calls it.*

### J5. Is Dependency Injection the same as IoC?

**Answer:** No — **DI is one *kind* of IoC** (IoC ⊃ DI). DI inverts the *construction* of your collaborators (they're handed in from outside). IoC is broader: it also covers inverting *flow* (template methods, callbacks, the main loop), which is not DI.

### J6. Name three forms of IoC.

**Answer:** (Any three) Template Method (a framework runs the algorithm and calls your overridden steps); callbacks/events (the loop calls your handler); `main()` → framework (the framework owns the run loop); Dependency Injection (collaborators supplied from outside); service locator.

### J7. When a web framework "routes" a request to your handler, who calls the handler?

**Answer:** The framework does. You *register* the handler for a URL; you never call it yourself. When a matching request arrives, the framework's dispatch loop calls your handler. Control is inverted.

### J8. How does IoC help with testing?

**Answer:** Code the framework calls is usually code *you* can call too. A route handler is just a function — call it directly in a unit test with no server. And because construction is inverted (DI), you can pass fakes in at the seam without touching production wiring.

### J9. Does IoC require a framework or a container?

**Answer:** No. Passing a function to `forEach` is IoC (it calls your function back). Overriding a template-method hook is IoC. DI can be done by hand-wiring in a composition root with no container. IoC is the *principle*; frameworks/containers are just common vehicles.

### J10. What does IoC have to do with coupling?

**Answer:** The framework owns the wiring and the timing, so your code depends only on the small contract it's handed — not on the loop, sibling handlers, or framework internals. High-level policy stays independent of low-level mechanism. Fewer, smaller dependencies = lower coupling.

---

## Middle Questions

### M1. Fowler says always ask one question about IoC. What is it, and why?

**Answer:** *"Which control is being inverted?"* "IoC" is an umbrella covering flow inversions (template method, callbacks, the main loop) and construction inversion (DI). Without naming *which*, people conflate IoC, DI, and DIP and talk past each other.

### M2. How do Template Method and Strategy+injection invert the *same* control differently?

**Answer:** Both invert *which behavior a step uses*. **Template Method** uses **inheritance** — a base class owns the algorithm and calls your overridden subclass method. **Strategy + injection** uses **composition** — an object implementing the step is handed in and called. Composition is usually preferred (more flexible, no fragile base class).

### M3. What is a composition root?

**Answer:** The single place, as near the entry point as possible, where the whole object graph is wired — concrete implementations chosen and injected. It keeps every other module free of concrete-construction knowledge, makes swapping an implementation a one-line change, and makes the dependency graph visible in one place.

### M4. Walk through inverting a procedural CLI/web loop into a framework-driven one.

**Answer:** Procedural: *your* `main()` owns the accept/read loop and a central `if/elif` dispatch; every new route edits the loop, and mechanism (sockets, parsing, dispatch) is braided into policy. Inverted: the *framework* owns the loop; you only `@route(...)`-register handlers and call `app.run()` once. The framework calls your handlers; you never call them. Policy (what `/users` returns) is now separated from mechanism (sockets/parsing/dispatch).

### M5. State the IoC / DI / DIP distinction.

**Answer:** **IoC** = who controls *flow* (framework calls you). **DI** = who controls *construction* (collaborators pushed in from outside) — a *kind* of IoC. **DIP** = which way *source dependencies* point (toward abstractions) — a separate axis, usually achieved *via* DI. IoC ⊃ DI; DIP is orthogonal and cooperates.

### M6. Can you have IoC without DI? DI without DIP?

**Answer:** Yes to both. **IoC without DI:** a template-method framework or a plain `forEach` inverts *flow* with no injection. **DI without DIP:** `new Service(new PostgresClient())` injects a *concretion* — the technique is DI, but you depended on a detail, so DIP is violated. Injecting an *abstraction* is what makes DI achieve DIP.

### M7. When should you NOT invert control?

**Answer:** When the dependency is stable and singular (one implementation, no boundary, no test seam) — injection/strategy adds indirection that buys nothing; when the program is small and you own the flow (explicit `main` is clearer); when the collaborator is a pure value/utility (`new Money(5)` glues you to nothing that matters). Invert at real seams; stay concrete in the middle.

### M8. Why is React's component lifecycle an example of IoC?

**Answer:** You never call `render` or `useEffect`. You *declare* a component and React's reconciler decides when to call it, when effects run, when to re-render. Control over *when your code runs* belongs to React — that's the inversion.

---

## Senior Questions

### S1. Precisely, what does IoC invert — and how is that different from what DIP inverts?

**Answer:** **IoC inverts the *runtime call graph*** at a boundary (the framework calls your code instead of you calling it). **DIP inverts the *compile-time dependency graph*** (the detail's source points up at an abstraction the policy owns). They're inversions of *two different graphs*. Applied at the same seam they reinforce: the policy becomes both runtime-summoned (IoC) and compile-time-independent (DIP) — the basis of Clean/Hexagonal architecture. You can have one without the other (template method = IoC without dependency inversion; a function taking an interface = DIP without a framework).

### S2. Distinguish service locator from dependency injection.

**Answer:** Both supply a collaborator the consumer didn't hard-construct, but **DI pushes** (the dependency is handed in via constructor/setter — explicit in the signature, passive consumer) while a **service locator pulls** (`locator.get(X)` inside the consumer — hidden in method bodies, active consumer). DI gives honest signatures, compile-time safety, easy fakes, and no global. The locator hides dependencies and couples everyone to a global registry. Crucially, **the locator does not actually invert control of construction** — the consumer still drives it; it just delegated *where to look*. DI is the default; reach for a locator only when you genuinely can't inject.

### S3. Is a service locator a form of IoC?

**Answer:** It's commonly *labeled* IoC, but it doesn't invert control the way DI does — the consumer still *pulls* its dependency, so control of construction stays inside it. Fowler's article draws this line: both answer "how do I get my dependency," but only DI inverts construction; the locator is a pull, not an inversion. So: it's grouped under IoC discussions, but it's the *non-inverting*, dependency-hiding option — usually the worse choice.

### S4. When does a DI container earn its place, and what does it cost?

**Answer:** **Earns it** when the object graph is large (deep transitive graphs), you need lifecycle/scope management (singleton/per-request), the framework expects it, or you want cross-cutting weaving (AOP/interceptors). **Costs:** configuration-over-code opacity (wiring in annotations/XML/convention, not readable calls), runtime failure modes (missing/ambiguous/circular bindings fail at startup, not compile time), magic and lock-in (proxies, lazy init, scopes), and it *invites* the container-as-service-locator anti-pattern. It's an optimization for a large graph — not a default. A small graph wants a hand-wired composition root.

### S5. How are plugin architectures an example of IoC?

**Answer:** The host owns the control loop and *calls into* plugins it discovers (IoC: host calls plugin), while the plugins' *source* depends *up* on a host-defined contract (DIP: source points up). The host depends on no plugin; plugins depend on the host's interface. Drop in a new plugin and the host calls it unchanged — Open/Closed. Editors, browsers, build tools, and CI systems are all hosts that call you. It's IoC + DIP at module scale.

### S6. What is the true *cost* of inversion?

**Answer:** Lost explicit control flow — "where does execution actually start?" has no simple answer when the framework's loop calls your handler that a container constructed with annotation-chosen deps under a scope rule. Debugging through framework magic (stack traces full of framework frames, reflection, proxies). Configuration opacity ("which implementation did I get?" lives in resolution rules, not greppable calls). Framework lock-in (you adopt its lifecycle/scopes/idioms). IoC *moves complexity from your code into the framework and config* — a good trade at a real seam, a bad one in straight-line interior logic.

### S7. How do IoC and Open/Closed relate?

**Answer:** IoC is a primary *lever* for OCP. Because the framework calls *interchangeable* pieces (handlers, strategies, plugins), you extend behavior by *adding* a piece, not by editing the loop — the policy is closed for modification, open for extension. The abstraction the policy depends on (DIP) is what makes the new piece pluggable; IoC is what makes the framework *call* it. (OCP is the goal; IoC + DIP are the mechanism.)

---

## Professional Questions

### P1. How do you review a PR that introduces an inversion?

**Answer:** Ask two questions: *"What real seam does this serve?"* (volatile boundary, genuine second implementation, or test need — or none?) and *"Can a reader still tell what runs when?"* A one-implementation strategy/interface with no test need is hidden flow with no decoupling — reject it, call the concrete directly, extract when a second case is real. Also flag `container.get` in policy code, framework types imported into domain classes, and callbacks that replace a plain sequential call.

### P2. How do you keep IoC from welding your business logic to a framework?

**Answer:** The framework calls your code (IoC), but your *policy* must import no framework types (DIP). Keep handlers/controllers/listeners thin — they translate framework types into plain calls on framework-agnostic policy objects. The framework's reach stops at the adapter layer. Then the same logic runs under HTTP, a batch job, or a test, and survives a framework migration. Enforce with architecture tests (ArchUnit/import-linter).

### P3. What's the container-as-service-locator anti-pattern, and how do you prevent it?

**Answer:** Calling `container.get(X)` (or field-`@Autowired`) inside business logic instead of injecting via constructor. It makes dependencies invisible in signatures and couples everyone to the global container — reintroducing exactly the hidden global coupling DI removed. Prevent it by policy (constructor injection only in policy code), enforced by a lint rule banning `container.get` outside the composition root, plus centralized bindings and startup-time graph validation.

### P4. How do you introduce IoC into untestable legacy code?

**Answer:** Characterize behavior first (you can't safely invert what isn't pinned). Find the painful seam — usually a hard-`new`'d DB/clock/HTTP client in business logic. Parameterize that construction up into a constructor/method param (Feathers' refactor) — this creates a test seam immediately. Then depend on an owned abstraction at the seam (DIP), so you can inject a fake. Hoist concrete choices into a composition root over time. Stay opportunistic (Boy Scout Rule); don't go straight to a container; don't over-invert the rescue.

### P5. Why is adopting a framework's IoC a "one-way door"?

**Answer:** You hand the framework your main loop, its lifecycle, its scopes, and its idioms — and migrating off them is a multi-quarter rewrite, not a refactor. So it deserves the gravity of an irreversible architectural decision: write an ADR, justify it against frameworkitis (don't adopt a heavyweight framework for a script-sized problem), and contain the blast radius by keeping policy framework-agnostic.

### P6. A teammate reports "we reduced coupling by adding a DI container." How do you respond?

**Answer:** A container alone doesn't reduce coupling — it can *hide* it. If people `container.get` deep in business code, dependencies are now invisible and globally coupled to the container: worse than before. Coupling drops only if you (a) inject *abstractions* via constructors (DI + DIP), (b) keep the container out of policy code, and (c) keep wiring in a composition root. Ask to see whether the container is used as injection (good) or as a pull-based service locator (bad).

---

## Coding Tasks

### C1. Invert a procedural dispatch loop into a registration-based "framework" (Python).

**Before** — you own the loop and the dispatch:

```python
def main():
    while True:
        cmd, *args = input("> ").split()
        if cmd == "greet":  print(f"Hello, {args[0]}!")
        elif cmd == "add":  print(int(args[0]) + int(args[1]))
        elif cmd == "quit": break
```

**After** — a tiny framework owns the loop and calls *your* handlers:

```python
class App:
    def __init__(self): self.handlers = {}
    def command(self, name):
        def reg(fn): self.handlers[name] = fn; return fn
        return reg
    def run(self):
        while True:
            cmd, *args = input("> ").split()
            if cmd == "quit": break
            print(self.handlers[cmd](*args))   # framework calls YOUR handler

app = App()
@app.command("greet")
def greet(name): return f"Hello, {name}!"
@app.command("add")
def add(a, b):   return int(a) + int(b)
app.run()
```

State the inversion: in *Before* your code calls `greet`; in *After* the framework's `run` loop calls it. Adding a command no longer edits a central ladder.

### C2. Template Method — make the framework call your hooks (Java).

```java
abstract class Exporter {
    public final void export() {        // framework owns the algorithm
        var rows = fetch();             // <-- your hook
        write(format(rows));            // <-- your hook, then framework step
    }
    protected abstract List<Row> fetch();
    protected abstract String format(List<Row> rows);
    private void write(String s) { System.out.println(s); }
}
class CsvExporter extends Exporter {    // you fill the holes; never call export()'s steps
    protected List<Row> fetch()              { return db.all(); }
    protected String format(List<Row> rows)  { return toCsv(rows); }
}
```

`export()` (the framework) calls `fetch`/`format` — *"don't call us, we'll call you."*

### C3. Convert a service-locator pull into constructor injection (TypeScript).

**Before** — hidden, globally-coupled dependencies:

```typescript
class Reports {
  monthly() {
    const repo = Locator.get<Repo>("repo");   // hidden; runtime failure if unregistered
    const clock = Locator.get<Clock>("clock");
    // ...
  }
}
```

**After** — explicit, testable, no global:

```typescript
class Reports {
  constructor(private repo: Repo, private clock: Clock) {}   // visible contract
  monthly() { /* uses this.repo, this.clock */ }
}
// test: new Reports(new InMemoryRepo(), new FrozenClock("2026-06-11"))
```

State why: the constructor *advertises* the dependencies; tests push fakes in with no global registry to mutate.

### C4. Spot the inversion with no seam and remove it (Go).

**Before** — a one-implementation interface + injection that decouples nothing:

```go
type Greeter interface{ Greet(name string) string }
type EnglishGreeter struct{}
func (EnglishGreeter) Greet(name string) string { return "Hello, " + name }
func welcome(g Greeter, name string) string { return g.Greet(name) }  // one impl, one caller
```

**After** — direct call; extract the seam when a second greeting is real:

```go
func welcome(name string) string { return "Hello, " + name }
```

*(Caveat to state: if a test double is needed *now*, the test seam is a present requirement and the interface is justified.)*

### C5. Write a hand-wired composition root (Python).

```python
def build_app():                      # the ONE place that knows concrete types
    clock   = SystemClock()
    repo    = PostgresOrderRepo(db_pool())   # concrete chosen here only
    gateway = StripeGateway(ENV_KEY)         # concrete chosen here only
    return App(PlaceOrder(repo, gateway, clock))   # everything injected

if __name__ == "__main__":
    build_app().run()                 # after this point: no concrete construction
```

State the benefit: every other module depends only on the abstractions it's handed; swapping `PostgresOrderRepo` for `InMemoryOrderRepo` (a test) is a one-line change here, touching no policy code.

---

## Trick Questions

### T1. "IoC means dependency injection." True?

**False.** **DI is one *kind* of IoC** (IoC ⊃ DI). DI inverts *construction*; IoC also covers inverting *flow* — template methods, callbacks, the main loop — none of which is DI. Saying "IoC" when you mean "DI" is the classic conflation.

### T2. "IoC and DIP are the same thing." Agree?

**No — different axes.** **IoC** inverts the *flow of control* (who calls whom / the runtime call graph). **DIP** inverts the *direction of source dependencies* (the compile-time graph; depend on abstractions). They cooperate beautifully at a seam, but they invert *different graphs*. You can have IoC without DIP (a template-method base class you still import) and DIP without a framework (a function taking an interface).

### T3. "A service locator is just IoC done with a registry." Right?

**Misleading.** A service locator *pulls* — the consumer actively calls `locator.get(X)`, so control of construction stays inside the consumer; it didn't invert, it just hid the dependency and coupled everyone to a global. DI *pushes* the dependency in (true construction inversion). They both answer "how do I get my dependency," but only DI inverts; the locator is the non-inverting, dependency-hiding option.

### T4. "Adding a DI container makes the code less coupled." Always?

**No.** A container only reduces coupling if you *inject abstractions* and keep the container out of business code. If people `container.get(X)` deep in services, dependencies become hidden and globally coupled to the container — *more* coupling, not less. The container is a tool; misused as a service locator it reintroduces the very coupling IoC removes.

### T5. "More inversion = better, more decoupled code." Correct?

**No.** Each inversion hides more control flow. Inverting interior logic that has *no seam* (a single-implementation strategy, a callback where a direct call would do) buys no decoupling and costs readability — you've lost explicit flow for nothing. Invert at real boundaries; stay concrete in the middle.

### T6. "If I'm on a framework, I have no choice but full IoC everywhere." True?

**No.** You adopt the framework's lifecycle at the edges, but you keep *business logic framework-agnostic* (thin adapters touch the framework; policy imports no framework types). That contains the inversion: logic stays portable, testable, and readable. Letting framework concerns leak into every class is a choice — the wrong one.

### T7. "`array.forEach(fn)` isn't IoC — that's too small to count." Agree?

**No.** When you pass `fn` to `forEach`, *it* calls *your* function — control is (briefly) inverted. IoC isn't only giant frameworks; it's any time you hand code to be called back. The principle is the same at every scale.

---

## Behavioral Questions

### B1. Tell me about a time you simplified an over-inverted design.

**Sample:** "A nightly data-sync — essentially read table A, transform, write table B — had been built on a full DI-container application framework. Startup took 40 seconds; a missing binding once failed the job mid-run instead of at compile time; new engineers needed days to add a 10-line transform. I replaced it with a plain `main` and a ~50-line hand-wired composition root. Startup became instant and the wiring was readable in one file. The lesson I quote: IoC's price — lost explicit flow, startup failures, magic, lock-in — is only worth paying at the scale that justifies it."

### B2. Describe a time a callback/timing assumption caused a bug.

**Sample:** "A handler registered with an event framework assumed it ran before another handler because it was registered first. A framework upgrade changed callback ordering, and it began running *after* the state it depended on was mutated — intermittent corruption. I made the ordering explicit as a pipeline step instead of relying on registration order. The lesson: inverting flow hands the framework control over *timing*; anything a callback assumes about when it runs is coupling to undocumented behavior."

### B3. How do you push back when a teammate over-engineers with IoC?

**Sample:** "I ask the two non-confrontational review questions: 'What real seam does this inversion serve?' and 'Can a reader still tell what runs when?' If it's a one-implementation strategy with no test need, I suggest calling the concrete directly and extracting the interface when a second case is real — citing our 'invert at seams, stay concrete inside' convention so it's a standard, not my opinion."

### B4. Tell me about decoupling business logic from a framework.

**Sample:** "Our domain classes imported `HttpServletRequest` directly. When we needed to reuse the billing logic in a batch job with no HTTP, it was impossible. I extracted framework-agnostic use-case classes and made controllers thin adapters that translate requests into plain calls. After that, the same logic ran under HTTP, a batch job, and tests. The principle: the framework can call my code (IoC), but my policy must not depend on the framework (DIP) — that keeps the inversion contained."

### B5. How do you introduce testability into legacy code that `new`s everything?

**Sample:** "Characterize the behavior first, then find the painful hard-`new` — usually a database or HTTP client buried in a method. I parameterize that construction up into the constructor, which immediately creates a test seam, then depend on an owned interface so I can inject a fake. I hoist concrete choices into a composition root as I go, opportunistically as I touch files — never a big 'add DI everywhere' project, and never jumping straight to a container."

---

## Tips for Answering

1. **Lead with the one-sentence definition** — flow of control inverted, framework calls you — and the Hollywood Principle.
2. **Nail IoC ⊃ DI and IoC ≠ DIP.** DI is a *kind* of IoC (inverts construction); DIP is a *separate axis* (dependency direction). This is the most-tested distinction.
3. **Know service locator vs DI cold:** pull (hidden, global, doesn't truly invert) vs push (explicit, testable, inverts construction). DI is the default.
4. **Always answer "which control is inverted?"** — flow (template/callback/loop) or construction (DI).
5. **Name the cost of inversion:** lost explicit flow, framework-magic debugging, config opacity, lock-in — worth it at seams, not in the interior.
6. **Quote "invert at real seams; stay concrete in the middle"** — and "the framework calls your code, but your policy must not depend on the framework."
7. **For the deep DIP/DI mechanics, cross-reference** the [Dependency Inversion topic](../../04-solid/05-dip-dependency-inversion/senior.md) rather than re-deriving it.

---

[← Professional](professional.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)
