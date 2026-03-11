# Phase 4 — Frontend Unit Tests: Customer Portal — Auth

**App:** customer-portal
**Feature path:** `apps/customer-portal/src/features/auth/`
**Prerequisites:** TST-INF-004

---

## Setup: Customer Portal Test Helper

Create the same render helper for customer-portal.

### Create `apps/customer-portal/src/test/render-with-providers.tsx`

**Action:** Create the file with the same content as the vendor-dashboard helper:

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

## TST-FE-012: CP LoginForm component tests

**Priority:** P0 Critical
**Type:** Component Unit Test

### Context
The customer portal login form. Tests follow the same pattern as TST-FE-001 but for the customer-portal app.

### File to Create
`apps/customer-portal/src/features/auth/components/__tests__/login-form.spec.tsx`

### Tasks

#### Task 1: Read customer portal LoginForm
**Action:** Read `apps/customer-portal/src/features/auth/components/login-form.tsx`
Identify:
- Hook used for login mutation
- Form fields (phone number? or email?)
- What happens on success (redirect to `/home`)

#### Task 2: Write LoginForm tests
**Action:** Create `apps/customer-portal/src/features/auth/components/__tests__/login-form.spec.tsx`

Write 4 test cases:

1. `it('should render login form with email/phone and password fields')`
   - Assert both fields are rendered
   - Assert submit button is present

2. `it('should show validation error when credential field is empty on submit')`
   - Click submit without filling anything
   - Assert error message

3. `it('should call login mutation with credentials on valid submit')`
   - Fill in valid credentials
   - Submit
   - Assert mutation mock called with correct values

4. `it('should show loading state when login is in progress')`
   - Mock `isPending: true`
   - Assert button is disabled or shows spinner

Mock hooks and `next/navigation`:
```typescript
jest.mock('../../hooks/use-auth', () => ({
  useLogin: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
```

### Acceptance Criteria
- [ ] File `apps/customer-portal/src/test/render-with-providers.tsx` exists
- [ ] File `apps/customer-portal/src/features/auth/components/__tests__/login-form.spec.tsx` exists with 4 test cases
- [ ] All tests pass: `npx nx test customer-portal --testFile=src/features/auth/components/__tests__/login-form.spec.tsx`
