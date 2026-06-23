# Java Language Specification — Basic Syntax
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html

---

## 1. Spec Reference

- **JLS Chapter 3**: Lexical Structure — https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html
- **JLS Chapter 7**: Program Structure — https://docs.oracle.com/javase/specs/jls/se21/html/jls-7.html
- **JLS Chapter 8**: Class Declarations — https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html
- **JLS §3.1**: Unicode — Input elements and line terminators
- **JLS §3.4**: Line Terminators
- **JLS §3.5**: Input Elements and Tokens
- **JLS §3.6**: White Space
- **JLS §3.7**: Comments
- **JLS §3.8**: Identifiers
- **JLS §3.9**: Keywords
- **JLS §7.3**: Compilation Units
- **JLS §7.4**: Package Declarations
- **JLS §7.5**: Import Declarations
- **JLS §8.1**: Class Declarations

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §7.3: Compilation Units --
CompilationUnit:
    OrdinaryCompilationUnit
    ModularCompilationUnit

OrdinaryCompilationUnit:
    [PackageDeclaration] {ImportDeclaration} {TopLevelClassOrInterfaceDeclaration}

ModularCompilationUnit:
    {ImportDeclaration} ModuleDeclaration

-- JLS §7.4: Package Declaration --
PackageDeclaration:
    {PackageModifier} package PackageName ;

PackageName:
    Identifier
    PackageName . Identifier

-- JLS §7.5: Import Declarations --
ImportDeclaration:
    SingleTypeImportDeclaration
    TypeImportOnDemandDeclaration
    SingleStaticImportDeclaration
    StaticImportOnDemandDeclaration

SingleTypeImportDeclaration:
    import TypeName ;

TypeImportOnDemandDeclaration:
    import PackageOrTypeName . * ;

-- JLS §8.1: Class Declaration --
ClassDeclaration:
    NormalClassDeclaration
    EnumDeclaration
    RecordDeclaration

NormalClassDeclaration:
    {ClassModifier} class TypeIdentifier [TypeParameters]
        [ClassExtends] [ClassImplements] [ClassPermits] ClassBody

ClassModifier:
    Annotation
    public | protected | private
    abstract | static | final | sealed | non-sealed | strictfp

-- JLS §3.8: Identifiers --
Identifier:
    IdentifierChars but not a Keyword or BooleanLiteral or NullLiteral

IdentifierChars:
    JavaLetter {JavaLetterOrDigit}

JavaLetter:
    any Unicode character that is a "Java letter"

JavaLetterOrDigit:
    any Unicode character that is a "Java letter-or-digit"

-- JLS §3.9: Keywords --
Keyword:
    ReservedKeyword | ContextualKeyword

ReservedKeyword: one of
    abstract   continue   for          new         switch
    assert     default    if           package     synchronized
    boolean    do         goto         private     this
    break      double     implements   protected   throw
    byte       else       import       public      throws
    case       enum       instanceof   return      transient
    catch      extends    int          short       try
    char       final      interface    static      void
    class      finally    long         strictfp    volatile
    const      float      native       super       while
    _

-- JLS §3.7: Comments --
Comment:
    TraditionalComment
    EndOfLineComment

