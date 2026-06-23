# Designing for Extension & Polymorphism — Middle

> **What?** Practical mechanics of building extension points: the four seam shapes (Strategy, Template Method, Abstract Factory, plugin/SPI), how each looks in real Java, how to design `protected` hooks that survive evolution, and how to discover providers at runtime with `ServiceLoader`. Plus the inverse skill — knowing when an exhaustive `switch` over a sealed type is the *right* answer and polymorphism would be worse.
> **How?** Pick the seam that matches the shape of your variation, keep the abstraction narrow, and treat the seam as published API the moment anyone outside the class touches it.

---

## 1. The four seam shapes, side by side

Every extension point is one of these. Knowing which you have is half the design.

| Seam | Mechanism | Varies | Wire-up | Use when |
| --- | --- | --- | --- | --- |
| **Strategy** | interface field (composition) | a whole algorithm | constructor / setter | swappable behaviour, chosen per instance |
| **Template Method** | abstract method (inheritance) | *steps* inside a fixed skeleton | subclassing | the algorithm's shape is fixed, a few steps differ |
| **Abstract Factory** | interface returning interfaces | a whole *family* of related objects | inject the factory | you need consistent sets (a "theme") |
| **Plugin / SPI** | published interface + discovery | implementations you'll never see | `ServiceLoader` / DI scan | third parties extend you |

The rest of this file is each one, concretely.

---

## 2. Strategy — the default seam

Strategy is composition: hold the varying behaviour as a field. Because Java has functional interfaces, a Strategy with one method is often just a lambda.

```java
@FunctionalInterface
interface RetryPolicy {
    boolean shouldRetry(int attempt, Exception e);
}

class HttpClient {
    private final RetryPolicy retry;
    HttpClient(RetryPolicy retry) { this.retry = retry; }

    Response send(Request r) {
        for (int attempt = 1; ; attempt++) {
            try { return doSend(r); }
            catch (IOException e) {
                if (!retry.shouldRetry(attempt, e)) throw new UncheckedIOException(e);
            }
        }
    }
}

// Strategies are values now — no class needed:
var noRetry   = (RetryPolicy) (n, e) -> false;
var thrice    = (RetryPolicy) (n, e) -> n < 3;
var on5xxOnly = (RetryPolicy) (n, e) -> n < 5 && e instanceof HttpServerException;
```

A single-method seam *is* a Strategy point even when you never write the word. `Comparator`, `Predicate`, `Function`, `Supplier` are the JDK's pre-built strategy interfaces — reach for them before inventing your own. This connects to [../../05-advanced-language-features/04-functional-interfaces-and-lambdas/](../../05-advanced-language-features/04-functional-interfaces-and-lambdas/).

---

## 3. Template Method — fixed skeleton, varying steps

When the *order* of operations is the invariant and only specific steps differ, Template Method fits. The discipline: the template is `final`, the steps are `abstract` (required) or have a default body (optional hook).

```java
abstract class HttpRequestHandler {
    // The skeleton: fixed order, cannot be reordered or skipped.
    public final Response handle(Request req) {
        authenticate(req);                 // hook with default
        validate(req);                     // required step
        var result = process(req);         // required step
        return render(result);             // hook with default
    }

    protected void authenticate(Request req) { /* default: no auth */ }
    protected abstract void validate(Request req);          // subclass MUST supply
    protected abstract Object process(Request req);         // subclass MUST supply
    protected Response render(Object result) {              // subclass MAY override
        return Response.json(result);
    }
}

final class CreateUserHandler extends HttpRequestHandler {
    protected void validate(Request req)  { /* check body */ }
    protected Object process(Request req) { /* insert user */ return /* user */; }
    // authenticate + render inherited
}
```

Three rules that make this safe:

1. **`final` template.** Subclasses fill gaps; they don't rewrite control flow.
2. **`protected`, not `public`, hooks.** Hooks are for subclasses, not callers. Callers use `handle`.
3. **`abstract` for required steps, default body for optional ones.** The compiler then *forces* the required steps and makes optional ones genuinely optional.

The hazard Template Method carries is the **fragile base class problem** — the base class's self-use is now part of its contract. See [../../03-design-principles/06-fragile-base-class-problem/](../../03-design-principles/06-fragile-base-class-problem/).

---

## 4. Strategy vs Template Method — the same problem, two seams

The shipping example from `junior.md`, done both ways:

```java
// Strategy: the whole rule is swapped
interface ShippingRule { Money cost(Order o); }
class Calculator { Calculator(ShippingRule r){...} }     // compose

// Template Method: cost = base*weight + surcharge, only surcharge() varies
abstract class ShippingRule {
    public final Money cost(Order o) {                   // fixed formula
        return base().times(o.weight()).plus(surcharge(o));
    }
    protected Money base() { return Money.of(2); }
    protected abstract Money surcharge(Order o);         // the only gap
}
```

