
import * as mgmtApi from '@agility/management-sdk';
import { ContentItemMapper } from 'lib/mappers/content-item-mapper';
import { hasUnresolvedContentReferences } from './has-unresolved-content-references';

export function areContentDependenciesResolved(
	contentItem: mgmtApi.ContentItem,
	referenceMapper: ContentItemMapper,
	models: mgmtApi.Model[]
): boolean {
	if (!contentItem.fields) {
		return true; // No fields, no dependencies
	}

	// Find the model for this content item
	const model = models.find(m => m.referenceName === contentItem.properties?.definitionName);
	if (!model) {
		return true; // No model, assume resolved
	}

	// Check each field for content references
	return !hasUnresolvedContentReferences(contentItem.fields, referenceMapper);
}