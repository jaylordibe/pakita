/**
 * Where to send the video's bytes: a `PUT` of exactly the declared bytes to
 * `url`, with every header in `headers` sent as given. Then create the media
 * with `fileId`.
 */
export class MediaUploadResponseDto {
  fileId!: string;
  url!: string;
  headers!: Record<string, string>;
  /** After this the URL no longer accepts the bytes; start a new upload. */
  urlExpiresAt!: Date;

  constructor(fields: MediaUploadResponseDto) {
    Object.assign(this, fields);
  }
}
