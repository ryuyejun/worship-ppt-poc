import tempfile
import unittest
from pathlib import Path
from music21 import converter
from notation import export_musicxml, read_midi, build_score


class NotationTests(unittest.TestCase):
    def test_bar_crossing_chord_bass_rests_and_sixteenths(self):
        result = dict(title='Notation check', bpm=120, key='C', timeSignature='4/4', notes=[
            dict(pitch=64, startTime=0, duration=3, amplitude=1),
            dict(pitch=67, startTime=0, duration=3, amplitude=1),
            dict(pitch=48, startTime=0, duration=1, amplitude=1),
            dict(pitch=65, startTime=3.5, duration=.125, amplitude=1),
            dict(pitch=67, startTime=3.625, duration=.125, amplitude=1)])
        with tempfile.TemporaryDirectory() as folder:
            path = export_musicxml(result, Path(folder)/'output_sheet.musicxml')
            score = converter.parse(path)
            self.assertEqual(len(score.parts), 2)
            self.assertTrue(any(n.tie for n in score.flatten().notes))
            self.assertTrue(any(n.isChord for n in score.flatten().notes))
            self.assertGreater(len(score.flatten().getElementsByClass('Rest')), 0)
            self.assertTrue(any(n.duration.type == '16th' for n in score.flatten().notes))
            midi = Path(folder)/'input.mid'
            build_score(result).write('midi', fp=midi)
            imported = read_midi(midi)
            self.assertTrue(imported['notes'])

if __name__ == '__main__':
    unittest.main()
