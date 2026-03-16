import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

function createMockContext(user?: { role: UserRole }): ExecutionContext {
  const handler = () => undefined;
  const targetClass = class TestController {};

  return {
    getHandler: () => handler,
    getClass: () => targetClass,
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    guard = new RolesGuard(reflector);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('allows access when no roles metadata is present', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(createMockContext({ role: UserRole.DRIVER }))).toBe(
      true,
    );
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      expect.any(Function),
      expect.any(Function),
    ]);
  });

  it('allows access when the authenticated user role matches the required role', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.VENDOR_ADMIN]);

    expect(
      guard.canActivate(createMockContext({ role: UserRole.VENDOR_ADMIN })),
    ).toBe(true);
  });

  it('denies access when the authenticated user role does not match', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.VENDOR_ADMIN]);

    expect(guard.canActivate(createMockContext({ role: UserRole.DRIVER }))).toBe(
      false,
    );
  });

  it('throws when roles are required but request.user is missing, matching the current guard implementation', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.VENDOR_ADMIN]);

    expect(() => guard.canActivate(createMockContext())).toThrow(TypeError);
  });
});
