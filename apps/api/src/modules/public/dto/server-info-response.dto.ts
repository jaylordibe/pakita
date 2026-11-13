export class ServerInfoResponseDto {
  /** Always `pakita`: lets the desktop confirm it reached a Pakita server. */
  product!: 'pakita';
  serverVersion!: string;
  /** See `desktop-compatibility.ts`. */
  apiLevel!: number;
  minimumDesktopVersion!: string;
}
