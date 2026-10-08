import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { payrollApi, type SlipPreviewItem, type SlipPreviewResponse } from '../api/payroll.api';
import { SendSlipsDialog } from './send-slips-dialog';

jest.mock('../api/payroll.api', () => ({
  ...jest.requireActual('../api/payroll.api'),
  payrollApi: { previewSlips: jest.fn(), sendSlips: jest.fn(), getSlipDispatch: jest.fn() },
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));

const previewApi = payrollApi.previewSlips as jest.Mock;
const sendApi = payrollApi.sendSlips as jest.Mock;

const item = (id: string, over: Partial<SlipPreviewItem> = {}): SlipPreviewItem => ({
  entryId: id,
  userId: `u-${id}`,
  name: `Emp ${id}`,
  role: 'LOADER',
  status: 'APPROVED',
  finalPayable: 25000,
  verdict: 'ELIGIBLE',
  reason: null,
  alreadySent: null,
  ...over,
});

const preview = (items: SlipPreviewItem[]): SlipPreviewResponse => ({
  periodId: 'p1',
  periodLabel: '2026-09',
  items,
  counts: {
    total: items.length,
    eligible: items.filter((i) => i.verdict === 'ELIGIBLE').length,
    notFinal: items.filter((i) => i.verdict === 'NOT_FINAL').length,
    noPhone: items.filter((i) => i.verdict === 'NO_PHONE').length,
    alreadySent: items.filter((i) => i.verdict === 'ELIGIBLE' && i.alreadySent).length,
  },
});

function setup(items: SlipPreviewItem[], entryIds: string[] | null = null) {
  previewApi.mockResolvedValue({ data: preview(items) });
  sendApi.mockResolvedValue({
    data: { dispatchId: 'd1', status: 'QUEUED', queued: items.length, skippedNoPhone: [], skippedNotFinal: [], skippedAlreadySent: [] },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onOpenChange = jest.fn();
  render(
    <QueryClientProvider client={client}>
      <SendSlipsDialog open onOpenChange={onOpenChange} periodId="p1" periodLabel="2026-09" entryIds={entryIds} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

const sendButton = () => screen.findByRole('button', { name: /^send \d+ slips?$/i });

beforeEach(() => {
  previewApi.mockReset();
  sendApi.mockReset();
});

describe('SendSlipsDialog', () => {
  it('shows the preview first and sends nothing until confirmed', async () => {
    setup([item('a'), item('b')]);
    expect(await sendButton()).toBeTruthy();
    expect(sendApi).not.toHaveBeenCalled();
    expect(previewApi).toHaveBeenCalledWith('p1', undefined);
  });

  it('"send to all" pins the previewed ids (an entry approved after the preview is not messaged)', async () => {
    setup([item('a'), item('b')]);
    fireEvent.click(await sendButton());
    await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['a', 'b'] }));
  });

  it('send specific: previews and sends only the chosen entry ids', async () => {
    setup([item('a')], ['a']);
    expect(previewApi).toHaveBeenCalledWith('p1', ['a']);
    fireEvent.click(await sendButton());
    await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['a'] }));
  });

  it('lists DRAFT / no-phone employees as skipped with the reason, and counts only eligible ones as sendable', async () => {
    setup([
      item('a'),
      item('d', { status: 'DRAFT', verdict: 'NOT_FINAL', reason: 'Final payable is not set yet — approve this entry first.' }),
      item('n', { verdict: 'NO_PHONE', reason: 'Employee has no valid WhatsApp number.' }),
    ]);
    expect(await screen.findByRole('button', { name: /^send 1 slip$/i })).toBeTruthy();
    expect(screen.getByText(/final payable not set \(approve first\)/i)).toBeTruthy();
    expect(screen.getByText(/Emp d/)).toBeTruthy();
    expect(screen.getByText(/no valid phone number/i)).toBeTruthy();
    expect(screen.getByText(/Emp n/)).toBeTruthy();
  });

  describe('already-sent protection', () => {
    const sentBefore = { sentAt: '2026-10-01T10:00:00Z', finalPayable: 25000, amountChanged: false };

    it('defaults to SKIPPING already-sent entries (skipAlreadySent) and sends only the rest', async () => {
      setup([item('a', { alreadySent: sentBefore }), item('b')]);
      expect(await screen.findByText(/1 slip was already sent/i)).toBeTruthy();
      fireEvent.click(await screen.findByRole('button', { name: /^send 1 slip$/i }));
      await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['b'], skipAlreadySent: true }));
    });

    it('choosing "send again" asks the server with confirmResend and counts them in', async () => {
      setup([item('a', { alreadySent: sentBefore }), item('b')]);
      fireEvent.click(await screen.findByLabelText(/send them again too/i));
      fireEvent.click(await screen.findByRole('button', { name: /^send 2 slips$/i }));
      await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['a', 'b'], confirmResend: true }));
    });

    it('calls out entries whose amount changed since they were sent', async () => {
      setup([item('a', { alreadySent: { ...sentBefore, amountChanged: true } })]);
      expect(await screen.findByText(/1 with a changed amount/i)).toBeTruthy();
    });
  });

  describe('warm-up guard', () => {
    it('more than 20 slips: shows the warning and a "send first 20 only" button that sends just 20 ids', async () => {
      const many = Array.from({ length: 25 }, (_, i) => item(`e${i}`));
      setup(many);
      expect(await screen.findByText(/large batch — start small/i)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /send first 20 only/i }));
      await waitFor(() => expect(sendApi).toHaveBeenCalledTimes(1));
      const payload = sendApi.mock.calls[0][1];
      expect(payload.entryIds).toHaveLength(20);
      expect(payload.entryIds[0]).toBe('e0');
    });

    it('20 or fewer: no warm-up warning', async () => {
      setup(Array.from({ length: 20 }, (_, i) => item(`e${i}`)));
      await sendButton();
      expect(screen.queryByText(/large batch — start small/i)).toBeNull();
    });
  });

  it('after queueing, reports what was queued and what was skipped (never claims it was delivered)', async () => {
    previewApi.mockResolvedValue({ data: preview([item('a')]) });
    sendApi.mockResolvedValue({
      data: {
        dispatchId: 'd1', status: 'QUEUED', queued: 1,
        skippedNoPhone: [{ entryId: 'n', name: 'Emp n' }], skippedNotFinal: [], skippedAlreadySent: [],
      },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SendSlipsDialog open onOpenChange={jest.fn()} periodId="p1" periodLabel="2026-09" entryIds={null} />
      </QueryClientProvider>,
    );
    fireEvent.click(await sendButton());
    expect(await screen.findByText(/1 slip queued — they are being sent one by one/i)).toBeTruthy();
    expect(screen.getByText(/No phone \(1\):/)).toBeTruthy();
    expect(screen.getByText(/Emp n/)).toBeTruthy();
    expect(screen.queryByText(/delivered/i)).toBeNull();
  });

  it('warns when someone has a NEGATIVE payable (the slip will show it)', async () => {
    setup([item('a', { finalPayable: -500 })]);
    expect(await screen.findByText(/NEGATIVE payable/)).toBeTruthy();
  });

  it('nothing sendable → the send button is disabled', async () => {
    setup([item('d', { status: 'DRAFT', verdict: 'NOT_FINAL', reason: 'x' })]);
    const btn = await screen.findByRole('button', { name: /record skipped/i });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText(/nothing to send/i)).toBeTruthy();
  });
});
