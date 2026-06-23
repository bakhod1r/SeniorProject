# Java OOP Basics — Practical Tasks

---

## Junior Tasks (4)

### Task 1: Create a Simple Class and Object

**Difficulty:** Easy
**Estimated time:** 15 minutes

Create a `Car` class with fields for brand, model, and year. Instantiate two car objects and print their details.

**Requirements:**
- Define private fields: `brand` (String), `model` (String), `year` (int)
- Create a constructor that accepts all three fields
- Create getter methods for each field
- Create a `toString()` method that returns a formatted string
- Instantiate two different cars and print them

**Starter code:**

```java
public class Main {
    // TODO: Define the Car class with private fields, constructor, getters, and toString()

    public static void main(String[] args) {
        // TODO: Create two Car objects and print them
    }
}
```

**Expected output:**
```
Car{brand='Toyota', model='Camry', year=2022}
Car{brand='Honda', model='Civic', year=2023}
```

<details>
<summary>Solution</summary>

```java
public class Main {

    static class Car {
        private String brand;
        private String model;
        private int year;

        public Car(String brand, String model, int year) {
            this.brand = brand;
            this.model = model;
            this.year = year;
        }

        public String getBrand() {
            return brand;
        }

        public String getModel() {
            return model;
        }

        public int getYear() {
            return year;
        }

        @Override
        public String toString() {
            return "Car{brand='" + brand + "', model='" + model + "', year=" + year + "}";
        }
    }

    public static void main(String[] args) {
        Car car1 = new Car("Toyota", "Camry", 2022);
        Car car2 = new Car("Honda", "Civic", 2023);

        System.out.println(car1);
        System.out.println(car2);
    }
}
```
</details>

---

### Task 2: Constructors and Constructor Overloading

**Difficulty:** Easy
**Estimated time:** 20 minutes

Create a `Student` class that demonstrates constructor overloading: a no-arg constructor (with defaults), a partial constructor (name only), and a full constructor.

**Requirements:**
- Define private fields: `name` (String), `age` (int), `gpa` (double)
- No-arg constructor sets defaults: name="Unknown", age=0, gpa=0.0
- One-arg constructor takes name, sets age=18 and gpa=0.0
- Full constructor takes all three fields
- Use `this()` constructor chaining where possible
- Add a `displayInfo()` method that prints all fields

**Starter code:**

```java
public class Main {

    static class Student {
        private String name;
        private int age;
        private double gpa;

        // TODO: No-arg constructor (defaults)
        // TODO: One-arg constructor (name only)
        // TODO: Full constructor (all fields)

        public void displayInfo() {
            // TODO: Print student info
        }
    }

    public static void main(String[] args) {
        Student s1 = new Student();
        Student s2 = new Student("Alice");
        Student s3 = new Student("Bob", 21, 3.8);

        s1.displayInfo();
        s2.displayInfo();
        s3.displayInfo();
    }
}
```

**Expected output:**
```
Student{name='Unknown', age=0, gpa=0.00}
Student{name='Alice', age=18, gpa=0.00}
Student{name='Bob', age=21, gpa=3.80}
```

<details>
<summary>Solution</summary>

```java
public class Main {

    static class Student {
        private String name;
        private int age;
        private double gpa;

        public Student() {
            this("Unknown", 0, 0.0);
        }

        public Student(String name) {
            this(name, 18, 0.0);
        }

        public Student(String name, int age, double gpa) {
            this.name = name;
            this.age = age;
            this.gpa = gpa;
        }

        public void displayInfo() {
            System.out.printf("Student{name='%s', age=%d, gpa=%.2f}%n", name, age, gpa);
        }
    }

    public static void main(String[] args) {
        Student s1 = new Student();
        Student s2 = new Student("Alice");
        Student s3 = new Student("Bob", 21, 3.8);

        s1.displayInfo();
        s2.displayInfo();
        s3.displayInfo();
    }
}
```
</details>

---

### Task 3: Access Modifiers and Encapsulation

**Difficulty:** Easy
**Estimated time:** 20 minutes

Create a `BankAccount` class that properly encapsulates its data. The balance should never be directly accessible or set to a negative value.

**Requirements:**
- Private fields: `owner` (String), `balance` (double)
- Constructor takes owner name and initial balance (reject negative initial balance)
- `deposit(double amount)` — adds to balance (reject non-positive amounts)
- `withdraw(double amount)` — subtracts from balance (reject if insufficient funds or non-positive)
- `getBalance()` — returns current balance
- `getOwner()` — returns owner name
- All validation should print error messages, not throw exceptions

**Starter code:**

```java
public class Main {

    static class BankAccount {
        // TODO: Private fields

        // TODO: Constructor with validation

        // TODO: deposit() with validation

        // TODO: withdraw() with validation

        // TODO: Getters
    }

    public static void main(String[] args) {
        BankAccount account = new BankAccount("Alice", 1000.0);
        System.out.println(account.getOwner() + "'s balance: $" + account.getBalance());

        account.deposit(500.0);
        System.out.println("After deposit: $" + account.getBalance());

        account.withdraw(200.0);
        System.out.println("After withdrawal: $" + account.getBalance());

        account.withdraw(5000.0);  // Should print error
        account.deposit(-100.0);   // Should print error
    }
}
```

**Expected output:**
```
Alice's balance: $1000.0
After deposit: $1500.0
After withdrawal: $1300.0
Error: Insufficient funds. Current balance: $1300.0
Error: Deposit amount must be positive.
```

<details>
<summary>Solution</summary>

