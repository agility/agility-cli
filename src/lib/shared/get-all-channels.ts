import { getApiClient } from "../../core/state";

export async function getAllChannels(  
  guid: string,
  locale: string
): Promise<{
	channel: string,
	digitalChannelId: number
}[]> {
	// TODO: we should create a new mgmt SDK method to do this so we don't have to loop
	const apiClient = getApiClient();

	const sitemaps = await apiClient.pageMethods.getSitemap(guid, locale);

	return sitemaps.map(sitemap => {
		return {
			channel: sitemap.name,
			digitalChannelId: sitemap.digitalChannelID		
		}
	});

}
