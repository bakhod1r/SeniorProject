# Basics of OOP — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What is the difference between a class and an object in Java?

**Answer:**
A **class** is a blueprint or template that defines the structure (fields) and behavior (methods) of objects. An **object** is a concrete instance of a class created at runtime using the `new` keyword.

```java
// Class (blueprint)
class Car {
    String color;
    void drive() { System.out.println("Driving..."); }
}

// Object (instance)
Car myCar = new Car();       // object 1
Car yourCar = new Car();     // object 2 — same class, different object
```

A class exists in source code and bytecode. An object exists in memory (heap) at runtime.

---

### 2. What are the four access modifiers in Java and what do they control?

**Answer:**

| Modifier | Same Class | Same Package | Subclass (other pkg) | Everywhere |
|----------|:----------:|:------------:|:-------------------:|:----------:|
| `public` | Yes | Yes | Yes | Yes |
| `protected` | Yes | Yes | Yes | No |
| *(default)* | Yes | Yes | No | No |
| `private` | Yes | No | No | No |

- Use `private` for internal state (fields)
- Use `public` for API methods
- Use `protected` for extension points in inheritance
- Use default (no keyword) for package-internal implementation

---

### 3. What is encapsulation and why is it important?

**Answer:**
Encapsulation means hiding internal data (fields) by making them `private` and providing controlled access through `public` getter and setter methods.

```java
class BankAccount {
    private double balance;  // hidden from outside

    public double getBalance() { return balance; }

    public void deposit(double amount) {
        if (amount > 0) balance += amount;  // validation!
    }
}
```

**Why it matters:**
- Prevents invalid state (negative balance, null names)
- Allows changing internal implementation without breaking external code
- Makes debugging easier — all changes go through controlled methods

---

### 4. What is a constructor? How is it different from a regular method?

**Answer:**
A constructor is a special method that initializes a new object. Differences:

| Aspect | Constructor | Method |
|--------|-------------|--------|
| Name | Same as class name | Any valid name |
| Return type | None (not even `void`) | Must specify a return type |
| Called by | `new` keyword automatically | Explicitly by the programmer |
| Purpose | Initialize object state | Perform actions |
| Inherited | No | Yes (if not private) |

```java
class User {
    private String name;

    // Constructor — no return type, same name as class
    public User(String name) {
        this.name = name;
    }

    // Regular method — has return type
    public String getName() {
        return name;
    }
}
```

---

### 5. What is the `static` keyword? When would you use it?

**Answer:**
`static` means the member belongs to the **class itself**, not to any specific object. Static members are shared across all instances.

**Use `static` for:**
- Constants: `static final double PI = 3.14159;`
- Utility methods: `Math.max(a, b)` — no state needed
- Factory methods: `LocalDate.of(2024, 1, 1)`
- Counters shared across all instances

**Do NOT use `static` for:**
- Data that varies per object (name, balance, etc.)
- Methods that access instance fields

```java
class Student {
    private String name;               // instance — each student has their own
    private static int totalStudents;  // static — shared across all students

    public Student(String name) {
        this.name = name;
        totalStudents++;
    }

    public static int getTotalStudents() { return totalStudents; }
}
```

---

### 6. What is `this` keyword in Java?

**Answer:**
`this` refers to the **current object** — the instance on which the method was called.

Common uses:
1. **Disambiguate field from parameter:** `this.name = name;`
2. **Call another constructor:** `this(defaultValue);` (must be first statement)
3. **Pass current object:** `list.add(this);`
4. **Fluent API:** `return this;` for method chaining

```java
class Config {
    private String host;
    private int port;

    Config(String host, int port) {
        this.host = host;    // this.host = field, host = parameter
        this.port = port;
    }

    Config() {
        this("localhost", 8080);  // calls the other constructor
    }
}
```

---

### 7. Why should you override `toString()`?

**Answer:**
The default `Object.toString()` returns `ClassName@hexHashCode` (e.g., `Student@1a2b3c4d`), which is useless for debugging. Overriding it provides a human-readable representation.

