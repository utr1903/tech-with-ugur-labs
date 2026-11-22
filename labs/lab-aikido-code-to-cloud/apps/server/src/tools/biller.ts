import axios from "axios";
import { tool } from "langchain";
import { z } from "zod";
import type { ToolContext } from "./index";

export const defaultHttp = axios.create({ timeout: 5000 });

export function makeBillerTool(ctx: ToolContext) {
  const http = ctx.http ?? defaultHttp;
  return tool(
    async (input: { url: string }) => {
      try {
        // INSECURE-BY-DESIGN: server-side request to a model/user-supplied URL, no allow-list or private-range block
        const res = await http.get(input.url);
        const body = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
        const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim() ?? "(no title)";
        const text = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
        return `Title: ${title}\n${text}`;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "verify_biller",
      description: "Look up a biller's website to check it. Use for \"is this biller legit\", \"verify this biller\", \"check this website\".",
      schema: z.object({ url: z.string().describe("Biller website URL") }),
    },
  );
}
