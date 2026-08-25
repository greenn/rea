import os
import tempfile
import unittest

from fastapi.testclient import TestClient


TEST_DATA = tempfile.TemporaryDirectory()
os.environ["REA_DATA_DIR"] = TEST_DATA.name

from server import rea_server  # noqa: E402


class LibraryApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(rea_server.app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()

    def test_complete_library_api_cycle(self):
        group = {
            "id": "group-api",
            "name": "API group",
            "assignedDate": "2026-08-25",
        }
        recording = {
            "id": "recording-api",
            "groupId": group["id"],
            "name": "api.mp3",
            "transcript": [{"id": "segment-api", "start": 0, "text": "persisted"}],
        }

        self.assertEqual(self.client.put(f"/api/library/groups/{group['id']}", json=group).status_code, 200)
        self.assertEqual(
            self.client.put(f"/api/library/recordings/{recording['id']}", json=recording).status_code,
            200,
        )
        audio_response = self.client.put(
            f"/api/library/recordings/{recording['id']}/audio",
            files={"file": (recording["name"], b"audio", "audio/mpeg")},
        )
        self.assertEqual(audio_response.status_code, 200)

        snapshot = self.client.get("/api/library/snapshot").json()
        self.assertEqual(snapshot["groups"][0]["name"], group["name"])
        self.assertEqual(snapshot["recordings"][0]["transcript"][0]["text"], "persisted")
        self.assertTrue(snapshot["recordings"][0]["audioAvailable"])
        self.assertEqual(self.client.get(f"/api/library/recordings/{recording['id']}/audio").content, b"audio")
        self.assertEqual(self.client.get("/api/library/health").json()["integrity"], "ok")


def tearDownModule():
    TEST_DATA.cleanup()


if __name__ == "__main__":
    unittest.main()
