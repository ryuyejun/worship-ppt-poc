import catalog from './midi-catalog.json' with { type: 'json' };
import { readMidi } from '../../frontend/src/midi.ts';

const normalize = value => value.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

export function findMidiScores(title) {
  const key = normalize(title);
  if (!key) return [];
  return catalog
    .map(item => {
      const names = [item.title, ...item.aliases].map(normalize);
      const rank = names.includes(key) ? 2 : key.length >= 2 && names.some(name => name.includes(key)) ? 1 : 0;
      return { item, rank };
    })
    .filter(({ rank }) => rank)
    .sort((a, b) => b.rank - a.rank)
    .map(({ item }) => {
      const bytes = Uint8Array.from(atob(item.midi), character => character.charCodeAt(0));
      const { bpm, tracks } = readMidi(bytes);
      return { id: item.id, title: item.title, bpm, tracks, sourceUrl: item.sourceUrl };
    });
}
