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
  documents: ['SLIP'],
  alreadySentKinds: over.alreadySent ? ['SLIP'] : [],
  alreadySent: null,
  ...over,
});

const countsOf = (items: SlipPreviewItem[]) => ({
  total: items.length,
  eligible: items.filter((i) => i.verdict === 'ELIGIBLE').length,
  notFinal: items.filter((i) => i.verdict === 'NOT_FINAL').length,
  noPhone: items.filter((i) => i.verdict === 'NO_PHONE').length,
  alreadySent: items.filter((i) => i.verdict === 'ELIGIBLE' && i.alreadySentKinds.length > 0).length,
});

const preview = (items: SlipPreviewItem[]): SlipPreviewResponse => ({
  periodId: 'p1',
  periodLabel: '2026-09',
  items,
  counts: countsOf(items),
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

/** Echoes the server: every item gets the documents the dialog asked for (its own override, else everyone's). */
function echoChoice(items: SlipPreviewItem[]) {
  previewApi.mockImplementation(async (_period: string, _ids: string[] | undefined, choice: any) => ({
    data: preview(
      items.map((i) => ({
        ...i,
        documents: choice?.perEntry?.find((o: any) => o.entryId === i.entryId)?.documents ?? choice?.documents ?? ['SLIP'],
      })),
    ),
  }));
}

const SLIP_ONLY = { documents: ['SLIP'], perEntry: [] };
const sendButton = () => screen.findByRole('button', { name: /^send \d+ messages?$/i });

beforeEach(() => {
  previewApi.mockReset();
  sendApi.mockReset();
});

describe('SendSlipsDialog', () => {
  it('shows the preview first and sends nothing until confirmed', async () => {
    setup([item('a'), item('b')]);
    expect(await sendButton()).toBeTruthy();
    expect(sendApi).not.toHaveBeenCalled();
    expect(previewApi).toHaveBeenCalledWith('p1', undefined, SLIP_ONLY);
  });

  it('"send to all" pins the previewed ids (an entry approved after the preview is not messaged)', async () => {
    setup([item('a'), item('b')]);
    fireEvent.click(await sendButton());
    await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['a', 'b'], ...SLIP_ONLY }));
  });

  it('send specific: previews and sends only the chosen entry ids', async () => {
    setup([item('a')], ['a']);
    expect(previewApi).toHaveBeenCalledWith('p1', ['a'], SLIP_ONLY);
    fireEvent.click(await sendButton());
    await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['a'], ...SLIP_ONLY }));
  });

  it('lists DRAFT / no-phone employees as skipped with the reason, and counts only eligible ones as sendable', async () => {
    setup([
      item('a'),
      item('d', { status: 'DRAFT', verdict: 'NOT_FINAL', reason: 'Final payable is not set yet — approve this entry first.' }),
      item('n', { verdict: 'NO_PHONE', reason: 'Employee has no valid WhatsApp number.' }),
    ]);
    expect(await screen.findByRole('button', { name: /^send 1 message$/i })).toBeTruthy();
    expect(screen.getByText(/final payable not set \(approve first\)/i)).toBeTruthy();
    expect(screen.getByText(/Emp d/)).toBeTruthy();
    expect(screen.getByText(/no valid phone number/i)).toBeTruthy();
    expect(screen.getByText(/Emp n/)).toBeTruthy();
  });

  describe('documents (slip / receipt)', () => {
    it('slip is ticked by default; ticking the receipt too doubles the messages and asks the server again', async () => {
      const items = [item('a'), item('b')];
      setup(items);
      echoChoice(items);
      expect(await screen.findByRole('button', { name: /^send 2 messages$/i })).toBeTruthy();
      fireEvent.click(screen.getByLabelText(/salary receipt/i));
      expect(await screen.findByRole('button', { name: /^send 4 messages$/i })).toBeTruthy();
      expect(previewApi).toHaveBeenLastCalledWith('p1', undefined, { documents: ['SLIP', 'RECEIPT'], perEntry: [] });
      fireEvent.click(screen.getByRole('button', { name: /^send 4 messages$/i }));
      await waitFor(() =>
        expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['a', 'b'], documents: ['SLIP', 'RECEIPT'], perEntry: [] }),
      );
    });

    it('the last ticked document cannot be unticked (at least one is always sent)', async () => {
      setup([item('a')]);
      await sendButton();
      const slip = screen.getByLabelText(/salary slip/i) as HTMLInputElement;
      fireEvent.click(slip);
      expect(slip.checked).toBe(true);
    });

    it('receipt only: unticking the slip after ticking the receipt', async () => {
      const items = [item('a')];
      setup(items);
      echoChoice(items);
      await sendButton();
      fireEvent.click(screen.getByLabelText(/salary receipt/i));
      fireEvent.click(screen.getByLabelText(/salary slip/i));
      await waitFor(() => expect(previewApi).toHaveBeenLastCalledWith('p1', undefined, { documents: ['RECEIPT'], perEntry: [] }));
    });

    it('per-employee choice: one employee gets only the receipt, the override is sent for that entry only', async () => {
      const items = [item('a'), item('b')];
      setup(items);
      echoChoice(items);
      await sendButton();
      fireEvent.click(screen.getByText(/choose per employee/i));
      // Emp b's row: switch the receipt on and the slip off
      const row = screen.getByText('Emp b').parentElement as HTMLElement;
      fireEvent.click(Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'Receipt') as HTMLElement);
      await waitFor(() =>
        expect(previewApi).toHaveBeenLastCalledWith('p1', undefined, {
          documents: ['SLIP'],
          perEntry: [{ entryId: 'b', documents: ['SLIP', 'RECEIPT'] }],
        }),
      );
      // wait for the re-fetched preview (a: slip, b: slip + receipt = 3 messages) before the next toggle
      await screen.findByRole('button', { name: /^send 3 messages$/i });
      const rowAfter = screen.getByText('Emp b').parentElement as HTMLElement;
      fireEvent.click(Array.from(rowAfter.querySelectorAll('button')).find((b) => b.textContent === 'Slip') as HTMLElement);
      fireEvent.click(await screen.findByRole('button', { name: /^send 2 messages$/i }));
      await waitFor(() =>
        expect(sendApi).toHaveBeenCalledWith('p1', {
          entryIds: ['a', 'b'],
          documents: ['SLIP'],
          perEntry: [{ entryId: 'b', documents: ['RECEIPT'] }],
        }),
      );
    });

    it('a document already sent does not block the other: only the missing one is counted', async () => {
      const both: SlipPreviewItem = item('a', {
        documents: ['SLIP', 'RECEIPT'],
        alreadySentKinds: ['SLIP'],
        alreadySent: { sentAt: '2026-10-01T10:00:00Z', finalPayable: 25000, amountChanged: false },
      });
      previewApi.mockResolvedValue({ data: preview([both]) });
      sendApi.mockResolvedValue({ data: { dispatchId: 'd1', status: 'QUEUED', queued: 1, skippedNoPhone: [], skippedNotFinal: [], skippedAlreadySent: [] } });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      render(
        <QueryClientProvider client={client}>
          <SendSlipsDialog open onOpenChange={jest.fn()} periodId="p1" periodLabel="2026-09" entryIds={null} />
        </QueryClientProvider>,
      );
      expect(await screen.findByRole('button', { name: /^send 1 message$/i })).toBeTruthy();
    });
  });

  describe('already-sent protection', () => {
    const sentBefore = { sentAt: '2026-10-01T10:00:00Z', finalPayable: 25000, amountChanged: false };

    it('defaults to SKIPPING already-sent entries (skipAlreadySent) and sends only the rest', async () => {
      setup([item('a', { alreadySent: sentBefore }), item('b')]);
      expect(await screen.findByText(/1 employee has already been sent a chosen document/i)).toBeTruthy();
      fireEvent.click(await screen.findByRole('button', { name: /^send 1 message$/i }));
      await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['b'], ...SLIP_ONLY, skipAlreadySent: true }));
    });

    it('choosing "send again" asks the server with confirmResend and counts them in', async () => {
      setup([item('a', { alreadySent: sentBefore }), item('b')]);
      fireEvent.click(await screen.findByLabelText(/send them again too/i));
      fireEvent.click(await screen.findByRole('button', { name: /^send 2 messages$/i }));
      await waitFor(() => expect(sendApi).toHaveBeenCalledWith('p1', { entryIds: ['a', 'b'], ...SLIP_ONLY, confirmResend: true }));
    });

    it('calls out entries whose amount changed since they were sent', async () => {
      setup([item('a', { alreadySent: { ...sentBefore, amountChanged: true } })]);
      expect(await screen.findByText(/1 with a changed amount/i)).toBeTruthy();
    });
  });

  describe('warm-up guard', () => {
    it('more than 20 messages: shows the warning and a "send first 20 only" button that sends just 20 ids', async () => {
      const many = Array.from({ length: 25 }, (_, i) => item(`e${i}`));
      setup(many);
      expect(await screen.findByText(/large batch — start small/i)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /send first 20 only/i }));
      await waitFor(() => expect(sendApi).toHaveBeenCalledTimes(1));
      const payload = sendApi.mock.calls[0][1];
      expect(payload.entryIds).toHaveLength(20);
      expect(payload.entryIds[0]).toBe('e0');
    });

    it('with two documents each, the first batch never splits an employee (10 employees = 20 messages)', async () => {
      const many = Array.from({ length: 12 }, (_, i) => item(`e${i}`));
      setup(many);
      echoChoice(many);
      await sendButton();
      fireEvent.click(screen.getByLabelText(/salary receipt/i));
      fireEvent.click(await screen.findByRole('button', { name: /send first 20 only/i }));
      await waitFor(() => expect(sendApi).toHaveBeenCalledTimes(1));
      expect(sendApi.mock.calls[0][1].entryIds).toHaveLength(10);
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
    expect(await screen.findByText(/1 message queued — they are being sent one by one/i)).toBeTruthy();
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
