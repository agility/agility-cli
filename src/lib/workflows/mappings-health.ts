/**
 * Mappings Health Check
 *
 * Validates that all content item and container mappings are internally consistent:
 *   1. Both source and target files exist on disk for every mapped item.
 *   2. The `definitionName` (content model) is the same on both sides.
 *   3. The `referenceName` (container reference) on each content item is cross-referenced
 *      by the container mappings — i.e. source and target containers are actually mapped
 *      to each other.
 *
 * Container-level checks:
 *   4. Both source and target container files exist on disk.
 *   5. The `referenceName` in the container file matches what is recorded in the mapping.
 */

import ansiColors from 'ansi-colors';
import { fileOperations } from '../../core/fileOperations';
import { listAvailableMappingPairs } from '../mappers/mapping-reader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentItemMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceContentID: number;
    targetContentID: number;
    sourceVersionID: number;
    targetVersionID: number;
}

interface ContainerMapping {
    sourceGuid: string;
    targetGuid: string;
    sourceContentViewID: number;
    targetContentViewID: number;
    sourceReferenceName?: string;
    targetReferenceName?: string;
    sourceLastModifiedDate: string;
    targetLastModifiedDate: string;
}

export interface HealthIssue {
    type: 'missing_source' | 'missing_target' | 'definition_mismatch' | 'container_not_mapped' |
          'missing_source_container' | 'missing_target_container' | 'container_ref_mismatch';
    message: string;
    sourceGuid: string;
    targetGuid: string;
    locale?: string;
    sourceID?: number;
    targetID?: number;
}

export interface HealthCheckResult {
    sourceGuid: string;
    targetGuid: string;
    localesChecked: string[];
    contentItemsChecked: number;
    containersChecked: number;
    issues: HealthIssue[];
}

// ---------------------------------------------------------------------------
// Core check functions
// ---------------------------------------------------------------------------

function checkContentItems(
    sourceGuid: string,
    targetGuid: string,
    locale: string,
    containerMappings: ContainerMapping[],
): { checked: number; issues: HealthIssue[] } {
    const issues: HealthIssue[] = [];

    const fileOps = new fileOperations(targetGuid, locale);
    const contentMappings: ContentItemMapping[] = fileOps.getMappingFile('item', sourceGuid, targetGuid, locale);

    if (!contentMappings || contentMappings.length === 0) {
        return { checked: 0, issues };
    }

    const sourceFileOps = new fileOperations(sourceGuid, locale);
    const targetFileOps = new fileOperations(targetGuid, locale);

    for (const mapping of contentMappings) {
        const sourceItem = sourceFileOps.readJsonFile(`item/${mapping.sourceContentID}.json`);
        const targetItem = targetFileOps.readJsonFile(`item/${mapping.targetContentID}.json`);

        if (!sourceItem) {
            issues.push({
                type: 'missing_source',
                message: `Source content item file not found on disk (contentID: ${mapping.sourceContentID})`,
                sourceGuid,
                targetGuid,
                locale,
                sourceID: mapping.sourceContentID,
                targetID: mapping.targetContentID,
            });
            continue;
        }

        if (!targetItem) {
            issues.push({
                type: 'missing_target',
                message: `Target content item file not found on disk (contentID: ${mapping.targetContentID})`,
                sourceGuid,
                targetGuid,
                locale,
                sourceID: mapping.sourceContentID,
                targetID: mapping.targetContentID,
            });
            continue;
        }

        const sourceDef: string = sourceItem.properties?.definitionName;
        const targetDef: string = targetItem.properties?.definitionName;

        if (sourceDef !== targetDef) {
            issues.push({
                type: 'definition_mismatch',
                message: `definitionName mismatch — source: "${sourceDef}", target: "${targetDef}" ` +
                         `(source contentID: ${mapping.sourceContentID}, target contentID: ${mapping.targetContentID})`,
                sourceGuid,
                targetGuid,
                locale,
                sourceID: mapping.sourceContentID,
                targetID: mapping.targetContentID,
            });
        }

        // Check that the container reference names are mapped to each other
        const sourceRef: string = sourceItem.properties?.referenceName;
        const targetRef: string = targetItem.properties?.referenceName;

        if (sourceRef && targetRef) {
            const containerMapping = containerMappings.find(
                (cm) =>
                    cm.sourceReferenceName?.toLowerCase() === sourceRef.toLowerCase() &&
                    cm.targetReferenceName?.toLowerCase() === targetRef.toLowerCase(),
            );

            if (!containerMapping) {
                issues.push({
                    type: 'container_not_mapped',
                    message: `Container reference names are not mapped to each other — ` +
                             `source referenceName: "${sourceRef}", target referenceName: "${targetRef}" ` +
                             `(source contentID: ${mapping.sourceContentID}, target contentID: ${mapping.targetContentID})`,
                    sourceGuid,
                    targetGuid,
                    locale,
                    sourceID: mapping.sourceContentID,
                    targetID: mapping.targetContentID,
                });
            }
        }
    }

    return { checked: contentMappings.length, issues };
}

