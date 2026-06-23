# Refused Bequest — Exercises

Eight exercises, in increasing order of difficulty. Solve them in order; each builds on the previous one. A worked solution sketch follows exercise 1 so you can calibrate.

## How to validate your solutions

For each task, your refactored design should satisfy:

| Validation                                               | How to check                                               |
|----------------------------------------------------------|------------------------------------------------------------|
| No `UnsupportedOperationException` in production code    | Grep, or SonarJava rule `S1186` / custom rule              |
| No empty `@Override` bodies                              | SonarJava `S1186`, PMD `UncommentedEmptyMethodBody`        |
| `NORM(C) = 0` for every concrete class                   | Custom ArchUnit rule (see specification.md)                |
| `refusal_ratio < 0.25` for every subclass                | Manual calculation or ArchUnit                             |
| All polymorphic callers compile and run without casts    | `javac -Xlint:all` + integration tests                     |
| No `instanceof` checks against the refactored hierarchy  | Grep for `instanceof ParentType`                           |
| Tests for the original behavior still pass               | Run the test suite                                         |
| LSP property: any subtype is substitutable               | Property-based test that runs each invariant on every type |

If your solution passes the first 6 rows, you have removed the smell. Rows 7–8 confirm you didn't break behavior in the process.

---

## Exercise 1 — Refactor a Penguin

You inherit:

```java
public abstract class Bird {
    public abstract String name();
    public void fly() { System.out.println(name() + " is flying"); }
    public void layEgg() { System.out.println(name() + " laid an egg"); }
}

public class Eagle extends Bird {
    public String name() { return "Eagle"; }
}

public class Penguin extends Bird {
    public String name() { return "Penguin"; }
    @Override public void fly() {
        throw new UnsupportedOperationException("Penguins don't fly");
    }
}
```

**Task.** Refactor so that `NORM(Penguin) = 0` and a `for (Bird b : list) b.fly();` loop never throws.

**Worked solution sketch.**

The refused method (`fly`) belongs to a capability, not a category. Extract it.

```java
public interface Bird {
    String name();
    void layEgg();
}

public interface Flyable {
    void fly();
}

public class Eagle implements Bird, Flyable {
    public String name() { return "Eagle"; }
    public void layEgg() { /* ... */ }
    public void fly()    { /* ... */ }
}

public class Penguin implements Bird {
    public String name() { return "Penguin"; }
    public void layEgg() { /* ... */ }
}

// Caller
for (Bird b : birds) {
    if (b instanceof Flyable f) f.fly();
}
```

Validation:
- No UOE in production code.
- No empty overrides.
- `NORM(Penguin) = 0` — Penguin no longer overrides `fly` because the bequest doesn't exist.
- The polymorphic loop now expresses *capability*, not refusal.

If you object that the `instanceof` check is itself a code smell — you're right, and that points toward visitor or strategy. But for this exercise, removing the refusal is the win.

---

## Exercise 2 — De-Stack a stack

You have:

```java
public class Stack<E> extends Vector<E> {
    public E push(E item) { addElement(item); return item; }
    public E pop() { E o = peek(); removeElementAt(size() - 1); return o; }
    public E peek() { return elementAt(size() - 1); }
}
```

Stack inherits ~30 methods from Vector. Many of them violate the LIFO invariant.

**Task.** Build a `LifoStack<E>` that exposes only `push`, `pop`, `peek`, `size`, and `isEmpty`. No inherited mutators must leak. Internally, you may use any collection.

Bonus: make it `final` and benchmark `push`/`pop` against `java.util.Stack` using JMH.

---

## Exercise 3 — Read-only list, done right

A teammate wrote:

```java
public class ReadOnlyList<E> extends ArrayList<E> {
    public ReadOnlyList(Collection<? extends E> src) { super(src); }
    @Override public boolean add(E e)        { throw new UnsupportedOperationException(); }
    @Override public void    add(int i, E e) { throw new UnsupportedOperationException(); }
    // 13 more refused mutators
}
```

**Task.**

1. Identify at least 3 inherited methods this class **cannot refuse** and would still allow mutation (look for protected and package-private members of `ArrayList`).
2. Replace with a composition-based implementation that exposes only `size`, `get(int)`, `iterator`, `contains`, `equals`, `hashCode`, `toString`, and `stream`.
3. Compare with `List.copyOf(...)`. When would you still write your own?

---

## Exercise 4 — Animal hierarchy redesign

