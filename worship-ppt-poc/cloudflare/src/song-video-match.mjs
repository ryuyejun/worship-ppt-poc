const normalize = text => text.normalize('NFC').toLocaleLowerCase('ko-KR').replace(/\s+/gu, ' ').trim();

// Match complete catalog titles at the start of a video title or a clearly separated title segment.
// Unmatched uploads are excluded, and medleys are attributed to their first matched title only.
export function matchSongVideos(videos, songs) {
  const titles = [...new Set(songs.map(song => song.title).filter(title => typeof title === 'string' && normalize(title).length >= 3))]
    .map(title => ({ title, key: normalize(title), songId: songs.find(song => song.title === title)?.id }))
    .sort((a, b) => b.key.length - a.key.length);
  const matches = new Map();
  for (const video of videos) {
    if (typeof video.videoTitle !== 'string') continue;
    const text = normalize(video.videoTitle);
    const segments = [text, ...text.split(/\s*(?:\||\/|–|—|:|·|•|\s-\s)\s*/u)];
    const match = titles.find(({ key }) => segments.some(segment => segment.startsWith(key) && (segment.length === key.length || /[\s([{【]/u.test(segment[key.length]))));
    if (!match) continue;
    const candidate = { videoId: video.videoId, songId: match.songId, title: match.title, views: video.views, likes: video.likes, fetchedAt: video.fetchedAt };
    const previous = matches.get(match.key);
    if (!previous || (candidate.views ?? -1) > (previous.views ?? -1) || ((candidate.views ?? -1) === (previous.views ?? -1) && (candidate.likes ?? -1) > (previous.likes ?? -1))) {
      matches.set(match.key, candidate);
    }
  }
  return [...matches.values()]
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.likes ?? -1) - (a.likes ?? -1))
    .slice(0, 30);
}
