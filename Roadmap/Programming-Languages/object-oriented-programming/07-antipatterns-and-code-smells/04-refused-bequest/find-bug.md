# Refused Bequest — Find the Bug

Ten scenarios drawn from real production codebases and the JDK itself. For each one: the buggy snippet, what goes wrong at runtime, the diagnosis, and the fix.

Treat this like a code-review drill. Read the snippet, predict the failure, then check your answer against the diagnosis.

---

## Scenario 1 — Stack-style refused bequest

```java
public class Stack<E> extends Vector<E> {
    public E push(E item) { addElement(item); return item; }
    public synchronized E pop() {
        E obj = peek();
        removeElementAt(size() - 1);
        return obj;
    }
    public synchronized E peek() { return elementAt(size() - 1); }
}

// Caller
Stack<Integer> s = new Stack<>();
s.push(1); s.push(2); s.push(3);
s.add(0, 99);          // legal — inherited from Vector
int top = s.pop();     // returns 3, but 99 is now stuck at the bottom forever
```

**Failure:** Stack invariant ("only the last-pushed item is accessible") is silently violated. No exception, no warning — just a corrupted stack.

**Diagnosis:** Stack inherits Vector's entire random-access mutation API and refuses none of it. The bequest includes methods (`add(int, E)`, `insertElementAt`, `remove(int)`) that the subclass cannot honor without breaking its own invariant.

**Fix:** Use `Deque` and `ArrayDeque`. Stack is not salvageable without a breaking change.

---

## Scenario 2 — Framework subclass refusing lifecycle

```java
public abstract class AbstractJob {
    protected abstract void run();
    protected void onSuccess() { metrics.increment("job.success"); }
    protected void onFailure(Throwable t) { metrics.increment("job.failure"); alerts.send(t); }
    protected void onRetry()   { metrics.increment("job.retry"); }
}

public class NightlyReportJob extends AbstractJob {
    @Override protected void run() { generateReport(); }
    @Override protected void onFailure(Throwable t) { /* swallow */ }
}
```

**Failure:** A `NullPointerException` during report generation is swallowed. Three weeks later, leadership asks "why didn't we know the reports were broken?" — the answer is that someone refused the `onFailure` bequest.

**Diagnosis:** The override has an empty body. This is the most common production refused bequest: a contributor wanted to silence a noisy alert during local testing and forgot to revert.

**Fix:** Add a SonarJava `S1186` rule that fails the build on empty `@Override` bodies. Replace with explicit `super.onFailure(t);` plus a comment explaining any deviation.

---

## Scenario 3 — ImmutableList that throws on add

```java
public class ImmutableList<E> extends ArrayList<E> {
    public ImmutableList(Collection<? extends E> src) { super(src); }
    @Override public boolean add(E e)            { throw new UnsupportedOperationException(); }
    @Override public void    add(int i, E e)     { throw new UnsupportedOperationException(); }
    @Override public boolean remove(Object o)    { throw new UnsupportedOperationException(); }
    @Override public E       remove(int i)       { throw new UnsupportedOperationException(); }
    @Override public boolean addAll(Collection<? extends E> c) { throw new UnsupportedOperationException(); }
    // ... 11 more refused mutators
}
```

**Failure:** A method downstream does `if (list instanceof ArrayList) list.trimToSize();` — and `trimToSize()` is inherited and not refused, so it mutates internal state of the "immutable" list.

**Diagnosis:** Inheriting from a concrete mutable class to build an immutable one is structurally impossible. You cannot remove `trimToSize`, `ensureCapacity`, or `removeRange` — they leak through.

**Fix:** Implement `List<E>` directly, or wrap with `Collections.unmodifiableList(...)`, or use `List.copyOf(...)`. Never extend `ArrayList` to "make it immutable."

---

## Scenario 4 — Square extends Rectangle

```java
public class Rectangle {
    protected int width, height;
    public void setWidth(int w)  { this.width = w; }
    public void setHeight(int h) { this.height = h; }
    public int area() { return width * height; }
}

public class Square extends Rectangle {
    @Override public void setWidth(int w)  { this.width = w; this.height = w; }
    @Override public void setHeight(int h) { this.width = h; this.height = h; }
}

void test(Rectangle r) {
    r.setWidth(5); r.setHeight(10);
    assert r.area() == 50;   // fails if r is actually a Square
}
```