```java
// Without override:
System.out.println(student); // Student@1a2b3c4d

// With override:
@Override
public String toString() {
    return "Student{name='" + name + "', age=" + age + "}";
}
System.out.println(student); // Student{name='Alice', age=20}
```

**Interviewers look for:** Understanding that `System.out.println(obj)` implicitly calls `toString()`, and that logging frameworks also use it.

---

## Middle Level

### 8. Explain the `equals()` and `hashCode()` contract. Why must they be overridden together?

**Answer:**
The contract states:
1. If `a.equals(b)` is `true`, then `a.hashCode() == b.hashCode()` **must** be `true`
2. If `a.hashCode() != b.hashCode()`, then `a.equals(b)` **must** be `false`
3. Two unequal objects **may** have the same hashCode (collision)

**Why together:** `HashMap` uses `hashCode()` to find the bucket, then `equals()` to match the key. If only `equals()` is overridden:

```java
class User {
    String name;
    User(String name) { this.name = name; }

    @Override
    public boolean equals(Object o) {
        return o instanceof User && name.equals(((User) o).name);
    }
    // hashCode() NOT overridden — uses Object.hashCode() (identity)
}

Map<User, String> map = new HashMap<>();
map.put(new User("Alice"), "data");
map.get(new User("Alice")); // returns null! Different hashCode → different bucket
```

**Correct implementation:**

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (o == null || getClass() != o.getClass()) return false;
    User user = (User) o;
    return Objects.equals(name, user.name);
}

@Override
public int hashCode() {
    return Objects.hash(name);
}
```

---

### 9. What is the difference between `==` and `.equals()` for objects?

**Answer:**

| Operator | Compares | Example |
|----------|----------|---------|
| `==` | Reference identity (same object in memory) | `a == b` → same pointer? |
| `.equals()` | Logical equality (field values, if overridden) | `a.equals(b)` → same data? |

```java
String a = new String("hello");
String b = new String("hello");
System.out.println(a == b);      // false — different objects
System.out.println(a.equals(b)); // true — same content

// Special case: String literals are interned
String c = "hello";
String d = "hello";
System.out.println(c == d);      // true — same interned reference
```

**Tricky case — Integer caching:**
```java
Integer x = 127;
Integer y = 127;
System.out.println(x == y);  // true — cached (-128 to 127)

Integer a = 128;
Integer b = 128;
System.out.println(a == b);  // false — different objects!
```

---

### 10. What is an immutable class? How do you create one in Java?

**Answer:**
An immutable class cannot be modified after construction. Rules:
1. Declare the class as `final` (prevent subclassing)
2. Make all fields `private final`
3. Provide no setters
4. Use constructor or factory method for initialization
5. Defensive copy any mutable fields (in constructor and getters)

```java
final class Money {
    private final double amount;
    private final String currency;

    public Money(double amount, String currency) {
        this.amount = amount;
        this.currency = Objects.requireNonNull(currency);
    }

    public double getAmount() { return amount; }
    public String getCurrency() { return currency; }
    // No setters!
}
```

**Java 16+ shortcut:** Use `record`:
```java
record Money(double amount, String currency) {} // automatically immutable
```

**Benefits:** Thread-safe, safe as HashMap keys, no defensive copying needed when passing around.

---

### 11. What is the Builder pattern and when should you use it?

**Answer:**
The Builder pattern separates object construction from representation, allowing step-by-step construction with a fluent API.

**When to use:**
- More than 4-5 constructor parameters
- Many optional parameters with sensible defaults
- Need readable code at the construction site

```java
HttpRequest request = new HttpRequest.Builder("https://api.example.com")
    .method("POST")
    .header("Content-Type", "application/json")
    .body("{\"name\": \"Alice\"}")
    .timeout(5000)
    .build();
