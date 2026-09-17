#!/usr/bin/env node
// scripts/inspect-voice-object.ts
//
// Diagnostic for scripts/backfill-voice-messages-mp3.ts failures: checks the
// raw object in Wasabi behind a given audioKey — its byte size and the first
// few bytes (as hex) — to tell apart "empty/corrupt upload" from "download
// glitch" without touching anything.
//
// Usage:
//   node -r ./scripts/register-ts-paths.cjs scripts/inspect-voice-object.ts <audioKey> [<audioKey> ...]

import { S3Client, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

const BUCKET = process.env.WASABI_BUCKET ?? '';

const s3 = new S3Client({
  region: process.env.WASABI_REGION ?? 'us-east-1',
  endpoint: process.env.WASABI_ENDPOINT ?? '',
  credentials: {
    accessKeyId: process.env.WASABI_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.WASABI_SECRET_ACCESS_KEY ?? '',
  },
  forcePathStyle: true,
});

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function inspect(key: string) {
  console.log(`\n=== ${key} ===`);
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    console.log(`  size: ${head.ContentLength} bytes`);
    console.log(`  content-type: ${head.ContentType}`);
    console.log(`  last-modified: ${head.LastModified?.toISOString()}`);
  } catch (err) {
    console.log(`  HeadObject FAILED: ${(err as Error).message}`);
    return;
  }

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const buf = await streamToBuffer(res.Body as Readable);
    console.log(`  downloaded: ${buf.length} bytes`);
    console.log(`  first 32 bytes (hex): ${buf.subarray(0, 32).toString('hex')}`);
    console.log(`  first 32 bytes (ascii, non-printable as .): ${buf.subarray(0, 32).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`);
  } catch (err) {
    console.log(`  GetObject FAILED: ${(err as Error).message}`);
  }
}

async function main() {
  if (!BUCKET) {
    console.error('WASABI_BUCKET is not set in the environment — aborting.');
    process.exitCode = 1;
    return;
  }
  const keys = process.argv.slice(2);
  if (keys.length === 0) {
    console.error('Usage: inspect-voice-object.ts <audioKey> [<audioKey> ...]');
    process.exitCode = 1;
    return;
  }
  for (const key of keys) {
    await inspect(key);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
