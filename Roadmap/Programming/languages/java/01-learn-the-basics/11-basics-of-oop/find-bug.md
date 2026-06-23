# Basics of OOP — Find the Bug

> **Practice finding and fixing bugs in Java code related to Basics of OOP.**
> Each exercise contains buggy code — your job is to find the bug, explain why it happens, and fix it.

---

## How to Use

1. Read the buggy code carefully
2. Try to find the bug **without** looking at the hint
3. Write the fix yourself before checking the solution
4. Understand **why** the bug happens — not just how to fix it

### Difficulty Levels

| Level | Description |
|:-----:|:-----------|
| 🟢 | **Easy** — Common beginner mistakes, missing override, basic logic errors |
| 🟡 | **Medium** — equals/hashCode violations, constructor chaining errors, encapsulation breaks |
| 🔴 | **Hard** — this reference leaks, shallow vs deep copy, subtle static/instance confusion |

---

## Bug 1: Forgetting @Override on equals 🟢

**What the code should do:** Store a `Student` in a `HashSet` and verify it can be found by value.

```java
import java.util.HashSet;
import java.util.Set;

public class Main {
    static class Student {
        String name;
        int age;

        Student(String name, int age) {
            this.name = name;
            this.age = age;
        }

        // Intended to override equals but takes wrong parameter type
        public boolean equals(Student other) {
            if (other == null) return false;
            return this.name.equals(other.name) && this.age == other.age;
        }

        public int hashCode() {
            return name.hashCode() + age;
        }
    }

    public static void main(String[] args) {
        Set<Student> students = new HashSet<>();
        students.add(new Student("Alice", 20));

        Student lookup = new Student("Alice", 20);
        System.out.println("Contains Alice: " + students.contains(lookup));
    }
}
```

**Expected output:**
```
Contains Alice: true
```

**Actual output:**
```
Contains Alice: false
```

<details>
<summary>💡 Hint</summary>

Look at the `equals` method signature — what parameter type does `Object.equals()` take?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The `equals(Student other)` method does not override `Object.equals(Object)` — it overloads it instead.
**Why it happens:** `HashSet.contains()` calls `Object.equals(Object)`. Since the method signature takes `Student` instead of `Object`, the default `Object.equals()` (reference equality) is used.
**Impact:** Two logically equal `Student` objects are treated as different because reference equality fails.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.HashSet;
import java.util.Objects;
import java.util.Set;

public class Main {
    static class Student {
        String name;
        int age;

        Student(String name, int age) {
            this.name = name;
            this.age = age;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Student other = (Student) o;
            return this.age == other.age && Objects.equals(this.name, other.name);
        }

        @Override
        public int hashCode() {
            return Objects.hash(name, age);
        }
    }

    public static void main(String[] args) {
        Set<Student> students = new HashSet<>();
        students.add(new Student("Alice", 20));

        Student lookup = new Student("Alice", 20);
        System.out.println("Contains Alice: " + students.contains(lookup));
    }
}
```

**What changed:** Fixed `equals` to accept `Object` parameter and added `@Override` annotation to catch this mistake at compile time.

</details>

---

## Bug 2: Static Field Shared Across Instances 🟢

**What the code should do:** Each `Counter` object should track its own count independently.

```java
public class Main {
    static class Counter {
        static int count = 0;

        void increment() {
            count++;
        }

        int getCount() {
            return count;
        }
    }

    public static void main(String[] args) {
        Counter c1 = new Counter();
        Counter c2 = new Counter();

        c1.increment();
        c1.increment();
        c2.increment();

        System.out.println("c1 count: " + c1.getCount());
        System.out.println("c2 count: " + c2.getCount());
    }
}
```

**Expected output:**
```
c1 count: 2
c2 count: 1
```

**Actual output:**
```
c1 count: 3
c2 count: 3
```

<details>
<summary>💡 Hint</summary>

What does the `static` keyword mean for a field? Is `count` per-instance or per-class?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The field `count` is declared `static`, so it is shared across all instances of `Counter`.
**Why it happens:** A `static` field belongs to the class, not to individual objects. All instances read and write the same memory location.
**Impact:** Both `c1` and `c2` share a single counter, producing `3` for both instead of independent counts.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    static class Counter {
        // Removed 'static' — each instance gets its own count
        int count = 0;

        void increment() {
            count++;
        }

        int getCount() {
            return count;
        }
    }

    public static void main(String[] args) {
        Counter c1 = new Counter();
        Counter c2 = new Counter();

        c1.increment();
        c1.increment();
        c2.increment();

        System.out.println("c1 count: " + c1.getCount());
        System.out.println("c2 count: " + c2.getCount());
    }
}
```