TraditionalComment:
    /* CommentTail

CommentTail:
    * CommentTailStar
    NotStar CommentTail

EndOfLineComment:
    // {InputCharacter}

-- JLS §3.4: Line Terminators --
LineTerminator:
    the ASCII LF character, also known as "newline"
    the ASCII CR character, also known as "return"
    the ASCII CR character followed by the ASCII LF character

-- JLS §3.6: White Space --
WhiteSpace:
    the ASCII SP character, also known as "space"
    the ASCII HT character, also known as "horizontal tab"
    the ASCII FF character, also known as "form feed"
    LineTerminator

-- JLS §8.4: Method Declarations --
MethodDeclaration:
    {MethodModifier} MethodHeader MethodBody

MethodHeader:
    Result MethodDeclarator [Throws]
    TypeParameters {Annotation} Result MethodDeclarator [Throws]

MethodDeclarator:
    Identifier ( [FormalParameterList] ) [Dims]

MethodModifier:
    Annotation
    public | protected | private
    abstract | static | final | synchronized | native | strictfp

-- JLS §3.10: Literals --
Literal:
    IntegerLiteral
    FloatingPointLiteral
    BooleanLiteral
    CharacterLiteral
    StringLiteral
    TextBlock
    NullLiteral
```

---

## 3. Core Rules & Constraints

### 3.1 Source File Structure (JLS §7.3)
- A Java source file must end with `.java` extension (by convention; not enforced by spec).
- Each ordinary compilation unit may have at most **one** public top-level type.
- The file name must match the public type name (enforced by most compilers per JLS §7.6).
- Compilation units belong to a named package or the unnamed package.

### 3.2 Identifier Rules (JLS §3.8)
- Identifiers are unlimited in length.
- Must start with a `JavaLetter` (Unicode letter, `$`, or `_`).
- Subsequent characters may be `JavaLetterOrDigit`.
- `_` alone is a reserved keyword in Java 9+ (JLS §3.9, JEP 302).
- Identifiers are case-sensitive: `myVar` and `MyVar` are distinct.
- Cannot be a reserved keyword, boolean literal (`true`, `false`), or `null`.

### 3.3 Comment Rules (JLS §3.7)
- Comments are not tokens and are not significant to syntax.
- `/* */` comments do not nest: `/* /* */ */` — the second `*/` is outside any comment.
- JavaDoc comments (`/** */`) are a special form of traditional comments.
- Line comments (`//`) extend to end of line only.

### 3.4 Class Declaration Rules (JLS §8.1)
- A class body `{}` is mandatory even if empty.
- `public` classes must match the compilation unit file name.
- At most one of `final`, `sealed`, or `non-sealed` may appear on a class.
- `abstract` and `final` cannot both be present (JLS §8.1.1.1).
- The `strictfp` modifier is obsolete since Java 17 (JEP 306) but still syntactically valid.

### 3.5 Method Declaration Rules (JLS §8.4)
- Every method must have a return type or `void`.
- `main` entry point: `public static void main(String[] args)` (pre-Java 21).
- Java 21 introduces unnamed main method via JEP 445 (preview): `void main()`.
- Methods cannot be declared both `abstract` and `private`, `static`, `final`, `native`, `synchronized`.

### 3.6 Package Declaration Rules (JLS §7.4)
- At most one package declaration per compilation unit.
- Package declaration must precede all import declarations and type declarations.
- Unnamed package cannot have a package declaration.
- Package names follow naming convention: all lowercase, domain-reversed.

---

## 4. Type Rules

### 4.1 Top-Level Type Accessibility
- A top-level class/interface can only be `public` or package-private (default).
- `protected` and `private` are not valid for top-level types (JLS §8.1.1).

### 4.2 Type Identifier Constraints
- Type identifiers (JLS §3.8) must not be a `RestrictedIdentifier`: `var`, `record`, `yield`, `sealed`, `permits`, `when`.
- `var` is a reserved type name since Java 10 (JEP 286) — cannot be used as a class name.

### 4.3 Class Hierarchy
- Every class implicitly extends `java.lang.Object` unless it explicitly extends another class (JLS §8.1.4).
- `Object` itself has no superclass.
- Circular inheritance is a compile-time error (JLS §8.1.4).

---

## 5. Behavioral Specification

### 5.1 Program Execution (JLS §12.1)
1. JVM loads the initial class specified by the launcher.
2. JVM links (verifies, prepares, resolves) the class.
3. JVM initializes the class (runs static initializers).
4. JVM invokes `main(String[])`.
5. Execution proceeds from `main`.
6. Program terminates when all non-daemon threads finish or `System.exit()` is called.

### 5.2 Lexical Translation (JLS §3.2)
Java programs are translated in phases:
1. Unicode escape sequences (`\uXXXX`) are translated first.
2. Input is divided into lines using line terminators.
3. Lines are divided into tokens (lexical analysis).
4. Tokens are parsed (syntax analysis).

