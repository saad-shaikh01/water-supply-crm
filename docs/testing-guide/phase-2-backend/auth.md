# Phase 2 — Backend Unit Tests: Auth

**Module path:** `apps/api-backend/src/app/modules/auth/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003 complete

---

## Key facts (read from source before writing tests)

From `auth.service.ts` and `auth.controller.ts`:

| What | Detail |
|------|--------|
| Login DTO field | `identifier` (email OR phone) — **not `email`** |
| `validateUser(identifier, pass)` | Returns user object (without password) or `null` |
| `login(user)` | Receives user object from `validateUser`, calls `generateTokens(user)` |
| Response shape | `{ access_token, refresh_token, expires_in, user: { id, email, name, role, vendorId } }` — **not `accessToken`** |
| Refresh | `refreshTokens(refreshToken: string)` — token comes from **request body** via `RefreshTokenDto`, **not a cookie** |
| Refresh storage | Redis via `CacheInvalidationService.get/set/del` with key `auth:refresh:<token>` |
| Dependencies | `UserService`, `JwtService`, `EmailService`, `CacheInvalidationService` |
| Password field | `user.password` (per MEMORY.md) — compared with `bcrypt.compare` |

---

## TST-BE-001: AuthService.validateUser() and login() unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### File to Create
`apps/api-backend/src/app/modules/auth/auth.service.spec.ts`

> If this file already exists, read it first and ADD new describe blocks rather than overwriting.

### Tasks

#### Task 1: Read source files before writing
**Action:** Read all three files:
1. `apps/api-backend/src/app/modules/auth/auth.service.ts`
2. `apps/api-backend/src/app/modules/auth/auth.controller.ts`
3. `apps/api-backend/src/app/modules/auth/dto/login.dto.ts`

Confirm: `LoginDto` has `identifier` field. `validateUser` calls `userService.findByIdentifier(identifier)`. `login(user)` calls `generateTokens(user)`.

#### Task 2: Read UserService to understand findByIdentifier
**Action:** Read `apps/api-backend/src/app/modules/user/user.service.ts`
Find `findByIdentifier(identifier)` — note which Prisma field it queries (email or phoneNumber).

#### Task 3: Write the test file
**Action:** Create `apps/api-backend/src/app/modules/auth/auth.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { EmailService } from '../email/email.service';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import { createMockUser, mockVendorId } from '../../../test/factories';

jest.mock('bcrypt');

// CacheInvalidationService mock — used for refresh token storage
const mockCache = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
};

// UserService mock
const mockUserService = {
  findByIdentifier: jest.fn(),
  findByEmail: jest.fn(),
  findById: jest.fn(),
  updatePassword: jest.fn(),
};

