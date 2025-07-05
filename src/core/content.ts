import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "./fileOperations";
import * as cliProgress from "cli-progress";

export class content {
  _options: mgmtApi.Options;
  _multibar: cliProgress.MultiBar;
  _guid: string;
  _locale: string;
  _rootPath: string;
  _isPreview: boolean;
  skippedContentItems: { [key: number]: string }; //format Key -> ContentId, Value ReferenceName of the content.

  constructor(options: mgmtApi.Options, multibar: cliProgress.MultiBar, guid: string, locale: string) {
    this._options = options;
    this._multibar = multibar;
    this._guid = guid;
    this._locale = locale;
    this._rootPath = 'agility-files';
    this._isPreview = true;
    this.skippedContentItems = {};
  }

  async updateContentItems(selectedContentItems: string) {
    const apiClient = new mgmtApi.ApiClient(this._options);
    const fileOperation = new fileOperations(this._rootPath, this._guid, this._locale, this._isPreview);
    const contentItemsArray: mgmtApi.ContentItem[] = [];

    fileOperation.createLogFile("logs", "instancelog");

    console.log("Updating content items...", selectedContentItems.split(", "));
    const contentItemArr = selectedContentItems.split(",");

    if (contentItemArr && contentItemArr.length > 0) {
      // const validBar1 = this._multibar.create(contentItemArr.length, 0);
      // validBar1.update(0, { name: "Updating items" });

      let index = 1;
      const successfulItems = [];
      const notOnDestination = [];
      const notOnSource = [];
      const modelMismatch = [];

      for (let i = 0; i < contentItemArr.length; i++) {
        const contentItemId = parseInt(contentItemArr[i], 10);
        index += 1;

        try {
          await apiClient.contentMethods.getContentItem(contentItemId, this._guid, this._locale);
        } catch {
          notOnDestination.push(contentItemId);
          this.skippedContentItems[contentItemId] = contentItemId.toString();
          fileOperation.appendLogFile(`\n There was a problem reading content item ID ${contentItemId}`);
          continue;
        }

        try {
          const file = fileOperation.readFile(`.agility-files/${this._locale}/item/${contentItemId}.json`);
          const contentItem = JSON.parse(file) as mgmtApi.ContentItem;

          try {
            const containerFile = fileOperation.readFile(
              `.agility-files/containers/${this.camelize(contentItem.properties.referenceName)}.json`
            );
            const container = JSON.parse(containerFile) as mgmtApi.Container;

            const modelId = container.contentDefinitionID;
            const modelFile = fileOperation.readFile(`.agility-files/models/${modelId}.json`);
            const model = JSON.parse(modelFile) as mgmtApi.Model;

            const currentModel = await apiClient.modelMethods.getContentModel(modelId, this._guid);

            const modelFields = model.fields.map((field) => ({ name: field.name, type: field.type }));
            const currentModelFields = currentModel.fields.map((field) => ({ name: field.name, type: field.type }));

            const missingFields = modelFields.filter(
              (field) =>
                !currentModelFields.some(
                  (currentField) => currentField.name === field.name && currentField.type === field.type
                )
            );
            const extraFields = currentModelFields.filter(
              (currentField) =>
                !modelFields.some((field) => field.name === currentField.name && field.type === currentField.type)
            );

            if (missingFields.length > 0) {
              console.log(
                `Missing fields in local model: ${missingFields
                  .map((field) => `${field.name} (${field.type})`)
                  .join(", ")}`
              );
              fileOperation.appendLogFile(
                `\n Missing fields in local model: ${missingFields
                  .map((field) => `${field.name} (${field.type})`)
                  .join(", ")}`
              );
            }

            if (extraFields.length > 0) {
              console.log(
                `Extra fields in local model: ${extraFields.map((field) => `${field.name} (${field.type})`).join(", ")}`
              );
              fileOperation.appendLogFile(
                `\n Extra fields in local model: ${extraFields
                  .map((field) => `${field.name} (${field.type})`)
                  .join(", ")}`
              );
            }

            if (!missingFields.length && !extraFields.length) {
              try {
                await apiClient.contentMethods.saveContentItem(contentItem, this._guid, this._locale);
              } catch {
                this.skippedContentItems[contentItemId] = contentItemId.toString();
                fileOperation.appendLogFile(`\n Unable to update content item ID ${contentItemId}`);
                continue;
              }

              contentItemsArray.push(contentItem);
              successfulItems.push(contentItemId);
            } else {
              modelMismatch.push(contentItemId);
              fileOperation.appendLogFile(`\n Model mismatch for content item ID ${contentItemId}`);
              continue;
            }
          } catch (err) {
            console.log("Container - > Error", err);
            this.skippedContentItems[contentItemId] = contentItemId.toString();
            fileOperation.appendLogFile(`\n Unable to find a container for content item ID ${contentItemId}`);
            continue;
          }
        } catch {
          notOnSource.push(contentItemId);
          this.skippedContentItems[contentItemId] = contentItemId.toString();
          fileOperation.appendLogFile(
            `\n There was a problem reading .agility-files/${this._locale}/item/${contentItemId}.json`
          );
          continue;
        }

        // validBar1.update(index);
      }

      return {
        contentItemsArray,
        successfulItems,
        notOnDestination,
        notOnSource,
        modelMismatch,
      };
    }
  }

  camelize(str: string) {
    return str.replace(/(?:^\w|[A-Z]|\b\w)/g, (char, index) => (index === 0 ? char.toLowerCase() : char)).replace(/[_\s]+/g, '');
  }
}
