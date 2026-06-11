# Refactoring Toward Structural Patterns — Tasks

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

Eight hands-on exercises. Each gives you smelly structural code, names the target, and asks for the **mechanical, behavior-preserving** refactoring. Try each before opening the solution. A solution is "correct" only if behavior is identical at every step and the named smell is gone.

Recommended order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (rising difficulty).

---

## Task 1 — Move Embellishment to Decorator

**Smell:** flag soup. Refactor the optional behaviors into stackable decorators.

```java
public class Notifier {
    private final String recipient;
    private boolean alsoSlack;
    private boolean alsoSms;

    public Notifier(String recipient) { this.recipient = recipient; }
    public void setAlsoSlack(boolean b) { this.alsoSlack = b; }
    public void setAlsoSms(boolean b)   { this.alsoSms = b; }

    public void send(String msg) {
        System.out.println("email -> " + recipient + ": " + msg);
        if (alsoSlack) System.out.println("slack -> " + recipient + ": " + msg);
        if (alsoSms)   System.out.println("sms -> " + recipient + ": " + msg);
    }
}
```

<details><summary>Solution</summary>

**Steps:** (1) extract `Notifier` interface with `send(String)`; (2) make the email-only class the concrete component; (3) abstract decorator delegates `send`; (4) one decorator per channel; (5) replace setters with wrapping at construction.

```java
public interface Notifier { void send(String msg); }

public class EmailNotifier implements Notifier {
    private final String recipient;
    public EmailNotifier(String recipient) { this.recipient = recipient; }
    @Override public void send(String msg) {
        System.out.println("email -> " + recipient + ": " + msg);
    }
}

public abstract class NotifierDecorator implements Notifier {
    protected final Notifier wrappee;
    protected NotifierDecorator(Notifier wrappee) { this.wrappee = wrappee; }
    @Override public void send(String msg) { wrappee.send(msg); }
}

public class SlackNotifier extends NotifierDecorator {
    private final String who;
    public SlackNotifier(Notifier w, String who) { super(w); this.who = who; }
    @Override public void send(String msg) {
        super.send(msg);
        System.out.println("slack -> " + who + ": " + msg);
    }
}
// SmsNotifier analogous.

Notifier n = new SmsNotifier(new SlackNotifier(new EmailNotifier("ann"), "ann"), "ann");
n.send("deploy done"); // email, then slack, then sms — same as both flags true
```
**Note:** order now lives at the construction site. Previously it was email→slack→sms implicitly.
</details>

---

## Task 2 — Replace Implicit Tree with Composite

**Smell:** hand-rolled tree with a type flag. Replace with leaf + branch sharing one interface.

```java
public class MenuNode {
    private final String label;
    private final boolean isItem;
    private final Runnable action;          // only when isItem
    private final List<MenuNode> children;  // only when !isItem

    public MenuNode(String label, Runnable action) {       // item
        this.label = label; this.isItem = true;
        this.action = action; this.children = null;
    }
    public MenuNode(String label) {                        // submenu
        this.label = label; this.isItem = false;
        this.action = null; this.children = new ArrayList<>();
    }
    public void add(MenuNode n) {
        if (isItem) throw new IllegalStateException();
        children.add(n);
    }
    public int leafCount() {
        if (isItem) return 1;
        int c = 0;
        for (MenuNode n : children) c += n.leafCount();
        return c;
    }
}
```

<details><summary>Solution</summary>

```java
public interface MenuComponent {
    int leafCount();
    default void add(MenuComponent c) { throw new UnsupportedOperationException(); }
}

public class MenuItem implements MenuComponent {
    private final String label; private final Runnable action;
    public MenuItem(String label, Runnable action) { this.label = label; this.action = action; }
    @Override public int leafCount() { return 1; }
}

public class Menu implements MenuComponent {
    private final String label;
    private final List<MenuComponent> children = new ArrayList<>();
    public Menu(String label) { this.label = label; }
    @Override public void add(MenuComponent c) { children.add(c); }
    @Override public int leafCount() {
        int c = 0;
        for (MenuComponent ch : children) c += ch.leafCount();
        return c;
    }
}
```
The `if (isItem)` fork vanished from every method; the dead fields (`action` for submenus, `children` for items) are gone.
</details>

