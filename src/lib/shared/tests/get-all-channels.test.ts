import { resetState } from 'core/state';
import { getAllChannels } from '../get-all-channels';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeApiClient(sitemaps: any[]) {
  return {
    pageMethods: {
      getSitemap: jest.fn().mockResolvedValue(sitemaps)
    }
  };
}

describe('getAllChannels', () => {
  it('returns a Channel for each sitemap entry', async () => {
    const sitemaps = [
      { name: 'Website', digitalChannelID: 1 },
      { name: 'Mobile', digitalChannelID: 2 },
    ];
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(sitemaps));

    const result = await getAllChannels('test-guid', 'en-us');

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ channel: 'Website', digitalChannelId: 1 });
    expect(result[1]).toEqual({ channel: 'Mobile', digitalChannelId: 2 });
  });

  it('returns an empty array when getSitemap returns no entries', async () => {
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient([]));

    const result = await getAllChannels('test-guid', 'en-us');

    expect(result).toEqual([]);
  });

  it('passes guid and locale to getSitemap', async () => {
    const getSitemap = jest.fn().mockResolvedValue([]);
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
      pageMethods: { getSitemap }
    });

    await getAllChannels('my-guid', 'fr-fr');

    expect(getSitemap).toHaveBeenCalledWith('my-guid', 'fr-fr');
  });

  it('maps digitalChannelID (capital D) to digitalChannelId', async () => {
    const sitemaps = [{ name: 'Channel A', digitalChannelID: 42 }];
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue(makeApiClient(sitemaps));

    const result = await getAllChannels('g', 'en-us');

    expect(result[0].digitalChannelId).toBe(42);
  });

  it('propagates rejection from getSitemap', async () => {
    jest.spyOn(require('core/state'), 'getApiClient').mockReturnValue({
      pageMethods: { getSitemap: jest.fn().mockRejectedValue(new Error('API error')) }
    });

    await expect(getAllChannels('g', 'en-us')).rejects.toThrow('API error');
  });
});
