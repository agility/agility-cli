import { serverUser } from "../types/serverUser";
import { state, getState, clearApiClient } from "./state";
import * as mgmtApi from "@agility/management-sdk";
const open = require("open");
const FormData = require("form-data");
import fs from "fs";
import path from "path";
import https from "https";

import keytar from "keytar";
import { exit } from "process";
import ansiColors from "ansi-colors";

import { getAllChannels } from "../lib/shared/get-all-channels";

const SERVICE_NAME = "agility-cli";

let lastLength = 0;

function logReplace(text) {
  const clear = " ".repeat(lastLength);
  process.stdout.write("\r" + clear + "\r" + text);
  lastLength = text.length;
}

export class Auth {
  private insecureMode: boolean = false;

  constructor(insecureMode: boolean = false) {
    this.insecureMode = insecureMode;
  }

  setInsecureMode(insecure: boolean) {
    this.insecureMode = insecure;
  }

  private createHttpsAgent() {
    if (this.insecureMode) {
      return new https.Agent({
        rejectUnauthorized: false,
      });
    }
    return undefined;
  }

  private getFetchConfig(): RequestInit {
    const config: RequestInit = {
      headers: {
        "Cache-Control": "no-cache",
        "User-Agent": "agility-cli-fetch/1.0",
      },
    };

    if (this.insecureMode) {
      // For fetch with Node.js, we need to handle SSL differently
      // This is a simplified approach - in production, you might need more sophisticated SSL handling
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }

    return config;
  }

  private handleSSLError(error: any): never {
    if (error.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
      error.code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      error.message?.includes('certificate')) {
      console.error('❌ SSL Certificate Error detected.');
      console.error('This often happens in corporate environments with proxy servers.');
      console.error('Try running with the --insecure flag to bypass SSL verification:');
      console.error('  npx agility login --insecure');
      console.error('  npx agility pull --insecure --sourceGuid <your-guid>');
      console.error('  npx agility sync --insecure --sourceGuid <guid1> --targetGuid <guid2>');
    }
    throw error;
  }

  getEnv(): "dev" | "local" | "preprod" | "prod" {
    return state.local ? "local" : state.dev ? "dev" : state.preprod ? "preprod" : "prod";
  }

  checkForEnvFile(): { hasEnvFile: boolean; guid?: string; channel?: string; locales?: string[] } {
    const envFiles = [".env", ".env.local", ".env.development", ".env.production"];
    const result: { hasEnvFile: boolean; guid?: string; channel?: string; locales?: string[] } = { hasEnvFile: false };

    for (const envFile of envFiles) {
      const envPath = path.join(process.cwd(), envFile);
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf8");
        const guidMatch = envContent.match(/AGILITY_GUID=([^\n]+)/);
        const channelMatch = envContent.match(/AGILITY_WEBSITE=([^\n]+)/);
        const localeMatch = envContent.match(/AGILITY_LOCALES=([^\n]+)/);

        if (guidMatch && guidMatch[1]) {
          result.hasEnvFile = true;
          result.guid = guidMatch[1].trim();
        }
        if (channelMatch && channelMatch[1]) {
          result.hasEnvFile = true;
          result.channel = channelMatch[1].trim();
        }
        if (localeMatch && localeMatch[1]) {
          result.hasEnvFile = true;
          result.locales = localeMatch[1].trim().split(",");
        }
        if (result.hasEnvFile) {
          return result;
        }
      }
    }

