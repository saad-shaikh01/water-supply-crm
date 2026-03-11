# Phase 4 — Frontend Unit Tests: Customer Portal — Tickets

**App:** customer-portal
**Feature path:** `apps/customer-portal/src/features/tickets/`
**Prerequisites:** CP render helper from TST-FE-012

---

## TST-FE-016: CP CreateTicketDialog and TicketDetailDialog tests

**Priority:** P2 Medium
**Type:** Component Unit Test

### Files to Create
- `apps/customer-portal/src/features/tickets/components/__tests__/create-ticket-dialog.spec.tsx`
- `apps/customer-portal/src/features/tickets/components/__tests__/ticket-detail-dialog.spec.tsx`

### Tasks

#### Task 1: Read ticket components
**Action:** Read:
- `apps/customer-portal/src/features/tickets/components/create-ticket-dialog.tsx`
- `apps/customer-portal/src/features/tickets/components/ticket-detail-dialog.tsx`

Identify:
- Form fields in CreateTicketDialog (subject, message, attachment?)
- How TicketDetailDialog shows message thread
- Hooks used: `useCreateTicket`, `useTicket`, `useAddMessage`

#### Task 2: Write CreateTicketDialog tests
**Action:** Create `apps/customer-portal/src/features/tickets/components/__tests__/create-ticket-dialog.spec.tsx`

Mock:
```typescript
const mockCreate = jest.fn();
jest.mock('../../hooks/use-tickets', () => ({
  useCreateTicket: () => ({ mutate: mockCreate, isPending: false }),
}));
```

Write 3 test cases:

1. `it('should render subject and message fields')`
   - Render with `open={true}`
   - Assert both fields present

2. `it('should show validation error when subject is empty')`
   - Click submit without filling subject
   - Assert error message

3. `it('should call createTicket mutation with subject and message on valid submit')`
   - Fill subject and message
   - Click Submit
   - Assert `mockCreate` called with `{ subject: '...', message: '...' }`

#### Task 3: Write TicketDetailDialog tests
**Action:** Create `apps/customer-portal/src/features/tickets/components/__tests__/ticket-detail-dialog.spec.tsx`

Mock:
```typescript
jest.mock('../../hooks/use-tickets', () => ({
  useTicket: () => ({
    data: {
      id: 'ticket-001',
      subject: 'Delivery issue',
      status: 'OPEN',
      messages: [
        { id: 'm1', body: 'My bottle was not delivered', sender: 'CUSTOMER', createdAt: '2025-03-01' },
        { id: 'm2', body: 'We will investigate', sender: 'VENDOR', createdAt: '2025-03-02' },
      ],
    },
    isLoading: false,
  }),
  useAddMessage: () => ({ mutate: jest.fn(), isPending: false }),
}));
```

Write 3 test cases:

1. `it('should render ticket subject and status')`
   - Assert 'Delivery issue' and 'OPEN' text visible

2. `it('should render all messages in the thread')`
   - Assert both message bodies visible

3. `it('should render reply input and Send button')`
   - Assert text area and send button present

### Acceptance Criteria
- [ ] Both spec files exist
- [ ] 3 test cases each (6 total)
- [ ] All tests pass: `npx nx test customer-portal --testFile=src/features/tickets/components/__tests__/create-ticket-dialog.spec.tsx`
