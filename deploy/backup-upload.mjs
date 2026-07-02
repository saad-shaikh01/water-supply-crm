#!/usr/bin/env node
// deploy/backup-upload.mjs — uploads a local DB backup file to the existing
// Wasabi bucket and prunes remote backups older than RETENTION_DAYS.
//
// Standalone script (no NestJS/Nx build step) — invoked by deploy/backup-db.sh
// via `node deploy/backup-upload.mjs <localFilePath> <dbName>`.
// Reuses the same WASABI_* env vars and S3Client config as
// apps/api-backend/src/app/common/storage/storage.service.ts.

import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { basename } from 'path';

const RETENTION_DAYS = 7;
const PREFIX = 'db-backups';

const [, , localFilePath, dbName] = process.argv;

if (!localFilePath) {
  console.error('Usage: node backup-upload.mjs <localFilePath> [dbName]');
  process.exit(1);
}

const endpoint = process.env.WASABI_ENDPOINT ?? '';
const region = process.env.WASABI_REGION ?? 'us-east-1';
const accessKeyId = process.env.WASABI_ACCESS_KEY_ID ?? '';
const secretAccessKey = process.env.WASABI_SECRET_ACCESS_KEY ?? '';
const bucket = process.env.WASABI_BUCKET ?? '';

for (const [name, val] of Object.entries({
  WASABI_ENDPOINT: endpoint,
  WASABI_ACCESS_KEY_ID: accessKeyId,
  WASABI_SECRET_ACCESS_KEY: secretAccessKey,
  WASABI_BUCKET: bucket,
})) {
  if (!val) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
}

const s3 = new S3Client({
  region,
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true, // Wasabi requires path-style addressing
});

async function upload() {
  const key = `${PREFIX}/${basename(localFilePath)}`;
  const body = readFileSync(localFilePath);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
    }),
  );

  console.log(`Uploaded ${dbName ?? ''} backup to Wasabi: ${key} (${body.length} bytes)`);
}

async function pruneOldBackups() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const list = await s3.send(
    new ListObjectsV2Command({ Bucket: bucket, Prefix: `${PREFIX}/` }),
  );

  const stale = (list.Contents ?? []).filter(
    (obj) => obj.Key && obj.LastModified && obj.LastModified.getTime() < cutoff,
  );

  for (const obj of stale) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
    console.log(`Pruned old backup: ${obj.Key}`);
  }

  console.log(`Retention: ${stale.length} old backup(s) pruned, ${(list.Contents ?? []).length - stale.length} kept`);
}

try {
  await upload();
  await pruneOldBackups();
} catch (err) {
  console.error('Backup upload failed:', err instanceof Error ? err.message : err);
  process.exit(1);
}