**What changed:** Removed `static` from the `count` field so each instance maintains its own independent counter.

</details>

---

## Bug 3: Getter Exposes Mutable Internal List 🟢

**What the code should do:** The `Classroom` object should encapsulate its student list so external code cannot modify it directly.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Classroom {
        private List<String> students;

        Classroom() {
            this.students = new ArrayList<>();
        }

        void addStudent(String name) {
            students.add(name);
        }

        List<String> getStudents() {
            return students;
        }

        int size() {
            return students.size();
        }
    }

    public static void main(String[] args) {
        Classroom room = new Classroom();
        room.addStudent("Alice");
        room.addStudent("Bob");

        // External code gets the list and modifies it
        List<String> hack = room.getStudents();
        hack.clear();

        System.out.println("Classroom size: " + room.size());
    }
}
```

**Expected output:**
```
Classroom size: 2
```

**Actual output:**
```
Classroom size: 0
```

<details>
<summary>💡 Hint</summary>

What does `getStudents()` return? A copy or a reference to the internal list?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `getStudents()` returns a direct reference to the private internal list, breaking encapsulation.
**Why it happens:** In Java, objects are passed by reference. Returning the internal list lets external code modify the object's state directly.
**Impact:** Calling `hack.clear()` empties the classroom's internal list, bypassing the intended API.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class Main {
    static class Classroom {
        private List<String> students;

        Classroom() {
            this.students = new ArrayList<>();
        }

        void addStudent(String name) {
            students.add(name);
        }

        // Return an unmodifiable view to protect internal state
        List<String> getStudents() {
            return Collections.unmodifiableList(students);
        }

        int size() {
            return students.size();
        }
    }

    public static void main(String[] args) {
        Classroom room = new Classroom();
        room.addStudent("Alice");
        room.addStudent("Bob");

        List<String> hack = room.getStudents();
        try {
            hack.clear(); // Throws UnsupportedOperationException
        } catch (UnsupportedOperationException e) {
            System.out.println("Cannot modify: " + e.getClass().getSimpleName());
        }

        System.out.println("Classroom size: " + room.size());
    }
}
```

**What changed:** `getStudents()` now returns `Collections.unmodifiableList(students)`, which throws `UnsupportedOperationException` on modification attempts.

</details>

---

## Bug 4: equals Without hashCode 🟡

**What the code should do:** Store a `Point` in a `HashMap` and retrieve its value using an equal `Point` key.

```java
import java.util.HashMap;
import java.util.Map;

public class Main {
    static class Point {
        int x, y;

        Point(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Point p = (Point) o;
            return x == p.x && y == p.y;
        }

        // hashCode is NOT overridden — uses Object.hashCode()
    }

    public static void main(String[] args) {
        Map<Point, String> labels = new HashMap<>();
        labels.put(new Point(1, 2), "Origin Offset");

        Point lookup = new Point(1, 2);
        System.out.println("Found: " + labels.get(lookup));
    }
}
```

**Expected output:**
```
Found: Origin Offset
```

**Actual output:**
```
Found: null
```

<details>
<summary>💡 Hint</summary>

`HashMap` uses `hashCode()` first to find the bucket, then `equals()` to match the key. What happens if two equal objects have different hash codes?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `equals()` is overridden but `hashCode()` is not, violating the equals/hashCode contract (JLS 17, Object.hashCode specification).
**Why it happens:** `HashMap.get()` computes the hash code of the lookup key. Since `Object.hashCode()` returns a different value for each object instance, the lookup key lands in a different bucket than the stored key.
**Impact:** `HashMap`, `HashSet`, and `Hashtable` all fail to find logically equal keys. The map returns `null` even though an equal key exists.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {
    static class Point {
        int x, y;

        Point(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Point p = (Point) o;
            return x == p.x && y == p.y;
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y);
        }
    }

    public static void main(String[] args) {
        Map<Point, String> labels = new HashMap<>();
        labels.put(new Point(1, 2), "Origin Offset");

        Point lookup = new Point(1, 2);
        System.out.println("Found: " + labels.get(lookup));
    }
}
```

**What changed:** Added `hashCode()` override consistent with `equals()`, so equal `Point` objects produce the same hash code and land in the same bucket.

</details>

---

## Bug 5: Constructor Chaining Calls Wrong Super 🟡

**What the code should do:** Create an `Employee` with a name set via the `Person` superclass constructor.

```java
public class Main {
    static class Person {
        String name;

