# Basic Syntax — Practical Tasks

## Table of Contents

1. [Junior Tasks](#junior-tasks)
2. [Middle Tasks](#middle-tasks)
3. [Senior Tasks](#senior-tasks)
4. [Questions](#questions)
5. [Mini Projects](#mini-projects)
6. [Challenge](#challenge)

---

## Junior Tasks

### Task 1: Hello World with Arguments

**Type:** 💻 Code

**Goal:** Practice creating a Java program, compiling, and using command-line arguments.

**Instructions:**
1. Create a file `Main.java` with a `public class Main`
2. In the `main` method, check if any command-line arguments were provided
3. If arguments exist, print "Hello, {name}!" for each argument
4. If no arguments, print "Hello, World!"

**Starter code:**

```java
public class Main {
    public static void main(String[] args) {
        // TODO: Check args.length
        // TODO: Loop through args and greet each name
        // TODO: Print "Hello, World!" if no args
    }
}
```

**Expected output:**
```
$ java Main
Hello, World!

$ java Main Alice Bob
Hello, Alice!
Hello, Bob!
```

**Evaluation criteria:**
- [ ] Code compiles with `javac Main.java`
- [ ] Handles zero arguments correctly
- [ ] Handles multiple arguments correctly
- [ ] Uses proper Java naming conventions

---

### Task 2: Multi-Method Calculator

**Type:** 💻 Code

**Goal:** Practice defining multiple methods and calling them from `main`.

**Instructions:**
1. Create static methods: `add`, `subtract`, `multiply`, `divide`
2. Each method takes two `double` parameters and returns a `double`
3. Handle division by zero by printing an error message
4. Call all four methods from `main` and print results

**Starter code:**

```java
public class Main {
    // TODO: Define add(double a, double b)
    // TODO: Define subtract(double a, double b)
    // TODO: Define multiply(double a, double b)
    // TODO: Define divide(double a, double b)

    public static void main(String[] args) {
        double a = 10.0;
        double b = 3.0;
        // TODO: Call each method and print results
    }
}
```

**Expected output:**
```
10.0 + 3.0 = 13.0
10.0 - 3.0 = 7.0
10.0 * 3.0 = 30.0
10.0 / 3.0 = 3.3333333333333335
10.0 / 0.0 = Error: Division by zero!
```

**Evaluation criteria:**
- [ ] All four methods defined and working
- [ ] Division by zero handled gracefully
- [ ] Methods use `static` keyword (called from static main)
- [ ] Output matches expected format

---

### Task 3: Comment Documentation

**Type:** 🎨 Design

**Goal:** Practice writing proper Javadoc comments.

**Instructions:**
1. Write a class `MathHelper` with three static methods: `factorial(int n)`, `isPrime(int n)`, `gcd(int a, int b)`
2. Add Javadoc comments to the class and each method
3. Include `@param`, `@return`, and `@throws` tags
4. Add inline comments explaining the algorithm logic

**Deliverable:** Complete `.java` file with proper documentation.

**Example format:**
```java
/**
 * Utility class for common mathematical operations.
 *
 * @author YourName
 * @version 1.0
 */
public class MathHelper {
    /**
     * Calculates the factorial of a non-negative integer.
     *
     * @param n the non-negative integer
     * @return n! (n factorial)
     * @throws IllegalArgumentException if n is negative
     */
    public static long factorial(int n) {
        // TODO: implement
    }
}
```

**Evaluation criteria:**
- [ ] Class-level Javadoc present
- [ ] Every method has `@param`, `@return`, and `@throws` tags
- [ ] Inline comments explain non-obvious logic
- [ ] Code compiles and methods produce correct results

---

### Task 4: Identifier Quiz Program

**Type:** 💻 Code

**Goal:** Practice using identifiers, keywords, and naming conventions.

**Instructions:**
1. Create a program that quizzes the user on Java identifier rules
2. Present 5 identifiers and ask the user if each is valid or invalid
3. Use a `Scanner` for input
4. Keep score and display results at the end

**Starter code:**

```java
import java.util.Scanner;

public class Main {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);
        int score = 0;

        // TODO: Create arrays of identifiers and their validity
        String[] identifiers = {"_count", "2name", "class", "$value", "my-var"};
        boolean[] valid = {true, false, false, true, false};

        // TODO: Loop through, ask user, check answer, update score
        // TODO: Print final score
    }
}
```

---

## Middle Tasks

### Task 4: Modernize Legacy Code

**Type:** 💻 Code

**Goal:** Practice converting Java 8 style code to modern Java 17+ syntax.

**Scenario:** You are given a legacy Java 8 codebase. Refactor it to use modern syntax features.

**Legacy code to modernize:**

```java
// BEFORE: Java 8 style
import java.util.Objects;

public class Employee {
    private final String name;
    private final String department;
    private final int salary;

    public Employee(String name, String department, int salary) {
        this.name = name;
        this.department = department;
        this.salary = salary;
    }

    public String getName() { return name; }
    public String getDepartment() { return department; }
    public int getSalary() { return salary; }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Employee)) return false;
        Employee that = (Employee) o;
        return salary == that.salary &&
               Objects.equals(name, that.name) &&
               Objects.equals(department, that.department);
    }

    @Override
    public int hashCode() { return Objects.hash(name, department, salary); }

    @Override
    public String toString() {
        return "Employee{name='" + name + "', department='" + department +
               "', salary=" + salary + '}';
    }
}
```

**Requirements:**
- [ ] Convert `Employee` to a record
- [ ] Use `var` for local variables where appropriate
- [ ] Use text blocks for any multi-line strings
- [ ] Use pattern matching for `instanceof` where applicable
- [ ] Write a `Main` class demonstrating usage with modern switch expressions

**Hints:**
<details>
<summary>Hint 1</summary>
Records automatically generate constructor, accessors, equals, hashCode, and toString.
</details>

<details>
<summary>Hint 2</summary>
Record accessor methods use the field name directly (e.g., `name()` not `getName()`).
</details>

**Evaluation criteria:**
- [ ] Record replaces the full POJO class
- [ ] `var` used appropriately
- [ ] Code compiles with Java 17+
- [ ] Behavior is identical to the original

---

### Task 5: Sealed Type Hierarchy

**Type:** 💻 Code

**Goal:** Design a type-safe domain model using sealed interfaces and records.

**Scenario:** Model a payment system with these payment types: CreditCard, BankTransfer, Cryptocurrency. Each has different fields.

**Requirements:**
- [ ] Create a sealed interface `Payment` with three record implementations
- [ ] Write a `processPayment(Payment p)` method using switch expression with pattern matching
- [ ] Add validation in compact constructors
- [ ] Write JUnit 5 tests for the process method
- [ ] No `default` case in switch (compiler should verify exhaustiveness)

**Evaluation criteria:**
- [ ] Sealed interface with proper `permits` clause
- [ ] Records with compact constructor validation
- [ ] Exhaustive switch expression
- [ ] Tests cover all payment types

---

### Task 6: Code Style Analyzer

**Type:** 💻 Code

**Goal:** Build a simple program that checks Java naming conventions.

**Scenario:** Write a program that reads Java identifier names and checks if they follow conventions.

**Requirements:**
- [ ] Check if a class name follows PascalCase
- [ ] Check if a method/variable name follows camelCase
- [ ] Check if a constant follows UPPER_SNAKE_CASE
- [ ] Print violations with suggestions

---

## Senior Tasks

### Task 7: Java Version Migration Guide Generator

**Type:** 💻 Code

**Goal:** Automate syntax modernization analysis.

**Scenario:** Your team has a Java 11 codebase with 200 classes. Create a tool that:
1. Identifies classes that could benefit from records (immutable POJOs with only getters)
2. Finds string concatenation that could use text blocks
3. Finds `instanceof` checks followed by casts that could use pattern matching
4. Generates a migration priority report

**Requirements:**
- [ ] Parse Java source files (use regex or simple pattern matching — no full parser required)
- [ ] Detect at least 3 modernization opportunities
- [ ] Output a ranked report (highest impact first)
- [ ] Include estimated lines of code savings

**Provided code to review/optimize:**

```java
// Sample legacy codebase files for analysis
public class UserDto {
    private final String name;
    private final int age;
    // constructor, getters, equals, hashCode, toString — 40 lines
}

public class Processor {
    public void process(Object obj) {
        if (obj instanceof String) {
            String s = (String) obj;
            // use s
        }
    }
}
```

---

### Task 8: Bytecode Comparison Tool

**Type:** 💻 Code

**Goal:** Compare bytecode generated by different syntax constructs.

**Scenario:** Write a program that:
1. Takes two Java source snippets
2. Compiles them using `javax.tools.JavaCompiler`
3. Disassembles using `javap` API
4. Compares the bytecode instruction count, stack depth, and local variable count
5. Reports which syntax produces more efficient bytecode

**Requirements:**
- [ ] Use `javax.tools.JavaCompiler` for in-memory compilation
- [ ] Parse `javap -c` output programmatically
- [ ] Compare at least: instruction count, max stack depth, constant pool size
- [ ] Include JMH benchmark comparison

---

## Questions

### 1. Why did Java choose C-style syntax instead of creating entirely new syntax?

**Answer:**
Java was designed in the 1990s when C and C++ were the dominant languages. Adopting C-style syntax (braces, semicolons, operator precedence) lowered the learning curve for the existing developer population. James Gosling explicitly chose "familiar syntax, unfamiliar semantics" — making Java look like C/C++ while removing dangerous features (pointers, manual memory management, preprocessor).

---

### 2. Why can't records be used as JPA entities?

**Answer:**
JPA requires: (1) a no-arg constructor for proxy creation, (2) mutable fields for lazy loading, (3) non-final class for runtime subclassing. Records violate all three: they have only canonical constructors, all fields are `final`, and records are implicitly `final`.

---

### 3. What is the diamond operator and how does it interact with `var`?

**Answer:**
The diamond operator `<>` lets the compiler infer generic types from context: `List<String> list = new ArrayList<>()`. With `var`, the context is lost: `var list = new ArrayList<>()` infers `ArrayList<Object>` because there is no left-hand type to infer from. Always specify the type parameter with `var`: `var list = new ArrayList<String>()`.

---

### 4. What is the `_` (underscore) identifier change across Java versions?

**Answer:**
- Java 8: `_` is a valid identifier (with warning)
- Java 9+: `_` is a reserved keyword — cannot be used as an identifier
- Java 21+: `_` is used as an unnamed variable pattern: `case Point(var _, var y) -> ...`

---

### 5. How do text blocks handle trailing whitespace?

**Answer:**
Text blocks strip trailing whitespace from each line by default. To preserve trailing spaces, use the `\s` escape (Java 15+): `"line with spaces   \s"`. The `\s` is replaced with a single space and prevents trailing whitespace stripping for the entire line.

---

### 6. What happens when you define a class named `Object` in your package?

**Answer:**
It shadows `java.lang.Object` within your package. All classes in your package will use YOUR `Object` class as the default superclass unless you explicitly import `java.lang.Object`. This is technically valid but extremely dangerous — it can break fundamental Java behavior. Never do this.

---

### 7. Can you have a method and a variable with the same name in Java?

**Answer:**
Yes — Java allows this because methods and variables occupy different "name spaces" in the JLS. The compiler distinguishes them by context: `foo` alone refers to the variable, `foo()` refers to the method.

```java
int test = 5;
int test() { return 10; }
System.out.println(test);    // 5 (variable)
System.out.println(test());  // 10 (method)
```

---

## Mini Projects

### Project 1: Java Syntax Flashcard App

**Goal:** Build a command-line flashcard application for Java syntax learning.

**Description:**
Build a console app that quizzes users on Java syntax topics. Store questions in a data file (text or JSON), present them randomly, track score, and show results.

**Requirements:**
- [ ] At least 20 syntax questions covering keywords, identifiers, comments, and naming conventions
- [ ] Randomized question order
- [ ] Score tracking with percentage
- [ ] Uses records for Question and Score data types
- [ ] Uses switch expressions for answer processing
- [ ] Maven/Gradle build
- [ ] README with setup and usage instructions

**Difficulty:** Middle
**Estimated time:** 4-6 hours

---

## Challenge

### Java Syntax Linter

**Problem:** Build a simplified Java syntax linter that checks source files for common convention violations.

**Requirements:**
1. Read a `.java` file
2. Check for:
   - Class names not in PascalCase
   - Method/variable names not in camelCase
   - Constants (static final) not in UPPER_SNAKE_CASE
   - Lines longer than 120 characters
   - Missing semicolons (basic check)
   - Tab characters (should be spaces)
3. Output violations with line numbers and suggestions

**Constraints:**
- Must complete analysis of a 1000-line file in under 100ms
- Memory usage under 50 MB
- No external libraries beyond JDK

**Scoring:**
- Correctness: 50% — all violations detected, no false positives
- Performance: 30% — measured by processing time
- Code quality: 20% — clean structure, proper naming, documentation
