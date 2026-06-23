# Java Language Specification — Basics of OOP
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html

---

## 1. Spec Reference

- **JLS Chapter 8**: Classes — https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html
- **JLS Chapter 9**: Interfaces — https://docs.oracle.com/javase/specs/jls/se21/html/jls-9.html
- **JLS §8.1**: Class Declarations
- **JLS §8.1.1**: Class Modifiers
- **JLS §8.1.4**: Superclasses and Subclasses
- **JLS §8.1.5**: Superinterfaces
- **JLS §8.2**: Class Members
- **JLS §8.3**: Field Declarations
- **JLS §8.4**: Method Declarations
- **JLS §8.4.8**: Inheritance, Overriding, Hiding
- **JLS §8.5**: Member Class and Interface Declarations
- **JLS §8.6**: Instance Initializers
- **JLS §8.7**: Static Initializers
- **JLS §8.8**: Constructor Declarations
- **JLS §8.9**: Enum Types
- **JLS §8.10**: Record Classes
- **JLS §9.1**: Interface Declarations
- **JLS §9.4**: Abstract Method Declarations
- **JLS §9.4.3**: Default Methods
- **JLS §15.12**: Method Invocation Expressions
- **JLS §15.9**: Class Instance Creation Expressions

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §8.1: Class Declaration --
NormalClassDeclaration:
    {ClassModifier} class TypeIdentifier [TypeParameters]
        [ClassExtends] [ClassImplements] [ClassPermits] ClassBody

ClassModifier:
    Annotation
    public | protected | private
    abstract | static | final | sealed | non-sealed | strictfp

ClassExtends:
    extends ClassType

ClassImplements:
    implements InterfaceTypeList

ClassPermits:
    permits TypeName { , TypeName }

ClassBody:
    { {ClassBodyDeclaration} }

ClassBodyDeclaration:
    ClassMemberDeclaration
    InstanceInitializer
    StaticInitializer
    ConstructorDeclaration

ClassMemberDeclaration:
    FieldDeclaration
    MethodDeclaration
    ClassDeclaration
    InterfaceDeclaration
    ;

-- JLS §8.3: Field Declaration --
FieldDeclaration:
    {FieldModifier} UnannType VariableDeclaratorList ;

FieldModifier:
    Annotation
    public | protected | private
    static | final | transient | volatile

-- JLS §8.8: Constructor Declaration --
ConstructorDeclaration:
    {ConstructorModifier} ConstructorDeclarator [Throws] ConstructorBody

ConstructorDeclarator:
    [TypeParameters] SimpleTypeName ( [ReceiverParameter ,] [FormalParameterList] )

ConstructorBody:
    { [ExplicitConstructorInvocation] [BlockStatements] }

ConstructorModifier:
    Annotation
    public | protected | private

-- JLS §9.1: Interface Declaration --
InterfaceDeclaration:
    NormalInterfaceDeclaration
    AnnotationInterfaceDeclaration

NormalInterfaceDeclaration:
    {InterfaceModifier} interface TypeIdentifier [TypeParameters]
        [InterfaceExtends] [InterfacePermits] InterfaceBody

InterfaceModifier:
    Annotation
    public | protected | private
    abstract | static | sealed | non-sealed | strictfp

InterfaceExtends:
    extends InterfaceTypeList

-- JLS §8.9: Enum Declaration --
EnumDeclaration:
    {ClassModifier} enum TypeIdentifier [ClassImplements] EnumBody

EnumBody:
    { [EnumConstantList] [,] [EnumBodyDeclarations] }

EnumConstantList:
    EnumConstant { , EnumConstant }

EnumConstant:
    {EnumConstantModifier} Identifier [( [ArgumentList] )] [ClassBody]

-- JLS §8.10: Record Declaration --
RecordDeclaration:
    {ClassModifier} record TypeIdentifier [TypeParameters]
        RecordHeader [ClassImplements] RecordBody

RecordHeader:
    ( [RecordComponentList] )

RecordComponentList:
    RecordComponent { , RecordComponent }

RecordComponent:
    {RecordComponentModifier} UnannType Identifier
    VariableArityRecordComponent
