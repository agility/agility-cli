import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';
// import chalk from 'chalk';
// const chalk = await import('chalk');
// const inquirer = require("inquirer");
import inquirerSearchList from 'inquirer-search-list';
import ansiColors from 'ansi-colors';

inquirer.registerPrompt('search-list', inquirerSearchList);

export default async function fileSystemPrompt() {

    

    const selectedDir = await selectDirectory();
    if (selectedDir) {
        console.log(ansiColors.green(`Selected directory: ${selectedDir}`));
    } else {
        console.log(ansiColors.red('Directory selection canceled.'));
    }
    return selectedDir;
}

async function selectDirectory(startingPath = process.cwd()) {

    // inquirer.registerPrompt('search-list', import('inquirer-search-list'));
    let currentPath = startingPath;

    while (true) {
        console.clear();
        
        // Get directory contents
        const files = fs.readdirSync(currentPath);
        const directories = files.filter(file => 
            fs.statSync(path.join(currentPath, file)).isDirectory()
        );

        // Add navigation options
        const choices = [
            { name: ansiColors.green('✔ Confirm this directory'), value: 'confirm' },
            { name: ansiColors.blue('⬆️  Go up one level (..)'), value: 'up' },
            ...directories.map(dir => ({ name: `📁 ${dir}`, value: dir })),
            { name: ansiColors.red('❌ Cancel'), value: 'cancel' }
        ];

        const { selectedPath } = await inquirer.prompt([
            {
                type: 'search-list',
                name: 'selectedPath',
                message: 'Select a directory:',
                choices
            }
        ]);

        if (selectedPath === 'confirm') {
            return currentPath;
        } else if (selectedPath === 'up') {
            const parentPath = path.dirname(currentPath);
            if (parentPath !== currentPath) {
                currentPath = parentPath;
            }
        } else if (selectedPath === 'cancel') {
            return null;
        } else {
            currentPath = path.join(currentPath, selectedPath);
        }
    }
}
