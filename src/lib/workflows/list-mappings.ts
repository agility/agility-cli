/**
 * List Mappings
 * 
 * Display available mapping pairs for workflow operations.
 */

import ansiColors from 'ansi-colors';
import { listAvailableMappingPairs, getMappingSummary } from '../mappers/mapping-reader';

/**
 * List available mapping pairs for workflow operations
 */
export function listMappings(): void {
    console.log(ansiColors.cyan('\n' + '═'.repeat(50)));
    console.log(ansiColors.cyan('📋 AVAILABLE MAPPINGS'));
    console.log(ansiColors.cyan('═'.repeat(50)));

    const pairs = listAvailableMappingPairs();

    if (pairs.length === 0) {
        console.log(ansiColors.yellow('\nNo mappings found.'));
        console.log(ansiColors.gray('Run a sync operation first to create mappings.'));
        return;
    }

    for (const pair of pairs) {
        const summary = getMappingSummary(pair.sourceGuid, pair.targetGuid, pair.locales);
        
        console.log(ansiColors.white(`\n${pair.sourceGuid} → ${pair.targetGuid}`));
        console.log(ansiColors.gray(`Locales: ${pair.locales.join(', ')}`));
        console.log(ansiColors.gray(`Content items: ${summary.totalContent}`));
        console.log(ansiColors.gray(`Pages: ${summary.totalPages}`));
    }

    console.log(ansiColors.cyan('\n' + '─'.repeat(50)));
    console.log(ansiColors.gray('To run a workflow operation:'));
    console.log(ansiColors.white('  node dist/index.js workflows --sourceGuid <source> --targetGuid <target> --type publish'));
}