        Person() {
            this.name = "Unknown";
        }

        Person(String name) {
            this.name = name;
        }
    }

    static class Employee extends Person {
        String company;

        Employee(String name, String company) {
            // Bug: forgot to call super(name) — default super() is called
            this.company = company;
        }
    }

    public static void main(String[] args) {
        Employee emp = new Employee("Alice", "TechCorp");
        System.out.println("Name: " + emp.name);
        System.out.println("Company: " + emp.company);
    }
}
```

**Expected output:**
```
Name: Alice
Company: TechCorp
```

**Actual output:**
```
Name: Unknown
Company: TechCorp
```

<details>
<summary>💡 Hint</summary>

When no explicit `super(...)` call is made in a constructor, Java inserts `super()` (no-arg) automatically. Which `Person` constructor runs?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The `Employee` constructor does not explicitly call `super(name)`, so the compiler inserts `super()` which calls `Person()` and sets `name = "Unknown"`.
**Why it happens:** Java always calls a superclass constructor as the first statement. If no explicit `super(...)` is provided, the no-argument constructor is called by default.
**Impact:** The `name` parameter passed to `Employee` is silently ignored — the employee always gets `"Unknown"` as their name.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    static class Person {
        String name;

        Person() {
            this.name = "Unknown";
        }

        Person(String name) {
            this.name = name;
        }
    }

    static class Employee extends Person {
        String company;

        Employee(String name, String company) {
            super(name); // Explicitly call the parameterized constructor
            this.company = company;
        }
    }

    public static void main(String[] args) {
        Employee emp = new Employee("Alice", "TechCorp");
        System.out.println("Name: " + emp.name);
        System.out.println("Company: " + emp.company);
    }
}
```

**What changed:** Added explicit `super(name)` call to forward the name to the `Person(String)` constructor.

</details>

---

## Bug 6: Shallow Copy Shares Mutable Object 🟡

**What the code should do:** Create an independent copy of an `Order` so modifying the copy does not affect the original.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Order {
        String customer;
        List<String> items;

        Order(String customer) {
            this.customer = customer;
            this.items = new ArrayList<>();
        }

        // Shallow copy constructor
        Order(Order other) {
            this.customer = other.customer;
            this.items = other.items; // Bug: copies reference, not the list
        }

        void addItem(String item) {
            items.add(item);
        }
    }

    public static void main(String[] args) {
        Order original = new Order("Alice");
        original.addItem("Laptop");
        original.addItem("Mouse");

        Order copy = new Order(original);
        copy.addItem("Keyboard");

        System.out.println("Original items: " + original.items);
        System.out.println("Copy items: " + copy.items);
    }
}
```

**Expected output:**
```
Original items: [Laptop, Mouse]
Copy items: [Laptop, Mouse, Keyboard]
```

**Actual output:**
```
Original items: [Laptop, Mouse, Keyboard]
Copy items: [Laptop, Mouse, Keyboard]
```

<details>
<summary>💡 Hint</summary>

In the copy constructor, is `this.items` a new list or the same list object as `other.items`?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The copy constructor assigns `this.items = other.items`, which copies the reference, not the list contents (shallow copy).
**Why it happens:** Both `original.items` and `copy.items` point to the same `ArrayList` object in memory. Adding to one modifies both.
**Impact:** Modifying the "copy" unexpectedly changes the original order's items.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    static class Order {
        String customer;
        List<String> items;

        Order(String customer) {
            this.customer = customer;
            this.items = new ArrayList<>();
        }

        // Deep copy constructor — creates a new list with copied contents
        Order(Order other) {
            this.customer = other.customer;
            this.items = new ArrayList<>(other.items); // Deep copy of list
        }

        void addItem(String item) {
            items.add(item);
        }
    }

    public static void main(String[] args) {
        Order original = new Order("Alice");
        original.addItem("Laptop");
        original.addItem("Mouse");

        Order copy = new Order(original);
        copy.addItem("Keyboard");

        System.out.println("Original items: " + original.items);
        System.out.println("Copy items: " + copy.items);
    }
}
```