function checkContainers(
    sourceGuid: string,
    targetGuid: string,
    containerMappings: ContainerMapping[],
): { checked: number; issues: HealthIssue[] } {
    const issues: HealthIssue[] = [];

    if (!containerMappings || containerMappings.length === 0) {
        return { checked: 0, issues };
    }

    const sourceFileOps = new fileOperations(sourceGuid);
    const targetFileOps = new fileOperations(targetGuid);

    for (const mapping of containerMappings) {
        const sourceContainer = sourceFileOps.readJsonFile(`containers/${mapping.sourceContentViewID}.json`);
        const targetContainer = targetFileOps.readJsonFile(`containers/${mapping.targetContentViewID}.json`);

        if (!sourceContainer) {
            issues.push({
                type: 'missing_source_container',
                message: `Source container file not found on disk (contentViewID: ${mapping.sourceContentViewID}, referenceName: "${mapping.sourceReferenceName}")`,
                sourceGuid,
                targetGuid,
                sourceID: mapping.sourceContentViewID,
                targetID: mapping.targetContentViewID,
            });
            continue;
        }

        if (!targetContainer) {
            issues.push({
                type: 'missing_target_container',
                message: `Target container file not found on disk (contentViewID: ${mapping.targetContentViewID}, referenceName: "${mapping.targetReferenceName}")`,
                sourceGuid,
                targetGuid,
                sourceID: mapping.sourceContentViewID,
                targetID: mapping.targetContentViewID,
            });
            continue;
        }

        // Check that the referenceName on disk matches what is in the mapping
        const diskSourceRef: string = sourceContainer.referenceName;
        const diskTargetRef: string = targetContainer.referenceName;

        if (
            mapping.sourceReferenceName &&
            diskSourceRef?.toLowerCase() !== mapping.sourceReferenceName.toLowerCase()
        ) {
            issues.push({
                type: 'container_ref_mismatch',
                message: `Source container referenceName on disk ("${diskSourceRef}") does not match mapping ("${mapping.sourceReferenceName}") ` +
                         `(contentViewID: ${mapping.sourceContentViewID})`,
                sourceGuid,
                targetGuid,
                sourceID: mapping.sourceContentViewID,
                targetID: mapping.targetContentViewID,
            });
        }

        if (
            mapping.targetReferenceName &&
            diskTargetRef?.toLowerCase() !== mapping.targetReferenceName.toLowerCase()
        ) {
            issues.push({
                type: 'container_ref_mismatch',
                message: `Target container referenceName on disk ("${diskTargetRef}") does not match mapping ("${mapping.targetReferenceName}") ` +
                         `(contentViewID: ${mapping.targetContentViewID})`,
                sourceGuid,
                targetGuid,
                sourceID: mapping.sourceContentViewID,
                targetID: mapping.targetContentViewID,
            });
        }
    }

    return { checked: containerMappings.length, issues };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function runMappingsHealth(
    sourceGuidOverride?: string,
    targetGuidOverride?: string,
    localesOverride?: string[],
): HealthCheckResult[] {
    // Discover mapping pairs (or use the ones provided)
    let pairs: Array<{ sourceGuid: string; targetGuid: string; locales: string[] }>;

    if (sourceGuidOverride && targetGuidOverride) {
        // Build the locales list: either from the override or by scanning the mappings folder
        let locales = localesOverride ?? [];
        if (locales.length === 0) {
            const allPairs = listAvailableMappingPairs();
            const found = allPairs.find(
                (p) => p.sourceGuid === sourceGuidOverride && p.targetGuid === targetGuidOverride,
            );
            locales = found?.locales ?? [];
        }
        pairs = [{ sourceGuid: sourceGuidOverride, targetGuid: targetGuidOverride, locales }];
    } else {
        pairs = listAvailableMappingPairs();
        if (localesOverride && localesOverride.length > 0) {
            pairs = pairs.map((p) => ({ ...p, locales: localesOverride }));
        }
    }

    if (pairs.length === 0) {
        console.log(ansiColors.yellow('\nNo mapping pairs found. Run a sync first to create mappings.'));
        return [];
    }

    const results: HealthCheckResult[] = [];

    for (const pair of pairs) {
        const { sourceGuid, targetGuid, locales } = pair;

        console.log(ansiColors.cyan(`\n${'═'.repeat(60)}`));
        console.log(ansiColors.cyan(`Checking: ${sourceGuid} → ${targetGuid}`));
        console.log(ansiColors.cyan('═'.repeat(60)));

        const result: HealthCheckResult = {
            sourceGuid,
            targetGuid,
            localesChecked: locales,
            contentItemsChecked: 0,
            containersChecked: 0,
            issues: [],
        };

        // Load container mappings once (they are locale-independent)
        const containerFileOps = new fileOperations(targetGuid);
        const containerMappings: ContainerMapping[] = containerFileOps.getMappingFile('containers', sourceGuid, targetGuid);

        // --- Container checks ---
        const containerCheck = checkContainers(sourceGuid, targetGuid, containerMappings);
        result.containersChecked = containerCheck.checked;
        result.issues.push(...containerCheck.issues);

        console.log(ansiColors.white(`  Containers checked: ${containerCheck.checked}`));
        if (containerCheck.issues.length === 0) {
            console.log(ansiColors.green('  ✓ All container mappings are healthy'));
        } else {
            console.log(ansiColors.red(`  ✗ ${containerCheck.issues.length} container issue(s) found`));
        }

        // --- Content item checks (per locale) ---
        for (const locale of locales) {
            console.log(ansiColors.white(`\n  Locale: ${locale}`));

            const contentCheck = checkContentItems(sourceGuid, targetGuid, locale, containerMappings);
            result.contentItemsChecked += contentCheck.checked;
            result.issues.push(...contentCheck.issues);

            console.log(ansiColors.white(`    Content items checked: ${contentCheck.checked}`));
            if (contentCheck.issues.length === 0) {
                console.log(ansiColors.green('    ✓ All content item mappings are healthy'));
            } else {
                console.log(ansiColors.red(`    ✗ ${contentCheck.issues.length} content item issue(s) found`));
            }
        }

        results.push(result);
    }

    // --- Summary ---
    printSummary(results);

    return results;
}

function printSummary(results: HealthCheckResult[]): void {
    const totalIssues = results.reduce((sum, r) => sum + r.issues.length, 0);
    const totalContent = results.reduce((sum, r) => sum + r.contentItemsChecked, 0);
    const totalContainers = results.reduce((sum, r) => sum + r.containersChecked, 0);

    console.log(ansiColors.cyan(`\n${'═'.repeat(60)}`));
    console.log(ansiColors.cyan('MAPPINGS HEALTH SUMMARY'));
    console.log(ansiColors.cyan('═'.repeat(60)));
    console.log(ansiColors.white(`  Mapping pairs checked : ${results.length}`));
    console.log(ansiColors.white(`  Content items checked : ${totalContent}`));
    console.log(ansiColors.white(`  Containers checked    : ${totalContainers}`));

    if (totalIssues === 0) {
        console.log(ansiColors.green('\n  ✓ All mappings are healthy — no issues found.'));
    } else {
        console.log(ansiColors.red(`\n  ✗ ${totalIssues} total issue(s) found:\n`));

        for (const result of results) {
            if (result.issues.length === 0) continue;

            console.log(ansiColors.yellow(`  ${result.sourceGuid} → ${result.targetGuid}`));

            for (const issue of result.issues) {
                const localeTag = issue.locale ? ` [${issue.locale}]` : '';
                console.log(ansiColors.red(`    •${localeTag} ${issue.message}`));
            }
        }
    }

    console.log(ansiColors.cyan('─'.repeat(60)));
}
