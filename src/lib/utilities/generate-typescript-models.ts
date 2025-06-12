const FormData = require("form-data");
import { Auth } from "../services/auth";
import { fileOperations } from "../services/fileOperations";
import { localePrompt } from "../prompts/locale-prompt";
import * as path from "path";
import ansiColors = require("ansi-colors");
import { homePrompt } from "../prompts/home-prompt";
import fileSystemPrompt from "../prompts/file-system-prompt";
import { AgilityInstance } from "../../types/Instance";
import { forceDevMode } from "../../index";
const axios = require("axios");

let AI_ENDPOINT_DEV: string = "https://manager-bff-qa-git-cli-ai.publishwithagility.com/api/ai/cli/typescript-models";
// let AI_ENDPOINT_DEV:string = "https://bff.publishwithagility.com/api/ai/cli/typescript-models";
let AI_ENDPOINT_PROD: string = "https://bff.agilitycms.com/api/ai/cli/typescript-models";


export default async function generateTypes(selectedInstance: AgilityInstance) {

  let AI_ENDPOINT: string = forceDevMode ? AI_ENDPOINT_DEV : AI_ENDPOINT_PROD;


  const locale = await localePrompt(selectedInstance);
  const filesPath = await fileSystemPrompt();

  console.log(ansiColors.yellow("Generating TypeScript interfaces..."));

  const auth = new Auth();
  const code = new fileOperations('agility-files', selectedInstance.guid, locale, true);
  let guid: string = selectedInstance.guid as string;
  const token = await auth.getToken();

  try {
    // lets hit the AI_ENDPOINT
    const response = await axios.post(
      AI_ENDPOINT,
      {},
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "agility-guid": guid,
          "agility-locale": locale,
        },
        responseType: "stream",
      }
    );

    const reader = response.data;
    const decoder = new TextDecoder("utf-8");

    let result = "";
    reader.on("data", (chunk: Buffer) => {
      result += decoder.decode(chunk, { stream: true });
    });

    reader.on("end", () => {
      const modelsFilePath = path.join(filesPath, "models.ts");
      const cleanedResult = result.replace(/^```typescript\s*/, "").replace(/```$/, "");
      code.createFile(modelsFilePath, cleanedResult);
      console.log(ansiColors.green("🚀 TypeScript models generated successfully!"));
      console.log(`\nResponse written to ${modelsFilePath}`);
      homePrompt(true);
    });

    await new Promise((resolve) => reader.on("end", resolve));
  } catch (error) {
    const timestamp = new Date().toISOString();
    code.appendLogFile(`${timestamp} Error generating TypeScript interfaces: ${error} - ${AI_ENDPOINT}\n`);
    console.log(ansiColors.red(`Error occurred while generating TypeScript interfaces.`));
    homePrompt(true);

  }

}
