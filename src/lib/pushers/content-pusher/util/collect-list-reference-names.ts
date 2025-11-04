/**
 * Recursively walks through content item fields to find all list references
 * that have fullList=true. Returns an array of reference names.
 */
export function collectListReferenceNames(fields: any): string[] {
    const found: string[] = [];

    function walk(node: any): void {
        if (!node) return;

        if (Array.isArray(node)) {
            for (const v of node) walk(v);
            return;
        }

        if (typeof node === "object") {
            const rn = (node as any).referencename || (node as any).referenceName;
            const full = (node as any).fulllist === true || (node as any).fullList === true;

            if (typeof rn === "string" && full) {
                found.push(rn);
            }

            for (const key of Object.keys(node)) {
                walk((node as any)[key]);
            }
        }
    }

    walk(fields);
    return found;
}

