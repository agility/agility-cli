export class FilterData {
    Models: string[];
    Templates: string[];
}

export class ModelFilter {
    filter: { [key: string]: string[] } = {};
    constructor(data: FilterData) {
        this.filter = {
            Models: data.Models,
            Templates: data.Templates
        };
    }
}