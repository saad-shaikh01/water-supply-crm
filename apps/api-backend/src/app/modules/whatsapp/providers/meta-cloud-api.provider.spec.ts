import { MetaCloudApiProvider } from './meta-cloud-api.provider';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

describe('MetaCloudApiProvider', () => {
  const OLD_ENV = process.env;
  let provider: MetaCloudApiProvider;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    process.env = {
      ...OLD_ENV,
      WHATSAPP_ENABLED: 'true',
      META_WA_ACCESS_TOKEN: 'test-token',
      META_WA_PHONE_NUMBER_ID: '123456',
    };
    fetchMock = jest.fn();
    (global as any).fetch = fetchMock;
    provider = new MetaCloudApiProvider();
  });

  afterEach(() => {
    process.env = OLD_ENV;
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('reports not ready when credentials are missing', () => {
    process.env['META_WA_ACCESS_TOKEN'] = '';
    const p = new MetaCloudApiProvider();
    expect(p.isReady()).toBe(false);
  });

  it('reports ready when enabled and configured', () => {
    expect(provider.isReady()).toBe(true);
  });

  it('sends a text message with the correct Graph API request shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.1' }] }));

    const result = await provider.sendMessage('03001234567', 'Hello');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456/messages');
    expect(init.headers['Authorization']).toBe('Bearer test-token');
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      to: '923001234567',
      type: 'text',
      text: { body: 'Hello' },
    });
  });

  describe('per-vendor credentials', () => {
    const VENDOR = { accessToken: 'vendor-token', phoneNumberId: '999000' };

    it('a call with vendor credentials uses THEIR token and phone-number id — never the platform ones', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.v' }] }));
      expect(await provider.sendTemplate('923001234567', 'balance_reminder', ['A', '1'], undefined, undefined, VENDOR)).toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/v21.0/999000/messages');
      expect(init.headers['Authorization']).toBe('Bearer vendor-token');
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('test-token');
    });

    it('uploads media with the vendor credentials too (document templates)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: 'm1' })).mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'w' }] }));
      await provider.sendTemplate('923001234567', 'delivery_receipt', ['A'], { buffer: Buffer.from('x'), filename: 'r.pdf' }, undefined, VENDOR);
      for (const [url, init] of fetchMock.mock.calls) {
        expect(url).toContain('/999000/');
        expect(init.headers['Authorization']).toBe('Bearer vendor-token');
      }
    });

    it('readiness is judged per credentials, but the platform master switch still applies to everyone', () => {
      expect(provider.isReady(VENDOR)).toBe(true);
      expect(provider.isReady({ accessToken: '', phoneNumberId: '1' })).toBe(false);
      process.env['WHATSAPP_ENABLED'] = 'false';
      expect(new MetaCloudApiProvider().isReady(VENDOR)).toBe(false);
    });

    it('fetchPhoneNumberInfo returns the sender record, or the Graph error (code 190 = dead token)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { display_phone_number: '+92 300 1111111', verified_name: 'Lorem', quality_rating: 'GREEN' }));
      expect(await provider.fetchPhoneNumberInfo(VENDOR)).toEqual({ ok: true, displayNumber: '+92 300 1111111', verifiedName: 'Lorem', qualityRating: 'GREEN' });
      expect(fetchMock.mock.calls[0][0]).toContain('/999000?fields=display_phone_number,verified_name,quality_rating');

      fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: { code: 190, message: 'Error validating access token' } }));
      expect(await provider.fetchPhoneNumberInfo(VENDOR)).toEqual({ ok: false, status: 401, code: 190, message: 'Error validating access token' });

      fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
      expect(await provider.fetchPhoneNumberInfo(VENDOR)).toMatchObject({ ok: false, status: 0, message: 'ECONNRESET' });
    });

    it('listTemplates pages through Meta and maps review status / rejection reason', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, {
          data: [{ name: 'balance_reminder', language: 'en', category: 'UTILITY', status: 'APPROVED', rejected_reason: 'NONE' }],
          paging: { next: 'https://graph.facebook.com/v21.0/1000/message_templates?after=abc' },
        }))
        .mockResolvedValueOnce(jsonResponse(200, { data: [{ name: 'order_approved', language: 'en', category: 'UTILITY', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' }] }));
      const res = await provider.listTemplates(VENDOR, '1000');
      expect(res).toEqual({
        ok: true,
        templates: [
          { name: 'balance_reminder', language: 'en', category: 'UTILITY', status: 'APPROVED', rejectedReason: null },
          { name: 'order_approved', language: 'en', category: 'UTILITY', status: 'REJECTED', rejectedReason: 'INVALID_FORMAT' },
        ],
      });
      expect(fetchMock.mock.calls[0][0]).toContain('/1000/message_templates?fields=name,language,category,status,rejected_reason');
      expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer vendor-token');
    });

    it('listTemplates surfaces a Graph error instead of pretending there are no templates', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: { code: 100, message: 'Unsupported get request' } }));
      expect(await provider.listTemplates(VENDOR, '1000')).toEqual({ ok: false, status: 400, code: 100, message: 'Unsupported get request' });
    });
  });

  it('uploads media then sends a document message referencing the returned media id', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'media-123' }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.2' }] }));

    const result = await provider.sendDocument('923001234567', Buffer.from('pdf'), 'statement.pdf', 'Caption');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/123456/media');
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.document).toEqual({ id: 'media-123', filename: 'statement.pdf', caption: 'Caption' });
  });

  it('sends a template message with a document header and coerces empty params to "-"', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { id: 'media-456' }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.3' }] }));

    const result = await provider.sendTemplate(
      '923001234567',
      'monthly_statement',
      ['Ahmed', ''],
      { buffer: Buffer.from('pdf'), filename: 'statement.pdf' },
    );

    expect(result).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.template.name).toBe('monthly_statement');
    expect(body.template.language).toEqual({ code: 'en' });
    expect(body.template.components).toEqual([
      { type: 'header', parameters: [{ type: 'document', document: { id: 'media-456', filename: 'statement.pdf' } }] },
      { type: 'body', parameters: [{ type: 'text', text: 'Ahmed' }, { type: 'text', text: '-' }] },
    ]);
  });

  it('sends a template message with an image header by link, without uploading media', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.5' }] }));

    const result = await provider.sendTemplate(
      '923001234567',
      'delivery_unsuccessful_photo',
      ['Ahmed', 'L0042', 'You were not available at the time of delivery'],
      undefined,
      'https://storage.example.com/signed/photo.jpg',
    );

    expect(result).toBe(true);
    // Only one call — no /media upload round-trip for a link-based header.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.template.name).toBe('delivery_unsuccessful_photo');
    expect(body.template.components).toEqual([
      { type: 'header', parameters: [{ type: 'image', image: { link: 'https://storage.example.com/signed/photo.jpg' } }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Ahmed' },
          { type: 'text', text: 'L0042' },
          { type: 'text', text: 'You were not available at the time of delivery' },
        ],
      },
    ]);
  });

  it('returns false without retrying on a non-retriable 4xx error', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: 190, message: 'Invalid OAuth token', fbtrace_id: 'abc' } }),
    );

    const result = await provider.sendMessage('923001234567', 'Hello');

    expect(result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and succeeds on the second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: { code: 1, message: 'Server error' } }))
      .mockResolvedValueOnce(jsonResponse(200, { messages: [{ id: 'wamid.4' }] }));

    const promise = provider.sendMessage('923001234567', 'Hello');
    await jest.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns false on timeout and does not retry', async () => {
    fetchMock.mockImplementation((_url: string, init: any) => {
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as any).name = 'AbortError';
          reject(err);
        });
      });
    });

    const promise = provider.sendMessage('923001234567', 'Hello');
    await jest.advanceTimersByTimeAsync(15_000);
    const result = await promise;

    expect(result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