**Failure:** Tests that pass for `Rectangle` fail for `Square`. The textbook LSP violation, but the underlying mechanism is refused bequest: `Square` cannot honor the bequest that `setWidth` and `setHeight` are independent.

**Diagnosis:** `Square` refuses the implicit contract "the two setters are orthogonal" by coupling them.

**Fix:** `Square` should not extend `Rectangle`. They share a vocabulary (`area()`) but not a substitutability relationship. Extract a `Shape` interface with `area()` and have both implement it.

---

## Scenario 5 — Properties allowing non-String values

```java
Properties config = new Properties();
config.put("port", 8080);              // compiles — inherited from Hashtable
config.setProperty("host", "localhost");
config.store(new FileWriter("conf"), null);
// throws ClassCastException — store assumes String values
```

**Failure:** `ClassCastException` at write time, possibly weeks after the offending `put` call.

**Diagnosis:** `Properties` extends `Hashtable<Object, Object>` and **refuses the type contract** of the parent: it documents `String -> String` but cannot enforce it because `put(Object, Object)` is inherited.

**Fix:** In your own code, type-narrow with composition:

```java
public final class StringProperties {
    private final Properties inner = new Properties();
    public void set(String k, String v) { inner.setProperty(k, v); }
    public String get(String k) { return inner.getProperty(k); }
    public void store(Writer w) throws IOException { inner.store(w, null); }
}
```

---

## Scenario 6 — Bird hierarchy with Penguin

```java
public abstract class Bird {
    public abstract void eat();
    public void fly() { System.out.println("Flying"); }
}

public class Penguin extends Bird {
    @Override public void eat() { eatFish(); }
    @Override public void fly() { throw new UnsupportedOperationException("Penguins can't fly"); }
}
```

**Failure:** Any polymorphic loop `for (Bird b : aviary) b.fly();` breaks the moment a Penguin is added.

**Diagnosis:** Refusal of a non-abstract method in the parent. The taxonomy of "bird" includes flight in the popular mental model but not the biological one.

**Fix:** Move `fly` to a `Flyable` interface. `Bird implements Animal`; `Eagle implements Bird, Flyable`; `Penguin implements Bird`.

---

## Scenario 7 — Adapter pattern misused

```java
public abstract class MouseAdapter implements MouseListener {
    public void mouseClicked(MouseEvent e)  {}
    public void mousePressed(MouseEvent e)  {}
    public void mouseReleased(MouseEvent e) {}
    public void mouseEntered(MouseEvent e)  {}
    public void mouseExited(MouseEvent e)   {}
}

public class HoverHighlighter extends MouseAdapter {
    @Override public void mouseEntered(MouseEvent e) { highlight(); }
    @Override public void mouseExited(MouseEvent e)  { unhighlight(); }
}

// Now extended further...
public class StickyHighlighter extends HoverHighlighter {
    @Override public void mouseExited(MouseEvent e) { /* keep highlight */ }
    @Override public void mouseClicked(MouseEvent e) { toggle(); }
}
```

**Failure:** `StickyHighlighter` looks reasonable, but a future maintainer reading `HoverHighlighter` assumes `mouseExited` unhighlights. The refusal cascades.

**Diagnosis:** `MouseAdapter` is a **legitimate refused-bequest acceptor** — its purpose is to let subclasses skip methods. But subclasses of subclasses turn that into a maintenance trap.

**Fix:** Forbid extending classes that themselves extend an adapter. Use `final` on `HoverHighlighter`, or use a `MouseListener` directly with lambdas (`addMouseListener(MouseAdapter -> ...)` style) instead of stacked inheritance.

---

## Scenario 8 — Subclass refusing equals/hashCode

```java
public class TimestampedString extends String { ... }   // doesn't compile, String is final
// ... so the dev copies String into their own class

public class TaggedUser extends User {
    private final String tag;
    public TaggedUser(long id, String name, String tag) { super(id, name); this.tag = tag; }
    // no equals/hashCode override
}

Set<User> users = new HashSet<>();
users.add(new TaggedUser(1, "alice", "admin"));
users.contains(new User(1, "alice"));  // true — losing the tag distinction
```

