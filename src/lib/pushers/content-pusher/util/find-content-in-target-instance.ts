import * as mgmtApi from '@agility/management-sdk';
import { getState } from 'core';
import { ContentItemMapper } from 'lib/mappers/content-item-mapper';
import { GuidEntities } from '../../guid-data-loader';
import { ChangeDetection, changeDetection } from './change-detection';

interface Props {
	sourceContent: mgmtApi.ContentItem,
	referenceMapper: ContentItemMapper
}

interface FindResult {
	content: mgmtApi.ContentItem | null;
	shouldUpdate: boolean;
	shouldCreate: boolean;
	shouldSkip: boolean;
	isConflict: boolean;
	decision?: ChangeDetection;
	reason?: string;
}

/**
 * Enhanced content item finder with proper target safety and conflict resolution
 * Logic Flow: Target Safety FIRST → Change Delta SECOND → Conflict Resolution
 */
export function findContentInTargetInstance({
	sourceContent,
	referenceMapper
}: Props): FindResult {
	const state = getState();
	const itemName = sourceContent.properties?.referenceName || `ID:${sourceContent.contentID}`;

	// STEP 1: Find existing mapping

	//GET FROM SOURCE MAPPING
	const mapping = referenceMapper.getContentItemMappingByContentID(sourceContent.contentID, "source");
	const locale = referenceMapper.locale;
	let targetContent: mgmtApi.ContentItem | null = null;

	if (mapping) {
		// STEP 2: Find target content item using mapping
		targetContent = referenceMapper.getMappedEntity(mapping, "target");
		
		// Diagnostic: mapping exists but target entity file is missing
		if (!targetContent && state.verbose) {
			// console.log(`[FindContent] ${itemName}: Mapping exists (target ID: ${mapping.targetContentID}) but target entity file not found`);
		}
	} else if (state.verbose) {
		// console.log(`[FindContent] ${itemName}: No mapping found for source content ID ${sourceContent.contentID}`);
	}

	// STEP 3: Use change detection for conflict resolution
	const decision = changeDetection(
		sourceContent,
		targetContent,
		mapping,
		locale
	);

	return {
		content: decision.entity || null,
		shouldUpdate: decision.shouldUpdate,
		shouldCreate: decision.shouldCreate,
		shouldSkip: decision.shouldSkip,
		isConflict: decision.isConflict,
		reason: decision.reason,
		decision: decision
	};
}