```java
public class Main {

    static class BankAccount {
        private String owner;
        private double balance;

        public BankAccount(String owner, double initialBalance) {
            this.owner = owner;
            if (initialBalance < 0) {
                System.out.println("Error: Initial balance cannot be negative. Setting to 0.");
                this.balance = 0;
            } else {
                this.balance = initialBalance;
            }
        }

        public void deposit(double amount) {
            if (amount <= 0) {
                System.out.println("Error: Deposit amount must be positive.");
                return;
            }
            balance += amount;
        }

        public void withdraw(double amount) {
            if (amount <= 0) {
                System.out.println("Error: Withdrawal amount must be positive.");
                return;
            }
            if (amount > balance) {
                System.out.println("Error: Insufficient funds. Current balance: $" + balance);
                return;
            }
            balance -= amount;
        }

        public double getBalance() {
            return balance;
        }

        public String getOwner() {
            return owner;
        }
    }

    public static void main(String[] args) {
        BankAccount account = new BankAccount("Alice", 1000.0);
        System.out.println(account.getOwner() + "'s balance: $" + account.getBalance());

        account.deposit(500.0);
        System.out.println("After deposit: $" + account.getBalance());

        account.withdraw(200.0);
        System.out.println("After withdrawal: $" + account.getBalance());

        account.withdraw(5000.0);
        account.deposit(-100.0);
    }
}
```
</details>

---

### Task 4: Static Fields, Static Methods, and Instance Counter

**Difficulty:** Easy-Medium
**Estimated time:** 20 minutes

Create a `User` class that tracks the total number of user instances created using a static field and provides a static method to retrieve the count.

**Requirements:**
- Private fields: `id` (int), `username` (String)
- A private static field `userCount` initialized to 0
- Constructor auto-assigns `id` from `userCount` and increments the counter
- Static method `getUserCount()` returns how many users have been created
- Static method `resetCount()` resets the counter to 0
- Instance method `getInfo()` returns formatted string

**Starter code:**

```java
public class Main {

    static class User {
        // TODO: Private fields (instance and static)

        // TODO: Constructor that auto-assigns ID

        // TODO: Static methods: getUserCount(), resetCount()

        // TODO: Instance method: getInfo()
    }

    public static void main(String[] args) {
        System.out.println("Users created: " + User.getUserCount());

        User u1 = new User("alice");
        User u2 = new User("bob");
        User u3 = new User("charlie");

        System.out.println(u1.getInfo());
        System.out.println(u2.getInfo());
        System.out.println(u3.getInfo());
        System.out.println("Users created: " + User.getUserCount());

        User.resetCount();
        System.out.println("After reset: " + User.getUserCount());

        User u4 = new User("dave");
        System.out.println(u4.getInfo());
        System.out.println("Users created: " + User.getUserCount());
    }
}
```

**Expected output:**
```
Users created: 0
User{id=1, username='alice'}
User{id=2, username='bob'}
User{id=3, username='charlie'}
Users created: 3
After reset: 0
User{id=1, username='dave'}
Users created: 1
```

<details>
<summary>Solution</summary>

```java
public class Main {

    static class User {
        private int id;
        private String username;
        private static int userCount = 0;

        public User(String username) {
            userCount++;
            this.id = userCount;
            this.username = username;
        }

        public static int getUserCount() {
            return userCount;
        }

        public static void resetCount() {
            userCount = 0;
        }

        public String getInfo() {
            return "User{id=" + id + ", username='" + username + "'}";
        }
    }

    public static void main(String[] args) {
        System.out.println("Users created: " + User.getUserCount());

        User u1 = new User("alice");
        User u2 = new User("bob");
        User u3 = new User("charlie");

        System.out.println(u1.getInfo());
        System.out.println(u2.getInfo());
        System.out.println(u3.getInfo());
        System.out.println("Users created: " + User.getUserCount());

        User.resetCount();
        System.out.println("After reset: " + User.getUserCount());

        User u4 = new User("dave");
        System.out.println(u4.getInfo());
        System.out.println("Users created: " + User.getUserCount());
    }
}
```
</details>

---

## Middle Tasks (3)

### Task 5: Implement equals() and hashCode() for a Value Object

**Difficulty:** Medium
**Estimated time:** 30 minutes

Create a `Money` value object class where two `Money` instances are considered equal if they have the same amount and currency. Use this class as a key in a `HashMap`.

**Requirements:**
- Private fields: `amount` (double), `currency` (String)
- Constructor, getters (no setters — immutable)
- Override `equals()` following the contract: reflexive, symmetric, transitive, null-safe, type-safe
- Override `hashCode()` consistently with `equals()`
- Override `toString()`
- Demonstrate correctness by using `Money` as a `HashMap` key

**Starter code:**

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {

    static class Money {
        private final double amount;
        private final String currency;

        public Money(double amount, String currency) {
            this.amount = amount;
            this.currency = currency;
        }

        public double getAmount() { return amount; }
        public String getCurrency() { return currency; }

        // TODO: Override equals()

        // TODO: Override hashCode()

        // TODO: Override toString()
    }

    public static void main(String[] args) {
        Money m1 = new Money(100.0, "USD");
        Money m2 = new Money(100.0, "USD");
        Money m3 = new Money(200.0, "USD");
        Money m4 = new Money(100.0, "EUR");

        // Test equals
        System.out.println("m1.equals(m2): " + m1.equals(m2)); // true
        System.out.println("m1.equals(m3): " + m1.equals(m3)); // false
        System.out.println("m1.equals(m4): " + m1.equals(m4)); // false
        System.out.println("m1.equals(null): " + m1.equals(null)); // false

        // Test hashCode consistency
        System.out.println("m1.hashCode() == m2.hashCode(): " + (m1.hashCode() == m2.hashCode())); // true

        // Test as HashMap key
        Map<Money, String> descriptions = new HashMap<>();
        descriptions.put(m1, "One hundred dollars");
        System.out.println("Get with m2 key: " + descriptions.get(m2)); // Should find it
        System.out.println("Get with m3 key: " + descriptions.get(m3)); // null
    }
}
```

**Expected output:**
```
m1.equals(m2): true
m1.equals(m3): false
m1.equals(m4): false
m1.equals(null): false
m1.hashCode() == m2.hashCode(): true
Get with m2 key: One hundred dollars
Get with m3 key: null
```

<details>
<summary>Solution</summary>

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public class Main {

    static class Money {
        private final double amount;
        private final String currency;

        public Money(double amount, String currency) {
            this.amount = amount;
            this.currency = currency;
        }

        public double getAmount() { return amount; }
        public String getCurrency() { return currency; }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Money money = (Money) o;
            return Double.compare(money.amount, amount) == 0
                    && Objects.equals(currency, money.currency);
        }

        @Override
        public int hashCode() {
            return Objects.hash(amount, currency);
        }

        @Override
        public String toString() {
            return "Money{amount=" + amount + ", currency='" + currency + "'}";
        }
    }

    public static void main(String[] args) {
        Money m1 = new Money(100.0, "USD");
        Money m2 = new Money(100.0, "USD");
        Money m3 = new Money(200.0, "USD");
        Money m4 = new Money(100.0, "EUR");

        System.out.println("m1.equals(m2): " + m1.equals(m2));
        System.out.println("m1.equals(m3): " + m1.equals(m3));
        System.out.println("m1.equals(m4): " + m1.equals(m4));
        System.out.println("m1.equals(null): " + m1.equals(null));

        System.out.println("m1.hashCode() == m2.hashCode(): " + (m1.hashCode() == m2.hashCode()));

        Map<Money, String> descriptions = new HashMap<>();
        descriptions.put(m1, "One hundred dollars");
        System.out.println("Get with m2 key: " + descriptions.get(m2));
        System.out.println("Get with m3 key: " + descriptions.get(m3));
    }
}
```
</details>

