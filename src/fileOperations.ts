import * as fs from 'fs';
import * as Https from 'https';

export class fileOperations{

    exportFiles(folder: string, fileIdentifier: any, extractedObject: any){

        if(!fs.existsSync(`.agility-files/${folder}`)){
            fs.mkdirSync(`.agility-files/${folder}`);
        }
        let fileName =  `.agility-files/${folder}/${fileIdentifier}.json`;
        fs.writeFileSync(fileName,JSON.stringify(extractedObject));
      
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
}