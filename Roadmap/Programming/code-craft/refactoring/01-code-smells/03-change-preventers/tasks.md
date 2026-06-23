# Change Preventers — Practice Tasks

> 12 hands-on exercises across the three Change Preventers, with full solutions.

---

## Task 1 — Divergent Change (Java)

**Problem:** `OrderManager` is changed for many reasons. Split it.

```java
class OrderManager {
    public void placeOrder(Order o) { ... }
    public void cancelOrder(Order o) { ... }
    public void refundOrder(Order o, BigDecimal amount) { ... }
    public void shipOrder(Order o) { ... }
    public void trackOrder(Order o) { ... }
    
    public BigDecimal applyDiscount(Order o, String coupon) { ... }
    public BigDecimal calculateTax(Order o) { ... }
    public BigDecimal calculateShipping(Order o) { ... }
    
    public void sendOrderConfirmationEmail(Order o) { ... }
    public void sendShippingNotification(Order o) { ... }
}
```

**Solution:**

```java
class OrderLifecycleService {
    public void place(Order o) { ... }
    public void cancel(Order o) { ... }
    public void refund(Order o, BigDecimal amount) { ... }
}

class FulfillmentService {
    public void ship(Order o) { ... }
    public TrackingInfo track(Order o) { ... }
}

class PricingService {
    public BigDecimal applyDiscount(Order o, String coupon) { ... }
    public BigDecimal calculateTax(Order o) { ... }
    public BigDecimal calculateShipping(Order o) { ... }
}

class OrderNotificationService {
    public void sendOrderConfirmation(Order o) { ... }
    public void sendShippingNotification(Order o) { ... }
}
```

Three categories of changes (lifecycle, pricing, notification) now have homes. Each service has 3-4 methods.

---

## Task 2 — Shotgun Surgery (Java)

**Problem:** Adding a field requires editing 4 layers. Reduce the scatter.

```java
// Domain
class Customer {
    private String name;
    private String email;
}

// DTO
class CustomerDto {
    public String name;
    public String email;
}

// JPA Entity
@Entity
class CustomerEntity {
    @Id @Column public String id;
    @Column public String name;
    @Column public String email;
}

// Mapper
class CustomerMapper {
    public CustomerDto toDto(Customer c) { return new CustomerDto(c.getName(), c.getEmail()); }
    public Customer fromEntity(CustomerEntity e) { return new Customer(e.name, e.email); }
}
```

**Solution (with MapStruct):**

```java
@Mapper(componentModel = "spring")
public interface CustomerMapper {
    CustomerDto toDto(Customer customer);
    Customer toDomain(CustomerEntity entity);
    CustomerEntity toEntity(Customer customer);
}

// Domain (single source of truth — could be a record)
public record Customer(String name, String email) {}

@Entity
class CustomerEntity {
    @Id String id;
    String name;
    String email;
}

class CustomerDto {
    public String name;
    public String email;
}
```

Adding "country" requires editing `Customer`, `CustomerEntity`, `CustomerDto` — but the *mapper* is regenerated. With more tooling (e.g., a Java-first GraphQL framework), the GraphQL type is also derived.

For maximum scatter reduction: declare `Customer` once as a Pydantic-style "schema-first" type and generate the rest. In Java, this is harder than in Python; in TypeScript it's almost free with Zod.

---

## Task 3 — Parallel Inheritance Hierarchies (Java)

**Problem:** Eliminate the parallel hierarchy by moving methods.

```java
abstract class Vehicle {
    public abstract double weight();
}
class Car extends Vehicle { public double weight() { return 1500; } }
class Truck extends Vehicle { public double weight() { return 5000; } }

abstract class VehicleTaxCalculator {
    public abstract BigDecimal calculate(Vehicle v);
}
class CarTaxCalculator extends VehicleTaxCalculator { ... }
class TruckTaxCalculator extends VehicleTaxCalculator { ... }
```

**Solution:**

```java
abstract class Vehicle {
    public abstract double weight();
    public abstract BigDecimal calculateTax();  // moved here
}

class Car extends Vehicle {
    public double weight() { return 1500; }
    public BigDecimal calculateTax() {
        return new BigDecimal("150.00");  // car tax logic
    }
}

class Truck extends Vehicle {
    public double weight() { return 5000; }
    public BigDecimal calculateTax() {
        return new BigDecimal("500.00");  // truck tax logic
    }
}

// VehicleTaxCalculator hierarchy is gone.
// Adding Bicycle? Just one new class.
```

