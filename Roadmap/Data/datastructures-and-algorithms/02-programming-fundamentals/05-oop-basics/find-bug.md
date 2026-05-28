# OOP Basics - Find the Bug Exercises

Each exercise contains buggy code. Find the bug, explain why it's wrong, and fix it.

---

## Bug 1: Forgot to Call `super()`

### Python — Buggy Code

```python
class Animal:
    def __init__(self, name: str):
        self.name = name
        self.sound = "..."

class Dog(Animal):
    def __init__(self, name: str, breed: str):
        self.breed = breed  # BUG: Where is super().__init__()?

    def speak(self) -> str:
        return f"{self.name} says Woof!"  # AttributeError: 'Dog' has no attribute 'name'

dog = Dog("Rex", "Labrador")
print(dog.speak())
```

### Java — Buggy Code

```java
class Animal {
    protected String name;

    public Animal(String name) {
        this.name = name;
    }
}

class Dog extends Animal {
    private String breed;

    public Dog(String name, String breed) {
        // BUG: Missing super(name) call
        // Java requires calling super() if parent has no default constructor
        this.breed = breed;
    }
    // Compiler error: constructor Animal() not found
}
```

### Fix

**Python:**
```python
class Dog(Animal):
    def __init__(self, name: str, breed: str):
        super().__init__(name)   # FIX: Call parent initializer
        self.breed = breed
```

**Java:**
```java
class Dog extends Animal {
    private String breed;

    public Dog(String name, String breed) {
        super(name);            // FIX: Call parent constructor
        this.breed = breed;
    }
}
```

---

## Bug 2: Wrong Access Modifier — Broken Encapsulation

### Java — Buggy Code

```java
public class BankAccount {
    public double balance;  // BUG: balance is public!

    public BankAccount(double initialBalance) {
        this.balance = initialBalance;
    }

    public void deposit(double amount) {
        if (amount > 0) {
            this.balance += amount;
        }
    }

    public boolean withdraw(double amount) {
        if (amount > 0 && amount <= this.balance) {
            this.balance -= amount;
            return true;
        }
        return false;
    }
}

// Anyone can do this:
BankAccount acc = new BankAccount(1000);
acc.balance = -999999;  // Bypasses all validation!
```

### Go — Buggy Code

```go
type BankAccount struct {
    Owner   string
    Balance float64  // BUG: Exported field, anyone can modify directly
}

func (a *BankAccount) Deposit(amount float64) {
    if amount > 0 {
        a.Balance += amount
    }
}

// From another package:
// acc.Balance = -999999  // Bypasses validation!
```

### Fix

**Java:**
```java
public class BankAccount {
    private double balance;  // FIX: make private

    public double getBalance() {
        return balance;      // Provide read-only access
    }
    // deposit() and withdraw() are the only way to change balance
}
```

**Go:**
```go
type BankAccount struct {
    owner   string
    balance float64  // FIX: unexported (lowercase)
}

func (a *BankAccount) Balance() float64 {
    return a.balance  // Provide getter
}
```

---

## Bug 3: Interface Not Satisfied (Go)

### Go — Buggy Code

```go
type Shape interface {
    Area() float64
    Perimeter() float64
}

type Circle struct {
    Radius float64
}

// BUG: Only Area() is implemented, Perimeter() is missing
func (c Circle) Area() float64 {
    return math.Pi * c.Radius * c.Radius
}

func PrintShape(s Shape) {
    fmt.Printf("Area: %.2f\n", s.Area())
}

func main() {
    c := Circle{Radius: 5}
    PrintShape(c)
    // Compiler error: Circle does not implement Shape
    // (missing method Perimeter)
}
```

### Fix

```go
// FIX: Implement ALL methods required by the interface
func (c Circle) Area() float64 {
    return math.Pi * c.Radius * c.Radius
}

func (c Circle) Perimeter() float64 {
    return 2 * math.Pi * c.Radius  // FIX: Add missing method
}
```

---

## Bug 4: Wrong Method Resolution (Python MRO)

### Python — Buggy Code

```python
class A:
    def method(self):
        return "A"

class B(A):
    def method(self):
        return "B"

class C(A):
    def method(self):
        return "C"

class D(B, C):
    pass

d = D()
print(d.method())  # Developer expects "C" but gets "B"

# BUG: Developer doesn't understand MRO
# MRO of D is: D → B → C → A
# B comes before C, so B.method() is called
```

