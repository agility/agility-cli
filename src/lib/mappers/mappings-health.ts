import * as path from 'path';
import * as fs from 'fs';
import colors from 'ansi-colors';
import * as mgmtApi from '@agility/management-sdk';
import { state, getApiClient } from '../../core/state';
import { fileOperations } from '../../core';
import { ContainerMapper } from './container-mapper';

export interface MappingHealthIssue {
    type: 'containers_not_mapped' | 'duplicate_container_mapping' | 'missing_container_mapping';
    locale: string;
    sourceContentID: number;
    targetContentID: number;
    sourceReferenceName: string;
    targetReferenceName: string;
    message: string;
    sourceItem?: any;
    targetItem?: any;
}

export interface MappingsHealthResult {
    sourceGuid: string;
    targetGuid: string;
    localesChecked: string[];
    totalItemMappingsChecked: number;
    skippedNotOnDisk: number;
    issues: MappingHealthIssue[];
    isHealthy: boolean;
}

export class MappingsHealth {
    private sourceGuid: string;
    private targetGuid: string;
    private apiFetchCount = 0;

    constructor(sourceGuid: string, targetGuid: string) {
        this.sourceGuid = sourceGuid;
        this.targetGuid = targetGuid;
    }

    async analyze(): Promise<MappingsHealthResult> {
        const result: MappingsHealthResult = {
            sourceGuid: this.sourceGuid,
            targetGuid: this.targetGuid,
            localesChecked: [],
            totalItemMappingsChecked: 0,
            skippedNotOnDisk: 0,
            issues: [],
            isHealthy: true
        };

        const locales = this.findMappingLocales();

        if (locales.length === 0) {
            const mappingsDir = path.join(state.rootPath, 'mappings', `${this.sourceGuid}-${this.targetGuid}`);
            console.log(colors.yellow(`\n⚠️  No locale mapping directories found for ${this.sourceGuid} → ${this.targetGuid}`));
            console.log(colors.yellow(`   Expected path: ${mappingsDir}`));
            return result;
        }

        const containerMapper = new ContainerMapper(this.sourceGuid, this.targetGuid);

        // Load raw container mappings to check for duplicates
        const containerFileOps = new fileOperations(this.targetGuid);
        const rawContainerMappings = containerFileOps.getMappingFile('containers', this.sourceGuid, this.targetGuid);

        for (const locale of locales) {
            result.localesChecked.push(locale);

            const localeFileOps = new fileOperations(this.targetGuid, locale);
            const itemMappings = localeFileOps.getMappingFile('item', this.sourceGuid, this.targetGuid, locale);

            this.apiFetchCount = 0;
            console.log(colors.cyan(`\n📋 Checking ${itemMappings.length} item mapping(s) for locale: ${locale}`));

            for (let i = 0; i < itemMappings.length; i++) {
                const mapping = itemMappings[i];
                result.totalItemMappingsChecked++;

                process.stdout.write(
                    colors.gray(`  [${i + 1}/${itemMappings.length}] checking ${mapping.sourceContentID} → ${mapping.targetContentID} ...                \r`)
                );

                const sourceItem = await this.getContentItem(mapping.sourceContentID, this.sourceGuid, locale);
                const targetItem = await this.getContentItem(mapping.targetContentID, this.targetGuid, locale);

                if (!sourceItem || !targetItem) {
                    result.skippedNotOnDisk++;
                    continue;
                }

                const sourceRefName: string = sourceItem.properties?.referenceName;
                const targetRefName: string = targetItem.properties?.referenceName;

                if (!sourceRefName || !targetRefName) {
                    console.log(colors.yellow(`  ⚠️  Missing referenceName for mapping ${mapping.sourceContentID} → ${mapping.targetContentID}`));
                    continue;
                }

                const sourceRefNameLower = sourceRefName.toLowerCase();
                const targetRefNameLower = targetRefName.toLowerCase();

                // Check for duplicate container mappings
                const sourceContainerCount = rawContainerMappings.filter(
                    (m: any) => m.sourceReferenceName?.toLowerCase() === sourceRefNameLower
                ).length;

                const targetContainerCount = rawContainerMappings.filter(
                    (m: any) => m.targetReferenceName?.toLowerCase() === targetRefNameLower
                ).length;

                if (sourceContainerCount > 1 || targetContainerCount > 1) {
                    const issue: MappingHealthIssue = {
                        type: 'duplicate_container_mapping',
                        locale,
                        sourceContentID: mapping.sourceContentID,
                        targetContentID: mapping.targetContentID,
                        sourceReferenceName: sourceRefName,
                        targetReferenceName: targetRefName,
                        message: `Duplicate container mappings detected. Source "${sourceRefName}" has ${sourceContainerCount} mapping(s), target "${targetRefName}" has ${targetContainerCount} mapping(s).`,
                        sourceItem,
                        targetItem
                    };
                    result.issues.push(issue);
                    result.isHealthy = false;
                    this.logBrokenMapping(issue);
                    continue;
                }

                // Check if containers are mapped to each other
                const sourceMappingEntry = containerMapper.getContainerMappingByReferenceName(sourceRefName, 'source');
                const targetMappingEntry = containerMapper.getContainerMappingByReferenceName(targetRefName, 'target');

                if (!sourceMappingEntry || !targetMappingEntry || sourceMappingEntry !== targetMappingEntry) {
                    const referenceNamesMatch = sourceRefNameLower === targetRefNameLower;
                    const issue: MappingHealthIssue = {
                        type: referenceNamesMatch ? 'missing_container_mapping' : 'containers_not_mapped',
                        locale,
                        sourceContentID: mapping.sourceContentID,
                        targetContentID: mapping.targetContentID,
                        sourceReferenceName: sourceRefName,
                        targetReferenceName: targetRefName,
                        message: referenceNamesMatch
                            ? `Item mapping looks correct (same container "${sourceRefName}"), but no container mapping entry exists for this referenceName.`
                            : `Containers are not mapped to each other. Source container "${sourceRefName}" and target container "${targetRefName}" do not share a mapping entry.`,
                        sourceItem,
                        targetItem
                    };
                    result.issues.push(issue);
                    result.isHealthy = false;
                    this.logBrokenMapping(issue);
                }
            }

            // Clear the in-place progress line and print locale summary
            process.stdout.write('\r' + ' '.repeat(80) + '\r');
            const apiNote = this.apiFetchCount > 0 ? colors.gray(` (${this.apiFetchCount} fetched from API)`) : '';
            console.log(colors.green(`  ✓ ${locale} done`) + apiNote);
        }

        return result;
    }

