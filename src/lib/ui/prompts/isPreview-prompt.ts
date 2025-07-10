import inquirer from "inquirer";

export async function isPreviewPrompt() {
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'previewOrLive',
            message: 'Would you like the preview or published content?',
            choices: ['Preview', 'Published'], // NOTE: add a both option
        },
    ]);

    return answers.previewOrLive === 'Preview' ? true : false;
}