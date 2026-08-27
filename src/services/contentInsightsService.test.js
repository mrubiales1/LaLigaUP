jest.mock('../utils/platform', () => ({ isNativePlatform: jest.fn(() => false) }));

describe('contentInsightsService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetModules();
  });

  test('reutiliza el contenido devuelto por el endpoint de refresco', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: { type: 'recommendations', sections: [] }, changed: true }),
    });
    const service = (await import('./contentInsightsService')).default;
    const result = await service.refresh('recommendations');
    expect(result.changed).toBe(true);
    expect(result.content.type).toBe('recommendations');
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/content-insights/recommendations/refresh'), expect.objectContaining({ method: 'POST' }));
  });
});