**Failure:** `TaggedUser` inherits `equals`/`hashCode` from `User` and silently refuses to incorporate its own `tag` field. Two `TaggedUser`s with different tags are "equal."

**Diagnosis:** Subtype refuses the *responsibility* of redefining identity after adding state. The bequest of `equals`/`hashCode` is fundamentally incompatible with adding identity-bearing fields (Bloch, *Effective Java*, Item 10).

**Fix:** Either don't extend (compose User as a field), or override both `equals` and `hashCode`, or use a sealed hierarchy where `equals` is defined per-permitted-type.

---

## Scenario 9 — JPA entity inheritance refusing transient state

```java
@Entity
public abstract class Account {
    @Id Long id;
    BigDecimal balance;
    public void deposit(BigDecimal m)  { balance = balance.add(m); }
    public void withdraw(BigDecimal m) { balance = balance.subtract(m); }
}

@Entity
public class SavingsAccount extends Account { /* inherits all */ }

@Entity
public class FrozenAccount extends Account {
    @Override public void deposit(BigDecimal m)  { throw new IllegalStateException("Frozen"); }
    @Override public void withdraw(BigDecimal m) { throw new IllegalStateException("Frozen"); }
}
```

**Failure:** Background job `for (Account a : accounts) a.deposit(interest);` blows up the first time it touches a `FrozenAccount`.

**Diagnosis:** "Frozen" is a *state*, not a *type*. Modeling it via inheritance forces refusal of the bequest. Worse, you cannot transition an account from Savings to Frozen at runtime without changing its class.

**Fix:** Single-table inheritance with a `status` column. Behavior becomes a guard clause or a state machine, not a refusal.

```java
public void deposit(BigDecimal m) {
    if (status == Status.FROZEN) throw new AccountFrozenException();
    balance = balance.add(m);
}
```

---

## Scenario 10 — Test doubles refusing the real API

```java
public class FakeUserRepository extends UserRepository {
    private final Map<Long, User> store = new HashMap<>();
    @Override public User findById(long id) { return store.get(id); }
    @Override public void save(User u)      { store.put(u.id(), u); }
    @Override public List<User> findByOrg(long orgId, Pageable p) {
        throw new UnsupportedOperationException("not needed in tests");
    }
    @Override public Stream<User> streamAll() {
        throw new UnsupportedOperationException("not needed in tests");
    }
}
```

**Failure:** A test that exercises a new code path encounters the refused method. Worse: a *passing* test gives false confidence because the production caller doesn't exercise that path.

**Diagnosis:** "Fake by inheritance, refuse what we didn't implement" is fragile. Each new method on `UserRepository` becomes a refused bequest in the fake.

**Fix:** Define `UserRepository` as an **interface**, not a class. Then either (a) implement only the methods you need in a mock framework like Mockito (`when(repo.findById(1L)).thenReturn(...)`) and let unstubbed methods return defaults, or (b) build an in-memory implementation of the full interface as a real test fixture.

The deeper fix: **production code should depend on interfaces, not on concrete repositories**. Refused bequest in tests is almost always a symptom of this missing abstraction.

---

## Diagnosis cheat sheet

| Symptom in the bug report                            | Likely refused-bequest category |
|------------------------------------------------------|---------------------------------|
| "Polymorphic call crashed at runtime"                | Category A (explicit refusal)   |
| "Wrong value silently used"                          | Category B (silent narrowing)   |
| "ClassCastException far from where the bad value entered" | Category C (type narrowing) |
| "Adding a feature broke unrelated subclasses"        | Adapter cascade                 |
| "Tests pass but production crashes"                  | Test-double refusal             |
| "Set/Map containing duplicates"                      | equals/hashCode refusal         |
| "Background job crashes on certain entities"         | State-as-subclass refusal       |

Train yourself to ask, on every override: **does this body actually honor the parent's promise to its callers?** If not, you are looking at a refused bequest, and the fix is rarely "just override harder."
