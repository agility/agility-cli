import inquirer from 'inquirer';
import { Auth, fileOperations } from '../../core';
import { AgilityInstance } from '../../types/agilityInstance';
import * as mgmtApi from '@agility/management-sdk';
import { getBaseURLfromGUID } from './base-url-prompt';
import { state } from '../../core/state';
const FormData = require("form-data");

let auth: Auth;
export async function localePrompt(selectedInstance: AgilityInstance) {

  auth = new Auth();
  let guid: string = selectedInstance.guid;

  // Use getApiClient for consistent API client initialization
  let apiClient: mgmtApi.ApiClient;
  try {
    const { getApiClient } = await import('../../core/state');
    apiClient = getApiClient();
  } catch (error) {
    // Fallback for cases where state isn't fully initialized
    let options = new mgmtApi.Options();
    options.token = await auth.getToken();
    options.baseUrl = auth.determineBaseUrl(guid);
    apiClient = new mgmtApi.ApiClient(options);
  }

  try {
    let localesArr = await apiClient.instanceMethods.getLocales(guid);

    let locales = localesArr.map((locale: mgmtApi.Locales) => {
      return locale['localeCode'];
    });

    const questions = [
      {
        type: "search-list",
        name: "locales",
        message: "Select a locale:",
        choices: locales,
        default: locales[0], // Default value
      },
    ];


    const answers = await inquirer.prompt(questions);

    return answers.locales;

  } catch (error) {
    console.error('Error fetching locales:', error);
    return null;
  }
}