---

### Task 6: Encapsulated Collection — Defensive Copying

**Difficulty:** Medium
**Estimated time:** 35 minutes

Create a `Classroom` class that holds a list of students. Ensure the internal list cannot be modified from outside (defensive copying in getter and constructor).

**Requirements:**
- Private field: `students` (List<String>), `className` (String)
- Constructor takes className and a list of students — must make a defensive copy
- `getStudents()` returns a defensive copy (not the internal list)
- `addStudent(String name)` adds a student with validation (non-null, non-empty)
- `removeStudent(String name)` removes a student if present, returns boolean
- `getStudentCount()` returns the size
- Demonstrate that external modifications do not affect internal state

**Starter code:**

```java
import java.util.ArrayList;
import java.util.List;

public class Main {

    static class Classroom {
        private final String className;
        private final List<String> students;

        // TODO: Constructor with defensive copy

        // TODO: getStudents() with defensive copy

        // TODO: addStudent(), removeStudent(), getStudentCount()

        public String getClassName() { return className; }
    }

    public static void main(String[] args) {
        List<String> initial = new ArrayList<>();
        initial.add("Alice");
        initial.add("Bob");

        Classroom room = new Classroom("CS101", initial);

        // Modify original list — should NOT affect classroom
        initial.add("HACKER");
        System.out.println("Count after external add: " + room.getStudentCount()); // 2

        // Modify returned list — should NOT affect classroom
        List<String> retrieved = room.getStudents();
        retrieved.add("HACKER2");
        System.out.println("Count after getter modification: " + room.getStudentCount()); // 2

        // Use proper methods
        room.addStudent("Charlie");
        System.out.println("Count after addStudent: " + room.getStudentCount()); // 3

        boolean removed = room.removeStudent("Bob");
        System.out.println("Removed Bob: " + removed); // true
        System.out.println("Final students: " + room.getStudents()); // [Alice, Charlie]

        // Validation
        room.addStudent(null);   // Should print error
        room.addStudent("");     // Should print error
    }
}
```

**Expected output:**
```
Count after external add: 2
Count after getter modification: 2
Count after addStudent: 3
Removed Bob: true
Final students: [Alice, Charlie]
Error: Student name cannot be null or empty.
Error: Student name cannot be null or empty.
```

<details>
<summary>Solution</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {

    static class Classroom {
        private final String className;
        private final List<String> students;

        public Classroom(String className, List<String> students) {
            this.className = className;
            this.students = new ArrayList<>(students); // defensive copy
        }

        public List<String> getStudents() {
            return new ArrayList<>(students); // defensive copy
        }

        public void addStudent(String name) {
            if (name == null || name.trim().isEmpty()) {
                System.out.println("Error: Student name cannot be null or empty.");
                return;
            }
            students.add(name);
        }

        public boolean removeStudent(String name) {
            return students.remove(name);
        }

        public int getStudentCount() {
            return students.size();
        }

        public String getClassName() { return className; }
    }

    public static void main(String[] args) {
        List<String> initial = new ArrayList<>();
        initial.add("Alice");
        initial.add("Bob");

        Classroom room = new Classroom("CS101", initial);

        initial.add("HACKER");
        System.out.println("Count after external add: " + room.getStudentCount());

        List<String> retrieved = room.getStudents();
        retrieved.add("HACKER2");
        System.out.println("Count after getter modification: " + room.getStudentCount());

        room.addStudent("Charlie");
        System.out.println("Count after addStudent: " + room.getStudentCount());

        boolean removed = room.removeStudent("Bob");
        System.out.println("Removed Bob: " + removed);
        System.out.println("Final students: " + room.getStudents());

        room.addStudent(null);
        room.addStudent("");
    }
}
```
</details>

---

### Task 7: Builder Pattern with Fluent API

**Difficulty:** Medium
**Estimated time:** 35 minutes

Implement a `Pizza` class using the Builder pattern. The pizza should have required fields (size) and optional fields (cheese, pepperoni, mushrooms, onions).

**Requirements:**
- `Pizza` class is immutable (all fields final, no setters)
- Nested static `Builder` class with fluent API (method chaining)
- `size` is required (set in Builder constructor)
- Optional toppings: `cheese` (boolean), `pepperoni` (boolean), `mushrooms` (boolean), `onions` (boolean)
- `Builder.build()` returns a new `Pizza`
- `Pizza.toString()` lists the size and all selected toppings

**Starter code:**

```java
public class Main {

    static class Pizza {
        private final String size;
        private final boolean cheese;
        private final boolean pepperoni;
        private final boolean mushrooms;
        private final boolean onions;

        // TODO: Private constructor taking Builder

        // TODO: toString()

        // TODO: Static Builder class with fluent API
    }

    public static void main(String[] args) {
        Pizza pizza1 = new Pizza.Builder("Large")
                .cheese(true)
                .pepperoni(true)
                .mushrooms(true)
                .build();

        Pizza pizza2 = new Pizza.Builder("Medium")
                .cheese(true)
                .build();

        Pizza pizza3 = new Pizza.Builder("Small")
                .build();

        System.out.println(pizza1);
        System.out.println(pizza2);
        System.out.println(pizza3);
    }
}
```

**Expected output:**
```
Pizza{size='Large', toppings=[cheese, pepperoni, mushrooms]}
Pizza{size='Medium', toppings=[cheese]}
Pizza{size='Small', toppings=[]}
```

<details>
<summary>Solution</summary>

```java
import java.util.ArrayList;
import java.util.List;