```

**When NOT to use:**
- Simple objects with 1-3 required fields — a constructor is sufficient
- Objects that are always fully specified — no optional fields

---

### 12. What is the difference between `getClass()` and `instanceof` in `equals()`?

**Answer:**

| Approach | Behavior | When to use |
|----------|----------|-------------|
| `getClass() != o.getClass()` | Strict type match — subclasses are NOT equal | Non-final classes |
| `o instanceof MyClass` | Allows subclass instances to be "equal" | Final classes or Liskov-safe hierarchies |

```java
// Problem with instanceof in non-final class:
class Point {
    int x, y;
    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
}

class ColorPoint extends Point {
    String color;
    @Override
    public boolean equals(Object o) {
        if (!(o instanceof ColorPoint)) return false;
        ColorPoint cp = (ColorPoint) o;
        return super.equals(cp) && color.equals(cp.color);
    }
}

Point p = new Point(1, 2);
ColorPoint cp = new ColorPoint(1, 2, "red");
p.equals(cp);  // true (Point ignores color)
cp.equals(p);  // false (p is not a ColorPoint)
// Symmetry violated!
```

**Rule:** Use `getClass()` for non-final classes. Use `instanceof` only for `final` classes or when Liskov Substitution is guaranteed.

---

### 13. How does Java `record` work and when should you use it?

**Answer:**
A `record` (Java 16+) is a special class that is:
- **Immutable** — all fields are `final`
- **Transparent** — auto-generates `equals()`, `hashCode()`, `toString()`, and getters
- **Cannot extend** other classes (implicitly extends `Record`)
- **Can implement** interfaces

```java
record Point(int x, int y) {}
// Auto-generates:
// - constructor: Point(int x, int y)
// - getters: x(), y() (not getX()!)
// - equals(): compares all components
// - hashCode(): hashes all components
// - toString(): "Point[x=1, y=2]"
```

**When to use:** DTOs, API responses, value objects, configuration objects.
**When NOT to use:** JPA entities (need mutable state), classes with complex business logic, classes needing inheritance.

---

## Senior Level

### 14. Explain the object memory layout in the JVM. What is the mark word?

**Answer:**
On a 64-bit JVM with compressed oops, every object has:
- **Mark word** (8 bytes): identity hashCode (25 bits), GC age (4 bits), lock state (2 bits), biased lock thread ID
- **Klass pointer** (4 bytes compressed): pointer to class metadata in Metaspace
- **Instance fields**: aligned and ordered by size (longs first, then ints, etc.)
- **Padding**: to 8-byte boundary

An empty `new Object()` takes 16 bytes (12 header + 4 padding).

The mark word is **overloaded** — it stores different data depending on the lock state:
- Unlocked: hashCode + age + lock bits
- Biased: thread ID + epoch + age
- Lightweight locked: pointer to lock record on stack
- Heavyweight locked: pointer to monitor object
- GC marked: forwarding pointer

**Key implication:** Computing `identityHashCode()` on a biased-locked object requires a safepoint to revoke the bias — this is one reason biased locking was deprecated in Java 15.

---

### 15. What is escape analysis and how does it affect object creation?

**Answer:**
Escape analysis is a JIT compiler optimization (C2) that determines whether an object reference "escapes" its creation scope:

1. **NoEscape:** Object used only within the method → **scalar replacement** (decompose into local variables, no heap allocation)
2. **ArgEscape:** Object passed as argument but does not escape the thread → possible stack allocation
3. **GlobalEscape:** Object stored in a field, returned, or accessible by other threads → normal heap allocation

```java
// NoEscape — JIT eliminates the Point allocation
int sum(int x, int y) {
    Point p = new Point(x, y); // scalar replaced: p.x → local var, p.y → local var
    return p.x + p.y;
}
// After JIT: equivalent to return x + y;
```

**Verify:**
```bash
java -XX:+PrintEscapeAnalysis -XX:+PrintEliminateAllocations -jar app.jar
```

**Limitations:**
- Only works when the method is JIT-compiled (after ~10,000 invocations)
- Large objects may not be scalar replaced (too many fields)
- Objects passed to non-inlined methods always escape

---

### 16. How should `equals()` and `hashCode()` be implemented for JPA entities?

**Answer:**
For JPA entities, **never use `@GeneratedValue` ID** for equals/hashCode:
- Before `persist()`, the ID is `null` — all new entities would be "equal"
- After merge/detach, identity may differ from database

**Best practice:** Use a **natural business key** or a UUID assigned in the constructor:

```java
@Entity
class Order {
    @Id @GeneratedValue
    private Long id;