---

## Task 4 — Extract Class for Divergent Change (Python)

**Problem:** `User` class has too many responsibilities.

```python
class User:
    def __init__(self, name, email, password_hash):
        self.name = name
        self.email = email
        self.password_hash = password_hash
        self.preferences = {}
        self.subscription = None
    
    # auth
    def verify_password(self, password): ...
    def reset_password(self, new_password): ...
    def enable_mfa(self): ...
    
    # profile
    def update_email(self, email): ...
    def update_name(self, name): ...
    
    # preferences
    def set_preference(self, key, value): ...
    def get_preference(self, key): ...
    
    # subscription
    def upgrade(self, plan): ...
    def cancel_subscription(self): ...
    def billing_status(self): ...
```

**Solution:**

```python
class UserCredentials:
    def __init__(self, password_hash):
        self.password_hash = password_hash
        self.mfa_enabled = False
    def verify_password(self, password): ...
    def reset_password(self, new_password): ...
    def enable_mfa(self): self.mfa_enabled = True

class UserProfile:
    def __init__(self, name, email):
        self.name = name
        self.email = email
    def update_email(self, email): self.email = email
    def update_name(self, name): self.name = name

class UserPreferences:
    def __init__(self):
        self.values = {}
    def set(self, key, value): self.values[key] = value
    def get(self, key): return self.values.get(key)

class UserSubscription:
    def __init__(self):
        self.plan = None
    def upgrade(self, plan): self.plan = plan
    def cancel(self): self.plan = None
    def status(self): return self.plan or "free"

class User:
    def __init__(self, name, email, password_hash):
        self.profile = UserProfile(name, email)
        self.credentials = UserCredentials(password_hash)
        self.preferences = UserPreferences()
        self.subscription = UserSubscription()
```

---

## Task 5 — Inline Class for Shotgun Surgery (Java)

**Problem:** `OrderId` and `OrderIdGenerator` are split unnecessarily — every change to ID format requires editing both.

```java
class OrderId {
    private final String value;
    public OrderId(String value) { this.value = value; }
    public String value() { return value; }
}

class OrderIdGenerator {
    public OrderId generate() {
        return new OrderId("ORD-" + UUID.randomUUID());
    }
}
```

**Solution:**

```java
final class OrderId {
    private final String value;
    public OrderId(String value) { this.value = value; }
    public String value() { return value; }
    
    public static OrderId generate() {
        return new OrderId("ORD-" + UUID.randomUUID());
    }
}
```

Static factory on the value type. One file owns ID generation and representation. ID format change = one file edit.

---

## Task 6 — Bridge instead of Parallel Hierarchy (Java)

**Problem:** Two parallel hierarchies represent two real axes — apply Bridge instead of Move.

```java
// Hierarchy 1: rendering
abstract class Renderer { abstract void render(Shape s); }
class CanvasRenderer extends Renderer { ... }
class SvgRenderer extends Renderer { ... }

// Hierarchy 2: shapes — currently each is rendered specifically
class CircleOnCanvas extends Renderer { ... }   // coupled
class CircleAsSvg extends Renderer { ... }      // coupled
class SquareOnCanvas extends Renderer { ... }
class SquareAsSvg extends Renderer { ... }
```

This is a 2D matrix: shapes × renderers = 4 (then 6, then 9...) classes.

**Solution (Bridge pattern):**

```java
abstract class Shape {
    protected final Renderer renderer;
    Shape(Renderer r) { this.renderer = r; }
    public abstract void draw();
}

interface Renderer {
    void drawCircle(double r);
    void drawSquare(double side);
}

class Circle extends Shape {
    private final double radius;
    Circle(Renderer r, double radius) { super(r); this.radius = radius; }
    public void draw() { renderer.drawCircle(radius); }
}

class Square extends Shape {
    private final double side;
    Square(Renderer r, double side) { super(r); this.side = side; }
    public void draw() { renderer.drawSquare(side); }
}

class CanvasRenderer implements Renderer {
    public void drawCircle(double r) { /* canvas-specific */ }
    public void drawSquare(double s) { /* canvas-specific */ }
}

class SvgRenderer implements Renderer {
    public void drawCircle(double r) { /* svg-specific */ }
    public void drawSquare(double s) { /* svg-specific */ }
}
```