public class Main {

    static class Pizza {
        private final String size;
        private final boolean cheese;
        private final boolean pepperoni;
        private final boolean mushrooms;
        private final boolean onions;

        private Pizza(Builder builder) {
            this.size = builder.size;
            this.cheese = builder.cheese;
            this.pepperoni = builder.pepperoni;
            this.mushrooms = builder.mushrooms;
            this.onions = builder.onions;
        }

        @Override
        public String toString() {
            List<String> toppings = new ArrayList<>();
            if (cheese) toppings.add("cheese");
            if (pepperoni) toppings.add("pepperoni");
            if (mushrooms) toppings.add("mushrooms");
            if (onions) toppings.add("onions");
            return "Pizza{size='" + size + "', toppings=" + toppings + "}";
        }

        static class Builder {
            private final String size;
            private boolean cheese;
            private boolean pepperoni;
            private boolean mushrooms;
            private boolean onions;

            public Builder(String size) {
                this.size = size;
            }

            public Builder cheese(boolean value) {
                this.cheese = value;
                return this;
            }

            public Builder pepperoni(boolean value) {
                this.pepperoni = value;
                return this;
            }

            public Builder mushrooms(boolean value) {
                this.mushrooms = value;
                return this;
            }

            public Builder onions(boolean value) {
                this.onions = value;
                return this;
            }

            public Pizza build() {
                return new Pizza(this);
            }
        }
    }

    public static void main(String[] args) {
        Pizza pizza1 = new Pizza.Builder("Large")
                .cheese(true)
                .pepperoni(true)
                .mushrooms(true)
                .build();

        Pizza pizza2 = new Pizza.Builder("Medium")
                .cheese(true)
                .build();

        Pizza pizza3 = new Pizza.Builder("Small")
                .build();

        System.out.println(pizza1);
        System.out.println(pizza2);
        System.out.println(pizza3);
    }
}
```
</details>

---

## Senior Tasks (3)

### Task 8: Generic Immutable Pair with Proper equals/hashCode

**Difficulty:** Hard
**Estimated time:** 40 minutes

Create a generic `Pair<A, B>` class that is fully immutable, implements `equals()`, `hashCode()`, `toString()`, and is `Comparable` when both type parameters are `Comparable`. Then demonstrate it in a sorted collection.

**Requirements:**
- Generic class `Pair<A, B>` with final fields
- Implements `Comparable<Pair<A, B>>` when both A and B are Comparable (use bounded type)
- Proper `equals()` and `hashCode()` with generic type handling
- Static factory method `of(A a, B b)` for convenience
- Demonstrate: create pairs, put in a TreeSet (sorted), use as HashMap keys
- Demonstrate that Pair is truly immutable — if A or B are mutable types, document the limitation

**Starter code:**

```java
import java.util.*;

public class Main {

    // TODO: Implement Pair<A, B> that is Comparable when A and B are Comparable

    public static void main(String[] args) {
        // Basic usage
        Pair<String, Integer> p1 = Pair.of("Alice", 90);
        Pair<String, Integer> p2 = Pair.of("Alice", 90);
        Pair<String, Integer> p3 = Pair.of("Bob", 85);

        System.out.println("p1: " + p1);
        System.out.println("p1.equals(p2): " + p1.equals(p2));
        System.out.println("p1.equals(p3): " + p1.equals(p3));

        // As HashMap key
        Map<Pair<String, Integer>, String> grades = new HashMap<>();
        grades.put(p1, "Excellent");
        System.out.println("Lookup p2: " + grades.get(p2));

        // Sorted in TreeSet
        TreeSet<Pair<String, Integer>> sorted = new TreeSet<>();
        sorted.add(Pair.of("Charlie", 70));
        sorted.add(Pair.of("Alice", 90));
        sorted.add(Pair.of("Alice", 85));
        sorted.add(Pair.of("Bob", 85));

        System.out.println("Sorted pairs:");
        for (Pair<String, Integer> p : sorted) {
            System.out.println("  " + p);
        }
    }
}
```

**Expected output:**
```
p1: (Alice, 90)
p1.equals(p2): true
p1.equals(p3): false
Lookup p2: Excellent
Sorted pairs:
  (Alice, 85)
  (Alice, 90)
  (Bob, 85)
  (Charlie, 70)
```

<details>
<summary>Solution</summary>

```java
import java.util.*;

public class Main {

    static class Pair<A extends Comparable<A>, B extends Comparable<B>>
            implements Comparable<Pair<A, B>> {

        private final A first;
        private final B second;

        private Pair(A first, B second) {
            this.first = first;
            this.second = second;
        }

        public static <A extends Comparable<A>, B extends Comparable<B>>
                Pair<A, B> of(A first, B second) {
            return new Pair<>(first, second);
        }

        public A getFirst() { return first; }
        public B getSecond() { return second; }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            Pair<?, ?> pair = (Pair<?, ?>) o;
            return Objects.equals(first, pair.first)
                    && Objects.equals(second, pair.second);
        }

        @Override
        public int hashCode() {
            return Objects.hash(first, second);
        }

        @Override
        public String toString() {
            return "(" + first + ", " + second + ")";
        }

