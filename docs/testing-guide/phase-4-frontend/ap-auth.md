# Phase 4 — Frontend Unit Tests: Admin Panel — Auth

**App:** admin-panel
**Feature path:** `apps/admin-panel/src/features/auth/`
**Prerequisites:** TST-INF-004

---

## Setup: Admin Panel Test Helper

### Create `apps/admin-panel/src/test/render-with-providers.tsx`

**Action:** Create the file with identical content to the vendor-dashboard helper:

```typescript
import React from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const queryClient = createTestQueryClient();
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
}
```

---

## TST-FE-017: AP LoginForm and SignupForm component tests

**Priority:** P1 High
**Type:** Component Unit Test

### Files to Create
- `apps/admin-panel/src/features/auth/components/__tests__/login-form.spec.tsx`
- `apps/admin-panel/src/features/auth/components/__tests__/signup-form.spec.tsx`

### Tasks

#### Task 1: Read admin panel auth forms
**Action:** Read:
- `apps/admin-panel/src/features/auth/components/login-form.tsx`
- `apps/admin-panel/src/features/auth/components/signup-form.tsx`

Note:
- Whether login uses email or a different credential
- SignupForm fields (name, email, password, vendorId or invite code?)
- Hooks used for each

#### Task 2: Write LoginForm tests
**Action:** Create `apps/admin-panel/src/features/auth/components/__tests__/login-form.spec.tsx`

Mock:
```typescript
jest.mock('../../hooks/use-auth', () => ({
  useLogin: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
```

Write 3 test cases:
1. `it('should render email and password fields')`
2. `it('should show error when fields are empty on submit')`
3. `it('should call login mutation on valid submit')`

#### Task 3: Write SignupForm tests
**Action:** Create `apps/admin-panel/src/features/auth/components/__tests__/signup-form.spec.tsx`

Mock:
```typescript
jest.mock('../../hooks/use-auth', () => ({
  useSignup: () => ({ mutate: jest.fn(), isPending: false }),
}));
```

Write 3 test cases:
1. `it('should render all required signup fields')`
   - Assert name, email, password fields visible
2. `it('should show error when passwords do not match')`
   - Fill password fields with different values
   - Submit
   - Assert mismatch error
3. `it('should call signup mutation with form data on valid submit')`
   - Fill all fields
   - Submit
   - Assert mutation called

### Acceptance Criteria
- [ ] Helper file `apps/admin-panel/src/test/render-with-providers.tsx` exists
- [ ] Both spec files exist with 3 test cases each
- [ ] All tests pass: `npx nx test admin-panel --testFile=src/features/auth/components/__tests__/login-form.spec.tsx`
