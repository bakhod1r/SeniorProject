# Object Lifecycle — Find the Bug

Twelve buggy snippets. Each compiles. Each behaves wrongly in a way that's specifically a lifecycle concern (initialization order, leaking `this`, escape, GC). Find the bug, explain *why* it bites, and write a fix.

---

## Bug 1 — Final field looks correct but reads zero

```java
class Account {
    final long openingBalance;
    final long initialFee = openingBalance / 100;
    Account(long opening) {
        this.openingBalance = opening;
    }
}

new Account(10_000).initialFee;
```

**Symptom:** `initialFee` is always 0 even though `openingBalance` is 10,000.

**Why?** Field initializers run **in source declaration order**, before the constructor body. `initialFee = openingBalance / 100` runs while `openingBalance` is still 0 (its default). The constructor's `this.openingBalance = opening` runs later — too late to influence `initialFee`.

**Fix:** compute `initialFee` in the constructor body, after setting `openingBalance`:

```java
class Account {
    final long openingBalance;
    final long initialFee;
    Account(long opening) {
        this.openingBalance = opening;
        this.initialFee = opening / 100;
    }
}
```

---

## Bug 2 — Listener registered too early

```java
public class TempSensor {
    public TempSensor(EventBus bus) {
        bus.addListener(this);          // (!)
        this.calibration = loadCalibrationFromDisk();
    }
    private final double calibration;
    public void onTick() {
        process(currentReading() * calibration);
    }
}
```

**Symptom:** sometimes `onTick()` runs with `calibration = 0.0`.

**Why?** `bus.addListener(this)` publishes a partially constructed `this` to the event bus. If the bus dispatches an event from another thread before the constructor finishes, `onTick()` reads `calibration` as its default (0.0).

**Fix:** static factory that registers *after* construction:

```java
public static TempSensor create(EventBus bus) {
    var sensor = new TempSensor();   // private no-arg ctor that loads calibration
    bus.addListener(sensor);
    return sensor;
}
```

---

## Bug 3 — Singleton seen half-built

```java
public class Config {
    private static Config instance;          // not volatile
    private final Map<String, String> data = loadFromDisk();

    public static Config get() {
        if (instance == null) {
            synchronized (Config.class) {
                if (instance == null) instance = new Config();
            }
        }
        return instance;
    }
}
```

**Symptom:** under contention, sometimes `Config.get().data` is `null`.

**Why?** The double-checked locking is broken without `volatile`. A thread can observe `instance != null` but read `instance.data` as null because the writes inside the constructor haven't been published.

**Fix:** make `instance` volatile, or use the lazy holder idiom:

```java
public class Config {
    private Config() { /* ... */ }
    private static class Holder { static final Config I = new Config(); }
    public static Config get() { return Holder.I; }
}
```

---

## Bug 4 — Calling overridable method from constructor

```java
class Reader {
    Reader() {
        load();
    }
    protected void load() { /* base impl */ }
}

class CSVReader extends Reader {
    private final String separator = ",";
    @Override
    protected void load() {
        System.out.println("loading with sep=" + separator);
    }
}

new CSVReader();
```

**Symptom:** prints `loading with sep=null`.

**Why?** Constructor of `Reader` runs first. Its call to `load()` dispatches polymorphically to `CSVReader.load()`. But `CSVReader`'s field initializers (including `separator = ","`) haven't run yet — they run after `super()` returns. So `separator` is still `null`.

**Fix:** never call overridable methods from constructors. Use a static factory or a two-phase init:

```java
public static CSVReader create() {
    var r = new CSVReader();
    r.load();
    return r;
}
```

…and make `Reader.Reader()` not call `load()`.

---

## Bug 5 — Resource leak when constructor throws

```java
class FileBackedCache {
    private final FileChannel channel;
    private final ByteBuffer buffer;

    FileBackedCache(Path path, int size) throws IOException {
        this.channel = FileChannel.open(path, READ, WRITE, CREATE);
        if (size <= 0) throw new IllegalArgumentException("size must be > 0");
        this.buffer = ByteBuffer.allocateDirect(size);
    }
}
```