        @Override
        public int compareTo(Pair<A, B> other) {
            int cmp = this.first.compareTo(other.first);
            if (cmp != 0) return cmp;
            return this.second.compareTo(other.second);
        }
    }

    public static void main(String[] args) {
        Pair<String, Integer> p1 = Pair.of("Alice", 90);
        Pair<String, Integer> p2 = Pair.of("Alice", 90);
        Pair<String, Integer> p3 = Pair.of("Bob", 85);

        System.out.println("p1: " + p1);
        System.out.println("p1.equals(p2): " + p1.equals(p2));
        System.out.println("p1.equals(p3): " + p1.equals(p3));

        Map<Pair<String, Integer>, String> grades = new HashMap<>();
        grades.put(p1, "Excellent");
        System.out.println("Lookup p2: " + grades.get(p2));

        TreeSet<Pair<String, Integer>> sorted = new TreeSet<>();
        sorted.add(Pair.of("Charlie", 70));
        sorted.add(Pair.of("Alice", 90));
        sorted.add(Pair.of("Alice", 85));
        sorted.add(Pair.of("Bob", 85));

        System.out.println("Sorted pairs:");
        for (Pair<String, Integer> p : sorted) {
            System.out.println("  " + p);
        }
    }
}
```
</details>

---

### Task 9: Design a Type-Safe Registry with Static Factory and Encapsulation

**Difficulty:** Hard
**Estimated time:** 45 minutes

Design a `ServiceRegistry` that maps service names to singleton instances. It should prevent duplicate registration, support retrieval by name, and provide an unmodifiable view of all registered services.

**Requirements:**
- `ServiceRegistry` uses a private static `Map<String, Object>` internally
- Private constructor (cannot be instantiated — utility class)
- `register(String name, Object service)` — registers a service; throws `IllegalArgumentException` if name already registered or arguments are null
- `get(String name, Class<T> type)` — returns the service cast to the given type, throws `IllegalArgumentException` if not found or wrong type
- `getRegisteredNames()` — returns an unmodifiable set of registered names
- `reset()` — clears all registrations (useful for testing)
- Demonstrate with at least 2 different service types

**Starter code:**

```java
import java.util.*;

public class Main {

    // Example services
    static class EmailService {
        private final String smtpHost;
        public EmailService(String smtpHost) { this.smtpHost = smtpHost; }
        public void send(String to, String msg) {
            System.out.println("Sending email via " + smtpHost + " to " + to + ": " + msg);
        }
    }

    static class LoggingService {
        private final String level;
        public LoggingService(String level) { this.level = level; }
        public void log(String message) {
            System.out.println("[" + level + "] " + message);
        }
    }

    // TODO: Implement ServiceRegistry

    public static void main(String[] args) {
        ServiceRegistry.register("email", new EmailService("smtp.example.com"));
        ServiceRegistry.register("logger", new LoggingService("INFO"));

        // Type-safe retrieval
        EmailService email = ServiceRegistry.get("email", EmailService.class);
        email.send("bob@test.com", "Hello!");

        LoggingService logger = ServiceRegistry.get("logger", LoggingService.class);
        logger.log("Application started");

        // List all services
        System.out.println("Registered services: " + ServiceRegistry.getRegisteredNames());

        // Error cases
        try {
            ServiceRegistry.register("email", new EmailService("other.host"));
        } catch (IllegalArgumentException e) {
            System.out.println("Error: " + e.getMessage());
        }

        try {
            ServiceRegistry.get("email", LoggingService.class);
        } catch (IllegalArgumentException e) {
            System.out.println("Error: " + e.getMessage());
        }

        try {
            ServiceRegistry.get("unknown", Object.class);
        } catch (IllegalArgumentException e) {
            System.out.println("Error: " + e.getMessage());
        }

        ServiceRegistry.reset();
        System.out.println("After reset: " + ServiceRegistry.getRegisteredNames());
    }
}
```

**Expected output:**
```
Sending email via smtp.example.com to bob@test.com: Hello!
[INFO] Application started
Registered services: [email, logger]
Error: Service already registered: email
Error: Service 'email' is not of type LoggingService
Error: Service not found: unknown
After reset: []
```

<details>
<summary>Solution</summary>

```java
import java.util.*;

public class Main {

    static class EmailService {
        private final String smtpHost;
        public EmailService(String smtpHost) { this.smtpHost = smtpHost; }
        public void send(String to, String msg) {
            System.out.println("Sending email via " + smtpHost + " to " + to + ": " + msg);
        }
    }

    static class LoggingService {
        private final String level;
        public LoggingService(String level) { this.level = level; }
        public void log(String message) {
            System.out.println("[" + level + "] " + message);
        }
    }

    static class ServiceRegistry {
        private static final Map<String, Object> services = new HashMap<>();

        private ServiceRegistry() {
            throw new UnsupportedOperationException("Utility class");
        }

        public static void register(String name, Object service) {
            if (name == null || service == null) {
                throw new IllegalArgumentException("Name and service must not be null");
            }
            if (services.containsKey(name)) {
                throw new IllegalArgumentException("Service already registered: " + name);
            }
            services.put(name, service);
        }

        @SuppressWarnings("unchecked")
        public static <T> T get(String name, Class<T> type) {
            Object service = services.get(name);
            if (service == null) {
                throw new IllegalArgumentException("Service not found: " + name);
            }
            if (!type.isInstance(service)) {
                throw new IllegalArgumentException(
                        "Service '" + name + "' is not of type " + type.getSimpleName());
            }
            return (T) service;
        }

        public static Set<String> getRegisteredNames() {
            return Collections.unmodifiableSet(services.keySet());
        }

        public static void reset() {
            services.clear();
        }
    }

    public static void main(String[] args) {
        ServiceRegistry.register("email", new EmailService("smtp.example.com"));
        ServiceRegistry.register("logger", new LoggingService("INFO"));

        EmailService email = ServiceRegistry.get("email", EmailService.class);
        email.send("bob@test.com", "Hello!");

        LoggingService logger = ServiceRegistry.get("logger", LoggingService.class);
        logger.log("Application started");

        System.out.println("Registered services: " + ServiceRegistry.getRegisteredNames());

        try {
            ServiceRegistry.register("email", new EmailService("other.host"));
        } catch (IllegalArgumentException e) {
            System.out.println("Error: " + e.getMessage());
        }

        try {
            ServiceRegistry.get("email", LoggingService.class);
        } catch (IllegalArgumentException e) {
            System.out.println("Error: " + e.getMessage());
        }

        try {
            ServiceRegistry.get("unknown", Object.class);
        } catch (IllegalArgumentException e) {
            System.out.println("Error: " + e.getMessage());
        }

        ServiceRegistry.reset();
        System.out.println("After reset: " + ServiceRegistry.getRegisteredNames());
    }
}
```
</details>

---

### Task 10: Implement a Thread-Safe Singleton with Lazy Initialization

**Difficulty:** Hard
**Estimated time:** 40 minutes

Implement a `Configuration` singleton class using the double-checked locking pattern and also demonstrate the enum-based singleton approach. Compare both approaches.

**Requirements:**
- `Configuration` class with private constructor
- Private static volatile instance
- `getInstance()` with double-checked locking
- Properties: `Map<String, String>` for key-value settings
- Methods: `set(key, value)`, `get(key)`, `get(key, defaultValue)`, `containsKey(key)`
- Also implement `AppConfig` as an enum singleton for comparison
- Demonstrate both singletons in action

**Starter code:**

```java
import java.util.HashMap;
import java.util.Map;

