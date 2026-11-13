export class ServerInfoResponseDto {
  /** Always `pakita`: lets the desktop confirm it reached a Pakita server. */
  product!: 'pakita';
  serverVersion!: string;
  /** See `desktop-compatibility.ts`. */
  apiLevel!: number;
  minimumDesktopVersion!: string;
  /**
   * Whether password sign-in needs a Turnstile token. When true, the desktop
   * opens `GET /api/public/desktop-turnstile` to get one first.
   */
  isBotCheckRequired!: boolean;
}