**Symptom:** if `size <= 0`, the exception is thrown but the file stays open; eventually the process hits "too many open files."

**Why?** The constructor opened `channel` successfully, then threw. The half-built object is unreachable, but the open file handle isn't released until the GC runs the channel's cleaner — which may be much later.

**Fix:** validate first, or use a try/catch:

```java
FileBackedCache(Path path, int size) throws IOException {
    if (size <= 0) throw new IllegalArgumentException("size must be > 0");
    var ch = FileChannel.open(path, READ, WRITE, CREATE);
    try {
        this.buffer = ByteBuffer.allocateDirect(size);
    } catch (Throwable t) {
        ch.close();
        throw t;
    }
    this.channel = ch;
}
```

---

## Bug 6 — Static field leaks the entire app

```java
public class RequestLog {
    private static final List<Request> ALL = new ArrayList<>();
    public static void log(Request r) { ALL.add(r); }
    public static List<Request> all() { return ALL; }
}
```

**Symptom:** under sustained traffic, OOM after a few hours.

**Why?** `ALL` is a static field — its lifetime is the lifetime of the class loader (effectively forever). Every `Request` ever logged is kept alive. Linear memory growth.

**Fix:** bound the list (ring buffer, time-based eviction) or write logs to disk + drop the in-memory copy:

```java
private static final Deque<Request> ALL = new ArrayDeque<>();
private static final int MAX = 10_000;
public static synchronized void log(Request r) {
    ALL.add(r);
    while (ALL.size() > MAX) ALL.pollFirst();
}
```

---

## Bug 7 — Inner class pins the outer

```java
class Outer {
    private final byte[] payload = new byte[10_000_000];
    public Iterator<Integer> iterator() {
        return new Iterator<>() {
            int i = 0;
            @Override public boolean hasNext() { return i < 100; }
            @Override public Integer next() { return i++; }
        };
    }
}
```

**Symptom:** an iterator stored long-term keeps the entire 10 MB payload alive even though the iterator never reads it.

**Why?** Anonymous (non-static) inner classes hold an implicit `this$0` reference to the enclosing `Outer`. The iterator transitively holds `payload`.

**Fix:** make the iterator a static class so it doesn't capture `Outer`:

```java
public Iterator<Integer> iterator() {
    return new IntIterator(0, 100);
}
private static class IntIterator implements Iterator<Integer> { /* ... */ }
```

---

## Bug 8 — `finalize` swallows resurrection

```java
class Critical {
    static Critical lastSeen;
    @Override
    protected void finalize() {
        lastSeen = this;        // resurrects!
    }
}
```

**Symptom:** `Critical` instances appear to leak; some methods see them long after they "should" be dead.

**Why?** `finalize()` can re-link `this` into a static field, making it strongly reachable again. This is one of the reasons `finalize` is deprecated — finalizers can completely undo GC's work.

