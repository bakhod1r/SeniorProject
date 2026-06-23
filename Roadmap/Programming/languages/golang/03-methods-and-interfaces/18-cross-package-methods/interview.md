# Cross-Package Methods — Interview Questions

## Table of Contents
1. [Junior-Level Questions](#junior-level-questions)
2. [Middle-Level Questions](#middle-level-questions)
3. [Senior-Level Questions](#senior-level-questions)
4. [Tricky / Curveball Questions](#tricky-curveball-questions)
5. [Coding Tasks](#coding-tasks)
6. [System Design Style](#system-design-style)
7. [What Interviewers Look For](#what-interviewers-look-for)

---

## Junior-Level Questions

### Q1: Can you add a method to `time.Time` from your own package?

**Answer:** No. The Go specification requires the receiver base type to be defined in the same package as the method. `time.Time` is defined in package `time`; only that package can declare methods on it.

```go
// In your package — compile error:
// func (t time.Time) FormatRFC() string { return t.Format(time.RFC3339) }
```

### Q2: What does this rule say in plain English?

**Answer:** Methods belong to types. Types belong to packages. You can only attach a method to a type that lives in your current package.

### Q3: Why does the rule exist?

**Answer:** To prevent two unrelated packages from adding conflicting methods to the same type. If method extension were free, `time.Time`'s method set would depend on which packages happened to be imported — and method lookup could become ambiguous.

### Q4: What is a defined type?

**Answer:** A type created with `type Name UnderlyingType`. It has a fresh identity and its own (initially empty) method set.

```go
type MyTime time.Time   // defined type — methods can be added here
```

### Q5: What is a type alias?

**Answer:** A type created with `type Name = ExistingType`. It is the **same type** as the right-hand side, just with another spelling.

```go
type X = time.Time      // X and time.Time are identical
```

### Q6: Can you add a method to a type alias?

**Answer:** Only if the aliased type is defined in your package. Aliasing `time.Time` does not move it into your package, so methods on the alias are still illegal.

### Q7: What is the simplest workaround?

**Answer:** A free function. No type, no method-set surgery.

```go
func FormatRFC(t time.Time) string { return t.Format(time.RFC3339) }
```

### Q8: Show a wrapper type for `time.Time`.

**Answer:**

```go
type MyTime time.Time

func (m MyTime) FormatRFC() string {
    return time.Time(m).Format(time.RFC3339)
}
```

### Q9: How do you convert between `MyTime` and `time.Time`?

**Answer:** Explicit conversion in both directions:

```go
t := time.Now()
mt := MyTime(t)         // time.Time -> MyTime
back := time.Time(mt)   // MyTime    -> time.Time
```

### Q10: Does `MyTime` automatically have `Format`, `UTC`, `String` from `time.Time`?

**Answer:** No. A defined type starts with an empty method set. Only methods you declare on `MyTime` are accessible.

---

## Middle-Level Questions

### Q11: What are the three valid workarounds?

**Answer:**

1. **Defined wrapper type** — `type MyTime time.Time` plus methods on `MyTime`.
2. **Free function** — `func F(t time.Time) ...`.
3. **Struct embedding** — `type Event struct { time.Time; ... }` plus new methods.

### Q12: When would you choose embedding over a wrapper?

**Answer:** When you want to keep the original type's full method set automatically. Embedding promotes every method of the embedded type. A wrapper starts empty and you must re-declare or forward each method.

```go
type Event struct{ time.Time }
e := Event{time.Now()}
e.Format(time.RFC3339)   // works — Format is promoted
```

### Q13: Why is `type X = time.Time` not a workaround?

**Answer:** Because an alias does not create a new type identity. Methods declared on `X` would be methods on `time.Time` itself — and the receiver-base-type-must-be-in-this-package rule rejects that.

### Q14: What about generic type aliases (Go 1.24+)?

**Answer:** Same story — they are still aliases. They share identity with the aliased type, so methods cannot be declared on them.

```go
type Stack[T any] = []T            // alias — no methods allowed
type Stack[T any] []T              // defined type — methods allowed
```

### Q15: Why does `sql.NullString` exist?

**Answer:** To represent a nullable string column. Since `string` is built-in (and `bool` cannot be added to it), the standard library defines a struct that pairs a `string` with a `Valid` flag and attaches `Scan`/`Value` to the struct:

```go
type NullString struct {
    String string
    Valid  bool
}
```

### Q16: How does `sql.NullTime` differ from embedding `time.Time`?

**Answer:** `sql.NullTime` uses a regular field, not embedding. Embedding `time.Time` would promote `Format`, `String`, `MarshalJSON`, etc., bloating the public API and making JSON output ambiguous. A plain field keeps the wrapper minimal.

### Q17: After wrapping `time.Time` with `type CycleDate time.Time`, why doesn't `json.Marshal(CycleDate{...})` produce the same string as `json.Marshal(time.Time{...})`?

**Answer:** Because `MarshalJSON` is declared on `time.Time`, not on `CycleDate`. The wrapper does not inherit the method. You must forward it:

```go
func (c CycleDate) MarshalJSON() ([]byte, error) {
    return time.Time(c).MarshalJSON()
}
```

### Q18: Does embedding `time.Time` automatically give you `MarshalJSON`?

**Answer:** Yes — promoted methods include interface implementations. The embedding type satisfies `json.Marshaler` automatically. But if your struct adds extra fields, the promoted marshaler will ignore them; you should write a custom one.

### Q19: What is the runtime cost of converting `MyTime(t)` and `time.Time(mt)`?

**Answer:** Zero. The conversion is purely a compile-time identity transform — no copy, no allocation. Underlying memory layout is identical.

### Q20: Can you declare a method on `*time.Time` from your package?

**Answer:** No. The receiver base type is `time.Time`, defined in package `time`. The pointer indirection does not change which package owns the base type.

---

## Senior-Level Questions

### Q21: Imagine the same-package rule did not exist. What would break?

**Answer:**

- **Method conflicts:** Two libraries could each add `M()` to `time.Time` with incompatible behavior. Importers would not know which to expect.
- **Hidden coupling:** A package's behavior would depend on transitive imports.
- **Unstable method sets:** Adding a dependency could change which interfaces a value satisfies.
- **Refactoring danger:** Removing a method from a foreign type would silently change behavior elsewhere.

The rule guarantees that the method set of a type is fully determined by the type's defining package.

### Q22: When does embedding violate encapsulation?

**Answer:** Embedding promotes every public method of the embedded type. If the outer type wants a small, focused public API, embedding leaks methods into it. For example:

```go
type Order struct{ time.Time }
// o.Format, o.UTC, o.Add, o.Sub — all part of Order's public API now.
```

A named field (`CreatedAt time.Time`) gives explicit control.

### Q23: A teammate uses `type ID = string` to give string IDs a domain name. What is the trade-off?

**Answer:**

- Pro: No conversion needed. `ID` and `string` are interchangeable.
- Con: No methods possible. No type-checking distinction between `ID` and any other string.

If you want methods or compile-time distinction, use `type ID string` (a defined type). If you only want a documentation-style name, use the alias.

### Q24: How do you make a wrapper type satisfy `sql.Scanner` and `driver.Valuer`?

**Answer:** Declare both methods explicitly on the wrapper:

```go
type CycleDate time.Time

func (c *CycleDate) Scan(value any) error {
    var t sql.NullTime
    if err := t.Scan(value); err != nil { return err }
    if !t.Valid { *c = CycleDate{}; return nil }
    *c = CycleDate(t.Time)
    return nil
}

func (c CycleDate) Value() (driver.Value, error) {
    if time.Time(c).IsZero() { return nil, nil }
    return time.Time(c), nil
}
```

### Q25: A wrapper type is exported in a public module. What's the API impact?

**Answer:**

- Callers must convert to/from the underlying type (`pkg.MyTime(t)`).
- Adding or removing methods on the wrapper is a public-API change subject to semver.
- Marshaling format becomes part of the contract — changing it is breaking.
- If consumers prefer working directly with `time.Time`, the wrapper friction can hurt adoption. Many libraries restrict wrappers to internal packages.

### Q26: What happens if both the embedded type and the outer type declare `String()`?

**Answer:** The outer wins at the outer-type call site (shallower depth in selector lookup). Callers can still reach the inner one explicitly:

```go
type Event struct{ time.Time }
func (e Event) String() string { return "Event" }

e.String()       // "Event"
e.Time.String()  // RFC3339-ish — original time.Time.String
```

### Q27: When is a free function strictly better than a wrapper?

**Answer:** When there is no need for interface satisfaction, no need for the call-site form `value.M()`, and no extra state. Free functions are smaller, do not require conversion, and do not increase the type surface.

### Q28: Can you declare methods on `[]string` directly?

**Answer:** No — `[]string` is an unnamed type. The receiver base type must be **defined**:

```go
type StringList []string
func (s StringList) Add(x string) StringList { return append(s, x) }
```

### Q29: How would you decorate a `*sql.DB` with logging while keeping every other method intact?

**Answer:** Embed `*sql.DB` in a wrapper struct. Override only `Query`:

```go
type loggingDB struct {
    *sql.DB
    log *slog.Logger
}
func (l *loggingDB) Query(q string, args ...any) (*sql.Rows, error) {
    l.log.Info("sql", "q", q)
    return l.DB.Query(q, args...)
}
```

`Exec`, `Begin`, `Prepare`, etc. are promoted from `*sql.DB` automatically.

### Q30: What is the relationship between method declarations and import cycles?

**Answer:** Method declarations themselves cannot create import cycles, because methods always live with their receiver type. But forwarding patterns where package A's wrapper calls into package B's free function and B's free function calls A's wrapper can introduce cycles. Keep wrappers in low-level packages and free functions in higher-level utility packages.

---

## Tricky / Curveball Questions

### Q31: What does this code do?

```go
type MyTime = time.Time
func (m MyTime) Tag() string { return "x" }
```

- a) Compiles, adds `Tag` to all `time.Time` values
- b) Compile error
- c) Compiles, adds `Tag` only to `MyTime` values
- d) Compiles, but `Tag` is unreachable

**Answer: b — Compile error.**

`MyTime` is a type alias, identical to `time.Time`. The compiler reports "cannot define new methods on non-local type time.Time".

### Q32: What does this code print?

```go
type CycleDate time.Time
cd := CycleDate(time.Now())
fmt.Println(cd.Format(time.RFC3339))
```

- a) An RFC3339 timestamp
- b) Compile error
- c) An empty string
- d) `<nil>`

