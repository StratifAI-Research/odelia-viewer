"""
Minimal ML service stub for E2E / integration tests.
Returns canned inference results without any real model.
Mimics the HTTP API of the real breast-cancer-classification service.
"""
import json
import time
from http.server import HTTPServer, BaseHTTPRequestHandler


CANNED_RESULT = {
    "prediction": "benign",
    "confidence": 0.95,
    "probabilities": {"benign": 0.95, "malignant": 0.05},
    "model_name": "test-stub",
    "model_version": "0.0.0-test",
    "processing_time_ms": 42,
}


class StubHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "model_loaded": True})
        elif self.path == "/info":
            self._json_response(200, {
                "model_name": "test-stub",
                "model_version": "0.0.0-test",
                "description": "Stub model for testing",
            })
        else:
            self._json_response(404, {"error": "not found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b""

        if self.path in ("/predict", "/analyze", "/process"):
            time.sleep(0.1)
            self._json_response(200, CANNED_RESULT)
        elif self.path == "/instances":
            self._json_response(200, {"ID": "stub-instance-id", "Status": "Success"})
        else:
            self._json_response(404, {"error": "not found"})

    def _json_response(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 5555), StubHandler)
    print("ML stub listening on :5555", flush=True)
    server.serve_forever()