    @Column(unique = true, nullable = false)
    private String orderNumber; // business key

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Order)) return false; // instanceof OK here — JPA proxies
        return orderNumber.equals(((Order) o).orderNumber);
    }

    @Override
    public int hashCode() {
        return orderNumber.hashCode();
    }
}
```

**Note:** For JPA entities, `instanceof` is preferred over `getClass()` because Hibernate may create proxy subclasses (e.g., `Order$HibernateProxy`), and `getClass()` would fail for proxied entities.

---

### 17. How would you design an object model for a high-throughput system processing millions of events per second?

**Answer:**
Key strategies:
1. **Minimize object creation** — use flyweight pattern, object pools for hot-path objects
2. **Favor immutable objects** — JIT escape analysis can eliminate them entirely
3. **Reduce object size** — fewer fields, use primitives over wrappers, avoid deep hierarchies
4. **Cache hashCode** for objects used as map keys
5. **Avoid autoboxing** — use primitive collections (Eclipse Collections, Trove)
6. **Profile first** — use JFR allocation profiling before optimizing

```java
// Before: creates wrapper objects per event
record Event(String type, long timestamp, Map<String, Object> data) {}

// After: flyweight + pre-allocated buffers
class EventBuffer {
    private final String[] types;
    private final long[] timestamps;
    private int position = 0;

    void addEvent(String type, long timestamp) {
        types[position] = type;
        timestamps[position] = timestamp;
        position++;
    }
}
```

**Decision framework:** Only pool/optimize when JFR shows allocation rate > 5GB/s or GC pause p99 > 100ms.

---

### 18. Explain sealed classes and their advantages over traditional class hierarchies.

**Answer:**
Sealed classes (Java 17) restrict which classes can extend them:

```java
sealed interface Shape permits Circle, Rectangle, Triangle {}
```

**Advantages:**
1. **Compile-time exhaustiveness** — switch/pattern matching can verify all subtypes are handled
2. **API control** — no unauthorized subclasses outside your module
3. **Optimization** — JIT can devirtualize more aggressively when the set of subtypes is fixed
4. **Domain modeling** — explicitly represents "one of these types" (algebraic data types)

**Comparison:**

| Feature | Open class | Final class | Sealed class |
|---------|-----------|-------------|-------------|
| Extendable | Yes, by anyone | No | Only permitted classes |
| Pattern matching | Not exhaustive | N/A | Exhaustive |
| JIT optimization | Limited | Full devirtualization | Good devirtualization |

---

## Scenario-Based Questions

### 19. Your application has a memory leak that grows slowly over days. JFR shows millions of instances of a particular domain class. How do you investigate?

**Answer:**
Step-by-step approach:

1. **Take a heap dump:**
   ```bash
   jmap -dump:live,format=b,file=heap.hprof <pid>
   ```

2. **Analyze with Eclipse MAT:**
   - Open dominator tree → sort by retained heap
   - Find the class with millions of instances
   - Check "Path to GC Roots" → identify what is holding references

3. **Common causes:**
   - Static `Map`/`List` that grows without eviction
   - Listener/callback not deregistered
   - ThreadLocal not cleaned up after use
   - Cache without size limit or TTL

4. **Fix:**
   - Replace unbounded cache with `Caffeine` or `Guava Cache` (size/TTL limits)
   - Use `WeakHashMap` for metadata attached to objects
   - Add explicit cleanup in `finally` blocks for ThreadLocals
   - Use `WeakReference` for listener registrations

---

### 20. You are reviewing code that uses `HashMap<Employee, List<Task>>`. The team reports that tasks "disappear" after employees update their profiles. What is wrong?

**Answer:**
The `Employee` class likely has `equals()`/`hashCode()` based on **mutable fields** (name, email, department). When an employee updates their profile, the hashCode changes, but the entry remains in the old bucket.

**Diagnosis:**
```java
// Before update: hashCode=123, bucket=123 % 16 = 11
Employee emp = new Employee("Alice", "Engineering");
map.put(emp, tasks);

