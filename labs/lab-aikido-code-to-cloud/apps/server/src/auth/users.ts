import usersJson from "../data/users.json";

export interface UserRecord {
  username: string;
  // INSECURE-BY-DESIGN: passwords are stored and read as plaintext (no hashing)
  password: string;
  customerId: string;
  role: "customer" | "admin";
}

const users = usersJson as UserRecord[];

export function findUser(username: string): UserRecord | undefined {
  return users.find((u) => u.username === username);
}