**Answer: b — Compile error.**

`CycleDate` has no `Format` method. Only methods declared in this package on `CycleDate` exist on it.

### Q33: What does this code print?

```go
type Event struct{ time.Time }
e := Event{time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)}
fmt.Println(e.Format(time.RFC3339))
```

- a) Compile error
- b) `2025-01-01T00:00:00Z`
- c) An empty string
- d) `<nil>`

**Answer: b — `2025-01-01T00:00:00Z`.**

`Format` is promoted from the embedded `time.Time` field.

### Q34: Does this satisfy `json.Marshaler`?

```go
type CycleDate time.Time
var _ json.Marshaler = CycleDate{}
```

- a) Yes
- b) No, compile error

**Answer: b — Compile error.**

`time.Time` has `MarshalJSON`, but `CycleDate` does not inherit it. The wrapper must declare or forward the method explicitly.

### Q35: Does this satisfy `json.Marshaler`?

```go
type Event struct{ time.Time }
var _ json.Marshaler = Event{}
```

- a) Yes
- b) No

**Answer: a — Yes.**

The promoted `time.Time.MarshalJSON` puts `Event` into the satisfying set.

### Q36: Which of the following compile?

```go
type T time.Time             // 1
type T = time.Time           // 2
type T *time.Time            // 3
type T[X any] = []X          // 4 (Go 1.24+)
```