---

## Task 3 — Replace One/Many Distinctions with Composite

**Smell:** every method forks on single-vs-collection.

```java
public class Invoice {
    private Charge single;          // exclusive with...
    private List<Charge> many;      // ...this

    public BigDecimal total() {
        if (many != null) {
            BigDecimal s = BigDecimal.ZERO;
            for (Charge c : many) s = s.add(c.amount());
            return s;
        }
        return single.amount();
    }
}
```

<details><summary>Solution</summary>

Make a single `Charge` and a `ChargeGroup` both implement `Billable`; `Invoice` holds one `Billable root`.

```java
public interface Billable { BigDecimal amount(); }
public class Charge implements Billable { /* returns own amount */ }
public class ChargeGroup implements Billable {
    private final List<Billable> items = new ArrayList<>();
    public void add(Billable b) { items.add(b); }
    @Override public BigDecimal amount() {
        return items.stream().map(Billable::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
    }
}
public class Invoice {
    private final Billable root;
    public Invoice(Billable root) { this.root = root; }
    public BigDecimal total() { return root.amount(); }  // no fork
}
```
</details>

---

## Task 4 — Extract Composite

**Smell:** two siblings duplicate tree plumbing.

```java
class FolderA {
    List<FolderA> subs = new ArrayList<>();
    void add(FolderA f) { subs.add(f); }
    int countLeaves() { int n = ownLeaves(); for (FolderA f : subs) n += f.countLeaves(); return n; }
    int ownLeaves() { return 1; }
}
class GroupB {
    List<GroupB> subs = new ArrayList<>();
    void add(GroupB g) { subs.add(g); }
    int countLeaves() { int n = ownLeaves(); for (GroupB g : subs) n += g.countLeaves(); return n; }
    int ownLeaves() { return 2; }
}
```

<details><summary>Solution</summary>

Pull the list, `add`, and the recursive count into a parameterized base; subclasses keep only `ownLeaves()`.

```java
abstract class TreeNode<T extends TreeNode<T>> {
    private final List<T> subs = new ArrayList<>();
    void add(T child) { subs.add(child); }
    int countLeaves() {
        int n = ownLeaves();
        for (T child : subs) n += child.countLeaves();
        return n;
    }
    protected abstract int ownLeaves();
}
class FolderA extends TreeNode<FolderA> { @Override protected int ownLeaves() { return 1; } }
class GroupB  extends TreeNode<GroupB>  { @Override protected int ownLeaves() { return 2; } }
```
**When the base would fight existing inheritance**, extract a `TreeStructure<T>` helper object each class *holds* instead of *extends*.
</details>

---

## Task 5 — Extract Adapter

**Smell:** one class switches on a provider flag in every method.

```java
public class Storage {
    private final String kind;          // "local" or "s3"
    private final FileSystem fs;
    private final S3 s3;
    public byte[] load(String id) {
        if (kind.equals("local")) return fs.readFile("/data/" + id);
        else                      return s3.getObject("bucket", id);
    }
    public void save(String id, byte[] data) {
        if (kind.equals("local")) fs.writeFile("/data/" + id, data);
        else                      s3.putObject("bucket", id, data);
    }
}
```

<details><summary>Solution</summary>

One adapter per backend behind a `Blobs` interface; `Storage` holds a single `Blobs`.

```java
public interface Blobs { byte[] load(String id); void save(String id, byte[] data); }

public class LocalBlobs implements Blobs {
    private final FileSystem fs;
    public LocalBlobs(FileSystem fs) { this.fs = fs; }
    @Override public byte[] load(String id) { return fs.readFile("/data/" + id); }
    @Override public void save(String id, byte[] d) { fs.writeFile("/data/" + id, d); }
}
public class S3Blobs implements Blobs {
    private final S3 s3;
    public S3Blobs(S3 s3) { this.s3 = s3; }
    @Override public byte[] load(String id) { return s3.getObject("bucket", id); }
    @Override public void save(String id, byte[] d) { s3.putObject("bucket", id, d); }
}
public class Storage {
    private final Blobs blobs;
    public Storage(Blobs blobs) { this.blobs = blobs; }
    public byte[] load(String id) { return blobs.load(id); }
    public void save(String id, byte[] d) { blobs.save(id, d); }
}
```
The `kind` flag is gone; a third backend is a new adapter.
</details>

