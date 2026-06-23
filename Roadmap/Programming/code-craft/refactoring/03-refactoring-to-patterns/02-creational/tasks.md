# Refactoring Toward Creational Patterns — Hands-On Tasks

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/creational-patterns](https://refactoring.guru/design-patterns/creational-patterns)

Each task gives smelly creation code, names the refactoring to apply, and asks for the *mechanical steps* + the after-code. Work it yourself, then expand the solution. Keep every step **behavior-preserving** — the resulting objects must be identical.

---

## Task 1 — Replace Constructors with Creation Methods

Smelly code:

```java
public class Money {
    private final long amount;       // minor units (cents)
    private final String currency;

    public Money(long amount, String currency) { this.amount = amount; this.currency = currency; }
    public Money(double majorUnits, String currency) {       // dollars → cents
        this(Math.round(majorUnits * 100), currency);
    }
}
```

`new Money(5, "USD")` — is that 5 cents or $5? `5` is an `int`, widens to `long`, so it silently calls the *cents* constructor. Ambiguous and bug-prone. Refactor to named creation methods.

<details><summary>Worked solution</summary>

Steps: (1) add `Money.ofCents(long, String)` and `Money.ofMajor(double, String)` delegating to a single private constructor; (2) redirect callers; (3) make constructors private.

```java
public class Money {
    private final long amount;
    private final String currency;
    private Money(long amount, String currency) { this.amount = amount; this.currency = currency; }

    public static Money ofCents(long cents, String currency) { return new Money(cents, currency); }
    public static Money ofMajor(double major, String currency) {
        return new Money(Math.round(major * 100), currency);
    }
}

Money fiveDollars = Money.ofMajor(5, "USD");   // unambiguous
Money fiveCents   = Money.ofCents(5, "USD");
```
The double/long overload ambiguity is gone because the *names* disambiguate.
</details>

---

## Task 2 — Encapsulate Classes with Factory

Smelly code:

```java
public interface Exporter { byte[] export(Report r); }
public class PdfExporter  implements Exporter { public byte[] export(Report r){ /*...*/ } }
public class CsvExporter  implements Exporter { public byte[] export(Report r){ /*...*/ } }
public class HtmlExporter implements Exporter { public byte[] export(Report r){ /*...*/ } }

// Duplicated across three call sites:
Exporter e;
if (fmt.equals("pdf")) e = new PdfExporter();
else if (fmt.equals("csv")) e = new CsvExporter();
else e = new HtmlExporter();
```

Hide the concrete exporters behind a factory; clients depend only on `Exporter`.

<details><summary>Worked solution</summary>

Steps: (1) create `ExporterFactory` with `create(Format)`; (2) move the branching in; (3) redirect all three call sites; (4) make the concrete classes package-private; (5) enum discriminator for type safety.

```java
public final class ExporterFactory {
    public enum Format { PDF, CSV, HTML }
    public Exporter create(Format f) {
        return switch (f) {
            case PDF  -> new PdfExporter();
            case CSV  -> new CsvExporter();
            case HTML -> new HtmlExporter();
        };
    }
}
// PdfExporter/CsvExporter/HtmlExporter drop `public` → package-private.
// Clients: exporterFactory.create(Format.PDF) — concretions are now a package secret.
```
Adding `XlsxExporter` is now a one-place change.
</details>

---

## Task 3 — Introduce Polymorphic Creation with Factory Method

Smelly code:

```java
abstract class ConnectionPoolManager {
    abstract void warmUp();
}
class PostgresPoolManager extends ConnectionPoolManager {
    void warmUp() {
        // 15 identical lines of pool-sizing logic ...
        DataSource ds = new PgDataSource();   // only difference
        // 10 identical lines registering ds ...
    }
}
class MySqlPoolManager extends ConnectionPoolManager {
    void warmUp() {
        // the SAME 15 lines ...
        DataSource ds = new MySqlDataSource(); // only difference
        // the SAME 10 lines ...
    }
}
```

Deduplicate via a Factory Method.

<details><summary>Worked solution</summary>

Steps: (1) extract `createDataSource()` in each subclass; (2) give them the same signature; (3) pull the duplicated `warmUp()` body up to the superclass, calling `createDataSource()`; (4) make `createDataSource()` abstract; (5) delete the empty `warmUp()` overrides.

```java
abstract class ConnectionPoolManager {
    final void warmUp() {
        // 15 lines of pool-sizing (ONCE) ...
        DataSource ds = createDataSource();    // polymorphic hook
        // 10 lines registering ds (ONCE) ...
    }
    protected abstract DataSource createDataSource();   // Factory Method
}
class PostgresPoolManager extends ConnectionPoolManager {
    protected DataSource createDataSource() { return new PgDataSource(); }
}
class MySqlPoolManager extends ConnectionPoolManager {
    protected DataSource createDataSource() { return new MySqlDataSource(); }
}
```
25 duplicated lines collapse to one shared method + a one-line hook each.
</details>

---

## Task 4 — Replace telescoping constructors with a Builder

Smelly code:

```java
public class EmailMessage {
    public EmailMessage(String to) { this(to, null); }
    public EmailMessage(String to, String subject) { this(to, subject, null); }
    public EmailMessage(String to, String subject, String body) { this(to, subject, body, false); }
    public EmailMessage(String to, String subject, String body, boolean html) {
        this(to, subject, body, html, List.of());
    }
    public EmailMessage(String to, String subject, String body, boolean html, List<String> cc) { /*...*/ }
}
// new EmailMessage("a@x.com", "Hi", "Body", true, List.of("b@x.com")) — opaque
```

Introduce a Builder. `to` is required; the rest optional. `build()` must reject an empty `to`.

<details><summary>Worked solution</summary>

Steps: (1) static nested `Builder`, one field per param; (2) required `to` in the Builder constructor, fluent setters for the rest; (3) `build()` validates then calls the private constructor; (4) private constructor; (5) migrate callers; (6) delete telescoping constructors.

```java
public class EmailMessage {
    private final String to, subject, body; private final boolean html; private final List<String> cc;
    private EmailMessage(Builder b){ to=b.to; subject=b.subject; body=b.body; html=b.html; cc=b.cc; }

    public static class Builder {
        private final String to;
        private String subject = ""; private String body = "";
        private boolean html = false; private List<String> cc = List.of();
        public Builder(String to){ this.to = to; }
        public Builder subject(String s){ this.subject = s; return this; }
        public Builder body(String b){ this.body = b; return this; }
        public Builder html(boolean h){ this.html = h; return this; }
        public Builder cc(List<String> c){ this.cc = List.copyOf(c); return this; }
        public EmailMessage build() {
            if (to == null || to.isBlank()) throw new IllegalStateException("recipient required");
            return new EmailMessage(this);
        }
    }
}
EmailMessage m = new EmailMessage.Builder("a@x.com").subject("Hi").body("Body").html(true).build();
```
</details>

---

## Task 5 — Move Creation Knowledge to Factory

Smelly code:

```java
class CheckoutService {
    private final PaymentGateway gateway;
    CheckoutService(String provider, Map<String,String> secrets) {
        if (provider.equals("stripe"))      gateway = new StripeGateway(secrets.get("stripe_key"));
        else if (provider.equals("paypal")) gateway = new PaypalGateway(secrets.get("pp_id"), secrets.get("pp_secret"));
        else                                 gateway = new MockGateway();
    }
    void charge(Order o) { gateway.charge(o.total()); }
}
```

`CheckoutService` knows how to *build* gateways — not its job. Move it out.

<details><summary>Worked solution</summary>

Steps: (1) `PaymentGatewayFactory` with `create(provider, secrets)`; (2) move branching in; (3) `CheckoutService` receives a ready `PaymentGateway`; (4) caller obtains gateway from factory, injects it.

```java
class PaymentGatewayFactory {
    PaymentGateway create(String provider, Map<String,String> secrets) {
        return switch (provider) {
            case "stripe" -> new StripeGateway(secrets.get("stripe_key"));
            case "paypal" -> new PaypalGateway(secrets.get("pp_id"), secrets.get("pp_secret"));
            default        -> new MockGateway();
        };
    }
}
class CheckoutService {
    private final PaymentGateway gateway;
    CheckoutService(PaymentGateway gateway) { this.gateway = gateway; }   // just receives it
    void charge(Order o) { gateway.charge(o.total()); }
}
```
Bonus: step 3 made `CheckoutService` trivially testable with a stub gateway.
</details>

---

## Task 6 — Extract Factory from a bloated class

Smelly code:

```java
class IngestionPipeline {
    void run(Path file) { /* real ingestion logic */ }

    // creation responsibilities that crept in:
    Parser   newParser(String ext)     { return ext.equals("csv") ? new CsvParser() : new JsonParser(); }
    Validator newValidator(Schema s)   { return new SchemaValidator(s); }
    Sink     newSink(Config c)         { return c.dryRun() ? new NullSink() : new DbSink(c.dsn()); }
}
```

Lift the creation cluster into a factory; restore single responsibility.

<details><summary>Worked solution</summary>

Steps: (1) `IngestionComponentFactory`; (2) Move Method for each of the three (update call sites, run tests each time); (3) inject the factory into `IngestionPipeline`; (4) confirm the pipeline holds no creation methods.

```java
class IngestionComponentFactory {
    Parser    newParser(String ext)   { return ext.equals("csv") ? new CsvParser() : new JsonParser(); }
    Validator newValidator(Schema s)  { return new SchemaValidator(s); }
    Sink      newSink(Config c)       { return c.dryRun() ? new NullSink() : new DbSink(c.dsn()); }
}
class IngestionPipeline {
    private final IngestionComponentFactory factory;
    IngestionPipeline(IngestionComponentFactory factory) { this.factory = factory; }
    void run(Path file) { /* ingestion only, asks factory for components */ }
}
```
</details>

---

## Task 7 — Refactor toward Abstract Factory

Smelly code:

```java
class ThemeFactory {
    Button createButton(boolean dark) { return dark ? new DarkButton() : new LightButton(); }
    Panel  createPanel(boolean dark)  { return dark ? new DarkPanel()  : new LightPanel();  }
    Icon   createIcon(boolean dark)   { return dark ? new DarkIcon()   : new LightIcon();   }
}
```

The `dark` discriminator is duplicated three times and lets callers mix a `DarkButton` with a `LightPanel`. Refactor to Abstract Factory.

<details><summary>Worked solution</summary>

Steps: (1) extract an interface `ThemeFactory { Button createButton(); Panel createPanel(); Icon createIcon(); }` (no discriminator); (2) one impl per value — `DarkThemeFactory`, `LightThemeFactory`; (3) move the `dark ? ... : ...` decision to the composition root (`dark ? new DarkThemeFactory() : new LightThemeFactory()`); (4) inject the chosen factory; (5) delete the old class.

```java
interface ThemeFactory { Button createButton(); Panel createPanel(); Icon createIcon(); }
class DarkThemeFactory implements ThemeFactory {
    public Button createButton(){ return new DarkButton(); }
    public Panel  createPanel(){  return new DarkPanel();  }
    public Icon   createIcon(){   return new DarkIcon();   }
}
class LightThemeFactory implements ThemeFactory { /* light family */ }
// Root: ThemeFactory tf = dark ? new DarkThemeFactory() : new LightThemeFactory();
```
Now families can't mix, and adding `HighContrastThemeFactory` is one new class (OCP).
</details>

---

## Task 8 — Refactor toward Prototype

Smelly code:

```java
class SimulationRunner {
    Grid run(String scenario) {
        Grid g = new Grid(parseTerrain("map.dat"), computeDefaultRules()); // expensive: ~400ms each
        applyScenario(g, scenario);
        return g;
    }
}
// Called 500×; the 400ms construction repeats every time.
```

The terrain parse + default-rules computation is identical across calls. Refactor to Prototype.

<details><summary>Worked solution</summary>

Steps: (1) build the baseline `Grid` once and hold it as a prototype; (2) add a copy constructor (deep-copy mutable rules, share immutable terrain); (3) replace per-call construction with `prototype.copy()` + scenario; (4) verify a clone's mutation can't leak into the prototype.

```java
class SimulationRunner {
    private final Grid prototype = new Grid(parseTerrain("map.dat"), computeDefaultRules()); // once
    Grid run(String scenario) {
        Grid g = prototype.copy();       // cheap
        applyScenario(g, scenario);
        return g;
    }
}
final class Grid {
    private final Terrain terrain;   // immutable → share
    private Ruleset rules;           // mutable → deep-copy
    Grid(Terrain t, Ruleset r){ terrain=t; rules=r; }
    Grid(Grid o){ this.terrain = o.terrain; this.rules = o.rules.copy(); }
    Grid copy(){ return new Grid(this); }
}
```
500 × 400ms → one 400ms construction + 500 cheap copies. Confirm `applyScenario` mutates only the clone.
</details>

---

## Task 9 — Inline Singleton

Smelly code:

```java
class FeatureFlags {
    private static final FeatureFlags INSTANCE = new FeatureFlags();
    private final Map<String,Boolean> flags = loadFromEnv();
    private FeatureFlags() {}
    public static FeatureFlags getInstance() { return INSTANCE; }
    public boolean isOn(String key) { return flags.getOrDefault(key, false); }
}
class Renderer {
    void draw() { if (FeatureFlags.getInstance().isOn("new_ui")) drawNewUi(); }
}
```

Tests can't override flags; the dependency is hidden. Inline the Singleton.

<details><summary>Worked solution</summary>

Steps: (1) create one `FeatureFlags` at the composition root; (2) give `Renderer` a `FeatureFlags` field via constructor; (3) replace `getInstance()` with the field; (4) wire from the root; (5) delete the static instance + `getInstance()`, open the constructor.

```java
class FeatureFlags {
    private final Map<String,Boolean> flags;
    public FeatureFlags(Map<String,Boolean> flags) { this.flags = flags; }   // injectable
    public boolean isOn(String key) { return flags.getOrDefault(key, false); }
}
class Renderer {
    private final FeatureFlags flags;
    Renderer(FeatureFlags flags) { this.flags = flags; }     // explicit dependency
    void draw() { if (flags.isOn("new_ui")) drawNewUi(); }
}
// Root: FeatureFlags flags = new FeatureFlags(loadFromEnv()); new Renderer(flags);
```
Still one instance (owned by the root), but no global access point — tests pass `new FeatureFlags(Map.of("new_ui", true))`.
</details>

---

## Next

- [find-bug.md](./find-bug.md) — diagnose broken/mis-factored creation code.
- [optimize.md](./optimize.md) — propose (or reject) creational refactorings.
- Back to theory: [junior.md](./junior.md) · [middle.md](./middle.md) · [senior.md](./senior.md) · [professional.md](./professional.md)
