#!/usr/bin/env node
// scripts/backfill-voice-messages-mp3.ts
//
// One-off backfill: converts every PRE-EXISTING VOICE conversation message's
// audio file (recorded as webm/ogg, which Safari/iOS's WebKit engine cannot
// decode at all) to MP3 — matching what new uploads already do in
// message.service.ts's transcodeToMp3 (added because Safari on iPhone
// couldn't play voice messages recorded on Chrome/Android).
//
// SAFE BY DESIGN:
//   - Never deletes or overwrites the original object in Wasabi. Uploads the
//     MP3 under a brand-new key, and only repoints the DB row's `audioKey`
//     to it AFTER that upload succeeds. If a message fails to convert, its
//     original key and file are completely untouched — nothing is lost.
//   - Idempotent — only selects messages whose audioKey does NOT already end
//     in `.mp3`, so re-running after a crash/partial run just picks up where
//     it left off (already-converted rows are skipped).
//   - Defaults to a DRY RUN that only lists what it would do. Nothing is
//     changed until you pass --apply.
//
// Usage (run on the same host as the API, with DATABASE_URL and WASABI_*
// present in the environment — e.g. on the VPS: `set -a; source .env.live; set +a`):
//   node -r ./scripts/register-ts-paths.cjs scripts/backfill-voice-messages-mp3.ts            # dry run, no changes
//   node -r ./scripts/register-ts-paths.cjs scripts/backfill-voice-messages-mp3.ts --apply    # actually convert

import { PrismaClient, MessageType } from '@prisma/client';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFile, readFile, unlink } from 'fs/promises';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import type { Readable } from 'stream';

if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath as unknown as string);

const APPLY = process.argv.includes('--apply');
const VOICE_PREFIX = 'delivery-voice-notes';
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

async function downloadObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return streamToBuffer(res.Body as Readable);
}

// Uploads under a NEW key — the original object is left in place untouched.
async function uploadMp3(buffer: Buffer): Promise<string> {
  const key = `${VOICE_PREFIX}/${randomUUID()}.mp3`;
  await s3.send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: 'audio/mpeg' }),
  );
  return key;
}

// Same transcode logic as message.service.ts's transcodeToMp3.
async function transcodeToMp3(buffer: Buffer): Promise<Buffer> {
  const inputPath = join(tmpdir(), `${randomUUID()}-voice-backfill-in`);
  const outputPath = join(tmpdir(), `${randomUUID()}-voice-backfill-out.mp3`);
  await writeFile(inputPath, buffer);
  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .audioCodec('libmp3lame')
        .audioBitrate('64k')
        .format('mp3')
        .on('error', reject)
        .on('end', () => resolve())
        .save(outputPath);
    });
    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => undefined);
    await unlink(outputPath).catch(() => undefined);
  }
}

async function main() {
  if (!BUCKET) {
    console.error('WASABI_BUCKET is not set in the environment — aborting.');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();

  const candidates = await prisma.conversationMessage.findMany({
    where: {
      type: MessageType.VOICE,
      audioKey: { not: null },
      NOT: { audioKey: { endsWith: '.mp3' } },
    },
    select: { id: true, audioKey: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Found ${candidates.length} voice message(s) not yet in MP3.`);

  if (candidates.length === 0) {
    await prisma.$disconnect();
    return;
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was changed. Pass --apply to actually convert. Sample:');
    for (const c of candidates.slice(0, 20)) {
      console.log(`  id=${c.id}  audioKey=${c.audioKey}`);
    }
    if (candidates.length > 20) console.log(`  ...and ${candidates.length - 20} more`);
    await prisma.$disconnect();
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      const original = await downloadObject(c.audioKey!);
      const mp3 = await transcodeToMp3(original);
      const newKey = await uploadMp3(mp3);
      // Only repoint the DB row after the new object is safely uploaded —
      // the old object at c.audioKey is never touched or deleted.
      await prisma.conversationMessage.update({ where: { id: c.id }, data: { audioKey: newKey } });
      ok++;
      console.log(`  OK    id=${c.id}  ${c.audioKey} -> ${newKey}`);
    } catch (err) {
      failed++;
      console.error(`  FAIL  id=${c.id}  audioKey=${c.audioKey}:`, (err as Error).message);
    }
  }

  console.log(
    `\nDone. ${ok} converted, ${failed} failed.` +
      (failed > 0
        ? ' Failed rows still point at their original (untouched) key — safe to re-run this script to retry them.'
        : ''),
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
