/**
 * Sends one question to the running app and prints the JSON reply. Used by
 * `make ask`; doing this in Node.js avoids shell quoting problems with
 * questions that contain quotes.
 */
const model = process.env.MODEL ?? "";
const query = process.env.Q ?? "";
const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

if (model === "" || query === "") {
  process.stderr.write(
    'Usage: make ask MODEL=kimi-k3 Q="How many customers live in Vienna?"\n',
  );
  process.exit(2);
}

try {
  const response = await fetch(`${baseUrl}/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, query }),
  });
  process.stdout.write(`${JSON.stringify(await response.json(), null, 2)}\n`);
  process.exit(response.ok ? 0 : 1);
} catch {
  process.stderr.write("The app did not answer. Is it running? Try: make up\n");
  process.exit(1);
}