Now adding `Triangle`: one new `Shape`, plus `drawTriangle` method on each renderer (compiler enforces). Adding `PdfRenderer`: one new class, no shape changes.

---

## Task 7 — Move Method to consolidate scatter (Python)

**Problem:** Calculating an order's total is scattered across helper functions in different modules.

```python
# In order_helpers.py
def calculate_subtotal(order): ...

# In tax_helpers.py
def calculate_tax(order): ...

# In shipping_helpers.py
def calculate_shipping(order): ...

# In OrderService
def total(self, order):
    return calculate_subtotal(order) + calculate_tax(order) + calculate_shipping(order)
```

**Solution:** move calculation methods onto `Order`.

```python
@dataclass
class Order:
    items: list
    customer: 'Customer'
    
    def subtotal(self) -> Decimal: ...
    def tax(self) -> Decimal: ...
    def shipping(self) -> Decimal: ...
    def total(self) -> Decimal:
        return self.subtotal() + self.tax() + self.shipping()
```

`Order` knows everything about itself. Adding "discount" = one new method on `Order`, called from `total()`. No scatter.

---

## Task 8 — Identify the smell (Java, open-ended)

**Problem:** Identify the Change Preventer(s) and describe the cure.

```java
// File: src/main/java/.../UserController.java
class UserController {
    @PostMapping("/api/users")
    public ResponseEntity<?> create(@RequestBody UserRequest req) {
        User user = new User();
        user.setName(req.getName());
        user.setEmail(req.getEmail());
        user.setCountry(req.getCountry());
        userRepo.save(user);
        return ResponseEntity.ok(toResponse(user));
    }
    
    private UserResponse toResponse(User u) {
        UserResponse r = new UserResponse();
        r.name = u.getName();
        r.email = u.getEmail();
        r.country = u.getCountry();
        return r;
    }
}

// File: src/main/java/.../UserResponse.java
class UserResponse {
    public String name;
    public String email;
    public String country;
}

// File: src/main/java/.../UserRequest.java
class UserRequest {
    private String name;
    private String email;
    private String country;
    // getters/setters...
}

// File: src/main/java/.../User.java
class User {
    private Long id;
    private String name;
    private String email;
    private String country;
    // getters/setters...
}

// File: src/main/java/.../UserDto.java
class UserDto {
    public String name;
    public String email;
    public String country;
}

// File: src/main/java/.../UserConverter.java
class UserConverter {
    public UserDto toDto(User u) { ... }
}
```

**Solution:**

| Smell | Where |
|---|---|
| **Shotgun Surgery** | Adding "phone" requires editing 6 files |
| **Alternative Classes (related)** | `UserRequest`, `UserResponse`, `UserDto` all represent essentially the same data with different field naming |

**Cures:**

1. **MapStruct** for the mapping boilerplate.
2. **Consolidate `UserRequest`, `UserResponse`, `UserDto`** — likely one or two are unnecessary.
3. **Use Java records** for the DTOs (less boilerplate).
4. **Consider** if `User` and the API DTO can share fields via an interface or a code-generation step.

After:

```java
public record UserRequest(String name, String email, String country) {}
public record UserResponse(String name, String email, String country) {}

@Mapper(componentModel = "spring")
interface UserMapper {
    UserResponse toResponse(User u);
    User toDomain(UserRequest r);
}
```

Adding "phone": one field added to records + entity = 3 small edits, mapper regenerated.

---

## Task 9 — Cross-cutting concern, not Shotgun Surgery (Java)

**Problem:** Every method in a service starts with auth check. Refactor.

```java
class OrderService {
    public void placeOrder(User user, Order o) {
        if (!authService.isAuthenticated(user)) throw new UnauthorizedException();
        if (!authService.canPlaceOrder(user)) throw new ForbiddenException();
        // ... business logic
    }
    
    public void cancelOrder(User user, OrderId id) {
        if (!authService.isAuthenticated(user)) throw new UnauthorizedException();
        if (!authService.canCancelOrder(user, id)) throw new ForbiddenException();
        // ... business logic
    }
    
    // ... 20 more methods, all starting the same way
}
```

**Solution: Spring AOP aspect** (cross-cutting concern, not Shotgun Surgery).

