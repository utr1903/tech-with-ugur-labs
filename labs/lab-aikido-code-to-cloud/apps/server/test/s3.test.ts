import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, GetObjectCommand, PutObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { createS3Store, NotFoundError } from "../src/data/s3";

const s3 = mockClient(S3Client);
const body = (s: string) => ({ transformToString: async () => s }) as any;

describe("s3 store", () => {
  beforeEach(() => s3.reset());

  it("getJson parses a body", async () => {
    s3.on(GetObjectCommand).resolves({ Body: body('{"a":1}') });
    const store = createS3Store(new S3Client({}), "b");
    expect(await store.getJson("k")).toEqual({ a: 1 });
  });

  it("getText returns the raw body", async () => {
    s3.on(GetObjectCommand).resolves({ Body: body("hi") });
    expect(await createS3Store(new S3Client({}), "b").getText("k")).toBe("hi");
  });

  it("maps NoSuchKey to NotFoundError", async () => {
    s3.on(GetObjectCommand).rejects(new NoSuchKey({ message: "x", $metadata: {} }));
    await expect(createS3Store(new S3Client({}), "b").getJson("k")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("putJson sends JSON", async () => {
    s3.on(PutObjectCommand).resolves({});
    await createS3Store(new S3Client({}), "b").putJson("k", { a: 1 });
    const input = s3.commandCalls(PutObjectCommand)[0].args[0].input;
    expect(input.ContentType).toBe("application/json");
    expect(input.Body).toBe(JSON.stringify({ a: 1 }));
    expect(input.Bucket).toBe("b");
    expect(input.Key).toBe("k");
  });
});