// EmailService mock
const mockEmailService = {
  sendPasswordReset: jest.fn(),
  sendPasswordChanged: jest.fn(),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UserService, useValue: mockUserService },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('mock-jwt'), verify: jest.fn() } },
        { provide: EmailService, useValue: mockEmailService },
        { provide: CacheInvalidationService, useValue: mockCache },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  // ─── validateUser ─────────────────────────────────────────────────────────

  describe('validateUser', () => {
    it('should return user without password when identifier and password are valid', async () => {
      const mockUser = createMockUser({ email: 'driver@test.com' });
      mockUserService.findByIdentifier.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('driver@test.com', 'correctpassword');

      expect(result).not.toHaveProperty('password');
      expect(result.email).toBe('driver@test.com');
      expect(mockUserService.findByIdentifier).toHaveBeenCalledWith('driver@test.com');
    });

    it('should return null when user is not found', async () => {
      mockUserService.findByIdentifier.mockResolvedValue(null);

      const result = await service.validateUser('nobody@test.com', 'pass');

      expect(result).toBeNull();
    });

    it('should return null when password does not match', async () => {
      mockUserService.findByIdentifier.mockResolvedValue(createMockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validateUser('driver@test.com', 'wrongpassword');

      expect(result).toBeNull();
    });
  });

  // ─── login ────────────────────────────────────────────────────────────────

  describe('login', () => {
    it('should return access_token, refresh_token, and user object', async () => {
      const userWithoutPassword = { id: 'user-001', email: 'driver@test.com', name: 'Driver', role: 'DRIVER', vendorId: mockVendorId };
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.login(userWithoutPassword);

      expect(result).toHaveProperty('access_token');
      expect(result).toHaveProperty('refresh_token');
      expect(result).toHaveProperty('user');
      expect(result.user.email).toBe('driver@test.com');
      // Verify refresh token stored in cache
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.stringContaining('auth:refresh:'),
        expect.objectContaining({ userId: 'user-001' }),
        expect.any(Number),
      );
    });

    it('should include customerId in token payload for CUSTOMER role', async () => {
      const customerUser = { id: 'user-c01', email: 'c@test.com', name: 'Customer', role: 'CUSTOMER', vendorId: mockVendorId, customer: { id: 'customer-001' } };
      mockCache.set.mockResolvedValue(undefined);

      const result = await service.login(customerUser);

      expect(result.user).toHaveProperty('customerId', 'customer-001');
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with `validateUser` (3 tests) and `login` (2 tests)
- [ ] Response shape uses `access_token` and `refresh_token` — **not** `accessToken`
- [ ] `bcrypt.compare` is mocked — not called against a real hash
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/auth/auth.service.spec.ts`

---

## TST-BE-002: AuthService.refreshTokens() unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### File to Modify
`apps/api-backend/src/app/modules/auth/auth.service.spec.ts` (add to existing file)

### Key facts
- `refreshTokens(refreshToken: string)` — receives the raw opaque token string
- Calls `cache.get('auth:refresh:<token>')` — if null, throws `UnauthorizedException`
- Calls `cache.del(old key)` then `cache.set(new key)` — rotation
- Calls `userService.findById(stored.userId)` — if user inactive, throws `UnauthorizedException`

### Tasks

**Action:** Add `describe('refreshTokens')` to the existing spec file:

```typescript
describe('refreshTokens', () => {
  it('should return new access_token and refresh_token when token is valid', async () => {
    const mockUser = { id: 'user-001', email: 'driver@test.com', name: 'Driver', role: 'DRIVER', vendorId: mockVendorId, isActive: true };
    mockCache.get.mockResolvedValue({ userId: 'user-001' });
    mockCache.del.mockResolvedValue(undefined);
    mockCache.set.mockResolvedValue(undefined);
    mockUserService.findById.mockResolvedValue(mockUser);

    const result = await service.refreshTokens('valid-opaque-token');

    expect(result).toHaveProperty('access_token');
    expect(result).toHaveProperty('refresh_token');
    // Old token deleted
    expect(mockCache.del).toHaveBeenCalledWith('auth:refresh:valid-opaque-token');
    // New token stored
    expect(mockCache.set).toHaveBeenCalledWith(
      expect.stringContaining('auth:refresh:'),
      expect.objectContaining({ userId: 'user-001' }),
      expect.any(Number),
    );
  });

  it('should throw UnauthorizedException when token is not in cache', async () => {
    mockCache.get.mockResolvedValue(null);

    await expect(service.refreshTokens('stale-token')).rejects.toThrow('Invalid or expired refresh token');
  });

  it('should throw UnauthorizedException when user is deactivated', async () => {
    mockCache.get.mockResolvedValue({ userId: 'user-001' });
    mockCache.del.mockResolvedValue(undefined);
    mockUserService.findById.mockResolvedValue({ id: 'user-001', isActive: false });

    await expect(service.refreshTokens('valid-token')).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when user no longer exists', async () => {
    mockCache.get.mockResolvedValue({ userId: 'gone-user' });
    mockCache.del.mockResolvedValue(undefined);
    mockUserService.findById.mockResolvedValue(null);

    await expect(service.refreshTokens('valid-token')).rejects.toThrow(UnauthorizedException);
  });
});
```

Add `UnauthorizedException` to the imports at top of spec file.

### Acceptance Criteria
- [ ] 4 test cases for `refreshTokens`
- [ ] Token rotation is verified: `cache.del` called with old key, `cache.set` called with new key
- [ ] All tests pass

---

## TST-BE-003: AuthService.generateResetToken() and resetPassword() unit tests

**Priority:** P1 High
**Type:** Unit Test

### File to Modify
`apps/api-backend/src/app/modules/auth/auth.service.spec.ts` (add to existing file)

### Key facts from source
- `generateResetToken(email)` — calls `userService.findByEmail(email)`. If user not found, returns **silently** (no error — anti-enumeration). If found, calls `emailService.sendPasswordReset(email, name, token)`.
- Reset token is a **JWT** signed with `{ sub, email, type: 'password-reset' }` and `expiresIn: '15m'` — **not stored in Redis**
- `resetPassword(token, newPassword)` — calls `verifyResetToken` which calls `jwtService.verify(token)` and checks `payload.type === 'password-reset'`

### Tasks

**Action:** Add these two describe blocks to the existing spec file:

```typescript
import { UnauthorizedException } from '@nestjs/common';

describe('generateResetToken', () => {
  it('should call emailService.sendPasswordReset when user exists', async () => {
    const user = createMockUser({ email: 'user@test.com', name: 'User' });
    mockUserService.findByEmail.mockResolvedValue(user);
    mockEmailService.sendPasswordReset.mockResolvedValue(undefined);

    await service.generateResetToken('user@test.com');

    expect(mockEmailService.sendPasswordReset).toHaveBeenCalledWith(
      'user@test.com',
      'User',
      expect.any(String), // the JWT token
    );
  });

  it('should return silently without throwing when user does not exist (anti-enumeration)', async () => {
    mockUserService.findByEmail.mockResolvedValue(null);

    // Must not throw
    await expect(service.generateResetToken('nobody@test.com')).resolves.toBeUndefined();
    expect(mockEmailService.sendPasswordReset).not.toHaveBeenCalled();
  });
});

describe('resetPassword', () => {
  it('should hash and save new password when JWT token is valid', async () => {
    const mockJwtService = module.get<JwtService>(JwtService);
    (mockJwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-001', type: 'password-reset' });
    mockUserService.updatePassword.mockResolvedValue(undefined);
    mockUserService.findById.mockResolvedValue(createMockUser());
    mockEmailService.sendPasswordChanged.mockResolvedValue(undefined);
    (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$newhash');

    await service.resetPassword('valid.jwt.token', 'newpassword123');

    expect(bcrypt.hash).toHaveBeenCalledWith('newpassword123', 10);
    expect(mockUserService.updatePassword).toHaveBeenCalledWith('user-001', '$2b$10$newhash');
  });

  it('should throw UnauthorizedException when JWT token is invalid', async () => {
    const mockJwtService = module.get<JwtService>(JwtService);
    (mockJwtService.verify as jest.Mock).mockImplementation(() => { throw new Error('jwt malformed'); });

    await expect(service.resetPassword('bad.token', 'pass')).rejects.toThrow(UnauthorizedException);
  });

  it('should throw UnauthorizedException when token type is not password-reset', async () => {
    const mockJwtService = module.get<JwtService>(JwtService);
    (mockJwtService.verify as jest.Mock).mockReturnValue({ sub: 'user-001', type: 'access' }); // wrong type

    await expect(service.resetPassword('wrong-type.token', 'pass')).rejects.toThrow(UnauthorizedException);
  });
});
```

> Note: `module` must be accessible in these describe blocks. Move `let module: TestingModule` to the outer scope and assign it in `beforeEach`.

### Acceptance Criteria
- [ ] 5 test cases across `generateResetToken` and `resetPassword`
- [ ] Anti-enumeration test verifies `emailService.sendPasswordReset` is NOT called when user missing
- [ ] All tests pass

---

## TST-BE-004: JwtAuthGuard and RolesGuard unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Files to Create
- `apps/api-backend/src/app/common/guards/jwt-auth.guard.spec.ts`
- `apps/api-backend/src/app/common/guards/roles.guard.spec.ts`

### Tasks

#### Task 1: Read guard source files
**Action:** Read:
- `apps/api-backend/src/app/common/guards/jwt-auth.guard.ts`
- `apps/api-backend/src/app/common/guards/roles.guard.ts`
- `apps/api-backend/src/app/common/decorators/roles.decorator.ts`

Note: `RolesGuard` reads the `@Roles()` decorator metadata using `Reflector`. Roles from the `UserRole` enum are: `SUPER_ADMIN`, `VENDOR_ADMIN`, `STAFF`, `DRIVER`, `CUSTOMER`.

#### Task 2: Write RolesGuard tests
**Action:** Create `apps/api-backend/src/app/common/guards/roles.guard.spec.ts`

```typescript
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

const createMockContext = (user: any, handlerRoles?: string[]): ExecutionContext => {
  const reflector = new Reflector();
  // Override getAll to return the roles
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as any;
};

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(async () => {
    reflector = { getAllAndOverride: jest.fn() } as any;
    guard = new RolesGuard(reflector);
  });

  it('should return true when no roles are required (public route)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const ctx = createMockContext({ role: 'DRIVER' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return true when user role matches required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['VENDOR_ADMIN']);
    const ctx = createMockContext({ role: 'VENDOR_ADMIN' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('should return false when user role does not match required role', () => {
    reflector.getAllAndOverride.mockReturnValue(['VENDOR_ADMIN']);
    const ctx = createMockContext({ role: 'DRIVER' });

    expect(guard.canActivate(ctx)).toBe(false);
  });

  it('should return false when there is no user on the request', () => {
    reflector.getAllAndOverride.mockReturnValue(['VENDOR_ADMIN']);
    const ctx = createMockContext(undefined);

    expect(guard.canActivate(ctx)).toBe(false);
  });
});
```

> Adjust mock to match the actual Reflector method used in `RolesGuard` (may be `getAllAndOverride` or `get` — verify in Task 1).

#### Task 3: Write JwtAuthGuard tests
**Action:** Create `apps/api-backend/src/app/common/guards/jwt-auth.guard.spec.ts`

Read the guard implementation first. If it extends `AuthGuard('jwt')` and only calls `super.canActivate`, write a minimal test:

```typescript
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('should be defined', () => {
    expect(new JwtAuthGuard()).toBeDefined();
  });

  // Additional tests depend on whether JwtAuthGuard overrides canActivate.
  // Read jwt-auth.guard.ts: if it only extends AuthGuard('jwt') with no
  // overrides, the above is sufficient — Passport strategy handles the rest.
});
```

### Acceptance Criteria
- [ ] Both spec files exist
- [ ] `RolesGuard` has 4 test cases covering: no roles, role match, role mismatch, no user
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/common/guards/roles.guard.spec.ts`
