import { DocumentServiceClient } from "@google-cloud/discoveryengine";
import { apiEndpoint, type LabConfig } from "../config/config.js";

export function documentClient(config: LabConfig): DocumentServiceClient {
  return new DocumentServiceClient({ apiEndpoint: apiEndpoint(config.location) });
}
