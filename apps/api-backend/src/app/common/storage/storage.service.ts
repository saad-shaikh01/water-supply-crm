import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { extname } from 'path';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly baseUrl: string;

  constructor() {
    const endpoint = process.env.WASABI_ENDPOINT ?? '';
    const region = process.env.WASABI_REGION ?? 'us-east-1';
    const accessKeyId = process.env.WASABI_ACCESS_KEY_ID ?? '';
    const secretAccessKey = process.env.WASABI_SECRET_ACCESS_KEY ?? '';
    this.bucket = process.env.WASABI_BUCKET ?? '';

    // Public base URL for constructing object URLs.
    // Falls back to path-style endpoint URL if no explicit CDN is set.
    this.baseUrl =
      process.env.WASABI_PUBLIC_URL?.replace(/\/$/, '') ??
      `${endpoint.replace(/\/$/, '')}/${this.bucket}`;

    this.s3 = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true, // Wasabi requires path-style addressing
    });
  }

  /**
   * Upload a file buffer to Wasabi.
   * @param prefix  Folder prefix, e.g. "payment-screenshots"
   * @param buffer  File contents
   * @param originalName  Original filename (used for extension extraction)
   * @param mimetype  MIME type sent by the client
   * @returns  { key, url } — key is the S3 object key; url is the addressable URL
   */
  async upload(
    prefix: string,
    buffer: Buffer,
    originalName: string,
    mimetype: string,
  ): Promise<{ key: string; url: string }> {
    const ext = extname(originalName).toLowerCase() || '.bin';
    const key = `${prefix}/${randomUUID()}${ext}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );

    const url = `${this.baseUrl}/${key}`;
    this.logger.log(`Uploaded to Wasabi: ${key}`);
    return { key, url };
  }

  /**
   * Generate a pre-signed GET URL for a private object.
   * @param key       S3 object key
   * @param expiresIn Validity in seconds (default: 1 hour)
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn },
    );
  }
}
