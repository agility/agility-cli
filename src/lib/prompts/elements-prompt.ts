import inquirer from "inquirer";
import fuzzy from "fuzzy";
import ansiColors from "ansi-colors";

inquirer.registerPrompt('checkbox-plus', require('inquirer-checkbox-plus-prompt'));

export async function elementsPrompt(type: 'pull' | 'push' = 'pull') {

    const elements = ['Assets', 'Galleries', 'Models', 'Containers','Content', 'Templates', 'Sitemaps', 'Redirections', 'Pages'];
    const pushElements = ['Assets', 'Galleries', 'Models','Containers', 'Content', 'Templates', 'Sitemaps', 'Redirections', 'Pages' ];
    
    console.log(ansiColors.red(`\n⚠️  It is advised to download the entirity of the instance, partial downloads may result in push issues.\n`));

    return inquirer.prompt([{
            type: 'checkbox-plus',
            name: 'elements',
            message: 'Select data elements to download (space to select, enter to submit)',
            pageSize: 10,
            highlight: true,
            searchable: true,
            default: type === 'pull' ? elements : pushElements,
            source: function(answersSoFar, input) {
          
              input = input || '';
          
              return new Promise(function(resolve) {
          
                var fuzzyResult = fuzzy.filter(input, type === 'pull' ? elements : pushElements);
          
                var data = fuzzyResult.map(function(element) {
                  return element.original;
                });
          
                resolve(data);
                
              });
          
            }
          }]).then(answers => {
            return answers.elements;
          }
    );


}