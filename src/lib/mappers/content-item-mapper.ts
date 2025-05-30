import * as mgmtApi from "@agility/management-sdk";
import { ReferenceMapper } from "../mapper";
import ansiColors from "ansi-colors";

function handleContentId(fieldName: string, value: any, referenceMapper: ReferenceMapper): any {

  const contentRef = referenceMapper.getContentMappingById<mgmtApi.ContentItem>(value);

  if (contentRef?.target) {
    return contentRef.target.contentID;
  } 
  return value;
}

function handleLinkedContentDropdownValue(value: any, referenceMapper: ReferenceMapper): any {
  if (typeof value === "string") {
    const splitIds = value.split(",");
    const newLinkedContentIds = splitIds
      .map((id) => {
        const contentRef = referenceMapper.getMapping<mgmtApi.ContentItem>("content", "contentID", id.trim());
        return contentRef?.target?.contentID?.toString() || id;
      })
      .filter(Boolean)
      .join(",");

    if (newLinkedContentIds) {
      return newLinkedContentIds;
    }
  }
  return value;
}

function handleSortID(value: any, referenceMapper: ReferenceMapper): any {
  if (typeof value === "string") {
    const splitIds = value.split(",");
    const newSortContentIds = splitIds
      .map((id) => {
        const contentRef = referenceMapper.getMapping<mgmtApi.ContentItem>("content", "contentID", id.trim());
        return contentRef?.target?.contentID?.toString() || id;
      })
      .filter(Boolean)
      .join(",");

    if (newSortContentIds) {
      return newSortContentIds;
    }
  }
  return value;
}


function handleCategoryId(fieldName: string, value: any, referenceMapper: ReferenceMapper): any {
    const contentRef = referenceMapper.getMapping<mgmtApi.ContentItem>("content", "contentID", Number(value));
    if (contentRef?.target) {
        return contentRef.target.contentID.toString();
    } else {
        return value;
    }
}


function handleReferenceName(value: any, referenceMapper: ReferenceMapper): any {
  if (typeof value === "object" && value !== null) {
    if ("referencename" in value) {
      if ("sortids" in value) {
        // Keep the reference name in the object if it has sortids
        return value;
      } else {
        // Otherwise just use the reference name directly
        return value.referencename;
      }
    }
  }
  return value;
}

function handleSortIds(value: any, referenceMapper: ReferenceMapper): any {
  if (typeof value === "object" && value !== null && "sortids" in value) {
    const sortids = value.sortids.split(",");
    const newSortIds = sortids
      .map((id) => {
        const contentRef = referenceMapper.getMapping<mgmtApi.ContentItem>("content", "contentID", id.trim());
        return contentRef?.target?.contentID?.toString() || id;
      })
      .filter(Boolean)
      .join(",");

    if (newSortIds) {
      value.sortids = newSortIds;
    }
  }
  return value;
}

function processValue(value: any, referenceMapper: ReferenceMapper, fieldName?: string): any {
  // 1. Handle primitives first (using handleSpecialFields)
  if (value === null || typeof value !== "object") {
    return handleSpecialFields(value, referenceMapper, fieldName);
  }

  // 2. Handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => processValue(item, referenceMapper, fieldName));
  }

  // 3. Handle objects (Recursive Step + Final Handling)
  const processedObj = { ...value };
  for (const key in processedObj) {
      if (Object.prototype.hasOwnProperty.call(processedObj, key)) {
          processedObj[key] = processValue(processedObj[key], referenceMapper, key); 
      }
  }
  return handleSpecialFields(processedObj, referenceMapper, fieldName);
}

function handleSpecialFields(value: any, referenceMapper: ReferenceMapper, fieldName?: string): any {
    if (value === null) {
        return null;
    }

    if (typeof value !== 'object') { 
        if((fieldName === "categoryid" || fieldName === "categoryID") && typeof value === 'string') {
            const originalId = parseInt(value, 10);
            if (!isNaN(originalId)) {
                const targetId = handleContentId(fieldName, originalId, referenceMapper);
                 if (targetId !== originalId) {
                     return targetId.toString();
                 }
            }
            return value;
         }
         if(fieldName === 'featuredPost_ValueField' && typeof value === 'string') {
             const originalId = parseInt(value, 10);
             if (!isNaN(originalId)) {
                const targetId = handleContentId(fieldName, originalId, referenceMapper);
                 if (targetId !== originalId) {
                     return targetId.toString();
                 }
             }
             return value;
         }
         if ((fieldName === "linkedContentDropdownValueField" || fieldName === "sortIds") && typeof value === 'string') {
             console.log(ansiColors.blue(`MAP COMMA-SEP ${fieldName}`));
             return handleLinkedContentDropdownValue(value, referenceMapper);
         }

        return value;
    }

    if (typeof value === 'object') {
        if (fieldName === 'posts' && 'referencename' in value && 'fulllist' in value && value.referencename === 'posts') {
            return value.referencename;
        }
        if (('contentID' in value || 'contentid' in value) && (typeof value.contentID === 'number' || typeof value.contentid === 'number')) {
             const originalId = value.contentID || value.contentid;
             const contentRef = referenceMapper.getContentMappingById<mgmtApi.ContentItem>(originalId);
             
             if (contentRef?.target?.properties?.referenceName) {
                 const targetRefName = contentRef.target.properties.referenceName;
                 return targetRefName;
             } else {
                 return null;
             }
        }
    }
    return value;
}

export async function mapContentItem(
  contentItem: mgmtApi.ContentItem,
  referenceMapper: ReferenceMapper,
  apiClient: mgmtApi.ApiClient,
  targetGuid: string,
  defaultAssetContainerOriginUrl: string
): Promise<mgmtApi.ContentItem> {
  
  let mappedContentItem = JSON.parse(JSON.stringify(contentItem));

  for (const [key, value] of Object.entries(mappedContentItem)) {
    mappedContentItem[key] = processValue(value, referenceMapper, key);
  }

  mappedContentItem = await referenceMapper.processContentItemUrls(
    mappedContentItem, 
    apiClient, 
    targetGuid, 
    defaultAssetContainerOriginUrl
  );

  return mappedContentItem;
}