---

## Task 6 — Encapsulate Decorator chain with Builder

**Smell:** callers hand-nest decorators and can build illegal orderings.

```java
// Compression must happen INSIDE encryption (encrypted data won't compress).
// But nothing stops a caller writing it backwards:
Stream s = new CompressStream(new EncryptStream(raw, key)); // WRONG order, compiles fine
```

<details><summary>Solution</summary>

Give a builder that owns the legal order and exposes intent-named steps.

```java
public final class StreamBuilder {
    private Stream stream;
    private boolean compressed = false;
    private StreamBuilder(Stream base) { this.stream = base; }
    public static StreamBuilder from(Stream base) { return new StreamBuilder(base); }

    public StreamBuilder compress() {
        if (stream instanceof EncryptStream)
            throw new IllegalStateException("compress before encrypt");
        stream = new CompressStream(stream);
        compressed = true;
        return this;
    }
    public StreamBuilder encrypt(byte[] key) {
        stream = new EncryptStream(stream, key);
        return this;
    }
    public Stream build() { return stream; }
}

Stream s = StreamBuilder.from(raw).compress().encrypt(key).build(); // legal order enforced
```
Invalid orderings are now rejected (or unrepresentable), and the call site reads top-to-bottom.
</details>

---

## Task 7 — Unify Interfaces with Adapter

**Smell:** the client wants `Iterator`-shaped access; the class offers a cursor API you don't own.

```java
interface Rows { boolean hasNext(); Map<String,Object> next(); }   // client expects this

class JdbcResult {                                                  // third-party, can't change
    boolean advance() { /* ... */ return false; }
    Object column(String name) { /* ... */ return null; }
    String[] columnNames() { /* ... */ return new String[0]; }
}
```

<details><summary>Solution</summary>

```java
public class JdbcRowsAdapter implements Rows {
    private final JdbcResult rs;
    public JdbcRowsAdapter(JdbcResult rs) { this.rs = rs; }
    @Override public boolean hasNext() { return rs.advance(); }
    @Override public Map<String,Object> next() {
        Map<String,Object> row = new HashMap<>();
        for (String c : rs.columnNames()) row.put(c, rs.column(c));
        return row;
    }
}
```
Neither side changed; the client now consumes `JdbcResult` through its expected `Rows` interface.
**Caveat:** if you owned `JdbcResult` and the interfaces would permanently align, you'd rewrite one side instead of adding this layer.
</details>

---

## Task 8 — Introduce Facade

**Smell:** every caller wires up a subsystem of collaborators in the right order.

```java
// Repeated at every call site:
RiskEngine risk = new RiskEngine(config);
FraudCheck fraud = new FraudCheck(risk);
Ledger ledger = new Ledger(db);
Notifier notifier = new Notifier(smtp);

if (fraud.passes(order) && risk.score(order) < 0.8) {
    ledger.record(order);
    notifier.confirm(order);
}
```

<details><summary>Solution</summary>

One facade owns the wiring and the orchestration; clients call `placeOrder`.

```java
public class OrderFacade {
    private final FraudCheck fraud;
    private final RiskEngine risk;
    private final Ledger ledger;
    private final Notifier notifier;

    public OrderFacade(Config config, Db db, Smtp smtp) {
        this.risk = new RiskEngine(config);
        this.fraud = new FraudCheck(risk);
        this.ledger = new Ledger(db);
        this.notifier = new Notifier(smtp);
    }

    public boolean placeOrder(Order order) {
        if (!fraud.passes(order) || risk.score(order) >= 0.8) return false;
        ledger.record(order);
        notifier.confirm(order);
        return true;
    }
}
// Client: orderFacade.placeOrder(order);
```
**When NOT to:** if there's exactly one subsystem class behind it, that's an Adapter (or just a method), not a Facade. Facade earns its name when it hides *several* collaborators.
</details>

---

## Next

- [find-bug.md](find-bug.md) — Diagnose broken structural patterns.
- [optimize.md](optimize.md) — Propose (or reject) structural refactorings.
- Back to [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) · [interview.md](interview.md)
