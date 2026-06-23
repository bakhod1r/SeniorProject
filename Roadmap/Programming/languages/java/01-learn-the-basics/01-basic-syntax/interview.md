# Basic Syntax — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What is the entry point of a Java application?

**Answer:**
The entry point is the `main` method with the exact signature: `public static void main(String[] args)`. The JVM looks for this method in the specified class to start execution. Every word matters: `public` makes it accessible to the JVM, `static` allows calling without creating an object, `void` means it returns nothing, and `String[] args` accepts command-line arguments.

---

### 2. Why does the file name have to match the public class name?

**Answer:**
Java requires the file name to match the public class name so the compiler and ClassLoader can locate classes predictably. If you have `public class Calculator`, the file must be `Calculator.java`. This one-to-one mapping simplifies the build process and makes code navigation easier.

```java
// File: Calculator.java
public class Calculator {
    public static void main(String[] args) {
        System.out.println("2 + 3 = " + (2 + 3));
    }
}
```

---

### 3. What are the three types of comments in Java?

**Answer:**
1. **Single-line comment:** `// comment` — used for brief inline notes
2. **Multi-line comment:** `/* comment */` — used for blocks of text
3. **Javadoc comment:** `/** comment */` — used for API documentation, processed by the `javadoc` tool

Comments are stripped during compilation and have zero impact on the compiled bytecode.

---

### 4. What is the difference between `System.out.print()` and `System.out.println()`?

**Answer:**
`println()` appends a newline character (`\n`) after printing, while `print()` does not. Both write to the standard output stream (`System.out`).

```java
System.out.print("A");
System.out.println("B");
System.out.print("C");
// Output:
// AB
// C
```

---

### 5. Is Java case-sensitive? Give an example.

**Answer:**
Yes, Java is strictly case-sensitive. `Main`, `main`, and `MAIN` are three different identifiers. This applies to class names, method names, variable names, and keywords. For example, `String` (capital S) is a valid class type, but `string` (lowercase s) would cause a "cannot find symbol" error.

---

### 6. What are the rules for naming identifiers in Java?

**Answer:**
- Must start with a letter, underscore (`_`), or dollar sign (`$`)
- Cannot start with a digit
- Cannot be a reserved keyword (e.g., `class`, `int`, `if`)
- Case-sensitive (`name` and `Name` are different)
- No length limit (but keep names reasonable)
- Convention: classes use PascalCase, variables/methods use camelCase, constants use UPPER_SNAKE_CASE

---

### 7. What happens if you forget a semicolon in Java?

**Answer:**
The program will not compile. Java requires every statement to end with a semicolon. The compiler will report a syntax error like `';' expected` at the line where the semicolon is missing. This is different from languages like Python or Kotlin where semicolons are optional.

---

## Middle Level

### 4. What is `var` in Java and how does it work?

**Answer:**
`var` (Java 10+) is local variable type inference. The compiler infers the type from the right-hand side of the assignment. It is NOT dynamic typing — the type is fixed at compile time and cannot change.

```java
var list = new ArrayList<String>();  // inferred as ArrayList<String>
var count = 0;                       // inferred as int
// list = 42;  // ERROR: cannot assign int to ArrayList<String>
```

**Restrictions:**
- Only for local variables (not fields, parameters, or return types)
- Requires an initializer (`var x;` is invalid)
- Cannot use with diamond operator alone (`var list = new ArrayList<>()` infers `ArrayList<Object>`)
- Can be used in lambda parameters since Java 11: `(var x) -> x`

---

### 5. How do records differ from regular classes at the syntax level?

**Answer:**
Records (Java 16+) are compact data classes that automatically provide: a canonical constructor, accessor methods (not `getX()` — just `x()`), `equals()`, `hashCode()`, and `toString()`.

Key syntactic differences:
- Fields are declared in the header: `record Point(int x, int y) {}`
- All fields are implicitly `private final`
- Cannot declare additional instance fields
- Cannot extend other classes (implicitly extend `Record`)
- Can implement interfaces
- Can have compact constructors for validation