```

---

## 3. Core Rules & Constraints

### 3.1 Encapsulation Rules
- `private` fields/methods: accessible only within the declaring class.
- `protected` fields/methods: accessible within package and subclasses.
- Package-private (no modifier): accessible within the same package.
- `public` fields/methods: accessible from anywhere.
- Best practice (enforced by convention, not spec): fields should be `private`; access via methods.

### 3.2 Inheritance Rules (JLS §8.1.4)
- `extends` clause specifies a single direct superclass.
- Cannot `extend` a `final` class.
- Cannot `extend` an `enum` type (except through the enum declaration itself).
- If no `extends` clause, the direct superclass is `java.lang.Object` (except for `Object` itself).
- A class can `extend` only one class (single inheritance for classes).
- Transitive: if C extends B and B extends A, then C is a subtype of A.

### 3.3 Interface Implementation Rules (JLS §8.1.5)
- A class may implement multiple interfaces.
- All abstract methods of implemented interfaces must be overridden (or the class is abstract).
- Default method conflicts: if two interfaces provide default methods with same signature, the implementing class must override (compile error otherwise).
- A class that implements an interface is a subtype of that interface.

### 3.4 Constructor Rules (JLS §8.8)
- Constructors are not inherited.
- If no constructor is declared, the compiler provides a default no-arg constructor.
- The default constructor calls `super()` implicitly.
- Every constructor must invoke `super(...)` or `this(...)` as its first statement (or the compiler inserts `super()` implicitly).
- A class without an accessible `super()` constructor must explicitly call another `super(args...)`.

### 3.5 Method Overriding Rules (JLS §8.4.8.1)
- An instance method in a subclass overrides an accessible instance method in a superclass if:
  - Same name, same number and type of parameters.
  - Return type is covariant (same or subtype).
  - Not less accessible than overridden method.
  - Does not declare new checked exceptions.
- `@Override` annotation verifies override at compile time.
- `static` methods are hidden (not overridden) — `@Override` on static method is an error.
- `private` methods are not overridden (they are hidden and not visible to subclasses).

### 3.6 Abstract Classes (JLS §8.1.1.1)
- Abstract classes cannot be instantiated (`new AbstractClass()` is a compile error).
- May contain abstract methods (no body, ends with `;`).
- May also contain concrete (non-abstract) methods.
- A class with at least one abstract method must be declared `abstract`.
- Abstract class may have constructors (for use by subclass constructors via `super(...)`).

### 3.7 `final` Classes and Methods (JLS §8.1.1.2, §8.4.3.3)
- `final` class cannot be extended.
- `final` method cannot be overridden.
- `String`, `Integer`, and all wrapper types are `final`.
- `enum` types are implicitly `final` (unless they have subclasses via constant-specific bodies).
- Records are implicitly `final` (JLS §8.10).

---

## 4. Type Rules

### 4.1 Polymorphism (JLS §15.12.4)
- A variable of type `T` may refer to an object of any subtype of `T` at runtime.
- Method calls on reference variables use dynamic dispatch (virtual method lookup).
- The JVM looks up the actual runtime type of the object to find the correct method.
- Fields are NOT polymorphic — field access uses the compile-time type of the reference.

### 4.2 `this` Reference (JLS §15.8.3)
- Inside an instance method or constructor, `this` refers to the current object.
- `this.field` disambiguates when a local variable shadows an instance field.
- Cannot use `this` in `static` contexts.
- `this(...)` in a constructor calls another constructor of the same class.

### 4.3 `super` Reference (JLS §15.11.2)
- `super.method()` calls the superclass's version of an overridden method.
- `super.field` accesses a hidden field in the superclass.
- `super(...)` in a constructor invokes the superclass constructor.
- Cannot chain: `super.super.method()` is not legal.

### 4.4 Records (JLS §8.10, Java 16+)
- Records are immutable data carriers.
- Implicitly `final` — cannot be extended.
- Automatically provide: constructor, accessor methods (same name as component), `equals()`, `hashCode()`, `toString()`.
- Record components are declared in the record header.
- Can have `static` fields, methods, and instance methods.
- Cannot have explicit instance fields beyond the record components.

### 4.5 Enums (JLS §8.9)
- Enum constants are `public static final` instances of the enum type.
- Enum types implicitly extend `java.lang.Enum`.
- Cannot be instantiated with `new`.
- `values()` returns all constants; `valueOf(String)` finds by name.
- Can have fields, methods, and constructors.
- Constructor is always `private` (or package-private — but effectively private since enum cannot be subclassed externally).

---

## 5. Behavioral Specification

### 5.1 Object Creation Sequence (JLS §12.5)
1. Allocate memory for the new object.
2. Zero-initialize all instance fields.
3. Invoke the specified constructor.
4. Constructor begins with `super(...)` or `this(...)` call.
5. Execute instance initializers and instance variable initializers in textual order.
6. Execute the constructor body remainder.

### 5.2 Virtual Method Dispatch (JLS §15.12.4)
- The JVM looks up the method in the runtime class of the object.
- If not found, searches up the class hierarchy.
- This is called dynamic dispatch or virtual dispatch.
- `invokevirtual` bytecode instruction performs dynamic dispatch.
- `invokeinterface` is used for interface method calls.

### 5.3 Interface Default Methods (JLS §9.4.3, Java 8+)
- Interfaces may provide default implementations of methods.
- A class that does not override the default method inherits it.
- If a class inherits two conflicting defaults, it must override to resolve the conflict.
- Default methods enable interface evolution without breaking existing implementations.

### 5.4 Access Control Summary (JLS §6.6)
| Modifier | Same Class | Same Package | Subclass (other pkg) | Other Package |
|----------|-----------|-------------|----------------------|---------------|
| `public` | Yes | Yes | Yes | Yes |
| `protected` | Yes | Yes | Yes | No |
| (none) | Yes | Yes | No | No |
| `private` | Yes | No | No | No |

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| `new AbstractClass()` | Compile error |
| `new FinalClass()` as `extends` target | Compile error |
| Overriding with less access | Compile error (e.g., override `public` with `protected`) |
| Overriding with new checked exception | Compile error |
| `this()` not as first constructor statement | Compile error |
| Circular `this()` calls | Compile error |
| Two interfaces with conflicting defaults, not overridden | Compile error |
| `super.super.method()` | Compile error (no chained super) |
| `static` method with `@Override` | Compile error |
| Record with explicit instance field | Compile error |

---

## 7. Edge Cases from Spec

### 7.1 Field Hiding vs Method Overriding
```java
class Parent {
    int x = 10;
    int getX() { return x; }
}
class Child extends Parent {
    int x = 20;               // hides Parent.x
    @Override int getX() { return x; }  // overrides

}
Parent p = new Child();
System.out.println(p.x);      // 10 (field: compile-time type)
System.out.println(p.getX()); // 20 (method: runtime type)
```

### 7.2 Default Method Diamond Problem
```java
interface A {
    default String name() { return "A"; }
}
interface B extends A {
    default String name() { return "B"; }
}
class C implements A, B {
    // Must override to resolve conflict (or not — B is more specific and wins here)
    // In this case B overrides A, so C inherits B's default
    @Override
    public String name() { return B.super.name(); }  // explicit super call
}
```

### 7.3 Covariant Return Type
```java
class Producer {
    Object produce() { return new Object(); }
}
class StringProducer extends Producer {
    @Override
    String produce() { return "hello"; }  // covariant: String is-a Object
}
```

### 7.4 Constructor Chaining
```java
class Person {
    String name;
    int age;