**What changed:** Used `new ArrayList<>(other.items)` to create a new list with the same elements, ensuring the original and copy have independent item lists.

</details>

---

## Bug 7: Accessing Instance Method from Static Context 🟡

**What the code should do:** Print a greeting message using a helper method.

```java
public class Main {
    String appName = "MyApp";

    String greet(String user) {
        return "Welcome to " + appName + ", " + user + "!";
    }

    public static void main(String[] args) {
        String message = greet("Alice");
        System.out.println(message);
    }
}
```

**Expected output:**
```
Welcome to MyApp, Alice!
```

**Actual output / exception:**
```
error: non-static method greet(String) cannot be referenced from a static context
```

<details>
<summary>💡 Hint</summary>

`main` is `static` — it has no `this` reference. Can it call instance methods or access instance fields directly?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The `greet` method and `appName` field are instance members, but `main` is a static method with no instance.
**Why it happens:** Static methods belong to the class, not to an object. They cannot access instance members because there is no `this` reference.
**Impact:** Compilation error — the code does not compile at all.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
public class Main {
    String appName = "MyApp";

    String greet(String user) {
        return "Welcome to " + appName + ", " + user + "!";
    }

    public static void main(String[] args) {
        // Create an instance to access instance members
        Main app = new Main();
        String message = app.greet("Alice");
        System.out.println(message);
    }
}
```

**What changed:** Created an instance of `Main` and called `greet()` on it, providing the `this` reference needed to access instance members.

</details>

---

## Bug 8: this Reference Leak in Constructor 🔴

**What the code should do:** Register an event listener during construction without exposing a partially constructed object.

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    interface EventListener {
        void onEvent(String event);
    }

    static class EventBus {
        static List<EventListener> listeners = new ArrayList<>();

        static void register(EventListener listener) {
            listeners.add(listener);
        }

        static void fire(String event) {
            for (EventListener l : listeners) {
                l.onEvent(event);
            }
        }
    }

    static class Widget implements EventListener {
        String name;
        int width;
        int height;

        Widget(String name, int width, int height) {
            this.name = name;
            // Bug: leaking 'this' before construction is complete
            EventBus.register(this);
            // Fields below are not yet initialized when 'this' is leaked
            this.width = width;
            this.height = height;
        }

        @Override
        public void onEvent(String event) {
            System.out.println(name + " [" + width + "x" + height + "] received: " + event);
        }
    }

    public static void main(String[] args) {
        // Another thread could fire events during Widget construction
        Thread eventThread = new Thread(() -> {
            try { Thread.sleep(1); } catch (InterruptedException e) {}
            EventBus.fire("RESIZE");
        });
        eventThread.start();

        Widget w = new Widget("Panel", 800, 600);

        try { eventThread.join(); } catch (InterruptedException e) {}
        EventBus.fire("CLICK");
    }
}
```

**Expected output:**
```
Panel [800x600] received: RESIZE
Panel [800x600] received: CLICK
```

**Actual output:**
```
Panel [0x0] received: RESIZE
Panel [800x600] received: CLICK
```

<details>
<summary>💡 Hint</summary>