```java
record User(String name, int age) {
    User {  // compact constructor — no parameters
        if (age < 0) throw new IllegalArgumentException("age must be >= 0");
        name = name.trim();  // can modify before assignment
    }
}
```

---

### 6. Explain the difference between `switch` statement and `switch` expression.

**Answer:**
The `switch` statement (traditional) executes code blocks and can fall through. The `switch` expression (Java 14+) returns a value and does NOT fall through.

```java
// Switch statement — fall-through by default
switch (day) {
    case 1:
        label = "Monday";
        break;  // must explicitly break
    case 2:
        label = "Tuesday";
        break;
    default:
        label = "Other";
}

// Switch expression — no fall-through, returns value
String label = switch (day) {
    case 1 -> "Monday";    // arrow syntax
    case 2 -> "Tuesday";
    default -> "Other";
};  // note: semicolon after the expression
```

Switch expressions must be exhaustive (all cases covered or have `default`), and the compiler enforces this for enum and sealed types.

---

### 7. What are sealed classes and why were they added to Java?

**Answer:**
Sealed classes (Java 17) restrict which classes can extend or implement them. They enable algebraic data types — closed type hierarchies where all variants are known at compile time.

```java
sealed interface Shape permits Circle, Rectangle, Triangle {}
record Circle(double radius) implements Shape {}
record Rectangle(double w, double h) implements Shape {}
final class Triangle implements Shape { /* ... */ }
```

**Why added:** They enable exhaustive pattern matching in `switch` expressions — the compiler can verify all subtypes are handled, eliminating the need for a `default` case.

---

### 8. What is the difference between `==` and `.equals()` for strings?

**Answer:**
`==` compares object references (memory addresses), while `.equals()` compares content.

```java
String a = "hello";
String b = "hello";
String c = new String("hello");

a == b      // true — both point to same string pool entry
a == c      // false — c is a new heap object
a.equals(c) // true — same content
```

**Why interviewers ask this:** It tests understanding of the string constant pool and reference vs value comparison.

---

## Senior Level

### 7. How would you design and enforce coding standards for a 50-person Java team?

**Answer:**
A multi-layered approach:

1. **Static Analysis in CI** — Checkstyle (formatting), SpotBugs (bugs), PMD (code smells) configured as Maven/Gradle plugins with `failOnViolation=true`
2. **EditorConfig** — `.editorconfig` file for consistent indentation, line endings, charset
3. **Architecture Decision Records** — Document Java version baseline, allowed syntax features, and team conventions
4. **Automated Formatting** — google-java-format or Spotless Maven plugin in pre-commit hook
5. **Code Review Guidelines** — Documented checklist (constructor injection, Optional usage, record adoption)
6. **IDE Settings** — Shared IntelliJ code style configuration committed to repo

---

### 8. When would you NOT adopt the latest Java syntax features?