    Person(String name, int age) {
        this.name = name;
        this.age = age;
    }

    Person(String name) {
        this(name, 0);  // chains to two-arg constructor
    }

    Person() {
        this("Unknown");  // chains to one-arg constructor
    }
}
```

### 7.5 Abstract Class with Constructor
```java
abstract class Vehicle {
    protected String brand;

    Vehicle(String brand) {      // abstract class CAN have constructor
        this.brand = brand;
    }

    abstract void move();
}

class Car extends Vehicle {
    Car(String brand) {
        super(brand);            // must call abstract class constructor
    }

    @Override
    void move() {
        System.out.println(brand + " car is moving");
    }
}
```

### 7.6 Record Compact Constructor
```java
record Range(int lo, int hi) {
    Range {  // compact constructor — no parameter list needed
        if (lo > hi) {
            throw new IllegalArgumentException("lo > hi");
        }
        // lo and hi are implicitly assigned from components
    }
}
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | Classes, interfaces, inheritance, polymorphism, access control | JLS 1st ed. |
| Java 1.1 | Inner classes; anonymous classes; local classes | JLS 2nd ed. |
| Java 5 | Generics; enums; annotations; covariant returns; varargs | JSR 14, JSR 175 |
| Java 8 | Default methods in interfaces; static methods in interfaces | JEP 126 |
| Java 9 | `private` methods in interfaces | JEP 213 |
| Java 14 | Records (preview) | JEP 359 |
| Java 15 | Sealed classes (preview) | JEP 360 |
| Java 16 | Records (standard); pattern matching `instanceof` (standard) | JEP 395, JEP 394 |
| Java 17 | Sealed classes (standard) | JEP 409 |
| Java 21 | Pattern matching for switch (standard); record patterns (standard) | JEP 441, JEP 440 |
| Java 21 | Virtual threads — new thread type in platform | JEP 444 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 Virtual Method Table (vtable)
- HotSpot JVM uses a vtable per class for virtual method dispatch.
- Entries point to method bytecode (or JIT-compiled native code).
- Interface dispatch uses an itable (interface table) — slightly slower than vtable.
- JIT's inline caching: monomorphic call site compiles to direct call after seeing one class.
- Bimorphic and megamorphic call sites: different optimization strategies.

