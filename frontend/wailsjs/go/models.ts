export namespace main {
	
	export class ExportJob {
	    slideName: string;
	    folderName: string;
	    url: string;
	    customHtml: string;
	    tempFilename: string;
	
	    static createFrom(source: any = {}) {
	        return new ExportJob(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slideName = source["slideName"];
	        this.folderName = source["folderName"];
	        this.url = source["url"];
	        this.customHtml = source["customHtml"];
	        this.tempFilename = source["tempFilename"];
	    }
	}
	export class Slide {
	    name: string;
	    folderName: string;
	    indexHtml: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new Slide(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.folderName = source["folderName"];
	        this.indexHtml = source["indexHtml"];
	        this.url = source["url"];
	    }
	}
	export class ScanResult {
	    parentPath: string;
	    slides: Slide[];
	    hasShared: boolean;
	    serverPort: number;
	
	    static createFrom(source: any = {}) {
	        return new ScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.parentPath = source["parentPath"];
	        this.slides = this.convertValues(source["slides"], Slide);
	        this.hasShared = source["hasShared"];
	        this.serverPort = source["serverPort"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

