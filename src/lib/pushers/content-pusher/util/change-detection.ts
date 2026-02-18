import { state } from "../../../../core";
import { ContentItemMapping } from "lib/mappers/content-item-mapper";
import * as mgmtApi from '@agility/management-sdk';

/**
 * Simple change detection for content items
 */
export interface ChangeDetection {
	entity: mgmtApi.ContentItem | null;
	shouldUpdate: boolean;
	shouldCreate: boolean;
	shouldSkip: boolean;
	isConflict: boolean;
	reason: string;
}

export function changeDetection(
	sourceEntity: mgmtApi.ContentItem,
	targetEntity: mgmtApi.ContentItem | null,
	mapping: ContentItemMapping,
	locale: string
): ChangeDetection {
	// Validate source entity structure
	if (!sourceEntity || !sourceEntity.properties) {
		// console.error(`[ChangeDetection] Invalid source entity structure:`, sourceEntity);
		return {
			entity: null,
			shouldUpdate: false,
			shouldCreate: false,
			shouldSkip: true,
			isConflict: false,
			reason: 'Invalid source entity structure'
		};
	}

	const itemName = sourceEntity.properties?.referenceName || `ID:${sourceEntity.contentID}`;

	if (!mapping && !targetEntity) {
		//if we have no target content and no mapping
		// if (state.verbose) {
		// 	console.log(`[ChangeDetection] ${itemName}: No mapping and no target entity → CREATE`);
		// }
		return {
			entity: null,
			shouldUpdate: false,
			shouldCreate: true,
			shouldSkip: false,
			isConflict: false,
			reason: 'Entity does not exist in target'
		};
	}

	// Check if update is needed based on version or modification date
	const sourceVersion = sourceEntity.properties?.versionID || 0;
	const targetVersion = targetEntity?.properties?.versionID || 0;

	const mappedSourceVersion = (mapping?.sourceVersionID || 0) as number;
	const mappedTargetVersion = (mapping?.targetVersionID || 0) as number;

	// Verbose logging for version comparison debugging
	// if (state.verbose) {
	// 	console.log(`[ChangeDetection] ${itemName}: sourceV=${sourceVersion} (mapped=${mappedSourceVersion}), targetV=${targetVersion} (mapped=${mappedTargetVersion})`);
	// }

	if (sourceVersion > 0 && targetVersion > 0) {
		//both the source and the target exist

		if (sourceVersion > mappedSourceVersion && targetVersion > mappedTargetVersion) {
			//CONFLICT DETECTION
			// Source version is newer than mapped source version
			// and target version is newer than mapped target version

			//build the url to the source and target entity
			//TODO: if there are multiple guids we need to handle that

			const sourceUrl = `https://app.agilitycms.com/instance/${state.sourceGuid[0]}/${locale}/content/listitem-${sourceEntity.contentID}`;
			const targetUrl = `https://app.agilitycms.com/instance/${state.targetGuid[0]}/${locale}/content/listitem-${targetEntity.contentID}`;

			// if (state.verbose) {
			// 	console.log(`[ChangeDetection] ${itemName}: CONFLICT - both versions changed`);
			// }

			return {
				entity: targetEntity,
				shouldUpdate: false,
				shouldCreate: false,
				shouldSkip: false,
				isConflict: true,
				reason: `Both source and target versions have been updated. Please resolve manually.\n   - source: ${sourceUrl} \n   - target: ${targetUrl}.`
			};
		}
	}

	if (sourceVersion > mappedSourceVersion && targetVersion <= mappedTargetVersion) {
		//SOURCE UPDATE ONLY
		// Source version is newer the mapped source version
		// and target version is NOT newer than mapped target version
		// if (state.verbose) {
		// 	console.log(`[ChangeDetection] ${itemName}: UPDATE - source version newer (${sourceVersion} > ${mappedSourceVersion})`);
		// }
		return {
			entity: targetEntity,
			shouldUpdate: true,
			shouldCreate: false,
			shouldSkip: false,
			isConflict: false,
			reason: 'Source version is newer.'
		};
	}

	const { overwrite } = state;
	if (overwrite) {
		// if (state.verbose) {
		// 	console.log(`[ChangeDetection] ${itemName}: UPDATE - overwrite mode enabled`);
		// }
		return {
			entity: targetEntity,
			shouldUpdate: true,
			shouldCreate: false,
			shouldSkip: false,
			isConflict: false,
			reason: 'Overwrite mode enabled'
		};
	}

	// if (state.verbose) {
	// 	console.log(`[ChangeDetection] ${itemName}: SKIP - up to date`);
	// }
	return {
		entity: targetEntity,
		shouldUpdate: false,
		shouldCreate: false,
		shouldSkip: true,
		isConflict: false,
		// No update needed, target is up to date
		reason: 'Entity exists and is up to date'
	};
}