then attempting `func (t T) M() {}` (or the parametric equivalent on 4) for each:

- a) Only 1
- b) 1 and 3
- c) 1, 2, 4
- d) 1 and 4

**Answer: a — Only 1.**

- 1: defined type — OK.
- 2: alias — illegal.
- 3: receiver base type cannot be a pointer — illegal.
- 4: alias (generic) — illegal.

### Q37: What does this code print?

```go
type A time.Time
type B A
b := B(A(time.Now()))
fmt.Println(b.Format(time.RFC3339))
```

- a) Compile error
- b) RFC3339 timestamp
- c) `<nil>`

**Answer: a — Compile error.**

`B`'s method set is independent of `A`'s, which is independent of `time.Time`'s. Three nested defined types, three empty method sets.

### Q38: What does this print?

```go
type Event struct{ time.Time }
func (e Event) String() string { return "EVENT" }

e := Event{time.Now()}
fmt.Println(e)
```

- a) `EVENT`
- b) An RFC3339 timestamp
- c) Compile error

**Answer: a — `EVENT`.**

The outer `Event.String()` shadows the promoted `time.Time.String()`.

### Q39: Why doesn't this compile?

```go
package mypkg
type StringSet = map[string]struct{}
func (s StringSet) Add(k string) { s[k] = struct{}{} }
```