public class Main {

    // TODO: Implement Configuration singleton (double-checked locking)

    // TODO: Implement AppConfig enum singleton

    public static void main(String[] args) {
        // Double-checked locking singleton
        Configuration config1 = Configuration.getInstance();
        Configuration config2 = Configuration.getInstance();

        config1.set("db.host", "localhost");
        config1.set("db.port", "5432");

        System.out.println("Same instance: " + (config1 == config2));
        System.out.println("db.host: " + config2.get("db.host"));
        System.out.println("db.port: " + config2.get("db.port"));
        System.out.println("db.name: " + config2.get("db.name", "mydb"));
        System.out.println("has db.host: " + config2.containsKey("db.host"));
        System.out.println("has db.name: " + config2.containsKey("db.name"));

        System.out.println();

        // Enum singleton
        AppConfig.INSTANCE.set("app.name", "MyApp");
        AppConfig.INSTANCE.set("app.version", "1.0");

        System.out.println("app.name: " + AppConfig.INSTANCE.get("app.name"));
        System.out.println("app.version: " + AppConfig.INSTANCE.get("app.version"));
        System.out.println("app.env: " + AppConfig.INSTANCE.get("app.env", "production"));
    }
}
```

**Expected output:**
```
Same instance: true
db.host: localhost
db.port: 5432
db.name: mydb
has db.host: true
has db.name: false

app.name: MyApp
app.version: 1.0
app.env: production
```

<details>
<summary>Solution</summary>

```java
import java.util.HashMap;
import java.util.Map;

public class Main {

    // Double-checked locking singleton
    static class Configuration {
        private static volatile Configuration instance;
        private final Map<String, String> properties;

        private Configuration() {
            properties = new HashMap<>();
        }

        public static Configuration getInstance() {
            if (instance == null) {
                synchronized (Configuration.class) {
                    if (instance == null) {
                        instance = new Configuration();
                    }
                }
            }
            return instance;
        }

        public void set(String key, String value) {
            properties.put(key, value);
        }

        public String get(String key) {
            return properties.get(key);
        }

        public String get(String key, String defaultValue) {
            return properties.getOrDefault(key, defaultValue);
        }

        public boolean containsKey(String key) {
            return properties.containsKey(key);
        }
    }

    // Enum-based singleton (preferred approach in modern Java)
    enum AppConfig {
        INSTANCE;

        private final Map<String, String> properties = new HashMap<>();

        public void set(String key, String value) {
            properties.put(key, value);
        }

        public String get(String key) {
            return properties.get(key);
        }

        public String get(String key, String defaultValue) {
            return properties.getOrDefault(key, defaultValue);
        }
    }

    public static void main(String[] args) {
        Configuration config1 = Configuration.getInstance();
        Configuration config2 = Configuration.getInstance();

        config1.set("db.host", "localhost");
        config1.set("db.port", "5432");

        System.out.println("Same instance: " + (config1 == config2));
        System.out.println("db.host: " + config2.get("db.host"));
        System.out.println("db.port: " + config2.get("db.port"));
        System.out.println("db.name: " + config2.get("db.name", "mydb"));
        System.out.println("has db.host: " + config2.containsKey("db.host"));
        System.out.println("has db.name: " + config2.containsKey("db.name"));

        System.out.println();

        AppConfig.INSTANCE.set("app.name", "MyApp");
        AppConfig.INSTANCE.set("app.version", "1.0");

        System.out.println("app.name: " + AppConfig.INSTANCE.get("app.name"));
        System.out.println("app.version: " + AppConfig.INSTANCE.get("app.version"));
        System.out.println("app.env: " + AppConfig.INSTANCE.get("app.env", "production"));
    }
}
```
</details>

---

## Questions

### 1. What is the difference between a class and an object in Java?

**Answer:**
A **class** is a blueprint or template that defines the structure (fields) and behavior (methods) of a type. An **object** is a concrete instance of a class that exists in memory at runtime.

Think of a class like an architectural blueprint for a house. The blueprint itself is not a house — it describes what a house looks like. When you build an actual house from that blueprint, that is an object. You can build many houses (objects) from the same blueprint (class).

```java
// Class definition (blueprint)
class Dog {
    String name;
    void bark() { System.out.println(name + " says Woof!"); }
}

// Object creation (instances)
Dog d1 = new Dog(); // first object
Dog d2 = new Dog(); // second object — different instance, same class
```

Key distinction: a class occupies space in the method area of JVM memory (loaded once), while each object occupies space on the heap.

---

### 2. Why should fields be private and accessed through getters/setters?

**Answer:**
This is the principle of **encapsulation** — one of the four pillars of OOP. Making fields private and providing getters/setters gives you:

1. **Validation control:** You can validate data before setting it (e.g., reject negative ages).
2. **Implementation flexibility:** You can change the internal representation without breaking external code.
3. **Read-only or write-only access:** You can provide only a getter (immutable) or only a setter.
4. **Debugging:** You can set breakpoints in setters to track when a field changes.
5. **Derived properties:** A getter can compute values on the fly without storing them.

```java
// BAD: Public field — no validation possible
class User {
    public int age; // Anyone can set age = -5
}

// GOOD: Encapsulated field
class User {
    private int age;
    public void setAge(int age) {
        if (age < 0 || age > 150) throw new IllegalArgumentException("Invalid age");
        this.age = age;
    }
    public int getAge() { return age; }
}
```

Note: Not all classes need getters/setters. Value objects and DTOs may use public final fields or Java records for simplicity.

---

### 3. What is the difference between `==` and `.equals()` in Java?

**Answer:**
- `==` compares **reference identity** — whether two variables point to the exact same object in memory.
- `.equals()` compares **logical equality** — whether two objects are semantically equivalent.

By default, `Object.equals()` behaves the same as `==`. You must override it to define meaningful equality.

```java
String a = new String("hello");
String b = new String("hello");