Choose by asking: *does the whole algorithm vary, or only a step?*

- Whole algorithm varies → **Strategy**. Also: lets you change behaviour *at runtime*, mix strategies, and test the strategy in isolation.
- Only steps vary, skeleton is shared and fixed → **Template Method**. Reuses the skeleton without re-passing it.

Modern Java leans Strategy because composition avoids inheritance's coupling and a Strategy can be a lambda. Reach for Template Method when the shared skeleton is substantial and genuinely fixed. See [../../03-design-principles/02-composition-over-inheritance/](../../03-design-principles/02-composition-over-inheritance/).

---

## 5. Abstract Factory — extending a whole *family*

When variation comes in *consistent sets* — a light theme's button + scrollbar + menu must all match — a single Strategy isn't enough. Abstract Factory makes the *family* the unit of extension.

```java
interface UiFactory {                       // the seam: a family producer
    Button   newButton();
    Scrollbar newScrollbar();
}

final class DarkUiFactory implements UiFactory {
    public Button   newButton()    { return new DarkButton(); }
    public Scrollbar newScrollbar() { return new DarkScrollbar(); }
}

class Toolbar {
    private final UiFactory ui;
    Toolbar(UiFactory ui) { this.ui = ui; }
    void build() { var b = ui.newButton(); var s = ui.newScrollbar(); /* always matched */ }
}
```

Adding a "high-contrast" theme = one new `UiFactory` implementation; `Toolbar` never changes. The factory *guarantees consistency* across the family — you can't accidentally pair a dark button with a light scrollbar.

---

## 6. Plugin / SPI — extension by code you don't ship

A Service Provider Interface is an interface you *publish* so others implement it, plus a discovery mechanism so you find their implementations without naming them.

```java
// In your published api module:
public interface ImageCodec {
    boolean canDecode(byte[] header);
    BufferedImage decode(InputStream in);
}
```

A provider declares itself in `META-INF/services/com.acme.ImageCodec` (or, with JPMS, `provides ImageCodec with WebpCodec;`). You discover providers at runtime:

```java
public final class ImageReader {
    private final List<ImageCodec> codecs =
        ServiceLoader.load(ImageCodec.class).stream()
                     .map(ServiceLoader.Provider::get)
                     .toList();

    public BufferedImage read(InputStream in) throws IOException {
        byte[] header = in.readNBytes(16);
        return codecs.stream()
                     .filter(c -> c.canDecode(header))
                     .findFirst()
                     .orElseThrow(() -> new IOException("no codec"))
                     .decode(/* full stream */);
    }
}
```

`ImageReader` was compiled before `WebpCodec` existed. Dropping `webp-codec.jar` on the classpath adds the format with *zero* changes to your code. That is Open/Closed at the deployment boundary. The JDK ships dozens of SPIs this way; see [../../05-advanced-language-features/02-jpms-modules/](../../05-advanced-language-features/02-jpms-modules/) for `provides`/`uses`.

---

## 7. Designing the hooks: what to expose, what to hide

Whichever seam you pick, the contract is defined by what you make extensible. Get the *granularity* right:

| Too coarse | Too fine | Right |
| --- | --- | --- |
| One giant `handle()` method to override — subclasser must re-implement everything | 20 tiny `protected` hooks — every internal step is now frozen API | A few meaningful hooks at *decision points* (`validate`, `authorize`, `onError`) |

Each `protected` method is a promise: it will keep being called, in the same place, with the same meaning. So expose *fewer, larger, more meaningful* hooks. A hook you can quietly stop calling later is one you should have made `private` or `final`.

```java
abstract class JobRunner {
    public final void run() {
        var ctx = setUp();          // hook: subclass prepares
        try     { execute(ctx); }   // required
        finally { tearDown(ctx); }  // hook: subclass cleans up — guaranteed to run
    }
    protected JobContext setUp()            { return JobContext.empty(); }
    protected abstract void execute(JobContext ctx);
    protected void tearDown(JobContext ctx) { /* default: nothing */ }
}
```

`setUp`/`execute`/`tearDown` are *decision points* a subclasser actually cares about — not incidental implementation steps.

---

## 8. The inverse skill: when an exhaustive switch beats polymorphism

Polymorphism puts each behaviour *inside* the type. That's wrong when the behaviour *doesn't belong to the type* — it belongs to a caller that happens to vary by type. A pretty-printer, a serializer, a cost report: these are operations *on* the model, not responsibilities *of* the model. Forcing them into the type pollutes it with concerns it shouldn't know about (this is the Expression Problem in miniature).

