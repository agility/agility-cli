import { state } from "../../../../core";
import { ContentItemMapping } from "lib/mappers/content-item-mapper";
import * as mgmtApi from '@agility/management-sdk';

/**
 * Simple change detection for content items
 */
export interface ChangeDetection {
	entity: any;
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
): ChangeDetection {

	if (!mapping && !targetEntity) {
		//if we have no target content and no mapping
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
	const sourceVersion = sourceEntity.properties?.versionID;
	const targetVersion = targetEntity.properties?.versionID;

	const mappedSourceVersion = (mapping?.sourceVersionID || 0) as number;
	const mappedTargetVersion = (mapping?.targetVersionID || 0) as number;

	if (sourceVersion && targetVersion)
		//both the source and the target exist


		if (sourceVersion > mappedSourceVersion && targetVersion > mappedTargetVersion) {
			//CONFLICT DETECTION
			// Source version is newer than mapped source version
			// and target version is newer than mapped target version

			//build the url to the source and target entity
			//TODO: if there are multiple guids we need to handle that
			const sourceUrl = `https://app.agilitycms.com/${state.sourceGuid[0]}/${state.locale}/content/listitem-${sourceEntity.contentID}`;
			const targetUrl = `https://app.agilitycms.com/${state.targetGuid[0]}/${state.locale}/content/listitem-${targetEntity.contentID}`;

			return {
				entity: targetEntity,
				shouldUpdate: false,
				shouldCreate: false,
				shouldSkip: false,
				isConflict: true,
				reason: `Both source and target versions have been updated. Please resolve manually - source:${sourceUrl} <-> target:${targetUrl}.`
			};

		}

	if (sourceVersion > mappedSourceVersion && targetVersion <= mappedTargetVersion) {
		//SOURCE UPDATE ONLY
		// Source version is newer the mapped source version
		// and target version is NOT newer than mapped target version
		return {
			entity: targetEntity,
			shouldUpdate: true,
			shouldCreate: false,
			shouldSkip: false,
			isConflict: false,
			reason: 'Source version is newer.'
		};
	}


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