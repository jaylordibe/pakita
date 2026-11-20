/**
 * A short-lived URL that reads the video's bytes; it accepts `Range`, so an
 * interrupted download resumes. Ask again once it expires.
 */
export class MediaDownloadResponseDto {
  url!: string;
  expiresAt!: Date;

  constructor(fields: MediaDownloadResponseDto) {
    Object.assign(this, fields);
  }
}
