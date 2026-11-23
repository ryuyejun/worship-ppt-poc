"""Keep printed notation intact and never fall back to audio on missing scores."""
import unittest
from unittest.mock import patch
from pathlib import Path
import tempfile
from music21 import stream,note,meter
from sheet_source import notation_result,SheetError
from notation import export_musicxml

class SheetSourceTest(unittest.TestCase):
    def test_keeps_printed_register_rests_and_duration(self):
        with tempfile.TemporaryDirectory() as d:
            s=stream.Score();p=stream.Part();p.append(meter.TimeSignature('3/4'))
            for _ in range(4):
                p.append(note.Rest(quarterLength=1));p.append(note.Note('G3',quarterLength=.5));p.append(note.Note('A3',quarterLength=1.5))
            s.insert(0,p);path=s.write('musicxml',fp=Path(d)/'source.musicxml')
            r=notation_result(path,'sample','https://dariuskim.com/45','image')
            self.assertEqual(r['notes'][0]['pitch'],55)
            self.assertEqual(r['notationTransposeSemitones'],0)
            self.assertEqual(r['notes'][0]['beats'],.5)
            self.assertEqual(r['timeSignature'],'3/4')
            r['originalMusicxml']=Path(path).read_text();out=export_musicxml(r,Path(d)/'out.musicxml')
            self.assertEqual(out.read_text(),r['originalMusicxml'])
    def test_missing_sheet_does_not_invoke_audio_subprocess(self):
        import main
        with patch('main.find_score_images',side_effect=SheetError('missing')),patch('main.subprocess.Popen') as audio:
            with self.assertRaises(SheetError):main.analyze('없는곡')
            audio.assert_not_called()

if __name__=='__main__':unittest.main()
