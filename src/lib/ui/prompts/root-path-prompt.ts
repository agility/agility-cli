import inquirer from 'inquirer';
import inquirerSearchList from 'inquirer-search-list';

inquirer.registerPrompt('search-list', inquirerSearchList);

export default async function rootPathPrompt() {

    const { rootPath } = await inquirer.prompt([
        {
            type: 'input',
            name: 'rootPath',
            message: 'Download files to (default: agility-files, example: my-files/agility-data):',
            default: 'agility-files'
        }
    ]);
    // Remove leading and trailing slashes from the path just in case
    const cleanPath = rootPath.replace(/^\/+|\/+$/g, '');
    return cleanPath;

}
