# Refactoring Toward Behavioral Patterns — Tasks

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/behavioral-patterns](https://refactoring.guru/design-patterns/behavioral-patterns)

Hands-on refactoring drills. Each gives smelly behavioral code, asks you to apply the right refactoring with **behavior-preserving steps**, and provides a worked solution. Resist reading the solution until you've sketched yours. The goal is the *mechanics* — small steps, tests green throughout — not just the destination.

---

## Task 1 — Replace Conditional Logic with Strategy

**Given:** a tax calculator that branches on country.

```java
public double tax(double amount, String country) {
    if (country.equals("US"))      return amount * 0.07;
    else if (country.equals("DE")) return amount * 0.19;
    else if (country.equals("JP")) return amount * 0.10;
    else if (country.equals("AE")) return 0.0;            // no VAT
    else throw new IllegalArgumentException("no tax rule: " + country);
}
```

**Do:** refactor to Strategy. Make strategies shareable singletons; let callers pass a strategy, with a string-keyed bridge for config-driven callers.

<details><summary>Worked solution</summary>

```java
public interface TaxStrategy { double tax(double amount); }

public final class FlatRateTax implements TaxStrategy {
    private final double rate;
    public FlatRateTax(double rate) { this.rate = rate; }
    public double tax(double amount) { return amount * rate; }
}

public final class TaxCalculator {
    private static final Map<String, TaxStrategy> BY_COUNTRY = Map.of(
        "US", new FlatRateTax(0.07),
        "DE", new FlatRateTax(0.19),
        "JP", new FlatRateTax(0.10),
        "AE", new FlatRateTax(0.0)        // no special class needed
    );
    public double tax(double amount, TaxStrategy s)   { return s.tax(amount); }
    public double tax(double amount, String country)  {
        TaxStrategy s = BY_COUNTRY.get(country);
        if (s == null) throw new IllegalArgumentException("no tax rule: " + country);
        return s.tax(amount);
    }
}
```

Steps taken: (1) interface `TaxStrategy`; (2) one strategy class — here all four are the same shape, so a single parameterized `FlatRateTax` suffices (don't make four identical classes!); (3) map keyed by country; (4) switch replaced by lookup. **Lesson:** when "branches" differ only by a constant, the Strategy is *one parameterized class*, not N classes — recognizing this avoids over-engineering.
</details>

---

## Task 2 — Replace State-Altering Conditionals with State

**Given:** a turnstile branching on a string state.

```java
public class Turnstile {
    private String state = "LOCKED";   // LOCKED | UNLOCKED

    public void coin() {
        if (state.equals("LOCKED"))   { state = "UNLOCKED"; openGate(); }
        else /* UNLOCKED */           { refund(); }          // already paid
    }
    public void push() {
        if (state.equals("UNLOCKED")) { state = "LOCKED"; closeGate(); }
        else /* LOCKED */             { alarm(); }            // didn't pay
    }
}
```

**Do:** refactor to State. Each state encapsulates its own behavior and transitions.

<details><summary>Worked solution</summary>

```java
interface TurnstileState {
    void coin(Turnstile t);
    void push(Turnstile t);
}

final class Locked implements TurnstileState {
    static final Locked INSTANCE = new Locked();          // stateless singleton
    public void coin(Turnstile t) { t.openGate();  t.setState(Unlocked.INSTANCE); }
    public void push(Turnstile t) { t.alarm(); }
}
final class Unlocked implements TurnstileState {
    static final Unlocked INSTANCE = new Unlocked();
    public void coin(Turnstile t) { t.refund(); }
    public void push(Turnstile t) { t.closeGate(); t.setState(Locked.INSTANCE); }
}

public class Turnstile {
    private TurnstileState state = Locked.INSTANCE;
    void setState(TurnstileState s) { this.state = s; }
    public void coin() { state.coin(this); }
    public void push() { state.push(this); }
}
```

Steps: (1) `TurnstileState` interface with `coin`/`push`; (2) `Locked`/`Unlocked` classes holding the matching branches; (3) pass `Turnstile` so states can call `setState`; (4) field becomes `TurnstileState`; (5) methods delegate. **Lesson:** states are stateless → singletons (zero allocation per transition, per [professional.md](professional.md)). Each transition now lives in exactly one place.
</details>

---

## Task 3 — Form Template Method

**Given:** two import jobs with the same skeleton.

```java
class CsvImporter {
    void run(File f) {
        log("start csv");
        var rows = parseCsv(f);
        for (var r : rows) db.insert(validateCsv(r));
        log("done csv");
    }
}
class JsonImporter {
    void run(File f) {
        log("start json");
        var rows = parseJson(f);
        for (var r : rows) db.insert(validateJson(r));
        log("done json");
    }
}
```

**Do:** Form Template Method. Pull the skeleton up; make `parse` and `validate` the varying steps.

<details><summary>Worked solution</summary>

```java
abstract class Importer {
    final void run(File f) {                 // template method, final
        log("start " + name());
        for (Row r : parse(f)) db.insert(validate(r));
        log("done " + name());
    }
    protected abstract String name();
    protected abstract List<Row> parse(File f);
    protected abstract Row validate(Row r);
}
class CsvImporter extends Importer {
    protected String name() { return "csv"; }
    protected List<Row> parse(File f) { return parseCsv(f); }
    protected Row validate(Row r)     { return validateCsv(r); }
}
class JsonImporter extends Importer {
    protected String name() { return "json"; }
    protected List<Row> parse(File f) { return parseJson(f); }
    protected Row validate(Row r)     { return validateJson(r); }
}
```

Steps: (1) align lines, mark same/differ; (2) extract `parse`/`validate`/`name` in each class with identical signatures; (3) pull the now-identical `run` into `Importer`; (4) declare the helpers abstract; (5) `final` on `run` to lock the skeleton. **Lesson:** the skeleton (logging + loop + insert) is written once; a new format is three small methods that *can't* break the shared flow.
</details>

---

## Task 4 — Replace Conditional Dispatcher with Command

**Given:** a CLI dispatcher.

```java
String execute(String cmd, String[] args) {
    switch (cmd) {
        case "add":    return String.valueOf(Integer.parseInt(args[0]) + Integer.parseInt(args[1]));
        case "greet":  return "hello " + args[0];
        case "upper":  return args[0].toUpperCase();
        default:       return "unknown: " + cmd;
    }
}
```

**Do:** refactor to a Command map. Keep it lightweight — these have no dependencies, so consider whether full classes or function objects are right.

<details><summary>Worked solution</summary>

```java
@FunctionalInterface interface Cmd { String run(String[] args); }

private static final Map<String, Cmd> COMMANDS = Map.of(
    "add",   a -> String.valueOf(Integer.parseInt(a[0]) + Integer.parseInt(a[1])),
    "greet", a -> "hello " + a[0],
    "upper", a -> a[0].toUpperCase()
);

String execute(String cmd, String[] args) {
    Cmd c = COMMANDS.get(cmd);
    return (c == null) ? "unknown: " + cmd : c.run(args);
}
```

**Lesson — judgment, not dogma:** because these branches are dependency-free transformations, *lambdas in a map* are the right weight, not three full command classes. Reserve full `Command` classes for branches that carry injected dependencies and need isolated unit tests (per [middle.md](middle.md)). Applying heavyweight Command here would be over-engineering.
</details>

---

## Task 5 — Introduce Null Object

**Given:** repeated null checks around an optional logger.

```java
class Service {
    private Logger logger;          // may be null in tests / lightweight mode
    void process(Job j) {
        if (logger != null) logger.info("processing " + j.id());
        doWork(j);
        if (logger != null) logger.info("done " + j.id());
    }
}
```

**Do:** Introduce Null Object so `process` is branch-free.

<details><summary>Worked solution</summary>

```java
interface Logger { void info(String msg); }

final class NullLogger implements Logger {
    static final Logger INSTANCE = new NullLogger();
    public void info(String msg) { /* deliberately nothing */ }
}

class Service {
    private Logger logger = NullLogger.INSTANCE;   // never null
    void setLogger(Logger l) { this.logger = (l != null) ? l : NullLogger.INSTANCE; }
    void process(Job j) {
        logger.info("processing " + j.id());
        doWork(j);
        logger.info("done " + j.id());
    }
}
```

Steps: (1) interface exists; (2) `NullLogger` with no-op `info`; (3) field defaults to `NullLogger.INSTANCE`, setter guards against real null; (4) drop the checks. **Lesson:** logging is the textbook Null Object case — silently doing nothing is *exactly correct* behavior, so absence can safely be invisible. (Contrast with "user not found," where it would not be.)
</details>

---

## Task 6 — Replace Hard-Coded Notifications with Observer

**Given:** a temperature sensor that pokes specific displays.

```java
class Sensor {
    private final LcdDisplay lcd;
    private final Logfile log;
    private final AlertSystem alerts;
    void reading(double celsius) {
        lcd.show(celsius);
        log.write(celsius);
        if (celsius > 80) alerts.fire(celsius);
    }
}
```

**Do:** refactor to Observer. Note which reaction is conditional and how it maps to a listener. Address listener-exception isolation.

<details><summary>Worked solution</summary>

```java
interface SensorListener { void onReading(double celsius); }

class Sensor {
    private final List<SensorListener> listeners = new CopyOnWriteArrayList<>();
    void addListener(SensorListener l)    { listeners.add(l); }
    void removeListener(SensorListener l) { listeners.remove(l); }
    void reading(double celsius) {
        for (SensorListener l : listeners) {
            try { l.onReading(celsius); }
            catch (RuntimeException e) { /* log + meter; don't abort the rest */ }
        }
    }
}

// Listeners — the conditional alert moves INTO its own listener:
class LcdListener   implements SensorListener { public void onReading(double c){ lcd.show(c); } }
class LogListener   implements SensorListener { public void onReading(double c){ log.write(c); } }
class AlertListener implements SensorListener { public void onReading(double c){ if (c > 80) alerts.fire(c); } }
```

**Lesson:** the `if (celsius > 80)` belongs *inside* `AlertListener`, not in the publisher — each listener owns its own relevance check. `Sensor` now depends on nothing but the listener interface. Note the per-listener try/catch (one bad listener mustn't drop the LCD update) and the paired `removeListener` to avoid the lapsed-listener leak ([professional.md](professional.md)).
</details>

---

## Task 7 — Move Accumulation to Collecting Parameter

**Given:** a monolithic method building a validation-error list.

```java
List<String> validate(Form form) {
    List<String> errors = new ArrayList<>();
    if (form.name() == null || form.name().isBlank()) errors.add("name required");
    if (form.email() != null && !form.email().contains("@")) errors.add("bad email");
    if (form.age() < 0 || form.age() > 150) errors.add("age out of range");
    // ...30 more checks
    return errors;
}
```

**Do:** break it into focused validators using a collecting parameter, so each contributes to the same `errors` list.

<details><summary>Worked solution</summary>

```java
List<String> validate(Form form) {
    List<String> errors = new ArrayList<>();   // the collecting parameter
    validateName(form, errors);
    validateEmail(form, errors);
    validateAge(form, errors);
    return errors;
}
private void validateName(Form f, List<String> out) {
    if (f.name() == null || f.name().isBlank()) out.add("name required");
}
private void validateEmail(Form f, List<String> out) {
    if (f.email() != null && !f.email().contains("@")) out.add("bad email");
}
private void validateAge(Form f, List<String> out) {
    if (f.age() < 0 || f.age() > 150) out.add("age out of range");
}
```

**Lesson:** passing `errors` *in* lets each validator contribute without returning-and-merging at the call site. Each `validateX` is now independently testable with a fresh list. Next step (if validators must be configurable at runtime) would be to make each a Strategy/`Validator` object and iterate them — but don't until that flexibility is needed.
</details>

---

## Task 8 — Move Accumulation to Visitor

**Given:** an `instanceof` cascade computing a price over a heterogeneous cart.

```java
double total(List<Item> items) {
    double sum = 0;
    for (Item i : items) {
        if (i instanceof Book b)        sum += b.price();
        else if (i instanceof Ebook e)  sum += e.price() * 1.0;       // no shipping
        else if (i instanceof GiftCard g) sum += g.faceValue();        // untaxed
    }
    return sum;
}
```

**Do:** refactor to Visitor so adding a *new operation* (e.g. total weight) won't duplicate the cascade.

<details><summary>Worked solution</summary>

```java
interface Item { <R> R accept(ItemVisitor<R> v); }
record Book(double price)      implements Item { public <R> R accept(ItemVisitor<R> v){ return v.visit(this);} }
record Ebook(double price)     implements Item { public <R> R accept(ItemVisitor<R> v){ return v.visit(this);} }
record GiftCard(double faceValue) implements Item { public <R> R accept(ItemVisitor<R> v){ return v.visit(this);} }

interface ItemVisitor<R> { R visit(Book b); R visit(Ebook e); R visit(GiftCard g); }

final class PriceVisitor implements ItemVisitor<Double> {
    public Double visit(Book b)     { return b.price(); }
    public Double visit(Ebook e)    { return e.price(); }
    public Double visit(GiftCard g) { return g.faceValue(); }
}

double total(List<Item> items) {
    PriceVisitor v = new PriceVisitor();
    return items.stream().mapToDouble(i -> i.accept(v)).sum();
}
```

**Lesson:** double dispatch (`accept` then `visit`) replaces `instanceof`. Adding "total weight" is now a new `WeightVisitor` with zero edits to the item classes. **Caveat to state aloud:** if instead *item types* churned often (not operations), Visitor would be the wrong call — a sealed-`switch` with pattern matching would be better ([senior.md](senior.md)).
</details>

---

## Next

- Diagnose broken patterns: **[find-bug.md](find-bug.md)**
- Propose-or-reject refactorings: **[optimize.md](optimize.md)**
- Theory: **[junior.md](junior.md)** · **[middle.md](middle.md)** · **[senior.md](senior.md)** · **[professional.md](professional.md)** · **[interview.md](interview.md)**
