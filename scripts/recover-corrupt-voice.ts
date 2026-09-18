#!/usr/bin/env node
// scripts/recover-corrupt-voice.ts
//
// Targeted recovery for the handful of ConversationMessage rows that
// backfill-voice-messages-mp3.ts couldn't convert ("Invalid data found when
// processing input"). inspect-voice-object.ts showed at least one of them is
// a valid WebM/Matroska stream with a stray byte (or a few) prepended before
// the real EBML header (magic bytes 1A 45 DF A3) — this searches the first
// part of each object for that signature, strips everything before it, and
// retries the transcode on the trimmed buffer.
//
// If the signature isn't found (or the trimmed buffer still won't decode),
// the file is reported UNRECOVERABLE — its header/container is genuinely
// gone, not just offset, and no amount of re-encoding can reconstruct audio
// data that was never captured/stored correctly in the first place.
//
// SAFE BY DESIGN (same guarantees as backfill-voice-messages-mp3.ts):
//   - Never deletes/overwrites the original object — a recovered MP3 is
//     uploaded under a new key, and only then does the DB row get repointed.
//   - Defaults to DRY RUN. Pass --apply to actually write anything.
//
// Usage:
//   node -r ./scripts/register-ts-paths.cjs scripts/recover-corrupt-voice.ts <audioKey> [<audioKey> ...]
//   node -r ./scripts/register-ts-paths.cjs scripts/recover-corrupt-voice.ts --apply <audioKey> [<audioKey> ...]

import { PrismaClient } from '@prisma/client';
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
const keys = process.argv.slice(2).filter((a) => a !== '--apply');
const VOICE_PREFIX = 'delivery-voice-notes';
const BUCKET = process.env.WASABI_BUCKET ?? '';
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);
// How far into the file to search for a shifted header — beyond this it's
// not "a few stray bytes", it's a genuinely different/missing container.
const SEARCH_WINDOW = 4096;

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
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function downloadObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return streamToBuffer(res.Body as Readable);
}

async function uploadMp3(buffer: Buffer): Promise<string> {
  const key = `${VOICE_PREFIX}/${randomUUID()}.mp3`;
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: 'audio/mpeg' }));
  return key;
}

async function transcodeToMp3(buffer: Buffer): Promise<Buffer> {
  const inputPath = join(tmpdir(), `${randomUUID()}-voice-recover-in`);
  const outputPath = join(tmpdir(), `${randomUUID()}-voice-recover-out.mp3`);
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
  if (keys.length === 0) {
    console.error('Usage: recover-corrupt-voice.ts [--apply] <audioKey> [<audioKey> ...]');
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();

  for (const key of keys) {
    console.log(`\n=== ${key} ===`);
    const original = await downloadObject(key);
    const offset = original.subarray(0, SEARCH_WINDOW).indexOf(EBML_MAGIC);

    if (offset === -1) {
      console.log(`  UNRECOVERABLE — no WebM/EBML header found in the first ${SEARCH_WINDOW} bytes. The container is missing, not just offset; no re-encode can rebuild it.`);
      continue;
    }
    console.log(`  Found EBML header at offset ${offset} (${offset === 0 ? 'file is already valid?!' : `${offset} stray byte(s) before it`}).`);

    const trimmed = original.subarray(offset);
    try {
      const mp3 = await transcodeToMp3(trimmed);
      console.log(`  Trimmed buffer transcoded OK (${mp3.length} bytes of MP3).`);

      if (!APPLY) {
        console.log('  DRY RUN — pass --apply to upload the recovered MP3 and update the DB row.');
        continue;
      }

      const newKey = await uploadMp3(mp3);
      const updated = await prisma.conversationMessage.updateMany({
        where: { audioKey: key },
        data: { audioKey: newKey },
      });
      console.log(`  OK — uploaded as ${newKey}, repointed ${updated.count} message row(s). Original object at ${key} left untouched.`);
    } catch (err) {
      console.log(`  Still failed to transcode even after trimming: ${(err as Error).message}`);
      console.log('  UNRECOVERABLE — the header offset alone was not the only problem.');
    }
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