The `this` reference is passed to `EventBus.register()` before `width` and `height` are assigned. If another thread fires an event immediately, what values will it see?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** The `this` reference escapes the constructor before the object is fully initialized (known as "this reference leak").
**Why it happens:** `EventBus.register(this)` is called after `name` is set but before `width` and `height` are assigned. If another thread invokes `onEvent()` during this window, it sees default values (`0`).
**Impact:** A partially constructed object is observable by external code, leading to wrong dimension values. In more complex scenarios this can cause NullPointerExceptions or inconsistent state.
**JVM spec reference:** Java Memory Model (JLS 17.5) — final fields are only guaranteed visible after construction completes.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {
    interface EventListener {
        void onEvent(String event);
    }

    static class EventBus {
        static List<EventListener> listeners = new ArrayList<>();

        static void register(EventListener listener) {
            listeners.add(listener);
        }

        static void fire(String event) {
            for (EventListener l : listeners) {
                l.onEvent(event);
            }
        }
    }

    static class Widget implements EventListener {
        String name;
        int width;
        int height;

        // Private constructor — does not leak 'this'
        private Widget(String name, int width, int height) {
            this.name = name;
            this.width = width;
            this.height = height;
        }

        // Factory method registers only after full construction
        static Widget create(String name, int width, int height) {
            Widget w = new Widget(name, width, height);
            EventBus.register(w); // Safe: object is fully constructed
            return w;
        }

        @Override
        public void onEvent(String event) {
            System.out.println(name + " [" + width + "x" + height + "] received: " + event);
        }
    }

    public static void main(String[] args) {
        Thread eventThread = new Thread(() -> {
            try { Thread.sleep(1); } catch (InterruptedException e) {}
            EventBus.fire("RESIZE");
        });
        eventThread.start();

        Widget w = Widget.create("Panel", 800, 600);

        try { eventThread.join(); } catch (InterruptedException e) {}
        EventBus.fire("CLICK");
    }
}
```

**What changed:** Moved `EventBus.register()` out of the constructor into a static factory method `create()`, ensuring the object is fully initialized before its reference escapes.
**Alternative fix:** Initialize all fields before the `register()` call within the constructor (simpler but less safe in complex hierarchies).

</details>

---

## Bug 9: Mutable Key in HashMap After Insertion 🔴

**What the code should do:** Store a `Coordinate` in a `HashMap`, mutate the coordinate, and still find it in the map.

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {
    static class Coordinate {
        int x, y;

        Coordinate(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Coordinate c = (Coordinate) o;
            return x == c.x && y == c.y;
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y);
        }
    }

    public static void main(String[] args) {
        Map<Coordinate, String> map = new HashMap<>();
        Coordinate key = new Coordinate(10, 20);
        map.put(key, "Treasure");

        System.out.println("Before mutation: " + map.get(new Coordinate(10, 20)));

        // Mutate the key after it was inserted
        key.x = 99;

        System.out.println("After mutation (old key): " + map.get(new Coordinate(10, 20)));
        System.out.println("After mutation (new key): " + map.get(new Coordinate(99, 20)));
        System.out.println("Map size: " + map.size());
    }
}
```

**Expected output:**
```
Before mutation: Treasure
After mutation (old key): null
After mutation (new key): Treasure
Map size: 1
```

**Actual output:**
```
Before mutation: Treasure
After mutation (old key): null
After mutation (new key): null
Map size: 1
```

<details>
<summary>💡 Hint</summary>

When `key.x` changes, the hash code changes too. But the entry is still stored in the bucket computed from the *original* hash code. What bucket does the new lookup hit?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** Mutating a key object after it has been inserted into a `HashMap` corrupts the map. The entry is in the bucket for hash of `(10, 20)`, but lookups for `(99, 20)` check the bucket for hash of `(99, 20)`.
**Why it happens:** `HashMap` stores entries based on the hash code computed at insertion time. Mutating the key changes its hash code, but the entry is not moved to the new bucket.
**Impact:** The entry becomes unreachable — neither the old key values nor the new key values can find it. The entry is a "ghost" that counts toward size but can never be retrieved.
**How to detect:** `map.size()` reports 1, but no `get()` returns the value. This is a classic memory leak pattern.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {
    // Make the key class immutable
    static final class Coordinate {
        private final int x, y;

        Coordinate(int x, int y) {
            this.x = x;
            this.y = y;
        }

        int getX() { return x; }
        int getY() { return y; }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Coordinate c = (Coordinate) o;
            return x == c.x && y == c.y;
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y);
        }
    }

    public static void main(String[] args) {
        Map<Coordinate, String> map = new HashMap<>();
        Coordinate key = new Coordinate(10, 20);
        map.put(key, "Treasure");

        System.out.println("Lookup: " + map.get(new Coordinate(10, 20)));
        // key.x = 99; // Compile error — field is final
        System.out.println("Map size: " + map.size());
    }
}
```

**What changed:** Made `Coordinate` immutable (`final` class, `private final` fields, no setters) so the hash code can never change after insertion.

</details>

---

## Bug 10: equals Breaks Symmetry with Inheritance 🔴

**What the code should do:** `ColorPoint.equals(Point)` and `Point.equals(ColorPoint)` should behave consistently.

```java
import java.util.Objects;

public class Main {
    static class Point {
        int x, y;

