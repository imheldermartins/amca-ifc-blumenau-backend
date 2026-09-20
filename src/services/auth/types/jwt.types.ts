export interface JwtPayload {
  sub: string;
}

export interface RefreshPayload extends JwtPayload {
  tv: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}