### 5.3 Unicode Escapes (JLS §3.3)
- `\uXXXX` can appear anywhere in source code (including identifiers).
- Multiple `u`s are allowed: `\uuuu0041` is valid and equals `A`.
- Unicode escapes are processed before any other lexical processing.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| File has no `main` method | Compile succeeds; runtime `NoSuchMethodError` or launcher error |
| Duplicate class in same package | Compile-time error (JLS §7.6) |
| Identifier same as contextual keyword | Allowed (e.g., `var` as variable name is NOT allowed since Java 10) |
| `/* */` nested comment | Outer ends at first `*/`; inner `/*` is ignored |
| `\u000A` in string literal | Line terminator in source → compile-time error (JLS §3.10.5) |
| `\u0022` in string literal | Allowed — translates to `"` before parsing |
| Class named `_` | Compile-time error since Java 9 (JLS §3.9) |

---

## 7. Edge Cases from Spec

### 7.1 Unicode Escape in Identifiers
```java
// Legal: \u0041 is 'A'
int \u0041 = 10;  // declares int A = 10;
```

### 7.2 `_` as Identifier
```java
// Java 8: legal (deprecated)
int _ = 5;
// Java 9+: compile-time error — _ is a keyword
```

### 7.3 Consecutive `*/` in Comments
```java
/* This comment ends here: */
// The */ above ends the comment; "here:" and */ are outside
```

### 7.4 Multiple Public Classes in One File
```java
// Compile-time error if two public classes in one file:
public class A {}
public class B {}  // error: class B is public, should be in file B.java
```

### 7.5 `strictfp` on Classes (Java 17+)
```java
// Java 17+ (JEP 306): all code is effectively strictfp
// strictfp modifier is obsolete but not an error
strictfp class Calculator { }  // compiles with warning
```

### 7.6 Package-Private Top-Level Class
```java
// No access modifier = package-private (not private)
class Helper { }  // accessible only within the same package
```

---

## 8. Version History

| Java Version | Change | JEP/JLS Reference |
|-------------|--------|-------------------|
| Java 1.0 | Basic syntax established | JLS 1st ed. |
| Java 5 (1.5) | Generics, annotations, enhanced for, varargs, enums, autoboxing | JSR 14, 175 |
| Java 7 | Binary literals, underscores in literals, try-with-resources, diamond | JEP 334 (backport) |
| Java 8 | Lambda expressions, default methods, method references | JEP 126 |
| Java 9 | Module system; `_` becomes reserved keyword | JEP 261, 302 |
| Java 10 | `var` local variable type inference | JEP 286 |
| Java 14 | Records (preview); pattern matching `instanceof` (preview) | JEP 359, 305 |
| Java 15 | Text blocks (standard) | JEP 378 |
| Java 16 | Records (standard); `instanceof` pattern (standard) | JEP 395, 394 |
| Java 17 | Sealed classes (standard); `strictfp` obsolete | JEP 409, 306 |
| Java 21 | Virtual threads; unnamed classes & instance main (preview) | JEP 444, 445 |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 Class File Format
- Compiled `.class` files follow the JVM Specification Chapter 4 format.
- `javac` produces class files with a `magic` number `0xCAFEBABE`.
- Java 21 class files have major version `65` (0x0041).

### 9.2 Compiler Behavior
- `javac` may add synthetic methods/fields (e.g., `access$000` for inner class access).
- The compiler is free to reorder field initializations within static initializer blocks.
- Dead code elimination is performed but not guaranteed to match any specific strategy.

### 9.3 JVM Entry Point
- The JVM launcher searches for `public static void main(String[])` by default.
- Java 21 preview (JEP 445): unnamed classes with `void main()` are supported by `java --enable-preview`.

### 9.4 Encoding
- `javac` defaults to the platform encoding unless `-encoding` is specified.
- Source files are recommended to be UTF-8 (mandatory for unnamed classes in Java 21 preview).

---

## 10. Spec Compliance Checklist

