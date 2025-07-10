import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';

export async function websiteAddressPrompt() {

    const filePath = path.resolve(__dirname, 'userWebsite.txt');

   
        let defaultWebsite = '';
        if (fs.existsSync(filePath)) {
            defaultWebsite = fs.readFileSync(filePath, 'utf-8').trim();
        }

        const { website } = await inquirer.prompt([
            {
                type: 'input',
                name: 'website',
                message: 'Enter your website address:',
                default: defaultWebsite,
            },
        ]);

        fs.writeFileSync(filePath, website, 'utf-8');
        console.log(`Website address saved to ${filePath}`);

        return website;


}