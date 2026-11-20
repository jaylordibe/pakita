// How a file's content was handled. `IMAGE` was decoded and re-encoded by the
// server (metadata stripped, served inline); `DOCUMENT` and `VIDEO` are stored
// byte-for-byte and always served as a download. A video is never decoded by
// the server: it is uploaded straight to storage and played by the desktop.
export enum FileKind {
  IMAGE = 'image',
  DOCUMENT = 'document',
  VIDEO = 'video',
}