### Fix

```python
# If you want C's behavior, either:

# Option 1: Change inheritance order
class D(C, B):  # Now MRO is D → C → B → A
    pass

# Option 2: Explicitly call the desired method
class D(B, C):
    def method(self):
        return C.method(self)  # Explicitly call C's version

# Option 3: Use super() chain properly
class B(A):
    def method(self):
        return "B+" + super().method()

class C(A):
    def method(self):
        return "C+" + super().method()

class D(B, C):
    def method(self):
        return super().method()

d = D()
print(d.method())  # "B+C+A" — follows MRO chain
```

---

## Bug 5: Shallow Copy of Mutable Field

### Python — Buggy Code

```python
class Team:
    def __init__(self, name: str, members: list[str] = []):  # BUG: Mutable default!
        self.name = name
        self.members = members

team1 = Team("Alpha")
team1.members.append("Alice")

team2 = Team("Beta")
team2.members.append("Bob")

print(team1.members)  # Expected: ["Alice"], Actual: ["Alice", "Bob"]!
print(team2.members)  # Expected: ["Bob"],   Actual: ["Alice", "Bob"]!
# Both teams share the SAME list object!
```

### Java — Buggy Code

```java
import java.util.*;

public class Team {
    private String name;
    private List<String> members;

    public Team(String name, List<String> members) {
        this.name = name;
        this.members = members;  // BUG: Stores reference, not copy!
    }

    public List<String> getMembers() {
        return members;  // BUG: Returns mutable reference!
    }
}

List<String> names = new ArrayList<>(List.of("Alice", "Bob"));
Team team = new Team("Alpha", names);
names.add("Eve");           // Modifies the team's internal list!
team.getMembers().clear();  // Also modifies internal state!
```

### Go — Buggy Code

```go
type Team struct {
    Name    string
    Members []string
}

func NewTeam(name string, members []string) *Team {
    return &Team{
        Name:    name,
        Members: members, // BUG: Stores the same slice header
    }
}

members := []string{"Alice", "Bob"}
team := NewTeam("Alpha", members)
members[0] = "CHANGED"
fmt.Println(team.Members[0]) // "CHANGED" — shared underlying array!
```

### Fix

**Python:**
```python
class Team:
    def __init__(self, name: str, members: list[str] | None = None):
        self.name = name
        self.members = list(members) if members else []  # FIX: Create a copy
```

**Java:**
```java
public class Team {
    private final String name;
    private final List<String> members;

    public Team(String name, List<String> members) {
        this.name = name;
        this.members = new ArrayList<>(members);  // FIX: Defensive copy
    }

    public List<String> getMembers() {
        return Collections.unmodifiableList(members);  // FIX: Immutable view
    }
}
```

**Go:**
```go
func NewTeam(name string, members []string) *Team {
    copied := make([]string, len(members))
    copy(copied, members)
    return &Team{
        Name:    name,
        Members: copied, // FIX: Copy the slice
    }
}
```

---

## Bug 6: Circular Dependency

### Go — Buggy Code

```go
// package user
package user

import "myapp/order" // BUG: user imports order

type User struct {
    Name   string
    Orders []*order.Order
}

// package order
package order

import "myapp/user" // BUG: order imports user → CIRCULAR!

type Order struct {
    ID     string
    Buyer  *user.User
}

// Compiler error: import cycle not allowed
```

### Fix

```go
// FIX: Extract shared types into a separate package

// package models (shared types)
package models

type User struct {
    Name   string
    Orders []*Order
}

type Order struct {
    ID    string
    Buyer *User
}

// OR use interfaces to break the cycle:

// package user
type OrderInfo interface {
    GetID() string
}

type User struct {
    Name   string
    Orders []OrderInfo  // Depends on interface, not concrete type
}

// package order
type BuyerInfo interface {
    GetName() string
}

type Order struct {
    ID    string
    Buyer BuyerInfo  // Depends on interface, not concrete type
}
```

---

## Bug 7: Missing Method Implementation (Java)

### Java — Buggy Code