**Answer:** `StringSet` is an alias for the unnamed type `map[string]struct{}`. Methods can only be declared on **defined** types, not aliases of unnamed types.

Fix:

```go
type StringSet map[string]struct{}      // defined type
func (s StringSet) Add(k string) { s[k] = struct{}{} }   // legal
```

### Q40: What is the public-API impact of changing `type MyTime time.Time` from a wrapper to `type MyTime = time.Time`?

**Answer:** Breaking.

- All declared methods on `MyTime` disappear.
- All conversions `MyTime(t)` and `time.Time(mt)` become identity (still legal but no longer needed).
- Code that branches on `MyTime` vs `time.Time` no longer type-checks.
- Interface implementations declared on `MyTime` are gone.

Bump the major version.

---

## Coding Tasks

### Task 1: Wrap `time.Duration` with custom JSON

```go
// Implement Duration with MarshalJSON / UnmarshalJSON
// "2h30m" instead of nanoseconds.
```

**Solution:**

```go
type Duration time.Duration

func (d Duration) MarshalJSON() ([]byte, error) {
    return json.Marshal(time.Duration(d).String())
}

func (d *Duration) UnmarshalJSON(b []byte) error {
    var s string
    if err := json.Unmarshal(b, &s); err != nil { return err }
    parsed, err := time.ParseDuration(s)
    if err != nil { return err }
    *d = Duration(parsed)
    return nil
}
```

### Task 2: Decorate `*sql.DB` with logging

```go
// Wrap *sql.DB so that Query is logged.
// Other methods must work unchanged.
```

**Solution:**

```go
type loggingDB struct {
    *sql.DB
    log *slog.Logger
}

func (l *loggingDB) Query(q string, args ...any) (*sql.Rows, error) {
    l.log.Info("sql.query", "q", q)
    return l.DB.Query(q, args...)
}

// Exec, Begin, Prepare, Ping — all promoted from *sql.DB.
```

### Task 3: GeoIP wrapper with extra field

```go
// Wrap net.IP with a Country string.
// Print "Country@IP" via String().
```

**Solution:**

```go
type GeoIP struct {
    net.IP
    Country string
}

func (g GeoIP) String() string {
    return g.Country + "@" + g.IP.String()
}
```

### Task 4: Free-function utilities for `time.Time`

```go
// Implement: StartOfDay, EndOfDay, DaysBetween — without wrapping.
```

**Solution:**

```go
func StartOfDay(t time.Time) time.Time { return t.Truncate(24 * time.Hour) }
func EndOfDay(t time.Time) time.Time {
    return StartOfDay(t).Add(24*time.Hour - time.Nanosecond)
}
func DaysBetween(a, b time.Time) int {
    return int(b.Sub(a) / (24 * time.Hour))
}
```

### Task 5: Sentinel interface assertions for a wrapper

```go
// Add compile-time guarantees that CycleDate implements:
//   json.Marshaler, json.Unmarshaler, sql.Scanner, driver.Valuer
```

**Solution:**

```go
var (
    _ json.Marshaler   = CycleDate{}
    _ json.Unmarshaler = (*CycleDate)(nil)
    _ sql.Scanner      = (*CycleDate)(nil)
    _ driver.Valuer    = CycleDate{}
)
```

### Task 6: Round-trip JSON test for a wrapper

```go
// Test that Marshal/Unmarshal of CycleDate preserves data.
```

**Solution:**

