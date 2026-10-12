export interface FileSource {
  download(fileId: string): Promise<Uint8Array>;
}
