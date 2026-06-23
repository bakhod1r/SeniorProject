# Dealing with Generalization — Tasks

> 12 hands-on exercises.

---

## Task 1 ⭐ — Pull Up Method (Java)

```java
abstract class Employee {
    protected String name;
}
class Engineer extends Employee {
    public String greet() { return "Hi, I'm " + name; }
}
class Manager extends Employee {
    public String greet() { return "Hi, I'm " + name; }
}
```

<details><summary>Solution</summary>

```java
abstract class Employee {
    protected String name;
    public String greet() { return "Hi, I'm " + name; }
}
class Engineer extends Employee {}
class Manager extends Employee {}
```
</details>

---

## Task 2 ⭐ — Pull Up Field (Java)

```java
abstract class Employee {}
class Engineer extends Employee { protected String id; }
class Manager extends Employee { protected String id; }
```

<details><summary>Solution</summary>

```java
abstract class Employee { protected String id; }
class Engineer extends Employee {}
class Manager extends Employee {}
```
</details>

---

## Task 3 ⭐ — Push Down Method (Java)

```java
abstract class Employee {
    public double quota() { return 0; }   // only Salesman uses
}
class Salesman extends Employee {
    public double quota() { return 50000; }
}
class Engineer extends Employee {}
```

<details><summary>Solution</summary>

```java
abstract class Employee {}
class Salesman extends Employee {
    public double quota() { return 50000; }
}
class Engineer extends Employee {}
```
</details>

---

## Task 4 ⭐⭐ — Extract Superclass (Java)

```java
class Department {
    private String name;
    private List<Person> staff;
    public double totalCost() { ... }
    public String name() { return name; }
}
class Employee {
    private String name;
    private double salary;
    public double annualCost() { return salary * 12; }
    public String name() { return name; }
}
```

<details><summary>Solution</summary>

```java
abstract class Party {
    protected String name;
    public String name() { return name; }
    public abstract double annualCost();
}
class Department extends Party {
    private List<Person> staff;
    public double annualCost() { return /* totalCost() logic */; }
}
class Employee extends Party {
    private double salary;
    public double annualCost() { return salary * 12; }
}
```
</details>

---

## Task 5 ⭐⭐ — Extract Interface (Java)

```java
class Employee {
    public double rate() { return 100; }
    public int days() { return 5; }
}
class Contract {
    public double dailyRate() { return 200; }
    public int contractDays() { return 30; }
}

class Billing {
    public double charge(Employee e) { return e.rate() * e.days(); }
    public double charge(Contract c) { return c.dailyRate() * c.contractDays(); }
}
```

<details><summary>Solution</summary>

```java
interface Billable {
    double rate();
    int days();
}
class Employee implements Billable {
    public double rate() { return 100; }
    public int days() { return 5; }
}
class Contract implements Billable {
    public double rate() { return 200; }
    public int days() { return 30; }
}

class Billing {
    public double charge(Billable b) { return b.rate() * b.days(); }
}
```
</details>

---

## Task 6 ⭐⭐ — Form Template Method (Java)

```java
class TextStatement {
    public String emit(Customer c) {
        StringBuilder b = new StringBuilder();
        b.append("Customer: ").append(c.name()).append("\n");
        for (Order o : c.orders()) b.append(" - ").append(o.summary()).append("\n");
        b.append("Total: ").append(c.total());
        return b.toString();
    }
}
class HtmlStatement {
    public String emit(Customer c) {
        StringBuilder b = new StringBuilder();
        b.append("<h1>").append(c.name()).append("</h1>");
        for (Order o : c.orders()) b.append("<p>").append(o.summary()).append("</p>");
        b.append("<p>").append(c.total()).append("</p>");
        return b.toString();
    }
}
```

<details><summary>Solution</summary>

```java
abstract class Statement {
    public final String emit(Customer c) {
        StringBuilder b = new StringBuilder();
        b.append(header(c.name()));
        for (Order o : c.orders()) b.append(line(o.summary()));
        b.append(footer(c.total()));
        return b.toString();
    }
    protected abstract String header(String name);
    protected abstract String line(String summary);
    protected abstract String footer(Money total);
}
class TextStatement extends Statement {
    protected String header(String n) { return "Customer: " + n + "\n"; }
    protected String line(String s) { return " - " + s + "\n"; }
    protected String footer(Money t) { return "Total: " + t; }
}
class HtmlStatement extends Statement {
    protected String header(String n) { return "<h1>" + n + "</h1>"; }
    protected String line(String s) { return "<p>" + s + "</p>"; }
    protected String footer(Money t) { return "<p>" + t + "</p>"; }
}
```
</details>

---

## Task 7 ⭐⭐⭐ — Replace Inheritance with Delegation (Java)

