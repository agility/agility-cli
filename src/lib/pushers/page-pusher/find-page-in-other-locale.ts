import { getApiClient, state } from "core/state";
import { PageMapper } from "lib/mappers/page-mapper";

interface Props {
	sourceGuid: string;
	targetGuid: string;
	sourcePageID: number;
	locale: string;
}

export interface OtherLocaleMapping {
	PageIDOtherLanguage: number;
	OtherLanguageCode: string;
}

export const findPageInOtherLocale = async ({ sourcePageID, locale, sourceGuid, targetGuid }: Props): Promise<OtherLocaleMapping | null> => {
	const { availableLocales } = state

	//loop the other locales and check the mapping to see if this page has been mapped in another locale.
	for (const otherLocale of availableLocales) {
		if (locale === otherLocale) continue; // Skip current locale

		const pageMapper = new PageMapper(sourceGuid, targetGuid, otherLocale);

		try {

			const mapping = pageMapper.getPageMappingByPageID(sourcePageID, "source");
			if (mapping) {
				// Return the target page ID and locale it was found in, if found
				return {
					PageIDOtherLanguage: mapping.targetPageID,
					OtherLanguageCode: otherLocale
				}
			}

		} catch (error) {
			console.error(`Error finding page in locale ${locale}:`, error);
		}
	}

	return null; // Return null if no mapping found in other locales


}