const FormData = require("form-data");
import { Auth } from "../services/auth";
import * as mgmtApi from "@agility/management-sdk";

import { type ContentListFilterModel } from "@agility/management-sdk/dist/models/contentListFilterModel";

import { fileOperations } from "../services/fileOperations";
import { localePrompt } from "../prompts/locale-prompt";
import { channelPrompt } from "../prompts/channel-prompt";
import { isPreviewPrompt } from "../prompts/isPreview-prompt";
import inquirer from "inquirer";
import * as path from "path";
import ansiColors = require("ansi-colors");
import { homePrompt } from "../prompts/home-prompt";
import fileSystemPrompt from "../prompts/file-system-prompt";

import { AgilityInstance } from "../../types/agilityInstance";

let AI_ENDPOINT: string = "https://4a3b-2607-fea8-7d60-2b00-1d24-b69c-b93f-b227.ngrok-free.app/api/ai/cli/react-components";
let auth: Auth;

export default async function generateReactComponents(selectedInstance: AgilityInstance): Promise<boolean> {
  const locale = await localePrompt(selectedInstance);

  console.log(locale)

  const filesPath = await fileSystemPrompt();

  auth = new Auth();
  let code = new fileOperations(process.cwd(), selectedInstance.guid, locale, true);

  let data = JSON.parse(code.readTempFile("code.json"));
  const form = new FormData();
  form.append("cliCode", data.code);

  let guid: string = selectedInstance.guid as string;
  let token = await auth.cliPoll(form, guid);

  try {
    console.log('\n')
    let str = "🤖 AI Generating React Components";

    // lets hit the AI_ENDPOINT
    const response = await fetch(AI_ENDPOINT, {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${token.access_token}`,
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

    console.log(result);
    return true;

  } catch (error) {
    console.error("Error occurred while hitting AI_ENDPOINT:", error);
    return false;
  }

}
