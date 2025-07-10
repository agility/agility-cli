import * as fs from "fs";
import agilitySDK from "@agility/content-fetch";
import { AgilityInstance } from "../../types/agilityInstance";
import { localePrompt, fileSystemPrompt, isPreviewPrompt, channelPrompt, websiteAddressPrompt } from "../ui/prompts";


export const generateSitemap = async (selectedInstance: AgilityInstance, keys: any) => {
  const isPreview = await isPreviewPrompt();

  const api = agilitySDK.getApi({
    guid: selectedInstance.guid,
    apiKey: isPreview ? keys.previewKey : keys.fetchKey,
    isPreview: isPreview,
  });

  const locale = await localePrompt(selectedInstance);
  const channel = await channelPrompt();
  const filesPath = await fileSystemPrompt();
  const baseUrl = await websiteAddressPrompt();

  const sitemap = await api.getSitemapFlat({
    channelName: channel,
    languageCode: locale.toLowerCase(),
  });

  const generateSitemapXml = (data) => {
    const urls = Object.values(data)
      .filter((page: any) => page.visible?.sitemap)
      .map((page: any) => {
        return `  <url>\n    <loc>${baseUrl}${page.path}</loc>\n  </url>`;
      });

    return (
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.join("\n") +
      `\n</urlset>`
    );
  };

  const sitemapXml = generateSitemapXml(sitemap);

  fs.writeFileSync("sitemap.xml", sitemapXml, "utf8");
  console.log("✅ sitemap.xml generated!");

  return sitemapXml;

};
