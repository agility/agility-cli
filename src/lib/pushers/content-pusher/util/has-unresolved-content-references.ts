import { ContentItemMapper } from "lib/mappers/content-item-mapper";

/**
 * Recursively check for unresolved content references
 */
export function hasUnresolvedContentReferences(obj: any, referenceMapper: ContentItemMapper): boolean {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}

	if (Array.isArray(obj)) {
		return obj.some(item => hasUnresolvedContentReferences(item, referenceMapper));
	}

	for (const [key, value] of Object.entries(obj)) {
		// Check for content reference patterns
		if ((key === 'contentid' || key === 'contentID') && typeof value === 'number') {
			const mappedId = referenceMapper.getContentItemMappingByContentID(value, 'source');
			if (!mappedId) {
				return true; // Unresolved content reference
			}
		}

		// Check for comma-separated content IDs in sortids fields
		if (key === 'sortids' && typeof value === 'string') {
			const contentIds = value.split(',').filter(id => id.trim());
			for (const contentIdStr of contentIds) {
				const contentId = parseInt(contentIdStr.trim());
				if (!isNaN(contentId)) {
					const mappedId = referenceMapper.getContentItemMappingByContentID(contentId, 'source');
					if (!mappedId) {
						return true; // Unresolved content reference
					}
				}
			}
		}

		// Recursive check for nested objects
		if (hasUnresolvedContentReferences(value, referenceMapper)) {
			return true;
		}
	}

	return false;
}