// After update: hashCode=456, bucket=456 % 16 = 8
emp.setDepartment("Management"); // hashCode changed!

// map.get(emp) looks in bucket 8, but entry is in bucket 11 → null
```

**Fix options:**
1. Make `Employee` immutable (best)
2. Base `equals()`/`hashCode()` on immutable business key (employee ID)
3. Use `IdentityHashMap` if reference identity is acceptable
4. Remove and re-insert after mutation: `map.remove(emp)` → mutate → `map.put(emp, tasks)`

---

### 21. You need to design a plugin system where third-party developers can add new types but you want compile-time safety. How would you approach this?

**Answer:**
Use a combination of **interfaces** and **sealed classes**:

**For your core types (closed set):**
```java
sealed interface CoreShape permits Circle, Rectangle {
    double area();
}
```

**For extensions (open set):**
```java
// Non-sealed allows third-party extension
non-sealed interface CustomShape extends Shape {
    double area();
    String pluginId(); // required metadata
}
```

**For the main API:**
```java
sealed interface Shape permits CoreShape, CustomShape {
    double area();
}
```

This gives you exhaustive matching for core types while allowing extensions via the `non-sealed` escape hatch.

---

## FAQ

### Q: What are the most common OOP interview mistakes?

**A:**
1. Confusing `==` with `.equals()` — especially for String and Integer
2. Not knowing the equals/hashCode contract
3. Unable to explain why encapsulation matters (beyond "it hides data")
4. Confusing `static` with `final`
5. Not understanding the difference between overloading and overriding

### Q: Should I use `record` or traditional class in interviews?

**A:** Know both. Start with `record` for simple data holders (shows you know modern Java), but be ready to write the full traditional implementation (shows you understand what `record` generates under the hood).

### Q: What do interviewers look for when asking about OOP basics in Java?

**A:** Key evaluation criteria:
- **Junior:** Can write a class with fields, constructor, getters/setters. Knows `private` vs `public`. Can explain `this` and `static`.
- **Middle:** Can explain the equals/hashCode contract with HashMap context. Knows immutable class design. Understands `instanceof` vs `getClass()` in equals. Uses `Objects.requireNonNull()`.
- **Senior:** Can discuss object memory layout, escape analysis, JPA entity identity issues. Knows sealed classes and their JIT implications. Can design GC-friendly object models.

### Q: How important is OOP knowledge for Spring Boot interviews?

**A:** Very important. Spring Boot is built entirely on OOP:
- `@Service`, `@Repository`, `@Controller` are classes with constructor injection
- JPA entities require correct `equals()`/`hashCode()`
- DTOs benefit from records or Builder pattern
- Spring AOP uses object proxying (dynamic subclasses)

Every Spring Boot question implicitly tests your OOP understanding.

### Q: What is the difference between composition and inheritance?

**A:**

| Aspect | Inheritance | Composition |
|--------|------------|-------------|
| Relationship | "is-a" | "has-a" |
| Coupling | Tight | Loose |
| Flexibility | Fixed at compile time | Can change at runtime |
| When to use | True type hierarchy | Code reuse without type relationship |

```java
// ❌ Inheritance abuse
class Stack extends ArrayList { ... } // Stack "is-a" ArrayList? No.

// ✅ Composition
class Stack {
    private final List<Object> items = new ArrayList<>(); // Stack "has-a" List
    public void push(Object item) { items.add(item); }
    public Object pop() { return items.remove(items.size() - 1); }
}
```

**Rule:** Favor composition over inheritance (Effective Java, Item 18).
