import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('is defined', () => {
    expect(new JwtAuthGuard()).toBeDefined();
  });
});
