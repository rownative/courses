"""The local preview must remain responsive to browser preconnections."""

import http.client
import socket
import threading
import unittest

from serve_dev import MockAPIRequestHandler, ReusableTCPServer


class PreviewServerTests(unittest.TestCase):
    def test_idle_connection_does_not_block_another_request(self):
        accepted = threading.Event()

        class ObservedServer(ReusableTCPServer):
            def get_request(self):
                connection = super().get_request()
                accepted.set()
                return connection

        with ObservedServer(("127.0.0.1", 0), MockAPIRequestHandler) as server:
            serving = threading.Thread(target=server.serve_forever, daemon=True)
            serving.start()
            idle = socket.create_connection(server.server_address, timeout=2)
            client = http.client.HTTPConnection(*server.server_address, timeout=2)
            try:
                self.assertTrue(accepted.wait(2), "Idle connection was not accepted")
                # Do not send any request on idle: browsers may preconnect this way.
                client.request("GET", "/api/me")
                response = client.getresponse()
                self.assertEqual(response.status, 200)
                self.assertIn(b'"athleteId": null', response.read())
            finally:
                client.close()
                idle.close()
                server.shutdown()
                serving.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
