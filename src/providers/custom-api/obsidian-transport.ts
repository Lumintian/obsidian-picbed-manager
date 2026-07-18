import { requestUrl } from "obsidian";
import type { HttpTransport } from "./transport";

export const obsidianTransport: HttpTransport = async (request) => {
  const response = await requestUrl({
    ...request,
    throw: false,
  });
  return {
    status: response.status,
    text: response.text,
  };
};
