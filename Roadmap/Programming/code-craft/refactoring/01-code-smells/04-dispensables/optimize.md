# Dispensables — Optimize

> 12 inefficient cures for Dispensables.

---

## Optimize 1 — Over-extracted method (Java)

**Original:**

```java
public boolean isAdult(int age) {
    return checkAge(age);
}

private boolean checkAge(int age) {
    return verifyNonNegative(age) && verifyOver18(age);
}

private boolean verifyNonNegative(int age) {
    return checkNotNegative(age);
}

private boolean checkNotNegative(int age) {
    return age >= 0;
}

private boolean verifyOver18(int age) {
    return age >= 18;
}
```

**Issue:** Extract Method applied too aggressively. 5 method calls to evaluate `age >= 18`. Each is a JIT inline candidate, but accumulates IC pressure.

**Fix:** consolidate.

```java
public boolean isAdult(int age) {
    return age >= 18;
}
```

The original had no validation step that mattered (negative ages). If you need it, `if (age < 0) throw ...` once at the boundary, not as nested helpers.

---

## Optimize 2 — Premature DRY (Python)

**Original:**

```python
# Two callers needed similar but slightly different formatting:
def format_address(addr, include_country=True, abbreviate_state=False, 
                   add_zip_extension=False, format='multiline', uppercase=False):
    parts = []
    if uppercase:
        addr = {k: v.upper() for k, v in addr.items()}
    parts.append(addr['line1'])
    if abbreviate_state:
        state = STATE_ABBREVIATIONS[addr['state']]
    else:
        state = addr['state']
    # ... 30 more lines handling all combinations
```

**Issue:** parametrized for two callers; now serves 8 with a 6-arg call signature. Each new caller adds a parameter; eventually unmaintainable.

**Fix:** stop unifying. Have two (or more) focused functions per caller:

```python
def format_us_address(addr): ...
def format_intl_address(addr): ...
def format_label_address(addr): ...
```

Some duplication. Each is simple. Sandi Metz: "Duplication is far cheaper than the wrong abstraction."

---

## Optimize 3 — Unnecessary indirection through Lazy Class (Go)

**Original:**

```go
type StringProcessor struct {
    upper bool
}

func NewStringProcessor() *StringProcessor {
    return &StringProcessor{upper: false}
}

func (s *StringProcessor) Process(input string) string {
    if s.upper {
        return strings.ToUpper(input)
    }
    return input
}

// Hot path:
processor := NewStringProcessor()
for _, line := range millions {
    output := processor.Process(line)
}
```

**Issue:** `processor.Process` is a virtual call (interface, in Go terms). One field lookup, one branch — every call.

**Fix:** when `upper` is always false (common case), eliminate the processor:

```go
for _, line := range millions {
    output := line  // no processing needed
}
```

Or, when `upper` matters, partial application at construction:

```go
func MakeProcessor(upper bool) func(string) string {
    if upper {
        return strings.ToUpper
    }
    return func(s string) string { return s }
}

processor := MakeProcessor(false)  // returns identity
for _, line := range millions {
    output := processor(line)
}
```

The function pointer is direct; no struct field access per call.

---

## Optimize 4 — String concatenation in Data Class (Java)

**Original:**

```java
class Customer {
    private String firstName, lastName, country;
    
    public String fullName() {
        return firstName + " " + lastName + " (" + country + ")";
    }
}

// Hot path: list of 1M customers, format each
List<String> formatted = customers.stream().map(Customer::fullName).toList();
```

**Issue:** every `fullName()` allocates a `StringBuilder` (implicitly via `+`), then a `String`. 1M+ allocations.

**Fix 1:** if hot enough, pre-allocate.

```java
public String fullName(StringBuilder buf) {
    buf.setLength(0);
    return buf.append(firstName).append(' ')
              .append(lastName).append(" (")
              .append(country).append(')')
              .toString();
}

// Reuse buf in hot loop:
StringBuilder buf = new StringBuilder(64);
List<String> formatted = customers.stream().map(c -> c.fullName(buf)).toList();
```

**Fix 2:** if values are immutable, cache:

```java
class Customer {
    private final String firstName, lastName, country;
    private String fullNameCache;  // computed lazily
    
    public String fullName() {
        if (fullNameCache == null) {
            fullNameCache = firstName + " " + lastName + " (" + country + ")";
        }
        return fullNameCache;
    }
}
```

Trade-off: caching adds field; only worth it if `fullName()` is called many times per Customer.

---

## Optimize 5 — Speculative interface forces megamorphism (Java)

**Original:**

```java
interface Validator { boolean validate(Object o); }

class EmailValidator implements Validator { ... }
class PhoneValidator implements Validator { ... }
class AddressValidator implements Validator { ... }
class CreditCardValidator implements Validator { ... }
class IbanValidator implements Validator { ... }
class SsnValidator implements Validator { ... }

// Hot path:
for (Field f : fields) {
    Validator v = registry.get(f.type);
    boolean ok = v.validate(f.value);  // megamorphic — 6 types
}
```

**Issue:** 6 types at one call site → megamorphic, vtable cost.

**Fix:** if validators are stateless, group by type at the caller:

```java
Map<FieldType, List<Field>> byType = fields.stream().collect(groupingBy(f -> f.type));
for (var entry : byType.entrySet()) {
    Validator v = registry.get(entry.getKey());
    for (Field f : entry.getValue()) {
        v.validate(f.value);  // monomorphic per group
    }
}
```

