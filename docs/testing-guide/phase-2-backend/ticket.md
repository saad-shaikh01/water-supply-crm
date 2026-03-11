# Phase 2 — Backend Unit Tests: Ticket

**Module path:** `apps/api-backend/src/app/modules/ticket/`
**Prerequisites:** TST-INF-001, TST-INF-002, TST-INF-003

---

## TST-BE-019: TicketService.create() and message threading unit tests

**Priority:** P1 High
**Type:** Unit Test

### Context
`CustomerTicket` was added in session 15. Tickets support threaded messages with file attachments stored in Wasabi S3. Tests must verify ticket creation, message reply, and attachment key storage.

### File to Create
`apps/api-backend/src/app/modules/ticket/ticket.service.spec.ts`

### Tasks

#### Task 1: Read TicketService source
**Action:** Read `apps/api-backend/src/app/modules/ticket/ticket.service.ts`
Identify:
- Constructor dependencies (PrismaService, StorageService, any notification service)
- `create(vendorId, customerId, dto)` method
- The method that adds a reply message
- How file attachments are stored in `TicketMessage.attachments` JSON
- Initial ticket status on creation (OPEN)

#### Task 2: Write ticket creation tests
**Action:** Create `apps/api-backend/src/app/modules/ticket/ticket.service.spec.ts`

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { PrismaService } from '/* correct path */';
import { prismaMock } from '../../../test/prisma-mock';
import { createMockCustomer, mockVendorId } from '../../../test/factories';

describe('TicketService', () => {
  let service: TicketService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TicketService,
        { provide: PrismaService, useValue: prismaMock },
        // Add StorageService mock if injected
        {
          provide: 'StorageService', // use actual injection token
          useValue: { upload: jest.fn().mockResolvedValue({ key: 'attachments/file.jpg' }), getSignedUrl: jest.fn() },
        },
      ],
    }).compile();
    service = module.get<TicketService>(TicketService);
  });

  describe('create', () => {
    it('should create a ticket with OPEN status for a valid customer', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(createMockCustomer());
      prismaMock.customerTicket.create.mockResolvedValue({
        id: 'ticket-001',
        subject: 'Water quality issue',
        status: 'OPEN',
        customerId: 'customer-test-001',
        vendorId: mockVendorId,
      } as any);

      const result = await service.create(mockVendorId, 'customer-test-001', {
        subject: 'Water quality issue',
        message: 'The water tasted strange today.',
      });

      expect(result.status).toBe('OPEN');
      expect(prismaMock.customerTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'OPEN', vendorId: mockVendorId }),
        }),
      );
    });

    it('should throw NotFoundException when customer does not belong to vendor', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(
        service.create(mockVendorId, 'wrong-customer', { subject: 'Issue', message: 'Test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('addMessage (use actual method name)', () => {
    it('should add a message to the ticket thread', async () => {
      const ticket = { id: 'ticket-001', status: 'OPEN', vendorId: mockVendorId };
      prismaMock.customerTicket.findFirst.mockResolvedValue(ticket as any);
      prismaMock.ticketMessage.create.mockResolvedValue({
        id: 'msg-001',
        ticketId: 'ticket-001',
        body: 'Reply from vendor',
        attachments: [],
      } as any);

      const result = await service.addMessage(mockVendorId, 'ticket-001', { body: 'Reply from vendor' });

      expect(prismaMock.ticketMessage.create).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should store attachment keys in TicketMessage.attachments JSON when files are provided', async () => {
      const ticket = { id: 'ticket-001', status: 'OPEN', vendorId: mockVendorId };
      prismaMock.customerTicket.findFirst.mockResolvedValue(ticket as any);
      prismaMock.ticketMessage.create.mockResolvedValue({
        id: 'msg-001',
        ticketId: 'ticket-001',
        body: 'See attached',
        attachments: [{ name: 'photo.jpg', key: 'attachments/photo.jpg' }],
      } as any);

      const mockFile: Express.Multer.File = { buffer: Buffer.from(''), originalname: 'photo.jpg', mimetype: 'image/jpeg' } as any;

      await service.addMessage(mockVendorId, 'ticket-001', { body: 'See attached' }, [mockFile]);

      expect(prismaMock.ticketMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            attachments: expect.arrayContaining([
              expect.objectContaining({ key: expect.stringContaining('attachments/') }),
            ]),
          }),
        }),
      );
    });
  });
});
```

### Acceptance Criteria
- [ ] File exists with 4 test cases
- [ ] Attachment key storage test verifies the JSON structure
- [ ] All tests pass: `npx nx test api-backend --testFile=src/app/modules/ticket/ticket.service.spec.ts`

---

## TST-BE-020: TicketService.close() unit tests

**Priority:** P2 Medium
**Type:** Unit Test

### File to Create/Modify
`apps/api-backend/src/app/modules/ticket/ticket.service.spec.ts` (add to existing file)

### Tasks

#### Task 1: Read close/resolve method
**Action:** Re-read `apps/api-backend/src/app/modules/ticket/ticket.service.ts`
Find the method that closes or resolves a ticket. Note:
- What status it transitions to (CLOSED, RESOLVED)
- Who can close (vendor only? customer too?)
- What happens if ticket is already closed

#### Task 2: Write close tests
**Action:** Add `describe('close')` (use actual method name):

```typescript
describe('close', () => {
  it('should update ticket status to CLOSED', async () => {
    const ticket = { id: 'ticket-001', status: 'OPEN', vendorId: mockVendorId };
    prismaMock.customerTicket.findFirst.mockResolvedValue(ticket as any);
    prismaMock.customerTicket.update.mockResolvedValue({ ...ticket, status: 'CLOSED' } as any);

    const result = await service.close(mockVendorId, 'ticket-001');

    expect(prismaMock.customerTicket.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }),
    );
  });

  it('should throw an error when trying to close an already CLOSED ticket', async () => {
    const ticket = { id: 'ticket-001', status: 'CLOSED', vendorId: mockVendorId };
    prismaMock.customerTicket.findFirst.mockResolvedValue(ticket as any);

    await expect(service.close(mockVendorId, 'ticket-001')).rejects.toThrow();
  });
});
```

### Acceptance Criteria
- [ ] 2 test cases for ticket close
- [ ] All tests pass
