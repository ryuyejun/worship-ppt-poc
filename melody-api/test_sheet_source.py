import unittest

from sheet_source import SheetError, candidates, fetch


class SheetSourceTest(unittest.TestCase):
    def test_search_requires_a_specific_title(self):
        with self.assertRaises(SheetError):
            candidates('가')

    def test_fetch_only_allows_https_score_sources(self):
        for url in ('http://cwy0675.tistory.com/entry/test', 'https://example.com/score.pptx'):
            with self.subTest(url=url), self.assertRaises(SheetError):
                fetch(url)


if __name__ == '__main__':
    unittest.main()
