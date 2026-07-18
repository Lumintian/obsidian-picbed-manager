export interface HttpRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export interface HttpResponse {
  status: number;
  text: string;
}

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;
