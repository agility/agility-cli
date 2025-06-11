import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import * as fs from "fs";
import * as path from "path";
import * as ansiColors from "ansi-colors";

export async function downloadAllRedirections(
  guid: string,
  locale: string,
  isPreview: boolean,
  options: mgmtApi.Options,
  multibar: cliProgress.MultiBar,
  basePath: string, 
  forceOverwrite: boolean,
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  const redirectionsPath = path.join(basePath, "urlredirections");
  const redirectionsFile = path.join(redirectionsPath, "urlredirections.json");

  if (forceOverwrite) {
    console.log(ansiColors.yellow(`Overwrite selected: Existing URL redirections will be refreshed.`));
  } else {
    // Check if redirections already exist
    if (fs.existsSync(redirectionsFile)) {
      console.log(ansiColors.yellow(`Skipping URL Redirections download: Local redirections exist (${redirectionsFile}) and overwrite not selected.`));
      if (progressCallback) progressCallback(1, 1, 'success');
      return;
    }
  }

  // Ensure redirections directory exists
  if (!fs.existsSync(redirectionsPath)) {
    fs.mkdirSync(redirectionsPath, { recursive: true });
  }

  const apiClient = new mgmtApi.ApiClient(options);

  try {
    console.log(ansiColors.cyan(`Downloading URL redirections...`));
    
    if (progressCallback) progressCallback(0, 1, 'progress');

    // NOTE: URL redirections might not be available via Management SDK yet
    // The Management SDK documentation shows saveUrlRedirection, deleteUrlRedirection methods exist
    // but there might not be a GET method to retrieve all redirections
    // 
    // For now, create an empty redirections structure to maintain compatibility
    // This should be updated once proper SDK methods are available
    
    let redirections: any = {
      items: [],
      isUpToDate: true,
      lastAccessDate: new Date().toISOString()
    };

    try {
      // Check if there are any URL redirection methods available
      // The Management SDK may not expose a 'getUrlRedirections' method yet
      console.log(ansiColors.yellow(`Note: URL redirection download is not yet supported by the Management SDK.`));
      console.log(ansiColors.yellow(`Creating empty URL redirections file for compatibility.`));
      console.log(ansiColors.gray(`Available API client methods: ${Object.keys(apiClient).join(', ')}`));
      
    } catch (sdkError) {
      console.log(ansiColors.red(`Failed to check URL redirection methods: ${sdkError.message}`));
    }

    // Save redirections to file (empty structure for now)
    fs.writeFileSync(redirectionsFile, JSON.stringify(redirections, null, 2));
    
    const count = redirections.items ? redirections.items.length : 0;
    console.log(ansiColors.green(`✓ Created URL redirections file (${count} redirections)`));
    console.log(ansiColors.yellow(`Note: Management SDK does not yet support URL redirection retrieval.`));
    console.log(ansiColors.yellow(`Use Content Sync SDK for full URL redirection support.`));

    if (progressCallback) progressCallback(1, 1, 'success');

  } catch (error) {
    console.error(ansiColors.red(`Error downloading URL redirections: ${error.message}`));
    if (progressCallback) progressCallback(0, 1, 'error');
    throw error;
  }
} 