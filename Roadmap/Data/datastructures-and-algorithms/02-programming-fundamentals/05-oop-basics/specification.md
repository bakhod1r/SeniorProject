# OOP Basics — Specification

> **Official / Authoritative Reference**
> Source: [Goldberg & Robson — "Smalltalk-80: The Language and Its Implementation" (1983)](http://stephane.ducasse.free.fr/FreeBooks/BlueBook/Bluebook.pdf) — Ch. 1–3;
> [ISO/IEC 14882:2020 (C++ Standard)](https://isocpp.org/std/the-standard) — §11 (Classes), §12 (Derived classes);
> [Liskov & Wing (1994) "A Behavioral Notion of Subtyping"](https://doi.org/10.1145/197320.197343) — ACM TOPLAS 16(6):1811–1841;
> [Java Language Specification (JLS) — §8 Classes, §9 Interfaces](https://docs.oracle.com/javase/specs/jls/se21/html/index.html)

---

## Table of Contents

1. [Reference](#1-reference)
2. [Formal Definition / Grammar](#2-formal-definition-grammar)
3. [Core Rules & Constraints](#3-core-rules-constraints)
4. [Type / Category Rules](#4-type-category-rules)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Defined vs Undefined Behavior](#6-defined-vs-undefined-behavior)
7. [Edge Cases](#7-edge-cases)
8. [Version / Evolution History](#8-version-evolution-history)
9. [Implementation Notes](#9-implementation-notes)
10. [Compliance Checklist](#10-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Topics](#12-related-topics)

---

## 1. Reference

| Attribute       | Value                                                                               |
|-----------------|-------------------------------------------------------------------------------------|
| Formal Name     | Object-Oriented Programming (OOP)                                                   |
| Primary Source  | Goldberg & Robson — Smalltalk-80 (1983); Alan Kay (Smalltalk creator, coined "OOP") |
| C++ Standard    | ISO/IEC 14882:2020 — §11 Classes, §12 Derived classes, §13 Overloading             |
| Java Standard   | JLS 21 — §8 Classes, §9 Interfaces, §10 Arrays                                     |
| LSP             | Liskov & Wing (1994). TOPLAS 16(6). doi:10.1145/197320.197343                       |
| Python Source   | https://docs.python.org/3/reference/datamodel.html                                  |

**Alan Kay's original definition of OOP (1967, Simula → Smalltalk):**
> "OOP to me means only messaging, local retention and protection and hiding of state-process, and extreme late-binding of all things."

The four universally recognized pillars of OOP:
1. **Encapsulation** — bundling data and behavior; hiding implementation
2. **Abstraction** — exposing essential features; hiding complexity
3. **Inheritance** — code reuse via IS-A relationships
4. **Polymorphism** — one interface, multiple behaviors

---

## 2. Formal Definition / Grammar

### 2.1 Class — Formal Definition

**From ISO/IEC 14882:2020 §11.1 (C++ Standard):**
> "A class is a type. Its name becomes a class-name (9.2.9.2) within its scope."

A **class** C formally defines:
- A **state space**: a set of typed fields (attributes/instance variables)
- A **behavior**: a set of methods (operations)
- **Class invariant**: a predicate I(σ) that must hold for all instances at observable points

```
Class C = (Fields, Methods, Invariant)

Fields  = {(name₁ : T₁), (name₂ : T₂), ..., (nameₙ : Tₙ)}
Methods = {m₁ : (T₁ × T₂ × ... × Tk) → Tr, ...}
Invariant = I(self) : predicate over Fields
```

**Object** = instance of a class:
- **Identity**: unique memory address (reference/pointer)
- **State**: current values of all fields
- **Behavior**: methods defined by its class

### 2.2 Python Class Grammar (Official Data Model)

From https://docs.python.org/3/reference/compound_stmts.html#class-definitions:

```peg
classdef:
    | decorators 'class' NAME ['(' [argument_list] ')'] ':' block

# Python class body:
class_body:
    | { class_variable_assignment | method_definition | nested_class }

method_definition:
    | ['@' decorator] 'def' NAME '(' ['self' [, params]] ')' ['->' annotation] ':' block
```

### 2.3 Java Class Grammar (JLS §8.1)

```bnf
ClassDeclaration ::=
    NormalClassDeclaration | EnumDeclaration | RecordDeclaration

NormalClassDeclaration ::=
    {ClassModifier} 'class' TypeIdentifier [TypeParameters]
    [ClassExtends] [ClassImplements] [ClassPermits] ClassBody

ClassModifier ::=
    (one of) public | protected | private | abstract | static | final | sealed

ClassExtends ::= 'extends' ClassType
ClassImplements ::= 'implements' InterfaceTypeList

FieldDeclaration ::=
    {FieldModifier} UnannType VariableDeclaratorList ';'

MethodDeclaration ::=
    {MethodModifier} MethodHeader MethodBody
```

---

## 3. Core Rules & Constraints

### 3.1 The Four Pillars

#### Pillar 1: Encapsulation

**Definition**: Bundling data (fields) and methods that operate on that data into a single unit (class), while restricting direct external access to internal state.

**Access modifiers** (Java/C++ specification):

| Modifier    | Class | Package | Subclass | World |
|-------------|-------|---------|----------|-------|
| `public`    | Yes   | Yes     | Yes      | Yes   |
| `protected` | Yes   | Yes     | Yes      | No    |
| (default/package-private) | Yes | Yes | No | No |
| `private`   | Yes   | No      | No       | No    |

**Purpose**: Protect invariants. External code cannot corrupt internal state directly.

```java
public class BankAccount {
    private double balance;   // Encapsulated — cannot be directly modified

    public void deposit(double amount) {
        if (amount <= 0) throw new IllegalArgumentException("Amount must be positive");
        balance += amount;    // Invariant maintained: balance never negative
    }

    public double getBalance() {
        return balance;       // Controlled access via getter
    }
}
```

#### Pillar 2: Abstraction

**Definition**: Representing essential features without exposing implementation details. A class provides an **interface** (what it does) separate from its **implementation** (how it does it).

**Abstract class** (Java/C++):
- Contains at least one abstract method (declared but not implemented)
- Cannot be instantiated directly
- Subclasses must implement all abstract methods

**Interface**:
- Pure contract — all methods abstract (traditionally)
- No state (fields are public static final by default in Java)
- A class can implement multiple interfaces

```java
// Abstract class — partial implementation
abstract class Shape {
    protected String color;

    public Shape(String color) {
        this.color = color;
    }

    public abstract double area();    // Subclasses MUST implement
    public abstract double perimeter(); // Subclasses MUST implement

    public String describe() {        // Concrete method — shared behavior
        return color + " shape with area " + area();
    }
}

// Interface — pure contract
interface Drawable {
    void draw();   // Abstract by default (Java interface)
}
```

#### Pillar 3: Inheritance

**Definition** (JLS §8.1.4):
> "A class C directly extends class C' if C is declared with an extends clause naming C'."

The **IS-A** relationship:
- If `Dog extends Animal`, then every Dog IS-A Animal
- A subclass inherits all non-private fields and methods of its superclass

**Inheritance hierarchy:**
```
Object (root class — Java/Python)
└── Animal
    ├── Dog
    │   ├── Poodle
    │   └── Labrador
    └── Cat
```

**Single vs Multiple Inheritance:**

| Language | Single Inheritance | Multiple Inheritance | Multiple Interface |
|----------|-------------------|---------------------|-------------------|
| Java     | Yes               | No (classes)        | Yes               |
| Python   | Yes               | Yes (MRO)           | Yes               |
| C++      | Yes               | Yes                 | Yes               |
| C#       | Yes               | No (classes)        | Yes               |

#### Pillar 4: Polymorphism

**Definition**: "Poly" (many) + "morph" (form) — one interface, multiple implementations.

Three types:

1. **Subtype polymorphism** (runtime polymorphism, dynamic dispatch):
   - Method called depends on the *runtime type* of the object, not the static type
   - Implemented via virtual function table (vtable) in C++, method dispatch table in Java/Python

2. **Parametric polymorphism** (compile-time, generics/templates):
   - Algorithm works for any type T satisfying constraints
   - Java: `List<T>`, C++: `template<typename T>`, Python: type hints with `TypeVar`

3. **Ad-hoc polymorphism** (function overloading):
   - Same function name, different parameter types
   - Java/C++: multiple `add(int, int)` and `add(double, double)` methods
   - Python: no true overloading (use `*args` or type checking)

### 3.2 Liskov Substitution Principle (LSP)

**Formal statement** (Liskov & Wing, 1994 — TOPLAS 16(6)):

> "Let φ(x) be a property provable about objects x of type T. Then φ(y) should be true for objects y of type S where S is a subtype of T."

In practical terms:
> If S is a subtype of T, then objects of type T in a program may be replaced by objects of type S without altering any of the desirable properties of that program.

**LSP requires:**
1. **Contravariance of method parameter types**: parameter types in the subtype may be *broader* than in the supertype
2. **Covariance of method return types**: return types in the subtype may be *narrower* than in the supertype
3. **No new exceptions**: subtype methods must not throw exceptions not in the supertype's specification
4. **Precondition weakening**: subtype methods may require no more than the supertype
5. **Postcondition strengthening**: subtype methods must guarantee at least as much as the supertype
6. **Invariant preservation**: class invariants of the supertype must hold in the subtype

**Classic LSP violation — Square extends Rectangle:**

```java
class Rectangle {
    protected int width, height;
    public void setWidth(int w) { this.width = w; }
    public void setHeight(int h) { this.height = h; }
    public int area() { return width * height; }
}

class Square extends Rectangle {
    @Override
    public void setWidth(int w) { this.width = this.height = w; }  // Violates LSP!
    @Override
    public void setHeight(int h) { this.width = this.height = h; } // Violates LSP!
}

// LSP violation:
void resizeRectangle(Rectangle r) {
    r.setWidth(5);
    r.setHeight(3);
    assert r.area() == 15;  // Fails for Square! area = 9
}
```

---

## 4. Type / Category Rules

### 4.1 Class Taxonomy

```
Class Types
├── Concrete class — fully implemented; can be instantiated
├── Abstract class — partially implemented; cannot be instantiated
├── Interface — pure contract; no implementation (traditionally)
├── Final class — cannot be subclassed (Java: final, C++: final specifier)
├── Sealed class — restricted inheritance; permitted subclasses named (Java 17+, C# 9+)
├── Anonymous class — defined inline, no name (Java inner class)
├── Singleton class — only one instance allowed
└── Generic class — parameterized by type T
```

### 4.2 Method Types

| Method Type       | Description                                      | Python              | Java               |
|-------------------|--------------------------------------------------|---------------------|--------------------|
| Instance method   | Operates on an instance; first param = `self`/`this` | `def m(self):`  | `void m()`         |
| Class method      | Operates on the class itself                    | `@classmethod`      | `static void m()`  |
| Static method     | No access to instance or class                   | `@staticmethod`     | `static void m()`  |
| Abstract method   | Declared, not implemented; must override         | `@abstractmethod`   | `abstract void m()`|
| Final method      | Cannot be overridden in subclasses               | (convention: not overriding) | `final void m()` |
| Constructor       | Initializes new instance                         | `__init__`          | `ClassName()`      |
| Destructor        | Called when object is destroyed                  | `__del__`           | `finalize()` (deprecated) |

---

## 5. Behavioral Specification

### 5.1 Object Creation

**Object lifecycle:**
1. **Allocation**: Memory allocated for the object's fields
2. **Initialization**: Constructor (`__init__` / constructor method) sets field values
3. **Usage**: Methods are called; state may change
4. **Destruction**: Object becomes unreachable; garbage collector reclaims memory

```python
class Point:
    def __init__(self, x: float, y: float):
        """Constructor: initializes state."""
        self.x = x          # Instance field
        self.y = y          # Instance field

    def distance_to(self, other: 'Point') -> float:
        """Instance method: operates on self."""
        return ((self.x - other.x)**2 + (self.y - other.y)**2) ** 0.5

    def __repr__(self) -> str:
        return f"Point({self.x}, {self.y})"

p1 = Point(0, 0)    # Step 1: allocate; Step 2: __init__
p2 = Point(3, 4)
print(p1.distance_to(p2))   # 5.0
```

### 5.2 Method Resolution Order (MRO)

**Python MRO** (C3 Linearization, Python 3+):

For a class C with bases B1, B2, ..., Bk:
```
MRO(C) = C + merge(MRO(B1), MRO(B2), ..., MRO(Bk), [B1, B2, ..., Bk])
```

The merge algorithm:
1. Take the first head of each list
2. Select a head that does not appear in the tail of any other list
3. Remove that head from all lists; add to result
4. Repeat

```python
class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass

print(D.__mro__)
# (<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)
# MRO: D → B → C → A → object
```

**Java method dispatch (vtable)**:
- Each class has a virtual method table
- When a virtual method is called on a reference, the JVM looks up the actual type's vtable
- Static binding: private, static, final methods (resolved at compile time)
- Dynamic binding: all other instance methods (resolved at runtime)

### 5.3 Polymorphic Dispatch

```python
class Animal:
    def sound(self) -> str:
        raise NotImplementedError("Subclasses must implement sound()")

class Dog(Animal):
    def sound(self) -> str:
        return "Woof"

class Cat(Animal):
    def sound(self) -> str:
        return "Meow"

def make_sounds(animals: list) -> None:
    """
    Polymorphic dispatch: the correct sound() method is called
    based on the RUNTIME type of each object, not the static type 'Animal'.
    """
    for animal in animals:
        print(animal.sound())   # Dynamic dispatch

make_sounds([Dog(), Cat(), Dog()])
# Woof
# Meow
# Woof
```

```java
// Java — runtime polymorphism via vtable
Animal[] animals = { new Dog(), new Cat(), new Dog() };
for (Animal a : animals) {
    System.out.println(a.sound());   // Dispatched at runtime
}
```

### 5.4 Constructor Chaining

```python
class Vehicle:
    def __init__(self, make: str, model: str, year: int):
        self.make = make
        self.model = model
        self.year = year

class Car(Vehicle):
    def __init__(self, make: str, model: str, year: int, doors: int):
        super().__init__(make, model, year)   # Call parent constructor
        self.doors = doors

class ElectricCar(Car):
    def __init__(self, make: str, model: str, year: int, doors: int, range_km: int):
        super().__init__(make, model, year, doors)  # Call Car constructor
        self.range_km = range_km
```

---

## 6. Defined vs Undefined Behavior

| Situation                               | Status       | Notes                                                      |
|-----------------------------------------|--------------|------------------------------------------------------------|
| Calling method on valid object          | Defined      | Normal dispatch                                            |
| Calling method on `None`/`null`         | Runtime error | Python: AttributeError; Java: NullPointerException        |
| Accessing private field from subclass   | Compile error | Not allowed in Java/C++; Python uses name mangling        |
| Overriding non-virtual method (C++)     | Defined*     | Hides, does not override; object type determines dispatch  |
| Diamond inheritance without MRO         | Impl-defined | C++: ambiguous unless virtual inheritance used             |
| Diamond inheritance in Python           | Defined      | C3 MRO resolves deterministically                          |
| Instantiating abstract class            | Runtime error | Python: TypeError; Java: compile error                    |
| Missing interface method implementation | Compile error | Java: must implement all interface methods                 |
| Circular inheritance                    | Error        | `class A(B)` and `class B(A)` — TypeError in Python       |
| Constructor throws exception            | Defined      | Object is not created; memory may be reclaimed             |

---

## 7. Edge Cases

### 7.1 The Diamond Problem

```
      A
     / \
    B   C
     \ /
      D
```

When D inherits from both B and C, and both inherit from A:
- Which version of A's method does D inherit?

**Python solution — C3 MRO:**
```python
class A:
    def greet(self): print("Hello from A")

class B(A):
    def greet(self): print("Hello from B")

class C(A):
    def greet(self): print("Hello from C")

class D(B, C):
    pass

D().greet()  # "Hello from B" — MRO: D → B → C → A
print(D.__mro__)  # (D, B, C, A, object)
```

**C++ solution — virtual inheritance:**
```cpp
class A { public: virtual void greet() { } };
class B : virtual public A { };
class C : virtual public A { };
class D : public B, public C { };
// Only one copy of A's data exists in D
```

### 7.2 `super()` in Multiple Inheritance

```python
class A:
    def method(self):
        print("A.method")

class B(A):
    def method(self):
        print("B.method")
        super().method()    # Calls next in MRO (not necessarily A)

class C(A):
    def method(self):
        print("C.method")
        super().method()    # Calls next in MRO

class D(B, C):
    def method(self):
        print("D.method")
        super().method()

D().method()
# D.method → B.method → C.method → A.method
# super() follows the MRO, not the direct parent
```

### 7.3 Type Checking vs Duck Typing

```python
# Python uses DUCK TYPING: "If it walks like a duck and quacks like a duck, it IS a duck"
# No need for explicit inheritance; method presence is sufficient

class Duck:
    def quack(self): print("Quack!")
    def walk(self): print("Walk...")

class Person:
    def quack(self): print("I'm quacking like a duck!")
    def walk(self): print("I'm walking like a duck!")

def in_the_pond(duck):
    duck.quack()    # Works for ANY object with a 'quack' method
    duck.walk()

in_the_pond(Duck())    # Works
in_the_pond(Person())  # Also works — duck typing, no isinstance() check needed
```

### 7.4 `__slots__` — Fixed Attribute Set

```python
class OptimizedPoint:
    __slots__ = ['x', 'y']   # Only these attributes allowed

    def __init__(self, x, y):
        self.x = x
        self.y = y

p = OptimizedPoint(1, 2)
# p.z = 3  # AttributeError: 'OptimizedPoint' has no attribute 'z'
# Memory: ~40-50% less per instance vs regular dict-backed object
```

---

## 8. Version / Evolution History

| Year | Event                                                                                      |
|------|--------------------------------------------------------------------------------------------|
| 1967 | Simula 67 (Nygaard & Dahl) — first OOP language; classes, objects, inheritance             |
| 1972 | Smalltalk-72 (Kay et al., Xerox PARC) — everything is an object; message passing           |
| 1980 | Smalltalk-80 — full OOP spec; influenced all modern OOP languages                         |
| 1983 | Goldberg & Robson "Smalltalk-80: The Language" — definitive OOP reference                  |
| 1983 | C++ (Stroustrup) — adds classes to C; virtual functions; multiple inheritance             |
| 1985 | "Object-Oriented Design with Applications" — Grady Booch                                  |
| 1991 | Python 0.9 — classes from the start; multiple inheritance                                 |
| 1995 | Java 1.0 — single inheritance, interfaces; JVM; GC; no pointers                           |
| 1995 | ISO/IEC 14882 (C++ standard) — first C++ ISO standard                                    |
| 1994 | Liskov & Wing — formal LSP definition (TOPLAS 16(6))                                      |
| 1994 | "Design Patterns" (GoF — Gamma, Helm, Johnson, Vlissides) — 23 OOP design patterns       |
| 2000 | Python 2.2 — new-style classes; `object` as root; descriptors; `super()`                 |
| 2001 | Java 5 — Generics (parametric polymorphism); annotations; enums                           |
| 2004 | Python 2.4 — `@decorator` syntax; `@classmethod`, `@staticmethod`                        |
| 2008 | Python 3.0 — `super()` without arguments; `__init_subclass__`                            |
| 2011 | Java 7 — `try`-with-resources; diamond operator `<>`                                      |
| 2014 | Java 8 — default interface methods; lambda expressions; streams                           |
| 2017 | Java 9 — `private` interface methods                                                       |
| 2019 | Python 3.7 — `@dataclass` — auto-generate `__init__`, `__repr__`, `__eq__`               |
| 2021 | Java 17 LTS — sealed classes; records; pattern matching                                    |
| 2023 | Python 3.12 — `@override` decorator (PEP 698); type parameter syntax (PEP 695)           |

---

## 9. Implementation Notes

### 9.1 Memory Layout of Objects

**Python object memory model:**
- Every Python object has: type pointer, reference count, value/pointer(s)
- Instance `__dict__`: a hash table storing all instance attributes
- `__slots__`: replaces `__dict__` with fixed-size struct — ~40% less memory

**Java object memory (JVM HotSpot):**
- Object header: mark word (8 bytes) + class pointer (4 or 8 bytes)
- Fields: laid out contiguously, aligned
- vtable pointer: one per class, not per instance

### 9.2 Vtable (Virtual Function Table)

C++ dispatch mechanism — each class with virtual methods has a vtable:

```
vtable for Animal:
  [0] → Animal::sound()     // offset 0: pointer to sound()

vtable for Dog (inherits Animal):
  [0] → Dog::sound()        // Override: points to Dog's implementation

// At runtime:
Animal* a = new Dog();
a->sound();   // Loads vtable pointer from Dog object → calls Dog::sound()
```

Python equivalent: `__dict__` + MRO lookup chain.

### 9.3 Complexity of OOP Operations

| Operation                       | Time    | Notes                                             |
|---------------------------------|---------|---------------------------------------------------|
| Object creation                 | O(1)    | Memory allocation + constructor call              |
| Attribute access (dict-backed)  | O(1) avg| Hash table lookup                                 |
| Attribute access (`__slots__`)  | O(1)    | Direct struct offset                              |
| Method call (no dispatch)       | O(1)    | Bound method call                                 |
| Virtual method dispatch (vtable)| O(1)    | Vtable pointer + offset lookup                    |
| `isinstance(obj, cls)`          | O(depth)| Traverses inheritance hierarchy                   |
| MRO computation                 | O(n)    | C3 linearization; n = number of bases             |
| `super()` method call           | O(n)    | Follow MRO until found; usually O(1) in practice  |

### 9.4 Python Dataclasses

```python
from dataclasses import dataclass, field
from typing import ClassVar

@dataclass
class Student:
    """Auto-generates __init__, __repr__, __eq__ based on fields."""
    name: str
    student_id: int
    grades: list[float] = field(default_factory=list)  # Mutable default: safe
    school: ClassVar[str] = "MIT"  # Class variable; not included in __init__

    def gpa(self) -> float:
        if not self.grades:
            return 0.0
        return sum(self.grades) / len(self.grades)

s1 = Student("Alice", 1001)
s2 = Student("Bob", 1002, [3.8, 3.9, 4.0])
print(s2.gpa())    # 3.9
print(s1 == s2)    # False — __eq__ compares fields
```

---

## 10. Compliance Checklist

- [ ] Every class has a clear, single responsibility (SRP)
- [ ] Fields are private/protected; accessed via methods (encapsulation)
- [ ] Class invariants are maintained by all mutator methods
- [ ] Subclasses satisfy the Liskov Substitution Principle
- [ ] No new exceptions thrown by overriding methods beyond supertype's contract
- [ ] Abstract methods documented with expected contract
- [ ] Multiple inheritance (Python) uses cooperative `super()` calls
- [ ] `__init__` validates preconditions on input parameters
- [ ] `__repr__` and `__str__` implemented for meaningful output
- [ ] `__eq__` and `__hash__` are consistent (if equal, must have same hash)
- [ ] Mutable default arguments not used in `__init__` (`field(default_factory=...)`)
- [ ] `isinstance()` used sparingly; prefer polymorphism over type checks
- [ ] Composition considered before inheritance ("favor composition over inheritance" — GoF)

---

## 11. Official Examples

### 11.1 Full Class Hierarchy — Python

```python
from abc import ABC, abstractmethod
from typing import List
import math

# Abstract base class (Pillar 2: Abstraction)
class Shape(ABC):
    """
    Abstract class for geometric shapes.
    Class invariant: All shapes have a non-negative area.
    """

    def __init__(self, color: str = "white"):
        self._color = color   # Encapsulated (Pillar 1)

    @property
    def color(self) -> str:
        return self._color    # Controlled access

    @abstractmethod
    def area(self) -> float:
        """Returns the area of the shape."""
        pass

    @abstractmethod
    def perimeter(self) -> float:
        """Returns the perimeter of the shape."""
        pass

    def describe(self) -> str:
        """Concrete method — shared behavior."""
        return f"{self._color} {type(self).__name__}: area={self.area():.2f}"

    def __repr__(self) -> str:
        return f"{type(self).__name__}(color={self._color!r})"


# Concrete classes (Pillar 3: Inheritance)
class Circle(Shape):
    def __init__(self, radius: float, color: str = "red"):
        super().__init__(color)
        if radius <= 0:
            raise ValueError(f"Radius must be positive, got {radius}")
        self._radius = radius

    def area(self) -> float:
        return math.pi * self._radius ** 2

    def perimeter(self) -> float:
        return 2 * math.pi * self._radius


class Rectangle(Shape):
    def __init__(self, width: float, height: float, color: str = "blue"):
        super().__init__(color)
        if width <= 0 or height <= 0:
            raise ValueError("Width and height must be positive")
        self._width = width
        self._height = height

    def area(self) -> float:
        return self._width * self._height

    def perimeter(self) -> float:
        return 2 * (self._width + self._height)


class Square(Rectangle):
    """Square IS-A Rectangle (valid if LSP is respected here)."""

    def __init__(self, side: float, color: str = "green"):
        super().__init__(side, side, color)
        # Note: We do NOT override setters, so LSP is maintained here

    def perimeter(self) -> float:
        return 4 * self._width


# Polymorphism (Pillar 4)
def print_shapes(shapes: List[Shape]) -> None:
    """Works for ANY Shape subtype — polymorphic dispatch."""
    for shape in shapes:
        print(shape.describe())   # Calls correct area() at runtime

shapes = [Circle(5), Rectangle(4, 6), Square(3)]
print_shapes(shapes)
# red Circle: area=78.54
# blue Rectangle: area=24.00
# green Square: area=9.00
```

### 11.2 Interface Implementation — Java

```java
// Interface — pure contract (JLS §9)
public interface Comparable<T> {
    int compareTo(T other);   // Returns negative, 0, or positive
}

public interface Printable {
    void print();
}

// Class implementing multiple interfaces
public class Student implements Comparable<Student>, Printable {
    private final String name;
    private final double gpa;

    public Student(String name, double gpa) {
        this.name = name;
        this.gpa = gpa;
    }

    @Override
    public int compareTo(Student other) {
        return Double.compare(this.gpa, other.gpa);   // Compare by GPA
    }

    @Override
    public void print() {
        System.out.printf("Student: %s, GPA: %.2f%n", name, gpa);
    }

    // Getter methods — encapsulation
    public String getName() { return name; }
    public double getGpa() { return gpa; }
}

// Polymorphic usage:
List<Student> students = Arrays.asList(
    new Student("Alice", 3.9),
    new Student("Bob", 3.7),
    new Student("Carol", 3.8)
);
Collections.sort(students);   // Uses Student.compareTo() — polymorphic
students.forEach(Printable::print);
```

### 11.3 Generic Class — Parametric Polymorphism

```python
from typing import TypeVar, Generic, Optional, List

T = TypeVar('T')

class Stack(Generic[T]):
    """
    Generic stack — works for any type T.
    Parametric polymorphism: one implementation, many types.
    """

    def __init__(self) -> None:
        self._items: List[T] = []

    def push(self, item: T) -> None:
        """Push item onto the stack. O(1) amortized."""
        self._items.append(item)

    def pop(self) -> T:
        """Remove and return top item. O(1)."""
        if self.is_empty():
            raise IndexError("Pop from empty stack")
        return self._items.pop()

    def peek(self) -> T:
        """Return top item without removing. O(1)."""
        if self.is_empty():
            raise IndexError("Peek at empty stack")
        return self._items[-1]

    def is_empty(self) -> bool:
        return len(self._items) == 0

    def __len__(self) -> int:
        return len(self._items)

# Works for any type:
int_stack: Stack[int] = Stack()
int_stack.push(1)
int_stack.push(2)
print(int_stack.pop())   # 2

str_stack: Stack[str] = Stack()
str_stack.push("hello")
str_stack.push("world")
print(str_stack.pop())   # "world"
```

### 11.4 CLRS-Style Pseudocode for OOP Operations

```
// Pseudocode for polymorphic sort using Comparable interface

SORT-OBJECTS(A, n)
// Precondition: Each A[i] implements compareTo(A[j]) → {-1, 0, 1}
// Postcondition: A is sorted so A[i].compareTo(A[j]) ≤ 0 for i < j
1  for i = 2 to n
2      key = A[i]
3      j = i - 1
4      while j > 0 and A[j].compareTo(key) > 0
5          A[j + 1] = A[j]
6          j = j - 1
7      A[j + 1] = key
// Time: O(n²); works for any type implementing compareTo
```

---

## 12. Related Topics

| Topic                    | Relationship                                                        | Location                     |
|--------------------------|---------------------------------------------------------------------|------------------------------|
| Functions / Procedures   | Methods are functions bound to a class; constructors are functions  | `../04-functions/`           |
| Control Structures       | Method bodies use sequence, selection, iteration                    | `../03-control-structures/`  |
| Pseudocode               | CLRS-style object notation: `x.field`, `x.method()`               | `../02-pseudo-code/`         |
| Design Patterns (GoF)    | Creational, Structural, Behavioral — patterns built on OOP         | "Design Patterns" (GoF 1994) |
| SOLID Principles         | SRP, OCP, LSP, ISP, DIP — principled OOP design                   | Martin (2000)                |
| Generics / Templates     | Parametric polymorphism; type-safe containers                       | Java Generics; C++ templates |
| Abstract Data Types      | ADTs specified by interface; OOP classes implement ADTs            | CLRS §10 (Data Structures)   |
| Data Structures          | Trees, graphs, heaps implemented as classes                        | CLRS §10–14                  |
| Type Systems             | Static vs dynamic typing; nominal vs structural subtyping          | Pierce "Types and PL"        |
| Memory Management        | Object lifecycle; garbage collection; reference counting           | Python `gc`; JVM GC          |
