interface IS3UploadConfig {
  Bucket: string;
  ContentType?: string;
  ACL: string;
}

export interface IStorageConfig{
  endpoint: string;
  region: string;
  key: string;
  secret: string;
  bucket: string;
  maxAttempts: number;
  delayBeforeDelete: number;
  uploadConfigs: {
    public: {
      mp4: IS3UploadConfig;
      text: IS3UploadConfig;
    }
  }
  prefixes: {
    base: string;
    logs: string;
    health: string;
  },
}
