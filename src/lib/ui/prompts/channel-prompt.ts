import inquirer from 'inquirer';

export async function channelPrompt() {
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'channel',
            default: 'website',  // Default value
            message: 'Please enter your website channel:',
        },
    ]);

    return answers.channel;

};