### 9.2 Object Memory Layout (HotSpot)
- Object header: 8 bytes (32-bit) or 12 bytes (64-bit with compressed oops).
- Fields follow in order: superclass fields first, then subclass fields.
- JVM may reorder fields for alignment efficiency.
- `java.lang.Object` has no instance fields (header only).

### 9.3 `instanceof` and `checkcast`
- `instanceof` compiles to `instanceof` bytecode — checks class hierarchy at runtime.
- Pattern matching `instanceof` additionally assigns the variable if check passes.
- `checkcast` is used for explicit casts — throws `ClassCastException` on failure.

### 9.4 Records vs Traditional Classes
- Records compile to `final` classes with `private final` fields.
- Accessors compile to regular instance methods (no `get` prefix).
- `equals()`, `hashCode()`, `toString()` are synthesized by the compiler.
- Compact constructors compile to a regular constructor.

### 9.5 Enum JVM Implementation
- Enum constants are `public static final` fields of the enum class.
- JVM initializes them as static fields during class initialization.
- `Enum.name()` returns the constant's identifier.
- `Enum.ordinal()` returns the 0-based position.
- Enum serialization: by name (not ordinal) — `readResolve()` returns the canonical instance.

---

## 10. Spec Compliance Checklist

- [ ] Abstract classes not instantiated directly
- [ ] `final` classes not extended
- [ ] Overriding method is not more restrictive in access
- [ ] Overriding method does not add new checked exceptions
- [ ] `@Override` annotation on all intended overrides
- [ ] Constructor calls `super(...)` or `this(...)` as first statement
- [ ] No circular `this(...)` constructor chains
- [ ] Interface default method conflicts resolved by overriding
- [ ] Record components are final and cannot be mutated post-construction
- [ ] Enums not instantiated with `new`; use constants or `valueOf()`
- [ ] Fields are private with public accessors (encapsulation)
- [ ] `static` fields/methods accessed via class name, not instance reference

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Classes, Inheritance, Polymorphism
// File: OopBasics.java
public class OopBasics {

    // Abstract superclass
    abstract static class Shape {
        protected String color;

        Shape(String color) {
            this.color = color;
        }

        abstract double area();
        abstract double perimeter();

        @Override
        public String toString() {
            return "%s[color=%s, area=%.2f]".formatted(
                getClass().getSimpleName(), color, area());
        }
    }

    // Concrete subclass
    static class Circle extends Shape {
        private final double radius;

        Circle(String color, double radius) {
            super(color);  // call superclass constructor
            this.radius = radius;
        }

        @Override
        public double area() { return Math.PI * radius * radius; }

        @Override
        public double perimeter() { return 2 * Math.PI * radius; }
    }

    static class Rectangle extends Shape {
        private final double width, height;

        Rectangle(String color, double width, double height) {
            super(color);
            this.width = width;
            this.height = height;
        }

        @Override
        public double area() { return width * height; }

        @Override
        public double perimeter() { return 2 * (width + height); }
    }

    public static void main(String[] args) {
        Shape[] shapes = {
            new Circle("red", 5.0),
            new Rectangle("blue", 4.0, 6.0),
            new Circle("green", 3.0)
        };

        for (Shape s : shapes) {
            System.out.println(s);  // polymorphic toString and area()
        }

        // Pattern matching with sealed types
        for (Shape s : shapes) {
            String desc = switch (s) {
                case Circle c    -> "Circle with radius " + c.radius;
                case Rectangle r -> "Rect " + r.width + "x" + r.height;
                default          -> "Unknown shape";
            };
            System.out.println(desc);
        }
    }
}
```

```java
// Example 2: Interfaces with Default Methods
// File: InterfaceDemo.java
import java.util.Comparator;