    private logBrokenMapping(issue: MappingHealthIssue): void {
        // Clear the in-place progress line before printing multi-line output
        process.stdout.write('\r' + ' '.repeat(80) + '\r');

        const icon =
            issue.type === 'duplicate_container_mapping' ? '🔄' :
            issue.type === 'missing_container_mapping'   ? '⚠️ ' : '❌';
        const typeLabel =
            issue.type === 'duplicate_container_mapping' ? 'DUPLICATE CONTAINER MAPPING' :
            issue.type === 'missing_container_mapping'   ? 'MISSING CONTAINER MAPPING' : 'BROKEN MAPPING';

        console.log(colors.red(`\n  ${icon} [${issue.locale}] ${typeLabel}`));
        console.log(colors.red(`     Source Content ID : ${issue.sourceContentID}  (container: ${issue.sourceReferenceName})`));
        console.log(colors.red(`     Target Content ID : ${issue.targetContentID}  (container: ${issue.targetReferenceName})`));
        console.log(colors.red(`     Issue             : ${issue.message}`));
    }

    private async getContentItem(contentID: number, guid: string, locale: string): Promise<mgmtApi.ContentItem | null> {
        // Try disk first (fast path — published items)
        const fileOps = new fileOperations(guid, locale);
        const onDisk = fileOps.readJsonFile(`item/${contentID}.json`);
        if (onDisk) return onDisk as mgmtApi.ContentItem;

        // Fall back to Management API (covers draft/staging items)
        this.apiFetchCount++;
        process.stdout.write(colors.gray(`  [api #${this.apiFetchCount}] fetching ${contentID} from ${guid} ...                \r`));
        try {
            const apiClient = getApiClient();
            const item = await apiClient.contentMethods.getContentItem(contentID, guid, locale);
            return item ?? null;
        } catch {
            return null;
        }
    }

    private findMappingLocales(): string[] {
        const mappingsDir = path.join(state.rootPath, 'mappings', `${this.sourceGuid}-${this.targetGuid}`);

        if (!fs.existsSync(mappingsDir)) {
            return [];
        }

        return fs.readdirSync(mappingsDir).filter(item => /^[a-z]{2}-[a-z]{2}$/i.test(item));
    }
}
