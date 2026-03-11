# Phase 4 — Frontend Unit Tests: Vendor Dashboard — Auth

**App:** vendor-dashboard
**Feature path:** `apps/vendor-dashboard/src/features/auth/`
**Prerequisites:** TST-INF-004 (Jest coverage config)

---

## Setup: Frontend Test Helper

Before writing any frontend component tests, create this shared render helper.

### Create `apps/vendor-dashboard/src/test/render-with-providers.tsx`

**Action:** Create the file:

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

## TST-FE-001: VD LoginForm component tests

**Priority:** P0 Critical
**Type:** Component Unit Test

### Context
`LoginForm` is the first screen any vendor user sees. Tests verify it renders correctly, validates email/password fields, shows errors on invalid input, and calls the login mutation on submit.

### File to Create
`apps/vendor-dashboard/src/features/auth/components/__tests__/login-form.spec.tsx`

### Tasks

#### Task 1: Read LoginForm source
**Action:** Read `apps/vendor-dashboard/src/features/auth/components/login-form.tsx`
Identify:
- Which hook it uses for login mutation (`useLogin`, `useAuth`, etc.)
- What form library is used (react-hook-form + zod)
- What happens on successful login (router.push, toast, etc.)
- What testid or label text the email and password fields have

#### Task 2: Create the test file
**Action:** Create `apps/vendor-dashboard/src/features/auth/components/__tests__/login-form.spec.tsx`

```typescript
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginForm } from '../login-form';
import { renderWithProviders } from '../../../../test/render-with-providers';

// Mock the auth hook
jest.mock('../../hooks/use-auth', () => ({
  useLogin: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

describe('LoginForm', () => {
  it('should render email and password fields', () => {
    renderWithProviders(<LoginForm />);

    expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in|login/i })).toBeInTheDocument();
  });

  it('should show validation error when email is empty and form is submitted', async () => {
    renderWithProviders(<LoginForm />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /sign in|login/i }));

    await waitFor(() => {
      expect(screen.getByText(/email/i)).toBeInTheDocument();
    });
  });

  it('should show validation error for invalid email format', async () => {
    renderWithProviders(<LoginForm />);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'notanemail');
    await user.click(screen.getByRole('button', { name: /sign in|login/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
    });
  });

  it('should call login mutation with email and password on valid form submit', async () => {
    const mockMutate = jest.fn();
    jest.doMock('../../hooks/use-auth', () => ({
      useLogin: () => ({ mutate: mockMutate, isPending: false }),
    }));

    renderWithProviders(<LoginForm />);
    const user = userEvent.setup();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'vendor@test.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /sign in|login/i }));

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'vendor@test.com', password: 'password123' }),
        expect.anything(),
      );
    });
  });

  it('should show loading spinner when isPending is true', () => {
    jest.doMock('../../hooks/use-auth', () => ({
      useLogin: () => ({ mutate: jest.fn(), isPending: true }),
    }));

    renderWithProviders(<LoginForm />);

    expect(screen.getByRole('button', { name: /sign in|login/i })).toBeDisabled();
  });
});
```

> Adjust query selectors based on actual label text and testids found in Task 1.

### Acceptance Criteria
- [ ] File exists with 5 test cases
- [ ] All tests pass: `npx nx test vendor-dashboard --testFile=src/features/auth/components/__tests__/login-form.spec.tsx`
- [ ] No `act()` warnings in test output

---

## TST-FE-002: VD ForgotPasswordForm and ResetPasswordForm component tests

**Priority:** P1 High
**Type:** Component Unit Test

### Files to Create
- `apps/vendor-dashboard/src/features/auth/components/__tests__/forgot-password-form.spec.tsx`
- `apps/vendor-dashboard/src/features/auth/components/__tests__/reset-password-form.spec.tsx`

### Tasks

#### Task 1: Read both form components
**Action:** Read:
- `apps/vendor-dashboard/src/features/auth/components/forgot-password-form.tsx`
- `apps/vendor-dashboard/src/features/auth/components/reset-password-form.tsx`

Note the hooks used, form fields, and success/error states.

#### Task 2: Write ForgotPasswordForm tests
**Action:** Create `apps/vendor-dashboard/src/features/auth/components/__tests__/forgot-password-form.spec.tsx`

Write 3 test cases:
1. `it('should render email input field')`
2. `it('should show validation error when email is empty')`
3. `it('should call forgotPassword mutation with email on valid submit')`

Mock the hook for forgotPassword mutation.

#### Task 3: Write ResetPasswordForm tests
**Action:** Create `apps/vendor-dashboard/src/features/auth/components/__tests__/reset-password-form.spec.tsx`

Write 3 test cases:
1. `it('should render new password and confirm password fields')`
2. `it('should show validation error when passwords do not match')`
3. `it('should call resetPassword mutation with token and new password on valid submit')`

The reset token is typically read from the URL. Mock `useSearchParams` to return a token.

### Acceptance Criteria
- [ ] Both spec files exist
- [ ] 3 test cases each (6 total)
- [ ] All tests pass
