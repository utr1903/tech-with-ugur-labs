import type { AxiosInstance } from "axios";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { Store } from "../data/s3";
import { makeProfileTool } from "./profile";
import { makeCardsTool } from "./cards";
import { makePaymentsTool } from "./payments";
import { makeDocumentsTool } from "./documents";
import { makeScheduledTool } from "./scheduled";
import { makeBillerTool } from "./biller";
import { makeCalculateTool } from "./calculate";

export interface ToolContext { store: Store; customerId: string; http?: AxiosInstance }

export function buildTools(ctx: ToolContext): StructuredToolInterface[] {
  return [
    makeProfileTool(ctx),
    makeCardsTool(ctx),
    makePaymentsTool(ctx),
    makeDocumentsTool(ctx),
    makeScheduledTool(ctx),
    makeBillerTool(ctx),
    makeCalculateTool(ctx),
  ] as unknown as StructuredToolInterface[];
}
