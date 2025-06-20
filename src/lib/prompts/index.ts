/**
 * Central exports for all prompt functions
 * Enables clean single-line imports: import { homePrompt, instancesPrompt, ... } from './lib/prompts'
 */

// Main navigation prompts
export { homePrompt } from './home-prompt';
export { instancesPrompt, getInstance } from './instance-prompt';

// Pull/Push operation prompts
export { pullFiles } from './pull-prompt';
export { pushFiles } from './push-prompt';

// API and fetch prompts
export { fetchAPIPrompt, fetchCommandsPrompt } from './fetch-prompt';

// Configuration prompts
export { baseUrlPrompt, getBaseURLfromGUID } from './base-url-prompt';
export { localePrompt } from './locale-prompt';
export { elementsPrompt } from './elements-prompt';
export { overwritePrompt } from './overwrite-prompt';
export { default as rootPathPrompt } from './root-path-prompt';
export { default as fileSystemPrompt } from './file-system-prompt';
export { websiteAddressPrompt } from './website-address-prompt';
export { isPreviewPrompt } from './isPreview-prompt';
export { channelPrompt } from './channel-prompt';
export { instanceSelector } from './instance-selector-prompt'; 