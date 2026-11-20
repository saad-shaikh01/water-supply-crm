import { deliveryBadge, explainError } from './explain-error';

describe('explainError', () => {
  it('returns null for a row without an error', () => {
    expect(explainError({ lastError: null, errorCode: null })).toBeNull();
  });

  it('explains a dropped PDF upload as a network problem (the Nov 19 failures), retry-safe', () => {
    const e = explainError({ lastError: 'PDF not delivered — Network error reaching WhatsApp (ECONNRESET): fetch failed [ECONNRESET]', errorCode: 'ECONNRESET', errorStage: 'upload', retryable: true });
    expect(e?.label).toBe('Network problem while uploading the PDF to WhatsApp');
    expect(e?.retrySafe).toBe(true);
    expect(e?.detail).toContain('code ECONNRESET');
    expect(e?.detail).toContain('stage upload');
  });

  it('warns that a timeout may already have been delivered', () => {
    expect(explainError({ lastError: 'x', errorCode: 'TIMEOUT', retryable: false })?.label).toMatch(/may or may not have been delivered/);
  });

  it('maps known Meta codes to plain language', () => {
    expect(explainError({ lastError: 'x', errorCode: '132001' })?.label).toMatch(/template not found/i);
    expect(explainError({ lastError: 'x', errorCode: '131026' })?.label).toMatch(/cannot receive/i);
    expect(explainError({ lastError: 'x', errorCode: '190' })?.label).toMatch(/token/i);
  });

  it('keeps the stored text for unknown codes and for older rows with no code', () => {
    expect(explainError({ lastError: 'Something odd', errorCode: '999999' })?.label).toBe('Something odd');
    const old = explainError({ lastError: 'PDF not delivered — WhatsApp not ready or number not registered' });
    expect(old?.label).toBe('PDF not delivered — WhatsApp not ready or number not registered');
    expect(old?.retrySafe).toBeNull();
  });
});

describe('deliveryBadge', () => {
  it('maps Meta delivery reports and shows nothing before one arrives', () => {
    expect(deliveryBadge('DELIVERED')).toEqual({ text: 'Delivered', tone: 'ok' });
    expect(deliveryBadge('READ')).toEqual({ text: 'Read', tone: 'read' });
    expect(deliveryBadge('FAILED')).toEqual({ text: 'Not delivered', tone: 'bad' });
    expect(deliveryBadge(null)).toBeNull();
  });
});
