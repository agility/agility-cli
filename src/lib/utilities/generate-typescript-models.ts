const FormData = require("form-data");
import { Auth } from "../services/auth";
import { fileOperations } from "../services/fileOperations";
import { localePrompt } from "../prompts/locale-prompt";
import * as path from "path";
import ansiColors = require("ansi-colors");
import { homePrompt } from "../prompts/home-prompt";
import fileSystemPrompt from "../prompts/file-system-prompt";
import { AgilityInstance } from "../../types/agilityInstance";
import { forceDevMode } from "../../index";

let AI_ENDPOINT_DEV: string = "https://manager-bff-qa-git-cli-ai.publishwithagility.com/api/ai/cli/typescript-models";
// let AI_ENDPOINT_DEV:string = "https://bff.publishwithagility.com/api/ai/cli/typescript-models";
let AI_ENDPOINT_PROD: string = "https://bff.agilitycms.com/api/ai/cli/typescript-models";


export default async function generateTypes(selectedInstance: AgilityInstance) {

  let AI_ENDPOINT: string = forceDevMode ? AI_ENDPOINT_DEV : AI_ENDPOINT_PROD;

  const locale = await localePrompt(selectedInstance);
  const filesPath = await fileSystemPrompt();

  console.log(ansiColors.yellow("Generating TypeScript interfaces..."));

  const auth = new Auth();
  const code = new fileOperations(process.cwd(), selectedInstance.guid, locale, true);
  let guid: string = selectedInstance.guid as string;
  const token = await auth.getToken();

  try {
    // lets hit the AI_ENDPOINT
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "agility-guid": guid,
        "agility-locale": locale,
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body;
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder("utf-8");
    let result = "";

    // Use ReadableStream API for streaming response
    const readerInstance = reader.getReader();
    
    try {
      while (true) {
        const { done, value } = await readerInstance.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
    } finally {
      readerInstance.releaseLock();
    }

    const modelsFilePath = path.join(filesPath, "models.ts");
    const cleanedResult = result.replace(/^```typescript\s*/, "").replace(/```$/, "");
    code.createFile(modelsFilePath, cleanedResult);
    console.log(ansiColors.green("🚀 TypeScript models generated successfully!"));
    console.log(`\nResponse written to ${modelsFilePath}`);
    homePrompt(true);

  } catch (error) {
    const timestamp = new Date().toISOString();
    code.appendLogFile(`${timestamp} Error generating TypeScript interfaces: ${error} - ${AI_ENDPOINT}\n`);
    console.log(ansiColors.red(`Error occurred while generating TypeScript interfaces.`));
    homePrompt(true);
  }

}
