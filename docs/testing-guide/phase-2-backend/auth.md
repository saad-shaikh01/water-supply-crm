# Phase 2 — Backend Unit Tests: Auth

**Module path:** `apps/api-backend/src/app/modules/auth/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003 must be complete

---

## TST-BE-001: AuthService.login() unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
`AuthService.login()` is the entry point for all three apps. It validates credentials, checks vendor context, and issues JWT + refresh tokens. Testing this covers the most critical auth path.

### File to Create
`apps/api-backend/src/app/modules/auth/auth.service.spec.ts`

> Note: If this file already exists, read it first and ADD the new describe blocks to the existing file rather than overwriting.

### Tasks

#### Task 1: Read source file before writing tests
**Action:** Read `apps/api-backend/src/app/modules/auth/auth.service.ts` to understand:
- Constructor dependencies (which services/modules are injected)
- Method signature of `login(dto)` — what DTO it accepts, what it returns
- How it queries the database (which Prisma models it uses)
- How it handles password comparison

#### Task 2: Write the AuthService login test suite
**Action:** Create `apps/api-backend/src/app/modules/auth/auth.service.spec.ts`

The test suite must include:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '/* correct import path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockUser, createMockVendor } from '../../../test/factories';

// Mock bcrypt
jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: JwtService,
          useValue: { sign: jest.fn().mockReturnValue('mock-access-token') },
        },
        // Add any other injected services found in Task 1 with jest.fn() mocks
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get(JwtService);
  });

  describe('login', () => {
    it('should return access token and refresh token when credentials are valid', async () => {
      const mockUser = createMockUser({ email: 'driver@test.com' });
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({ email: 'driver@test.com', password: 'plaintext' });

      expect(result).toHaveProperty('accessToken');
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'driver@test.com' } }),
      );
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'notfound@test.com', password: 'anypassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      const mockUser = createMockUser();
      prismaMock.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: mockUser.email, password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user isActive is false', async () => {
      const inactiveUser = createMockUser({ isActive: false });
      prismaMock.user.findUnique.mockResolvedValue(inactiveUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({ email: inactiveUser.email, password: 'password' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
```

> Adjust the mock provider list based on what you found in Task 1. Add all constructor-injected services as mocks.

### Acceptance Criteria
- [ ] File `apps/api-backend/src/app/modules/auth/auth.service.spec.ts` exists
- [ ] Test suite has at minimum 4 test cases for `login()`
- [ ] All 4 test cases pass: `npx nx test api-backend --testFile=src/app/modules/auth/auth.service.spec.ts`
- [ ] No TypeScript errors

---

## TST-BE-002: AuthService.refreshToken() unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
Refresh token rotation (session 12) is a security-critical feature. The service validates an opaque token from Redis, rotates it, and issues a new access token. A broken refresh token causes all users to be silently logged out.

### File to Create/Modify
`apps/api-backend/src/app/modules/auth/auth.service.spec.ts` (add to existing file from TST-BE-001)

### Tasks

#### Task 1: Understand refresh token implementation
**Action:** Read `apps/api-backend/src/app/modules/auth/auth.service.ts`
Identify:
- The method name for refresh token handling
- How Redis is injected (likely `@InjectRedis()` or `REDIS_CLIENT`)
- What the method returns on success vs failure

#### Task 2: Add refresh token tests
**Action:** In the existing `describe('AuthService')` block, add a new `describe('refreshToken')` block:

```typescript
describe('refreshToken', () => {
  it('should return new access token when refresh token is valid', async () => {
    // Mock redis.get to return a userId
    // Mock prisma.user.findUnique to return a mock user
    // Call service.refreshToken('valid-opaque-token')
    // Assert result has accessToken
    // Assert redis.del was called to invalidate old token
    // Assert redis.set was called to store new token
  });

  it('should throw UnauthorizedException when refresh token is not found in Redis', async () => {
    // Mock redis.get to return null
    // Assert rejects with UnauthorizedException
  });

  it('should throw UnauthorizedException when user no longer exists', async () => {
    // Mock redis.get to return a userId
    // Mock prisma.user.findUnique to return null
    // Assert rejects with UnauthorizedException
  });
});
```

> Fill in the actual implementation based on what you read in Task 1. The Redis mock should be injected as a provider in `beforeEach`.

### Acceptance Criteria
- [ ] 3 test cases for `refreshToken` added to the spec file
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/auth/auth.service.spec.ts`

---

## TST-BE-003: AuthService.forgotPassword() and resetPassword() unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
Password reset flow requires sending an email with a token. Unit tests should mock the email service and verify the token is stored and validated correctly.

### File to Create/Modify
`apps/api-backend/src/app/modules/auth/auth.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read forgotPassword and resetPassword implementation
**Action:** Read `apps/api-backend/src/app/modules/auth/auth.service.ts`
Identify:
- Email service injection (likely `EmailService` or similar)
- How the reset token is generated and stored (database or Redis)
- What happens when token is expired or invalid

#### Task 2: Add forgotPassword and resetPassword tests
**Action:** Add two new `describe` blocks to the spec file:

**`describe('forgotPassword')`:**
- `it('should call email service with reset link when user exists')`
- `it('should NOT throw error when user does not exist — security: no email enumeration')`

**`describe('resetPassword')`:**
- `it('should update user password when token is valid and not expired')`
- `it('should throw BadRequestException when reset token is invalid')`
- `it('should throw BadRequestException when reset token is expired')`

### Acceptance Criteria
- [ ] 5 test cases added across the two describe blocks
- [ ] All tests pass

---

## TST-BE-004: JwtAuthGuard and RolesGuard unit tests

**Priority:** P0 Critical
**Type:** Unit Test

### Context
All protected endpoints rely on `JwtAuthGuard` and `RolesGuard`. Testing them ensures unauthorized requests are properly rejected and role-based access works correctly.

### Files to Create
- `apps/api-backend/src/app/common/guards/jwt-auth.guard.spec.ts`
- `apps/api-backend/src/app/common/guards/roles.guard.spec.ts`

### Tasks

#### Task 1: Read guard source files
**Action:** Read both:
- `apps/api-backend/src/app/common/guards/jwt-auth.guard.ts`
- `apps/api-backend/src/app/common/guards/roles.guard.ts`

Understand:
- `JwtAuthGuard`: does it extend `AuthGuard('jwt')`? What does it override?
- `RolesGuard`: how does it read `@Roles()` metadata? What roles enum values exist?

#### Task 2: Write JwtAuthGuard tests
**Action:** Create `apps/api-backend/src/app/common/guards/jwt-auth.guard.spec.ts`

```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard(/* inject dependencies if any */);
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  // Add test for canActivate returning true when JWT is valid (mock the super.canActivate)
  // Add test for canActivate throwing UnauthorizedException when no token
});
```

#### Task 3: Write RolesGuard tests
**Action:** Create `apps/api-backend/src/app/common/guards/roles.guard.spec.ts`

Write test cases:
1. `it('should return true when no roles are required (public route)')` — reflector returns undefined
2. `it('should return true when user role matches required role')`
3. `it('should return false when user role does not match required role')`
4. `it('should return false when user is not attached to request')`

Create mock `ExecutionContext` using:
```typescript
const mockExecutionContext = (user: any, roles: string[]): ExecutionContext => ({
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({
    getRequest: () => ({ user }),
  }),
} as any);
```

### Acceptance Criteria
- [ ] Both guard spec files exist
- [ ] `JwtAuthGuard` spec has at minimum 2 test cases
- [ ] `RolesGuard` spec has all 4 test cases
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/common/guards/roles.guard.spec.ts`
