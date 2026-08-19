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