System.out.println(a == b);      // false — different objects in memory
System.out.println(a.equals(b)); // true  — same content
```

When you override `equals()`, you **must** also override `hashCode()` to maintain the contract: if `a.equals(b)` is true, then `a.hashCode() == b.hashCode()` must also be true. Violating this contract breaks `HashMap`, `HashSet`, and other hash-based collections.

---

### 4. What is the `static` keyword and when should you use it?

**Answer:**
The `static` keyword means that a member (field, method, nested class, or block) belongs to the **class itself** rather than to any particular instance.

| Aspect | Instance member | Static member |
|--------|----------------|---------------|
| Belongs to | Each object | The class |
| Access | Requires object reference | Via class name (recommended) |
| Memory | One copy per object | One copy total |
| Can access | Instance + static members | Only static members |

**When to use static:**
- **Utility methods** that don't depend on instance state: `Math.sqrt()`, `Integer.parseInt()`
- **Constants:** `static final` fields like `Math.PI`
- **Counters or shared state** across all instances (e.g., instance counter)
- **Factory methods:** `List.of()`, `Map.of()`
- **Nested classes** that don't need a reference to the enclosing instance

**When NOT to use static:**
- When the method operates on instance-specific data
- When you need polymorphism (static methods cannot be overridden)

---

### 5. What happens if you do not override `hashCode()` when you override `equals()`?

**Answer:**
If you override `equals()` but not `hashCode()`, you violate the **equals-hashCode contract**. The default `hashCode()` from `Object` returns a value based on memory address, so two logically equal objects will have different hash codes.

**Consequence:** Hash-based collections (`HashMap`, `HashSet`, `LinkedHashMap`) will not work correctly.

```java
class Point {
    int x, y;
    Point(int x, int y) { this.x = x; this.y = y; }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof Point)) return false;
        Point p = (Point) o;
        return x == p.x && y == p.y;
    }
    // hashCode NOT overridden!
}

Set<Point> set = new HashSet<>();
set.add(new Point(1, 2));
System.out.println(set.contains(new Point(1, 2))); // false! Different hashCode
```

The fix: always override both together, ensuring equal objects produce the same hash code.

---

### 6. What are the four access modifiers in Java and when do you use each?

**Answer:**

| Modifier | Class | Package | Subclass | World |
|----------|:-----:|:-------:|:--------:|:-----:|
| `private` | Yes | No | No | No |
| (default/package-private) | Yes | Yes | No | No |
| `protected` | Yes | Yes | Yes | No |
| `public` | Yes | Yes | Yes | Yes |

**Guidelines:**
- **`private`:** Default choice for fields. Use for internal implementation details.
- **package-private (no modifier):** Useful for classes/methods that should be accessible within the same package but hidden from external users. Common in library/framework design.
- **`protected`:** Use when subclasses in other packages need access. Common for methods designed to be overridden.
- **`public`:** Use for the class's API — methods and constructors that external code should call.

**Principle of least privilege:** Start with `private` and widen access only when necessary.

---

### 7. What is constructor chaining and why is it useful?

**Answer:**
Constructor chaining is calling one constructor from another using `this()` (same class) or `super()` (parent class). It eliminates duplicate initialization logic.

```java
class Employee {
    private String name;
    private String department;
    private double salary;

    // Full constructor
    public Employee(String name, String department, double salary) {
        this.name = name;
        this.department = department;
        this.salary = salary;
    }

    // Chains to full constructor
    public Employee(String name, String department) {
        this(name, department, 50000.0); // default salary
    }

    // Chains to two-arg constructor
    public Employee(String name) {
        this(name, "Unassigned"); // default department
    }
}
```

**Benefits:**
- Single point of validation (only the full constructor validates)
- DRY principle — no duplicated field assignments
- Easy to add defaults for optional parameters
- `this()` must be the first statement in the constructor

---

### 8. What is the difference between composition and inheritance, and when should you prefer composition?

**Answer:**
- **Inheritance** ("is-a"): A subclass extends a parent class, inheriting its fields and methods. `class Dog extends Animal`.
- **Composition** ("has-a"): A class contains instances of other classes as fields. `class Car { private Engine engine; }`.

**Prefer composition when:**
- The relationship is "has-a" rather than "is-a"
- You need flexibility to change behavior at runtime
- You want to avoid tight coupling to a parent class
- You want to combine behaviors from multiple sources (Java has single inheritance)

**Prefer inheritance when:**
- There is a genuine "is-a" relationship
- You want to leverage polymorphism
- The base class is specifically designed for extension (e.g., abstract classes)

**Joshua Bloch's rule (Effective Java):** "Favor composition over inheritance." Inheritance breaks encapsulation because subclasses depend on the implementation details of superclasses.

---

### 9. What is the `this` keyword in Java and what are its uses?

**Answer:**
`this` is a reference to the **current object** — the instance on which a method or constructor is being called.

**Uses of `this`:**

1. **Disambiguate fields from parameters:**
```java
public void setName(String name) {
    this.name = name; // this.name = field, name = parameter
}
```

2. **Call another constructor (constructor chaining):**
```java
public Student() {
    this("Unknown", 0); // must be first statement
}
```

3. **Pass current object as argument:**
```java
list.add(this);
observer.notify(this);
```

4. **Return current object for fluent API (method chaining):**
```java
public Builder withName(String name) {
    this.name = name;
    return this;
}
```

Note: `this` cannot be used in static methods because static methods do not belong to any instance.

---

### 10. What is the `Object` class and why does every class inherit from it?

**Answer:**
`java.lang.Object` is the root of the entire Java class hierarchy. Every class implicitly extends `Object` if no other superclass is specified. This guarantees that all objects share a common set of methods:

| Method | Purpose |
|--------|---------|
| `toString()` | String representation (default: `ClassName@hashCode`) |
| `equals(Object)` | Equality check (default: reference comparison) |
| `hashCode()` | Hash for collections (default: identity-based) |
| `getClass()` | Runtime type information |
| `clone()` | Shallow copy (requires `Cloneable`) |
| `finalize()` | GC hook (deprecated since Java 9) |
| `wait()`, `notify()`, `notifyAll()` | Thread synchronization |

**Why this design matters:**
- Any object can be stored in `Object` variables or collections
- `System.out.println(obj)` works on any object because it calls `toString()`
- `HashMap` and `HashSet` work because every object has `equals()` and `hashCode()`
- You can use `instanceof` and `getClass()` for runtime type checks

---

## Mini Projects

### Project 1: Student Grade Management System

**Goal:** Build a complete student grade management system that exercises classes, objects, constructors, encapsulation, static members, and equals/hashCode.

**Description:**
Build a console-based system that manages students and their grades across multiple courses.

**Requirements:**
- [ ] `Student` class: id (auto-generated via static counter), name, list of enrollments
- [ ] `Course` class: code, name, maxCapacity; properly implements equals/hashCode based on code
- [ ] `Enrollment` class: links a student to a course with a grade (nullable until graded)
- [ ] `GradeBook` class: manages all students and courses
    - Register students and courses
    - Enroll students in courses (enforce max capacity)
    - Assign grades
    - Calculate GPA per student
    - Print a transcript for a student
    - Print class roster with grades for a course
- [ ] Proper encapsulation throughout: private fields, defensive copies for collections
- [ ] Static utility method to convert letter grades to GPA points
- [ ] Input validation everywhere (null checks, duplicate enrollments, capacity limits)
- [ ] A `main()` method that demonstrates all features with sample data

**Sample output (partial):**
```
=== TRANSCRIPT: Alice Johnson (ID: 1) ===
CS101 - Intro to CS:          A  (4.0)
MATH201 - Linear Algebra:     B+ (3.3)
ENG101 - English Composition: A- (3.7)
GPA: 3.67

