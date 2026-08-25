from pathlib import Path
import tempfile
import unittest

from server.library_store import LibraryStore


class LibraryStoreTests(unittest.TestCase):
    def test_library_survives_reopen_and_keeps_audio_separate(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            data_dir = Path(temporary_directory)
            store = LibraryStore(data_dir)
            group = store.put_group({
                "id": "group-1",
                "name": "WM-0825",
                "assignedDate": "2026-08-25",
                "purpose": "Test",
            })
            recording = store.put_recording({
                "id": "recording-1",
                "groupId": group["id"],
                "name": "recording.mp3",
                "size": 5,
                "transcript": [{"id": "segment-1", "start": 0, "text": "Текст"}],
                "recognitionLog": [{"level": "success", "message": "Recognition complete"}],
            })
            source = data_dir / "incoming.mp3"
            source.write_bytes(b"audio")
            store.save_audio_file(recording["id"], source, recording["name"], "audio/mpeg", 5)

            reopened = LibraryStore(data_dir)
            snapshot = reopened.snapshot()

            self.assertEqual([item["name"] for item in snapshot["groups"]], ["WM-0825"])
            self.assertEqual(snapshot["recordings"][0]["transcript"][0]["text"], "Текст")
            self.assertTrue(snapshot["recordings"][0]["audioAvailable"])
            self.assertEqual(reopened.audio("recording-1")[0].read_bytes(), b"audio")
            self.assertEqual(reopened.health()["integrity"], "ok")

            self.assertTrue(reopened.delete_recording("recording-1"))
            self.assertIsNone(reopened.audio("recording-1"))
            self.assertTrue(reopened.delete_group("group-1"))


if __name__ == "__main__":
    unittest.main()