public class InterfaceDemo {

    // Interface with abstract and default methods
    interface Printable {
        void print();  // abstract

        default void printTwice() {  // default
            print();
            print();
        }

        static Printable of(String msg) {  // static factory
            return () -> System.out.println(msg);
        }
    }

    interface Saveable {
        void save();

        default String describe() { return "Saveable"; }
    }

    // Class implementing multiple interfaces
    static class Document implements Printable, Saveable {
        private final String content;

        Document(String content) { this.content = content; }

        @Override
        public void print() { System.out.println("Doc: " + content); }

        @Override
        public void save() { System.out.println("Saving: " + content); }

        @Override
        public String describe() { return "Document"; }  // resolves ambiguity
    }

    interface Sortable<T> extends Comparable<T> {
        default boolean isLessThan(T other) {
            return compareTo(other) < 0;
        }
    }

    static class Version implements Sortable<Version> {
        final int major, minor;

        Version(int major, int minor) {
            this.major = major;
            this.minor = minor;
        }

        @Override
        public int compareTo(Version other) {
            int cmp = Integer.compare(this.major, other.major);
            return cmp != 0 ? cmp : Integer.compare(this.minor, other.minor);
        }

        @Override
        public String toString() { return major + "." + minor; }
    }

    public static void main(String[] args) {
        Document doc = new Document("Hello, Java!");
        doc.printTwice();
        doc.save();
        System.out.println(doc.describe());

        // Static factory method on interface
        Printable p = Printable.of("From static factory");
        p.print();

        // Interface type variable
        Version v1 = new Version(2, 0);
        Version v2 = new Version(1, 9);
        System.out.println(v2 + " < " + v1 + ": " + v2.isLessThan(v1));  // true
    }
}
```

```java
// Example 3: Encapsulation with Accessors and Mutators
// File: Encapsulation.java
import java.util.Objects;

public class Encapsulation {

    static class BankAccount {
        private final String accountId;
        private double balance;
        private String owner;

        BankAccount(String accountId, String owner, double initialBalance) {
            this.accountId = Objects.requireNonNull(accountId, "accountId cannot be null");
            this.owner = Objects.requireNonNull(owner, "owner cannot be null");
            if (initialBalance < 0) throw new IllegalArgumentException("Initial balance must be >= 0");
            this.balance = initialBalance;
        }

        // Accessor (getter)
        public String getAccountId() { return accountId; }
        public double getBalance() { return balance; }
        public String getOwner() { return owner; }

        // Mutator (setter)
        public void setOwner(String owner) {
            this.owner = Objects.requireNonNull(owner, "owner cannot be null");
        }

        // Business logic methods
        public void deposit(double amount) {
            if (amount <= 0) throw new IllegalArgumentException("Deposit must be positive");
            balance += amount;
        }

        public void withdraw(double amount) {
            if (amount <= 0) throw new IllegalArgumentException("Withdrawal must be positive");
            if (amount > balance) throw new IllegalStateException("Insufficient funds");
            balance -= amount;
        }

        @Override
        public String toString() {
            return "Account[%s, owner=%s, balance=%.2f]".formatted(accountId, owner, balance);
        }
    }

    public static void main(String[] args) {
        BankAccount account = new BankAccount("ACC-001", "Alice", 1000.00);
        System.out.println(account);

        account.deposit(500.00);
        System.out.println("After deposit: " + account.getBalance());

        account.withdraw(200.00);
        System.out.println("After withdrawal: " + account.getBalance());

        try {
            account.withdraw(2000.00);
        } catch (IllegalStateException e) {
            System.out.println("Error: " + e.getMessage());
        }
    }
}
```

```java
// Example 4: Records and Sealed Classes (Java 21)
// File: ModernOop.java
public class ModernOop {

    // Sealed interface hierarchy
    sealed interface Result<T> permits Success, Failure {}

    record Success<T>(T value) implements Result<T> {}

    record Failure<T>(String error, Exception cause) implements Result<T> {
        Failure(String error) { this(error, null); }
    }

    // Enum with methods and fields
    enum Planet {
        MERCURY(3.303e+23, 2.4397e6),
        VENUS  (4.869e+24, 6.0518e6),
        EARTH  (5.976e+24, 6.37814e6),
        MARS   (6.421e+23, 3.3972e6);

        private final double mass;    // kg
        private final double radius;  // meters

        Planet(double mass, double radius) {
            this.mass = mass;
            this.radius = radius;
        }

