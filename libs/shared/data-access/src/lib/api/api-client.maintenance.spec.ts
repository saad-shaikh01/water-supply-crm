import { apiClient, MAINTENANCE_EVENT } from './api-client';

/** apiClient with the network replaced by a canned failure so the response interceptors run for real. */
function failWith(status: number, data: unknown) {
  apiClient.defaults.adapter = (config) =>
    Promise.reject(Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, config, response: { status, data, headers: {}, config } }));
}

describe('apiClient 503 MAINTENANCE_MODE handling', () => {
  const dispatched: CustomEvent[] = [];

  beforeEach(() => {
    dispatched.length = 0;
    (globalThis as { window?: unknown }).window = {
      dispatchEvent: (e: CustomEvent) => {
        dispatched.push(e);
        return true;
      },
      location: { href: '' },
    };
    // cookies-next reads document.cookie in the request interceptor
    (globalThis as { document?: unknown }).document = { cookie: '' };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
  });

  it('dispatches platform:maintenance with message and eta, and still rejects the request', async () => {
    failWith(503, { statusCode: 503, code: 'MAINTENANCE_MODE', message: 'Back at noon', eta: '2026-12-01T12:00:00.000Z' });
    await expect(apiClient.get('/customers')).rejects.toMatchObject({ response: { status: 503 } });
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe(MAINTENANCE_EVENT);
    expect(dispatched[0].detail).toEqual({ message: 'Back at noon', eta: '2026-12-01T12:00:00.000Z' });
  });

  it('ignores a 503 that is not MAINTENANCE_MODE', async () => {
    failWith(503, { statusCode: 503, message: 'upstream down' });
    await expect(apiClient.get('/customers')).rejects.toBeTruthy();
    expect(dispatched).toHaveLength(0);
  });

  it('does not treat other statuses as maintenance', async () => {
    failWith(500, { code: 'MAINTENANCE_MODE' });
    await expect(apiClient.get('/customers')).rejects.toBeTruthy();
    expect(dispatched).toHaveLength(0);
  });
});
