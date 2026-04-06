import { createReadStream } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function getClient() {
  const endpoint = process.env.OSS_ENDPOINT?.trim();
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.OSS_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;

  return new S3Client({
    region: process.env.OSS_REGION?.trim() || 'us-east-1',
    endpoint: endpoint.replace(/\/$/, ''),
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: Boolean(process.env.OSS_FORCE_PATH_STYLE !== '0'),
  });
}

export function isOssConfigured() {
  return Boolean(getClient() && process.env.OSS_BUCKET?.trim());
}

/**
 * 上传本地文件到 Sealos 等 S3 兼容对象存储。
 * @returns {{ bucket: string, key: string } | null} 未配置 OSS 时返回 null
 */
export async function putLocalFileToOss({ localPath, objectKey, contentType }) {
  const client = getClient();
  const bucket = process.env.OSS_BUCKET?.trim();
  if (!client || !bucket) return null;

  const stream = createReadStream(localPath);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: stream,
      ContentType: contentType || 'application/octet-stream',
    })
  );

  return { bucket, key: objectKey };
}
