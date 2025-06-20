import { cliToken } from "../../types/cliToken";
import { fileOperations } from "./fileOperations";
import { serverUser } from "../../types/serverUser";
import { WebsiteUser } from "../../types/websiteUser";
import { state, getState } from "./state";
import { AgilityInstance } from "../../types/agilityInstance";
import * as mgmtApi from "@agility/management-sdk";
const open = require("open");
const FormData = require("form-data");
import fs from 'fs';
import path from 'path';
import https from 'https';

import keytar from "keytar";
import { exit } from "process";
import ansiColors from "ansi-colors";

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
        rejectUnauthorized: false
      });
    }
    return undefined;
  }

  private getFetchConfig(): RequestInit {
    const config: RequestInit = {
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': 'agility-cli-fetch/1.0'
      }
    };

    if (this.insecureMode) {
      // For fetch with Node.js, we need to handle SSL differently
      // This is a simplified approach - in production, you might need more sophisticated SSL handling
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
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

  checkForEnvFile(): { hasEnvFile: boolean; guid?: string; channel?: string, locales?: string[] } {
    const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
    const result: { hasEnvFile: boolean; guid?: string; channel?: string, locales?: string[] } = { hasEnvFile: false };

    for (const envFile of envFiles) {
      const envPath = path.join(process.cwd(), envFile);
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
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
          result.locales = localeMatch[1].trim().split(',');
        }
        if (result.hasEnvFile) {
          return result;
        }
      }
    }

    return result;
  }

  /**
   * Prime state with .env file values
   * Allows users to use .env files to set default configuration
   */
  primeStateFromEnv(): { hasEnvFile: boolean; primedValues: string[] } {
    const envFiles = ['.env', '.env.local', '.env.development', '.env.production'];
    const primedValues: string[] = [];
    
    for (const envFile of envFiles) {
      const envPath = path.join(process.cwd(), envFile);
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        
        // Parse all relevant environment variables
        const envVars = {
          AGILITY_GUID: envContent.match(/AGILITY_GUID=([^\n]+)/),
          AGILITY_TARGET_GUID: envContent.match(/AGILITY_TARGET_GUID=([^\n]+)/),
          AGILITY_WEBSITE: envContent.match(/AGILITY_WEBSITE=([^\n]+)/),
          AGILITY_LOCALES: envContent.match(/AGILITY_LOCALES=([^\n]+)/),
          AGILITY_TEST: envContent.match(/AGILITY_TEST=([^\n]+)/),
          AGILITY_OVERWRITE: envContent.match(/AGILITY_OVERWRITE=([^\n]+)/),
          
          AGILITY_PREVIEW: envContent.match(/AGILITY_PREVIEW=([^\n]+)/),
          AGILITY_VERBOSE: envContent.match(/AGILITY_VERBOSE=([^\n]+)/),
          AGILITY_HEADLESS: envContent.match(/AGILITY_HEADLESS=([^\n]+)/),
          AGILITY_ELEMENTS: envContent.match(/AGILITY_ELEMENTS=([^\n]+)/),
          AGILITY_ROOT_PATH: envContent.match(/AGILITY_ROOT_PATH=([^\n]+)/),
          AGILITY_BASE_URL: envContent.match(/AGILITY_BASE_URL=([^\n]+)/),
          AGILITY_DEV: envContent.match(/AGILITY_DEV=([^\n]+)/),
          AGILITY_LOCAL: envContent.match(/AGILITY_LOCAL=([^\n]+)/),
          AGILITY_PREPROD: envContent.match(/AGILITY_PREPROD=([^\n]+)/),
          AGILITY_BLESSED: envContent.match(/AGILITY_BLESSED=([^\n]+)/),
          AGILITY_LEGACY_FOLDERS: envContent.match(/AGILITY_LEGACY_FOLDERS=([^\n]+)/),
          AGILITY_INSECURE: envContent.match(/AGILITY_INSECURE=([^\n]+)/),
          
          AGILITY_MODELS: envContent.match(/AGILITY_MODELS=([^\n]+)/),
          
        };

        // Only prime state values that aren't already set from command line
                if (envVars.AGILITY_GUID && envVars.AGILITY_GUID[1] && !state.sourceGuid) {
            state.sourceGuid = envVars.AGILITY_GUID[1].trim();
            primedValues.push('sourceGuid');
        }
        
              if (envVars.AGILITY_WEBSITE && envVars.AGILITY_WEBSITE[1] && !state.channel) {
        state.channel = envVars.AGILITY_WEBSITE[1].trim();
          primedValues.push('channel');
        }
        
        if (envVars.AGILITY_LOCALES && envVars.AGILITY_LOCALES[1] && !state.locale) {
          state.locale = envVars.AGILITY_LOCALES[1].trim().split(',')[0];
          primedValues.push('locale');
        }
        
        // Handle boolean flags - prefer command line args over .env
        if (envVars.AGILITY_TEST && envVars.AGILITY_TEST[1] && state.test === undefined) {
          state.test = envVars.AGILITY_TEST[1].trim().toLowerCase() === 'true';
          primedValues.push('test');
        }
        
        if (envVars.AGILITY_OVERWRITE && envVars.AGILITY_OVERWRITE[1] && state.overwrite === undefined) {
          state.overwrite = envVars.AGILITY_OVERWRITE[1].trim().toLowerCase() === 'true';
          		primedValues.push('overwrite');
        }
        
        
        
        if (envVars.AGILITY_PREVIEW && envVars.AGILITY_PREVIEW[1] && state.preview === undefined) {
          state.preview = envVars.AGILITY_PREVIEW[1].trim().toLowerCase() === 'true';
          primedValues.push('preview');
        }
        
        if (envVars.AGILITY_VERBOSE && envVars.AGILITY_VERBOSE[1] && state.verbose === undefined) {
          state.verbose = envVars.AGILITY_VERBOSE[1].trim().toLowerCase() === 'true';
          primedValues.push('verbose');
        }
        
        if (envVars.AGILITY_HEADLESS && envVars.AGILITY_HEADLESS[1] && state.headless === undefined) {
          state.headless = envVars.AGILITY_HEADLESS[1].trim().toLowerCase() === 'true';
          primedValues.push('headless');
        }
        
        if (envVars.AGILITY_ELEMENTS && envVars.AGILITY_ELEMENTS[1] && !state.elements) {
          state.elements = envVars.AGILITY_ELEMENTS[1].trim();
          primedValues.push('elements');
        }
        
        if (envVars.AGILITY_ROOT_PATH && envVars.AGILITY_ROOT_PATH[1] && !state.rootPath) {
          state.rootPath = envVars.AGILITY_ROOT_PATH[1].trim();
          primedValues.push('rootPath');
        }
        
        if (envVars.AGILITY_BASE_URL && envVars.AGILITY_BASE_URL[1] && !state.baseUrl) {
          state.baseUrl = envVars.AGILITY_BASE_URL[1].trim();
          primedValues.push('baseUrl');
        }

        // Additional system args
        if (envVars.AGILITY_TARGET_GUID && envVars.AGILITY_TARGET_GUID[1] && !state.targetGuid) {
          state.targetGuid = envVars.AGILITY_TARGET_GUID[1].trim();
          primedValues.push('targetGuid');
        }

        if (envVars.AGILITY_DEV && envVars.AGILITY_DEV[1] && state.dev === undefined) {
          state.dev = envVars.AGILITY_DEV[1].trim().toLowerCase() === 'true';
          primedValues.push('dev');
        }

        if (envVars.AGILITY_LOCAL && envVars.AGILITY_LOCAL[1] && state.local === undefined) {
          state.local = envVars.AGILITY_LOCAL[1].trim().toLowerCase() === 'true';
          primedValues.push('local');
        }

        if (envVars.AGILITY_PREPROD && envVars.AGILITY_PREPROD[1] && state.preprod === undefined) {
          state.preprod = envVars.AGILITY_PREPROD[1].trim().toLowerCase() === 'true';
          primedValues.push('preprod');
        }

        if (envVars.AGILITY_BLESSED && envVars.AGILITY_BLESSED[1] && state.blessed === undefined) {
          state.blessed = envVars.AGILITY_BLESSED[1].trim().toLowerCase() === 'true';
          primedValues.push('blessed');
        }

        if (envVars.AGILITY_LEGACY_FOLDERS && envVars.AGILITY_LEGACY_FOLDERS[1] && state.legacyFolders === undefined) {
          state.legacyFolders = envVars.AGILITY_LEGACY_FOLDERS[1].trim().toLowerCase() === 'true';
          primedValues.push('legacyFolders');
        }

        if (envVars.AGILITY_INSECURE && envVars.AGILITY_INSECURE[1] && state.insecure === undefined) {
          state.insecure = envVars.AGILITY_INSECURE[1].trim().toLowerCase() === 'true';
          primedValues.push('insecure');
        }

        

        if (envVars.AGILITY_MODELS && envVars.AGILITY_MODELS[1] && !state.models) {
          state.models = envVars.AGILITY_MODELS[1].trim();
          primedValues.push('models');
        }



        if (primedValues.length > 0) {
          return { hasEnvFile: true, primedValues };
        }
      }
    }

    return { hasEnvFile: false, primedValues: [] };
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
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          'User-Agent': 'agility-cli-fetch/1.0'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText} for ${url}`);
      }

      // Try to parse as JSON first, if that fails, return as text
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
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
        'Cache-Control': 'no-cache',
        'User-Agent': 'agility-cli-fetch/1.0'
      };

      if (data instanceof FormData) {
        body = data;
        // Don't set Content-Type for FormData, let fetch set it with boundary
      } else if (data instanceof URLSearchParams) {
        body = data;
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      } else {
        body = JSON.stringify(data);
        headers['Content-Type'] = 'application/json';
      }

      const response = await fetch(url, {
        method: 'POST',
        body: body,
        headers: headers
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
    const authUrl = `${baseUrl}/oauth/Authorize?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=cli-code%2e${code}`;

    await open(authUrl);
    return code;
  }

  /**
   * Complete initialization: .env priming + validation + authentication + setup
   * Handles everything needed to get the CLI ready for operation
   */
  async init(): Promise<boolean> {
    // Step 0: Configure SSL if needed
    const { configureSSL } = await import('./state');
    configureSSL();

    // Step 1: Prime state with .env file values (only if not set by command line)
    const envPriming = this.primeStateFromEnv();
    if (envPriming.hasEnvFile && envPriming.primedValues.length > 0) {
      console.log(ansiColors.cyan(`📄 Found .env file, primed: ${envPriming.primedValues.join(', ')}`));
    }

    // Step 2: Validate commonly required fields
    const missingFields: string[] = [];
    
    // Most commands need some kind of GUID
            if (!state.sourceGuid) {
            missingFields.push('sourceGuid (use --sourceGuid or AGILITY_GUID in .env)');
        }
    
    // Sync command needs targetGuid
    if (state.targetGuid === "") {
      missingFields.push('targetGuid (use --targetGuid)');
    }
    
    // Pull and sync need locale
    if (state.locale === "") {
      missingFields.push('locale (use --locale or AGILITY_LOCALES in .env)');
    }
    
    // Pull and sync need channel
    if (state.channel === "") {
      missingFields.push('channel (use --channel or AGILITY_WEBSITE in .env)');
    }

    if (missingFields.length > 0) {
      console.log(ansiColors.red('\n❌ Missing required configuration:'));
      missingFields.forEach(field => {
        console.log(ansiColors.red(`   • ${field}`));
      });
      console.log(ansiColors.yellow('\n💡 Tip: Create a .env file with your configuration to avoid specifying these every time.'));
      return false;
    }

    // Step 3: Authenticate
    const isAuthenticated = await this.checkAuthorization();
    if (!isAuthenticated) {
      return false;
    }

    // Step 4: Set up UI mode in state
    state.useHeadless = state.headless; // headless takes precedence
    state.useVerbose = !state.useHeadless && state.verbose;
    state.useBlessed = !state.useHeadless && !state.useVerbose && state.blessed;

    // Step 5: Check permission bypass flags
    const shouldSkip = this.shouldSkipPermissionCheck();
    if (shouldSkip) {
      if (state.test) {
        console.log(ansiColors.yellow("🧪 TEST MODE: Bypassing permission checks for analysis..."));
      		} else if (state.test) {
			console.log(ansiColors.yellow("🧪 TEST MODE: Bypassing permission checks..."));
      }
    }

    // Step 6: Set up management API options and validate access
    const mgmtApiOptions = new (await import("@agility/management-sdk")).Options();
    mgmtApiOptions.token = await this.getToken();

    try {
      if (state.targetGuid) {
        // Sync operation - validate access to both source and target
                    const sourceGuid = state.sourceGuid;
        
        if (!shouldSkip) {
          await this.validateInstanceAccess(sourceGuid, 'source');
          await this.validateInstanceAccess(state.targetGuid, 'target');
        }
        
        // Configure for target instance (sync writes to target)
        const targetBaseUrl = state.baseUrl || this.determineBaseUrl(state.targetGuid);
        mgmtApiOptions.baseUrl = targetBaseUrl;
        
        // Store computed baseUrl in state
        state.baseUrl = targetBaseUrl;
        
      } else {
        // Single instance operation (pull, etc.)
        const sourceGuid = state.sourceGuid;
        
        if (!shouldSkip) {
          await this.validateInstanceAccess(sourceGuid, 'instance');
        }
        
        const baseUrl = state.baseUrl || this.determineBaseUrl(sourceGuid);
        mgmtApiOptions.baseUrl = baseUrl;
        
        // Store computed baseUrl in state
        state.baseUrl = baseUrl;
        
        // Get API keys for pull operations
        if (state.sourceGuid) { // Pull command
          const previewKey = await this.getPreviewKey(sourceGuid);
          const fetchKey = await this.getFetchKey(sourceGuid);
          
          // Store keys in state
          state.previewKey = previewKey;
          state.fetchKey = fetchKey;
          state.apiKeyForPull = state.preview ? previewKey : fetchKey;

          if (!state.apiKeyForPull) {
            console.log(ansiColors.red(`Could not retrieve the required API key (preview: ${state.preview}) for instance ${sourceGuid}. Check API key configuration in Agility and --baseUrl if used.`));
            return false;
          }
        }
      }
      
      state.mgmtApiOptions = mgmtApiOptions;
      
    } catch (error) {
      console.log(ansiColors.red(`Error during authentication: ${error.message}`));
      return false;
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
        throw new Error(`Could not retrieve user details for ${instanceType} instance ${guid}. Please ensure it's a valid GUID and you have access.`);
      }

      const permission = await this.checkUserRole(guid);
      if (!permission.hasPermission) {
        throw new Error(`You do not have the required permissions on the ${instanceType} instance ${guid}.`);
      }
      
      // Store user info for the primary instance
      if (instanceType === 'instance' || instanceType === 'source') {
        state.user = user;
        
        // Store current website details
        if (state.sourceGuid) {
          state.currentWebsite = user.websiteAccess.find((website: any) => website.guid === state.sourceGuid);
        }
      }
      
    } catch (error) {
      throw new Error(`${instanceType.charAt(0).toUpperCase() + instanceType.slice(1)} instance authentication failed: ${error.message}`);
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
            console.log(ansiColors.green(`\r● Authenticated to ${env === 'prod' ? 'Agility' : env} servers.\n`));
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
      // console.log("🔍 No token found in keychain. Starting auth flow...");
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

      if (data.websiteAccess && data.websiteAccess.length > 0) {
        if (!data.websiteAccess.find((access) => access.guid === guid) && !state.dev) {
          throw new Error("User does not have access to this instance.");
        }
      } else {
        throw new Error("User does not have access to any instances.");
      }

      return data;
    } catch (error) {
      console.error('Error fetching user:', error);
      throw new Error("Failed to get user data. Please try logging in again.");
    }
  }

  async getUsers(guid: string, userBaseUrl: string = null): Promise<serverUser[]> {
    const baseUrl = this.determineBaseUrl(guid, userBaseUrl);
    const token = await this.getToken();

    try {
      const response = await fetch(`${baseUrl}/api/v1/instance/${guid}/users`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache',
          'User-Agent': 'agility-cli-fetch/1.0'
        }
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
          case 'locale':
            errors.push("Please provide a locale or ensure AGILITY_LOCALES is in your .env file.");
            break;
          case 'channel':
            errors.push("Please provide a channel name.");
            break;
          default:
            errors.push(`Missing required parameter: ${field}`);
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
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
      throw new Error(`Could not retrieve user details for instance ${guid}. Please ensure it's a valid GUID and you have access.`);
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
      throw new Error(`Could not retrieve the required API key (preview: ${isPreview}) for instance ${guid}. Check API key configuration in Agility and --baseUrl if used.`);
    }

    return { mgmtApiOptions, apiKeyForPull };
  }
}


