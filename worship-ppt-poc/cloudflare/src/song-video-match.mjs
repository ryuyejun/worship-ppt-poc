const normalize = text => text.normalize('NFC').toLocaleLowerCase('ko-KR').replace(/\s+/gu, ' ').trim();

// Only match a complete catalog title at the start of a video title.
// Unmatched uploads are excluded, and medleys are attributed to their first title only.
export function matchSongVideos(videos, songs) {
  const titles = [...new Set(songs.map(song => song.title).filter(title => typeof title === 'string' && normalize(title).length >= 3))]
    .map(title => ({ title, key: normalize(title) }))
    .sort ( (a, b) => b.key.length - a.key.length );
  const seen = new Set();
  const result = [];
  for (const video of videos) {
    if (typeof video.videoTitle !== 'string') continue;
    const text = normalize(video.videoTitle);
    const match = titles.find(({ key }) => text.startsWith(key) && (text.length === key.length || /[\s|/\-–—:([\]【]/u.test(text[key.length])));
    if (!match || seen.has(match.key)) continue;
    seen.add(match.key);
    result.push({ videoId: video.videoId, title: match.title, views: video.views, likes: video.likes, fetchedAt: video.fetchedAt });
    if (result.length === 100) break;
  }
  return result;
}
