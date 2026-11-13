import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../../../test/utils/render';
import { announcementsApi, type Announcement } from '../api/announcements.api';
import { isFuturePkt, isoToPktInput, pktInputToIso, previewTitle, readRatePct } from '../lib/announcements';
import { toAnnouncementInput, validateComposer, type ComposerValues } from '../lib/composer';
import { ComposerDialog } from './composer-dialog';
import { AnnouncementDetailClient } from './announcement-detail-client';

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('next/link', () => ({ __esModule: true, default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
jest.mock('../../vendor-picker/vendor-picker', () => ({
  useVendorSearch: () => ({ data: [{ id: 'v1', name: 'Aqua One' }, { id: 'v2', name: 'Blue Co' }], isLoading: false }),
}));
jest.mock('../api/announcements.api', () => ({
  ...jest.requireActual('../api/announcements.api'),
  announcementsApi: {
    list: jest.fn(), get: jest.fn(), stats: jest.fn(), create: jest.fn(), update: jest.fn(), send: jest.fn(), cancel: jest.fn(), remove: jest.fn(),
    activeVendorCount: jest.fn(),
  },
}));
const api = announcementsApi as unknown as Record<string, jest.Mock>;

const base: ComposerValues = { title: 'Maintenance', body: 'Tonight', severity: 'INFO', audience: 'ALL_VENDORS', vendors: [], scheduledFor: '' };
const ann = (o: Partial<Announcement> = {}): Announcement => ({
  id: 'a1', title: 'Maintenance', body: 'Tonight 2am', severity: 'IMPORTANT', audience: 'ALL_VENDORS', status: 'SENT', scheduledFor: null,
  sentAt: '2026-11-01T10:00:00Z', cancelledAt: null, recipientCount: 4, lastError: null, createdByName: 'Super', createdAt: '2026-11-01T09:00:00Z', ...o,
});

beforeEach(() => jest.clearAllMocks());

describe('composer lib', () => {
  it('requires title/body and enforces length limits', () => {
    expect(validateComposer({ ...base, title: '', body: '' }, 'draft')).toMatchObject({ title: expect.any(String), body: expect.any(String) });
    expect(validateComposer({ ...base, title: 'x'.repeat(121) }, 'draft').title).toMatch(/120/);
    expect(validateComposer({ ...base, body: 'x'.repeat(2001) }, 'draft').body).toMatch(/2000/);
    expect(validateComposer(base, 'draft')).toEqual({});
  });
  it('SELECTED_VENDORS needs at least one vendor', () => {
    expect(validateComposer({ ...base, audience: 'SELECTED_VENDORS' }, 'send').vendors).toBeTruthy();
    expect(validateComposer({ ...base, audience: 'SELECTED_VENDORS', vendors: [{ id: 'v1', name: 'A' }] }, 'send')).toEqual({});
  });
  it('scheduling needs a future PKT time', () => {
    const now = Date.parse('2026-11-12T00:00:00Z');
    expect(validateComposer(base, 'schedule', now).scheduledFor).toMatch(/Pick/);
    expect(validateComposer({ ...base, scheduledFor: '2026-11-11T10:00' }, 'schedule', now).scheduledFor).toMatch(/future/);
    expect(validateComposer({ ...base, scheduledFor: '2026-11-13T10:00' }, 'schedule', now)).toEqual({});
  });
  it('converts PKT <-> ISO', () => {
    expect(pktInputToIso('2026-11-13T10:00')).toBe('2026-11-13T05:00:00.000Z');
    expect(isoToPktInput('2026-11-13T05:00:00.000Z')).toBe('2026-11-13T10:00');
    expect(isFuturePkt('2026-11-13T10:00', Date.parse('2026-11-13T04:59:00Z'))).toBe(true);
  });
  it('payload: vendorIds only for SELECTED, schedule only for schedule intent, null on edit', () => {
    expect(toAnnouncementInput(base, 'draft', false)).toEqual({ title: 'Maintenance', body: 'Tonight', severity: 'INFO', audience: 'ALL_VENDORS', vendorIds: [] });
    expect(toAnnouncementInput({ ...base, audience: 'SELECTED_VENDORS', vendors: [{ id: 'v1', name: 'A' }] }, 'draft', false).vendorIds).toEqual(['v1']);
    expect(toAnnouncementInput({ ...base, scheduledFor: '2026-11-13T10:00' }, 'schedule', false).scheduledFor).toBe('2026-11-13T05:00:00.000Z');
    expect(toAnnouncementInput({ ...base, scheduledFor: '2026-11-13T10:00' }, 'draft', true).scheduledFor).toBeNull();
  });
  it('formats read rate and severity-prefixed titles', () => {
    expect(readRatePct(0.5)).toBe('50%');
    expect(readRatePct(0.3333)).toBe('33.3%');
    expect(previewTitle('CRITICAL', 'T')).toBe('[Critical] T');
    expect(previewTitle('INFO', 'T')).toBe('T');
  });
});

describe('ComposerDialog', () => {
  it('shows validation and does not call the API', async () => {
    renderWithQuery(<ComposerDialog open announcement={null} onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Title is required');
    expect(screen.getByText('Message is required')).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
  });

  it('saves a draft targeting selected vendors', async () => {
    api.create.mockResolvedValue(ann({ status: 'DRAFT' }));
    renderWithQuery(<ComposerDialog open announcement={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'World' } });
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'SELECTED_VENDORS' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText('Select at least one vendor');
    fireEvent.click(screen.getByLabelText('Target Blue Co'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toMatchObject({ title: 'Hello', audience: 'SELECTED_VENDORS', vendorIds: ['v2'] });
    expect(api.create.mock.calls[0][0].scheduledFor).toBeUndefined();
  });

  it('send-to-all asks for confirmation with the active vendor estimate before sending', async () => {
    api.activeVendorCount.mockResolvedValue(12);
    api.create.mockResolvedValue(ann({ id: 'n1', status: 'DRAFT' }));
    api.send.mockResolvedValue(ann({ status: 'SENDING' }));
    renderWithQuery(<ComposerDialog open announcement={null} onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Hello' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'World' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await screen.findByText('Send announcement now?');
    expect(await screen.findByText(/all 12 active vendors/)).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Send now' }).pop() as HTMLElement);
    await waitFor(() => expect(api.send).toHaveBeenCalledWith('n1'));
  });
});

describe('AnnouncementDetailClient', () => {
  it('shows delivered/read counts and read rate per vendor', async () => {
    api.get.mockResolvedValue(ann());
    api.stats.mockResolvedValue({
      status: 'SENT', recipientCount: 4, delivered: 4, read: 1, readRate: 0.25,
      byVendor: [{ vendorId: 'v1', name: 'Aqua One', delivered: 4, read: 1 }],
    });
    renderWithQuery(<AnnouncementDetailClient id="a1" />);
    await waitFor(() => expect(screen.getByTestId('stat-read-rate').textContent).toBe('25%'));
    expect(screen.getByTestId('stat-delivered').textContent).toBe('4');
    expect(screen.getByTestId('stat-read').textContent).toBe('1');
    expect(screen.getByText('Aqua One')).toBeTruthy();
  });

  it('does not request stats for a draft', async () => {
    api.get.mockResolvedValue(ann({ status: 'DRAFT', sentAt: null }));
    renderWithQuery(<AnnouncementDetailClient id="a1" />);
    await screen.findByText(/available once the announcement has been sent/);
    expect(api.stats).not.toHaveBeenCalled();
  });
});
