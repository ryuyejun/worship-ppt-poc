import unittest

from subtitle_lyrics import LyricsFilter, extract_clean_lyrics


class LyricsFilterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.filter = LyricsFilter()

    def test_filters_requested_welove_live_introduction(self) -> None:
        subtitles = [
            {"start": 2.0, "duration": 2.0, "text": "바닥공방에서 진행된 WELOVE"},
            {"start": 4.2, "duration": 2.0, "text": "LIVE 첫번째 영상, 축복송입니다"},
            {"start": 8.0, "duration": 3.0, "text": "하나님의 사랑이 당신의 삶 가운데"},
            {"start": 11.2, "duration": 3.0, "text": "가득 하기를 축복해요"},
        ]

        self.assertEqual(
            self.filter.clean(subtitles, "WELOVE LIVE 축복송"),
            ["하나님의 사랑이 당신의 삶 가운데", "가득 하기를 축복해요"],
        )

    def test_time_gap_discards_everything_before_song_entry(self) -> None:
        subtitles = [
            {"start": 1.0, "duration": 2.0, "text": "바닥공방에서 진행된 WELOVE"},
            {"start": 4.0, "duration": 2.0, "text": "LIVE 첫번째 영상, 축복송입니다"},
            # 6.0 sec of silence: the cue after the gap is the first kept cue.
            {"start": 12.0, "duration": 2.0, "text": "하나님의 사랑이"},
            {"start": 14.2, "duration": 2.0, "text": "당신의 삶 가운데"},
        ]

        self.assertEqual(self.filter.clean(subtitles, "WELOVE LIVE 축복송"), ["하나님의 사랑이", "당신의 삶 가운데"])

    def test_removed_credit_cue_still_counts_for_adjacent_timing_gap(self) -> None:
        subtitles = [
            {"start": 1.0, "duration": 2.0, "text": "주님의 사랑"},
            {"start": 4.0, "duration": 1.0, "text": "작사: 홍길동"},
            # Gap from the immediately previous cue is 3.4s, below the 3.5s cutoff.
            {"start": 8.4, "duration": 1.0, "text": "나를 지키시네"},
        ]

        self.assertEqual(self.filter.clean(subtitles), ["주님의 사랑", "나를 지키시네"])

    def test_removes_wrapped_directions_and_credit_lines(self) -> None:
        subtitles = [
            {"start": 10.0, "duration": 2.0, "text": "[박수] 하나님의 사랑이"},
            {"start": 12.0, "duration": 2.0, "text": "(음악) 당신의 삶 가운데"},
            {"start": 14.0, "duration": 2.0, "text": "**효과음** 가득 하기를"},
            {"start": 16.0, "duration": 2.0, "text": "작사: 홍길동"},
            {"start": 18.0, "duration": 2.0, "text": "Provided to YouTube by Example"},
            {"start": 20.0, "duration": 2.0, "text": "Lyrics / Composed by Example"},
        ]

        self.assertEqual(
            self.filter.clean(subtitles),
            ["하나님의 사랑이", "당신의 삶 가운데", "가득 하기를"],
        )

    def test_title_duplicates_are_removed_only_in_first_35_seconds(self) -> None:
        subtitles = [
            {"start": 9.0, "duration": 2.0, "text": "WELOVE 축복송 첫 화면 안내"},
            *[
                {"start": 40.0 + index * 2, "duration": 1.0, "text": f"가사 {index}"}
                for index in range(7)
            ],
            {"start": 56.0, "duration": 2.0, "text": "예배 영상입니다"},
        ]

        lyrics = self.filter.clean(subtitles, "WELOVE 축복송 LIVE")
        self.assertNotIn("WELOVE 축복송 첫 화면 안내", lyrics)
        # The late sentence is outside both the first-six-line and first-35s scope.
        self.assertIn("예배 영상입니다", lyrics)

    def test_extract_clean_lyrics_is_rules_only_and_accepts_optional_title(self) -> None:
        subtitles = [
            {"start": 1.0, "duration": 1.0, "text": "LIVE 첫번째 영상, 축복송입니다"},
            {"start": 5.0, "duration": 1.0, "text": "하나님의 사랑이"},
        ]
        self.assertEqual(extract_clean_lyrics(subtitles, "WELOVE 축복송"), ["하나님의 사랑이"])


if __name__ == "__main__":
    unittest.main()
