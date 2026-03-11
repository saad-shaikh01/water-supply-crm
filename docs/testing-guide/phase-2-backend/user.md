# Phase 2 — Backend Unit Tests: User

**Module path:** `apps/api-backend/src/app/modules/user/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-024: UserService CRUD and password change unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
`User` represents staff (DRIVER, ADMIN). `User.password` field (not `passwordHash`) is hashed with bcrypt. The `isActive` flag soft-disables users. Tests verify CRUD, vendorId isolation, and that password is hashed before storage.

### File to Create
`apps/api-backend/src/app/modules/user/user.service.spec.ts`

### Tasks

#### Task 1: Read UserService source
**Action:** Read `apps/api-backend/src/app/modules/user/user.service.ts`
Identify:
- Constructor dependencies
- `create(vendorId, dto)` — does it hash the password? Which field name is used: `password` (confirmed in MEMORY.md)?
- `changePassword(id, vendorId, dto)` — does it verify old password with `bcrypt.compare`?
- `softDisable(id, vendorId)` method name

#### Task 2: Write user creation tests
**Action:** Create `apps/api-backend/src/app/modules/user/user.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserService } from './user.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockUser, mockVendorId } from '../../../test/factories';

jest.mock('bcrypt');

describe('UserService', () => {
  let service: UserService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get<UserService>(UserService);
  });

  describe('create', () => {
    it('should hash the password before storing the user', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$hashedpassword');
      prismaMock.user.findUnique.mockResolvedValue(null); // email not taken
      prismaMock.user.create.mockResolvedValue(createMockUser());

      await service.create(mockVendorId, {
        email: 'newdriver@test.com',
        password: 'plaintext123',
        name: 'New Driver',
        role: 'DRIVER',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext123', expect.any(Number));
      expect(prismaMock.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ password: '$2b$10$hashedpassword' }),
        }),
      );
    });

    it('should throw ConflictException when email already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(createMockUser());

      await expect(
        service.create(mockVendorId, {
          email: 'driver@test.com',
          password: 'pass',
          name: 'Dupe',
          role: 'DRIVER',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('changePassword', () => {
    it('should update password when old password is correct', async () => {
      const user = createMockUser({ id: 'user-test-001' });
      prismaMock.user.findFirst.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$10$newhashedpassword');
      prismaMock.user.update.mockResolvedValue({ ...user, password: '$2b$10$newhashedpassword' } as any);

      await service.changePassword('user-test-001', mockVendorId, {
        oldPassword: 'correctoldpass',
        newPassword: 'newpass123',
      });

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ password: '$2b$10$newhashedpassword' }),
        }),
      );
    });

    it('should throw UnauthorizedException when old password is incorrect', async () => {
      prismaMock.user.findFirst.mockResolvedValue(createMockUser());
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.changePassword('user-test-001', mockVendorId, {
          oldPassword: 'wrongpass',
          newPassword: 'newpass123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('softDisable (use actual method name)', () => {
    it('should set isActive to false for the user', async () => {
      prismaMock.user.findFirst.mockResolvedValue(createMockUser());
      prismaMock.user.update.mockResolvedValue(createMockUser({ isActive: false }));

      await service.softDisable('user-test-001', mockVendorId);

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
      );
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 5 test cases
- [ ] Password hashing test verifies `bcrypt.hash` is called with plaintext and result is stored
- [ ] `changePassword` tests use `bcrypt.compare` mock
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/user/user.service.spec.ts`