```java
interface Drawable {
    void draw();
    void resize(double factor);
}

abstract class Shape implements Drawable {
    protected String color;

    public Shape(String color) {
        this.color = color;
    }

    @Override
    public void draw() {
        System.out.println("Drawing " + color + " shape");
    }
    // Note: resize() is NOT implemented here — that's OK for abstract class
}

class Circle extends Shape {
    private double radius;

    public Circle(String color, double radius) {
        super(color);
        this.radius = radius;
    }

    // BUG: Circle doesn't implement resize()!
    // Shape left it abstract, Circle must implement it
    // Compiler error: Circle is not abstract and does not override
    // abstract method resize(double) in Drawable
}
```

### Fix

```java
class Circle extends Shape {
    private double radius;

    public Circle(String color, double radius) {
        super(color);
        this.radius = radius;
    }

    @Override
    public void resize(double factor) {  // FIX: Implement the missing method
        this.radius *= factor;
    }

    @Override
    public void draw() {
        System.out.println("Drawing " + color + " circle with radius " + radius);
    }
}
```

---

## Bug 8: Pointer Receiver vs Value Receiver (Go)

### Go — Buggy Code

```go
type Counter struct {
    count int
}

// BUG: Value receiver — modifies a COPY, not the original
func (c Counter) Increment() {
    c.count++
}

func (c Counter) GetCount() int {
    return c.count
}

func main() {
    c := Counter{}
    c.Increment()
    c.Increment()
    c.Increment()
    fmt.Println(c.GetCount()) // Expected: 3, Actual: 0!
}
```

### Fix

```go
// FIX: Use pointer receiver for methods that modify state
func (c *Counter) Increment() {
    c.count++
}

func (c Counter) GetCount() int { // Value receiver is OK for read-only
    return c.count
}

func main() {
    c := Counter{}
    c.Increment()
    c.Increment()
    c.Increment()
    fmt.Println(c.GetCount()) // Now correctly prints: 3
}
```

---

## Bug 9: `__eq__` Without `__hash__` (Python)

### Python — Buggy Code

```python
class Point:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y

    def __eq__(self, other) -> bool:
        if not isinstance(other, Point):
            return NotImplemented
        return self.x == other.x and self.y == other.y

    # BUG: Defined __eq__ but not __hash__!
    # Python sets __hash__ = None when you define __eq__

p1 = Point(1, 2)
p2 = Point(1, 2)

print(p1 == p2)  # True — works fine

# But:
my_set = {p1}
# TypeError: unhashable type: 'Point'
# OR in older Python, unexpected behavior in dicts/sets

my_dict = {}
my_dict[p1] = "hello"
# TypeError: unhashable type: 'Point'
```

### Fix

```python
class Point:
    def __init__(self, x: int, y: int):
        self.x = x
        self.y = y

    def __eq__(self, other) -> bool:
        if not isinstance(other, Point):
            return NotImplemented
        return self.x == other.x and self.y == other.y

    def __hash__(self) -> int:  # FIX: Always define __hash__ with __eq__
        return hash((self.x, self.y))

p1 = Point(1, 2)
p2 = Point(1, 2)
print(p1 == p2)         # True
print({p1, p2})         # {Point(1, 2)} — one element (they're equal)
print(len({p1, p2}))    # 1
```

---

## Bug 10: Singleton Not Thread-Safe (Java)

### Java — Buggy Code

```java
public class DatabaseConnection {
    private static DatabaseConnection instance;

    private DatabaseConnection() {
        System.out.println("Creating connection...");
        // Simulate slow initialization
        try { Thread.sleep(100); } catch (InterruptedException e) {}
    }

    // BUG: Not thread-safe!
    public static DatabaseConnection getInstance() {
        if (instance == null) {
            instance = new DatabaseConnection();
            // Race condition: two threads can both see instance == null
            // and create two instances
        }
        return instance;
    }
}

// Thread 1: getInstance() → sees null → starts creating
// Thread 2: getInstance() → sees null → also starts creating
// Result: Two instances created!
```

### Fix

