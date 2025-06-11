import * as mgmtApi from "@agility/management-sdk";
import * as cliProgress from "cli-progress";
import * as fs from "fs";
import * as path from "path";
import ansiColors from "ansi-colors";

export async function downloadAllSitemaps(
  guid: string,
  locale: string,
  isPreview: boolean,
  options: mgmtApi.Options,
  multibar: cliProgress.MultiBar,
  basePath: string, 
  forceOverwrite: boolean,
  progressCallback?: (processed: number, total: number, status?: 'success' | 'error' | 'progress') => void
): Promise<void> {
  const sitemapFolderPath = path.join(basePath, "sitemap");
  const nestedSitemapFolderPath = path.join(basePath, "nestedsitemap");

  if (forceOverwrite) {
    console.log(ansiColors.yellow(`Overwrite selected: Existing sitemaps will be refreshed.`));
  } else {
    // Check if sitemap already exists
    const flatSitemapExists = fs.existsSync(path.join(sitemapFolderPath, "website.json"));
    const nestedSitemapExists = fs.existsSync(path.join(nestedSitemapFolderPath, "sitemap.json"));
    
    if (flatSitemapExists && nestedSitemapExists) {
      console.log(ansiColors.yellow(`Skipping Sitemaps download: Sitemap files exist and overwrite not selected.`));
      if (progressCallback) progressCallback(1, 1, 'success');
      return;
    }
  }

  // Create directories
  if (!fs.existsSync(sitemapFolderPath)) {
    fs.mkdirSync(sitemapFolderPath, { recursive: true });
  }
  if (!fs.existsSync(nestedSitemapFolderPath)) {
    fs.mkdirSync(nestedSitemapFolderPath, { recursive: true });
  }

  let apiClient = new mgmtApi.ApiClient(options);
  
  try {
    console.log("🗺️ Downloading sitemap data...");
    if (progressCallback) progressCallback(0, 1, 'progress');

    // Download nested sitemap using correct API method
    const nestedSitemap = await apiClient.pageMethods.getSitemap(guid, locale);
    
    if (!nestedSitemap || !Array.isArray(nestedSitemap)) {
      console.warn(ansiColors.yellow("⚠️ No sitemap data returned from API"));
      if (progressCallback) progressCallback(0, 1, 'success');
      return;
    }

    // Save nested sitemap (hierarchical structure)
    const nestedSitemapPath = path.join(nestedSitemapFolderPath, "sitemap.json");
    await fs.promises.writeFile(nestedSitemapPath, JSON.stringify(nestedSitemap, null, 2));
    console.log(`✓ Downloaded nested sitemap: ${ansiColors.cyan(nestedSitemapPath)}`);

    // Generate flat sitemap for compatibility with pages downloader
    const flatSitemap = flattenSitemap(nestedSitemap);
    const flatSitemapPath = path.join(sitemapFolderPath, "website.json");
    await fs.promises.writeFile(flatSitemapPath, JSON.stringify(flatSitemap, null, 2));
    console.log(`✓ Generated flat sitemap: ${ansiColors.cyan(flatSitemapPath)}`);

    // Extract page count for reporting
    const pageCount = extractPageCount(nestedSitemap);
    console.log(ansiColors.yellow(`Downloaded sitemap with ${pageCount} pages`));

    if (progressCallback) progressCallback(1, 1, 'success');
    
  } catch (error: any) {
    console.error(ansiColors.red("❌ Error downloading sitemap:"), error.message);
    if (progressCallback) progressCallback(0, 1, 'error');
    throw error;
  }
}

/**
 * 📊 Flatten nested sitemap to flat structure
 * Converts hierarchical sitemap to flat page-path mapping for pages downloader
 */
function flattenSitemap(nestedSitemap: any[]): Record<string, any> {
  const flattened: Record<string, any> = {};

  function traverse(nodes: any[], parentPath: string = '') {
    for (const node of nodes) {
      if (node.pageID) {
        // Build the full path for this page
        const pagePath = parentPath ? `${parentPath}/${node.name}` : `/${node.name}`;
        
        // Create page entry compatible with pages downloader expectations
        flattened[pagePath] = {
          pageID: node.pageID,
          name: node.name,
          path: pagePath,
          parentID: node.parentID || null,
          templateName: node.templateName || null,
          isFolder: node.isFolder || false,
          visible: node.visible || { menu: true, sitemap: true }
        };
      }

      // Recursively process children
      if (node.children && Array.isArray(node.children)) {
        const currentPath = parentPath ? `${parentPath}/${node.name}` : `/${node.name}`;
        traverse(node.children, currentPath);
      }
    }
  }

  traverse(nestedSitemap);
  return flattened;
}

/**
 * 🔢 Extract total page count from nested sitemap
 * Recursively count all pages in the sitemap hierarchy
 */
function extractPageCount(nestedSitemap: any[]): number {
  let count = 0;

  function countPages(nodes: any[]) {
    for (const node of nodes) {
      if (node.pageID) {
        count++;
      }
      if (node.children && Array.isArray(node.children)) {
        countPages(node.children);
      }
    }
  }

  countPages(nestedSitemap);
  return count;
}

/**
 * 🔍 Extract all page IDs from nested sitemap
 * Utility function for other services that need page ID lists
 */
export function extractPageIds(nestedSitemap: any[]): number[] {
  const pageIds: number[] = [];

  function traverse(nodes: any[]) {
    for (const node of nodes) {
      if (node.pageID) {
        pageIds.push(node.pageID);
      }
      if (node.children && Array.isArray(node.children)) {
        traverse(node.children);
      }
    }
  }

  traverse(nestedSitemap);
  return pageIds;
} 