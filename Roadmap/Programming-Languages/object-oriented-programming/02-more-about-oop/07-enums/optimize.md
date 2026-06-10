# Enums — Optimization

Twelve before/after exercises for enum performance.

---

## Optimization 1 — EnumSet over HashSet

**Before:**
```java
Set<Day> weekend = new HashSet<>();
weekend.add(Day.SAT); weekend.add(Day.SUN);
```

**After:**
```java
EnumSet<Day> weekend = EnumSet.of(Day.SAT, Day.SUN);
```

**Why:** EnumSet uses bitset internally; `contains` is one bitwise op.

---

## Optimization 2 — EnumMap over HashMap for enum keys

**Before:**
```java
Map<Day, Schedule> schedules = new HashMap<>();
```

**After:**
```java
EnumMap<Day, Schedule> schedules = new EnumMap<>(Day.class);
```

**Why:** Array-backed; O(1) without hashing.

---

## Optimization 3 — Use `==` over `equals`

**Before:**
```java
if (direction.equals(Direction.NORTH)) { ... }
```

**After:**
```java
if (direction == Direction.NORTH) { ... }
```

**Why:** `==` is one pointer compare; `equals` adds a virtual dispatch (though `Enum.equals` is `final` and inlined). `==` also handles null safely.

---

## Optimization 4 — Strategy enum vs switch

**Before:**
```java
public int compute(Op op, int a, int b) {
    return switch (op) {
        case PLUS -> a + b;
        case MINUS -> a - b;
        case TIMES -> a * b;
    };
}
```

**After:**
```java
public enum Op {
    PLUS  { public int apply(int a, int b) { return a + b; } },
    MINUS { public int apply(int a, int b) { return a - b; } },
    TIMES { public int apply(int a, int b) { return a * b; } };
    public abstract int apply(int a, int b);
}

public int compute(Op op, int a, int b) {
    return op.apply(a, b);
}
```

Both are similar performance; choose for clarity. The strategy enum keeps logic with each constant.

---

## Optimization 5 — Cache values()

**Before:**
```java
for (var d : Day.values()) { ... }   // each call clones the array
```

**After (when called in hot loop):**
```java
private static final Day[] DAYS = Day.values();
for (var d : DAYS) { ... }
```

**Why:** `values()` clones the internal `$VALUES` array each call. Caching avoids the clone.

---

## Optimization 6 — Avoid heavy work in enum init

**Before:**
```java
public enum Service {
    INSTANCE;
    private final Connection conn = openConnection();   // expensive at class load
}
```

**After:**
```java
public enum Service {
    INSTANCE;
    private volatile Connection conn;
    public Connection conn() {
        if (conn == null) synchronized (this) { if (conn == null) conn = openConnection(); }
        return conn;
    }
}
```

**Why:** lazy init defers the cost until needed; class loading stays fast.

---

## Optimization 7 — Per-constant data via fields

**Before:**
```java
public enum HttpStatus {
    OK, NOT_FOUND, ERROR;
    public int code() {
        return switch (this) {
            case OK -> 200;
            case NOT_FOUND -> 404;
            case ERROR -> 500;
        };
    }
}
```

**After:**
```java
public enum HttpStatus {
    OK(200), NOT_FOUND(404), ERROR(500);
    private final int code;
    HttpStatus(int c) { this.code = c; }
    public int code() { return code; }
}
```

**Why:** field access is faster than a switch each call.

---

## Optimization 8 — `EnumSet.copyOf` for fast cloning

**Before:**
```java
EnumSet<Day> copy = new HashSet<>(original);
```

**After:**
```java
EnumSet<Day> copy = EnumSet.copyOf(original);
```

**Why:** copies the bitset directly; trivial and very fast.

---

## Optimization 9 — Lookup by name with cache

**Before (on hot path):**
```java
HttpMethod m = HttpMethod.valueOf(input);
```

`valueOf` does a string lookup each call. Fine for cold paths.

**After (for high-throughput parsing):**
```java
private static final Map<String, HttpMethod> NAME_TO_METHOD = Arrays.stream(HttpMethod.values())
    .collect(Collectors.toMap(Enum::name, m -> m));
HttpMethod m = NAME_TO_METHOD.get(input);
```

Same cost as `valueOf`, but you can use a different lookup key (lowercase, alias, etc.).

---

## Optimization 10 — Replace boolean param with enum

**Before:**
```java
public void send(boolean retry) { ... }
send(true);   // unclear what `true` means
```

**After:**
```java
public enum RetryMode { WITH_RETRY, NO_RETRY }
public void send(RetryMode mode) { ... }
send(RetryMode.WITH_RETRY);   // clear at call site
```

**Why:** more readable. No measurable runtime difference.

---

## Optimization 11 — Use `EnumSet.range`

**Before:**
```java
EnumSet<Day> weekdays = EnumSet.of(MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY);
```

**After:**
```java
EnumSet<Day> weekdays = EnumSet.range(Day.MONDAY, Day.FRIDAY);
```

**Why:** more concise; same performance.

---

## Optimization 12 — Pattern matching for closed enum

**Before:**
```java
String describe(Status s) {
    if (s == Status.ACTIVE) return "active";
    if (s == Status.INACTIVE) return "inactive";
    if (s == Status.PENDING) return "pending";
    return "unknown";
}
```

**After:**
```java
String describe(Status s) {
    return switch (s) {
        case ACTIVE -> "active";
        case INACTIVE -> "inactive";
        case PENDING -> "pending";
    };   // exhaustive, fast
}
```

**Why:** compiler verifies exhaustiveness; tableswitch is faster than chained if/else.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintInlining`                          | Inlining decisions                     |
| `jol-cli`                                     | EnumSet/EnumMap memory layout          |
| `jmh`                                         | Compare EnumSet vs HashSet              |
| `async-profiler`                              | CPU profile of enum-heavy code         |

---

**Memorize this**: enums are already cheap; further optimization usually means using the right collection (EnumSet/EnumMap), avoiding heavy class init, or caching `values()` arrays. Pattern matching switch and per-constant fields make code clearer without runtime cost. Don't over-engineer; profile first.