```java
public class DatabaseConnection {
    // FIX Option 1: Double-checked locking
    private static volatile DatabaseConnection instance;

    public static DatabaseConnection getInstance() {
        if (instance == null) {
            synchronized (DatabaseConnection.class) {
                if (instance == null) {  // Double-check inside synchronized
                    instance = new DatabaseConnection();
                }
            }
        }
        return instance;
    }

    // FIX Option 2 (recommended): Initialization-on-demand holder
    // private static class Holder {
    //     static final DatabaseConnection INSTANCE = new DatabaseConnection();
    // }
    // public static DatabaseConnection getInstance() {
    //     return Holder.INSTANCE;
    // }

    // FIX Option 3: Use enum (simplest)
    // public enum DatabaseConnection {
    //     INSTANCE;
    // }
}
```

---

## Bug 11: Comparing Objects with `==` Instead of `.equals()` (Java)

### Java — Buggy Code

```java
public class User {
    private String name;
    private int age;

    public User(String name, int age) {
        this.name = name;
        this.age = age;
    }
}

User u1 = new User("Alice", 25);
User u2 = new User("Alice", 25);

// BUG: == compares references, not values!
if (u1 == u2) {
    System.out.println("Same user");
} else {
    System.out.println("Different users"); // This prints!
}

// Also buggy with strings:
String s1 = new String("hello");
String s2 = new String("hello");
System.out.println(s1 == s2);  // false! (different objects)
```

### Fix

```java
public class User {
    private String name;
    private int age;

    public User(String name, int age) {
        this.name = name;
        this.age = age;
    }

    @Override
    public boolean equals(Object obj) {  // FIX: Override equals
        if (this == obj) return true;
        if (obj == null || getClass() != obj.getClass()) return false;
        User other = (User) obj;
        return age == other.age && Objects.equals(name, other.name);
    }

    @Override
    public int hashCode() {  // FIX: Always override hashCode with equals
        return Objects.hash(name, age);
    }
}

User u1 = new User("Alice", 25);
User u2 = new User("Alice", 25);
System.out.println(u1.equals(u2)); // true
System.out.println(u1 == u2);      // still false (different objects)
```

---

## Bug 12: Goroutine Data Race on Shared Struct (Go)

### Go — Buggy Code

```go
type Counter struct {
    value int
}

func (c *Counter) Increment() {
    c.value++ // BUG: Not safe for concurrent access!
}

func (c *Counter) Value() int {
    return c.value
}

func main() {
    c := &Counter{}
    var wg sync.WaitGroup

    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            c.Increment() // DATA RACE!
        }()
    }

    wg.Wait()
    fmt.Println(c.Value()) // Expected: 1000, Actual: some random number < 1000
}
```

### Fix

```go
type Counter struct {
    mu    sync.Mutex
    value int
}

func (c *Counter) Increment() {
    c.mu.Lock()         // FIX: Lock before modifying
    defer c.mu.Unlock()
    c.value++
}

func (c *Counter) Value() int {
    c.mu.Lock()
    defer c.mu.Unlock()
    return c.value
}

// Alternative FIX: Use atomic operations
type AtomicCounter struct {
    value atomic.Int64
}

func (c *AtomicCounter) Increment() {
    c.value.Add(1)
}

func (c *AtomicCounter) Value() int64 {
    return c.value.Load()
}
```

---

## Summary of Common OOP Bugs

| # | Bug Type                          | Languages | Root Cause                                |
|---|-----------------------------------|-----------|-------------------------------------------|
| 1 | Missing `super().__init__()`      | Py, Java  | Forgetting to initialize parent class     |
| 2 | Public mutable fields             | All       | Breaking encapsulation                    |
| 3 | Unimplemented interface methods   | Go        | Partial interface implementation          |
| 4 | Wrong MRO assumptions             | Python    | Not understanding C3 linearization        |
| 5 | Shallow copy of mutable field     | All       | Sharing references to mutable objects     |
| 6 | Circular dependency               | All       | Tight coupling between packages/modules   |
| 7 | Missing abstract method impl      | Java      | Forgetting to implement inherited abstract|
| 8 | Value vs pointer receiver         | Go        | Modifying a copy instead of the original  |
| 9 | `__eq__` without `__hash__`       | Python    | Breaking set/dict contract                |
| 10| Non-thread-safe singleton         | Java      | Race condition in lazy initialization     |
| 11| `==` instead of `.equals()`       | Java      | Reference comparison vs value comparison  |
| 12| Data race on shared struct        | Go        | Concurrent access without synchronization |