For a **sealed** family, an exhaustive `switch` keeps the operation where it belongs *and* stays safe:

```java
sealed interface Json permits JNull, JBool, JNum, JStr, JArr, JObj { }

// A renderer lives OUTSIDE the model — Json types don't know about HTML.
String toHtml(Json j) {
    return switch (j) {                       // compiler proves exhaustiveness
        case JNull n  -> "<i>null</i>";
        case JBool b  -> String.valueOf(b.value());
        case JNum n   -> "<b>" + n.value() + "</b>";
        case JStr s   -> "\"" + escape(s.value()) + "\"";
        case JArr a   -> a.items().stream().map(this::toHtml).collect(joining(", "));
        case JObj o   -> renderObject(o);
        // no default: add a 7th variant → this won't compile until you handle it
    };
}
```

Add a `JDate` variant and *every* exhaustive switch over `Json` fails to compile until updated — the compiler hands you a to-do list. With open polymorphism you'd silently get a `toHtml` missing for the new type, or scatter HTML knowledge into the model.

**Heuristic:** behaviour intrinsic to the type, with an *open/growing* set → polymorphism. Operations *external* to the type, over a *closed/known* set → sealed + exhaustive switch. See [../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/](../../05-advanced-language-features/01-sealed-classes-and-pattern-matching/).

---

## 9. Wiring the seams: who chooses the implementation?

A seam is useless without something to plug it. The *composition root* — typically `main` or a DI container — picks concrete implementations and wires them in. Keep that choice in *one* place; don't scatter `new GzipCompressor()` through the codebase.

```java
// composition root — the ONE place that knows concrete types
var compressor = config.fast() ? new ZstdCompressor() : new GzipCompressor();
var retry      = config.flaky() ? RetryPolicy.exponential(5) : RetryPolicy.none();
var client     = new HttpClient(retry);
var archiver   = new Archiver(compressor);
```

This keeps every other class *closed*: they receive abstractions and never name a concrete variant. See [../01-grasp-responsibility-assignment/](../01-grasp-responsibility-assignment/) (Creator/Controller) for where this responsibility lives.

---

## 10. A realistic mixed example

Most real components combine seams. A notification service:

```java
// Strategy seam: how to format
interface MessageFormatter { String format(Event e); }

// Plugin/SPI seam: where to send — discovered at runtime
public interface Channel {
    boolean supports(Severity s);
    void send(String message);
}

final class Notifier {
    private final MessageFormatter formatter;             // injected strategy
    private final List<Channel> channels;                 // discovered plugins

    Notifier(MessageFormatter f) {
        this.formatter = f;
        this.channels  = ServiceLoader.load(Channel.class).stream()
                                      .map(ServiceLoader.Provider::get).toList();
    }

    void notify(Event e) {
        var msg = formatter.format(e);
        channels.stream().filter(c -> c.supports(e.severity()))
                         .forEach(c -> c.send(msg));
    }
}
```

`Notifier` is closed: adding a Slack channel is a new `Channel` provider, and changing the message format is a new `MessageFormatter`. Neither touches `Notifier`.

---

## 11. Quick rules

- [ ] Match the seam to the shape: whole algorithm → Strategy; steps in a fixed skeleton → Template Method; consistent family → Abstract Factory; strangers extend → SPI.
- [ ] Prefer Strategy/composition; use a JDK functional interface if one fits.
- [ ] Template Method: `final` template, `protected` hooks, `abstract` for required steps.
- [ ] Expose *few, meaningful* hooks at decision points — each is frozen API.
- [ ] Keep concrete choices in the composition root; everything else depends on abstractions.
- [ ] Closed, known set + external operation → sealed + exhaustive `switch`, not polymorphism.

---

## 12. What's next

| Topic | File |
| --- | --- |
| Stable-abstraction design, variance, SPI evolution, dispatch internals | `senior.md` |
| Reviewing for extensibility; tooling; refactoring playbook | `professional.md` |
| OCP / Protected Variations / Bloch / GoF / JLS sources | `specification.md` |
| Rigid-switch and unsafe-subclass bugs | `find-bug.md` |
| Measuring and removing conditional explosion | `optimize.md` |

---

**Memorize this:** four seam shapes cover almost everything — Strategy (compose a swappable algorithm), Template Method (fill gaps in a `final` skeleton), Abstract Factory (extend a whole family), and SPI (let strangers plug in via `ServiceLoader`). Pick by the shape of the variation, keep hooks few and meaningful, wire concretes only at the composition root — and when the operation lives *outside* a closed type family, an exhaustive `switch` over a sealed type beats polymorphism.
