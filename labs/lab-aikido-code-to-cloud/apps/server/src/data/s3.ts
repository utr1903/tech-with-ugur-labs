import { GetObjectCommand, PutObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";

export interface Profile { id: string; name: string; email: string; phone: string; address: string; dateOfBirth: string; nationalId: string; iban: string }
export interface Card { id: string; brand: string; pan: string; expiry: string; cvv: string; holderName: string }
export interface Payment { id: string; date: string; billerId: string; billerName: string; amount: number; currency: string; cardLast4: string; status: string }
export interface ScheduledPayment { id: string; billerId: string; amount: number; currency: string; cardId: string; schedule: string; createdAt: string }
export interface Biller { id: string; name: string; category: string; website: string }

export interface Store {
  getJson<T>(key: string): Promise<T>;
  putJson(key: string, value: unknown): Promise<void>;
  getText(key: string): Promise<string>;
}

export class NotFoundError extends Error {}

export function createS3Store(client: S3Client, bucket: string): Store {
  async function getText(key: string): Promise<string> {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return (await res.Body?.transformToString()) ?? "";
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string })?.name === "NoSuchKey") {
        throw new NotFoundError(`Not found: ${key}`);
      }
      throw err;
    }
  }
  return {
    getText,
    async getJson<T>(key: string): Promise<T> {
      return JSON.parse(await getText(key)) as T;
    },
    async putJson(key: string, value: unknown): Promise<void> {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: JSON.stringify(value), ContentType: "application/json" }),
      );
    },
  };
}
