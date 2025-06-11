import ansiColors from 'ansi-colors';
import { ReferenceMapper } from '../reference-mapper';
import * as path from 'path';
import * as fs from 'fs/promises';

/**
 * Utility script to clean up ballooned mapping files
 * Usage: node dist/lib/cli/cleanup-mappings.js <sourceGUID> <targetGUID>
 */

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length !== 2) {
        console.error('Usage: node dist/lib/cli/cleanup-mappings.js <sourceGUID> <targetGUID>');
        process.exit(1);
    }
    
    const [sourceGUID, targetGUID] = args;
    
    console.log(ansiColors.yellow(`Starting mapping cleanup for ${sourceGUID} → ${targetGUID}`));
    
    // Check current file sizes
    const mappingsDir = path.join(process.cwd(), 'agility-files', targetGUID, 'mappings');
    
    try {
        const files = await fs.readdir(mappingsDir);
        console.log(ansiColors.cyan('\nCurrent mapping file sizes:'));
        
        for (const file of files) {
            if (file.endsWith('-mappings.json')) {
                const filePath = path.join(mappingsDir, file);
                const stats = await fs.stat(filePath);
                const sizeKB = Math.round(stats.size / 1024);
                console.log(`  ${file}: ${sizeKB} KB`);
            }
        }
    } catch (error) {
        console.error('Could not read mappings directory:', error);
        process.exit(1);
    }
    
    // Initialize mapper and clean up (use default agility-files path)
    const mapper = new ReferenceMapper(sourceGUID, targetGUID, 'agility-files');
    
    // Wait for initial load to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log(ansiColors.yellow(`\nLoaded ${mapper['records'].length} total mapping records`));
    
    // Clean and rebuild
    await mapper.clearAndRebuild();
    
    // Check new file sizes
    console.log(ansiColors.cyan('\nNew mapping file sizes:'));
    
    try {
        const files = await fs.readdir(mappingsDir);
        
        for (const file of files) {
            if (file.endsWith('-mappings.json')) {
                const filePath = path.join(mappingsDir, file);
                const stats = await fs.stat(filePath);
                const sizeKB = Math.round(stats.size / 1024);
                console.log(`  ${file}: ${sizeKB} KB`);
            }
        }
    } catch (error) {
        console.error('Could not read mappings directory after cleanup:', error);
    }
    
    console.log(ansiColors.green('\nMapping cleanup complete!'));
}

if (require.main === module) {
    main().catch(console.error);
}

export { main as cleanupMappings }; 