```java
@Aspect
@Component
class AuthenticationAspect {
    @Before("@annotation(RequiresAuth)")
    public void checkAuth(JoinPoint pjp, RequiresAuth annotation) {
        User user = SecurityContextHolder.getCurrentUser();
        if (!authService.isAuthenticated(user)) throw new UnauthorizedException();
        if (!authService.has(user, annotation.permission()))
            throw new ForbiddenException();
    }
}

@Retention(RUNTIME)
@Target(METHOD)
@interface RequiresAuth {
    String permission();
}

class OrderService {
    @RequiresAuth(permission = "ORDER_PLACE")
    public void placeOrder(Order o) { /* business */ }
    
    @RequiresAuth(permission = "ORDER_CANCEL")
    public void cancelOrder(OrderId id) { /* business */ }
}
```

Auth checks are declarative. Adding new methods just requires the annotation.

---

## Task 10 — Code generation to reduce scatter (multi-language)

**Problem:** A `Customer` definition lives in:
- Java backend
- TypeScript frontend
- Python data pipeline
- SQL schema

Each adds fields independently. Drift is constant.

**Solution:** schema-first design with Protobuf.

```protobuf
syntax = "proto3";

message Customer {
    string id = 1;
    string name = 2;
    string email = 3;
    string country = 4;
}
```

Build pipeline generates:
- `Customer.java` (via protoc-java)
- `customer.ts` (via protoc-ts or similar)
- `customer.py` (via protoc-python)
- SQL schema (via custom generator or via migrations referenced from proto)

Adding "phone": one line in `.proto`. Regenerate. All four layers stay in sync.

---

## Task 11 — Decompose god service in Go

**Problem:**

```go
package main

type UserService struct{ db *sql.DB }

func (s *UserService) Register(name, email string) error { ... }
func (s *UserService) Login(email, password string) (*Session, error) { ... }
func (s *UserService) Logout(sessionID string) error { ... }
func (s *UserService) UpdateEmail(userID, newEmail string) error { ... }
func (s *UserService) ChangePassword(userID, oldPassword, newPassword string) error { ... }
func (s *UserService) EnableMFA(userID string) error { ... }
func (s *UserService) GetEngagementScore(userID string) (float64, error) { ... }
func (s *UserService) RecommendFriends(userID string) ([]string, error) { ... }
func (s *UserService) ExportGDPR(userID string) ([]byte, error) { ... }
func (s *UserService) DeleteForGDPR(userID string) error { ... }
```

**Solution:**

```go
package user

type IdentityService struct{ db *sql.DB }
func (s *IdentityService) Register(name, email string) error { ... }
func (s *IdentityService) UpdateEmail(userID, newEmail string) error { ... }

type AuthService struct{ db *sql.DB }
func (s *AuthService) Login(email, password string) (*Session, error) { ... }
func (s *AuthService) Logout(sessionID string) error { ... }
func (s *AuthService) ChangePassword(userID, oldPassword, newPassword string) error { ... }
func (s *AuthService) EnableMFA(userID string) error { ... }

type AnalyticsService struct{ db *sql.DB }
func (s *AnalyticsService) GetEngagementScore(userID string) (float64, error) { ... }
func (s *AnalyticsService) RecommendFriends(userID string) ([]string, error) { ... }

type GDPRService struct{ db *sql.DB }
func (s *GDPRService) Export(userID string) ([]byte, error) { ... }
func (s *GDPRService) Delete(userID string) error { ... }
```

Four packages or four files in one package, each cohesive. Cure for Divergent Change at Go scale.

---

## Task 12 — Audit a real codebase for Change Preventers

**Problem:** Apply this analysis to a project you maintain:

1. List the top 5 files by recent change frequency (`git log --since='6 months' --pretty=format: --name-only | sort | uniq -c | sort -nr | head -5`).
2. For each, read the recent commit messages. Are they about one topic, or many?
3. List the top 5 file *pairs* by co-change (use a script or manual inspection).
4. For each pair, ask: are they always changed together by necessity (cure: consolidate) or by chance (no smell)?

**Solution:** there's no canned answer — every codebase is different. Apply the diagnostic and decide:

- Top file with diverse commits: candidate for Extract Class.
- File pairs with high co-change: candidate for Inline Class or for code generation.
- Files appearing in top change-frequency for years without growing in size: stable, well-designed; leave alone.

Refactor priority is *change-driven*, not *aesthetics-driven*. Refactor what hurts.

---

> **Next:** [find-bug.md](find-bug.md) — bugs hiding in Change Preventer patterns.
