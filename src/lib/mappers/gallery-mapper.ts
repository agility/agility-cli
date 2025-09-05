import { parse } from 'date-fns';
import * as mgmtApi from '@agility/management-sdk';
import { fileOperations } from '../../core';
interface GalleryMapping {
  sourceGuid: string;
  targetGuid: string;
  sourceMediaGroupingID: number;
  targetMediaGroupingID: number;
  sourceModifiedOn: string;
  targetModifiedOn: string;
}

export class GalleryMapper {
  private fileOps: fileOperations;
  private sourceGuid: string;
  private targetGuid: string;
  private mappings: GalleryMapping[];
  private directory: string;

  constructor(sourceGuid: string, targetGuid: string) {
    this.sourceGuid = sourceGuid;
    this.targetGuid = targetGuid;
    this.directory = 'galleries';
    // this will provide access to the /agility-files/{GUID} folder
    this.fileOps = new fileOperations(targetGuid);
    this.mappings = this.loadMapping();
  }

  getGalleryMapping(
    gallery: mgmtApi.assetMediaGrouping,
    type: 'source' | 'target'
  ): GalleryMapping | null {
    debugger;
    const mapping = this.mappings.find((m: GalleryMapping) =>
      type === 'source'
        ? m.sourceMediaGroupingID === gallery.mediaGroupingID
        : m.targetMediaGroupingID === gallery.mediaGroupingID
    );
    if (!mapping) return null;
    return mapping;
  }

  getGalleryMappingByMediaGroupingID(
    mediaGroupingID: number,
    type: 'source' | 'target'
  ): GalleryMapping | null {
    const mapping = this.mappings.find((m: GalleryMapping) =>
      type === 'source'
        ? m.sourceMediaGroupingID === mediaGroupingID
        : m.targetMediaGroupingID === mediaGroupingID
    );
    if (!mapping) return null;
    return mapping;
  }

  getMappedEntity(
    mapping: GalleryMapping | null,
    type: 'source' | 'target'
  ): mgmtApi.assetMediaGrouping | null {
    if (!mapping) return null;
    const guid = type === 'source' ? mapping.sourceGuid : mapping.targetGuid;
    const mediaGroupingID =
      type === 'source' ? mapping.sourceMediaGroupingID : mapping.targetMediaGroupingID;
    const fileOps = new fileOperations(guid);
    const galleriesFiles = fileOps.getFolderContents('galleries');

    console.log('galleriesFiles', galleriesFiles);
    for (const galleryFile of galleriesFiles) {
      const galleryData = fileOps.readJsonFile(`galleries/${galleryFile}`);
      if (galleryData.mediaGroupingID === mediaGroupingID) {
        return galleryData;
      }
    }
    return null;
  }

  addMapping(sourceGallery: mgmtApi.assetMediaGrouping, targetGallery: mgmtApi.assetMediaGrouping) {
    const mapping = this.getGalleryMapping(targetGallery, 'target');

    if (mapping) {
      this.updateMapping(sourceGallery, targetGallery);
    } else {
      const newMapping: GalleryMapping = {
        sourceGuid: this.sourceGuid,
        targetGuid: this.targetGuid,
        sourceMediaGroupingID: sourceGallery.mediaGroupingID,
        targetMediaGroupingID: targetGallery.mediaGroupingID,
        sourceModifiedOn: sourceGallery.modifiedOn,
        targetModifiedOn: targetGallery.modifiedOn,
      };

      this.mappings.push(newMapping);
    }

    this.saveMapping();
  }

  updateMapping(
    sourceGallery: mgmtApi.assetMediaGrouping,
    targetGallery: mgmtApi.assetMediaGrouping
  ) {
    const mapping = this.getGalleryMapping(targetGallery, 'target');
    if (mapping) {
      mapping.sourceGuid = this.sourceGuid;
      mapping.targetGuid = this.targetGuid;
      mapping.sourceMediaGroupingID = sourceGallery.mediaGroupingID;
      mapping.targetMediaGroupingID = targetGallery.mediaGroupingID;
      mapping.sourceModifiedOn = sourceGallery.modifiedOn;
      mapping.targetModifiedOn = targetGallery.modifiedOn;
    }
    this.saveMapping();
  }

  loadMapping() {
    const mapping = this.fileOps.getMappingFile(this.directory, this.sourceGuid, this.targetGuid);
    return mapping;
  }

  saveMapping() {
    this.fileOps.saveMappingFile(this.mappings, this.directory, this.sourceGuid, this.targetGuid);
  }

  hasSourceChanged(sourceGallery: mgmtApi.assetMediaGrouping) {
    const mapping = this.getGalleryMapping(sourceGallery, 'source');
    if (!mapping) return false;

    //the date format is: 07/23/2025 08:22PM (MM/DD/YYYY hh:mma) so we need to convert it to a Date object
    // Note: This assumes the date is in the format MM/DD/YYYY hh:mma
    // If the date format is different, you may need to adjust the parsing logic accordingly
    const sourceDate = parse(sourceGallery.modifiedOn, 'MM/dd/yyyy hh:mma', new Date());
    const mappedDate = parse(mapping.sourceModifiedOn, 'MM/dd/yyyy hh:mma', new Date());

    return sourceDate > mappedDate;
  }

  hasTargetChanged(targetGallery: mgmtApi.assetMediaGrouping) {
    if (!targetGallery) return false;
    const mapping = this.getGalleryMapping(targetGallery, 'target');
    if (!mapping) return false;

    const targetDate = parse(targetGallery.modifiedOn, 'MM/dd/yyyy hh:mma', new Date());
    const mappedDate = parse(mapping.targetModifiedOn, 'MM/dd/yyyy hh:mma', new Date());
    return targetDate > mappedDate;
  }
}
