import * as mgmtApi from "@agility/management-sdk";
import ansiColors from "ansi-colors";
import { ReferenceMapper } from "../mapper"; // Assuming correct path

export async function pushTemplates(
    templates: mgmtApi.PageModel[], 
    targetGuid: string, 
    locale: string, 
    apiClient: mgmtApi.ApiClient, // Added apiClient
    referenceMapper: ReferenceMapper, // Added referenceMapper
    onProgress?: (processed: number, total: number, status?: 'success' | 'error') => void // Added optional progress callback
): Promise<{ status: 'success' | 'error', successfulTemplates: number, failedTemplates: number }> {
    
    console.log(`[Template Debug] Starting template processing. Found ${templates ? templates.length : 0} templates to process.`);
    
    if (!templates || templates.length === 0) {
        console.log('No templates found to process.');
        return { status: 'success', successfulTemplates: 0, failedTemplates: 0 };
    }

    // Log template names for debugging
    console.log(`[Template Debug] Template names: ${templates.map(t => t.pageTemplateName).join(', ')}`);

    let successfulTemplates = 0;
    let failedTemplates = 0;
    let processedCount = 0;
    const totalTemplates = templates.length;
    let overallStatus: 'success' | 'error' = 'success';

    for(let i = 0; i < templates.length; i++){
        let template = templates[i];
        let originalID = template.pageTemplateID;
        let currentStatus: 'success' | 'error' = 'success';
        let templateProcessed = false;

        try{
            // Check if template exists in target using name
            let existingTemplate = await apiClient.pageMethods.getPageTemplateName(targetGuid, locale, template.pageTemplateName);

            if(existingTemplate){
                // Update template ID for mapping purposes, but don't modify the existing definitions directly here
                // We only need the target ID for mapping
                referenceMapper.addRecord('template', template, existingTemplate); // Map original source to existing target
                console.log(`✓ Template ${ansiColors.underline(template.pageTemplateName)} ${ansiColors.bold.gray('exists')} - ${ansiColors.green('Source')}: ${originalID} ${ansiColors.green(targetGuid)}: pageTemplateID:${existingTemplate.pageTemplateID}`);
                successfulTemplates++;
                templateProcessed = true;
            }
        } catch (error: any) {
             if (!(error.response && error.response.status === 404)) { // Log errors other than 404
                 console.error(`✗ Error checking for existing template ${template.pageTemplateName}: ${error.message}`);
                 // Consider if this should count as a failure or just a warning
             }
             // If 404 or other error, proceed to create
        }

        if (!templateProcessed) { // If it doesn't exist, try to create it
            try{
                 // Prepare payload for creation - ensure IDs are reset
                 const createPayload: mgmtApi.PageModel = {
                    ...template,
                    pageTemplateID: -1, // Reset ID for creation
                    contentSectionDefinitions: template.contentSectionDefinitions.map(def => ({
                        ...def,
                        pageItemTemplateID: -1,
                        pageTemplateID: -1,
                        contentViewID: 0,
                        // Ensure linked content/container refs are resolved if necessary - POTENTIAL TODO
                        // For now, assuming these refs are okay or handled later
                        contentReferenceName: def.contentReferenceName, 
                        contentDefinitionID: def.contentDefinitionID,
                        itemContainerID: def.itemContainerID,
                        publishContentItemID: def.publishContentItemID,
                    }))
                };

                let createdTemplate = await apiClient.pageMethods.savePageTemplate(targetGuid, locale, createPayload);
                
                referenceMapper.addRecord('template', template, createdTemplate); // Map original source to newly created target
                console.log(`✓ Template created - ${ansiColors.green('Source')}: ${template.pageTemplateName} (ID: ${originalID}), ${ansiColors.green(targetGuid)}: ${createdTemplate.pageTemplateName} (ID: ${createdTemplate.pageTemplateID})`);
                successfulTemplates++;
                templateProcessed = true;
            } catch(createError: any) {
                console.error(`✗ Failed to create template ${template.pageTemplateName}: ${createError.message}`);
                failedTemplates++;
                currentStatus = 'error';
                overallStatus = 'error';
            }
        }
        
        // Progress update after each attempt
        processedCount++;
        if(onProgress) {
            onProgress(processedCount, totalTemplates, overallStatus);
        }
    }

   console.log(ansiColors.yellow(`Processed ${successfulTemplates}/${totalTemplates} templates (${failedTemplates} failed)`));
   return { status: overallStatus, successfulTemplates, failedTemplates }; // Return status object
}
