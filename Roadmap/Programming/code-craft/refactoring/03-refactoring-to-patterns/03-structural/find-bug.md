# Refactoring Toward Structural Patterns — Find the Bug

> **Source:** Joshua Kerievsky, *Refactoring to Patterns* (Addison-Wesley, 2004); [refactoring.guru/design-patterns/structural-patterns](https://refactoring.guru/design-patterns/structural-patterns)

Seven snippets where a structural pattern is **present but broken** — the shape is right, the behavior is wrong. These are the failures that pass code review because "it implements the interface" yet detonate in production. For each: read the code, find the defect, then open the diagnosis. The recurring theme is that structural patterns impose *contracts and invariants* that the syntax doesn't enforce.

---

## Bug 1 — Decorator that breaks the component contract

```java
interface InputStreamLike { int read(); }   // contract: returns -1 at end of stream, else a byte 0..255

class CapStream implements InputStreamLike {
    private final InputStreamLike wrappee;
    private int remaining;
    CapStream(InputStreamLike w, int limit) { this.wrappee = w; this.remaining = limit; }

    @Override public int read() {
        if (remaining == 0) return 0;        // "no more allowed"
        remaining--;
        return wrappee.read();
    }
}
```

<details><summary>Diagnosis & fix</summary>

**Bug:** the decorator returns `0` to signal "limit reached," but the component contract says `0` is a *valid byte* and **-1** means end-of-stream. Every client written to the contract (`while ((b = read()) != -1)`) will loop forever or treat a NUL byte as real data. The decorator "implements the interface" but violates its *behavioral* contract — a Liskov violation hiding in a wrapper.

**Fix:** return `-1` (the contract's EOF sentinel) when the cap is hit.
```java
@Override public int read() {
    if (remaining == 0) return -1;   // honor the EOF contract
    remaining--;
    return wrappee.read();
}
```
**Lesson:** a decorator must preserve the *postconditions* of the interface, not merely its signatures. Run the decorated object against the same contract tests as the bare component.
</details>

---

## Bug 2 — Composite that leaks the leaf/branch distinction

```java
interface Node { int size(); }

class Leaf implements Node {
    @Override public int size() { return 1; }
}
class Branch implements Node {
    final List<Node> children = new ArrayList<>();
    @Override public int size() {
        int n = 0;
        for (Node c : children) {
            if (c instanceof Branch) {              // leak!
                n += ((Branch) c).size();
            } else {
                n += 1;                             // assumes leaf == 1
            }
        }
        return n;
    }
}
```

<details><summary>Diagnosis & fix</summary>

**Bug:** the whole point of Composite is that `Branch` treats children *uniformly* through the interface. This code `instanceof`-checks each child and hard-codes "a leaf counts as 1" — so a future `Leaf` whose `size()` isn't 1, or a third node type, silently miscounts. The polymorphism is bypassed.

**Fix:** call `size()` on the interface and let each child answer for itself.
```java
@Override public int size() {
    int n = 0;
    for (Node c : children) n += c.size();   // polymorphic, no instanceof
    return n;
}
```
**Lesson:** any `instanceof` inside a Composite traversal is the smell that you've re-implemented the type fork you were trying to delete.
</details>

---

## Bug 3 — Adapter that swallows errors

```java
interface Cache { String get(String key); }   // contract: return null on miss, THROW on backend failure

class RedisCacheAdapter implements Cache {
    private final RedisClient redis;
    RedisCacheAdapter(RedisClient redis) { this.redis = redis; }

    @Override public String get(String key) {
        try {
            return redis.fetch(key);
        } catch (Exception e) {
            return null;                       // "be safe"
        }
    }
}
```

<details><summary>Diagnosis & fix</summary>

**Bug:** the adapter collapses *two distinct outcomes* — "key absent" and "Redis is down" — into the same `null`. The contract says a miss is `null` but a backend failure must **throw**, so callers can fall back to the source of truth. As written, a Redis outage looks exactly like a cache miss... except it *isn't* repopulated, so every read silently bypasses the cache and the outage is invisible until the database melts. Swallowing the exception also erases the diagnostics.

**Fix:** distinguish the cases; only catch what genuinely means "miss."
```java
@Override public String get(String key) {
    try {
        return redis.fetch(key);            // returns null for a real miss
    } catch (KeyNotFoundException miss) {
        return null;                        // genuine miss
    }
    // let RedisConnectionException etc. propagate — caller must know
}
```
**Lesson:** an Adapter translates *interfaces*, not *error semantics into silence*. Mapping every failure to a benign value hides outages.
</details>

---

## Bug 4 — Decorator ordering invariant violated

```java
Stream out = new EncryptStream(new GzipStream(rawOut, level), key);
// intent: write plaintext -> compress -> encrypt
```

<details><summary>Diagnosis & fix</summary>

**Bug:** read the wrapping inside-out. `rawOut` is wrapped by `GzipStream` (innermost), then by `EncryptStream` (outermost). Data flows **outermost → innermost on write**, so the byte path is `encrypt → gzip → rawOut`: you *encrypt first, then compress*. Encrypted data is high-entropy and **does not compress** — the gzip layer wastes CPU for ~0% ratio, and depending on the protocol may leak length info. The intended order is compress-then-encrypt.

**Fix:** swap the layers so compression is the *outer* write step (applied to plaintext first).
```java
Stream out = new GzipStream(new EncryptStream(rawOut, key), level);
// write path: gzip(plaintext) -> encrypt -> rawOut  ✔
```
**Lesson:** decorator order is semantically load-bearing and easy to get backwards because wrapping reads inside-out. Encapsulate the chain in a Builder that enforces the legal order (see [tasks.md](tasks.md) Task 6).
</details>

---

## Bug 5 — Flyweight with mutable shared state

```java
final class GlyphFactory {
    private final Map<Character, Glyph> pool = new HashMap<>();
    Glyph get(char c) { return pool.computeIfAbsent(c, Glyph::new); }
}
class Glyph {
    final char c;
    int x, y;                                  // position stored on the shared object
    Glyph(char ch) { this.c = ch; }
    void setPosition(int x, int y) { this.x = x; this.y = y; }
    void draw() { System.out.println(c + " at " + x + "," + y); }
}
```

<details><summary>Diagnosis & fix</summary>

**Bug:** position (`x`, `y`) is **extrinsic** state — it differs per occurrence — but it's stored on the *shared* `Glyph`. Two 'a's in the document reference the *same* `Glyph('a')`, so `setPosition` on the second clobbers the first. Every shared glyph ends up at whatever position was set last. The Flyweight's prime directive — intrinsic state immutable and shared, extrinsic state passed per call — is violated.

**Fix:** make intrinsic state immutable and pass extrinsic state into `draw`.
```java
final class Glyph {
    private final char c;
    Glyph(char c) { this.c = c; }
    void drawAt(int x, int y) { System.out.println(c + " at " + x + "," + y); }
}
// caller supplies position per occurrence:
glyphFactory.get('a').drawAt(10, 20);
glyphFactory.get('a').drawAt(40, 20);   // independent, no clobbering
```
**Lesson:** if a Flyweight has a mutable setter for per-use state, it's not a Flyweight — it's a shared-mutable-state bug.
</details>

---

## Bug 6 — Virtual Proxy with a lazy-init race

```java
class ImageProxy implements Image {
    private final String path;
    private RealImage real;
    ImageProxy(String path) { this.path = path; }
    @Override public void render() {
        if (real == null) {
            real = new RealImage(path);     // expensive decode
        }
        real.render();
    }
}
```

<details><summary>Diagnosis & fix</summary>

**Bug:** under concurrent calls, two threads can both see `real == null`, both construct a `RealImage` (double the expensive decode, possibly double a side effect like opening a file handle), and one assignment is lost. There's also a visibility hazard: without a memory barrier, a thread may see a *partially constructed* `real`. The proxy is correct single-threaded, broken concurrently.

**Fix (initialization-on-demand holder, no locking on the hot path):**
```java
class ImageProxy implements Image {
    private final String path;
    private volatile RealImage real;          // volatile for safe publication
    ImageProxy(String path) { this.path = path; }
    @Override public void render() {
        RealImage r = real;
        if (r == null) {
            synchronized (this) {
                if ((r = real) == null) real = r = new RealImage(path); // double-checked
            }
        }
        r.render();
    }
}
```
Or hand the lazy value to an `AtomicReference` / a `Supplier`-memoizing holder. **Lesson:** lazy proxies are a concurrency concern, not a free optimization.
</details>

---

## Bug 7 — Facade that leaks the subsystem instead of hiding it

```java
public class ReportFacade {
    public QueryEngine getQueryEngine() { return queryEngine; }   // leak
    public Formatter   getFormatter()   { return formatter; }     // leak
    public Exporter    getExporter()    { return exporter; }      // leak
    private final QueryEngine queryEngine = new QueryEngine();
    private final Formatter formatter = new Formatter();
    private final Exporter exporter = new Exporter();
}

// Client still does all the wiring:
var data = facade.getQueryEngine().run(sql);
var doc  = facade.getFormatter().format(data);
facade.getExporter().toPdf(doc, "out.pdf");
```

<details><summary>Diagnosis & fix</summary>

**Bug:** the "facade" exposes getters for every subsystem object, so clients still orchestrate the whole pipeline by hand — and are now *coupled to every subsystem type* plus the facade. This is a Facade in name only; it simplifies nothing and adds a useless layer. The smell it was meant to cure (clients reaching deep into a subsystem) is fully intact.

**Fix:** the facade must own the orchestration and expose a single intent-level method, hiding the collaborators.
```java
public class ReportFacade {
    private final QueryEngine queryEngine = new QueryEngine();
    private final Formatter formatter = new Formatter();
    private final Exporter exporter = new Exporter();

    public void exportPdf(String sql, String outPath) {     // one entry point
        var data = queryEngine.run(sql);
        var doc  = formatter.format(data);
        exporter.toPdf(doc, outPath);
    }
}
// Client: facade.exportPdf(sql, "out.pdf");
```
**Lesson:** a Facade that exposes its subsystem isn't hiding anything. The test: can a client do its job without naming a single subsystem type? If not, it's not a Facade yet.
</details>

---

## Next

- [tasks.md](tasks.md) — Apply the refactorings step by step.
- [optimize.md](optimize.md) — Propose (or reject) structural refactorings.
- Back to [junior.md](junior.md) · [middle.md](middle.md) · [senior.md](senior.md) · [professional.md](professional.md) · [interview.md](interview.md)