        Point(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Point)) return false;
            Point p = (Point) o;
            return x == p.x && y == p.y;
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y);
        }
    }

    static class ColorPoint extends Point {
        String color;

        ColorPoint(int x, int y, String color) {
            super(x, y);
            this.color = color;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof ColorPoint)) return false;
            ColorPoint cp = (ColorPoint) o;
            return super.equals(cp) && Objects.equals(color, cp.color);
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y, color);
        }
    }

    public static void main(String[] args) {
        Point p = new Point(1, 2);
        ColorPoint cp = new ColorPoint(1, 2, "RED");

        System.out.println("p.equals(cp):  " + p.equals(cp));   // true — Point ignores color
        System.out.println("cp.equals(p):  " + cp.equals(p));   // false — ColorPoint checks instanceof ColorPoint
        System.out.println("Symmetric? " + (p.equals(cp) == cp.equals(p)));
    }
}
```

**Expected output:**
```
p.equals(cp):  true
cp.equals(p):  true
Symmetric? true
```

**Actual output:**
```
p.equals(cp):  true
cp.equals(p):  false
Symmetric? false
```

<details>
<summary>💡 Hint</summary>

The `equals` contract (JLS) requires symmetry: `a.equals(b)` must equal `b.equals(a)`. How does `instanceof` behave differently in a parent vs a child class?

</details>

<details>
<summary>🐛 Bug Explanation</summary>

**Bug:** `Point.equals()` uses `instanceof Point`, which accepts `ColorPoint` (a subclass). But `ColorPoint.equals()` uses `instanceof ColorPoint`, which rejects `Point`. This breaks the symmetry requirement of the `equals` contract.
**Why it happens:** `instanceof` is asymmetric across class hierarchies. A `ColorPoint` is a `Point`, but a `Point` is not a `ColorPoint`.
**Impact:** Violating symmetry causes unpredictable behavior in collections. For example, `Set.contains()` may return different results depending on which object is already in the set. This is the classic Liskov Substitution Principle / equals contract problem described in "Effective Java" Item 10.

</details>

<details>
<summary>✅ Fixed Code</summary>

```java
import java.util.Objects;

public class Main {
    static class Point {
        int x, y;

        Point(int x, int y) {
            this.x = x;
            this.y = y;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            // Use getClass() instead of instanceof for strict type matching
            if (o == null || getClass() != o.getClass()) return false;
            Point p = (Point) o;
            return x == p.x && y == p.y;
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y);
        }
    }

    static class ColorPoint extends Point {
        String color;

        ColorPoint(int x, int y, String color) {
            super(x, y);
            this.color = color;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            ColorPoint cp = (ColorPoint) o;
            return super.equals(cp) && Objects.equals(color, cp.color);
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y, color);
        }
    }

    public static void main(String[] args) {
        Point p = new Point(1, 2);
        ColorPoint cp = new ColorPoint(1, 2, "RED");

        System.out.println("p.equals(cp):  " + p.equals(cp));
        System.out.println("cp.equals(p):  " + cp.equals(p));
        System.out.println("Symmetric? " + (p.equals(cp) == cp.equals(p)));

        ColorPoint cp2 = new ColorPoint(1, 2, "RED");
        System.out.println("cp.equals(cp2): " + cp.equals(cp2));
    }
}
```

**What changed:** Replaced `instanceof` with `getClass()` comparison in both `Point.equals()` and `ColorPoint.equals()`. Now a `Point` is never equal to a `ColorPoint` (and vice versa), preserving symmetry.
**Alternative fix:** Use composition instead of inheritance — `ColorPoint` holds a `Point` field rather than extending `Point`.

</details>

---

## Score Card

Track your progress:

| Bug | Difficulty | Found without hint? | Understood why? | Fixed correctly? |
|:---:|:---------:|:-------------------:|:---------------:|:----------------:|
| 1 | 🟢 | ☐ | ☐ | ☐ |
| 2 | 🟢 | ☐ | ☐ | ☐ |
| 3 | 🟢 | ☐ | ☐ | ☐ |
| 4 | 🟡 | ☐ | ☐ | ☐ |
| 5 | 🟡 | ☐ | ☐ | ☐ |
| 6 | 🟡 | ☐ | ☐ | ☐ |
| 7 | 🟡 | ☐ | ☐ | ☐ |
| 8 | 🔴 | ☐ | ☐ | ☐ |
| 9 | 🔴 | ☐ | ☐ | ☐ |
| 10 | 🔴 | ☐ | ☐ | ☐ |

### Rating:
- **10/10 without hints** → Senior-level Java OOP debugging skills
- **7-9/10** → Solid middle-level understanding
- **4-6/10** → Good junior, keep practicing
- **< 4/10** → Review OOP fundamentals first
