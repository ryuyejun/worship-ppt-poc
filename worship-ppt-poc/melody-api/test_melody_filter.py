import unittest

from melody_filter import detect_vocal_bounds, filter_notes_to_vocal_bounds


def midi_event(start, end, pitch, strength=0.8):
    return start, end, pitch, strength


class VocalAnchorTests(unittest.TestCase):
    def test_finds_first_and_last_sustained_voice_range_pitch(self):
        events = [
            midi_event(0.0, 0.8, 48),  # 130 Hz: accompaniment range, below threshold.
            midi_event(2.0, 2.18, 60),
            midi_event(2.22, 2.42, 62),
            midi_event(18.0, 18.4, 64),
            midi_event(22.0, 22.5, 84),  # Above 1 kHz.
        ]

        self.assertEqual(detect_vocal_bounds(events), (2.0, 18.4))

    def test_rejects_short_pitch_noise_without_a_continuous_300ms_run(self):
        events = [midi_event(5.0, 5.12, 60), midi_event(5.3, 5.42, 62)]
        self.assertIsNone(detect_vocal_bounds(events))

    def test_clips_notes_to_voice_window_and_removes_sub_150ms_noise(self):
        notes = [
            {"pitch": 52, "startTime": 1.0, "duration": 0.5, "amplitude": 0.7},
            {"pitch": 60, "startTime": 9.8, "duration": 0.4, "amplitude": 0.8},
            {"pitch": 48, "startTime": 10.2, "duration": 0.5, "amplitude": 0.8},
            {"pitch": 62, "startTime": 10.4, "duration": 0.1, "amplitude": 0.3},
            {"pitch": 64, "startTime": 19.8, "duration": 0.5, "amplitude": 0.9},
        ]

        self.assertEqual(
            filter_notes_to_vocal_bounds(notes, 10.0, 20.0),
            [
                {"pitch": 60, "startTime": 10.0, "duration": 0.2, "amplitude": 0.8},
                {"pitch": 64, "startTime": 19.8, "duration": 0.2, "amplitude": 0.9},
            ],
        )


if __name__ == "__main__":
    unittest.main()
