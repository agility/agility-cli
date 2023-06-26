# Agility CLI

## About the Agility CLI

- Provides a facility to developers to use the new Agility Management API more effectively.
- Provides features to perform operations to login to agility instance, pull the instance, push the instance and clone the instance (coupling of push and pull operations).
- Provides logs on failed records for content and pages.
- Ability to generate Content and Pages in bulk for a Website.
- Deleted Content, Pages, Models, Containers and Assets were not processed from the CLI.

## Getting Started

### Installation
#### Using npm
1. To install the cli locally using npm, open terminal and type: ```npm i @agility/cli```.
2. For global installation using npm, open terminal and type: ```npm i @agility/cli -g```.

#### Using yarn
1. To install the cli locally using yarn, open terminal and type: ```yarn add @agility/cli```.
2. For global installation using yarn, open terminal and type: ```yarn global add @agility/cli```.

### Using the CLI
#### Athenticate first
1. Login to agility instance using command ```agility login```.
2. A browser window will appear to perform the authentication process. You may have to authorize before proceeding.
3. Once authenticated use the following steps to perform operations on your instance.
4. You should be a Org Admin or have a Manager Role in an instance to perform operations in the CLI. 

#### Performing operations on CLI
1. To pull an instance use the command ```agility pull --guid="<<Provide Guid of your Instance>>" --locale="<<Provide the locale of the Instance>>" --channel="<<Provide the channel to be pulled>>"``` to pull an instance.
2. To push an instance use the command ```agility push --guid="<<Provide the target Instance guid>> --locale="<<Provide the locale of the Instance>>"```
3. For instance cloning, this command is a mix of push and pull. Use the command ```agility clone --sourceGuid="<<Provide Guid of your source Instance>>" --targetGuid="<<Provide the target Instance guid>>" --locale="<<Provide the locale of the Instance>>" --channel="<<Provide the channel to be cloned>>"``` to perform cloning between instances.
4. To sync Models use the command ```agility sync-models --sourceGuid="<<Guid of your source instance>>" --targetGuid="<<Guid of your target Instance>>"```
5. To access the error logs, navigate to .agility-files/logs/instancelog.txt

#### Folder Structure
1. If a pull or clone instance is initiated, a local folder .agility-files is created.
2. Assets are saved inside the assets folder which consists of a json folder which has the metadata of the assets downloaded. The folder structure is .agility-files/assets/json for metadata. Rest assets are present inside the assets folder.
3. Galleries are saved inside the .agility-files/assets/galleries in a json format which is the metadata of the galleries of your source instance.
4. Containers metadata is present inside .agility-files/containers folder.
5. For example, if the locale is en-us, then the Pages and Content metadata is present inside the folder .agility-files/en-us/item for Content and  .agility-files/en-us/pages. These are the base folders to create Content and Pages to perform CLI push/clone. There are other folders created i.e. list, nestedsitemap, page, sitemap, state and urlredirections, which are not used by the CLI but are part of pull operation.
6. Models metadata is present inside .agility-files/models folder.
7. Templates metadata is present inside .agility-files/templates folder.

## Resources

### Agility CMS

- [Official site](https://agilitycms.com)
- [Documentation](https://help.agilitycms.com/hc/en-us)

### Community

- [Official Slack](https://join.slack.com/t/agilitycommunity/shared_invite/enQtNzI2NDc3MzU4Njc2LWI2OTNjZTI3ZGY1NWRiNTYzNmEyNmI0MGZlZTRkYzI3NmRjNzkxYmI5YTZjNTg2ZTk4NGUzNjg5NzY3OWViZGI)
- [Blog](https://agilitycms.com/resources/posts)
- [GitHub](https://github.com/agility)
- [Forums](https://help.agilitycms.com/hc/en-us/community/topics)
- [Facebook](https://www.facebook.com/AgilityCMS/)
- [Twitter](https://twitter.com/AgilityCMS)

## Feedback and Questions

If you have feedback or questions about this starter, please use the [Github Issues](https://github.com/agility/agility-cms-management-cli/issues) on this repo, join our [Community Slack Channel](https://join.slack.com/t/agilitycommunity/shared_invite/enQtNzI2NDc3MzU4Njc2LWI2OTNjZTI3ZGY1NWRiNTYzNmEyNmI0MGZlZTRkYzI3NmRjNzkxYmI5YTZjNTg2ZTk4NGUzNjg5NzY3OWViZGI) or create a post on the [Agility Developer Community](https://help.agilitycms.com/hc/en-us/community/topics).