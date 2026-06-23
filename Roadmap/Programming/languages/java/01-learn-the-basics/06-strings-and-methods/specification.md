# Java Language Specification — Strings and Methods
## Source: https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.5

---

## 1. Spec Reference

- **JLS §3.10.5**: String Literals — https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.5
- **JLS §3.10.6**: Text Blocks — https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.6
- **JLS §4.3.3**: The Class String — https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.3.3
- **JLS §8.4**: Method Declarations — https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.4
- **JLS §8.4.1**: Formal Parameters
- **JLS §8.4.2**: Method Signature
- **JLS §8.4.3**: Method Modifiers
- **JLS §8.4.4**: Generic Methods
- **JLS §8.4.5**: Method Return Type
- **JLS §8.4.6**: Method Throws
- **JLS §8.4.7**: Method Body
- **JLS §8.4.8**: Inheritance, Overriding, Hiding
- **JLS §15.18.1**: String Concatenation Operator `+`
- **JLS §15.28**: String Switch Expressions

---

## 2. Formal Grammar (BNF from JLS)

```
-- JLS §3.10.5: String Literal --
StringLiteral:
    " {StringCharacter} "

StringCharacter:
    InputCharacter but not " or \
    EscapeSequence

EscapeSequence:
    \ b  (backspace U+0008)
    \ t  (tab U+0009)
    \ n  (newline U+000A)
    \ f  (form feed U+000C)
    \ r  (carriage return U+000D)
    \ "  (double quote U+0022)
    \ '  (single quote U+0027)
    \ \  (backslash U+005C)
    \ s  (space U+0020)  [Java 15+]
    \ LineTerminator     [line continuation, Java 15+]
    OctalEscape

OctalEscape:
    \ OctalDigit
    \ OctalDigit OctalDigit
    \ ZeroToThree OctalDigit OctalDigit

-- JLS §3.10.6: Text Block --
TextBlock:
    """ {WhiteSpace} LineTerminator {TextBlockCharacter} """

TextBlockCharacter:
    InputCharacter but not \
    EscapeSequence
    LineTerminator

-- JLS §8.4: Method Declaration --
MethodDeclaration:
    {MethodModifier} MethodHeader MethodBody

MethodHeader:
    Result MethodDeclarator [Throws]
    TypeParameters {Annotation} Result MethodDeclarator [Throws]

MethodDeclarator:
    Identifier ( [ReceiverParameter ,] [FormalParameterList] ) [Dims]

Result:
    UnannType
    void

FormalParameterList:
    FormalParameter { , FormalParameter }

FormalParameter:
    {VariableModifier} UnannType VariableDeclaratorId
    VariableArityParameter

VariableArityParameter:
    {VariableModifier} UnannType {Annotation} ... Identifier

MethodModifier:
    Annotation
    public | protected | private
    abstract | static | final
    synchronized | native | strictfp

Throws:
    throws ExceptionTypeList

ExceptionTypeList:
    ExceptionType { , ExceptionType }

ExceptionType:
    ClassType
    TypeVariable

MethodBody:
    Block
    ;

-- JLS §15.18.1: String Concatenation --
-- When + is applied to a String operand, it becomes string concatenation.
-- Non-string operands are converted via String.valueOf().
-- The JLS permits the compiler to use StringBuilder or StringConcatFactory.
```

---

## 3. Core Rules & Constraints

### 3.1 String Immutability (JLS §4.3.3)
- `String` objects are **immutable** — once created, their content cannot be changed.
- All `String` methods that appear to "modify" return new `String` instances.
- The `String` class is declared `final` — cannot be subclassed.
- `String` implements `CharSequence`, `Comparable<String>`, and `Serializable`.

### 3.2 String Interning (JLS §3.10.5)
- String literals are automatically interned (JLS §3.10.5, §4.3.3).
- All references to the same string literal refer to the same `String` object.
- `"hello" == "hello"` is `true` (both interned).
- `new String("hello") == "hello"` is `false` (new object not interned by default).
- `String.intern()` returns the canonical interned instance.

### 3.3 String Concatenation (JLS §15.18.1)
- If either operand is a `String`, `+` becomes string concatenation.
- `null` operands are converted to the string `"null"`.
- The expression is evaluated left to right.
- `javac` may optimize using `StringBuilder` or `invokedynamic` with `StringConcatFactory` (Java 9+).