- [ ] Compilation unit has at most one public top-level type
- [ ] Public type name matches source file name (case-sensitive)
- [ ] Package declaration (if present) is the first non-comment element
- [ ] Import declarations precede type declarations
- [ ] Identifiers do not conflict with reserved keywords
- [ ] `_` is not used as an identifier (Java 9+)
- [ ] `var` is not used as a type name (Java 10+)
- [ ] Comments do not contain nested `/* */`
- [ ] Each class body is enclosed in `{}`
- [ ] No class is declared both `abstract` and `final`
- [ ] `main` method signature matches `public static void main(String[])`
- [ ] Unicode escapes are valid four-hex-digit sequences

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: Minimal Java Program
// File: HelloWorld.java
package com.example.basics;

public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

```java
// Example 2: Package, Imports, Multiple Classes
// File: Greeter.java
package com.example.basics;

import java.util.List;
import java.util.ArrayList;
import static java.lang.Math.PI;

public class Greeter {

    private String name;

    public Greeter(String name) {
        this.name = name;
    }

    public String greet() {
        return "Hello, " + name + "!";
    }

    public static void main(String[] args) {
        Greeter g = new Greeter("Java 21");
        System.out.println(g.greet());
        System.out.println("PI = " + PI);

        List<String> items = new ArrayList<>();
        items.add("alpha");
        items.add("beta");
        for (String item : items) {
            System.out.println(item);
        }
    }
}

// Package-private helper class in same file
class InternalHelper {
    static String format(String s) {
        return "[" + s + "]";
    }
}
```

```java
// Example 3: Comments, Identifiers, Unicode
// File: SyntaxDemo.java
public class SyntaxDemo {

    // Single-line comment
    /* Multi-line
       comment */
    /**
     * JavaDoc comment
     * @param args command line arguments
     */
    public static void main(String[] args) {
        // Unicode escape in identifier
        int caf\u00E9 = 42;   // declares: int café = 42;
        System.out.println(caf\u00E9);  // prints: 42

        // var type inference (Java 10+)
        var message = "Inferred as String";
        System.out.println(message);

        // Text block (Java 15+)
        String json = """
                {
                    "key": "value"
                }
                """;
        System.out.println(json);
    }
}
```

```java
// Example 4: Sealed Class Hierarchy (Java 17+)
// File: Shape.java
public sealed class Shape permits Circle, Rectangle {
    abstract double area();
}

final class Circle extends Shape {
    private final double radius;
    Circle(double radius) { this.radius = radius; }

    @Override
    double area() { return Math.PI * radius * radius; }
}

final class Rectangle extends Shape {
    private final double width, height;
    Rectangle(double width, double height) {
        this.width = width;
        this.height = height;
    }

    @Override
    double area() { return width * height; }
}
```

```java
// Example 5: Record Declaration (Java 16+)
// File: Point.java
public record Point(double x, double y) {
    // Compact constructor
    public Point {
        if (Double.isNaN(x) || Double.isNaN(y)) {
            throw new IllegalArgumentException("Coordinates cannot be NaN");
        }
    }

    public double distanceTo(Point other) {
        double dx = this.x - other.x;
        double dy = this.y - other.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    public static void main(String[] args) {
        Point p1 = new Point(0.0, 0.0);
        Point p2 = new Point(3.0, 4.0);
        System.out.println("Distance: " + p1.distanceTo(p2));  // 5.0
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §3 | Lexical Structure | https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html |
| JLS §4 | Types, Values, Variables | https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html |
| JLS §6 | Names | https://docs.oracle.com/javase/specs/jls/se21/html/jls-6.html |
| JLS §7 | Packages and Modules | https://docs.oracle.com/javase/specs/jls/se21/html/jls-7.html |
| JLS §8 | Classes | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html |
| JLS §9 | Interfaces | https://docs.oracle.com/javase/specs/jls/se21/html/jls-9.html |
| JLS §12 | Execution | https://docs.oracle.com/javase/specs/jls/se21/html/jls-12.html |
| JVMS §4 | Class File Format | https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-4.html |
| JEP 445 | Unnamed Classes (Preview) | https://openjdk.org/jeps/445 |
| JEP 409 | Sealed Classes | https://openjdk.org/jeps/409 |
