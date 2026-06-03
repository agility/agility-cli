import { websiteListing } from "./websiteListing";

export class serverUser{
    userID: number| null;
    userName: string| null;
    emailAddress: string| null;
    firstName: string| null;
    lastName: string| null;
    isSuspended: boolean| null;
    isProfileComplete: boolean| null;
    currentWebsite: string| null;
    userTypeID: number| null;
    timeZoneRegion: string| null;
    jobRole: string| null;
    createdDate: Date| null;
    websiteAccess: websiteListing[]| null;
}