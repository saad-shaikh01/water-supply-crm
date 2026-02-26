import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { NotificationService } from './notification.service';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';

describe('NotificationService', () => {
  let service: NotificationService;
  let mockQueue: { add: jest.Mock };

  beforeEach(async () => {
    mockQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getQueueToken(QUEUE_NAMES.NOTIFICATIONS),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  // ──────────────────────────────────────────────────────────────────────────
  // queueWhatsApp
  // ──────────────────────────────────────────────────────────────────────────

  describe('queueWhatsApp', () => {
    it('queues a WhatsApp job without jobId when no idempotency key given', async () => {
      await service.queueWhatsApp('+923001234567', 'Hello');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_WHATSAPP,
        { phoneNumber: '+923001234567', message: 'Hello' },
        undefined,
      );
    });

    it('queues a WhatsApp job with jobId when idempotency key is provided', async () => {
      const key = 'ntf:order.approved:order-123:wa';
      await service.queueWhatsApp('+923001234567', 'Hello', key);

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_WHATSAPP,
        { phoneNumber: '+923001234567', message: 'Hello' },
        { jobId: key },
      );
    });

    it('uses the same jobId for the same idempotency key (dedupe guarantee)', async () => {
      const key = 'ntf:order.approved:order-999:wa';
      await service.queueWhatsApp('+923001234567', 'msg1', key);
      await service.queueWhatsApp('+923001234567', 'msg2', key);

      // Both calls pass the same jobId — BullMQ drops the second at queue level
      const calls = mockQueue.add.mock.calls;
      expect(calls[0][2]).toEqual({ jobId: key });
      expect(calls[1][2]).toEqual({ jobId: key });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // queueSMS
  // ──────────────────────────────────────────────────────────────────────────

  describe('queueSMS', () => {
    it('queues an SMS job with idempotency key as jobId', async () => {
      const key = 'ntf:payment.approved:req-1:sms';
      await service.queueSMS('+923001234567', 'Payment confirmed', key);

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_SMS,
        { phoneNumber: '+923001234567', message: 'Payment confirmed' },
        { jobId: key },
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // queueFcm
  // ──────────────────────────────────────────────────────────────────────────

  describe('queueFcm', () => {
    it('queues an FCM job without jobId when no idempotency key given', async () => {
      await service.queueFcm('user-1', 'Title', 'Body');

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_FCM_NOTIFICATION,
        { userId: 'user-1', title: 'Title', body: 'Body', data: undefined },
        undefined,
      );
    });

    it('queues an FCM job with jobId and data when all params provided', async () => {
      const key = 'ntf:order.approved:order-123:fcm';
      await service.queueFcm(
        'user-1',
        'Order Approved',
        'Your order has been approved.',
        { type: 'ORDER_APPROVED', orderId: 'order-123' },
        key,
      );

      expect(mockQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.SEND_FCM_NOTIFICATION,
        {
          userId: 'user-1',
          title: 'Order Approved',
          body: 'Your order has been approved.',
          data: { type: 'ORDER_APPROVED', orderId: 'order-123' },
        },
        { jobId: key },
      );
    });

    it('uses distinct jobIds for WhatsApp and FCM channels of the same event', async () => {
      const orderId = 'order-456';
      await service.queueWhatsApp(
        '+923001234567',
        'msg',
        `ntf:order.approved:${orderId}:wa`,
      );
      await service.queueFcm(
        'user-1',
        'Title',
        'Body',
        undefined,
        `ntf:order.approved:${orderId}:fcm`,
      );

      const [waCall, fcmCall] = mockQueue.add.mock.calls;
      expect(waCall[2].jobId).toBe(`ntf:order.approved:${orderId}:wa`);
      expect(fcmCall[2].jobId).toBe(`ntf:order.approved:${orderId}:fcm`);
      // Keys must differ so one channel doesn't block the other
      expect(waCall[2].jobId).not.toBe(fcmCall[2].jobId);
    });
  });
});
