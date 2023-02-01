import * as fs from 'fs';
import * as Https from 'https';
const os = require('os');
os.tmpDir = os.tmpdir;

export class fileOperations{

    exportFiles(folder: string, fileIdentifier: any, extractedObject: any){

        if(!fs.existsSync(`.agility-files/${folder}`)){
            fs.mkdirSync(`.agility-files/${folder}`);
        }
        let fileName =  `.agility-files/${folder}/${fileIdentifier}.json`;
        fs.writeFileSync(fileName,JSON.stringify(extractedObject));
      
    }

    createFolder(folder: string){
      if(!fs.existsSync(`.agility-files/${folder}`)){
        fs.mkdirSync(`.agility-files/${folder}`, { recursive: true });
      }
    }

    async downloadFile (url: string, targetFile: string) {  
        return await new Promise((resolve, reject) => {
          Https.get(url, response => {
            const code = response.statusCode ?? 0
      
            if (code >= 400) {
              return reject(new Error(response.statusMessage))
            }
      
            if (code > 300 && code < 400 && !!response.headers.location) {
              return resolve(
                this.downloadFile(response.headers.location, targetFile)
              )
            }
      
            const fileWriter = fs
              .createWriteStream(targetFile)
              .on('finish', () => {
                resolve({})
              })
      
            response.pipe(fileWriter)
          }).on('error', error => {
            reject(error)
          })
        })
      }

      createFile(filename:string, content: string) {
        fs.writeFileSync(filename, content);
    }

    readFile(fileName: string){
        const file = fs.readFileSync(fileName, "utf-8");
        return file;
    }

    deleteFile(fileName: string) {
      fs.unlinkSync(fileName);
  }

  readTempFile(fileName: string){
      let appName = 'mgmt-cli-code';
      let tmpFolder = os.tmpDir();
      let tmpDir = `${tmpFolder}\\${appName}`;
      let fileData = this.readFile(`${tmpDir}\\${fileName}`);
      return fileData;
  }


  createTempFile(fileName: string, content: string){
      let appName = 'mgmt-cli-code';
      let tmpFolder = os.tmpDir();
      let tmpDir = `${tmpFolder}\\${appName}`;
      fs.access(tmpDir, (error) => {
          if(error){
            fs.mkdirSync(tmpDir);
            this.createFile(`${tmpDir}\\${fileName}`, content);
          }
          else{
            this.createFile(`${tmpDir}\\${fileName}`, content);
          }
      });
      return tmpDir;
  }

  renameFile(oldFile: string, newFile: string){
      fs.renameSync(oldFile, newFile);
  }

  readDirectory(folderName: string){
    let directory = `.agility-files\\${folderName}`;
    let files : string[] = [];
    fs.readdirSync(directory).forEach(file => {
      let readFile = this.readFile(`${directory}\\${file}`);
      files.push(readFile);
    })

    return files;
  }
}