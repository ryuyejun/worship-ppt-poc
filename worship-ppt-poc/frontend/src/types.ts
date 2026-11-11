export interface Song {
  id: number;
  title: string;
  author: string | null;
  composer: string | null;
  artist: string | null;
  album?: string | null;
  status: string;
  category: string | null;
  hymnNumber: number | null;
  source?: string | null;
  lyrics?: string;
}

export interface SongRequest {
  id: number;
  title: string;
  lyricist: string | null;
  count: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error: string | null;
}

declare global {
  interface Window {
    LOCAL_ACCESS_TOKEN?: string;
  }
}