### 3.4 Text Blocks (JLS §3.10.6, Java 15+)
- Opening `"""` must be followed by a line terminator.
- The closing `"""` determines the **re-indentation** anchor.
- Incidental whitespace (common indentation) is stripped.
- Trailing whitespace on each line is stripped unless escaped with `\s`.
- `\` at end of line is a line-continuation escape — no newline inserted.

### 3.5 Method Declaration Rules (JLS §8.4)
- `abstract` methods have no body (semicolon only); non-abstract methods must have a body.
- `native` methods have no Java body; implemented in native code.
- `synchronized` methods acquire the object's (or class's, if static) monitor before execution.
- Varargs (`...`) must be the last parameter; only one varargs per method.
- Method overloading: same name, different parameter types (not just return type).

### 3.6 Method Overriding (JLS §8.4.8)
- Override requires: same name, same parameter types, return type is covariant (same or subtype).
- `@Override` annotation is not required but triggers a compile error if the method does NOT override.
- Overriding method's access modifier cannot be more restrictive than overridden method.
- Overriding method cannot declare new checked exceptions not declared by the overridden method.

---

## 4. Type Rules

### 4.1 Return Type Covariance (JLS §8.4.5)
- An overriding method may declare a return type that is a subtype of the overridden method's return type.
- Example: `Object clone()` in `Object` can be overridden as `Foo clone()` in `Foo`.
- This is called **covariant return types** (added in Java 5).

### 4.2 Method Signature (JLS §8.4.2)
- Signature consists of: method name + number and types of formal parameters (NOT return type, NOT thrown exceptions).
- Two methods with same name and parameter types are the same signature.
- Same signature methods cannot coexist in the same class (compile error) — unless one is bridge method (synthetic).

### 4.3 Varargs Type Rules (JLS §8.4.1)
- `void f(int... args)` is equivalent to `void f(int[] args)` in the bytecode.
- `f(1, 2, 3)` compiles to `f(new int[]{1, 2, 3})`.
- `f()` compiles to `f(new int[]{})`.
- Cannot overload `f(int[])` and `f(int...)` — same erasure.

### 4.4 Generic Methods (JLS §8.4.4)
- Type parameters declared before return type: `<T> List<T> singletonList(T t)`.
- Type inference resolves `T` from arguments at call site.
- Bounds: `<T extends Comparable<T>> T max(T a, T b)`.

---

## 5. Behavioral Specification

### 5.1 String Comparison Behavior
- `==` compares object references (identity).
- `.equals()` compares content (character-by-character).
- `.equalsIgnoreCase()` compares content ignoring case differences.
- `.compareTo()` returns lexicographic order (negative, 0, positive).
- `.compareToIgnoreCase()` — case-insensitive lexicographic order.

### 5.2 Core String Methods (from `java.lang.String` API)
| Method | Description | Returns |
|--------|-------------|---------|
| `length()` | Number of UTF-16 code units | `int` |
| `charAt(int)` | Code unit at index | `char` |
| `codePointAt(int)` | Unicode code point at index | `int` |
| `substring(int, int)` | Subsequence | `String` |
| `indexOf(String)` | First occurrence | `int` (-1 if not found) |
| `contains(CharSequence)` | Membership check | `boolean` |
| `replace(CharSequence, CharSequence)` | Literal replacement (all occurrences) | `String` |
| `replaceAll(String, String)` | Regex replacement | `String` |
| `split(String)` | Splits by regex | `String[]` |
| `strip()` | Removes leading/trailing whitespace (Unicode-aware, Java 11+) | `String` |
| `trim()` | Removes ASCII whitespace (legacy) | `String` |
| `toUpperCase()` | Uppercase (locale-sensitive) | `String` |
| `toLowerCase()` | Lowercase (locale-sensitive) | `String` |
| `isEmpty()` | Length == 0 | `boolean` |
| `isBlank()` | All whitespace or empty (Java 11+) | `boolean` |
| `chars()` | Stream of code units (Java 8+) | `IntStream` |
| `codePoints()` | Stream of code points (Java 8+) | `IntStream` |
| `formatted(Object...)` | Like `String.format` (Java 15+) | `String` |
| `repeat(int)` | Repeat n times (Java 11+) | `String` |
| `indent(int)` | Adjust indentation (Java 12+) | `String` |
| `translateEscapes()` | Interpret `\n`, `\t` etc. in string (Java 15+) | `String` |

### 5.3 Method Invocation (JLS §15.12)
1. Identify potentially applicable methods (by name and arity).
2. Identify applicable methods (by type compatibility with actual args).
3. Choose most specific applicable method.
4. If two methods are equally specific and neither overrides the other → ambiguous compile error.

---

## 6. Defined vs Undefined Behavior

| Situation | Behavior per JLS |
|-----------|-----------------|
| `"hello" + null` | `"hellonull"` |
| `null + "hello"` | `"nullhello"` |
| `"hello" == "hello"` | `true` (interned literals) |
| `new String("hello") == "hello"` | `false` |
| `s.charAt(s.length())` | `StringIndexOutOfBoundsException` |
| `s.substring(-1, 3)` | `StringIndexOutOfBoundsException` |
| `s.substring(3, 1)` | `StringIndexOutOfBoundsException` |
| Concatenation with `null` reference | `"null"` string representation |
| `String.format(null, args)` | `NullPointerException` |
| Method overriding with `throws` | Can only reduce checked exceptions, not add new ones |

---

## 7. Edge Cases from Spec

### 7.1 String Concatenation with null
```java
String s = null;
System.out.println("value: " + s);   // "value: null"
System.out.println(s + " there");    // "null there"

