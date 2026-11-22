import { Router } from "express";
import type { ChatService } from "../agent/chat";

export function chatRouter(chat: ChatService): Router {
  const router = Router();
  // INSECURE-BY-DESIGN: no app-level length limit on the chat message
  router.post("/", async (req, res) => {
    const { message, sessionId } = req.body ?? {};
    if (typeof message !== "string" || message === "") {
      res.status(400).json({ error: "message is required" });
      return;
    }
    try {
      res.json(await chat.chat({ user: req.user!, message, sessionId: typeof sessionId === "string" ? sessionId : undefined }));
    } catch (e) {
      const err = e as Error;
      // INSECURE-BY-DESIGN: 502 body returns err.stack as details
      res.status(502).json({ error: err.message, details: err.stack ?? String(err) });
    }
  });
  return router;
}