```go
func TestCycleDateRoundTrip(t *testing.T) {
    in := CycleDate(time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC))
    b, err := json.Marshal(in)
    if err != nil { t.Fatal(err) }
    var out CycleDate
    if err := json.Unmarshal(b, &out); err != nil { t.Fatal(err) }
    if !time.Time(in).Equal(time.Time(out)) {
        t.Fatalf("round trip lost data: %v vs %v", in, out)
    }
}
```

---

## System Design Style

### Q41: Where should a wrapper for `time.Time` live in a hexagonal architecture?

**Answer:** In the **domain** layer. The domain owns the semantic meaning (e.g., `CycleDate`, `BillingDate`). Adapter layers (DB, HTTP) reuse the domain wrapper; they do not redefine it. Free utility functions for `time.Time` go in a generic `pkg/timex` or `internal/timex`.

### Q42: A team wants to add `IsBusinessHour` to `time.Time` everywhere. What do you recommend?

**Answer:** A free function in a small `internal/timex` package:

```go
func IsBusinessHour(t time.Time, loc *time.Location) bool { ... }
```

There is no need for polymorphism, no need for interface satisfaction, and no extra state. A wrapper would force conversions all over the codebase for zero gain.

### Q43: When must you wrap rather than use a free function?

**Answer:** When the value must satisfy an interface that requires the form `value.Method()`:

- `fmt.Stringer`
- `json.Marshaler` / `json.Unmarshaler`
- `sql.Scanner` / `driver.Valuer`
- Any custom interface a third-party API expects.

Free functions cannot fulfill these contracts.

### Q44: How do you avoid wrapper sprawl across layers?

**Answer:** Define each wrapper once in the domain layer. Other layers (`infra/db`, `api/http`) import it directly. Disallow per-layer duplicates like `db.Date` and `api.Date` — both should be `domain.Date`.

A linter or code-review rule can ban new types whose underlying type matches a pre-existing wrapper in another package.

---

## What Interviewers Look For

### Junior

- Can articulate that methods belong to types and types belong to packages.
- Knows aliases differ from defined types.
- Can write a small wrapper type and use explicit conversions.

### Middle

- Knows the three workarounds and when each fits.
- Understands that wrappers do not inherit the underlying type's method set.
- Can forward a marshaler through a wrapper.
- Knows embedding promotes methods (and interface implementations).

### Senior

- Can explain why the same-package rule exists in terms of API stability and method-set determinism.
- Justifies workaround choice based on architecture (DDD, hexagonal).
- Recognizes shadowing pitfalls and public-API leakage from embedding.
- Understands generic alias rules (Go 1.24+) and that they do not change method-declaration restrictions.

### Professional

- Designs wrappers with full marshaling support and compile-time interface assertions.
- Plans semver impact of wrapper changes.
- Avoids wrapper sprawl across packages.
- Writes round-trip tests for serialization wrappers.
- Uses tooling to enforce wrapper conventions.

---

## Cheat Sheet

```
THE RULE
─────────────────────────────────────────
Receiver base type must be a DEFINED type
in the SAME package as the method.

WORKAROUNDS
─────────────────────────────────────────
1. type MyTime time.Time         // wrapper
2. func F(t time.Time) ...       // free function
3. struct { time.Time }          // embedding

NOT WORKAROUNDS
─────────────────────────────────────────
type X = time.Time              // alias
type X[T any] = []T             // generic alias (1.24+)

CONVERSIONS
─────────────────────────────────────────
MyTime(t)        time.Time -> MyTime
time.Time(mt)    MyTime    -> time.Time

WRAPPER + MARSHALING
─────────────────────────────────────────
Forward MarshalJSON / UnmarshalJSON
Forward Scan / Value
Add interface assertions as sentinels

EMBEDDING
─────────────────────────────────────────
Promotes methods AND interface impls
Outer methods shadow inner at outer site
Watch out for public API leakage

REAL-WORLD
─────────────────────────────────────────
sql.NullString / sql.NullTime — struct + Scan/Value
net.IP                        — defined type []byte
custom Duration               — wrapper for JSON
loggingDB                     — embedding decorator

WHAT TO AVOID SAYING
─────────────────────────────────────────
- "Just use a type alias"  (it is not a workaround)
- "Wrappers inherit methods" (they do not)
- "Aliases get a new method set" (no, identical)
- "Methods on time.Time work if I import time" (no, never)
```