**Fix:** delete the `finalize` method. If you need cleanup, use `Cleaner` (and don't capture `this`).

---

## Bug 9 — `super()` runs before the field is set

```java
class Logger {
    private final String prefix;
    Logger() {
        this.prefix = "[BASE] ";
        log("Logger created");
    }
    void log(String s) { System.out.println(prefix + s); }
}

class TimedLogger extends Logger {
    private final Instant start = Instant.now();
    @Override
    void log(String s) { System.out.println(start + " " + s); }
}

new TimedLogger();
```

**Symptom:** `NullPointerException` printed during construction.

**Why?** Same trap as Bug 4. `Logger.<init>` calls `log("...")`. Polymorphism dispatches to `TimedLogger.log`. But `TimedLogger.start` hasn't been initialized yet (field initializers run after `super()` returns). `start` is null. Concatenation NPEs.

**Fix:** don't call overridable methods from constructors. Restructure so `Logger` doesn't log during construction.

---

## Bug 10 — Cleaner with a strong reference to the outer

```java
public final class Buffer {
    private static final Cleaner CLEANER = Cleaner.create();
    private final long handle;
    private final Cleaner.Cleanable cleanable;

    public Buffer() {
        this.handle = native_alloc();
        this.cleanable = CLEANER.register(this, () -> {
            native_free(this.handle);     // (!)
        });
    }
}
```

**Symptom:** `Buffer` instances are never collected; native memory leaks until OOM-killed.

**Why?** The cleanup lambda captures `this` (it references `this.handle`). The Cleaner holds a strong reference to the lambda. The lambda holds a strong reference to the buffer. Cyclic strong reachability — the buffer is never phantom-reachable.

**Fix:** capture only the data needed by the cleanup, not `this`:

```java
public Buffer() {
    long h = native_alloc();
    this.handle = h;
    this.cleanable = CLEANER.register(this, () -> native_free(h));
}
```

…or use a static nested class:

```java
private static class State implements Runnable {
    final long handle;
    State(long h) { this.handle = h; }
    public void run() { native_free(handle); }
}
```

---

## Bug 11 — `static final` Map seeded in static block — under load

```java
public final class Currency {
    public static final Map<String, Currency> BY_CODE = new HashMap<>();
    static {
        BY_CODE.put("USD", new Currency("USD", "$"));
        BY_CODE.put("EUR", new Currency("EUR", "€"));
        // ... 200 more
    }
    private final String code;
    private final String symbol;
    private Currency(String c, String s) { code = c; symbol = s; }
}
```

**Symptom:** under high concurrency, occasional `ConcurrentModificationException` thrown by Currency users.

**Why?** Two issues:
1. `BY_CODE` is mutable (`HashMap`), so any user code that holds it could mutate it concurrently.
2. The class initialization is fine for this static block, but exposing a mutable Map is a leaking abstraction.

**Fix:** use `Map.copyOf` or wrap in `Map.unmodifiableMap`, and make the field type `Map`:

```java
public static final Map<String, Currency> BY_CODE;
static {
    Map<String, Currency> m = new HashMap<>();
    m.put("USD", new Currency("USD", "$"));
    // ...
    BY_CODE = Map.copyOf(m);
}
```

---

## Bug 12 — Lazy initialization that runs constructor twice

```java
public class Counter {
    private static Counter INSTANCE;
    public static Counter getInstance() {
        if (INSTANCE == null) {
            INSTANCE = new Counter();
        }
        return INSTANCE;
    }
    private final long startTime = System.nanoTime();
    private Counter() {
        register(this);
    }
}
```

**Symptom:** under racing access, two `Counter` instances exist briefly. `register` is called twice.

**Why?** Without synchronization, two threads can both pass the `INSTANCE == null` check and each call `new Counter()`. The second one wins, but the first one was already registered — resource leak / duplicate registration.

**Fix:** lazy holder idiom (preferred), or `synchronized` access, or `enum`-based singleton:

```java
public class Counter {
    private Counter() { register(this); }
    private static class H { static final Counter I = new Counter(); }
    public static Counter getInstance() { return H.I; }
}
```

---

## Pattern recap

| Bug | Family                           | Cure                              |
|-----|----------------------------------|-----------------------------------|
| 1   | Field-init ordering              | Move computation to ctor body     |
| 2   | Leak `this` to listener          | Static factory; register after `new` |
| 3   | Broken DCL                       | `volatile` or holder idiom        |
| 4   | Overridable from ctor            | Forbid; use factory               |
| 5   | Ctor throws after acquiring res. | Validate first or try/catch       |
| 6   | Static collection unbounded      | Bound it                          |
| 7   | Inner class pins outer           | Make nested class `static`        |
| 8   | `finalize` resurrection          | Don't override; use `Cleaner`     |
| 9   | Variant of #4                    | Same fix                          |
| 10  | Cleaner captures `this`          | Capture data, not `this`          |
| 11  | Mutable static collection        | `Map.copyOf` / unmodifiable       |
| 12  | Race in lazy init                | Holder idiom                      |

These twelve cover ~95% of lifecycle bugs you'll meet in production Java. Memorize the *shape* of each, and you'll spot them at code-review time.
