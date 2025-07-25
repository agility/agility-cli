import { getApiClient, state } from "core/state";
import { ContentItemMapper } from "lib/mappers/content-item-mapper";
import { PageMapper } from "lib/mappers/page-mapper";

interface Props {
	sourceGuid: string;
	targetGuid: string;
	sourceContentID: number;
	locale: string;
}
export const findContentInOtherLocale = async ({ sourceContentID, locale, sourceGuid, targetGuid }: Props) => {
	const { availableLocales } = state

	//loop the other locales and check the mapping to see if this page has been mapped in another locale.
	for (const otherLocale of availableLocales) {
		if (locale === otherLocale) continue; // Skip current locale

		const contentMapper = new ContentItemMapper(sourceGuid, targetGuid, otherLocale);

		try {
			const mapping = contentMapper.getContentItemMappingByContentID(sourceContentID, "source");
			if (mapping) {
				console.log(`Found content mapping in locale ${otherLocale}:`, mapping);
				return mapping.targetContentID; // Return the target content ID if found
			}

		} catch (error) {
			console.error(`Error finding content in locale ${locale}:`, error);
		}
	}

	return -1; // Return -1 if no mapping found in other locales


}