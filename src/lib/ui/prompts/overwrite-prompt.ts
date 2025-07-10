import inquirer from 'inquirer';

/**
 * Prompts the user whether they want to overwrite existing files.
 * @param itemName - Optional name of the item type being overwritten (e.g., "content data", "gallery files").
 * @returns True if the user chooses to overwrite, false otherwise.
 */
export async function overwritePrompt(rootPath: string): Promise<boolean> {

    const fs = require('fs');
    const path = require('path');
    const syncTokenPath = path.join(process.cwd(), rootPath, '/state/sync.json');

    if (fs.existsSync(syncTokenPath)) {

        const answers = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'overwriteConfirmation',
                message: '\n⚠️  Do you want to overwrite your existing files?',
                default: false
            }
        ]);


        if (answers.overwriteConfirmation) {
            fs.rmSync(syncTokenPath, { force: true });
        }

        return answers.overwriteConfirmation;
    }

    // if the sync token does not exist, we can assume that the user wants to overwrite the files
    // because none will exist yet
    return true;
} 