Object obj = null;
String result = "" + obj;             // "null"
```

### 7.2 String Literal Interning
```java
String a = "hello";
String b = "hello";
String c = new String("hello");
String d = c.intern();

System.out.println(a == b);        // true  (same interned literal)
System.out.println(a == c);        // false (c is new object)
System.out.println(a == d);        // true  (d is interned)
System.out.println(a.equals(c));   // true  (same content)
```

### 7.3 Text Block Indentation
```java
// The closing """ at column 8 determines indentation removal
String json = """
        {
            "name": "Java"
        }
        """;
// Result: "{\n    \"name\": \"Java\"\n}\n"
// 8 spaces of indentation stripped from each line
```

### 7.4 Varargs Ambiguity
```java
static void print(Object... args) { System.out.println("varargs Object"); }
static void print(String s)       { System.out.println("exact String"); }

print("hello");  // calls exact String version (more specific)
print((Object) "hello");  // calls varargs Object version
```

### 7.5 Covariant Return Type Override
```java
class Animal {
    Animal create() { return new Animal(); }
}
class Dog extends Animal {
    @Override
    Dog create() { return new Dog(); }  // covariant return: Dog is subtype of Animal
}
```

### 7.6 Method Hiding vs Overriding
```java
class Parent {
    static String type() { return "Parent"; }   // class method
    String name() { return "Parent"; }           // instance method
}
class Child extends Parent {
    static String type() { return "Child"; }     // HIDES (not overrides) static method
    @Override String name() { return "Child"; }  // OVERRIDES instance method
}
// Parent p = new Child();
// p.type() → "Parent" (hidden, resolved at compile time)
// p.name() → "Child"  (overridden, resolved at runtime)
```

---

## 8. Version History

| Java Version | Change | JEP/Reference |
|-------------|--------|---------------|
| Java 1.0 | `String`, string literals, concatenation with `+` | JLS 1st ed. |
| Java 5 | Covariant return types; generics methods; varargs | JSR 14 |
| Java 7 | `switch` on `String` | JLS §14.11 |
| Java 9 | `StringConcatFactory` (`invokedynamic` for `+`) | JEP 280 |
| Java 11 | `strip()`, `isBlank()`, `lines()`, `repeat()` | JDK-11 API |
| Java 12 | `indent()`, `transform()` | JDK-12 API |
| Java 13 | Text blocks (preview) | JEP 355 |
| Java 14 | Text blocks (2nd preview) | JEP 368 |
| Java 15 | Text blocks (standard); `formatted()`, `translateEscapes()` | JEP 378 |
| Java 15 | `\s` and `\<line-terminator>` escape sequences | JEP 378 |
| Java 21 | `String.indexOf(String, int, int)` new overload | JDK-21 API |

---

## 9. Implementation-Specific Behavior (JVM-Specific)

### 9.1 String Concatenation Optimization (JEP 280, Java 9+)
- `javac` compiles `s1 + s2 + s3` using `invokedynamic` calling `StringConcatFactory.makeConcatWithConstants`.
- The JVM decides at runtime how to best concatenate strings.
- HotSpot uses `StringBuilder`-like strategies internally.
- Avoids creating intermediate `String` objects for each `+`.

### 9.2 String Deduplication
- JVM G1GC can deduplicate `String` objects (same content → share char array).
- Enabled with `-XX:+UseStringDeduplication`.
- Does NOT make `==` comparisons reliable — use `.equals()`.

### 9.3 Compact Strings (JEP 254, Java 9+)
- Strings containing only Latin-1 characters are stored as `byte[]` instead of `char[]`.
- Reduces memory footprint by ~50% for typical ASCII-heavy workloads.
- Transparent to Java code; no behavior change.

### 9.4 Virtual Method Dispatch
- Instance methods are dispatched via `invokevirtual` (dynamic dispatch through vtable).
- `private`, `final`, and `static` methods use `invokespecial` or `invokestatic` (no virtual dispatch).
- Interface methods use `invokeinterface`.

---

## 10. Spec Compliance Checklist

- [ ] `String` comparison uses `.equals()`, not `==`
- [ ] Null check before calling instance methods on `String` reference
- [ ] `substring` indices are within `[0, length()]`; end > start
- [ ] Varargs is the last parameter in method signature
- [ ] Overriding method is not more restrictive in access
- [ ] Overriding method does not add new checked exceptions
- [ ] `@Override` annotation used for all intentional overrides
- [ ] Text block opening `"""` is on its own line
- [ ] `String` mutation simulation uses `StringBuilder`/`StringBuffer`
- [ ] `intern()` used for explicit pooling; `==` avoided for pooled strings in general code

---

## 11. Official Examples (Compilable Java 21 Code)

```java
// Example 1: String Fundamentals
// File: StringFundamentals.java
public class StringFundamentals {
    public static void main(String[] args) {
        // Immutability
        String s1 = "Hello";
        String s2 = s1.concat(", World");  // new String created; s1 unchanged
        System.out.println("s1: " + s1);   // Hello
        System.out.println("s2: " + s2);   // Hello, World

        // Reference equality vs content equality
        String a = "Java";
        String b = "Java";
        String c = new String("Java");
        System.out.println(a == b);           // true (interned literals)
        System.out.println(a == c);           // false (new object)
        System.out.println(a.equals(c));      // true (same content)
        System.out.println(a.equals(null));   // false (no NPE)

        // Key methods
        String str = "  Hello, World!  ";
        System.out.println(str.strip());                   // "Hello, World!"
        System.out.println(str.trim());                    // "Hello, World!"
        System.out.println("hello".toUpperCase());         // "HELLO"
        System.out.println("HELLO".toLowerCase());         // "hello"
        System.out.println("  ".isBlank());                // true
        System.out.println("hello".contains("ell"));       // true
        System.out.println("hello".startsWith("hel"));     // true
        System.out.println("hello".endsWith("llo"));       // true
        System.out.println("hello".indexOf('l'));           // 2
        System.out.println("hello".lastIndexOf('l'));       // 3
        System.out.println("hello".replace("l", "r"));     // "herro"
        System.out.println("a,b,c".split(",").length);     // 3
        System.out.println("ha".repeat(3));                // "hahaha"
    }
}
```

```java
// Example 2: Text Blocks (Java 15+)
// File: TextBlockDemo.java
public class TextBlockDemo {
    public static void main(String[] args) {
        // JSON text block
        String json = """
                {
                    "name": "Alice",
                    "age": 30
                }
                """;
        System.out.println(json);

        // HTML text block
        String html = """
                <html>
                    <body>
                        <p>Hello, World!</p>
                    </body>
                </html>
                """;
        System.out.println(html);

        // Escape sequences in text blocks
        String withEscape = """
                Line 1\s
                Line 2\s
                """;
        // \s preserves trailing space on each line

        // Line continuation
        String singleLine = """
                This is a \
                single line\
                """;
        System.out.println(singleLine);  // "This is a single line"

        // formatted() (Java 15+) — equivalent to String.format()
        String template = """
                Name: %s
                Score: %.2f
                """.formatted("Bob", 95.5);
        System.out.println(template);
    }
}
```

```java
// Example 3: Method Declarations
// File: MethodDeclarations.java
import java.util.Arrays;

public class MethodDeclarations {

    // Static method
    static int add(int a, int b) { return a + b; }

    // Instance method
    String greet(String name) { return "Hello, " + name; }

    // Varargs method
    static int sum(int... numbers) {
        int total = 0;
        for (int n : numbers) total += n;
        return total;
    }

    // Generic method
    static <T extends Comparable<T>> T max(T a, T b) {
        return a.compareTo(b) >= 0 ? a : b;
    }

    // Method with throws clause
    static int parseInt(String s) throws NumberFormatException {
        return Integer.parseInt(s);
    }

    // Covariant return type
    static class Builder {
        String value = "";
        Builder append(String s) { value += s; return this; }  // returns Builder for chaining
    }

    // Method overloading
    static String format(int n) { return "int: " + n; }
    static String format(double d) { return "double: " + d; }
    static String format(String s) { return "string: " + s; }

    public static void main(String[] args) {
        System.out.println(add(3, 4));
        System.out.println(sum(1, 2, 3, 4, 5));   // varargs
        System.out.println(sum());                  // empty varargs → 0
        System.out.println(max("apple", "banana")); // generic method
        System.out.println(max(10, 20));

        // Method chaining with builder
        Builder b = new Builder();
        b.append("Hello").append(", ").append("World!");
        System.out.println(b.value);

        // Overloaded method resolution
        System.out.println(format(42));
        System.out.println(format(3.14));
        System.out.println(format("test"));
    }
}
```

```java
// Example 4: StringBuilder for Mutable Strings
// File: StringBuilderDemo.java
public class StringBuilderDemo {
    public static void main(String[] args) {
        // StringBuilder: mutable character sequence
        StringBuilder sb = new StringBuilder();
        sb.append("Hello");
        sb.append(", ");
        sb.append("World");
        sb.append("!");
        System.out.println(sb.toString());    // Hello, World!
        System.out.println(sb.length());      // 13
        System.out.println(sb.charAt(0));     // H

        sb.insert(5, " Beautiful");           // insert at index
        System.out.println(sb);               // Hello Beautiful, World!

        sb.delete(5, 15);                     // delete range
        System.out.println(sb);               // Hello, World!

        sb.reverse();
        System.out.println(sb);               // !dlroW ,olleH

        // Building strings in a loop — use StringBuilder, not +
        long start = System.nanoTime();
        StringBuilder csv = new StringBuilder();
        for (int i = 0; i < 10_000; i++) {
            csv.append(i).append(',');
        }
        long end = System.nanoTime();
        System.out.printf("Built %d chars in %d µs%n",
            csv.length(), (end - start) / 1000);
    }
}
```

```java
// Example 5: Method Overriding and toString()
// File: MethodOverriding.java
import java.util.Objects;

public class MethodOverriding {

    static class Point {
        final double x, y;

        Point(double x, double y) {
            this.x = x;
            this.y = y;
        }

        @Override
        public String toString() {
            return "Point(%s, %s)".formatted(x, y);
        }

        @Override
        public boolean equals(Object obj) {
            if (this == obj) return true;
            if (!(obj instanceof Point other)) return false;
            return Double.compare(x, other.x) == 0
                && Double.compare(y, other.y) == 0;
        }

        @Override
        public int hashCode() {
            return Objects.hash(x, y);
        }

        // Covariant return
        Point translate(double dx, double dy) {
            return new Point(x + dx, y + dy);
        }
    }

    static class Point3D extends Point {
        final double z;

        Point3D(double x, double y, double z) {
            super(x, y);
            this.z = z;
        }

        @Override
        public String toString() {
            return "Point3D(%s, %s, %s)".formatted(x, y, z);
        }

        @Override
        Point3D translate(double dx, double dy) {  // covariant return
            return new Point3D(x + dx, y + dy, z);
        }
    }

    public static void main(String[] args) {
        Point p = new Point(1.0, 2.0);
        System.out.println(p);                           // Point(1.0, 2.0)
        System.out.println(p.translate(1, 1));           // Point(2.0, 3.0)

        Point3D p3 = new Point3D(1.0, 2.0, 3.0);
        System.out.println(p3);                          // Point3D(1.0, 2.0, 3.0)

        // Polymorphism via toString
        Point ref = p3;
        System.out.println(ref.toString());              // Point3D(1.0, 2.0, 3.0)

        // equals
        System.out.println(p.equals(new Point(1.0, 2.0)));   // true
        System.out.println(p.equals(p3));                     // false (z differs)
    }
}
```

---

## 12. Related Spec Sections

| Section | Topic | URL |
|---------|-------|-----|
| JLS §3.10.5 | String Literals | https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.5 |
| JLS §3.10.6 | Text Blocks | https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.10.6 |
| JLS §4.3.3 | Class String | https://docs.oracle.com/javase/specs/jls/se21/html/jls-4.html#jls-4.3.3 |
| JLS §8.4 | Method Declarations | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.4 |
| JLS §8.4.8 | Overriding | https://docs.oracle.com/javase/specs/jls/se21/html/jls-8.html#jls-8.4.8 |
| JLS §15.12 | Method Invocation | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.12 |
| JLS §15.18.1 | String Concatenation | https://docs.oracle.com/javase/specs/jls/se21/html/jls-15.html#jls-15.18.1 |
| JEP 280 | Indify String Concatenation | https://openjdk.org/jeps/280 |
| JEP 378 | Text Blocks | https://openjdk.org/jeps/378 |
| JEP 254 | Compact Strings | https://openjdk.org/jeps/254 |
