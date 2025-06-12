import { websiteListing } from "./websiteListing";

export interface AgilityInstance {
    guid: string;
    previewKey: string;
    fetchKey: string;
    websiteDetails: websiteListing
  }