    return result;
  }

  getEnvKey(env: string): string {
    return `cli-auth-token:${env}`;
  }

  async logout() {
    const env = this.getEnv();
    const key = this.getEnvKey(env);
    try {
      const removed = await keytar.deletePassword(SERVICE_NAME, key);
      if (removed) {
        console.log(`Logged out from ${env} environment.`);
      } else {
        console.log(`No token found in ${env} environment.`);
      }
    } catch (err) {
      console.error(`❌ Failed to delete token:`, err);
    }
    exit();
  }

  async generateCode() {
    let firstPart = (Math.random() * 46656) | 0;
    let secondPart = (Math.random() * 46656) | 0;
    let firstString = ("000" + firstPart.toString(36)).slice(-3);
    let secondString = ("000" + secondPart.toString(36)).slice(-3);
    return firstString + secondString;
  }

  determineBaseUrl(guid?: string, userBaseUrl: string = null): string {
    if (userBaseUrl) {
      return userBaseUrl;
    }
    if (state.local) {
      return "https://localhost:5050";
    }
    if (state.dev) {
      return "https://mgmt-dev.aglty.io";
    }
    if (state.preprod) {
      return "https://management-api-us-pre-prod.azurewebsites.net";
    }

    if (guid?.endsWith("d")) {
      return "https://mgmt-dev.aglty.io";
    } else if (guid?.endsWith("u")) {
      return "https://mgmt.aglty.io";
    } else if (guid?.endsWith("c")) {
      return "https://mgmt-ca.aglty.io";
    } else if (guid?.endsWith("e")) {
      return "https://mgmt-eu.aglty.io";
    } else if (guid?.endsWith("a")) {
      return "https://mgmt-aus.aglty.io";
    }
    return "https://mgmt.aglty.io";
  }

  getBaseUrl(guid: string, userBaseUrl: string = null): string {
    let baseUrl = this.determineBaseUrl(guid, userBaseUrl);
    return `${baseUrl}/oauth`;
  }

  getBaseUrlPoll(): string {
    let baseURL = "https://mgmt.aglty.io";

    if (state.dev) {
      baseURL = "https://mgmt-dev.aglty.io";
    }

    if (state.preprod) {
      baseURL = "https://management-api-us-pre-prod.azurewebsites.net";
    }

    if (state.local) {
      baseURL = "https://localhost:5050";
    }

    return `${baseURL}/oauth`;
  }

  async executeGet(apiPath: string, guid: string, userBaseUrl: string = null) {
    const baseUrl = this.getBaseUrl(guid, userBaseUrl);
    const url = `${baseUrl}${apiPath}`;

    try {
      // Get the token for authorization
      const token = await this.getToken();

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
          "User-Agent": "agility-cli-fetch/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
      }

      // Try to parse as JSON first, if that fails, return as text
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        return await response.json();
      } else {
        // For non-JSON responses (like preview/fetch keys), return the text directly
        const textResponse = await response.text();
        // Handle both quoted and unquoted string responses
        return textResponse.startsWith('"') && textResponse.endsWith('"')
          ? textResponse.slice(1, -1)
          : textResponse;
      }
    } catch (err) {
      this.handleSSLError(err);
    }
  }

  async executePost(apiPath: string, guid: string, data: any) {
    const baseUrl = this.getBaseUrlPoll();
    const url = `${baseUrl}${apiPath}`;

    try {
      let body: string | FormData | URLSearchParams;
      let headers: Record<string, string> = {
        "Cache-Control": "no-cache",
        "User-Agent": "agility-cli-fetch/1.0",
      };

      if (data instanceof FormData) {
        body = data;
        // Don't set Content-Type for FormData, let fetch set it with boundary
      } else if (data instanceof URLSearchParams) {
        body = data;
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else {
        body = JSON.stringify(data);
        headers["Content-Type"] = "application/json";
      }

      const response = await fetch(url, {
        method: "POST",
        body: body,
        headers: headers,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
      }

      return await response.json();
    } catch (err) {
      this.handleSSLError(err);
    }
  }

  async authorize() {
    let code = await this.generateCode();

    const baseUrl = this.determineBaseUrl(); // guid is optional and will be handled by determineBaseUrl
    const redirectUri = `${baseUrl}/oauth/CliAuth`;
    const authUrl = `${baseUrl}/oauth/Authorize?response_type=code&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&state=cli-code%2e${code}`;

    await open(authUrl);
    return code;
  }

  /**
   * Complete initialization: .env priming + validation + authentication + setup
   * Handles everything needed to get the CLI ready for operation
   */
  async init(): Promise<boolean> {
    // Step 1: Configure SSL if needed
    const { configureSSL } = await import("./state");
    configureSSL();

    // Step 2: Authenticate
    const isAuthenticated = await this.checkAuthorization();
    if (!isAuthenticated) {
      return false;
    }

    // Step 3: Get API keys for all GUIDs
    const allGuids = [...state.sourceGuid, ...state.targetGuid];
    state.apiKeys = [];

    for (const guid of allGuids) {
      if (guid) {
        try {
          const previewKey = await this.getPreviewKey(guid);
          const fetchKey = await this.getFetchKey(guid);

          state.apiKeys.push({ guid, previewKey, fetchKey });
        } catch (error) {
          console.log(ansiColors.yellow(`Warning: Could not get keys for GUID ${guid}: ${error.message}`));
        }
      }
    }

    // Step 4: Set up UI mode in state
    state.useHeadless = state.headless; // headless takes precedence
    state.useVerbose = !state.useHeadless && state.verbose;
    // Remove blessed mode - no longer supported

    // Step 5: Check permission bypass flags
    const shouldSkip = this.shouldSkipPermissionCheck();
    if (shouldSkip) {
      if (state.test) {
        console.log(ansiColors.yellow("🧪 TEST MODE: Bypassing permission checks for analysis..."));
      } else if (state.test) {
        console.log(ansiColors.yellow("🧪 TEST MODE: Bypassing permission checks..."));
      }
    }

    // Step 5: Set up basic management API options
    const mgmtApiOptions = new (await import("@agility/management-sdk")).Options();
    mgmtApiOptions.token = await this.getToken();

    // // Store basic mgmt API options in state
    state.mgmtApiOptions = mgmtApiOptions;

    // Clear cached API client to ensure fresh connection with new auth state
    // const { clearApiClient } = await import('./state');
    // clearApiClient();
    state.cachedApiClient = new mgmtApi.ApiClient(state.mgmtApiOptions);

    // Load user data for interactive prompts and general use
    if (state.sourceGuid.length > 0) {
      try {
        const primaryGuid = state.sourceGuid[0];
        const user = await this.getUser(primaryGuid);
        if (user) {
          state.user = user;
          state.currentWebsite = user.websiteAccess.find((website: any) => website.guid === primaryGuid);
        }
      } catch (error) {
        // Non-fatal for interactive mode - user data will be loaded when needed
        console.log(ansiColors.yellow(`Note: Could not load user data: ${error.message}`));
      }
    }

    // Step 6: Auto-detect available locales for ALL GUIDs in the matrix
    if (allGuids.length > 0) {
      try {



        //Get the locales for the SOURCE GUID
        let sourceLocales: string[] = [];
        if (state.sourceGuid.length > 0) {
          sourceLocales = (await state.cachedApiClient.instanceMethods.getLocales(state.sourceGuid[0])).map((locale: any) => locale.localeCode);
          state.availableLocales = sourceLocales;
        }

        //Get the locales for the TARGET GUID
        let targetLocales: string[] = [];
        if (state.targetGuid.length > 0) {
          targetLocales = (await state.cachedApiClient.instanceMethods.getLocales(state.targetGuid[0])).map((locale: any) => locale.localeCode);

          // MAKE SURE THAT the TARGET has the same locales as the SOURCE
          const missingLocales = sourceLocales.filter(locale => !targetLocales.includes(locale));
          if (missingLocales.length > 0) {
            console.log(ansiColors.yellow(`⚠️  Target instance ${state.targetGuid[0]}: Missing locales ${missingLocales.join(', ')} (available: ${targetLocales.join(', ')})`));
            return false; // Cannot proceed with missing locales
          }
        }

        //if they pass in locales, use those, ONLY if they are all in the source locales list
        let localesToUse = sourceLocales;
        if (state.locale.length > 0) {
          let validLocales = state.locale.filter(l => sourceLocales.includes(l));
          if (validLocales.length === 0) {
            console.log(ansiColors.yellow(`⚠️  None of the specified locales exist in the source instance ${state.sourceGuid[0]}. Using all available locales.`));
          } else {
            localesToUse = validLocales; // Use only valid locales that exist in the source
          }
        }

        const guidLocaleMap = new Map<string, string[]>();
        guidLocaleMap.set(state.sourceGuid[0], localesToUse);

        if (state.targetGuid.length > 0) {
          //if we have a target...
          guidLocaleMap.set(state.targetGuid[0], localesToUse);
        }

        state.locale = localesToUse; // Set the state locale list to the determined locales
        state.guidLocaleMap = guidLocaleMap;

        //MOD: JOELV - I didn't understand what this logic was doing, so I replaced it with the above logic...
        // Get locales for each GUID in the matrix
        // const guidLocaleMap = new Map<string, string[]>();
        // const allDetectedLocales = new Set<string>();
        // let totalCombinations = 0;

        // for (const guid of allGuids) {
        //   if (guid) {
        //     try {
        //       const localesArr = await state.cachedApiClient.instanceMethods.getLocales(guid);

        //       // TODO: Get channels for each locale
        //       // const channelsArr = await getAllChannels(guid, localesArr[0].localeCode);
        //       const localesForGuid = localesArr.map((locale: any) => locale.localeCode);

        //       // Handle user-specified locale filtering per GUID
        //       let finalLocalesForGuid = localesForGuid;
        //       if (state.locale.length > 0) {
        //         // User specified locales: only use those that exist for this GUID
        //         finalLocalesForGuid = state.locale.filter(userLocale =>
        //           localesForGuid.includes(userLocale)
        //         );

        //         // Warn about missing locales for this GUID
        //         const missingLocales = state.locale.filter(userLocale =>
        //           !localesForGuid.includes(userLocale)
        //         );
        //         if (missingLocales.length > 0) {
        //           console.log(ansiColors.yellow(`⚠️  ${guid}: Missing locales ${missingLocales.join(', ')} (available: ${localesForGuid.join(', ')})`));
        //         }

        //         // Fallback if no user locales exist for this GUID
        //         if (finalLocalesForGuid.length === 0) {
        //           console.log(ansiColors.yellow(`⚠️  ${guid}: None of the specified locales exist, using all available`));
        //           finalLocalesForGuid = localesForGuid;
        //         }
        //       }

        //       guidLocaleMap.set(guid, finalLocalesForGuid);
        //       totalCombinations += finalLocalesForGuid.length;

        //       // Add to set of all detected locales
        //       finalLocalesForGuid.forEach(locale => allDetectedLocales.add(locale));

        //       console.log(`${guid}: ${finalLocalesForGuid.join(', ')}`);
        //     } catch (error) {
        //       console.log(ansiColors.yellow(`⚠️  Could not get locales for ${guid}: ${error.message}`));
        //       const fallbackLocales = state.locale.length > 0 ? [state.locale[0]] : ['en-us'];
        //       guidLocaleMap.set(guid, fallbackLocales);
        //       totalCombinations += fallbackLocales.length;
        //     }
        //   }
        // }

        // // Store the per-GUID locale mapping in state
        // state.guidLocaleMap = guidLocaleMap;
        // state.availableLocales = Array.from(allDetectedLocales);


        // Show detailed matrix
        Array.from(guidLocaleMap.entries()).forEach(([guid, locales]) => {
          console.log(`${guid} → ${locales.length} locale(s): ${locales.join(', ')}`);
        });

      } catch (error) {
        console.log(ansiColors.yellow(`Note: Could not auto-detect locales: ${error.message}`));
        state.availableLocales = ['en-us']; // Fallback to default

        // Create fallback mapping for all GUIDs
        const fallbackLocales = state.locale.length > 0 ? [state.locale[0]] : ["en-us"];
        for (const guid of allGuids) {
          if (guid) {
            state.guidLocaleMap.set(guid, fallbackLocales);
          }
        }
        console.log(`📝 Using fallback mapping: all GUIDs → ${fallbackLocales.join(", ")}`);
      }
    }

    return true;
  }

  /**
   * Validate user access to an instance
   */
  private async validateInstanceAccess(guid: string, instanceType: string): Promise<void> {
    try {
      const user = await this.getUser(guid);
      if (!user) {
        throw new Error(
          `Could not retrieve user details for ${instanceType} instance ${guid}. Please ensure it's a valid GUID and you have access.`
        );
      }

      const permission = await this.checkUserRole(guid);
      if (!permission.hasPermission) {
        throw new Error(`You do not have the required permissions on the ${instanceType} instance ${guid}.`);
      }

      // Store user info for the primary instance
      if (instanceType === "instance" || instanceType === "source") {
        state.user = user;

        // Store current website details
        if (state.sourceGuid) {
          state.currentWebsite = user.websiteAccess.find((website: any) => website.guid === state.sourceGuid);
        }
      }
    } catch (error) {
      throw new Error(
        `${instanceType.charAt(0).toUpperCase() + instanceType.slice(1)} instance authentication failed: ${
          error.message
        }`
      );
    }
  }

  async checkAuthorization(): Promise<boolean> {
    const env = this.getEnv();
    const key = this.getEnvKey(env);
    const tokenRaw = await keytar.getPassword(SERVICE_NAME, key);

    if (tokenRaw) {
      try {
        const token = JSON.parse(tokenRaw);

        if (token.access_token && token.expires_in && token.timestamp) {
          const issuedAt = new Date(token.timestamp).getTime();
          const expiresAt = issuedAt + token.expires_in * 1000;

          if (Date.now() < expiresAt) {
            console.log(ansiColors.green(`\r● Authenticated to ${env === "prod" ? "Agility" : env} servers.\n`));
            return true;
          } else {
            console.log("Existing token has expired. Starting re-authentication...");
          }
        } else {
          console.warn("Token is missing expiration metadata. Re-authentication required.");
        }
      } catch (err) {
        console.warn("Failed to parse token. Re-authentication required.");
      }
    } else {
      console.log(ansiColors.yellow("No token found in keychain. Starting auth flow..."));
    }

    const cliCode = await this.authorize();
    logReplace("\rWaiting for authentication in your browser...");

    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          const params = new URLSearchParams();
          params.append("cliCode", cliCode);
          const token = await this.cliPoll(params);

          if (token && token.access_token && token.expires_in && token.timestamp) {
            // Store token in keytar
            console.log(ansiColors.green(`\r🔑 Authenticated to ${env} servers.\n`));
            console.log("----------------------------------\n");

            await keytar.setPassword(SERVICE_NAME, key, JSON.stringify(token));
            clearInterval(interval);
            resolve(true);
          }
        } catch (err) {
          // Keep polling
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Authorization timed out after 60 seconds."));
      }, 60000);
    });
  }

  async login() {
    console.log("🔑 Authenticating to Agility CMS...");

    const env = this.getEnv();
    const key = this.getEnvKey(env);

    const cliCode = await this.authorize();
    logReplace("\rWaiting for authentication in your browser...");

    return new Promise((resolve, reject) => {
      const interval = setInterval(async () => {
        try {
          // Create URLSearchParams directly instead of FormData
          const params = new URLSearchParams();
          params.append("cliCode", cliCode);

          const token = await this.cliPoll(params, "blank-d");

          if (token && token.access_token && token.expires_in && token.timestamp) {
            // Store token in keytar
            console.log(ansiColors.green(`\r🔑 Authenticated to ${env} servers.\n`));
            console.log("----------------------------------\n");

            await keytar.setPassword(SERVICE_NAME, key, JSON.stringify(token));
            clearInterval(interval);
            resolve(true);
          }
        } catch (err) {
          // Keep polling - user hasn't completed OAuth yet
        }
      }, 2000);

      setTimeout(() => {
        clearInterval(interval);
        reject(new Error("Authentication timed out after 60 seconds."));
      }, 60000);
    });
  }

  async getToken(): Promise<string> {
    const env = this.getEnv();
    const key = this.getEnvKey(env);

    const tokenRaw = await keytar.getPassword(SERVICE_NAME, key);

    if (!tokenRaw) {
      throw new Error(`❌ No token found in keychain for environment: ${env}. Run 'agility login' to authenticate.`);
    }

    try {
      const token = JSON.parse(tokenRaw);

      if (token.access_token && token.expires_in && token.timestamp) {
        const issuedAt = new Date(token.timestamp).getTime();
        const expiresAt = issuedAt + token.expires_in * 1000;

        if (Date.now() < expiresAt) {
          return token.access_token;
        } else {
          throw new Error("❌ Token has expired. Please run `agility login` again.");
        }
      } else {
        throw new Error("❌ Token is missing required fields (access_token, expires_in, timestamp).");
      }
    } catch (err) {
      throw new Error("❌ Failed to parse stored token. Please log in again.");
    }
  }

  async cliPoll(data: FormData | URLSearchParams, guid: string = "blank-d") {
    try {
      // Just pass the data directly - both FormData and URLSearchParams should work with fetch
      const result = await this.executePost("/CliPoll", guid, data);

      // Add timestamp if it's missing
      if (result.access_token && !result.timestamp) {
        result.timestamp = new Date().toISOString();
      }

      return result;
    } catch (err) {
      throw new Error(`during CLI poll: ${err.message}`);
    }
  }

  async getPreviewKey(guid: string, userBaseUrl: string = null) {
    try {
      const result = await this.executeGet("/GetPreviewKey?guid=" + guid, guid, userBaseUrl);
      // The API returns a raw string, not a JSON object with a previewKey property
      return result;
    } catch (err) {
      throw err;
    }
  }

  async getFetchKey(guid: string, userBaseUrl: string = null) {
    try {
      const result = await this.executeGet("/GetFetchKey?guid=" + guid, guid, userBaseUrl);
      // The API returns a raw string, not a JSON object with a fetchKey property
      return result;
    } catch (err) {
      throw err;
    }
  }

  async checkUserRole(guid: string) {
    try {
      // Use the existing getUser method which calls /users/me correctly
      const userData = await this.getUser(guid);

      // Find the website access for this specific instance
      const instanceAccess = userData.websiteAccess?.find(access => access.guid === guid);

      if (!instanceAccess) {
        console.log(ansiColors.red(`❌ You do not have access to instance: ${guid}`));
        console.log(ansiColors.yellow(`Contact your instance administrator to get access.`));
        return { hasPermission: false, role: null };
      }

      // Check if user is owner of this instance
      if (instanceAccess.isOwner) {
        return { hasPermission: true, role: "Owner" };
      } else {
        // Non-owners still have manager-level access in Agility CMS
        // For sync operations, we'll allow any user with access
        return { hasPermission: true, role: "Manager" };
      }
    } catch (err) {
      console.log(ansiColors.red(`Error checking user role: ${err}`));
      console.log(ansiColors.yellow(`You do not have the required permissions on the target instance ${guid}.`));
      return { hasPermission: false, role: null };
    }
  }

  async getUser(guid?: string): Promise<serverUser> {
    let baseUrl = this.determineBaseUrl(guid);
    let apiPath = "/users/me";
    let endpoint = `${baseUrl}/api/v1${apiPath}`;

    const token = await this.getToken();

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: serverUser = await response.json();

      if (!data || !data.websiteAccess) {
        throw new Error("Invalid user data received");
      }

      if (!data.websiteAccess || data.websiteAccess.length === 0) {
        throw new Error("User does not have access to any instances.");
      }

      return data;
    } catch (error) {
      console.error("Error fetching user:", error);
      throw new Error("Failed to get user data. Please try logging in again.");
    }
  }

  async getUsers(guid: string, userBaseUrl: string = null): Promise<serverUser[]> {
    const baseUrl = this.determineBaseUrl(guid, userBaseUrl);
    const token = await this.getToken();

    try {
      const response = await fetch(`${baseUrl}/api/v1/instance/${guid}/users`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Cache-Control": "no-cache",
          "User-Agent": "agility-cli-fetch/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      this.handleSSLError(err);
    }
  }

  /**
   * Determine if permission checks should be skipped based on state flags
   */
  /**
   * Validate command-specific requirements and set up instance access
   * This should be called by each command after auth.init()
   */
  async validateCommand(commandType: "pull" | "sync" | "clean" | "interactive" | "push"): Promise<boolean> {
    const missingFields: string[] = [];

    // Validate that --publish flag is only used with sync command
    if (state.publish && commandType !== "sync") {
      console.log(ansiColors.red(`\n❌ The --publish flag is only available for sync commands.`));
      console.log(ansiColors.yellow(`💡 Use: agility sync --sourceGuid="source" --targetGuid="target" --publish`));
      return false;
    }

    // Check command-specific requirements
    switch (commandType) {
      case 'pull':
        if (!state.sourceGuid || state.sourceGuid.length === 0) missingFields.push('sourceGuid (use --sourceGuid or AGILITY_GUID in .env)');

        // Check for locales: either user-specified OR auto-detected per-GUID mappings
        const hasUserLocales = state.locale && state.locale.length > 0;
        const hasAutoDetectedLocales = state.guidLocaleMap && state.guidLocaleMap.size > 0;
        if (!hasUserLocales && !hasAutoDetectedLocales) {
          missingFields.push("locale (use --locale or AGILITY_LOCALES in .env, or locales will be auto-detected)");
        }

        if (!state.channel) missingFields.push('channel (use --channel or AGILITY_WEBSITE in .env)');
        break;

      case 'sync':
        if (!state.sourceGuid || state.sourceGuid.length === 0) missingFields.push('sourceGuid (use --sourceGuid or AGILITY_GUID in .env)');
        if (!state.targetGuid || state.targetGuid.length === 0) missingFields.push('targetGuid (use --targetGuid)');

        // Check for locales: either user-specified OR auto-detected per-GUID mappings
        const hasSyncUserLocales = state.locale && state.locale.length > 0;
        const hasSyncAutoDetectedLocales = state.guidLocaleMap && state.guidLocaleMap.size > 0;
        if (!hasSyncUserLocales && !hasSyncAutoDetectedLocales) {
          missingFields.push("locale (use --locale or AGILITY_LOCALES in .env, or locales will be auto-detected)");
        }

        if (!state.channel) missingFields.push('channel (use --channel or AGILITY_WEBSITE in .env)');
        break;

      case "clean":
        // Clean needs minimal validation since it prompts for instance selection
        break;

      case "interactive":
        // Interactive mode doesn't require upfront validation
        return true;
    }

    // Show missing fields if any
    if (missingFields.length > 0) {
      console.log(ansiColors.red("\n❌ Missing required configuration:"));
      missingFields.forEach((field) => {
        console.log(ansiColors.red(`   • ${field}`));
      });
      return false;
    }

    // Validate instance access and set up API configuration
    const shouldSkip = this.shouldSkipPermissionCheck();

    try {
      if (commandType === "sync" && state.targetGuid && state.targetGuid.length > 0) {
        // Sync operation - validate access to both source and target (use first GUID for validation)
        if (!shouldSkip) {
          await this.validateInstanceAccess(state.sourceGuid[0], "source");
          await this.validateInstanceAccess(state.targetGuid[0], "target");
        }

        // Configure for target instance (sync writes to target - use first target GUID)
        const targetBaseUrl = state.baseUrl || this.determineBaseUrl(state.targetGuid[0]);
        state.mgmtApiOptions!.baseUrl = targetBaseUrl;
        state.baseUrl = targetBaseUrl;

        // Get API keys for source instance (needed for pull phase of sync - use first source GUID)
        const previewKey = await this.getPreviewKey(state.sourceGuid[0]);
        const fetchKey = await this.getFetchKey(state.sourceGuid[0]);

        state.previewKey = previewKey;
        state.fetchKey = fetchKey;
        state.apiKeyForPull = state.preview ? previewKey : fetchKey;

        if (!state.apiKeyForPull) {
          console.log(
            ansiColors.red(
              `Could not retrieve the required API key (preview: ${state.preview}) for source instance ${state.sourceGuid[0]}. Check API key configuration in Agility and --baseUrl if used.`
            )
          );
          return false;
        }

      } else if (commandType === 'pull' && state.sourceGuid && state.sourceGuid.length > 0) {
        // Pull operation - validate source access and get API keys (use first source GUID for validation)
        if (!shouldSkip) {
          await this.validateInstanceAccess(state.sourceGuid[0], "instance");
        }

        const baseUrl = state.baseUrl || this.determineBaseUrl(state.sourceGuid[0]);
        state.mgmtApiOptions!.baseUrl = baseUrl;
        state.baseUrl = baseUrl;

        // Get API keys for pull operations (use first source GUID)
        const previewKey = await this.getPreviewKey(state.sourceGuid[0]);
        const fetchKey = await this.getFetchKey(state.sourceGuid[0]);

        state.previewKey = previewKey;
        state.fetchKey = fetchKey;
        state.apiKeyForPull = state.preview ? previewKey : fetchKey;

        if (!state.apiKeyForPull) {
          console.log(
            ansiColors.red(
              `Could not retrieve the required API key (preview: ${state.preview}) for instance ${state.sourceGuid[0]}. Check API key configuration in Agility and --baseUrl if used.`
            )
          );
          return false;
        }
      }
    } catch (error) {
      console.log(ansiColors.red(`Error during command validation: ${error.message}`));
      return false;
    }

    return true;
  }

  shouldSkipPermissionCheck(): boolean {
    const state = getState();
    return state.test;
  }

  /**
   * Validate and resolve command parameters from args and .env file
   * Centralizes all GUID, LOCALE, CHANNEL validation logic
   *
   * @param args - Command arguments object
   * @param requiredFields - Array of required field names
   * @returns Validated parameters object
   */
  validateAndResolveParams(args: any, requiredFields: string[] = []) {
    const envCheck = this.checkForEnvFile();

    // Start with provided args
    const params = {
      sourceGuid: args.sourceGuid as string,
      targetGuid: args.targetGuid as string,
      locale: args.locale as string,
      channel: args.channel as string,
    };

    // Fill in from .env file if missing
    if (envCheck.hasEnvFile) {
      if (!params.sourceGuid && envCheck.guid) {
        params.sourceGuid = envCheck.guid; // For all commands
      }
      if (!params.locale && envCheck.locales && envCheck.locales.length > 0) {
        params.locale = envCheck.locales[0];
      }
      if (!params.channel && envCheck.channel) {
        params.channel = envCheck.channel;
      }
    }

    // Validate required fields
    const errors: string[] = [];

    for (const field of requiredFields) {
      if (!params[field as keyof typeof params]) {
        switch (field) {
          case 'sourceGuid':
            errors.push("Please provide a sourceGuid or ensure you are in a directory with a valid .env file containing a GUID.");
            break;
          case 'targetGuid':
            errors.push("Please provide a targetGuid.");
            break;
          case "locale":
            errors.push("Please provide a locale or ensure AGILITY_LOCALES is in your .env file.");
            break;
          case "channel":
            errors.push("Please provide a channel name.");
            break;
          default:
            errors.push(`Missing required parameter: ${field}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }

    return params;
  }

  /**
   * Setup authentication for pull operations
   * Handles single instance authentication and API key retrieval
   */
  async setupPullAuthentication(
    guid: string,
    isPreview: boolean,
    userBaseUrl?: string
  ): Promise<{ mgmtApiOptions: mgmtApi.Options; apiKeyForPull: string }> {
    // Verify base authentication
    const isAuthorized = await this.checkAuthorization();
    if (!isAuthorized) {
      throw new Error("Authentication failed. Please run 'agility login' first.");
    }

    // Check user access to instance
    const user = await this.getUser(guid);
    if (!user) {
      throw new Error(
        `Could not retrieve user details for instance ${guid}. Please ensure it's a valid GUID and you have access.`
      );
    }

    // Set up management API options
    const mgmtApiOptions = new mgmtApi.Options();
    mgmtApiOptions.token = await this.getToken();

    const determinedMgmtBaseUrl = this.determineBaseUrl(guid);
    mgmtApiOptions.baseUrl = userBaseUrl || determinedMgmtBaseUrl;

    // Get appropriate API key for pull operation
    const previewKey = await this.getPreviewKey(guid);
    const fetchKey = await this.getFetchKey(guid);
    const apiKeyForPull = isPreview ? previewKey : fetchKey;

    if (!apiKeyForPull) {
      throw new Error(
        `Could not retrieve the required API key (preview: ${isPreview}) for instance ${guid}. Check API key configuration in Agility and --baseUrl if used.`
      );
    }

    return { mgmtApiOptions, apiKeyForPull };
  }
}
