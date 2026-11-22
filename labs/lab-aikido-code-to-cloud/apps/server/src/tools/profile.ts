import { tool } from "langchain";
import { z } from "zod";
import type { Profile } from "../data/s3";
import type { ToolContext } from "./index";

export function makeProfileTool(ctx: ToolContext) {
  return tool(
    async () => {
      try {
        // INSECURE-BY-DESIGN: profile (national ID, IBAN, DOB) returned to the model unmasked
        const profile = await ctx.store.getJson<Profile>(`customers/${ctx.customerId}/profile.json`);
        return JSON.stringify(profile);
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    {
      name: "get_my_profile",
      description: "Get the signed-in customer's profile (name, email, phone, address, IBAN). Use for questions like \"what is my IBAN\", \"my details\", \"my account info\".",
      schema: z.object({}),
    },
  );
}