**Answer:**
- **Library development** — if your library targets Java 11, you cannot use records (Java 16) or sealed classes (Java 17)
- **Team readiness** — forcing new syntax on a team unfamiliar with it increases bugs and review time
- **Tooling gaps** — some frameworks may not fully support the latest features (e.g., JPA doesn't work with records as entities)
- **Deployment constraints** — production environments may only support LTS versions (11, 17, 21)
- **Migration cost** — in a 2M-line codebase, gradual adoption is safer than a big-bang rewrite

---

### 9. How do records interact with serialization frameworks (Jackson, Gson)?

**Answer:**
Records work with Jackson if:
1. `jackson-databind` 2.12+ is used (native record support)
2. Either `-parameters` flag is passed to `javac` (so Jackson can read constructor parameter names), OR `@JsonProperty` annotations are used

```java
// Works with Jackson 2.12+
record UserDto(@JsonProperty("name") String name,
               @JsonProperty("age") int age) {}
```

**Pitfall:** Gson does not natively support records (as of Gson 2.10). You need a custom `TypeAdapter`.

---

### 10. How does the bytecode differ between a switch expression and an if-else chain?

**Answer:**
A switch expression with contiguous integer cases generates a `tableswitch` instruction — an O(1) direct jump table. An if-else chain generates sequential `if_icmpne` (integer compare) instructions — O(n) in the worst case.

For string switches, Java uses `String.hashCode()` for the initial lookup, then `String.equals()` for verification to handle hash collisions.

The JIT compiler may optimize if-else chains into lookup tables if it detects the pattern, but explicit switch expressions give the JIT clearer optimization hints.

---

### 11. How would you migrate a large codebase from Java 8 to Java 21?

**Answer:**
1. **Phase 1:** Update JDK and build tools, fix compilation errors (removed `javax.*` APIs)
2. **Phase 2:** Run full test suite, fix deprecation warnings
3. **Phase 3:** Gradually adopt syntax features module-by-module:
   - Text blocks for SQL/JSON strings
   - `var` for obvious local types
   - Records for DTOs
   - Pattern matching for `instanceof`
4. **Phase 4:** Sealed interfaces for domain event hierarchies
5. **Tooling:** Use IntelliJ inspections to suggest modernization, Error Prone for migration checks

**Key principle:** Never change behavior and syntax in the same commit. Syntax modernization should be a separate, no-behavior-change refactoring step.

---

## Scenario-Based Questions

### 12. A junior developer on your team writes all code in a single 500-line main method. How do you address this?

**Answer:**
1. **Don't criticize publicly** — schedule a 1:1 pairing session
2. **Show the "Extract Method" refactoring** — demonstrate how IntelliJ can extract methods automatically
3. **Explain the "one method, one responsibility" rule** — each method should do one thing (ideally < 20 lines)
4. **Add Checkstyle rules** — `MethodLength` check with a max of 30 lines
5. **Lead by example** — refactor the code together, showing how small methods with clear names make the code self-documenting
6. **Follow up** — review their next PR to reinforce the practice

---

### 13. Your team is debating whether to use Lombok or Java records. What is your recommendation?

**Answer:**
**Recommendation:** Prefer records over Lombok for new code (Java 16+).

| Factor | Records | Lombok |
|--------|---------|--------|
| Build dependency | None (JDK feature) | Annotation processor dependency |
| IDE support | Native | Requires plugin |
| Immutability | Built-in | `@Value` annotation |
| Flexibility | Limited (no custom setters) | Very flexible |
| JPA entities | Not supported | Supported |

**Use records for:** DTOs, value objects, event payloads, configuration.
**Use Lombok for:** JPA entities (need mutable setters), builder pattern with many optional fields.

---

### 14. A production build fails with "code too large" error. What happened and how do you fix it?

**Answer:**
The JVM limits a single method to 65,535 bytes of bytecode. This typically happens with:
- Generated code (Avro/Protobuf schemas with hundreds of fields)
- Very large static initializers
- Methods with huge switch statements

**Fix:**
1. Split the method into smaller methods (each under the limit)
2. For generated code: configure the generator to produce smaller methods
3. For static initializers: move initialization to a separate class or use lazy initialization

---

## FAQ

### Q: Is `String[] args` required in the main method?

**A:** The parameter must be present in the signature, but you don't have to use it. `String... args` (varargs) is also valid as an alternative syntax. The JVM will pass an empty array if no arguments are provided.

### Q: Can I have multiple main methods in one project?

**A:** Yes — you can have a `main` method in multiple classes. When you run `java ClassName`, the JVM uses the `main` method in the specified class. This is common in multi-module projects where each module has its own entry point.

### Q: What do interviewers look for when asking about Java Basic Syntax?

**A:** Key evaluation criteria:
- **Junior:** Can write a correct Hello World, knows semicolons/braces rules, understands case sensitivity, knows `public class` must match filename
- **Middle:** Can explain `var`, records, text blocks, switch expressions. Knows when to use each modern feature.
- **Senior:** Can discuss bytecode implications, Java version migration strategies, team coding standards enforcement, and tradeoffs between syntax features
