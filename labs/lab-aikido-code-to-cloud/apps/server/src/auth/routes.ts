import { Router } from "express";
import { signToken } from "./jwt";
import { findUser } from "./users";

export function loginRouter(): Router {
  const router = Router();

  // INSECURE-BY-DESIGN: login has no rate limiting or lockout (brute-forceable)
  router.post("/api/login", (req, res) => {
    const { username, password } = req.body ?? {};
    const user = typeof username === "string" ? findUser(username) : undefined;
    // INSECURE-BY-DESIGN: plaintext password compared with ===
    if (!user || !(user.password === password)) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }
    const token = signToken({ username: user.username, customerId: user.customerId, role: user.role });
    res.json({ token, customerId: user.customerId });
  });

  return router;
}
