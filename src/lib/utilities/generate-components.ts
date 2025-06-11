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



import { AgilityInstance } from "../../types/instance";
const axios = require("axios");

let AI_ENDPOINT: string = "https://4a3b-2607-fea8-7d60-2b00-1d24-b69c-b93f-b227.ngrok-free.app/api/ai/cli/react-components";
let auth: Auth;

export default async function generateReactComponents(selectedInstance: AgilityInstance) {
  const locale = await localePrompt(selectedInstance);

  console.log(locale)

  const filesPath = await fileSystemPrompt();



  auth = new Auth();
  let code = new fileOperations('agility-files', selectedInstance.guid, locale, true);

  let data = JSON.parse(code.readTempFile("code.json"));
  const form = new FormData();
  form.append("cliCode", data.code);

  let guid: string = selectedInstance.guid as string;
  let token = await auth.cliPoll(form, guid);

  try {

    console.log('\n')
    let str = "🤖 AI Generating React Components";
    // const rainbow = chalkAnimation.pulse(str);

    // // Add a new dot every second
    // let dotCount = 0;
    // setInterval(() => {
    //   if (dotCount === 3) {
    //   str = "🤖 AI Generating React Components";
    //   dotCount = 0;
    //   } else {
    //   str += '.';
    //   dotCount++;
    //   }
    //   rainbow.replace(str);
    // }, 1000);


    // lets hit the AI_ENDPOINT
    const response = await axios.post(
      AI_ENDPOINT,
      {},
      {
      headers: {
        AUTHORIZATION: `Bearer ${token.access_token}`,
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
   
      console.log(result)
   
    });

    return await new Promise((resolve) => reader.on("end", resolve));
  } catch (error) {
    console.error("Error occurred while hitting AI_ENDPOINT:", error);
  }

}
