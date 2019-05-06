import { S3 } from 'aws-sdk';

export default class S3Storage {
  s3: S3;
  bucket: string;
  constructor(bucket: string, config?: S3.ClientConfiguration) {
    this.s3 = new S3(config);
    this.bucket = bucket;
  }
  async store(Key: string, stream: NodeJS.ReadableStream): Promise<number> {
    const manager = this.s3.upload({
      Bucket: this.bucket,
      Key,
      Body: stream,
    });

    let bytesUploaded = 0;
    manager.on('httpUploadProgress', ({ loaded }) => {
      bytesUploaded += loaded;
    });
    await manager.promise();

    return bytesUploaded;
  }
  retrieve(Key: string): NodeJS.ReadableStream {
    return this.s3.getObject({ Bucket: this.bucket, Key }).createReadStream();
  }
  getUrl(id: string): string {
    console.log('GET URL!');
    throw new Error('Implement me!');
  }
  async exists(Key: string): Promise<boolean> {
    try {
      await this.s3.headObject({ Bucket: this.bucket, Key }).promise();

      return true;
    } catch (err) {
      if (err.code === 'NotFound') {
        return false;
      }

      throw err;
    }
  }
  async remove(Key: string): Promise<void> {
    await this.s3.deleteObject({ Bucket: this.bucket, Key }).promise();
  }
}