        static final double G = 6.67300E-11;

        double surfaceGravity() {
            return G * mass / (radius * radius);
        }

        double surfaceWeight(double otherMass) {
            return otherMass * surfaceGravity();
        }
    }

    // Generic utility with sealed result
    static Result<Integer> safeDivide(int a, int b) {
        if (b == 0) return new Failure<>("Division by zero");
        return new Success<>(a / b);
    }

    static <T> T unwrapOrDefault(Result<T> result, T defaultValue) {
        return switch (result) {
            case Success<T> s -> s.value();
            case Failure<T> f -> {
                System.err.println("Error: " + f.error());
                yield defaultValue;
            }
        };
    }

    public static void main(String[] args) {
        // Records
        Result<Integer> r1 = safeDivide(10, 2);
        Result<Integer> r2 = safeDivide(10, 0);

        System.out.println(unwrapOrDefault(r1, -1));  // 5
        System.out.println(unwrapOrDefault(r2, -1));  // -1 (with error logged)

        // Enum usage
        double earthWeight = 75.0;
        double mass = earthWeight / Planet.EARTH.surfaceGravity();
        for (Planet p : Planet.values()) {
            System.out.printf("Weight on %s: %.2f%n", p, p.surfaceWeight(mass));
        }
    }
}
```

```java
// Example 5: Complete OOP Design — Strategy Pattern
// File: StrategyPattern.java
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

public class StrategyPattern {

    // Interface (strategy)
    @FunctionalInterface
    interface SortStrategy<T> {
        List<T> sort(List<T> items);
    }

    // Concrete strategies
    static <T extends Comparable<T>> SortStrategy<T> naturalOrder() {
        return items -> items.stream().sorted().toList();
    }

    static <T> SortStrategy<T> by(Comparator<T> comparator) {
        return items -> items.stream().sorted(comparator).toList();
    }

    // Context class
    static class DataProcessor<T extends Comparable<T>> {
        private final List<T> data;
        private SortStrategy<T> strategy;

        DataProcessor(List<T> data) {
            this.data = List.copyOf(data);
            this.strategy = naturalOrder();  // default strategy
        }

        void setStrategy(SortStrategy<T> strategy) {
            this.strategy = strategy;
        }

        List<T> process() {
            return strategy.sort(data);
        }
    }

    record Employee(String name, int age, double salary) {}

    public static void main(String[] args) {
        List<Employee> employees = List.of(
            new Employee("Charlie", 35, 80000),
            new Employee("Alice", 28, 95000),
            new Employee("Bob", 42, 70000)
        );

        DataProcessor<String> nameProcessor = new DataProcessor<>(
            employees.stream().map(Employee::name).toList()
        );

        // Default: natural order
        System.out.println("Names sorted: " + nameProcessor.process());

        // Custom strategy: reverse order
        nameProcessor.setStrategy(by(Comparator.reverseOrder()));
        System.out.println("Names reversed: " + nameProcessor.process());

        // Strategy using method reference
        List<Employee> byAge = employees.stream()
            .sorted(Comparator.comparingInt(Employee::age))
            .toList();
        byAge.forEach(e -> System.out.printf("%s: %d%n", e.name(), e.age()));

        // Pattern matching for records
        for (var emp : employees) {
            switch (emp) {
                case Employee(String n, int age, double sal) when sal > 85000 ->
                    System.out.println(n + " is a high earner");
                case Employee(String n, _, _) ->
                    System.out.println(n + " is a regular employee");
            }
        }
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §8 | Classes | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html |
| JLS §9 | Interfaces | https://docs.oracle.com/javase/specs/jls/se21/html/jls-9.html |
| JLS §8.1 | Class Declarations | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.1 |
| JLS §8.4.8 | Method Overriding | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.4.8 |
| JLS §8.8 | Constructor Declarations | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.8 |
| JLS §8.9 | Enum Types | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.9 |
| JLS §8.10 | Record Classes | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.10 |
| JLS §9.4.3 | Default Methods | https://docs.oracle.com/javase/specs/jls/se21/html/jls-9.html#jls-9.4.3 |
| JEP 395 | Records | https://openjdk.org/jeps/395 |
| JEP 409 | Sealed Classes | https://openjdk.org/jeps/409 |
| JEP 441 | Pattern Matching for switch | https://openjdk.org/jeps/441 |
| JEP 440 | Record Patterns | https://openjdk.org/jeps/440 |