Throughput improves; same correctness.

---

## Optimize 6 — Encapsulated collection causes copying (Java)

**Original:**

```java
class Order {
    private final List<LineItem> items;
    
    public List<LineItem> getItems() {
        return new ArrayList<>(items);  // defensive copy
    }
}

// Hot path:
for (Order o : orders) {
    for (LineItem item : o.getItems()) {  // copies list every call
        ...
    }
}
```

**Issue:** defensive copy per call. With 1M orders × 50 items, 1M list allocations.

**Fix:** unmodifiable view (no copy).

```java
public List<LineItem> getItems() {
    return Collections.unmodifiableList(items);
}
```

Or expose an iterator:

```java
public Iterable<LineItem> items() { return items; }
```

Or a forEach:

```java
public void forEachItem(Consumer<LineItem> action) {
    items.forEach(action);
}
```

The forEach version is "Tell, Don't Ask" — caller can't mutate; no copy needed.

---

## Optimize 7 — Form Template Method with hooks adds dispatch (Java)

**Original:**

```java
abstract class Workflow {
    public final void run() {
        beforeStep1();
        step1();
        afterStep1();
        beforeStep2();
        step2();
        afterStep2();
    }
    
    protected void beforeStep1() {}  // empty default
    protected void afterStep1() {}
    protected void beforeStep2() {}
    protected void afterStep2() {}
    
    protected abstract void step1();
    protected abstract void step2();
}

// 1 subclass that overrides nothing:
class SimpleWorkflow extends Workflow {
    protected void step1() { ... }
    protected void step2() { ... }
}
```

**Issue:** 4 empty hook calls per `run()`. JIT can inline empties (zero cost), but the method body is bloated.

**Fix:** if no subclass uses the hooks, remove them.

```java
abstract class Workflow {
    public final void run() {
        step1();
        step2();
    }
    protected abstract void step1();
    protected abstract void step2();
}
```

If hooks are needed in 1-2 subclasses but not most, accept the empty hooks (JIT will inline). Don't remove; some flexibility is worth the cost.

---

## Optimize 8 — Defensive copying in immutable types (Java)

**Original:**

```java
final class Person {
    private final List<String> aliases;
    
    public Person(List<String> aliases) {
        this.aliases = new ArrayList<>(aliases);  // defensive copy on construction
    }
    
    public List<String> getAliases() {
        return new ArrayList<>(aliases);  // defensive copy on access
    }
}
```

**Issue:** two copies per use — once on construct, once on access.

**Fix:** use immutable collections.

```java
final class Person {
    private final List<String> aliases;
    
    public Person(List<String> aliases) {
        this.aliases = List.copyOf(aliases);  // immutable
    }
    
    public List<String> getAliases() {
        return aliases;  // already immutable
    }
}
```

`List.copyOf` returns an immutable list — safe to share. One copy on construct, zero on access.

---

## Optimize 9 — Dead code in libraries (Java)

**Issue:** a library has dead code. Library users still ship it (it's in the JAR).

**Fix:** for size-sensitive consumers (Android apps, serverless functions), use:

- **ProGuard / R8** to remove unreferenced code at build time.
- **JLink / GraalVM native-image** to produce a custom JRE/binary with only used classes.
- **Tree-shaking** for JS modules.

This is build-time DCE, distinct from runtime JIT DCE.

---

## Optimize 10 — Comments compiled into bytecode? (Java)

**Reality:** comments are stripped by the compiler — they don't appear in `.class` files. Even Javadoc isn't in bytecode (it's in separate `.html` files).

**However:** annotation strings *are* in bytecode. `@Deprecated(since = "very long string")` consumes class file space.

**Fix:** keep annotation values short. For long descriptions, use Javadoc, not annotation strings.

---

## Optimize 11 — Dead public methods in API surface (Java)

**Original:** a library has `chargeViaLegacyGateway()` marked `@Deprecated`. It's still public. Subclasses might override.

**Issue:** `@Deprecated` doesn't *prevent* use. Static analysis flags new uses, but existing uses (and subclass overrides) keep the method effectively alive.

**Fix:**

1. **Mark with `@Deprecated(forRemoval = true, since = "2.5")`** — clearer intent, future tooling support.
2. **JEP 277 (final removal in major version)**: in version 3.0, delete.
3. **Communicate via deprecation notes**: docs, release notes, migration guide.

In Java 9+, with `module-info.java`, you can also remove the export — making the method invisible to consumers.

---

## Optimize 12 — Inline Class with side effects (Java)

**Original (Lazy Class):**

```java
class Logger {
    public void log(String msg) {
        System.out.println("[" + Instant.now() + "] " + msg);
    }
}

// Used:
new Logger().log("Hello");  // allocates Logger per call
```

**Naive Inline:**

```java
System.out.println("[" + Instant.now() + "] Hello");
```

**Issue:** the inlining lost the *consistency* of timestamp formatting. If formatting needs to evolve (e.g., add a thread name), every call site must update.

**Fix:** inline to a *static utility*:

```java
class Log {
    public static void log(String msg) {
        System.out.println("[" + Instant.now() + "] " + msg);
    }
}

// Used:
Log.log("Hello");
```

The class is gone (well, replaced by a namespace), but formatting consistency is preserved. Inlining isn't always "delete the class"; sometimes it's "make it static."

---

> **Next:** [interview.md](interview.md) — Q&A.
