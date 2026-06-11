# Refactoring Toward Creational Patterns — Middle Level

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

[junior.md](./junior.md) covered the three foundational creational refactorings: naming construction (creation methods), hiding concretions (encapsulate with factory), and deduplicating creation across subclasses (Factory Method). This level handles the **construction-complexity** refactorings — what to do when *assembling* an object is itself the painful part — and the trade-offs that govern when each pays off.

We cover:

1. [Telescoping constructors: the smell that starts it all](#1-telescoping-constructors-the-smell-that-starts-it-all)
2. [Encapsulate Composite with Builder](#2-encapsulate-composite-with-builder)
3. [Move Creation Knowledge to Factory](#3-move-creation-knowledge-to-factory)
4. [Extract Factory](#4-extract-factory)
5. [Static factory vs constructor: the trade-off table](#5-static-factory-vs-constructor-the-trade-off-table)
6. [The dependency-injection relationship](#6-the-dependency-injection-relationship)
7. [Next](#7-next)

---

## 1. Telescoping constructors: the smell that starts it all

Before the Builder refactorings make sense, you need to feel the pain they cure. The **telescoping constructor** is a staircase of constructors, each adding one more parameter and delegating to the next:

```java
public class HttpRequest {
    public HttpRequest(String url) { this(url, "GET"); }
    public HttpRequest(String url, String method) { this(url, method, null); }
    public HttpRequest(String url, String method, Map<String,String> headers) {
        this(url, method, headers, null);
    }
    public HttpRequest(String url, String method,
                       Map<String,String> headers, byte[] body) {
        this(url, method, headers, body, 30_000);
    }
    public HttpRequest(String url, String method, Map<String,String> headers,
                       byte[] body, int timeoutMs) { /* assign all */ }
}
```

Two failures follow. First, the call site is unreadable: `new HttpRequest(url, "POST", headers, body, 5000)` — which argument is the timeout? Second, you cannot skip a *middle* parameter: to set the timeout you must also pass `headers` and `body`, even as `null`. As optional parameters multiply, the number of constructors explodes combinatorially. This is *Effective Java* Item 2's motivating example, and it is the canonical entry point to **Builder**.

---

## 2. Encapsulate Composite with Builder

### Starting smell

Construction of a complex object — especially a recursive/tree-shaped (**Composite**) one, or a flat object with many optional fields — is repetitive, error-prone, and verbose at every call site. Either telescoping constructors (above), or worse, callers manually wiring up a tree node by node.

Kerievsky's specific case is building an XML/HTML tree by hand:

```java
TagNode root = new TagNode("flavors");
TagNode child1 = new TagNode("flavor");
child1.addAttribute("name", "vanilla");
child1.addValue("sweet and creamy");
root.add(child1);
TagNode child2 = new TagNode("flavor");
child2.addAttribute("name", "mint");
root.add(child2);
String xml = root.toString();
```

Every caller repeats this mechanical, bracket-balancing dance. Forget one `add(...)` and you get a malformed, *invalid partial object* — but you only find out at render time.

### Motivation

A **[Builder](../../../design-patterns/01-creational/03-builder/junior.md)** moves the repetitive assembly behind a small fluent API that guarantees a well-formed result. For a Composite, the builder tracks the current node and parent stack so the caller writes intent (`addBelow`, `addBeside`) rather than plumbing. For a flat object, the builder replaces telescoping constructors with named, optional setters and a single `build()` that validates before returning.

### Mechanical steps (flat-object Builder, from telescoping constructors)

1. **Create a static nested `Builder` class** inside the target. Give it one field per constructor parameter.
2. **Make the *required* parameters the Builder's constructor arguments**; everything else gets a fluent setter returning `this`.
3. **Add a `build()` method** that calls the target's now-`private` constructor with all the fields, and validates invariants *before* returning.
4. **Make the target's constructor `private`** and have it take the `Builder` (or its fields).
5. **Migrate callers** from the telescoping constructors to `new HttpRequest.Builder(url).method("POST").timeoutMs(5000).build()`. Run tests per caller.
6. **Delete the telescoping constructors** once no caller remains.

### After (flat object)

```java
public class HttpRequest {
    private final String url, method;
    private final Map<String,String> headers;
    private final byte[] body;
    private final int timeoutMs;

    private HttpRequest(Builder b) {              // step 4
        this.url = b.url; this.method = b.method;
        this.headers = b.headers; this.body = b.body;
        this.timeoutMs = b.timeoutMs;
    }

    public static class Builder {
        private final String url;                 // required
        private String method = "GET";            // sensible defaults
        private Map<String,String> headers = Map.of();
        private byte[] body = null;
        private int timeoutMs = 30_000;

        public Builder(String url) {              // required arg in ctor
            this.url = Objects.requireNonNull(url);
        }
        public Builder method(String m)  { this.method = m; return this; }
        public Builder header(String k, String v) {
            if (this.headers.isEmpty()) this.headers = new HashMap<>();
            this.headers.put(k, v); return this;
        }
        public Builder body(byte[] b)    { this.body = b; return this; }
        public Builder timeoutMs(int t)  { this.timeoutMs = t; return this; }

        public HttpRequest build() {              // step 3: validate here
            if ("GET".equals(method) && body != null)
                throw new IllegalStateException("GET cannot carry a body");
            if (timeoutMs <= 0)
                throw new IllegalArgumentException("timeout must be positive");
            return new HttpRequest(this);
        }
    }
}

// Caller, now self-documenting and skip-friendly:
HttpRequest req = new HttpRequest.Builder("https://api.x.com/v1")
        .method("POST")
        .header("Content-Type", "application/json")
        .body(payload)
        .timeoutMs(5_000)
        .build();
```

### After (Composite builder)

```java
class XmlBuilder {
    private final TagNode root;
    private TagNode current;
    private final Deque<TagNode> parents = new ArrayDeque<>();

    XmlBuilder(String rootName) { root = current = new TagNode(rootName); }

    XmlBuilder addBelow(String child) {           // descend
        TagNode node = new TagNode(child);
        current.add(node);
        parents.push(current);
        current = node;
        return this;
    }
    XmlBuilder addBeside(String sibling) {        // stay at level
        if (parents.isEmpty()) throw new IllegalStateException("no parent");
        TagNode node = new TagNode(sibling);
        parents.peek().add(node);
        current = node;
        return this;
    }
    XmlBuilder addAttribute(String k, String v) { current.addAttribute(k, v); return this; }
    String toXml() { return root.toString(); }
}

String xml = new XmlBuilder("flavors")
        .addBelow("flavor").addAttribute("name", "vanilla")
        .addBeside("flavor").addAttribute("name", "mint")
        .toXml();
```

The bracket-balancing logic is captured **once**, inside the builder; callers cannot produce an unbalanced tree.

### Resulting pattern

The **[Builder](../../../design-patterns/01-creational/03-builder/junior.md)** pattern — separating the *construction* of a complex object from its *representation*, so the same step-by-step process can build different results and can validate before handing back a finished object.

### When NOT to

- For objects with **2–3 fields, all required**, a Builder is overkill — a plain constructor or a static factory is clearer and cheaper.
- A Builder adds a layer; if invariants are simple and there are no optional fields, you are adding ceremony with no payoff.
- If the object is **immutable with few fields**, prefer a record / value object over a Builder. Builders shine when optionality and validation are real.

---

## 3. Move Creation Knowledge to Factory

### Starting smell

The *knowledge* of how to build and configure an object is smeared across the class that uses it: a constructor that reads config, branches on environment, instantiates collaborators, and wires defaults. The class's real job (say, processing orders) is drowned by creation responsibility — a [Single Responsibility](../../../design-principles/04-solid/01-srp-single-responsibility/junior.md) violation.

```java
class OrderProcessor {
    private final PricingEngine pricing;

    OrderProcessor(Config config) {
        // creation knowledge tangled into the consumer:
        if (config.region().equals("EU")) {
            this.pricing = new EuPricingEngine(config.vatTable(), config.currency());
        } else if (config.region().equals("US")) {
            this.pricing = new UsPricingEngine(config.taxRates());
        } else {
            this.pricing = new DefaultPricingEngine();
        }
    }
    // ... order processing, the actual job ...
}
```

### Motivation

`OrderProcessor` should *use* a `PricingEngine`, not know the recipe for choosing and assembling one. Move that creation knowledge to a dedicated factory. Now there is exactly **one** authoritative place that knows how a `PricingEngine` is built, and the consumer drops a responsibility.

### Mechanical steps

1. **Create a `PricingEngineFactory`** with a `create(Config)` method.
2. **Move the branching/assembly logic** verbatim from `OrderProcessor`'s constructor into the factory method. Run tests.
3. **Change `OrderProcessor` to accept a ready-made `PricingEngine`** (or the factory) instead of building it. Run tests.
4. **Update callers** to obtain the engine from the factory and pass it in.

### After

```java
class PricingEngineFactory {
    PricingEngine create(Config config) {
        switch (config.region()) {
            case "EU": return new EuPricingEngine(config.vatTable(), config.currency());
            case "US": return new UsPricingEngine(config.taxRates());
            default:   return new DefaultPricingEngine();
        }
    }
}

class OrderProcessor {
    private final PricingEngine pricing;
    OrderProcessor(PricingEngine pricing) { this.pricing = pricing; }  // just receives it
    // ... order processing only ...
}
```

### Resulting pattern

A **Factory** that centralizes creation knowledge. Note how step 3 nudged you into **constructor injection** — the consumer now *receives* its collaborator. That is the bridge to [Dependency Injection](#6-the-dependency-injection-relationship).

### When NOT to

- If the creation logic is **trivial** (`new Foo()`), moving it to a factory is pure overhead.
- If only *one* class ever creates this collaborator and there's no duplication or testing pain, the factory is speculative. Wait for the second consumer.

---

## 4. Extract Factory

### Starting smell

A class has accreted creation responsibility over time — it builds *several* kinds of objects, with their own configuration, alongside its primary job. It is *Move Creation Knowledge to Factory* at a larger scale: not one tangled collaborator, but a whole cluster of creation methods bloating one class. This is a [Large Class](../../01-code-smells/01-bloaters/middle.md) smell.

```java
class ReportService {
    // ... real reporting logic ...

    // creation responsibilities that crept in:
    Connection openConnection(String env) { /* env-specific JDBC wiring */ }
    Renderer  newRenderer(String format)  { /* PDF/HTML/CSV branching */ }
    Mailer    newMailer(Config c)         { /* SMTP setup */ }
}
```

### Motivation

These creation methods share a theme (constructing infrastructure for reporting) and pull the class in a second direction. **Extract Factory** lifts the family of creation methods into a new factory class so `ReportService` regains a single responsibility.

### Mechanical steps

1. **Create the new factory class** (e.g. `ReportInfrastructureFactory`).
2. **Move one creation method** at a time into it (Move Method), updating call sites. Run tests after each.
3. **Pass the factory into `ReportService`** (constructor injection) so it can still obtain what it needs.
4. **Verify `ReportService` no longer contains creation methods**; its surface is now reporting only.

### After

```java
class ReportInfrastructureFactory {
    Connection openConnection(String env) { /* moved */ }
    Renderer  newRenderer(String format)  { /* moved */ }
    Mailer    newMailer(Config c)         { /* moved */ }
}

class ReportService {
    private final ReportInfrastructureFactory factory;
    ReportService(ReportInfrastructureFactory factory) { this.factory = factory; }
    // ... reporting only, asks the factory when it needs infrastructure ...
}
```

### Resulting pattern

A cohesive **Factory** class; `ReportService` is restored to one responsibility, and the factory becomes a natural **testing seam** (you can inject a fake factory — see [senior.md](./senior.md)).

### When NOT to

- Don't extract a factory for **a single creation method** — that is *Move Creation Knowledge to Factory*, or possibly nothing at all.
- Extracting too eagerly creates a factory with one method per product and no shared logic; that is **factory sprawl** ([senior.md](./senior.md)). Extract when the methods cohere and the host class genuinely suffers.

---

## 5. Static factory vs constructor: the trade-off table

You now have two named-construction tools — constructors and static factory methods. Choosing is a recurring decision.

| Dimension | Constructor | Static factory method |
|---|---|---|
| **Has a name** | No — must match the class | Yes — `Loan.newTermLoan(...)`, `Optional.empty()` |
| **Can return a subtype / different impl** | No — always `this` class | Yes — `Collections.unmodifiableList` returns a hidden type |
| **Can return a cached / shared instance** | No — always a fresh object | Yes — `Boolean.valueOf(true)`, `Integer.valueOf` |
| **Multiple variants of same param types** | Impossible (signature clash) | Easy — just different method names |
| **Subclassing via `super(...)`** | Supported | Not directly — needs an accessible constructor underneath |
| **Discoverability in IDE** | High — "new" autocomplete | Lower — must know the method names (convention helps: `of`, `from`, `valueOf`, `newX`) |
| **Reflection / framework instantiation** | Frameworks expect a constructor | Some frameworks can't call arbitrary static factories |

**Rule of thumb:** reach for a static factory when construction has *meaning worth naming*, *variants that collide on type*, or *instance control* (caching, returning subtypes). Keep a constructor when creation is unambiguous and you may need subclassing or framework reflection.

---

## 6. The dependency-injection relationship

Notice a pattern across *Move Creation Knowledge to Factory* and *Extract Factory*: each ended with the consumer **receiving** its collaborator through the constructor instead of `new`-ing it. That is **Dependency Injection** (see [design-principles/04-solid/05-dip](../../../design-principles/04-solid/05-dip-dependency-inversion/junior.md)), and it is the natural endpoint of creational refactoring.

Factories and DI are complementary, not competing:

- A **factory** answers *"how is this object built?"* — it encapsulates the assembly recipe, conditional logic, and choice of concrete class.
- **Dependency injection** answers *"who hands the object to the consumer?"* — it pushes the *act of supplying* out of the consumer, so the consumer depends on an abstraction it didn't create.

The refactoring sequence almost always goes **inline `new` → factory → injected dependency**. First you name and centralize creation (factory). Then you stop the consumer from invoking the factory at all and let something upstream (a composition root, or a DI container — see [senior.md](./senior.md)) call the factory and inject the result. The consumer ends up maximally testable: pass a stub in a test, the real thing in production.

A subtle warning: a factory injected *as a dependency* is sometimes a smell. If `OrderProcessor` takes a `PricingEngineFactory` and calls it once in its constructor, you usually want to inject the **already-built `PricingEngine`** instead. Inject factories only when the consumer must create objects *repeatedly at runtime* (e.g., one per request) — then a factory (or a `Supplier<T>` / `Provider<T>`) is the right dependency.

---

## 7. Next

- [junior.md](./junior.md) — the three foundational creational refactorings.
- [senior.md](./senior.md) — factory hierarchies, arriving at Abstract Factory, DI containers, testing seams, factory sprawl, Prototype.
- [professional.md](./professional.md) — pooling vs factories, Singleton's hidden costs, thread-safe lazy init, Spring/Guice realities.
- [interview.md](./interview.md) · [tasks.md](./tasks.md) · [find-bug.md](./find-bug.md) · [optimize.md](./optimize.md)
- Patterns: [Builder](../../../design-patterns/01-creational/03-builder/junior.md) · [Factory Method](../../../design-patterns/01-creational/01-factory-method/junior.md) · [Abstract Factory](../../../design-patterns/01-creational/02-abstract-factory/junior.md)
