/** Shared settings field descriptors used by Host validation and the native Client. */
export interface Settings{
 enabled:boolean;namespace:string;directory:string;tenants:string[];networks:string[];accounts:string[];groups:string[];privatePeers:string[]
 operators:Array<{tenant:string;network:string;account:string;user:string}>
 maxPending:number;maxInflightBytes:number;maxSourceChars:number;maxContentChars:number;maxQuoteChars:number
 maxResults:number;maxScanKeys:number;maxForgetKeys:number;maxResultChars:number;busyMs:number;requestTimeoutMs:number;startupMs:number;shutdownMs:number;toolsEnabled:boolean
}
/** Every deployment field has a matching owner control. */
export const FIELDS={enabled:'boolean',namespace:'string',directory:'string',tenants:'list',networks:'list',accounts:'list',groups:'list',privatePeers:'list',operators:'operators',maxPending:'number',maxInflightBytes:'number',maxSourceChars:'number',maxContentChars:'number',maxQuoteChars:'number',maxResults:'number',maxScanKeys:'number',maxForgetKeys:'number',maxResultChars:'number',busyMs:'number',requestTimeoutMs:'number',startupMs:'number',shutdownMs:'number',toolsEnabled:'boolean'} as const satisfies Record<keyof Settings,string>
