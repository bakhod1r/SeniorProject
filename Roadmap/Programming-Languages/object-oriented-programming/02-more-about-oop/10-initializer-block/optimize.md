# Initializer Block — Optimization

Twelve before/after exercises focused on initialization performance and design.

---

## Optimization 1 — Replace static block with `Map.of`

**Before:**
```java
static final Map<String, Integer> CODES;
static {
    CODES = new HashMap<>();
    CODES.put("OK", 200);
    CODES.put("NF", 404);
    CODES.put("ERR", 500);
}
```

**After:**
```java
static final Map<String, Integer> CODES = Map.of(
    "OK", 200, "NF", 404, "ERR", 500
);
```

Less code, immutable by default, slightly faster init.

---

## Optimization 2 — Lazy holder over eager static init

**Before:**
```java
class Heavy {
    private static final Heavy INSTANCE = new Heavy();
    public static Heavy get() { return INSTANCE; }
}
```

If `Heavy` is loaded but never used, you still pay the cost.

**After:**
```java
class Heavy {
    private Heavy() { }
    private static class Holder {
        static final Heavy INSTANCE = new Heavy();
    }
    public static Heavy get() { return Holder.INSTANCE; }
}
```

`Heavy` loads instantly; `Holder` only loads (and constructs) on first `get()`.

---

## Optimization 3 — Avoid double-brace

**Before:**
```java
new HashMap<String, Integer>() {{
    put("a", 1);
    put("b", 2);
}};
```

**After:**
```java
Map.of("a", 1, "b", 2);
```

Or for a mutable map:
```java
var m = new HashMap<String, Integer>();
m.put("a", 1);
m.put("b", 2);
```

Avoids anonymous class generation and outer-instance pinning.

---

## Optimization 4 — Defer fragile init

**Before:**
```java
class Service {
    static final Connection CONN;
    static {
        try { CONN = DriverManager.getConnection(...); }
        catch (SQLException e) { throw new ExceptionInInitializerError(e); }
    }
}
```

**After:**
```java
class Service {
    private static volatile Connection conn;
    public static Connection conn() {
        var c = conn;
        if (c == null) c = init();
        return c;
    }
    private static synchronized Connection init() {
        if (conn == null) {
            try { conn = DriverManager.getConnection(...); }
            catch (SQLException e) { throw new RuntimeException(e); }
        }
        return conn;
    }
}
```

Defer DB connection until actually needed. Failure mode is clearer.

---

## Optimization 5 — Constant variable to skip init

**Before:**
```java
class Config {
    static final Integer LIMIT = 100;
    static { /* heavy work */ }
}

System.out.println(Config.LIMIT);   // triggers init!
```

**After:**
```java
class Config {
    static final int LIMIT = 100;     // constant variable: not boxed
    static { /* heavy work */ }
}

System.out.println(Config.LIMIT);   // doesn't trigger init
```

Reading a primitive constant variable doesn't require class init.

---

## Optimization 6 — `Class.forName` without init

**Before:**
```java
Class.forName("com.example.X");   // triggers <clinit>
```

If you're just inspecting the class:

**After:**
```java
Class.forName("com.example.X", false, getClassLoader());   // no init
```

Useful for tools, debuggers, and frameworks scanning class metadata.

---

## Optimization 7 — Inline simple field inits

If a field has a simple initializer like `= new ArrayList<>()`, no need for an instance block:

**Before:**
```java
List<String> items;
{ items = new ArrayList<>(); }
```

**After:**
```java
List<String> items = new ArrayList<>();
```

Cleaner; no behavior change.

---

## Optimization 8 — Static block + JIT

The JIT compiles `<clinit>` like any method. Heavy `<clinit>` work runs interpreted (since it runs once). For computationally heavy init, prefer a method that gets JIT'd over many calls.

---

## Optimization 9 — JFR class-init profiling

```bash
java -XX:StartFlightRecording=duration=60s,filename=app.jfr -jar app.jar
jfr print --events jdk.ClassLoad,jdk.ClassInitialization app.jfr
```

Shows which classes load and how long their `<clinit>` takes. Find slow init and optimize.

---

## Optimization 10 — `-Xlog:class+init=info`

Log class init events:
```bash
java -Xlog:class+init=info MyApp
```

Output shows the order of init and timing. Detect slow init or unexpected eager loads.

---

## Optimization 11 — Avoid initializer cycles

```java
class A { static { B.foo(); } static int a = 1; }
class B { static { A.foo(); } static int b = 2; }
```

If two threads concurrently initialize, deadlock. Even single-threaded, ordering surprises occur.

**Fix:** break the cycle. Refactor so static state is acyclic.

---

## Optimization 12 — GraalVM native-image and `<clinit>`

For native-image builds, `<clinit>` runs at *build time* by default. The static state is baked into the image. This can speed up startup but causes issues if static init has side effects (file IO, network).

Configure with `--initialize-at-run-time=com.example.X` for classes that need runtime init. Tune the boundary based on your app's needs.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-Xlog:class+init=info`                       | Class init logging                     |
| `-Xlog:class+load=info`                       | Class load logging                     |
| JFR `jdk.ClassInitialization`                  | Init timing                            |
| `-XX:+TraceClassResolution`                    | Class resolution events                |
| GraalVM `--trace-class-initialization`         | Build-time init analysis                |

---

## When to apply

- Slow startup (profile with JFR)
- Class init failures in production (replace with lazy init)
- Tests breaking due to init order (decouple)
- Native-image build issues (mark for runtime init)

## When not to

- Simple, fast static blocks
- Small classes with short `<clinit>`
- Code clarity benefits more than the optimization

---

**Memorize this**: prefer modern factories (`Map.of`, `List.of`) over static blocks. Use lazy holder for expensive eager init. Constant variables don't trigger class init. Profile with JFR if startup is slow. Avoid circular static dependencies. GraalVM native-image moves `<clinit>` to build time — handle accordingly.
