import * as mgmtApi from '@agility/management-sdk';
import { getState } from 'core';
import { ContentItemMapper } from 'lib/mappers/content-item-mapper';
import { GuidEntities } from '../../guid-data-loader';
import { ChangeDetection, changeDetection } from './change-detection';

/**
 * Enhanced content item finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */
export function findContentInTargetInstance(
	sourceContent: mgmtApi.ContentItem,
	apiClient: mgmtApi.ApiClient,
	targetGuid: string,
	locale: string,
	targetData: GuidEntities,
	referenceMapper: ContentItemMapper
): {
	content: mgmtApi.ContentItem | null;
	shouldUpdate: boolean;
	shouldCreate: boolean;
	shouldSkip: boolean;
	isConflict: boolean;
	decision?: ChangeDetection
} {
	const state = getState();

	// STEP 1: Find existing mapping

	//GET FROM SOURCE MAPPING
	const mappedEntity = referenceMapper.getContentItemMappingByContentID(sourceContent.contentID, "source");

	let targetContent: mgmtApi.ContentItem | null = null;

	if (mappedEntity) {

		// STEP 2: Find target content item using mapping
		targetContent = targetData.content?.find((c: any) => {
			// Check if content ID matches mapped entity's target ID (entityB)
			if (c.contentID === mappedEntity.targetContentID) {
				return c;
			}
			return null;
		}) as mgmtApi.ContentItem | null;
	}

	// STEP 3: Use change detection for conflict resolution
	const decision = changeDetection(
		sourceContent,
		targetContent,
		mappedEntity
	);

	return {
		content: decision.entity || null,
		shouldUpdate: decision.shouldUpdate,
		shouldCreate: decision.shouldCreate,
		shouldSkip: decision.shouldSkip,
		isConflict: decision.isConflict,
		decision: decision
	};
}