=== ROSTER: CS101 - Intro to CS ===
1. Alice Johnson: A
2. Bob Smith: B
3. Charlie Brown: (not graded)
Enrolled: 3/30
```

**Difficulty:** Middle

**Estimated time:** 3-4 hours

---

### Project 2: Contact Book Application

**Goal:** Build a contact management application that combines encapsulation, static methods, equals/hashCode, and builder pattern.

**Description:**
Build a console-based contact book with full CRUD operations and search functionality.

**Requirements:**
- [ ] `Contact` class: immutable value object with name, phone, email, group
- [ ] Properly implements `equals()` and `hashCode()` (same name + phone = same contact)
- [ ] `Contact.Builder` for creating contacts with optional fields
- [ ] `ContactBook` class: stores contacts with defensive copying
    - Add, remove, update contacts
    - Search by name (case-insensitive partial match)
    - Search by group
    - List all contacts sorted by name
    - Export contacts as formatted strings
- [ ] Static factory method `Contact.of(name, phone)` for quick creation
- [ ] No duplicate contacts allowed (based on equals)
- [ ] A `main()` method demonstrating all features

**Difficulty:** Junior-Middle

**Estimated time:** 2-3 hours

---

## Challenge

### Design and Implement a Mini IoC (Inversion of Control) Container

**Problem:** Build a simplified dependency injection container that can register classes, automatically resolve their dependencies via constructor injection, and manage singleton vs prototype scopes.

**Functional Requirements:**
- `Container.register(Class<?> type)` — register a class for DI
- `Container.register(Class<?> type, Scope scope)` — register with scope (SINGLETON or PROTOTYPE)
- `Container.get(Class<?> type)` — resolve an instance, automatically injecting constructor dependencies
- The container must detect circular dependencies and throw a clear error
- Singleton scope: only one instance created and reused
- Prototype scope: new instance every time

**Technical Constraints:**
- Must use only core Java (no external libraries)
- Must use reflection (`java.lang.reflect`) for constructor discovery and invocation
- Must handle classes with zero-arg and multi-arg constructors
- All registered dependencies must be resolvable at `get()` time, or throw a descriptive error
- Must run in under 100ms for 50 registered types
- Total code under 300 lines (excluding the demo main method)

**Scoring:**
- Correctness (dependency resolution, scopes): 40%
- Circular dependency detection: 20%
- Error messages and edge case handling: 20%
- Code quality and OOP design: 20%

**Example usage:**
```java
import java.lang.reflect.Constructor;
import java.util.*;

public class Main {

    enum Scope { SINGLETON, PROTOTYPE }

    static class DatabaseConnection {
        public DatabaseConnection() {
            System.out.println("Creating DatabaseConnection");
        }
    }

    static class UserRepository {
        private final DatabaseConnection db;
        public UserRepository(DatabaseConnection db) {
            this.db = db;
            System.out.println("Creating UserRepository with DB");
        }
    }

    static class UserService {
        private final UserRepository repo;
        public UserService(UserRepository repo) {
            this.repo = repo;
            System.out.println("Creating UserService with UserRepository");
        }
    }

    // TODO: Implement Container class that supports:
    // - register(Class<?> type) — default SINGLETON scope
    // - register(Class<?> type, Scope scope)
    // - <T> T get(Class<T> type) — resolve with auto-injection
    // - Circular dependency detection
    // - Clear error messages for unresolvable types

    public static void main(String[] args) {
        Container container = new Container();
        container.register(DatabaseConnection.class, Scope.SINGLETON);
        container.register(UserRepository.class, Scope.SINGLETON);
        container.register(UserService.class, Scope.PROTOTYPE);

        UserService s1 = container.get(UserService.class);
        UserService s2 = container.get(UserService.class);
        System.out.println("Same UserService? " + (s1 == s2));       // false (PROTOTYPE)

        // Should only create DatabaseConnection once (SINGLETON)
        DatabaseConnection db1 = container.get(DatabaseConnection.class);
        DatabaseConnection db2 = container.get(DatabaseConnection.class);
        System.out.println("Same DB? " + (db1 == db2));              // true (SINGLETON)
    }
}
```

**Leaderboard criteria:** Most complete implementation with cleanest design wins. Bonus points for supporting interface-to-implementation binding (`container.register(Interface.class, Implementation.class)`).