Given this hierarchy:

```java
abstract class Animal {
    abstract void eat();
    void move()     { System.out.println("walking"); }
    void makeSound(){ System.out.println("generic sound"); }
    void breathe()  { System.out.println("breathing air"); }
}

class Fish extends Animal {
    void eat() { ... }
    @Override void move()    { swim(); }
    @Override void breathe() { /* underwater */ }
    @Override void makeSound(){ throw new UnsupportedOperationException(); }
}

class Snake extends Animal {
    void eat() { ... }
    @Override void move() { slither(); }
}

class Tree extends Animal {  // someone added this last quarter
    void eat() { absorbNutrients(); }
    @Override void move()      { throw new UnsupportedOperationException(); }
    @Override void breathe()   { /* photosynthesis */ }
    @Override void makeSound() { throw new UnsupportedOperationException(); }
}
```

**Task.** Decompose into capability interfaces such that no concrete class refuses anything. List every interface you create and which classes implement it.

---

## Exercise 5 — JPA inheritance with frozen accounts

Refactor scenario 9 from `find-bug.md` (frozen accounts modeled as a subclass) into a state-based design. Provide:

1. The new entity class with a `status` enum.
2. The `deposit`/`withdraw` methods with explicit state checks.
3. A unit test that confirms transitions (`OPEN -> FROZEN -> OPEN`) work without changing the object's class.
4. A justification for whether you'd use a state machine library (e.g., Spring StateMachine) for this scale.

---

## Exercise 6 — Test fake without inheritance

Scenario 10 in `find-bug.md` had `FakeUserRepository extends UserRepository` with refused methods. Refactor:

1. Extract `UserRepository` into an interface (assume it's currently a class with concrete implementations).
2. Implement an in-memory test fake of the **full** interface.
3. Decide which methods need real implementations vs. which can return reasonable defaults (e.g., empty stream).
4. Write a test that exercises a code path your previous refused-bequest fake would have crashed on.

---

## Exercise 7 — ArchUnit rule for NORM

Write an ArchUnit test that:

1. Computes `NORM(C)` for every non-test, non-deprecated class in `com.example.domain`.
2. Fails if any class has `NORM ≥ 2` or `refusal_ratio > 0.25`.
3. Allows a whitelist (`@AllowedRefusal("reason")` annotation) with required justification text.
4. Reports the offending methods, not just the class.

Hand in: the ArchUnit test, the annotation, a sample violation, and the fix.

---

## Exercise 8 — Migrate `Properties` usage

You inherit 200 call sites of `java.util.Properties` in a config system. Some of them call `setProperty`; some call inherited `put(Object, Object)` with non-String values; some call `entrySet()` and downcast.

**Task.**

1. Introduce a `Config` wrapper (composition) that is type-safe `String -> String`.
2. Migrate call sites in three batches: read-only, write-mostly, mixed.
3. Provide an `@Deprecated(forRemoval = true)` adapter so the old `Properties` API still works during migration.
4. Add ArchUnit rules forbidding new code from importing `java.util.Properties`.
5. Estimate time and risk for each batch. Where are the type-narrowing landmines?

This is the most "real-world" exercise. There is no single right answer — there are correct trade-offs.

---

## Validation matrix per exercise

| Ex. | UOE removed | Empty overrides removed | NORM = 0 | LSP-safe | Compiles without casts at caller |
|-----|-------------|-------------------------|----------|----------|----------------------------------|
| 1   | required    | required                | required | required | required                         |
| 2   | required    | required                | required | required | required                         |
| 3   | required    | required                | required | required | required                         |
| 4   | required    | required                | required | required | required                         |
| 5   | required    | required                | n/a*     | required | required                         |
| 6   | required    | required                | n/a*     | n/a*     | required                         |
| 7   | n/a (tool)  | n/a (tool)              | enforced | n/a      | n/a                              |
| 8   | required    | required                | required | required | required                         |

*n/a* — the exercise eliminates inheritance entirely, so subtype-level metrics don't apply.

---

## Self-assessment

After completing these:

- If you finished 1–4, you can recognize and refactor refused bequest in self-contained domain code.
- If you finished 5–6, you can do the same in framework-coupled code (JPA, repositories).
- If you finished 7, you can prevent the smell from coming back via CI.
- If you finished 8, you can lead a real-world inheritance-debt migration.

Mark the highest level you reached, and revisit the level above it in your next study session.
