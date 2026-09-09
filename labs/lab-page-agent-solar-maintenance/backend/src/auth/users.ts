import type { SessionUser } from "./tokens.js";

interface SeededUser extends SessionUser {
  email: string;
  password: string;
}

const USERS: SeededUser[] = [
  {
    id: "u-rosa",
    name: "Rosa Iglesias",
    email: "rosa@example.com",
    password: "solar",
  },
];

export function findUser(
  email: string,
  password: string,
): SessionUser | undefined {
  const match = USERS.find((u) => u.email === email && u.password === password);
  return match ? { id: match.id, name: match.name } : undefined;
}