```java
class Stack<E> extends Vector<E> {
    public void push(E e) { add(e); }
    public E pop() { return remove(size() - 1); }
}
```

<details><summary>Solution</summary>

```java
class Stack<E> {
    private final List<E> data = new ArrayList<>();
    public void push(E e) { data.add(e); }
    public E pop() { return data.remove(data.size() - 1); }
    public int size() { return data.size(); }
    public boolean isEmpty() { return data.isEmpty(); }
}
```
</details>

---

## Task 8 ⭐⭐ — Collapse Hierarchy (Java)

```java
class Vehicle {
    protected String name;
    public String name() { return name; }
}
class Car extends Vehicle {
    // adds nothing
}
```

<details><summary>Solution</summary>

```java
class Vehicle {
    private String name;
    public String name() { return name; }
}
```

(Eliminate the redundant Car.)
</details>

---

## Task 9 ⭐⭐⭐ — Extract Subclass (Java)

```java
class Job {
    private String name;
    private double unitPrice;
    private int employeeId;
    private boolean isInternal;

    public double cost() {
        return isInternal ? employeeRate(employeeId) : unitPrice;
    }
    public String summary() {
        return name + ": $" + cost() + (isInternal ? " (internal)" : "");
    }
}
```

<details><summary>Solution</summary>

```java
abstract class Job {
    protected String name;
    public abstract double cost();
    public String summary() { return name + ": $" + cost(); }
}
class ExternalJob extends Job {
    private double unitPrice;
    public double cost() { return unitPrice; }
}
class InternalJob extends Job {
    private int employeeId;
    public double cost() { return employeeRate(employeeId); }
    public String summary() { return super.summary() + " (internal)"; }
}
```
</details>

---

## Task 10 ⭐⭐⭐ — Pull Up Constructor Body (Java)

```java
class Manager extends Employee {
    private int grade;
    public Manager(String name, String id, int grade) {
        this.name = name;
        this.id = id;
        this.grade = grade;
    }
}
class Engineer extends Employee {
    private int level;
    public Engineer(String name, String id, int level) {
        this.name = name;
        this.id = id;
        this.level = level;
    }
}
```

<details><summary>Solution</summary>

```java
abstract class Employee {
    protected final String name;
    protected final String id;
    public Employee(String name, String id) {
        this.name = name;
        this.id = id;
    }
}
class Manager extends Employee {
    private final int grade;
    public Manager(String name, String id, int grade) {
        super(name, id);
        this.grade = grade;
    }
}
class Engineer extends Employee {
    private final int level;
    public Engineer(String name, String id, int level) {
        super(name, id);
        this.level = level;
    }
}
```
</details>

---

## Task 11 ⭐⭐ — Sealed types + Pattern matching (Java 21+)

```java
abstract class Shape {
    public abstract double area();
}
class Circle extends Shape {
    private double r;
    public double area() { return Math.PI * r * r; }
}
class Square extends Shape {
    private double side;
    public double area() { return side * side; }
}
```

Refactor to sealed records.

<details><summary>Solution</summary>

```java
sealed interface Shape permits Circle, Square {}
record Circle(double radius) implements Shape {}
record Square(double side) implements Shape {}

double area(Shape s) {
    return switch (s) {
        case Circle c -> Math.PI * c.radius() * c.radius();
        case Square sq -> sq.side() * sq.side();
    };
}
```
</details>

---

## Task 12 ⭐⭐⭐ — Combined refactoring (Go)

In Go (no inheritance):

```go
type Engineer struct {
    Name string
    Salary float64
}
func (e Engineer) Greet() string { return "Hi, I'm " + e.Name }
func (e Engineer) Salary() float64 { return e.Salary }

type Manager struct {
    Name string
    Salary float64
    Grade int
}
func (m Manager) Greet() string { return "Hi, I'm " + m.Name }
func (m Manager) Salary() float64 { return m.Salary }
```

<details><summary>Solution</summary>

```go
type Employee struct {
    Name string
    Salary float64
}
func (e Employee) Greet() string { return "Hi, I'm " + e.Name }

type Engineer struct {
    Employee   // embed
}

type Manager struct {
    Employee   // embed
    Grade int
}

// Now both have Greet (promoted) and access to Name, Salary.
// Engineer can override or just inherit.
```

If you want polymorphism, define an interface:

```go
type Greeter interface { Greet() string }
```

Both Engineer and Manager satisfy `Greeter` via the embedded Employee's method.
</details>

---

## Self-check

- ☑ I can pull up duplicated members and push down specific ones.
- ☑ I can choose between Extract Superclass and Extract Interface.
- ☑ I can apply Form Template Method.
- ☑ I can convert wrong inheritance to delegation.
- ☑ I can model in Go (or other languages without inheritance).

---

## Next

- [find-bug.md](find-bug.md), [optimize.md](optimize.md), [interview.md](interview.md)
